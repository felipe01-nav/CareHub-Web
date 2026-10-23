// CareHub Learning: the course player. Learners take courses here; Studio uses the same screen to preview a
// draft (no server calls, nothing saved). Progress events wait in a localStorage queue (per workspace +
// course) and are sent every ~15 s, on lesson change and when the tab is hidden, with retries — so a dropped
// network never loses progress. Active time only counts while the page is visible, focused and in use
// (or a video is playing).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { formatWhen } from './CareHubCore';
import {
  answerText,
  correctAnswerOf,
  effectiveCompletion,
  estimateMinutes,
  formatClock,
  formatDuration,
  formatMinutes,
  gradeQuestion,
  isAnswered,
  isFinished,
  isTransientError,
  lapi,
  LEARNING_PATH,
  learningNotLive,
  lErrorText,
  plural,
  readQueue,
  requiredSeconds,
  seededShuffle,
  statusInfo,
  writeQueue,
} from './CareHubLearningApi';
import { BlockView, Chip, CourseCover, NarrowContext, ProgressBar, QuestionView, RichText } from './CareHubLearningBlocks';
import { isInteractKind } from './CareHubLearningInteract';
import { ChNote } from './CareHubUi';

import type {
  Answer,
  BlockOf,
  Content,
  Enrollment,
  KcRecord,
  LearnEvent,
  LearnStatus,
  Lesson,
  PlayCourse,
  Question,
  Quiz,
  QuizResponse,
} from './CareHubLearningApi';
import type { BlockCtx } from './CareHubLearningBlocks';

type View = { kind: 'intro' } | { kind: 'lesson'; lessonId: string } | { kind: 'quiz' } | { kind: 'done' };

interface FlushResult {
  ok: boolean;
  transient: boolean;
  error: string;
  rejected: { event: LearnEvent; reason: string }[];
}

const FLUSH_OK: FlushResult = { ok: true, transient: false, error: '', rejected: [] };
const OFFLINE_TEXT = 'You seem to be offline. Your progress is kept on this device and sent when you’re back online.';

export interface PlayerProps {
  workspaceId: string;
  courseId: string;
  /** Studio preview: play this content in the browser only. */
  preview?: Content;
  /** Preview: open this lesson right away ("_quiz" opens the quiz). */
  startLessonId?: string;
  onExit?: () => void;
  exitLabel?: string;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function asPlayCourse(content: Content, id: string): PlayCourse {
  return {
    ...content,
    id,
    version: 0,
    quiz: {
      ...content.quiz,
      attempts_used: 0,
      attempts_left: content.settings.max_attempts > 0 ? content.settings.max_attempts : null,
      locked_reason: null,
    },
  };
}

function previewEnrollment(): Enrollment {
  const now = Date.now();

  return {
    status: 'in_progress',
    percent: 0,
    score: null,
    attempts: 0,
    time_ms: 0,
    started_ms: now,
    last_ms: now,
    completed_ms: null,
    ack_ms: null,
    awaiting_ack: false,
    version: 0,
    progress: { lessons: {}, kc: {}, position: null, quiz_active_ms: 0 },
  };
}

function initialView(course: PlayCourse, enr: Enrollment | null, preview: boolean, startLessonId?: string): View {
  if (preview && startLessonId) {
    if (startLessonId === '_quiz' && course.quiz.enabled) return { kind: 'quiz' };
    if (course.lessons.some((l) => l.id === startLessonId)) return { kind: 'lesson', lessonId: startLessonId };
  }

  if (!enr) return { kind: 'intro' };
  if (enr.awaiting_ack || isFinished(enr)) return { kind: 'done' };
  const lessons = course.lessons;
  const done = (id: string) => Boolean(enr.progress.lessons[id]?.done);
  const openable = (i: number) => !course.settings.sequential || lessons.slice(0, i).every((l) => done(l.id));
  const pos = enr.progress.position;

  if (pos) {
    const i = lessons.findIndex((l) => l.id === pos.lesson_id);

    if (i >= 0 && openable(i)) return { kind: 'lesson', lessonId: pos.lesson_id };
  }

  const next = lessons.find((l) => !done(l.id));

  if (next) return { kind: 'lesson', lessonId: next.id };
  if (course.quiz.enabled && effectiveCompletion(course) !== 'all_lessons') return { kind: 'quiz' };
  return lessons.length ? { kind: 'done' } : { kind: 'intro' };
}

/** Status the way the server works it out — used by the preview (live mode shows the server's numbers). */
function localProgress(
  course: PlayCourse,
  lessonsDone: number,
  quizPassed: boolean,
  outOfAttempts: boolean,
  acked: boolean
): { status: LearnStatus; percent: number; awaiting_ack: boolean } {
  const completion = effectiveCompletion(course);
  const needLessons = completion !== 'pass_quiz';
  const needQuiz = completion !== 'all_lessons';
  const total = course.lessons.length;
  const met = (!needLessons || lessonsDone >= total) && (!needQuiz || quizPassed);
  const ack = course.settings.require_ack;
  const units = (needLessons ? total : 0) + (needQuiz ? 1 : 0) + (ack ? 1 : 0);
  const doneUnits = (needLessons ? Math.min(lessonsDone, total) : 0) + (needQuiz && quizPassed ? 1 : 0);
  const pct = units ? Math.min(99, Math.floor((doneUnits * 100) / units)) : 0;

  if (met && (!ack || acked)) return { status: course.quiz.enabled && quizPassed ? 'passed' : 'completed', percent: 100, awaiting_ack: false };
  if (needQuiz && outOfAttempts && !quizPassed) return { status: 'failed', percent: pct, awaiting_ack: false };
  return { status: 'in_progress', percent: pct, awaiting_ack: met && ack && !acked };
}

function pickPreviewQuestions(quiz: Quiz, round: number): Question[] {
  let qs = quiz.questions.slice();

  if (quiz.pool_size > 0 && quiz.pool_size < qs.length) qs = seededShuffle(qs, `pool-${round}`).slice(0, quiz.pool_size);
  if (quiz.shuffle) qs = seededShuffle(qs, `order-${round}`);
  return qs;
}

function gradeLocally(course: PlayCourse, questions: Question[], answers: Record<string, Answer>, usedBefore: number): QuizResponse {
  const used = usedBefore + 1;
  const max = course.settings.max_attempts;
  const left = max > 0 ? Math.max(0, max - used) : null;
  let earned = 0;
  let total = 0;
  const graded = questions.map((q) => {
    const ok = gradeQuestion(q, answers[q.id]);

    total += q.points;
    if (ok) earned += q.points;
    return { q, ok };
  });
  const score = total ? Math.round((100 * earned) / total) : 0;
  const passed = score >= course.settings.pass_mark;
  const mode = course.settings.show_answers;
  const show = mode === 'after_submit' || (mode === 'after_pass' && (passed || left === 0));

  return {
    score,
    passed,
    attempts_used: used,
    attempts_left: left,
    results: graded.map(({ q, ok }) => ({
      question_id: q.id,
      correct: ok,
      earned: ok ? q.points : 0,
      points: q.points,
      feedback: ok ? q.feedback_correct : q.feedback_incorrect,
      ...(show ? { correct_answer: correctAnswerOf(q), explanation: q.explanation || undefined } : {}),
    })),
    enrollment: null,
  };
}

/** Removes sent events from the stored queue (new events may have been added meanwhile). */
function dropSent(ws: string, courseId: string, batch: LearnEvent[]) {
  const sent = new Set(batch.map((e) => JSON.stringify(e)));

  writeQueue(
    ws,
    courseId,
    readQueue(ws, courseId).filter((e) => !sent.has(JSON.stringify(e)))
  );
}

// ---------------------------------------------------------------------------
// Pieces of the screen
// ---------------------------------------------------------------------------

function NoticeBox({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div role='status' className='chl-bad flex items-start gap-2 rounded-[10px] px-3 py-2 text-sm'>
      <span aria-hidden='true'>💡</span>
      <span className='min-w-0 flex-1'>{text}</span>
      <button type='button' aria-label='Dismiss' className='text-text-secondary hover:text-text-primary' onClick={onClose}>
        ×
      </button>
    </div>
  );
}

function Intro({ course, onStart, busy, narrow }: { course: PlayCourse; onStart: () => void; busy: boolean; narrow: boolean }) {
  const minutes = course.est_minutes || estimateMinutes(course);

  return (
    <div className='mx-auto w-full max-w-[760px]'>
      <div className='overflow-hidden rounded-[16px] border border-border-primary'>
        <div className={narrow ? 'h-32' : 'h-44'}>
          <CourseCover cover={course.cover} preset={course.preset} seed={course.id || course.title} />
        </div>
        <div className='p-5'>
          <h1 className='text-2xl font-semibold leading-tight'>{course.title.trim() || 'Untitled course'}</h1>
          {course.summary.trim() && (
            <p className='mt-2 text-[15px] leading-relaxed text-text-secondary'>
              <RichText text={course.summary} />
            </p>
          )}
          <div className='mt-3 flex flex-wrap gap-1.5'>
            <Chip>{plural(course.lessons.length, 'lesson')}</Chip>
            {minutes > 0 && <Chip>About {formatMinutes(minutes)}</Chip>}
            {course.quiz.enabled && <Chip tone='purple'>Final quiz · pass {course.settings.pass_mark}%</Chip>}
            {course.settings.sequential && <Chip>Lessons in order</Chip>}
            {course.settings.require_ack && <Chip>Confirm at the end</Chip>}
          </div>
          <div className='mt-5'>
            {course.lessons.length ? (
              <Button type='button' size='lg' loading={busy} onClick={onStart} data-testid='carehub-learning-start'>
                Start course
              </Button>
            ) : (
              <ChNote>This course has no lessons yet.</ChNote>
            )}
          </div>
        </div>
      </div>
      {course.lessons.length > 0 && (
        <div className='mt-5'>
          <div className='mb-2 text-sm font-semibold'>What’s inside</div>
          <ol className='flex flex-col gap-1.5'>
            {course.lessons.map((l, i) => (
              <li key={l.id} className='flex gap-2 text-sm text-text-secondary'>
                <span className='w-5 shrink-0 text-text-tertiary'>{i + 1}.</span>
                <span className='min-w-0 flex-1'>{l.title.trim() || `Lesson ${i + 1}`}</span>
              </li>
            ))}
            {course.quiz.enabled && (
              <li className='flex gap-2 text-sm text-text-secondary'>
                <span className='w-5 shrink-0' aria-hidden='true'>
                  📝
                </span>
                <span className='min-w-0 flex-1'>{course.quiz.title || 'Final quiz'}</span>
              </li>
            )}
          </ol>
        </div>
      )}
    </div>
  );
}

function Outline({
  course,
  view,
  narrow,
  open,
  setOpen,
  isDone,
  isLocked,
  preview,
  onOpen,
  doneCount,
  percent,
  quizPassed,
  quizLocked,
}: {
  course: PlayCourse;
  view: View;
  narrow: boolean;
  open: boolean;
  setOpen: (v: boolean) => void;
  isDone: (id: string) => boolean;
  isLocked: (index: number) => boolean;
  preview: boolean;
  onOpen: (v: View) => void;
  doneCount: number;
  percent: number;
  quizPassed: boolean;
  quizLocked: boolean;
}) {
  const summary = (
    <div>
      <div className='flex items-center gap-2 text-xs text-text-tertiary'>
        <span className='flex-1'>
          {doneCount} of {plural(course.lessons.length, 'lesson')} done
        </span>
        <span className='font-medium text-text-secondary'>{percent}%</span>
      </div>
      <ProgressBar percent={percent} className='mt-1.5' label='Course progress' />
    </div>
  );
  const list = (
    <nav aria-label='Lessons' className='flex flex-col gap-0.5'>
      {course.lessons.map((l, i) => {
        const done = isDone(l.id);
        const active = view.kind === 'lesson' && view.lessonId === l.id;
        const locked = !done && isLocked(i);
        const clickable = preview || !locked;

        return (
          <button
            key={l.id}
            type='button'
            disabled={!clickable}
            aria-current={active ? 'step' : undefined}
            title={locked ? (preview ? 'Locked for learners until earlier lessons are done' : 'Finish the earlier lessons first') : undefined}
            className={cn(
              'flex w-full items-start gap-2 rounded-[8px] px-2 py-2 text-left text-sm',
              active ? 'bg-fill-content-hover font-medium text-text-primary' : 'text-text-secondary',
              clickable ? 'hover:bg-fill-content-hover hover:text-text-primary' : 'cursor-not-allowed opacity-60'
            )}
            onClick={() => onOpen({ kind: 'lesson', lessonId: l.id })}
          >
            <span className={cn('w-5 shrink-0 text-center', done && 'chl-mark-right font-semibold')} aria-hidden='true'>
              {done ? '✓' : locked ? '🔒' : i + 1}
            </span>
            <span className='min-w-0 flex-1 break-words'>{l.title.trim() || `Lesson ${i + 1}`}</span>
            <span className='sr-only'>{done ? ' (done)' : locked ? ' (locked)' : ''}</span>
          </button>
        );
      })}
      {course.quiz.enabled && (
        <button
          type='button'
          disabled={quizLocked && !preview}
          aria-current={view.kind === 'quiz' ? 'step' : undefined}
          className={cn(
            'flex w-full items-start gap-2 rounded-[8px] px-2 py-2 text-left text-sm',
            view.kind === 'quiz' ? 'bg-fill-content-hover font-medium text-text-primary' : 'text-text-secondary',
            quizLocked && !preview ? 'cursor-not-allowed opacity-60' : 'hover:bg-fill-content-hover hover:text-text-primary'
          )}
          onClick={() => onOpen({ kind: 'quiz' })}
        >
          <span className={cn('w-5 shrink-0 text-center', quizPassed && 'chl-mark-right font-semibold')} aria-hidden='true'>
            {quizPassed ? '✓' : quizLocked ? '🔒' : '📝'}
          </span>
          <span className='min-w-0 flex-1'>{course.quiz.title || 'Final quiz'}</span>
        </button>
      )}
    </nav>
  );

  if (narrow) {
    return (
      <div className='rounded-[12px] border border-border-primary'>
        <button
          type='button'
          aria-expanded={open}
          className='flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium'
          onClick={() => setOpen(!open)}
        >
          <svg width='14' height='14' viewBox='0 0 16 16' fill='none' aria-hidden='true' focusable='false'>
            <path d='M2.5 4h11M2.5 8h11M2.5 12h11' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
          </svg>
          <span className='min-w-0 flex-1 truncate'>Lessons</span>
          <span className='text-xs text-text-tertiary'>
            {doneCount}/{course.lessons.length} · {percent}%
          </span>
          <svg
            width='12'
            height='12'
            viewBox='0 0 12 12'
            fill='none'
            aria-hidden='true'
            focusable='false'
            className={cn('shrink-0 text-text-tertiary transition-transform', open && 'rotate-180')}
          >
            <path d='M3 4.5l3 3 3-3' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' />
          </svg>
        </button>
        <div className='px-3 pb-2'>
          <ProgressBar percent={percent} label='Course progress' />
        </div>
        {open && <div className='border-t border-border-primary p-2'>{list}</div>}
      </div>
    );
  }

  return (
    <aside className='sticky top-4 w-[250px] shrink-0 self-start'>
      <div className='mb-3 px-2'>{summary}</div>
      {list}
    </aside>
  );
}

function splitAtGate(lesson: Lesson, done: Set<string>) {
  const visible: Lesson['blocks'] = [];
  const passed: string[] = [];

  for (let i = 0; i < lesson.blocks.length; i++) {
    const b = lesson.blocks[i];

    if (b.type === 'continue') {
      if (done.has(b.id)) {
        passed.push(b.id);
        visible.push(b);
        continue;
      }

      return { visible, gate: b, gateIndex: i };
    }

    visible.push(b);
  }

  return { visible, gate: null, gateIndex: -1 };
}

function LessonView({
  course,
  lesson,
  index,
  ctx,
  isDone,
  onGate,
  footer,
}: {
  course: PlayCourse;
  lesson: Lesson;
  index: number;
  ctx: BlockCtx;
  isDone: boolean;
  onGate: (gate: BlockOf<'continue'>) => void;
  footer: ReactNode;
}) {
  const { visible, gate, gateIndex } = splitAtGate(lesson, ctx.done);
  const waitingOn =
    gate && gate.require_complete
      ? lesson.blocks
          .slice(0, gateIndex)
          .filter((b) => (b.type === 'knowledge_check' && !ctx.kc[b.id]) || (b.type === 'scenario' && !ctx.done.has(b.id)))
      : [];

  return (
    <article>
      <div className='mb-1 text-xs text-text-tertiary'>
        Lesson {index + 1} of {course.lessons.length}
        {isDone ? ' · Done ✓' : ''}
      </div>
      <h1 className='mb-5 text-2xl font-semibold leading-tight'>{lesson.title.trim() || `Lesson ${index + 1}`}</h1>
      <div className='flex flex-col gap-5'>
        {visible.map((b) =>
          b.type === 'continue' ? (
            <div key={b.id} id={`chl-b-${b.id}`} className='scroll-mt-4' />
          ) : (
            <div key={b.id} id={`chl-b-${b.id}`} className='scroll-mt-4'>
              <BlockView block={b} ctx={ctx} />
            </div>
          )
        )}
        {!lesson.blocks.length && <div className='text-sm text-text-tertiary'>This lesson is empty.</div>}
      </div>
      {gate ? (
        <div className='mt-6 flex flex-col items-start gap-1.5'>
          <Button type='button' size='lg' disabled={waitingOn.length > 0} onClick={() => onGate(gate)}>
            {gate.label.trim() || 'Continue'} ↓
          </Button>
          {waitingOn.length > 0 && (
            <div className='text-xs text-text-tertiary'>
              {waitingOn.some((b) => b.type === 'scenario') ? 'Finish the practice above to continue.' : 'Answer the question above to continue.'}
            </div>
          )}
        </div>
      ) : (
        footer
      )}
    </article>
  );
}

function LessonFooter({
  requiredMs,
  getActive,
  isDone,
  busy,
  nextLabel,
  waitLabel,
  onComplete,
  onNext,
  onPrev,
  preview,
  onSkip,
}: {
  requiredMs: number;
  getActive: () => number;
  isDone: boolean;
  busy: boolean;
  nextLabel: string;
  waitLabel: string;
  onComplete: () => void;
  onNext: () => void;
  onPrev: (() => void) | null;
  preview: boolean;
  onSkip: () => void;
}) {
  const [, setTick] = useState(0);
  const remaining = isDone ? 0 : Math.max(0, requiredMs - getActive());
  const waiting = remaining > 1000;

  useEffect(() => {
    if (!waiting) return undefined;
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);

    return () => window.clearInterval(t);
  }, [waiting]);

  return (
    <div className='mt-8 border-t border-border-primary pt-4'>
      <div className='flex flex-wrap items-center gap-2'>
        {onPrev && (
          <Button type='button' variant='ghost' onClick={onPrev}>
            ← Previous
          </Button>
        )}
        <div className='flex-1' />
        {isDone ? (
          <Button type='button' size='lg' onClick={onNext}>
            {nextLabel}
          </Button>
        ) : (
          <Button type='button' size='lg' disabled={waiting} loading={busy} onClick={onComplete} data-testid='carehub-learning-next'>
            {waiting ? `${waitLabel} in ${formatClock(remaining / 1000)}` : nextLabel}
          </Button>
        )}
      </div>
      {!isDone && waiting && (
        <div className='mt-2 text-right text-xs text-text-tertiary'>
          Take your time — this lesson needs at least {formatClock(requiredMs / 1000)}. The timer runs while you’re active on this page.
          {preview && (
            <button type='button' className='ml-2 underline' onClick={onSkip}>
              Skip the wait (preview only)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function QuizView({
  course,
  questions,
  lock,
  attemptsLeft,
  passMark,
  busy,
  bestScore,
  onSubmit,
  onRetry,
  onContinue,
  onLessons,
}: {
  course: PlayCourse;
  questions: Question[];
  lock: string;
  attemptsLeft: number | null;
  passMark: number;
  busy: boolean;
  bestScore: number | null;
  onSubmit: (answers: Record<string, Answer>) => Promise<QuizResponse>;
  onRetry: () => void;
  onContinue: () => void;
  onLessons: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [result, setResult] = useState<QuizResponse | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const title = course.quiz.title || 'Final quiz';
  const unanswered = questions.filter((q) => !isAnswered(q, answers[q.id])).length;

  const header = (
    <>
      <div className='mb-1 text-xs text-text-tertiary'>Final quiz</div>
      <h1 className='text-2xl font-semibold leading-tight'>{title}</h1>
    </>
  );

  if (lock && !result) {
    const passed = /passed/i.test(lock);

    return (
      <div>
        {header}
        <div className='mt-4'>
          <ChNote tone={passed ? 'ok' : 'info'}>
            {lock}
            {passed && bestScore !== null ? ` Your score: ${bestScore}%.` : ''}
          </ChNote>
        </div>
        <div className='mt-4 flex flex-wrap gap-2'>
          {/lesson/i.test(lock) ? (
            <Button type='button' onClick={onLessons}>
              Go to the lessons
            </Button>
          ) : (
            <Button type='button' onClick={onContinue}>
              Continue
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (!questions.length) {
    return (
      <div>
        {header}
        <div className='mt-4'>
          <ChNote>This quiz has no questions yet.</ChNote>
        </div>
      </div>
    );
  }

  const submit = async () => {
    if (unanswered > 0 || sending) return;
    setSending(true);
    setError('');
    try {
      setResult(await onSubmit(answers));
      window.requestAnimationFrame(() => document.getElementById('chl-quiz-result')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    } catch (e) {
      setError(lErrorText(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      {header}
      <div className='mt-2 flex flex-wrap gap-1.5'>
        <Chip>{plural(questions.length, 'question')}</Chip>
        <Chip>Pass mark {passMark}%</Chip>
        <Chip>{attemptsLeft === null ? 'Unlimited attempts' : `${plural(attemptsLeft, 'attempt')} left`}</Chip>
      </div>
      {result && (
        <div id='chl-quiz-result' className={cn('mt-5 scroll-mt-4 rounded-[14px] px-4 py-4', result.passed ? 'chl-good' : 'chl-bad')} role='status'>
          <div className='text-3xl font-semibold'>{result.score}%</div>
          <div className='mt-1 text-sm font-medium'>
            {result.passed ? 'You passed! 🎉' : `Not this time — you need ${passMark}% to pass.`}
          </div>
          <div className='mt-0.5 text-xs text-text-secondary'>
            {result.attempts_left === null
              ? 'You can try as many times as you like.'
              : result.attempts_left === 0
                ? 'That was your last attempt.'
                : `${plural(result.attempts_left, 'attempt')} left.`}
          </div>
        </div>
      )}
      <div className='mt-5 flex flex-col gap-4'>
        {questions.map((q, i) => {
          const r = result ? result.results.find((x) => x.question_id === q.id) : undefined;

          return (
            <div
              key={q.id}
              className={cn('rounded-[12px] border p-4', !result ? 'border-border-primary' : r && r.correct ? 'chl-right' : 'chl-wrong')}
            >
              <QuestionView
                q={q}
                number={i + 1}
                name={`quiz-${q.id}`}
                value={answers[q.id]}
                disabled={sending || Boolean(result)}
                reveal={r ? r.correct_answer : undefined}
                onChange={(a) => setAnswers((m) => ({ ...m, [q.id]: a }))}
              />
              {result && (
                <div className='mt-3 text-sm'>
                  <div className='font-medium'>
                    {r && r.correct ? <span className='chl-mark-right'>✓ Correct</span> : <span className='chl-mark-wrong'>× Not quite</span>}
                    {r && <span className='ml-2 text-xs font-normal text-text-tertiary'>{`${r.earned}/${plural(r.points, 'point')}`}</span>}
                  </div>
                  {r && r.feedback.trim() && (
                    <div className='mt-1'>
                      <RichText text={r.feedback} />
                    </div>
                  )}
                  {r && !r.correct && r.correct_answer !== undefined && q.kind !== 'matching' && !isInteractKind(q.kind) && (
                    <div className='mt-1 text-text-secondary'>Correct answer: {answerText(q, r.correct_answer) || '—'}</div>
                  )}
                  {r && r.explanation && (
                    <div className='mt-1 text-text-secondary'>
                      <RichText text={r.explanation} />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {error && (
        <div className='mt-4'>
          <ChNote tone='error'>{error}</ChNote>
        </div>
      )}
      <div className='mt-5 flex flex-wrap items-center gap-3'>
        {!result ? (
          <>
            <Button type='button' size='lg' disabled={unanswered > 0} loading={sending} onClick={() => void submit()} data-testid='carehub-learning-submit-quiz'>
              Submit answers
            </Button>
            {unanswered > 0 && (
              <span className='text-xs text-text-tertiary'>
                {unanswered === questions.length ? 'Answer every question to submit.' : `${plural(unanswered, 'question')} left to answer.`}
              </span>
            )}
          </>
        ) : result.passed || result.attempts_left === 0 ? (
          <Button type='button' size='lg' onClick={onContinue}>
            {result.passed ? 'Continue' : 'See your results'}
          </Button>
        ) : (
          <>
            <Button type='button' size='lg' loading={busy} onClick={onRetry}>
              Try again
            </Button>
            <Button type='button' variant='ghost' onClick={onLessons}>
              Review the lessons
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function DoneView({
  course,
  status,
  awaitingAck,
  score,
  timeMs,
  completedMs,
  lessonsLeft,
  quizNeeded,
  quizOptional,
  busy,
  offline,
  onAck,
  onExit,
  exitLabel,
  onReview,
  onNext,
  onQuiz,
  preview,
}: {
  course: PlayCourse;
  status: LearnStatus;
  awaitingAck: boolean;
  score: number | null;
  timeMs: number;
  completedMs: number | null;
  lessonsLeft: number;
  quizNeeded: boolean;
  quizOptional: boolean;
  busy: boolean;
  offline: boolean;
  onAck: () => void;
  onExit?: () => void;
  exitLabel?: string;
  onReview: () => void;
  onNext: () => void;
  onQuiz: () => void;
  preview: boolean;
}) {
  const navigate = useNavigate();
  const [ticked, setTicked] = useState(false);
  const certificatesPath = `${LEARNING_PATH}/certificates`;
  const certificate = course.settings.certificate && (
    <div className='chl-box-success mt-4 rounded-[12px] px-4 py-3 text-sm'>
      <span aria-hidden='true'>🎓 </span>
      {preview ? (
        'People who finish get a certificate — they see a “View my certificate” link here.'
      ) : (
        <>
          You’ve earned a certificate.{' '}
          <a
            href={certificatesPath}
            className='font-semibold text-text-action underline underline-offset-2'
            onClick={(e) => {
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              navigate(certificatesPath);
            }}
          >
            View my certificate
          </a>
        </>
      )}
    </div>
  );
  const facts = (
    <div className='mt-3 flex flex-wrap gap-1.5'>
      {score !== null && course.quiz.enabled && <Chip tone={status === 'failed' ? 'red' : 'green'}>Score {score}%</Chip>}
      {timeMs >= 1000 && <Chip>Time spent: {formatDuration(timeMs)}</Chip>}
      {completedMs && <Chip>Finished {formatWhen(completedMs)}</Chip>}
    </div>
  );
  const exit = onExit && (
    <Button type='button' variant='outline' onClick={onExit}>
      {exitLabel || 'Back to My learning'}
    </Button>
  );

  if (awaitingAck) {
    return (
      <div className='mx-auto w-full max-w-[640px] rounded-[16px] border border-border-primary p-5'>
        <div className='text-3xl' aria-hidden='true'>
          ✍️
        </div>
        <h1 className='mt-2 text-xl font-semibold'>One last step</h1>
        <p className='mt-1 text-sm text-text-secondary'>Please confirm before this course is marked as finished.</p>
        <label className='mt-4 flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-border-primary px-3 py-3 text-sm'>
          <input type='checkbox' className='mt-0.5' checked={ticked} onChange={(e) => setTicked(e.target.checked)} />
          <span className='min-w-0 flex-1'>{course.settings.ack_text.trim() || 'I have read and understood this course.'}</span>
        </label>
        <div className='mt-4 flex flex-wrap gap-2'>
          <Button type='button' size='lg' disabled={!ticked} loading={busy} onClick={onAck} data-testid='carehub-learning-ack'>
            Confirm and finish
          </Button>
          <Button type='button' variant='ghost' onClick={onReview}>
            Review lessons
          </Button>
        </div>
      </div>
    );
  }

  if (status === 'completed' || status === 'passed') {
    return (
      <div className='mx-auto w-full max-w-[640px] rounded-[16px] border border-border-primary p-6 text-center'>
        <div className='text-5xl' aria-hidden='true'>
          🎉
        </div>
        <h1 className='mt-3 text-2xl font-semibold'>{status === 'passed' ? 'You passed!' : 'Course complete!'}</h1>
        <p className='mt-1 text-sm text-text-secondary'>Nice work finishing “{course.title.trim() || 'this course'}”.</p>
        <div className='flex justify-center'>{facts}</div>
        {certificate}
        <div className='mt-5 flex flex-wrap justify-center gap-2'>
          {exit}
          <Button type='button' variant='ghost' onClick={onReview}>
            Review lessons
          </Button>
          {quizOptional && (
            <Button type='button' variant='ghost' onClick={onQuiz}>
              Try the quiz
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className='mx-auto w-full max-w-[640px] rounded-[16px] border border-border-primary p-6 text-center'>
        <div className='text-5xl' aria-hidden='true'>
          🌱
        </div>
        <h1 className='mt-3 text-2xl font-semibold'>You didn’t pass this time</h1>
        <p className='mt-1 text-sm text-text-secondary'>
          There are no attempts left. Talk to the person who runs this course if you’d like another try.
        </p>
        <div className='flex justify-center'>{facts}</div>
        <div className='mt-5 flex flex-wrap justify-center gap-2'>
          {exit}
          <Button type='button' variant='ghost' onClick={onReview}>
            Review lessons
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className='mx-auto w-full max-w-[640px] rounded-[16px] border border-border-primary p-6'>
      <h1 className='text-xl font-semibold'>Almost there</h1>
      <p className='mt-1 text-sm text-text-secondary'>
        {lessonsLeft > 0
          ? `${plural(lessonsLeft, 'lesson')} still to finish.`
          : quizNeeded
            ? 'Pass the final quiz to finish this course.'
            : offline
              ? 'You’ve done everything. We’ll save it as soon as you’re back online.'
              : 'You’ve done everything — saving your progress…'}
      </p>
      <div className='mt-4 flex flex-wrap gap-2'>
        {lessonsLeft > 0 && (
          <Button type='button' onClick={onNext}>
            Continue
          </Button>
        )}
        {lessonsLeft === 0 && quizNeeded && (
          <Button type='button' onClick={onQuiz}>
            Take the final quiz
          </Button>
        )}
        {exit}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The player (state, time tracking, progress queue)
// ---------------------------------------------------------------------------

/** "← My learning" → "Back to My learning" (the arrow reads oddly on a big button). */
function doneExitLabel(label?: string) {
  if (!label) return undefined;
  const bare = label.replace(/^←\s*/, '');

  return /^back\b/i.test(bare) || bare === label ? bare : `Back to ${bare}`;
}

interface ShellProps extends PlayerProps {
  initialCourse: PlayCourse;
  initialEnrollment: Enrollment | null;
  onRestart?: () => void;
}

interface Tracker {
  /** What the time counts towards: a lesson id, "_quiz", or "" (nothing). */
  key: string;
  /** Active ms not yet sent as a heartbeat. */
  pending: number;
  lastTick: number;
  lastActivity: number;
  /** Active ms counted on this device since the player opened, per key. */
  totals: Record<string, number>;
}

const ACTIVE_WINDOW_MS = 60_000;
const BEAT_MS = 15_000;
const MAX_BATCH = 200;
const MAX_BEAT = 60_000;

function PlayerShell({
  workspaceId,
  courseId,
  preview,
  startLessonId,
  onExit,
  exitLabel,
  initialCourse,
  initialEnrollment,
  onRestart,
}: ShellProps) {
  const isPreview = Boolean(preview);
  const [course, setCourse] = useState<PlayCourse>(initialCourse);
  const [enr, setEnrState] = useState<Enrollment | null>(() =>
    isPreview && startLessonId ? previewEnrollment() : initialEnrollment
  );
  const [view, setView] = useState<View>(() =>
    initialView(initialCourse, isPreview && startLessonId ? previewEnrollment() : initialEnrollment, isPreview, startLessonId)
  );
  const [extraBlocks, setExtraBlocks] = useState<string[]>([]);
  const [extraKc, setExtraKc] = useState<Record<string, KcRecord>>({});
  const [extraLessons, setExtraLessons] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [quizRound, setQuizRound] = useState(0);
  const [quizPassedHere, setQuizPassedHere] = useState(false);
  const [quizMeta, setQuizMeta] = useState<{ used: number; left: number | null }>(() => ({
    used: initialCourse.quiz.attempts_used,
    left: initialCourse.quiz.attempts_left,
  }));
  const [pq, setPq] = useState<{ used: number; passed: boolean; best: number | null }>({ used: 0, passed: false, best: null });
  const [previewAck, setPreviewAck] = useState(false);
  const [scrollTarget, setScrollTarget] = useState('');
  const [, bump] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const enrRef = useRef<Enrollment | null>(enr);
  const positionRef = useRef<{ lesson_id: string; block_id: string } | null>(initialEnrollment?.progress.position ?? null);
  const baseActive = useRef<Record<string, number>>(
    Object.fromEntries(Object.entries(initialEnrollment?.progress.lessons || {}).map(([id, p]) => [id, p.active_ms]))
  );
  const tr = useRef<Tracker>({ key: '', pending: 0, lastTick: Date.now(), lastActivity: Date.now(), totals: {} });
  const playing = useRef<Set<string>>(new Set());
  const chain = useRef<Promise<FlushResult>>(Promise.resolve(FLUSH_OK));
  const retryTimer = useRef(0);
  const backoff = useRef(0);
  const rejectedLessons = useRef<Set<string>>(new Set());
  const mounted = useRef(true);
  const flushRef = useRef<() => Promise<FlushResult>>(() => Promise.resolve(FLUSH_OK));
  const emitRef = useRef<() => void>(() => undefined);

  const setEnr = useCallback((e: Enrollment | null) => {
    enrRef.current = e;
    setEnrState(e);
  }, []);

  const lessons = course.lessons;
  const serverLessons = enr?.progress.lessons || {};
  const lessonDone = (id: string) => Boolean(serverLessons[id]?.done) || extraLessons.includes(id);
  const completion = effectiveCompletion(course);
  const needLessons = completion !== 'pass_quiz';
  const needQuiz = course.quiz.enabled && completion !== 'all_lessons';

  // ---- queue + sending -------------------------------------------------------------------------

  const enqueue = (events: LearnEvent[]) => {
    if (isPreview || !events.length) return;
    writeQueue(workspaceId, courseId, [...readQueue(workspaceId, courseId), ...events]);
  };

  const emitHeartbeat = () => {
    const t = tr.current;

    if (!t.key || t.pending < 300) return;
    const events: LearnEvent[] = [];
    let left = Math.round(t.pending);

    while (left > 0) {
      const chunk = Math.min(MAX_BEAT, left);

      events.push({ kind: 'heartbeat', lesson_id: t.key, active_ms: chunk, ts_ms: Date.now() });
      left -= chunk;
    }

    t.pending = 0;
    enqueue(events);
  };

  const handleRejected = (list: FlushResult['rejected'], latest: Enrollment | null) => {
    if (!list.length || !mounted.current) return;
    const lessonIds = list.filter((r) => r.event.kind === 'lesson_complete').map((r) => r.event.lesson_id);

    if (lessonIds.length) {
      lessonIds.forEach((id) => {
        rejectedLessons.current.add(id);
        // Line the countdown up with the time the server has accepted.
        const accepted = latest?.progress.lessons[id]?.active_ms ?? enrRef.current?.progress.lessons[id]?.active_ms ?? 0;

        tr.current.totals[id] = Math.max(0, accepted - (baseActive.current[id] || 0));
      });
      setExtraLessons((xs) => xs.filter((x) => !lessonIds.includes(x)));
    }

    const first = list.find((r) => r.event.kind !== 'heartbeat' && r.reason.trim());

    if (first) setNotice(first.reason.trim());
  };

  const scheduleRetry = () => {
    if (retryTimer.current || !mounted.current) return;
    backoff.current = Math.min(60_000, backoff.current ? backoff.current * 2 : 2000);
    retryTimer.current = window.setTimeout(() => {
      retryTimer.current = 0;
      void flushRef.current();
    }, backoff.current);
  };

  const doFlush = async (): Promise<FlushResult> => {
    const rejected: FlushResult['rejected'] = [];
    let latest: Enrollment | null = null;

    for (let round = 0; round < 30; round++) {
      const queue = readQueue(workspaceId, courseId);

      if (!queue.length) break;
      const batch = queue.slice(0, MAX_BATCH);

      try {
        const res = await lapi.progress(workspaceId, courseId, batch, positionRef.current);

        dropSent(workspaceId, courseId, batch);
        backoff.current = 0;
        if (res.enrollment) latest = res.enrollment;
        res.rejected.forEach((r) => {
          const ev = batch[r.i];

          if (ev) rejected.push({ event: ev, reason: r.reason });
        });
      } catch (e) {
        const transient = isTransientError(e);

        if (transient) scheduleRetry();
        // A request the server refuses outright would block the queue forever — let it go.
        else dropSent(workspaceId, courseId, batch);
        if (mounted.current) {
          if (latest) setEnr(latest);
          setOffline(transient);
        }

        handleRejected(rejected, latest);
        return { ok: false, transient, error: transient ? OFFLINE_TEXT : lErrorText(e), rejected };
      }

      if (queue.length <= MAX_BATCH) break;
    }

    if (mounted.current) {
      if (latest) setEnr(latest);
      setOffline(false);
    }

    handleRejected(rejected, latest);
    return { ...FLUSH_OK, rejected };
  };

  const flush = (): Promise<FlushResult> => {
    if (isPreview) return Promise.resolve(FLUSH_OK);
    const next = chain.current.then(doFlush, doFlush);

    chain.current = next.catch(() => FLUSH_OK);
    return next;
  };

  flushRef.current = flush;
  emitRef.current = emitHeartbeat;

  // ---- time tracking ---------------------------------------------------------------------------

  const beginTracking = (v: View) => {
    const t = tr.current;
    const now = Date.now();

    t.key = v.kind === 'lesson' ? v.lessonId : v.kind === 'quiz' ? '_quiz' : '';
    t.pending = 0;
    t.lastTick = now;
    t.lastActivity = now;
    playing.current.clear();
    if (v.kind === 'lesson') {
      const first = course.lessons.find((l) => l.id === v.lessonId)?.blocks[0];

      positionRef.current = { lesson_id: v.lessonId, block_id: first ? first.id : '' };
      enqueue([{ kind: 'lesson_open', lesson_id: v.lessonId, ts_ms: now }]);
    } else if (v.kind === 'quiz') {
      enqueue([{ kind: 'lesson_open', lesson_id: '_quiz', ts_ms: now }]);
    }
  };

  const openView = (v: View) => {
    emitHeartbeat();
    beginTracking(v);
    setView(v);
    setNotice('');
    setOutlineOpen(false);
    void flush();
    window.requestAnimationFrame(() => topRef.current?.scrollIntoView({ block: 'start' }));
  };

  const getActive = (lessonId: string) => {
    const server = enrRef.current?.progress.lessons[lessonId]?.active_ms ?? 0;

    return Math.max(server, (baseActive.current[lessonId] || 0) + (tr.current.totals[lessonId] || 0));
  };

  // Activity listeners, the 1 s active-time clock, 15 s heartbeats, and "send now" moments.
  useEffect(() => {
    mounted.current = true;
    const t = tr.current;
    const mark = () => {
      t.lastActivity = Date.now();
    };
    const opts: AddEventListenerOptions = { passive: true, capture: true };
    const names = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];

    names.forEach((n) => window.addEventListener(n, mark, opts));
    document.addEventListener('scroll', mark, opts);

    const tick = window.setInterval(() => {
      const now = Date.now();
      const dt = Math.max(0, Math.min(2000, now - t.lastTick));

      t.lastTick = now;
      if (!t.key || document.visibilityState !== 'visible') return;
      const focused = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
      const inFrame = document.activeElement?.tagName === 'IFRAME';
      const active = playing.current.size > 0 || (focused && (inFrame || now - t.lastActivity <= ACTIVE_WINDOW_MS));

      if (!active) return;
      t.pending += dt;
      t.totals[t.key] = (t.totals[t.key] || 0) + dt;
    }, 1000);
    const beat = window.setInterval(() => {
      emitRef.current();
      void flushRef.current();
    }, BEAT_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') emitRef.current();
      void flushRef.current();
    };
    const onPageHide = () => {
      emitRef.current();
      void flushRef.current();
    };
    const onOnline = () => {
      backoff.current = 0;
      if (retryTimer.current) {
        window.clearTimeout(retryTimer.current);
        retryTimer.current = 0;
      }

      void flushRef.current();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('online', onOnline);

    return () => {
      names.forEach((n) => window.removeEventListener(n, mark, opts));
      document.removeEventListener('scroll', mark, opts);
      window.clearInterval(tick);
      window.clearInterval(beat);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('online', onOnline);
      if (retryTimer.current) {
        window.clearTimeout(retryTimer.current);
        retryTimer.current = 0;
      }

      emitRef.current();
      t.key = '';
      void flushRef.current();
      mounted.current = false;
    };
  }, []);

  // First open: send anything left from last time, start the clock, and go back to where the learner was.
  useEffect(() => {
    void flushRef.current();
    if (view.kind === 'lesson' || view.kind === 'quiz') beginTracking(view);
    const pos = initialEnrollment?.progress.position;

    if (!isPreview && view.kind === 'lesson' && pos && pos.lesson_id === view.lessonId && pos.block_id) {
      const lesson = course.lessons.find((l) => l.id === pos.lesson_id);

      positionRef.current = pos;
      if (lesson && lesson.blocks[0]?.id !== pos.block_id) setScrollTarget(pos.block_id);
    }
    // Runs once on open on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!scrollTarget) return undefined;
    const raf = window.requestAnimationFrame(() => {
      document.getElementById(`chl-b-${scrollTarget}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      setScrollTarget('');
    });

    return () => window.cancelAnimationFrame(raf);
  }, [scrollTarget]);

  // Lay out for the space we actually have (the Studio preview can be phone-sized inside a desktop window).
  useEffect(() => {
    const el = rootRef.current;

    if (!el) return undefined;
    const update = () => setNarrow(el.clientWidth > 0 && el.clientWidth < 720);

    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }

    const ro = new ResizeObserver(update);

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- derived state ---------------------------------------------------------------------------

  const doneBlocks = useMemo(() => {
    const s = new Set<string>(extraBlocks);

    Object.values(enr?.progress.lessons || {}).forEach((p) => p.blocks_done.forEach((b) => s.add(b)));
    return s;
  }, [enr, extraBlocks]);
  const kcMap = useMemo(() => ({ ...(enr?.progress.kc || {}), ...extraKc }), [enr, extraKc]);
  const doneIds = new Set(lessons.filter((l) => lessonDone(l.id)).map((l) => l.id));
  const doneCount = doneIds.size;
  const allLessonsDone = doneCount >= lessons.length;
  const quizPassed = isPreview
    ? pq.passed
    : quizPassedHere ||
      enr?.status === 'passed' ||
      /already passed/i.test(course.quiz.locked_reason || '') ||
      Boolean(course.quiz.enabled && enr && enr.attempts > 0 && enr.score !== null && enr.score >= course.settings.pass_mark);
  const outOfAttempts = quizMeta.left === 0 && !quizPassed;

  const quizLock = (() => {
    if (!course.quiz.enabled) return '';
    if (quizPassed) return 'You’ve already passed this quiz.';
    if (quizMeta.left === 0) return 'No attempts left.';
    if (isPreview) return '';
    if (completion === 'all_lessons_and_quiz' && course.settings.sequential && !allLessonsDone) return 'Finish all lessons first.';
    const reason = (course.quiz.locked_reason || '').trim();

    if (reason && /lesson/i.test(reason) && allLessonsDone) return '';
    if (reason && /attempt/i.test(reason) && quizMeta.left !== 0) return '';
    return reason;
  })();
  const quizLessonsLock = /lesson/i.test(quizLock);

  const isLocked = (index: number) => course.settings.sequential && lessons.slice(0, index).some((l) => !doneIds.has(l.id));

  const nextAfter = (fromId: string | null, done: Set<string>): View => {
    const idx = fromId ? lessons.findIndex((l) => l.id === fromId) : -1;
    const after = lessons.slice(idx + 1).find((l) => !done.has(l.id));

    if (after) return { kind: 'lesson', lessonId: after.id };
    const before = needLessons ? lessons.slice(0, Math.max(0, idx)).find((l) => !done.has(l.id)) : undefined;

    if (before) return { kind: 'lesson', lessonId: before.id };
    if (needQuiz && !quizPassed && quizMeta.left !== 0) return { kind: 'quiz' };
    return { kind: 'done' };
  };

  const afterQuiz = (): View => {
    if (outOfAttempts) return { kind: 'done' };
    const undone = needLessons ? lessons.find((l) => !doneIds.has(l.id)) : undefined;

    return undone ? { kind: 'lesson', lessonId: undone.id } : { kind: 'done' };
  };

  const firstLessonView = (): View => {
    const undone = lessons.find((l) => !doneIds.has(l.id)) || lessons[0];

    return undone ? { kind: 'lesson', lessonId: undone.id } : { kind: 'intro' };
  };

  const lessonOfBlock = (blockId: string) =>
    lessons.find((l) => l.blocks.some((b) => b.id === blockId))?.id || (view.kind === 'lesson' ? view.lessonId : '');

  const ctx: BlockCtx = {
    workspaceId,
    preview: isPreview,
    kc: kcMap,
    done: doneBlocks,
    onKcAnswer: (block, answer, correct) => {
      const now = Date.now();

      setExtraKc((m) => ({ ...m, [block.id]: { answer, correct, ms: now } }));
      enqueue([{ kind: 'kc_answer', lesson_id: lessonOfBlock(block.id), block_id: block.id, data: { answer, correct }, ts_ms: now }]);
    },
    onScenarioDone: (block) => {
      setExtraBlocks((s) => (s.includes(block.id) ? s : [...s, block.id]));
      enqueue([{ kind: 'block_complete', lesson_id: lessonOfBlock(block.id), block_id: block.id, ts_ms: Date.now() }]);
    },
    onMedia: (blockId, isPlaying) => {
      if (isPlaying) playing.current.add(blockId);
      else playing.current.delete(blockId);
      tr.current.lastActivity = Date.now();
    },
  };

  const liveProgress = localProgress(course, doneCount, quizPassed, quizMeta.left === 0, isPreview ? previewAck : Boolean(enr?.ack_ms));
  const status: LearnStatus = isPreview ? liveProgress.status : enr?.status || 'in_progress';
  const awaitingAck = isPreview ? liveProgress.awaiting_ack : Boolean(enr?.awaiting_ack);
  const percent = isPreview
    ? liveProgress.percent
    : enr && isFinished(enr)
      ? enr.status === 'failed'
        ? enr.percent
        : 100
      : Math.max(enr?.percent || 0, liveProgress.percent);
  const chip = statusInfo(isPreview ? { status, awaiting_ack: awaitingAck } : enr);

  // ---- actions ---------------------------------------------------------------------------------

  const start = async () => {
    if (isPreview) {
      const e = previewEnrollment();

      setEnr(e);
      openView(initialView(course, e, false));
      return;
    }

    setBusy(true);
    try {
      const e = await lapi.start(workspaceId, courseId);

      if (!mounted.current) return;
      if (!e) throw new Error('Couldn’t start this course. Please try again.');
      let c = course;

      if (e.version && course.version && e.version !== course.version) {
        const fresh = await lapi.play(workspaceId, courseId);

        if (!mounted.current) return;
        c = fresh.course;
        setCourse(c);
        setQuizMeta({ used: c.quiz.attempts_used, left: c.quiz.attempts_left });
      }

      setEnr(e);
      openView(initialView(c, e, false));
    } catch (err) {
      if (mounted.current) setNotice(lErrorText(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const passGate = (gate: BlockOf<'continue'>) => {
    if (view.kind !== 'lesson') return;
    const lessonId = view.lessonId;
    const lesson = lessons.find((l) => l.id === lessonId);
    const i = lesson ? lesson.blocks.findIndex((b) => b.id === gate.id) : -1;
    const nextBlock = lesson && i >= 0 ? lesson.blocks[i + 1] : undefined;

    setExtraBlocks((s) => (s.includes(gate.id) ? s : [...s, gate.id]));
    positionRef.current = { lesson_id: lessonId, block_id: gate.id };
    enqueue([{ kind: 'block_complete', lesson_id: lessonId, block_id: gate.id, ts_ms: Date.now() }]);
    void flush();
    if (nextBlock) setScrollTarget(nextBlock.id);
  };

  const completeLesson = async (lesson: Lesson) => {
    const done = new Set(doneIds);

    done.add(lesson.id);
    if (isPreview) {
      setExtraLessons((xs) => (xs.includes(lesson.id) ? xs : [...xs, lesson.id]));
      openView(nextAfter(lesson.id, done));
      return;
    }

    emitHeartbeat();
    rejectedLessons.current.delete(lesson.id);
    enqueue([{ kind: 'lesson_complete', lesson_id: lesson.id, ts_ms: Date.now() }]);
    setExtraLessons((xs) => (xs.includes(lesson.id) ? xs : [...xs, lesson.id]));
    setBusy(true);
    const res = await flush();

    if (!mounted.current) return;
    setBusy(false);
    const refused =
      rejectedLessons.current.has(lesson.id) ||
      res.rejected.some((r) => r.event.kind === 'lesson_complete' && r.event.lesson_id === lesson.id);

    if (refused) return; // handleRejected already explained why
    if (!res.ok && !res.transient) {
      setExtraLessons((xs) => xs.filter((x) => x !== lesson.id));
      setNotice(res.error);
      return;
    }

    openView(nextAfter(lesson.id, done));
    if (res.transient) setNotice(OFFLINE_TEXT);
  };

  const currentQuestions = useMemo(
    () => (isPreview ? pickPreviewQuestions(course.quiz, quizRound) : course.quiz.questions),
    [isPreview, course.quiz, quizRound]
  );

  const submitQuiz = async (answers: Record<string, Answer>): Promise<QuizResponse> => {
    if (isPreview) {
      const r = gradeLocally(course, currentQuestions, answers, pq.used);

      setPq((p) => ({ used: r.attempts_used, passed: p.passed || r.passed, best: Math.max(p.best ?? 0, r.score) }));
      setQuizMeta({ used: r.attempts_used, left: r.attempts_left });
      return r;
    }

    emitHeartbeat();
    await flush();
    const r = await lapi.quiz(workspaceId, courseId, answers);

    if (mounted.current) {
      setQuizMeta({ used: r.attempts_used, left: r.attempts_left });
      if (r.passed) setQuizPassedHere(true);
      if (r.enrollment) setEnr(r.enrollment);
    }

    return r;
  };

  const retryQuiz = async () => {
    if (isPreview) {
      setQuizRound((n) => n + 1);
      window.requestAnimationFrame(() => topRef.current?.scrollIntoView({ block: 'start' }));
      return;
    }

    setBusy(true);
    try {
      // Each attempt can have its own questions (question pools), so ask for this attempt's set.
      const fresh = await lapi.play(workspaceId, courseId);

      if (!mounted.current) return;
      setCourse(fresh.course);
      if (fresh.enrollment) setEnr(fresh.enrollment);
      setQuizMeta({ used: fresh.course.quiz.attempts_used, left: fresh.course.quiz.attempts_left });
      setQuizRound((n) => n + 1);
      window.requestAnimationFrame(() => topRef.current?.scrollIntoView({ block: 'start' }));
    } catch (err) {
      if (mounted.current) setNotice(lErrorText(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const acknowledge = async () => {
    if (isPreview) {
      setPreviewAck(true);
      return;
    }

    setBusy(true);
    try {
      await flush();
      const e = await lapi.ack(workspaceId, courseId);

      if (mounted.current && e) setEnr(e);
    } catch (err) {
      if (mounted.current) setNotice(lErrorText(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const skipWait = (lesson: Lesson) => {
    const t = tr.current;

    t.totals[lesson.id] = (t.totals[lesson.id] || 0) + requiredSeconds(course, lesson) * 1000;
    bump((n) => n + 1);
  };

  // ---- render ----------------------------------------------------------------------------------

  const currentIndex = view.kind === 'lesson' ? lessons.findIndex((l) => l.id === view.lessonId) : -1;
  const currentLesson = currentIndex >= 0 ? lessons[currentIndex] : undefined;
  const showIntro = view.kind === 'intro' || !enr;
  const localTime = Object.values(tr.current.totals).reduce((a, b) => a + b, 0);

  const lessonFooter = (lesson: Lesson, index: number) => {
    const isDone = doneIds.has(lesson.id);
    const done = new Set(doneIds);

    done.add(lesson.id);
    const target = isDone && lessons[index + 1] ? ({ kind: 'lesson', lessonId: lessons[index + 1].id } as View) : nextAfter(lesson.id, done);
    const nextLabel = target.kind === 'lesson' ? 'Next lesson →' : target.kind === 'quiz' ? 'Go to the quiz →' : 'Finish course ✓';
    const waitLabel = target.kind === 'lesson' ? 'Next lesson' : target.kind === 'quiz' ? 'Quiz' : 'Finish';
    const prev = index > 0 ? lessons[index - 1] : undefined;

    return (
      <LessonFooter
        key={lesson.id}
        requiredMs={requiredSeconds(course, lesson) * 1000}
        getActive={() => getActive(lesson.id)}
        isDone={isDone}
        busy={busy}
        nextLabel={nextLabel}
        waitLabel={waitLabel}
        onComplete={() => void completeLesson(lesson)}
        onNext={() => openView(target)}
        onPrev={prev && (isPreview || !isLocked(index - 1)) ? () => openView({ kind: 'lesson', lessonId: prev.id }) : null}
        preview={isPreview}
        onSkip={() => skipWait(lesson)}
      />
    );
  };

  return (
    <NarrowContext.Provider value={narrow}>
      <div ref={rootRef} className='w-full min-w-0' data-testid='carehub-learning-player'>
        <div ref={topRef} className='scroll-mt-4' />
        {isPreview && (
          <div className='chl-box-info mb-4 flex flex-wrap items-center gap-2 rounded-[10px] px-3 py-2 text-sm'>
            <span aria-hidden='true'>👀</span>
            <span className='min-w-0 flex-1'>
              Preview — this is what learners see. Nothing is saved; you can open any lesson and skip timers.
            </span>
            {onRestart && (
              <Button type='button' size='sm' variant='outline' onClick={onRestart}>
                Start over
              </Button>
            )}
          </div>
        )}
        {(onExit || !showIntro) && (
          <div className='mb-4 flex min-w-0 flex-wrap items-center gap-2'>
            {onExit && (
              <Button type='button' variant='ghost' size='sm' onClick={onExit}>
                {exitLabel || '← My learning'}
              </Button>
            )}
            <div className='min-w-0 flex-1 truncate text-sm text-text-secondary'>{showIntro ? '' : course.title.trim() || 'Untitled course'}</div>
            {!showIntro && <Chip tone={chip.tone}>{chip.label}</Chip>}
          </div>
        )}
        {notice && (
          <div className='mb-4'>
            <NoticeBox text={notice} onClose={() => setNotice('')} />
          </div>
        )}
        {showIntro ? (
          <Intro course={course} onStart={() => void start()} busy={busy} narrow={narrow} />
        ) : (
          <div className={cn('flex', narrow ? 'flex-col gap-4' : 'items-start gap-8')}>
            <Outline
              course={course}
              view={view}
              narrow={narrow}
              open={outlineOpen}
              setOpen={setOutlineOpen}
              isDone={(id) => doneIds.has(id)}
              isLocked={isLocked}
              preview={isPreview}
              onOpen={openView}
              doneCount={doneCount}
              percent={percent}
              quizPassed={quizPassed}
              quizLocked={quizLessonsLock}
            />
            <div className='min-w-0 flex-1'>
              {view.kind === 'lesson' &&
                (currentLesson ? (
                  <LessonView
                    key={currentLesson.id}
                    course={course}
                    lesson={currentLesson}
                    index={currentIndex}
                    ctx={ctx}
                    isDone={doneIds.has(currentLesson.id)}
                    onGate={passGate}
                    footer={lessonFooter(currentLesson, currentIndex)}
                  />
                ) : (
                  <div className='flex flex-col items-start gap-3'>
                    <ChNote>This lesson isn’t in the course any more.</ChNote>
                    <Button type='button' onClick={() => openView(firstLessonView())}>
                      Go to the lessons
                    </Button>
                  </div>
                ))}
              {view.kind === 'quiz' && (
                <QuizView
                  key={quizRound}
                  course={course}
                  questions={currentQuestions}
                  lock={quizLock}
                  attemptsLeft={quizMeta.left}
                  passMark={course.settings.pass_mark}
                  busy={busy}
                  bestScore={isPreview ? pq.best : enr?.score ?? null}
                  onSubmit={submitQuiz}
                  onRetry={() => void retryQuiz()}
                  onContinue={() => openView(afterQuiz())}
                  onLessons={() => openView(firstLessonView())}
                />
              )}
              {view.kind === 'done' && (
                <DoneView
                  course={course}
                  status={status}
                  awaitingAck={awaitingAck}
                  score={isPreview ? pq.best : enr?.score ?? null}
                  timeMs={isPreview ? localTime : enr?.time_ms || 0}
                  completedMs={isPreview ? null : enr?.completed_ms ?? null}
                  lessonsLeft={needLessons ? Math.max(0, lessons.length - doneCount) : 0}
                  quizNeeded={needQuiz && !quizPassed && !outOfAttempts}
                  quizOptional={course.quiz.enabled && !needQuiz && !quizPassed && quizMeta.left !== 0}
                  busy={busy}
                  offline={offline}
                  onAck={() => void acknowledge()}
                  onExit={onExit}
                  exitLabel={doneExitLabel(exitLabel)}
                  onReview={() => openView(lessons[0] ? { kind: 'lesson', lessonId: lessons[0].id } : { kind: 'intro' })}
                  onNext={() => openView(nextAfter(null, doneIds))}
                  onQuiz={() => openView({ kind: 'quiz' })}
                  preview={isPreview}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </NarrowContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export function CareHubLearningPlayer(props: PlayerProps) {
  const { workspaceId, courseId, preview, onExit, exitLabel } = props;
  const isPreview = Boolean(preview);
  const [restart, setRestart] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<{ course: PlayCourse; enrollment: Enrollment | null } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const previewCourse = useMemo(() => (preview ? asPlayCourse(preview, courseId) : null), [preview, courseId]);

  useEffect(() => {
    if (isPreview || !workspaceId) return undefined;
    let alive = true;

    setData(null);
    setError(null);
    lapi.play(workspaceId, courseId).then(
      (d) => {
        if (alive) setData(d);
      },
      (e: unknown) => {
        if (alive) setError(e || new Error('Something went wrong. Please try again.'));
      }
    );
    return () => {
      alive = false;
    };
  }, [workspaceId, courseId, isPreview, attempt]);

  if (previewCourse) {
    return (
      <PlayerShell
        key={`preview-${restart}`}
        {...props}
        initialCourse={previewCourse}
        initialEnrollment={null}
        onRestart={() => setRestart((n) => n + 1)}
      />
    );
  }

  if (error) {
    const notLive = learningNotLive(error);

    return (
      <div className='mx-auto flex w-full max-w-[640px] flex-col items-start gap-3'>
        <ChNote tone={notLive ? 'info' : 'error'}>{lErrorText(error)}</ChNote>
        <div className='flex flex-wrap gap-2'>
          <Button type='button' variant='outline' onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
          {onExit && (
            <Button type='button' variant='ghost' onClick={onExit}>
              {exitLabel || '← My learning'}
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (!data) return <div className='text-sm text-text-tertiary'>Loading…</div>;

  return <PlayerShell key={`${courseId}-${attempt}`} {...props} initialCourse={data.course} initialEnrollment={data.enrollment} />;
}

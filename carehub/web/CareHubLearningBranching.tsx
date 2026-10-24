// CareHub Learning (lane branching): side lessons and "After this lesson".
// A side lesson (`branch: true`) only opens from a button or link. People who don't pick it skip it; once someone
// opens it, they need to finish it. "After this lesson" (`then`): "" = the next lesson, a lesson id = go there,
// "choose" = no Next button (the person picks a button or link in the lesson). The server (carehub_learning.rs,
// hunks marked `// branching`) decides counting, locks and publish checks; the helpers here mirror it for the
// Player and the Studio preview. The shared learning files import this one, so it only *type*-imports from them.
import { useId } from 'react';

import { ChSelect } from './CareHubUi';

import type { Lesson } from './CareHubLearningApi';

export const CHOOSE = 'choose';
export const SIDE_LABEL = 'Side lesson';
export const SIDE_CHECK = 'Side lesson: only opened from a button or link';
export const SIDE_HELP = 'People who don’t pick it skip it. Once someone opens it, they need to finish it.';
export const AFTER_LABEL = 'After this lesson';
export const AFTER_NEXT = 'Next lesson';
export const AFTER_CHOOSE = 'Let them choose (no Next button)';
export const AFTER_GONE = 'A lesson that’s no longer in this course';
export const CHOOSE_TEXT = 'Pick an option above to continue.';

type Rec = Record<string, unknown>;

function rec(v: unknown): Rec {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {};
}

// ---------------------------------------------------------------------------
// The two lesson fields (saved only when set, so other courses keep identical JSON)
// ---------------------------------------------------------------------------

export interface BranchFields {
  /** true = side lesson; anything else = a normal lesson. */
  branch?: boolean;
  /** "" / missing = next lesson in order · a lesson id = go there · "choose" = no Next button. */
  then?: string;
}

export function isSide(lesson: BranchFields): boolean {
  return lesson.branch === true;
}

export function thenOf(lesson: BranchFields): string {
  return typeof lesson.then === 'string' ? lesson.then.trim() : '';
}

/** True when any lesson is a side lesson or has an "After this lesson" setting (else everything works as before). */
export function usesBranching(lessons: readonly BranchFields[]): boolean {
  return lessons.some((l) => isSide(l) || thenOf(l) !== '');
}

/** For normalizeLesson: the saved fields, only when set. */
export function readBranchFields(raw: unknown): BranchFields {
  const r = rec(raw);
  const out: BranchFields = {};
  const then = typeof r.then === 'string' ? r.then.trim() : '';

  if (r.branch === true) out.branch = true;
  if (then) out.then = then;
  return out;
}

/** The lesson with changed settings; a cleared setting is removed (never saved as false or ""). */
export function withBranchFields<T extends BranchFields>(lesson: T, patch: BranchFields): T {
  const next: T = { ...lesson, ...patch };

  if (next.branch !== true) delete next.branch;
  if (!thenOf(next)) delete next.then;
  return next;
}

/** Studio, deleting a lesson: "After this lesson" settings that pointed at it go back to "Next lesson". */
export function dropThensTo<T extends BranchFields>(lessons: T[], deletedId: string): T[] {
  if (!deletedId || !lessons.some((l) => thenOf(l) === deletedId)) return lessons;
  return lessons.map((l) => (thenOf(l) === deletedId ? withBranchFields(l, { then: '' }) : l));
}

// ---------------------------------------------------------------------------
// Where lessons lead (the same reading as the server and blocks3's link check)
// ---------------------------------------------------------------------------

const TEXT_LINK_RE = /\]\(#(lesson|block)-([A-Za-z0-9_-]+)\)/g;

/**
 * For each lesson (by index), the other lessons it leads to: lesson buttons, text links to a lesson or to one of its
 * blocks, and "After this lesson". An id used twice means its first lesson.
 */
export function branchEdges(lessons: readonly Lesson[]): number[][] {
  const byLesson = new Map<string, number>();
  const byBlock = new Map<string, number>();

  lessons.forEach((l, i) => {
    if (l.id && !byLesson.has(l.id)) byLesson.set(l.id, i);
    l.blocks.forEach((b) => {
      if (b.id && !byBlock.has(b.id)) byBlock.set(b.id, i);
    });
  });
  return lessons.map((l, i) => {
    const to: number[] = [];
    const add = (j: number | undefined) => {
      if (j !== undefined && j !== i && !to.includes(j)) to.push(j);
    };

    l.blocks.forEach((b) => {
      const r = rec(b);

      if (r.type === 'buttons' && Array.isArray(r.items)) {
        r.items.forEach((item) => {
          const t = rec(rec(item).target);

          if (t.kind === 'lesson' && typeof t.lesson_id === 'string') add(byLesson.get(t.lesson_id.trim()));
        });
      }

      for (const m of JSON.stringify(b).matchAll(TEXT_LINK_RE)) add((m[1] === 'lesson' ? byLesson : byBlock).get(m[2]));
    });
    const then = thenOf(l);

    if (then !== CHOOSE) add(byLesson.get(then));
    return to;
  });
}

/** The lesson "After this lesson" goes to (index), or -1 for "Next lesson", "choose" and lessons no longer there. */
export function thenIndex(lessons: readonly Lesson[], index: number): number {
  const lesson = lessons[index];
  const then = lesson ? thenOf(lesson) : '';

  if (!then || then === CHOOSE) return -1;
  return lessons.findIndex((l, i) => i !== index && l.id === then);
}

// ---------------------------------------------------------------------------
// One person's progress: what counts, what's locked, where Next and Previous go
// ---------------------------------------------------------------------------

/** What the Player knows: finished lessons, and opened ones (a progress entry on the server, or opened here). */
export interface BranchProgress {
  done: (lessonId: string) => boolean;
  opened: (lessonId: string) => boolean;
}

/** Counts for finishing and percent: every lesson that isn't a side lesson, plus side lessons the person opened. */
export function counts(lesson: Lesson, p: BranchProgress): boolean {
  return !isSide(lesson) || p.opened(lesson.id) || p.done(lesson.id);
}

/**
 * In an in-order course, which lessons are locked (by index; nothing is locked otherwise). The server's rule: a lesson
 * that isn't a side lesson needs every counted lesson above it done. A side lesson never waits for the lessons above
 * it: it's open once it's opened (or done), or when an open lesson leads to it (followed through side lessons).
 */
export function branchLocks(lessons: readonly Lesson[], sequential: boolean, p: BranchProgress): boolean[] {
  if (!sequential) return lessons.map(() => false);
  const open = lessons.map(() => false);
  const queue: number[] = [];
  let aboveDone = true;

  lessons.forEach((l, i) => {
    const done = p.done(l.id);

    if (isSide(l) ? done || p.opened(l.id) : done || aboveDone) {
      open[i] = true;
      queue.push(i);
    }

    if (counts(l, p) && !done) aboveDone = false;
  });
  const edges = branchEdges(lessons);

  for (let u = queue.pop(); u !== undefined; u = queue.pop()) {
    for (const v of edges[u] || []) {
      const target = lessons[v];

      if (target && !open[v] && isSide(target)) {
        open[v] = true;
        queue.push(v);
      }
    }
  }

  return open.map((o) => !o);
}

/**
 * Where Next goes after finishing lesson `fromId` (null = from the start or the results page), with `p.done` already
 * counting it: a lesson id, CHOOSE (no Next button), or "" when no lesson is left (the quiz or the end, as before).
 * "After this lesson" wins; when that lesson is done, the usual rule runs from it once (never a chain). The usual
 * rule: the first unfinished lesson after it that isn't a side lesson; when that's locked or missing, the first
 * unfinished counted lesson (only when lessons are needed). Never a locked lesson.
 */
export function branchNext(
  lessons: readonly Lesson[],
  fromId: string | null,
  p: BranchProgress,
  locked: (index: number) => boolean,
  needLessons: boolean
): string {
  const idx = fromId === null ? -1 : lessons.findIndex((l) => l.id === fromId);
  const from = lessons[idx];
  let base = idx;

  if (from) {
    if (thenOf(from) === CHOOSE) return CHOOSE;
    const t = thenIndex(lessons, idx);
    const target = lessons[t];

    if (target && p.done(target.id)) base = t;
    else if (target && !locked(t)) return target.id;
  }

  const after = lessons.findIndex((l, i) => i > base && !isSide(l) && !p.done(l.id));

  if (after >= 0 && !locked(after)) return lessons[after].id;
  if (!needLessons) return '';
  const first = lessons.findIndex((l, i) => counts(l, p) && !p.done(l.id) && !locked(i));

  return first >= 0 ? lessons[first].id : '';
}

/**
 * Next on a lesson that's already done: its "After this lesson" lesson, else the next lesson that isn't a side lesson
 * (done or not) — when that's locked or missing, the same as after finishing it. CHOOSE = no Next button.
 */
export function branchBrowseNext(
  lessons: readonly Lesson[],
  index: number,
  p: BranchProgress,
  locked: (index: number) => boolean,
  needLessons: boolean
): string {
  const lesson = lessons[index];

  if (!lesson) return '';
  if (thenOf(lesson) === CHOOSE) return CHOOSE;
  const t = thenIndex(lessons, index);

  if (t >= 0 && !locked(t)) return lessons[t].id;
  const after = lessons.findIndex((l, i) => i > index && !isSide(l));

  if (after >= 0 && !locked(after)) return lessons[after].id;
  return branchNext(lessons, lesson.id, p, locked, needLessons);
}

/**
 * Previous (index, -1 = none): on a side lesson, the lesson it was opened from during this visit (`cameFrom`);
 * otherwise the nearest earlier lesson that isn't a side lesson.
 */
export function branchPrev(lessons: readonly Lesson[], index: number, cameFrom?: string): number {
  const lesson = lessons[index];

  if (lesson && isSide(lesson) && cameFrom) {
    const from = lessons.findIndex((l) => l.id === cameFrom);

    if (from >= 0 && from !== index) return from;
  }

  for (let i = index - 1; i >= 0; i -= 1) {
    if (!isSide(lessons[i])) return i;
  }

  return -1;
}

// ---------------------------------------------------------------------------
// What the Player shows: outline rows, "Lesson k of M", counts
// ---------------------------------------------------------------------------

export interface ShownLesson {
  lesson: Lesson;
  /** Position in course.lessons. */
  index: number;
  /** 1..M among the lessons that aren't side lessons; 0 for a side lesson. */
  number: number;
  side: boolean;
}

/** Outline and search: every lesson that isn't a side lesson, plus side lessons opened or done (and the open one). */
export function shownLessons(lessons: readonly Lesson[], p: BranchProgress, currentId = ''): ShownLesson[] {
  const rows: ShownLesson[] = [];
  let n = 0;

  lessons.forEach((lesson, index) => {
    const side = isSide(lesson);

    if (!side) n += 1;
    if (side && !p.opened(lesson.id) && !p.done(lesson.id) && lesson.id !== currentId) return;
    rows.push({ lesson, index, number: side ? 0 : n, side });
  });
  return rows;
}

/** How many lessons aren't side lessons (the intro's "N lessons" and "Lesson k of M"). */
export function mainCount(lessons: readonly Lesson[]): number {
  return lessons.filter((l) => !isSide(l)).length;
}

/** "Lesson 2 of 5" among the lessons that aren't side lessons, or "Side lesson". */
export function lessonPlace(lessons: readonly Lesson[], index: number): string {
  const lesson = lessons[index];

  if (!lesson) return '';
  if (isSide(lesson)) return SIDE_LABEL;
  return `Lesson ${lessons.slice(0, index + 1).filter((l) => !isSide(l)).length} of ${mainCount(lessons)}`;
}

// ---------------------------------------------------------------------------
// Publish checks (validateContent; the same words and order as the server, after the link check)
// ---------------------------------------------------------------------------

export function branchProblems(
  c: { lessons: readonly Lesson[] },
  out: string[],
  lessonName: (index: number, title: string) => string
) {
  const lessons = c.lessons;

  if (!usesBranching(lessons)) return;
  const allSide = lessons.length > 0 && lessons.every((l) => isSide(l));

  if (allSide) out.push('At least one lesson must not be a side lesson.');
  const edges = branchEdges(lessons);
  const seen = lessons.map((l) => !isSide(l));
  const queue = lessons.flatMap((l, i) => (isSide(l) ? [] : [i]));

  for (let u = queue.pop(); u !== undefined; u = queue.pop()) {
    for (const v of edges[u] || []) {
      if (v < seen.length && !seen[v]) {
        seen[v] = true;
        queue.push(v);
      }
    }
  }

  lessons.forEach((l, i) => {
    const name = lessonName(i, l.title);
    const then = thenOf(l);

    if (!allSide && isSide(l) && !seen[i]) {
      out.push(`Nothing leads to ${name}. It's a side lesson, so add a button or link to it in another lesson.`);
    }

    if (then && then !== CHOOSE && !lessons.some((x, j) => j !== i && x.id === then)) {
      out.push(`"After this lesson" in ${name} must go to another lesson in this course.`);
    }

    if (then === CHOOSE && !(edges[i] || []).length) {
      out.push(`${name} lets people choose, so it needs a button or link to another lesson.`);
    }
  });
}

// ---------------------------------------------------------------------------
// Small pieces of UI
// ---------------------------------------------------------------------------

/** Studio, under the lesson title: "Side lesson" and "After this lesson". */
export function LessonBranchSettings({
  lesson,
  lessons,
  onChange,
}: {
  lesson: Lesson;
  lessons: readonly Lesson[];
  onChange: (patch: BranchFields) => void;
}) {
  const id = useId();
  const then = thenOf(lesson);
  const known = then === '' || then === CHOOSE || lessons.some((l) => l.id === then && l.id !== lesson.id);
  const options = [
    { value: '', label: AFTER_NEXT },
    ...lessons.flatMap((l, i) => (l.id === lesson.id ? [] : [{ value: l.id, label: `${i + 1}. ${l.title.trim() || 'Untitled lesson'}` }])),
    { value: CHOOSE, label: AFTER_CHOOSE },
    ...(known ? [] : [{ value: then, label: AFTER_GONE }]),
  ];

  return (
    <div className='grid grid-cols-1 gap-3 sm:grid-cols-2' data-testid='carehub-learning-branch-settings'>
      <div className='min-w-0'>
        <label className='flex cursor-pointer items-start gap-2 text-sm'>
          <input
            type='checkbox'
            className='mt-[3px] shrink-0'
            checked={isSide(lesson)}
            aria-describedby={`${id}-help`}
            onChange={(e) => onChange({ branch: e.target.checked })}
          />
          <span className='min-w-0 flex-1'>{SIDE_CHECK}</span>
        </label>
        <p id={`${id}-help`} className='mt-0.5 pl-6 text-xs text-text-tertiary'>
          {SIDE_HELP}
        </p>
      </div>
      <label className='flex min-w-0 flex-col gap-1'>
        <span className='text-xs font-medium text-text-secondary'>{AFTER_LABEL}</span>
        <ChSelect
          value={then}
          options={options}
          onChange={(v) => onChange({ then: v })}
          className='w-full min-w-0'
          ariaLabel={AFTER_LABEL}
        />
      </label>
    </div>
  );
}

/** Player outline: the mark in front of a side lesson (drawn, so it doesn't depend on the font). */
export function SideMark() {
  return (
    <svg width='12' height='12' viewBox='0 0 12 12' fill='none' aria-hidden='true' focusable='false' className='mx-auto mt-1 block'>
      <path
        d='M3 1.5V6a2 2 0 0 0 2 2h5M7.5 5.5 10 8l-2.5 2.5'
        stroke='currentColor'
        strokeWidth='1.4'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  );
}

/** Player and Studio outlines: the "Side lesson" note under the title (screen readers hear "(side lesson)"). */
export function SideLessonNote() {
  return (
    <>
      <span className='block text-xs font-normal not-italic text-text-tertiary' aria-hidden='true'>
        {SIDE_LABEL}
      </span>
      <span className='sr-only'> (side lesson)</span>
    </>
  );
}

/** Player footer of a "choose" lesson, where the Next button would be. */
export function ChooseNote() {
  return (
    <span className='text-sm text-text-secondary' data-testid='carehub-learning-choose'>
      {CHOOSE_TEXT}
    </span>
  );
}

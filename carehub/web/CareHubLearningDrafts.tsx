// CareHub Learning: share a course draft for review by link, and comments on a draft (contract P5-DRAFTS).
// The review page (/learning/review/:token) works for every member who has the link. Builders get the Studio
// pieces: "Share for review", "Comments (n)", the open-comment count under a block, and the comments window.
// Comments are plain text (line breaks kept). The server checks every rule; these screens only mirror them.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ComponentType, ReactNode, RefObject } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { CH_API, chCall, formatWhen } from './CareHubCore';
import { correctAnswerOf, LEARNING_PATH, learningNotLive, lErrorText, normalizeContent, plural } from './CareHubLearningApi';
import { focusSoon } from './CareHubLearningA11y';
import { BlockView, Chip, NarrowContext, QuestionView, RichText } from './CareHubLearningBlocks';
import { CareHubLearningPlayer } from './CareHubLearningPlayer';
import { csvDate, downloadCsv, slug } from './CareHubLearningReports';
import { BLOCK_INFO } from './CareHubLearningStudioBlocks';
import { CareHubModal, ChNote, ChSelect, chInputClass } from './CareHubUi';

import type { Block, BlockOf, Content, Quiz } from './CareHubLearningApi';
import type { BlockCtx } from './CareHubLearningBlocks';
import type { CsvValue } from './CareHubLearningReports';

// ---------------------------------------------------------------------------
// Types and server calls
// ---------------------------------------------------------------------------

export interface DraftComment {
  id: string;
  /** "" for the first comment of a thread. */
  parent_id: string;
  /** Both "" = a comment on the whole course. */
  lesson_id: string;
  block_id: string;
  text: string;
  name: string;
  created_ms: number;
  mine: boolean;
  done: boolean;
  done_ms: number | null;
  done_by_name: string;
}

export interface DraftThread extends DraftComment {
  replies: DraftComment[];
}

export interface ReviewLink {
  token: string;
  created_ms: number;
  created_by_name: string;
}

export interface ReviewDraft {
  course_id: string;
  title: string;
  status: string;
  draft: Content;
  updated_ms: number;
  shared_by_name: string;
  can_build: boolean;
}

/** The server counts characters; the box counts a little more strictly (an emoji counts as two), so it never goes over. */
export const COMMENT_MAX = 2000;

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const enc = encodeURIComponent;
const noop = () => undefined;

/** Where a course's comments live: Studio (builders) or a review link (anyone in the workspace who has it). */
export const studioAt = (ws: string, courseId: string) => `${CH_API}/${ws}/learning/studio/${enc(courseId)}`;
export const reviewAt = (ws: string, token: string) => `${CH_API}/${ws}/learning/review/${enc(token)}`;
/** The address to send reviewers. It only works in this workspace. */
export const reviewUrl = (token: string) => `${window.location.origin}${LEARNING_PATH}/review/${token}`;

function toComment(v: unknown): DraftComment {
  const o = rec(v);

  return {
    id: str(o.id),
    parent_id: str(o.parent_id),
    lesson_id: str(o.lesson_id),
    block_id: str(o.block_id),
    text: str(o.text),
    name: str(o.name) || 'Someone',
    created_ms: num(o.created_ms),
    mine: o.mine === true,
    done: o.done === true,
    done_ms: typeof o.done_ms === 'number' ? o.done_ms : null,
    done_by_name: str(o.done_by_name),
  };
}

const toThread = (v: unknown): DraftThread => ({ ...toComment(v), replies: list(rec(v).replies).map(toComment) });

function toLink(v: unknown): ReviewLink | null {
  const o = rec(v);
  const token = str(o.token);

  return token ? { token, created_ms: num(o.created_ms), created_by_name: str(o.created_by_name) } : null;
}

function toReview(v: unknown): ReviewDraft {
  const o = rec(v);

  return {
    course_id: str(o.course_id),
    title: str(o.title) || 'Untitled course',
    status: str(o.status),
    draft: normalizeContent(o.draft),
    updated_ms: num(o.updated_ms),
    shared_by_name: str(o.shared_by_name),
    can_build: o.can_build === true,
  };
}

export const draftsApi = {
  link: (ws: string, id: string) => chCall<unknown>('get', `${studioAt(ws, id)}/review-link`).then((d) => toLink(rec(d).link)),
  makeLink: (ws: string, id: string) => chCall<unknown>('post', `${studioAt(ws, id)}/review-link`).then((d) => toLink(rec(d).link)),
  stopLink: (ws: string, id: string) => chCall<unknown>('delete', `${studioAt(ws, id)}/review-link`),
  review: (ws: string, token: string) => chCall<unknown>('get', reviewAt(ws, token)).then(toReview),
  comments: (at: string) =>
    chCall<unknown>('get', `${at}/comments`).then((d) => ({ threads: list(rec(d).comments).map(toThread), canBuild: rec(d).can_build === true })),
  add: (at: string, body: { text: string; lesson_id?: string; block_id?: string; parent_id?: string }) =>
    chCall<unknown>('post', `${at}/comments`, body).then((d) => toComment(rec(d).comment)),
  setDone: (at: string, cid: string, done: boolean) => chCall<unknown>('post', `${at}/comments/${enc(cid)}/done`, { done }),
  remove: (at: string, cid: string) => chCall<unknown>('delete', `${at}/comments/${enc(cid)}`),
};

export type DraftComments = ReturnType<typeof useDraftComments>;

/** A course's comment threads. `reload` asks again; only the newest answer is kept. */
export function useDraftComments(at: string, enabled = true) {
  const [threads, setThreads] = useState<DraftThread[] | null>(null);
  const [canBuild, setCanBuild] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const n = ++seq.current;

    try {
      const r = await draftsApi.comments(at);

      if (n !== seq.current) return;
      setThreads(r.threads);
      setCanBuild(r.canBuild);
      setError(null);
    } catch (e) {
      if (n === seq.current) setError(e);
    }
  }, [at]);

  useEffect(() => {
    if (enabled) void reload();
    return () => {
      seq.current += 1;
    };
  }, [reload, enabled]);

  return { threads, canBuild, error, reload };
}

export interface CommentActs {
  canBuild: boolean;
  /** Each returns the words to show when it didn't work, or "" when it did. */
  add: (text: string, lessonId: string, blockId: string) => Promise<string>;
  reply: (thread: DraftThread, text: string) => Promise<string>;
  setDone: (thread: DraftThread, done: boolean) => Promise<string>;
  remove: (c: DraftComment) => Promise<string>;
}

/** What people can do with comments. After each change (or a refusal) the list is fetched again. */
export function useCommentActs(at: string, canBuild: boolean, reload: () => Promise<void>): CommentActs {
  return useMemo(() => {
    const run = async (call: () => Promise<unknown>) => {
      try {
        await call();
        await reload();
        return '';
      } catch (e) {
        void reload();
        return lErrorText(e);
      }
    };

    return {
      canBuild,
      add: (text, lessonId, blockId) => run(() => draftsApi.add(at, { text, lesson_id: lessonId, block_id: blockId })),
      reply: (t, text) => run(() => draftsApi.add(at, { text, parent_id: t.id })),
      setDone: (t, done) => run(() => draftsApi.setDone(at, t.id, done)),
      remove: (c) => run(() => draftsApi.remove(at, c.id)),
    };
  }, [at, canBuild, reload]);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export interface PlacedThreads {
  /** Comments on the whole course. */
  course: DraftThread[];
  /** Block id → its threads, for blocks that are in the draft. */
  blocks: Map<string, DraftThread[]>;
  /** Block id → the lesson it is in now (blocks are matched by id, so moving a block keeps its comments). */
  lessonOf: Map<string, string>;
  /** Threads whose block is gone. */
  removed: DraftThread[];
}

export function placeThreads(draft: Content | null | undefined, threads: DraftThread[]): PlacedThreads {
  const lessonOf = new Map<string, string>();

  for (const l of draft?.lessons || []) for (const b of l.blocks) if (!lessonOf.has(b.id)) lessonOf.set(b.id, l.id);
  const placed: PlacedThreads = { course: [], blocks: new Map(), lessonOf, removed: [] };

  for (const t of threads) {
    if (!t.block_id) placed.course.push(t);
    else if (!lessonOf.has(t.block_id)) placed.removed.push(t);
    else placed.blocks.set(t.block_id, [...(placed.blocks.get(t.block_id) || []), t]);
  }
  return placed;
}

const INFO = BLOCK_INFO as Partial<Record<string, { emoji: string; label: string }>>;

/** "📝 Paragraph": a block's kind, as Studio names it. */
export function blockLabel(b: Block) {
  const info = INFO[b.type] || { emoji: '▦', label: 'Block' };

  return `${info.emoji} ${info.label}`;
}

/** The first words of a block, so people can tell which one a comment is about. */
export function blockExcerpt(b: Block) {
  const o = rec(b);
  const sources = [o, rec(o.question), rec(list(o.items)[0]), rec(list(o.cards)[0]), rec(list(o.steps)[0])];
  const keys = ['text', 'title', 'prompt', 'label', 'caption', 'alt', 'name', 'front', 'intro', 'url'];
  let found = typeof list(o.items)[0] === 'string' ? str(list(o.items)[0]) : '';

  for (const src of sources) {
    for (const k of keys) {
      if (!found.trim()) found = str(src[k]);
    }
  }
  const plain = found
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return plain.length > 80 ? `${plain.slice(0, 79)}…` : plain;
}

/**
 * "Download comments (CSV)": every comment and reply (open and done), one row each, in course order — the whole course,
 * then each lesson's blocks, then blocks that were removed. A reply has the Type "Reply" and its thread's status.
 */
export function downloadComments(draft: Content, placed: PlacedThreads) {
  const rows: CsvValue[][] = [];
  const lessonName = new Map(draft.lessons.map((l, i) => [l.id, `${i + 1}. ${l.title.trim() || 'Untitled lesson'}`]));
  const add = (lesson: string, block: string, ts: DraftThread[]) => {
    for (const t of ts) {
      const status = t.done ? 'Done' : 'Open';

      rows.push([lesson, block, 'Comment', t.text, t.name, csvDate(t.created_ms), status]);
      for (const r of t.replies) rows.push([lesson, block, 'Reply', r.text, r.name, csvDate(r.created_ms), status]);
    }
  };

  add('Whole course', '', placed.course);
  for (const l of draft.lessons) {
    for (const b of l.blocks) {
      if (placed.lessonOf.get(b.id) !== l.id) continue;
      const words = blockExcerpt(b);

      add(lessonName.get(l.id) || '', `${INFO[b.type]?.label || 'Block'}${words ? ` · ${words}` : ''}`, placed.blocks.get(b.id) || []);
    }
  }

  for (const t of placed.removed) add(lessonName.get(t.lesson_id) || '', 'A block that was removed', [t]);
  downloadCsv(`${slug(draft.title, 'course')}-comments`, ['Lesson', 'Block', 'Type', 'Comment', 'Written by', 'Date', 'Status'], rows);
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');

      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');

      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Put keyboard focus back on the button (or the first button inside) once the box it opened has closed. */
function refocus(ref: RefObject<HTMLElement | null>) {
  window.setTimeout(() => {
    const el = ref.current;

    (el && !el.matches('button') ? el.querySelector<HTMLElement>('button') : el)?.focus();
  }, 0);
}

function useNarrowWidth(ref: RefObject<HTMLElement | null>, below: number) {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < below);

  useEffect(() => {
    const el = ref.current;

    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const check = () => setNarrow(el.clientWidth > 0 && el.clientWidth < below);
    const ro = new ResizeObserver(check);

    ro.observe(el);
    check();
    return () => ro.disconnect();
  }, [ref, below]);

  return narrow;
}

// ---------------------------------------------------------------------------
// Comment threads (the review page and the Studio window share these)
// ---------------------------------------------------------------------------

const quietButton =
  'rounded-[6px] px-1.5 py-0.5 text-xs font-medium text-text-secondary hover:bg-fill-content-hover hover:text-text-primary disabled:opacity-50';

function Who({ c }: { c: DraftComment }) {
  return (
    <div className='flex flex-wrap items-baseline gap-x-2 text-xs'>
      <span className='font-semibold text-text-primary'>{c.name}</span>
      <span className='text-text-tertiary'>{formatWhen(c.created_ms)}</span>
    </div>
  );
}

function CommentText({ text }: { text: string }) {
  return <div className='min-w-0 whitespace-pre-wrap break-words text-sm leading-relaxed'>{text}</div>;
}

export function CommentBox({
  word,
  send,
  onClose,
}: {
  word: 'Comment' | 'Reply';
  send: (text: string) => Promise<string>;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const left = COMMENT_MAX - text.length;
  const label = word === 'Reply' ? 'Write a reply' : 'Write a comment';

  const go = async () => {
    if (busy) return;
    if (!text.trim()) {
      setProblem('Write a comment first.');
      return;
    }
    setBusy(true);
    setProblem('');
    const err = await send(text);

    setBusy(false);
    if (err) setProblem(err);
    else onClose();
  };

  return (
    <div className='flex flex-col gap-1.5'>
      <textarea
        value={text}
        rows={3}
        maxLength={COMMENT_MAX}
        autoFocus
        aria-label={label}
        placeholder={`${label}…`}
        className={cn(chInputClass, 'w-full resize-y')}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void go();
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      />
      <div className='flex flex-wrap items-center gap-2'>
        <Button type='button' size='sm' disabled={busy} onClick={() => void go()}>
          {word}
        </Button>
        <Button type='button' size='sm' variant='ghost' onClick={onClose}>
          Cancel
        </Button>
        {left <= 200 && <span className='ml-auto text-xs text-text-tertiary'>{plural(left, 'character')} left</span>}
      </div>
      {problem && (
        <div role='alert' className='text-xs text-text-error'>
          {problem}
        </div>
      )}
    </div>
  );
}

const CONTROLS = 'a[href], button, input, select, textarea, [tabindex]';
const usable = (el: HTMLElement) => el.isConnected && el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length > 0;

/** For focusSoon: once `item` has gone, the next control after where it was (else the one before), inside its dialog if any. */
function controlAfter(item: Element) {
  const box = item.closest('[role=dialog]') || document.body;
  const all = Array.from(box.querySelectorAll<HTMLElement>(CONTROLS)).filter((el) => !item.contains(el));
  const next = all.filter((el) => item.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
  const order = [...next, ...all.filter((el) => !next.includes(el)).reverse()];

  return () => (item.isConnected ? null : order.find(usable));
}

function DeleteButton({ c, acts, withReplies, onProblem }: { c: DraftComment; acts: CommentActs; withReplies: boolean; onProblem: (text: string) => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  if (!c.mine && !acts.canBuild) return null;
  if (!asking) {
    return (
      <button ref={ref} type='button' className={quietButton} onClick={() => setAsking(true)}>
        Delete
      </button>
    );
  }
  return (
    <span className='inline-flex flex-wrap items-center gap-1.5 text-xs' role='group' aria-label='Delete this comment'>
      <span className='text-text-primary'>{withReplies ? 'Delete this comment and its replies?' : 'Delete this comment?'}</span>
      <button
        type='button'
        disabled={busy}
        className={cn(quietButton, 'text-text-error')}
        onClick={async (e) => {
          const item = e.currentTarget.closest('[data-comment]');
          const next = item ? controlAfter(item) : null;

          setBusy(true);
          const err = await acts.remove(c);

          setBusy(false);
          if (err) {
            setAsking(false);
            onProblem(err);
            refocus(ref);
          } else if (next) {
            // The comment took this button with it: focus the next control (else the one before), not the top of the page.
            focusSoon(next);
          }
        }}
      >
        Delete
      </button>
      <button
        type='button'
        autoFocus
        className={quietButton}
        onClick={() => {
          setAsking(false);
          refocus(ref);
        }}
      >
        Cancel
      </button>
    </span>
  );
}

export function ThreadView({ t, acts }: { t: DraftThread; acts: CommentActs }) {
  const [replying, setReplying] = useState(false);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const replyRef = useRef<HTMLButtonElement>(null);

  const toggleDone = async () => {
    setBusy(true);
    setProblem('');
    setProblem(await acts.setDone(t, !t.done));
    setBusy(false);
  };

  return (
    <article
      className={cn('flex min-w-0 flex-col gap-2 rounded-[10px] border border-border-primary p-3', t.done && 'bg-fill-content-hover')}
      aria-label={`Comment by ${t.name}`}
      data-testid='carehub-draft-thread'
      data-comment
    >
      <div className='flex flex-col gap-1'>
        <div className='flex flex-wrap items-center gap-2'>
          <Who c={t} />
          {t.done && <Chip tone='green'>Done</Chip>}
        </div>
        <CommentText text={t.text} />
      </div>
      {t.replies.length > 0 && (
        <div className='flex flex-col gap-2 border-l-2 border-border-primary pl-3'>
          {t.replies.map((r) => (
            <div key={r.id} className='flex min-w-0 flex-col gap-1' data-comment>
              <Who c={r} />
              <CommentText text={r.text} />
              <div>
                <DeleteButton c={r} acts={acts} withReplies={false} onProblem={setProblem} />
              </div>
            </div>
          ))}
        </div>
      )}
      {t.done && (
        <div className='text-xs text-text-tertiary'>
          Marked done{t.done_by_name ? ` by ${t.done_by_name}` : ''}
          {t.done_ms ? ` · ${formatWhen(t.done_ms)}` : ''}
        </div>
      )}
      {replying ? (
        <CommentBox
          word='Reply'
          send={(text) => acts.reply(t, text)}
          onClose={() => {
            setReplying(false);
            refocus(replyRef);
          }}
        />
      ) : (
        <div className='flex flex-wrap items-center gap-1'>
          <button ref={replyRef} type='button' className={quietButton} onClick={() => setReplying(true)}>
            Reply
          </button>
          {acts.canBuild && (
            <button type='button' className={quietButton} disabled={busy} onClick={() => void toggleDone()}>
              {t.done ? 'Reopen' : 'Mark done'}
            </button>
          )}
          <DeleteButton c={t} acts={acts} withReplies={t.replies.length > 0} onProblem={setProblem} />
        </div>
      )}
      {problem && (
        <div role='alert' className='text-xs text-text-error'>
          {problem}
        </div>
      )}
    </article>
  );
}

/** Open threads first; done ones behind "Show done (n)". */
export function ThreadList({ threads, acts, emptyText }: { threads: DraftThread[]; acts: CommentActs; emptyText?: string }) {
  const [showDone, setShowDone] = useState(false);
  const open = threads.filter((t) => !t.done);
  const done = threads.filter((t) => t.done);

  if (!threads.length) return emptyText ? <div className='text-sm text-text-tertiary'>{emptyText}</div> : null;
  return (
    <div className='flex flex-col gap-2'>
      {open.map((t) => (
        <ThreadView key={t.id} t={t} acts={acts} />
      ))}
      {done.length > 0 && (
        <button type='button' aria-expanded={showDone} className={cn(quietButton, 'self-start')} onClick={() => setShowDone((v) => !v)}>
          {showDone ? 'Hide done' : `Show done (${done.length})`}
        </button>
      )}
      {showDone && done.map((t) => <ThreadView key={t.id} t={t} acts={acts} />)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The review page: /learning/review/:token
// ---------------------------------------------------------------------------

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
// The server's own words for a bad or turned-off link (shown without asking when the link can't be right).
const BAD_LINK = "This review link was turned off or doesn't exist. Ask the author for a new link.";

function TryModal({ workspaceId, courseId, content, startLessonId, onClose }: { workspaceId: string; courseId: string; content: Content; startLessonId?: string; onClose: () => void }) {
  const [phone, setPhone] = useState(false);

  return (
    <CareHubModal title='Try it as a learner' wide='xl' onClose={onClose} testId='carehub-review-try'>
      <div className='mb-3 flex justify-center'>
        <div className='inline-flex rounded-[10px] border border-border-primary p-0.5' role='group' aria-label='Screen size'>
          {[
            { id: false, text: '🖥️ Desktop' },
            { id: true, text: '📱 Phone' },
          ].map((o) => (
            <button
              key={String(o.id)}
              type='button'
              aria-pressed={phone === o.id}
              onClick={() => setPhone(o.id)}
              className={cn(
                'rounded-[8px] px-3 py-1 text-sm',
                phone === o.id ? 'bg-fill-content-hover font-medium text-text-primary' : 'text-text-secondary hover:text-text-primary'
              )}
            >
              {o.text}
            </button>
          ))}
        </div>
      </div>
      <div className={cn(phone ? 'mx-auto w-[375px] max-w-full rounded-[24px] border-[6px] border-border-primary px-3 py-4' : 'w-full')}>
        <CareHubLearningPlayer workspaceId={workspaceId} courseId={courseId} preview={content} startLessonId={startLessonId} />
      </div>
    </CareHubModal>
  );
}

function ContinueNote({ block }: { block: BlockOf<'continue'> }) {
  return (
    <div className='rounded-[10px] border border-dashed border-border-primary px-3 py-2 text-center text-sm text-text-secondary'>
      Learners press “{block.label.trim() || 'Continue'}” to see the rest of this lesson
      {block.require_complete ? ', once everything above is finished.' : '.'}
    </div>
  );
}

function ReviewBlock({ block, lessonId, threads, acts, ctx }: { block: Block; lessonId: string; threads: DraftThread[]; acts: CommentActs; ctx: BlockCtx }) {
  const [writing, setWriting] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const open = threads.filter((t) => !t.done).length;

  return (
    <section
      id={`chr-b-${block.id}`}
      aria-label={blockLabel(block).replace(/^\S+\s/, '')}
      className='flex min-w-0 scroll-mt-4 flex-col gap-2 rounded-[12px] border border-border-primary p-3'
      data-testid='carehub-review-block'
    >
      <div className='flex items-center gap-2'>
        <span className='min-w-0 flex-1 truncate text-[11px] font-medium text-text-tertiary'>{blockLabel(block)}</span>
        {open > 0 && <span className='shrink-0 text-xs text-text-secondary'>{plural(open, 'open comment')}</span>}
        <button
          ref={ref}
          type='button'
          aria-label='Comment on this block'
          aria-expanded={writing}
          className={cn(quietButton, 'shrink-0 border border-border-primary px-2 py-1')}
          onClick={() => setWriting(true)}
          data-testid='carehub-review-comment'
        >
          <span aria-hidden='true'>💬 </span>
          Comment
        </button>
      </div>
      <div className='min-w-0 break-words'>{block.type === 'continue' ? <ContinueNote block={block} /> : <BlockView block={block} ctx={ctx} />}</div>
      {(threads.length > 0 || writing) && (
        <div className='flex flex-col gap-2 border-t border-border-primary pt-3'>
          <ThreadList threads={threads} acts={acts} />
          {writing && (
            <CommentBox
              word='Comment'
              send={(text) => acts.add(text, lessonId, block.id)}
              onClose={() => {
                setWriting(false);
                refocus(ref);
              }}
            />
          )}
        </div>
      )}
    </section>
  );
}

function ReviewQuiz({ quiz }: { quiz: Quiz }) {
  const n = quiz.questions.length;

  return (
    <div className='flex flex-col gap-3' data-testid='carehub-review-quiz'>
      <h2 className='text-lg font-semibold'>📝 {quiz.title.trim() || 'Final quiz'}</h2>
      {!quiz.enabled && <ChNote tone='warn'>The final quiz is turned off, so learners won’t see it.</ChNote>}
      <ChNote>
        The right answers are marked.
        {quiz.pool_size > 0 && quiz.pool_size < n ? ` Each learner gets ${quiz.pool_size} of these ${n} questions.` : ''} To comment on the quiz,
        use “Comments on the whole course” below.
      </ChNote>
      {(quiz.draws || []).map((d, i) => (
        <p key={`${d.bank_id}-${i}`} className='text-sm text-text-secondary'>
          Plus {plural(d.count, 'question')} picked at random from {d.title?.trim() ? `the bank “${d.title.trim()}”` : 'a question bank'}.
        </p>
      ))}
      {quiz.questions.map((q, i) => {
        const right = correctAnswerOf(q);

        return (
          <div key={q.id} className='min-w-0 rounded-[12px] border border-border-primary p-4'>
            <QuestionView q={q} name={`chr-q-${q.id}`} number={i + 1} value={right} onChange={noop} disabled reveal={right} />
            {q.explanation.trim() && (
              <div className='mt-2 text-sm text-text-secondary'>
                <RichText text={q.explanation} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** /learning/review/:token: a draft as it is now, with comments by each block. Anyone in the workspace with the link. */
export function LearningReviewPage({ workspaceId }: { workspaceId: string }) {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const narrow = useNarrowWidth(rootRef, 720);
  const goodToken = TOKEN_RE.test(token);
  const at = reviewAt(workspaceId, token);
  const [data, setData] = useState<ReviewDraft | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pick, setPick] = useState('');
  const [trying, setTrying] = useState(false);
  const [writing, setWriting] = useState(false);
  const courseRef = useRef<HTMLDivElement>(null);
  const comments = useDraftComments(at, Boolean(data));
  const acts = useCommentActs(at, comments.canBuild, comments.reload);
  const ctx = useMemo<BlockCtx>(
    () => ({ workspaceId, preview: true, kc: {}, done: new Set<string>(), onKcAnswer: noop, onScenarioDone: noop, onMedia: noop }),
    [workspaceId]
  );
  const placed = useMemo(() => placeThreads(data?.draft, comments.threads || []), [data, comments.threads]);

  useEffect(() => {
    if (!goodToken) return undefined;
    let alive = true;

    setData(null);
    setError(null);
    draftsApi.review(workspaceId, token).then(
      (d) => {
        if (alive) setData(d);
      },
      (e) => {
        if (alive) setError(e);
      }
    );
    return () => {
      alive = false;
    };
  }, [workspaceId, token, goodToken]);

  const back = (
    <div>
      <button type='button' className={cn(quietButton, 'text-sm')} onClick={() => navigate(LEARNING_PATH)}>
        ← Learning
      </button>
    </div>
  );

  if (!goodToken || error || !data) {
    return (
      <div ref={rootRef} className='flex flex-col gap-4' data-testid='carehub-learning-review'>
        {back}
        {!goodToken ? (
          <ChNote tone='warn'>{BAD_LINK}</ChNote>
        ) : error ? (
          <ChNote tone={learningNotLive(error) ? 'info' : 'warn'}>{lErrorText(error)}</ChNote>
        ) : (
          <div className='text-sm text-text-tertiary'>Loading…</div>
        )}
      </div>
    );
  }

  const { draft } = data;
  const quizShown = draft.quiz.questions.length > 0 || (draft.quiz.draws || []).length > 0;
  const order = [...draft.lessons.map((l) => `lesson:${l.id}`), ...(quizShown ? ['quiz'] : [])];
  const current = order.includes(pick) ? pick : order[0] || '';
  const index = order.indexOf(current);
  const lesson = draft.lessons.find((l) => `lesson:${l.id}` === current) || null;
  const openIn = (lessonId: string) =>
    [...placed.blocks.entries()].reduce((n, [blockId, ts]) => n + (placed.lessonOf.get(blockId) === lessonId ? ts.filter((t) => !t.done).length : 0), 0);
  const go = (value: string) => {
    setPick(value);
    rootRef.current?.scrollIntoView({ block: 'start' });
  };
  const loading = comments.threads === null && !comments.error;

  return (
    <div ref={rootRef} className='flex scroll-mt-4 flex-col gap-4' data-testid='carehub-learning-review'>
      {back}
      <div className='flex flex-wrap items-center gap-x-3 gap-y-2'>
        <h1 className='min-w-0 max-w-full break-words text-xl font-semibold'>{data.title}</h1>
        <Chip tone='amber'>Draft for review</Chip>
        <div className='flex flex-wrap gap-1.5 sm:ml-auto'>
          {data.can_build && (
            <Button type='button' size='sm' variant='outline' onClick={() => navigate(`${LEARNING_PATH}/studio/${data.course_id}`)}>
              Open in Studio
            </Button>
          )}
          <Button type='button' size='sm' onClick={() => setTrying(true)} data-testid='carehub-review-try-button'>
            ▶ Try it as a learner
          </Button>
        </div>
      </div>
      <div className='-mt-2 text-xs text-text-tertiary'>
        {[data.shared_by_name && `Shared by ${data.shared_by_name}`, data.updated_ms > 0 && `Last saved ${formatWhen(data.updated_ms)}`]
          .filter(Boolean)
          .join(' · ')}
      </div>
      <ChNote>This is a draft. Reload to see the author’s latest changes.</ChNote>
      {comments.error ? <ChNote tone='error'>{lErrorText(comments.error)}</ChNote> : null}
      {order.length > 1 && (
        <ChSelect
          ariaLabel='Pick a lesson'
          className='w-full sm:w-auto sm:max-w-[480px]'
          value={current}
          options={order.map((v) => {
            if (v === 'quiz') return { value: v, label: `📝 ${draft.quiz.title.trim() || 'Final quiz'}${draft.quiz.enabled ? '' : ' (off)'}` };
            const i = draft.lessons.findIndex((l) => `lesson:${l.id}` === v);
            const l = draft.lessons[i];
            const n = openIn(l.id);

            return { value: v, label: `${i + 1}. ${l.title.trim() || 'Untitled lesson'}${n ? ` (${plural(n, 'open comment')})` : ''}` };
          })}
          onChange={go}
        />
      )}
      <NarrowContext.Provider value={narrow}>
        {lesson ? (
          <div className='flex flex-col gap-3'>
            <h2 className='text-lg font-semibold'>
              {index + 1}. {lesson.title.trim() || 'Untitled lesson'}
            </h2>
            {lesson.blocks.length === 0 && <div className='text-sm text-text-tertiary'>This lesson is empty.</div>}
            {lesson.blocks.map((b) => (
              <ReviewBlock key={b.id} block={b} lessonId={lesson.id} threads={placed.blocks.get(b.id) || []} acts={acts} ctx={ctx} />
            ))}
          </div>
        ) : current === 'quiz' ? (
          <ReviewQuiz quiz={draft.quiz} />
        ) : (
          <div className='text-sm text-text-tertiary'>This course has no lessons yet.</div>
        )}
      </NarrowContext.Provider>
      {order.length > 1 && (
        <div className='flex flex-wrap justify-between gap-2'>
          {index > 0 ? (
            <Button type='button' size='sm' variant='outline' onClick={() => go(order[index - 1])}>
              ← Previous
            </Button>
          ) : (
            <span />
          )}
          {index < order.length - 1 && (
            <Button type='button' size='sm' variant='outline' onClick={() => go(order[index + 1])}>
              Next →
            </Button>
          )}
        </div>
      )}
      <section className='flex flex-col gap-2 border-t border-border-primary pt-4' aria-labelledby='chr-course-comments'>
        <h2 id='chr-course-comments' className='text-base font-semibold'>
          Comments on the whole course
        </h2>
        {loading ? (
          <div className='text-sm text-text-tertiary'>Loading comments…</div>
        ) : (
          <ThreadList threads={placed.course} acts={acts} emptyText='No comments yet.' />
        )}
        {writing ? (
          <CommentBox
            word='Comment'
            send={(text) => acts.add(text, '', '')}
            onClose={() => {
              setWriting(false);
              refocus(courseRef);
            }}
          />
        ) : (
          <div ref={courseRef}>
            <Button type='button' size='sm' variant='outline' onClick={() => setWriting(true)}>
              💬 Comment on the whole course
            </Button>
          </div>
        )}
      </section>
      {placed.removed.length > 0 && (
        <section className='flex flex-col gap-2' aria-labelledby='chr-removed-comments'>
          <h2 id='chr-removed-comments' className='text-base font-semibold'>
            On blocks that were removed
          </h2>
          <ThreadList threads={placed.removed} acts={acts} />
        </section>
      )}
      {trying && (
        <TryModal
          workspaceId={workspaceId}
          courseId={data.course_id}
          content={draft}
          startLessonId={lesson?.id}
          onClose={() => setTrying(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Studio: share dialog, comments window, open-comment counts
// ---------------------------------------------------------------------------

function ShareDialog({ workspaceId, courseId, onClose }: { workspaceId: string; courseId: string; onClose: () => void }) {
  // undefined = still asking the server.
  const [link, setLink] = useState<ReviewLink | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [turnedOff, setTurnedOff] = useState(false);
  const [copied, setCopied] = useState<'' | 'yes' | 'no'>('');

  useEffect(() => {
    let alive = true;

    draftsApi.link(workspaceId, courseId).then(
      (l) => {
        if (alive) setLink(l);
      },
      (e) => {
        if (!alive) return;
        setLink(null);
        setProblem(lErrorText(e));
      }
    );
    return () => {
      alive = false;
    };
  }, [workspaceId, courseId]);

  useEffect(() => {
    if (copied !== 'yes') return undefined;
    const t = window.setTimeout(() => setCopied(''), 2500);

    return () => window.clearTimeout(t);
  }, [copied]);

  const change = async (on: boolean) => {
    setBusy(true);
    setProblem('');
    setCopied('');
    try {
      if (on) {
        setLink(await draftsApi.makeLink(workspaceId, courseId));
        setTurnedOff(false);
      } else {
        await draftsApi.stopLink(workspaceId, courseId);
        setLink(null);
        setTurnedOff(true);
      }
    } catch (e) {
      setProblem(lErrorText(e));
    } finally {
      setBusy(false);
    }
  };
  const url = link ? reviewUrl(link.token) : '';

  return (
    <CareHubModal title='Share this draft for review' onClose={onClose} testId='carehub-draft-share'>
      <div className='flex flex-col gap-3'>
        <p className='text-sm text-text-secondary'>
          Anyone in this workspace who has the link can see this draft, including quiz answers, and leave comments. They can’t change it.
        </p>
        {link === undefined ? (
          <div className='text-sm text-text-tertiary'>Loading…</div>
        ) : link ? (
          <>
            <input
              readOnly
              value={url}
              aria-label='Review link'
              className={cn(chInputClass, 'w-full')}
              onFocus={(e) => e.currentTarget.select()}
              data-testid='carehub-draft-share-link'
            />
            {link.created_by_name && (
              <div className='-mt-1 text-xs text-text-tertiary'>
                Made by {link.created_by_name} · {formatWhen(link.created_ms)}
              </div>
            )}
            <div className='flex flex-wrap items-center gap-2'>
              <Button type='button' size='sm' onClick={() => void copyText(url).then((ok) => setCopied(ok ? 'yes' : 'no'))}>
                {copied === 'yes' ? 'Link copied' : 'Copy link'}
              </Button>
              <Button type='button' size='sm' variant='outline' disabled={busy} onClick={() => void change(false)}>
                Turn off link
              </Button>
            </div>
          </>
        ) : (
          <div>
            <Button type='button' size='sm' disabled={busy} onClick={() => void change(true)} data-testid='carehub-draft-share-make'>
              Make a link
            </Button>
          </div>
        )}
        <div role='status' aria-live='polite' className='text-xs'>
          {copied === 'yes' && <span className='sr-only'>Link copied.</span>}
          {copied === 'no' && <span className='text-text-error'>Couldn’t copy. Select the link and copy it yourself.</span>}
          {turnedOff && !link && <span className='text-text-secondary'>The old link no longer works.</span>}
        </div>
        {problem && <ChNote tone='error'>{problem}</ChNote>}
      </div>
    </CareHubModal>
  );
}

function CommentsPanel({
  draft,
  comments,
  acts,
  focusBlock,
  onGoTo,
  onShare,
  onClose,
}: {
  draft: Content;
  comments: DraftComments;
  acts: CommentActs;
  focusBlock: string;
  onGoTo: (lessonId: string, blockId: string) => void;
  onShare: () => void;
  onClose: () => void;
}) {
  const { threads, error, reload } = comments;
  const [showDone, setShowDone] = useState(false);
  const placed = useMemo(() => placeThreads(draft, threads || []), [draft, threads]);
  const loaded = threads !== null;
  const all = threads || [];
  const open = all.filter((t) => !t.done).length;
  const doneCount = all.length - open;
  const shown = (ts: DraftThread[]) => (showDone ? ts : ts.filter((t) => !t.done));

  // Fresh when opened, then every 30 seconds while open.
  useEffect(() => {
    void reload();
    const t = window.setInterval(() => void reload(), 30000);

    return () => window.clearInterval(t);
  }, [reload]);

  useEffect(() => {
    if (!focusBlock || !loaded) return;
    const el = document.getElementById(`chd-g-${focusBlock}`);

    el?.scrollIntoView({ block: 'start' });
    el?.focus({ preventScroll: true });
  }, [focusBlock, loaded]);

  const threadsOf = (ts: DraftThread[]) => ts.map((t) => <ThreadView key={t.id} t={t} acts={acts} />);
  const groups: ReactNode[] = [];
  const course = shown(placed.course);

  if (course.length) {
    groups.push(
      <section key='course' className='flex flex-col gap-2'>
        <h3 className='text-sm font-semibold'>Whole course</h3>
        {threadsOf(course)}
      </section>
    );
  }
  draft.lessons.forEach((l, li) => {
    const items = l.blocks
      .filter((b) => placed.lessonOf.get(b.id) === l.id)
      .map((b) => ({ b, ts: shown(placed.blocks.get(b.id) || []) }))
      .filter((x) => x.ts.length > 0);

    if (!items.length) return;
    groups.push(
      <section key={l.id} className='flex flex-col gap-3'>
        <h3 className='text-sm font-semibold'>
          {li + 1}. {l.title.trim() || 'Untitled lesson'}
        </h3>
        {items.map(({ b, ts }) => {
          const words = blockExcerpt(b);

          return (
            <div key={b.id} id={`chd-g-${b.id}`} tabIndex={-1} className='flex scroll-mt-2 flex-col gap-2' aria-label={`Comments on ${blockLabel(b)}`}>
              <div className='flex items-center gap-2'>
                <span className='min-w-0 flex-1 truncate text-xs text-text-secondary' title={words || undefined}>
                  {blockLabel(b)}
                  {words ? ` · ${words}` : ''}
                </span>
                <Button type='button' size='sm' variant='outline' className='shrink-0' onClick={() => onGoTo(l.id, b.id)}>
                  Go to block
                </Button>
              </div>
              {threadsOf(ts)}
            </div>
          );
        })}
      </section>
    );
  });
  const removed = shown(placed.removed);

  if (removed.length) {
    groups.push(
      <section key='removed' className='flex flex-col gap-2'>
        <h3 className='text-sm font-semibold'>On blocks that were removed</h3>
        {threadsOf(removed)}
      </section>
    );
  }

  return (
    <CareHubModal title='Comments' wide onClose={onClose} testId='carehub-draft-comments'>
      <div className='flex flex-col gap-4'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='text-sm text-text-secondary'>{loaded ? plural(open, 'open comment') : 'Loading…'}</span>
          {doneCount > 0 && (
            <button type='button' aria-pressed={showDone} className={quietButton} onClick={() => setShowDone((v) => !v)}>
              {showDone ? 'Hide done' : `Show done (${doneCount})`}
            </button>
          )}
          <div className='ml-auto flex flex-wrap gap-2'>
            {loaded && all.length > 0 && (
              <Button type='button' size='sm' variant='outline' onClick={() => downloadComments(draft, placed)} data-testid='carehub-draft-comments-csv'>
                Download comments (CSV)
              </Button>
            )}
            <Button type='button' size='sm' variant='outline' onClick={onShare}>
              🔗 Share for review
            </Button>
          </div>
        </div>
        {error ? <ChNote tone='error'>{lErrorText(error)}</ChNote> : null}
        {loaded && groups.length > 0 && groups}
        {loaded && !groups.length && (
          <div className='text-sm text-text-tertiary'>
            {all.length ? 'No open comments.' : 'No comments yet. Share the draft for review to get comments.'}
          </div>
        )}
      </div>
    </CareHubModal>
  );
}

/**
 * Studio's review pieces for the course being edited: the header buttons, the open-comment count under a block,
 * and the windows they open. Nothing shows while the server doesn't have these routes yet (HTTP 404).
 */
export function useStudioReview(workspaceId: string, courseId: string, draft: Content, goTo: (lessonId: string, blockId: string) => void) {
  const at = studioAt(workspaceId, courseId);
  const comments = useDraftComments(at);
  const acts = useCommentActs(at, comments.canBuild, comments.reload);
  const [win, setWin] = useState<'' | 'share' | 'comments'>('');
  const [focusBlock, setFocusBlock] = useState('');
  const live = comments.threads !== null || (comments.error !== null && !learningNotLive(comments.error));
  const counts = useMemo(() => {
    const byBlock = new Map<string, number>();
    let open = 0;

    for (const t of comments.threads || []) {
      if (t.done) continue;
      open += 1;
      if (t.block_id) byBlock.set(t.block_id, (byBlock.get(t.block_id) || 0) + 1);
    }
    return { open, byBlock };
  }, [comments.threads]);
  const openPanel = (blockId: string) => {
    setFocusBlock(blockId);
    setWin('comments');
  };

  const buttons = live ? (
    <>
      <Button type='button' size='sm' variant='outline' onClick={() => setWin('share')} data-testid='carehub-draft-share-button'>
        🔗 Share for review
      </Button>
      <Button type='button' size='sm' variant='outline' onClick={() => openPanel('')} data-testid='carehub-draft-comments-button'>
        💬 Comments ({counts.open})
      </Button>
    </>
  ) : null;

  /** "💬 2 open comments" under a block card in the editor (nothing when it has none). */
  const badge = (blockId: string) => {
    const n = live ? counts.byBlock.get(blockId) || 0 : 0;

    if (!n) return null;
    return (
      <button
        type='button'
        onClick={() => openPanel(blockId)}
        className='-mt-1.5 ml-3 inline-flex items-center gap-1 self-start rounded-full border border-border-primary bg-background-primary px-2.5 py-0.5 text-xs font-medium text-text-secondary hover:bg-fill-content-hover hover:text-text-primary'
        data-testid='carehub-draft-block-comments'
      >
        <span aria-hidden='true'>💬</span>
        {plural(n, 'open comment')}
      </button>
    );
  };

  const modal =
    win === 'share' ? (
      <ShareDialog workspaceId={workspaceId} courseId={courseId} onClose={() => setWin('')} />
    ) : win === 'comments' ? (
      <CommentsPanel
        draft={draft}
        comments={comments}
        acts={acts}
        focusBlock={focusBlock}
        onShare={() => setWin('share')}
        onGoTo={(lessonId, blockId) => {
          setWin('');
          goTo(lessonId, blockId);
        }}
        onClose={() => setWin('')}
      />
    ) : null;

  return { buttons, badge, modal };
}

/**
 * A Studio block card with its open-comment count under it: `<WithCommentCount card={BlockCard} openComments={…} … />`.
 * The count sits outside the card, so drag and drop (which looks for the cards) leaves it alone.
 */
export function WithCommentCount<P extends object>({ card: Card, openComments, ...props }: P & { card: ComponentType<P>; openComments: ReactNode }) {
  return (
    <>
      <Card {...(props as unknown as P)} />
      {openComments}
    </>
  );
}

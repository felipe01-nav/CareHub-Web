// CareHub Learning Studio: undo and redo in the course editor. Each open course has one history: empty when the
// course opens and never saved. Every change is a step (the newest 100 are kept), typing in one field with short
// pauses is one step, and a new change after an undo drops what could have been redone. A step keeps the whole draft
// before and after (they share everything that didn't change), so undo puts back exactly what was there.
import { useEffect, useMemo, useRef, useState } from 'react';

import type { Ref } from 'react';

import { firstControl } from './CareHubLearningA11y';
import { IconButton } from './CareHubLearningStudioBlocks';

import type { Content, CourseSettings, Lesson, Quiz } from './CareHubLearningApi';

export const HISTORY_MAX = 100;
/** Changes to the same field closer together than this are one step. */
const MERGE_MS = 1000;

/** The editor panel a change shows in. */
export type HistorySpot = { kind: 'settings' } | { kind: 'quiz' } | { kind: 'lesson'; id: string };

export interface HistoryStep {
  id: number;
  /** e.g. "delete block": the toolbar says "Undo: delete block", the status line "Undone: delete block". */
  label: string;
  before: Content;
  after: Content;
  /** Same key + quick succession = typing in one field, merged into this step ('' never merges). */
  key: string;
  /** When the newest change in this step was made. */
  at: number;
}

/** What changed between two drafts, in words, and where it shows in the second one. */
export interface CourseChange {
  label: string;
  key: string;
  /** The panel to open; null leaves the open one alone. */
  spot: HistorySpot | null;
  /** id of the element that shows the change (a block or question card), or ''. */
  target: string;
}

type Rec = Record<string, unknown>;

const SETTINGS: HistorySpot = { kind: 'settings' };
const QUIZ: HistorySpot = { kind: 'quiz' };

const COURSE_WORDS: Rec = { title: 'edit course title', summary: 'edit course summary', cover: 'change cover picture' };
const LESSON_WORDS: Rec = {
  title: 'edit lesson title',
  min_seconds: 'change minimum time',
  branch: 'change side lesson',
  then: 'change after this lesson',
};
const QUIZ_WORDS: Rec = {
  title: 'edit quiz title',
  pool_size: 'change questions per attempt',
  shuffle: 'change shuffle',
  draws: 'change questions from banks',
};
const SETTING_WORDS: Partial<Record<keyof CourseSettings, string>> = {
  pass_mark: 'change pass mark',
  max_attempts: 'change tries allowed',
  show_answers: 'change when to show answers',
  completion: 'change when the course is finished',
  sequential: 'change lessons in order',
  min_seconds_per_lesson: 'change minimum time per lesson',
  require_ack: 'change confirm at the end',
  ack_text: 'edit what they confirm',
  certificate: 'change certificate',
  recert_months: 'change renewal',
  catalog: 'change show in the Catalog',
};
/** Settings edited in the final quiz panel. */
const QUIZ_SETTINGS = new Set(['pass_mark', 'max_attempts', 'show_answers']);

function changedKeys(a: object, b: object): string[] {
  const x = a as Rec;
  const y = b as Rec;

  return Array.from(new Set([...Object.keys(x), ...Object.keys(y)])).filter((k) => x[k] !== y[k]);
}

/** Typing-like edits of one field (text, numbers, lists of text) merge; switches and adding or removing a field don't. */
function typingKey(prefix: string, a: object, b: object): string {
  const keys = changedKeys(a, b);

  if (keys.length !== 1) return '';
  const was = (a as Rec)[keys[0]];
  const now = (b as Rec)[keys[0]];

  if (was === undefined || now === undefined || typeof was === 'boolean' || typeof now === 'boolean') return '';
  return `${prefix}:${keys[0]}`;
}

/** Items added, removed, moved or edited between two lists of things with ids; `id` is the one to show afterwards. */
function listChange<T extends { id: string }>(
  a: T[],
  b: T[],
  one: string,
  many: string,
  edit: (was: T, now: T) => string
): { label: string; key: string; id: string; moved: boolean } {
  const inA = new Map(a.map((x, i) => [x.id, i]));
  const inB = new Set(b.map((x) => x.id));
  const added = b.filter((x) => !inA.has(x.id));
  const removed = a.flatMap((x, i) => (inB.has(x.id) ? [] : [i]));
  const keptA = a.filter((x) => inB.has(x.id));
  const keptB = b.filter((x) => inA.has(x.id));
  const edited = keptB.filter((x) => a[inA.get(x.id) ?? -1] !== x);
  const count = (n: number) => (n === 1 ? one : `${n} ${many}`);

  if (added.length && !removed.length) return { label: `add ${count(added.length)}`, key: '', id: added[0].id, moved: false };
  if (removed.length && !added.length) {
    // The one before what went (else the new first one).
    const near = b[removed[0] - 1] || b[0];

    return { label: `delete ${count(removed.length)}`, key: '', id: near ? near.id : '', moved: false };
  }
  if (added.length) return { label: `change ${many}`, key: '', id: added[0].id, moved: false };
  if (keptA.some((x, i) => keptB[i].id !== x.id)) {
    // The one that moved furthest.
    const was = new Map(keptA.map((x, i) => [x.id, i]));
    let id = '';
    let far = 0;

    keptB.forEach((x, i) => {
      const d = Math.abs((was.get(x.id) ?? i) - i);

      if (d > far) {
        far = d;
        id = x.id;
      }
    });
    return { label: `move ${one}`, key: '', id, moved: true };
  }
  if (edited.length === 1) {
    const now = edited[0];

    return { label: `edit ${one}`, key: edit(a[inA.get(now.id) ?? -1], now), id: now.id, moved: false };
  }

  return { label: `edit ${many}`, key: '', id: edited.length ? edited[0].id : '', moved: false };
}

function lessonsChange(a: Lesson[], b: Lesson[]): CourseChange {
  const byId = new Map(a.map((l) => [l.id, l]));
  const same = a.length === b.length && b.every((l, i) => a[i].id === l.id);
  const edited = same ? b.filter((l) => byId.get(l.id) !== l) : [];

  if (edited.length === 1) {
    const now = edited[0];
    const was = byId.get(now.id) as Lesson;
    const keys = changedKeys(was, now);
    const spot: HistorySpot = { kind: 'lesson', id: now.id };

    if (keys.length === 1 && keys[0] === 'blocks') {
      const r = listChange(was.blocks, now.blocks, 'block', 'blocks', (x, y) => typingKey(`b:${y.id}`, x, y));

      return { label: r.label, key: r.key, spot, target: r.id ? `chs-b-${r.id}` : '' };
    }
    const words = keys.length === 1 ? LESSON_WORDS[keys[0]] : '';

    return {
      label: typeof words === 'string' && words ? words : 'edit lesson',
      key: typingKey(`l:${now.id}`, was, now),
      spot,
      target: keys.includes('title') ? 'chs-lesson-title' : '',
    };
  }

  const r = listChange(a, b, 'lesson', 'lessons', () => '');

  return { label: r.label, key: '', spot: r.moved ? null : r.id ? { kind: 'lesson', id: r.id } : SETTINGS, target: '' };
}

function quizChange(a: Quiz, b: Quiz): CourseChange {
  const keys = changedKeys(a, b);

  if (keys.includes('questions')) {
    const r = listChange(a.questions, b.questions, 'question', 'questions', (x, y) => typingKey(`q:${y.id}`, x, y));

    return { label: r.label, key: keys.length === 1 ? r.key : '', spot: QUIZ, target: r.id ? `chs-q-${r.id}` : '' };
  }
  const words = keys.length === 1 ? QUIZ_WORDS[keys[0]] : '';

  return { label: typeof words === 'string' && words ? words : 'change the final quiz', key: typingKey('quiz', a, b), spot: QUIZ, target: '' };
}

function settingsChange(a: CourseSettings, b: CourseSettings): CourseChange {
  const keys = changedKeys(a, b);
  // Turning "confirm at the end" on also fills in what people confirm.
  const one = (keys.length === 1 ? keys[0] : keys.includes('require_ack') && keys.length === 2 ? 'require_ack' : '') as keyof CourseSettings;

  return {
    label: SETTING_WORDS[one] || 'change settings',
    key: typingKey('s', a, b),
    spot: QUIZ_SETTINGS.has(one) ? QUIZ : SETTINGS,
    target: '',
  };
}

/** Describes the change from draft `a` to draft `b` ("delete block") and where it shows in `b`. */
export function describeChange(a: Content, b: Content): CourseChange {
  if (a.quiz.enabled !== b.quiz.enabled) {
    return { label: b.quiz.enabled ? 'turn on the final quiz' : 'turn off the final quiz', key: '', spot: QUIZ, target: '' };
  }
  if (a.preset !== b.preset) return { label: 'change course type', key: '', spot: SETTINGS, target: '' };
  if (a.lessons !== b.lessons) return lessonsChange(a.lessons, b.lessons);
  if (a.quiz !== b.quiz) return quizChange(a.quiz, b.quiz);
  if (a.settings !== b.settings) return settingsChange(a.settings, b.settings);
  const keys = changedKeys(a, b);
  const words = keys.length === 1 ? COURSE_WORDS[keys[0]] : '';

  if (typeof words === 'string' && words) return { label: words, key: typingKey('c', a, b), spot: SETTINGS, target: '' };
  return { label: 'edit course', key: '', spot: null, target: '' };
}

export interface CourseHistory {
  /** What Undo / Redo would do next ('' = nothing). */
  undoLabel: string;
  redoLabel: string;
  /** Call for every change to the draft; `label` names a step that is more than one edit (e.g. "paste text"). */
  record: (before: Content, after: Content, label?: string) => void;
  /** Moves the newest step to the redo list; put its `before` back. */
  undo: () => HistoryStep | null;
  /** Moves the newest undone step back; put its `after` back. */
  redo: () => HistoryStep | null;
  /** id of the step Undo would take back (0 = none). */
  top: () => number;
}

export function useCourseHistory(): CourseHistory {
  const past = useRef<HistoryStep[]>([]);
  const future = useRef<HistoryStep[]>([]);
  const seq = useRef(0);
  // After an undo or redo the next change starts a new step.
  const sealed = useRef(true);
  const [undoLabel, setUndoLabel] = useState('');
  const [redoLabel, setRedoLabel] = useState('');

  const acts = useMemo(() => {
    const show = () => {
      const p = past.current;
      const f = future.current;

      setUndoLabel(p.length ? p[p.length - 1].label : '');
      setRedoLabel(f.length ? f[f.length - 1].label : '');
    };

    return {
      record: (before: Content, after: Content, label?: string) => {
        const list = past.current;
        const last = list[list.length - 1];
        const now = Date.now();
        const change = label ? null : describeChange(before, after);
        const key = change ? change.key : '';

        if (key && last && !sealed.current && last.key === key && last.after === before && now - last.at < MERGE_MS) {
          list[list.length - 1] = { ...last, after, at: now };
        } else {
          list.push({ id: ++seq.current, label: label || (change ? change.label : 'edit course'), before, after, key, at: now });
          if (list.length > HISTORY_MAX) list.splice(0, list.length - HISTORY_MAX);
        }
        future.current = [];
        sealed.current = false;
        show();
      },
      undo: () => {
        const step = past.current.pop() || null;

        if (step) {
          future.current.push(step);
          sealed.current = true;
          show();
        }

        return step;
      },
      redo: () => {
        const step = future.current.pop() || null;

        if (step) {
          past.current.push(step);
          sealed.current = true;
          show();
        }

        return step;
      },
      top: () => (past.current.length ? past.current[past.current.length - 1].id : 0),
    };
  }, []);

  return { ...acts, undoLabel, redoLabel };
}

/**
 * Cmd/Ctrl+Z → 'undo'; Cmd/Ctrl+Shift+Z or Ctrl+Y → 'redo'. null for other keys, and while focus is in a text field,
 * a list or a dialog (those keep their own undo).
 */
export function historyKey(e: KeyboardEvent): 'undo' | 'redo' | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.defaultPrevented || e.isComposing) return null;
  // e.code for keyboards whose letters aren't Latin.
  const k = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : e.code === 'KeyZ' ? 'z' : e.code === 'KeyY' ? 'y' : '';
  const dir = k === 'z' ? (e.shiftKey ? 'redo' : 'undo') : k === 'y' && e.ctrlKey && !e.metaKey && !e.shiftKey ? 'redo' : null;
  const at = e.target instanceof Element ? e.target : null;

  if (!dir) return null;
  if (at?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"]')) return null;
  if (document.querySelector('[aria-modal="true"]')) return null;
  return dir;
}

/**
 * After an undo or redo: scrolls to what changed and, if focus fell off the page because its control went away,
 * puts it on the first control there (else `fallback`). Call the returned function with the element id ('' = none)
 * just before the change.
 */
export function useLanding(fallback: () => HTMLElement | null | undefined) {
  const want = useRef<string | null>(null);
  const fallbackRef = useRef(fallback);

  fallbackRef.current = fallback;
  useEffect(() => {
    const id = want.current;

    if (id === null) return;
    want.current = null;
    const el = id ? document.getElementById(id) : null;

    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const active = document.activeElement;

    if (active instanceof HTMLElement && active !== document.body && active.isConnected) return;
    (firstControl(el) || fallbackRef.current())?.focus({ preventScroll: true });
  });

  return useMemo(
    () => (id: string) => {
      want.current = id;
    },
    []
  );
}

function UndoIcon() {
  return (
    <svg width='16' height='16' viewBox='0 0 16 16' fill='none' aria-hidden='true' focusable='false'>
      <path d='M5.5 2.5 2.5 5.5l3 3' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' />
      <path d='M3 5.5h6.5a3.5 3.5 0 0 1 0 7H6' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg width='16' height='16' viewBox='0 0 16 16' fill='none' aria-hidden='true' focusable='false'>
      <path d='M10.5 2.5l3 3-3 3' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' />
      <path d='M13 5.5H6.5a3.5 3.5 0 0 0 0 7H10' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
    </svg>
  );
}

/** Undo / Redo for the editor's top bar: the name and tooltip say what they'd do ("Undo: delete block"). */
export function HistoryButtons({
  history,
  onUndo,
  onRedo,
  reg,
}: {
  history: CourseHistory;
  onUndo: () => void;
  onRedo: () => void;
  /** useRefocus().reg, for keys 'undo' and 'redo'. */
  reg: (key: string) => Ref<HTMLButtonElement>;
}) {
  return (
    <div className='flex items-center gap-0.5' data-testid='carehub-learning-history'>
      <IconButton
        buttonRef={reg('undo')}
        label={history.undoLabel ? `Undo: ${history.undoLabel}` : 'Undo'}
        disabled={!history.undoLabel}
        onClick={onUndo}
      >
        <UndoIcon />
      </IconButton>
      <IconButton
        buttonRef={reg('redo')}
        label={history.redoLabel ? `Redo: ${history.redoLabel}` : 'Redo'}
        disabled={!history.redoLabel}
        onClick={onRedo}
      >
        <RedoIcon />
      </IconButton>
    </div>
  );
}

/** Reads out "Undone: delete block" (a new `n` each time, so the same words are read again). */
export function HistoryStatus({ text, n }: { text: string; n: number }) {
  return (
    <div role='status' className='sr-only'>
      {text && <span key={n}>{text}</span>}
    </div>
  );
}

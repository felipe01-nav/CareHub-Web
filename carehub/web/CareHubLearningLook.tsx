// CareHub Learning: how a course looks to the people taking it (player4). The learner's own text size, the lesson list
// (open, closed or hidden), the course's own button and label words, the start page layout, lesson icons and header
// pictures, and Catalog topics: the readers and publish checks for these fields, and the pieces that show or edit them.
// CareHubLearningApi imports this file, so it only imports types from there; pictures and the Catalog come in as props.
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import type { ComponentType, CSSProperties, ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { chInputClass, ChSection, ChSelect } from './CareHubUi';

import type { CourseCard, Lesson } from './CareHubLearningApi';

// ---------------------------------------------------------------------------
// Shapes and limits (CONTRACT-CHANGES.md, 24 Oct: P1–P6)
// ---------------------------------------------------------------------------

export type TextSize = 'normal' | 'large' | 'larger';
export type SidebarMode = 'open' | 'closed' | 'hidden';
export type CoverLayout = 'card' | 'split' | 'full' | 'plain';

/** The words people can change, with the player's usual word for each. */
export const LABEL_DEFAULTS = {
  start: 'Start course',
  lessons: 'Lessons',
  next: 'Next lesson',
  previous: 'Previous',
  to_quiz: 'Go to the quiz',
  finish: 'Finish course',
  final_quiz: 'Final quiz',
  submit: 'Submit answers',
  try_again: 'Try again',
  continue: 'Continue',
  review: 'Review lessons',
  take_quiz: 'Take the final quiz',
  confirm: 'Confirm and finish',
  back: 'Back to My learning',
} as const;

export type LabelKey = keyof typeof LABEL_DEFAULTS;
export type Labels = Partial<Record<LabelKey, string>>;

const LABEL_KEYS = Object.keys(LABEL_DEFAULTS) as LabelKey[];

/** Where each word shows (the hint under its box in Studio). */
const LABEL_WHERE: Record<LabelKey, string> = {
  start: 'The button on the start page.',
  lessons: 'The lesson list and its button.',
  next: 'At the end of a lesson.',
  previous: 'At the end of a lesson.',
  to_quiz: 'At the end of the last lesson, before the quiz.',
  finish: 'At the end of the last lesson.',
  final_quiz: 'Above the quiz title and on the start page.',
  submit: 'The quiz’s send button.',
  try_again: 'After a quiz that wasn’t passed.',
  continue: 'After the quiz, and on Continue blocks without their own words.',
  review: 'On the last screen and after the quiz.',
  take_quiz: 'On the last screen.',
  confirm: 'When people confirm at the end.',
  back: 'The way back out of the course.',
};

export const LABEL_MAX = 40;
export const ICON_MAX = 8;
export const TOPIC_MAX = 30;
export const TOPICS_MAX = 10;

/** The fields this file adds to course settings. Left out = today's look. */
export interface CourseLook {
  sidebar?: SidebarMode;
  cover_layout?: CoverLayout;
  labels?: Labels;
  tags?: string[];
}

/** The fields this file adds to a lesson. Left out = "". */
export interface LessonLook {
  icon?: string;
  header_image?: string;
  header_alt?: string;
}

// Characters are counted the way the server counts them (code points), never with .length (most emoji count 2).
export const charCount = (s: string) => [...s].length;
export const cutChars = (s: string, n: number) => (charCount(s) > n ? [...s].slice(0, n).join('') : s);

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const sameTopic = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// ---------------------------------------------------------------------------
// Reading saved content (CareHubLearningApi's normalisers)
// ---------------------------------------------------------------------------

export function readLabels(raw: unknown): Labels {
  const r = rec(raw);
  const out: Labels = {};

  LABEL_KEYS.forEach((key) => {
    const v = r[key];
    const word = typeof v === 'string' ? cutChars(v.trim(), LABEL_MAX).trim() : '';

    if (word) out[key] = word;
  });
  return out;
}

/** Topics: trimmed, no commas (a comma splits one), no repeats ignoring case, 1–30 characters, 10 at most. */
export function readTopics(raw: unknown): string[] {
  const out: string[] = [];

  (Array.isArray(raw) ? raw : []).forEach((v) => {
    if (typeof v !== 'string') return;
    v.split(',').forEach((part) => {
      const topic = cutChars(part.trim(), TOPIC_MAX).trim();

      if (topic && out.length < TOPICS_MAX && !out.some((t) => sameTopic(t, topic))) out.push(topic);
    });
  });
  return out;
}

/** Course settings fields, only when they aren't the default (so older courses save exactly as before). */
export function readCourseLook(raw: unknown): CourseLook {
  const s = rec(raw);
  const out: CourseLook = {};
  const labels = readLabels(s.labels);
  const tags = readTopics(s.tags);

  if (s.sidebar === 'closed' || s.sidebar === 'hidden') out.sidebar = s.sidebar;
  if (s.cover_layout === 'split' || s.cover_layout === 'full' || s.cover_layout === 'plain')
    out.cover_layout = s.cover_layout;
  if (Object.keys(labels).length) out.labels = labels;
  if (tags.length) out.tags = tags;
  return out;
}

export function readLessonLook(raw: unknown): LessonLook {
  const r = rec(raw);
  const out: LessonLook = {};
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const icon = cutChars(text(r.icon), ICON_MAX);

  if (icon) out.icon = icon;
  if (text(r.header_image)) out.header_image = text(r.header_image);
  if (text(r.header_alt)) out.header_alt = text(r.header_alt);
  return out;
}

/** The lesson with changed look fields (the same lesson if nothing changed); an emptied field is removed, never saved as "". */
export function withLessonLook<T extends LessonLook>(lesson: T, patch: LessonLook): T {
  const next: T = { ...lesson, ...patch };

  if ((['icon', 'header_image', 'header_alt'] as const).every((k) => (next[k] || '') === (lesson[k] || '')))
    return lesson;
  if (!next.icon) delete next.icon;
  if (!next.header_image) delete next.header_image;
  if (!next.header_alt) delete next.header_alt;
  return next;
}

/** Card topics (older servers don't send them). */
export const cardTopics = (card: Pick<CourseCard, 'tags'>) => (Array.isArray(card.tags) ? card.tags : []);

// ---------------------------------------------------------------------------
// Publish checks (the server makes the same ones, same words)
// ---------------------------------------------------------------------------

export function courseLookProblems(settings: CourseLook, out: string[]) {
  const words = Object.values(rec(settings.labels)).filter((v): v is string => typeof v === 'string');
  const tags = Array.isArray(settings.tags) ? settings.tags : [];

  if (words.some((w) => charCount(w.trim()) > LABEL_MAX))
    out.push(`One of the button and label words is too long (${LABEL_MAX} characters at most).`);
  if (tags.length > TOPICS_MAX) out.push(`A course can have up to ${TOPICS_MAX} topics.`);
  if (tags.some((t) => typeof t !== 'string' || !t.trim() || charCount(t.trim()) > TOPIC_MAX || t.includes(','))) {
    out.push(`Each topic must be 1 to ${TOPIC_MAX} characters, with no commas.`);
  }
}

/** `lesson` = the server's name for it, e.g. Lesson 2 ("Using the CRM"). */
export function lessonLookProblems(l: LessonLook, lesson: string, urlAllowed: (url: string) => boolean, out: string[]) {
  const header = (l.header_image || '').trim();

  if (header && !urlAllowed(header)) {
    out.push(`The header picture link in ${lesson} must start with https:// (or be a Care Hub link starting with /).`);
  }
  if (charCount((l.icon || '').trim()) > ICON_MAX)
    out.push(`The icon in ${lesson} is too long (${ICON_MAX} characters at most).`);
}

// ---------------------------------------------------------------------------
// The player
// ---------------------------------------------------------------------------

export const sidebarOf = (s: CourseLook): SidebarMode =>
  s.sidebar === 'closed' || s.sidebar === 'hidden' ? s.sidebar : 'open';

export const coverLayoutOf = (s: CourseLook): CoverLayout =>
  s.cover_layout === 'split' || s.cover_layout === 'full' || s.cover_layout === 'plain' ? s.cover_layout : 'card';

/** The course's word for `key`, else `usual` (or the player's usual word). */
export type Words = (key: LabelKey, usual?: string) => string;

export function wordsOf(s: CourseLook): Words {
  const labels = rec(s.labels);

  return (key, usual) => {
    const own = labels[key];

    return (typeof own === 'string' && cutChars(own.trim(), LABEL_MAX).trim()) || usual || LABEL_DEFAULTS[key];
  };
}

const TEXT_SIZE_KEY = 'carehub-learning-text-size';
const TEXT_SIZES: { id: TextSize; name: string; zoom: number; px: number }[] = [
  { id: 'normal', name: 'Normal', zoom: 1, px: 12 },
  { id: 'large', name: 'Large', zoom: 1.15, px: 14 },
  { id: 'larger', name: 'Larger', zoom: 1.3, px: 17 },
];

function savedTextSize(): TextSize {
  try {
    const v = window.localStorage.getItem(TEXT_SIZE_KEY);

    return v === 'large' || v === 'larger' ? v : 'normal';
  } catch {
    return 'normal';
  }
}

/** The learner's text size, remembered on this device. */
export function useTextSize(): [TextSize, (size: TextSize) => void] {
  const [size, setSize] = useState<TextSize>(savedTextSize);
  const choose = useCallback((next: TextSize) => {
    setSize(next);
    try {
      window.localStorage.setItem(TEXT_SIZE_KEY, next);
    } catch {
      // Storage is off (e.g. private browsing): the choice lasts until the page closes.
    }
  }, []);

  return [size, choose];
}

/**
 * Bigger text for the start page and the lesson or quiz column. Tailwind sizes are rem-based, so a font size alone
 * wouldn't scale them; CSS zoom scales text, spacing and pictures together and still wraps to the space there is.
 * Normal adds nothing.
 */
export function textZoom(size: TextSize): CSSProperties | undefined {
  const zoom = TEXT_SIZES.find((t) => t.id === size)?.zoom || 1;

  return zoom === 1 ? undefined : { zoom };
}

export function TextSizeControl({ value, onChange }: { value: TextSize; onChange: (size: TextSize) => void }) {
  return (
    <div
      className='inline-flex shrink-0 items-center rounded-[10px] border border-border-primary p-0.5'
      role='group'
      aria-label='Text size'
    >
      {TEXT_SIZES.map((t) => (
        <button
          key={t.id}
          type='button'
          aria-pressed={value === t.id}
          aria-label={t.name}
          title={`${t.name} text`}
          onClick={() => onChange(t.id)}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-[8px] font-semibold leading-none',
            value === t.id ? 'bg-fill-content-hover text-text-primary' : 'text-text-secondary hover:text-text-primary'
          )}
          style={{ fontSize: t.px }}
        >
          A
        </button>
      ))}
    </div>
  );
}

/** A lesson's icon before its title. Decoration: the title says it all. */
export function LessonIcon({ icon, className }: { icon?: string; className?: string }) {
  const i = (icon || '').trim();

  return i ? (
    <span aria-hidden='true' className={cn('mr-1.5', className)}>
      {i}
    </span>
  ) : null;
}

// "Full" start page: the words sit on the picture under a dark layer. White on the layer over a white picture is
// 5.7:1 (the summary 5.0:1), so it stays readable whatever the picture is; darker in dark mode, where the chips are
// lighter. Links go white too.
const LOOK_CSS = `
.chl-look-full{color:#fff}
.chl-look-shade{background:rgba(0,0,0,.6)}
:root[data-dark-mode='true'] .chl-look-shade{background:rgba(0,0,0,.7)}
.chl-look-full .chl-look-soft{color:rgba(255,255,255,.9)}
.chl-look-full h1,.chl-look-full .chl-look-soft{text-shadow:0 1px 3px rgba(0,0,0,.6)}
.chl-look-full .chl-look-soft a{color:#fff !important;text-decoration:underline}
`;

export function LookStyle() {
  return <style data-carehub-learning-look=''>{LOOK_CSS}</style>;
}

// ---------------------------------------------------------------------------
// Studio: start page layout (under the cover picture)
// ---------------------------------------------------------------------------

const LAYOUTS: { id: CoverLayout; name: string; hint: string }[] = [
  { id: 'card', name: 'Card', hint: 'The picture across the top, the words below.' },
  { id: 'split', name: 'Split', hint: 'The picture beside the words (above them on phones).' },
  { id: 'full', name: 'Full', hint: 'The words on the picture, with a dark layer so they stay easy to read.' },
  { id: 'plain', name: 'Plain', hint: 'Just the words, no picture.' },
];

function LayoutSketch({ id }: { id: CoverLayout }) {
  const lines = (
    <span className='flex min-w-0 flex-1 flex-col justify-center gap-1 p-1.5'>
      <span className='block h-1 w-4/5 rounded-full bg-current opacity-70' />
      <span className='block h-1 w-3/5 rounded-full bg-current opacity-40' />
    </span>
  );

  return (
    <span
      aria-hidden='true'
      className={cn(
        'relative flex h-12 w-full overflow-hidden rounded-[6px] border border-border-primary',
        id === 'card' && 'flex-col',
        id === 'full' && 'chl-cover chl-cover-0 chl-look-full'
      )}
    >
      {id === 'card' && <span className='chl-cover chl-cover-0 block h-5 shrink-0' />}
      {id === 'split' && <span className='chl-cover chl-cover-0 block w-2/5 shrink-0' />}
      {id === 'full' && <span className='chl-look-shade absolute inset-0' />}
      <span className={cn('relative flex min-w-0 flex-1', id === 'full' && 'items-end')}>{lines}</span>
    </span>
  );
}

export function CoverLayoutField({
  value,
  onChange,
}: {
  value?: CoverLayout;
  onChange: (layout: CoverLayout | undefined) => void;
}) {
  const id = useId();
  const now = coverLayoutOf({ cover_layout: value });

  return (
    <div className='flex min-w-0 flex-col gap-1'>
      <LookStyle />
      <span id={`${id}-label`} className='text-xs font-medium text-text-secondary'>
        Start page layout
      </span>
      <div role='group' aria-labelledby={`${id}-label`} aria-describedby={`${id}-hint`} className='flex flex-wrap gap-2'>
        {LAYOUTS.map((o) => (
          <button
            key={o.id}
            type='button'
            aria-pressed={now === o.id}
            onClick={() => now !== o.id && onChange(o.id === 'card' ? undefined : o.id)}
            className={cn(
              'flex w-[84px] flex-col items-stretch gap-1 rounded-[10px] border p-1.5 text-xs',
              now === o.id
                ? 'border-border-theme-thick bg-fill-content-hover font-medium text-text-primary'
                : 'border-border-primary text-text-secondary hover:text-text-primary'
            )}
          >
            <LayoutSketch id={o.id} />
            {o.name}
          </button>
        ))}
      </div>
      <span id={`${id}-hint`} className='text-xs text-text-tertiary'>
        {LAYOUTS.find((o) => o.id === now)?.hint}
        {now === 'plain' ? '' : ' No cover picture? The course’s pattern shows instead.'}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Studio: course settings (end of the Course settings panel)
// ---------------------------------------------------------------------------

const SIDEBAR_OPTIONS: { value: SidebarMode; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'hidden', label: 'Hidden' },
];

const SIDEBAR_HINT: Record<SidebarMode, string> = {
  open: 'The list of lessons shows beside each lesson. On phones it opens from the Lessons button.',
  closed: 'The list starts closed. People open it with the Lessons button.',
  hidden:
    'No lesson list and no Lessons button. People move on with Next and Previous, and the buttons and links in lessons.',
};

function WordsField({ labels, onChange }: { labels?: Labels; onChange: (labels: Labels | undefined) => void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const own = rec(labels);
  const changed = LABEL_KEYS.filter((k) => typeof own[k] === 'string' && String(own[k]).trim()).length;
  const set = (key: LabelKey, text: string) => {
    const next: Labels = { ...readLabelsLoose(labels) };
    const word = cutChars(text, LABEL_MAX);

    if (word.trim()) next[key] = word;
    else delete next[key];
    onChange(Object.keys(next).length ? next : undefined);
  };

  return (
    <div className='flex min-w-0 flex-col gap-2'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-xs font-medium text-text-secondary'>Button and label words</span>
        <button
          type='button'
          aria-expanded={open}
          aria-controls={open ? `${id}-words` : undefined}
          className='text-xs font-medium text-text-action hover:underline'
          onClick={() => setOpen(!open)}
        >
          {open ? 'Hide the words' : changed ? `Change the words (${changed} changed)` : 'Change the words'}
        </button>
      </div>
      <span className='text-xs text-text-tertiary'>
        Use your own words on the player’s buttons. An empty box keeps the usual word.
      </span>
      {open && (
        <div id={`${id}-words`} className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
          {LABEL_KEYS.map((key) => (
            <label key={key} className='flex min-w-0 flex-col gap-1'>
              <span className='text-xs font-medium text-text-secondary'>{LABEL_DEFAULTS[key]}</span>
              <input
                type='text'
                value={typeof own[key] === 'string' ? String(own[key]) : ''}
                placeholder={LABEL_DEFAULTS[key]}
                aria-describedby={`${id}-${key}`}
                className={chInputClass}
                onChange={(e) => set(key, e.target.value)}
              />
              <span id={`${id}-${key}`} className='text-xs text-text-tertiary'>
                {LABEL_WHERE[key]}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/** Words as typed (not trimmed yet), known keys only. */
function readLabelsLoose(labels?: Labels): Labels {
  const r = rec(labels);
  const out: Labels = {};

  LABEL_KEYS.forEach((key) => {
    const v = r[key];

    if (typeof v === 'string' && v.trim()) out[key] = cutChars(v, LABEL_MAX);
  });
  return out;
}

function TopicsField({
  value,
  onChange,
  suggestions,
}: {
  value: string[];
  onChange: (tags: string[] | undefined) => void;
  suggestions: string[];
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const full = value.length >= TOPICS_MAX;
  const add = (parts: string[]) => {
    const next = [...value];
    let why = '';

    parts.forEach((part) => {
      const topic = cutChars(part.trim(), TOPIC_MAX).trim();

      if (!topic) return;
      if (next.some((t) => sameTopic(t, topic))) why = `“${topic}” is already a topic.`;
      else if (next.length >= TOPICS_MAX) why = `A course can have up to ${TOPICS_MAX} topics.`;
      else next.push(topic);
    });
    if (next.length !== value.length) onChange(next);
    setNote(why);
  };
  const remove = (topic: string) => {
    const next = value.filter((t) => t !== topic);

    onChange(next.length ? next : undefined);
    setNote('');
    inputRef.current?.focus();
  };
  const typed = text.trim().toLowerCase();
  const offer = suggestions
    .filter((s) => !value.some((t) => sameTopic(t, s)) && (!typed || s.toLowerCase().includes(typed)))
    .slice(0, 8);

  return (
    <div className='flex min-w-0 flex-col gap-2'>
      {value.length > 0 && (
        <ul className='m-0 flex list-none flex-wrap gap-1.5 p-0' aria-label='Topics'>
          {value.map((t) => (
            <li key={t} className='chl-chip chl-blue max-w-full py-0.5 pr-1'>
              <span className='min-w-0 truncate'>{t}</span>
              <button
                type='button'
                aria-label={`Remove topic ${t}`}
                className='flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-sm leading-none hover:bg-fill-content-hover'
                onClick={() => remove(t)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={inputRef}
        type='text'
        value={text}
        disabled={full}
        placeholder={full ? `${TOPICS_MAX} topics added` : 'Type a topic, then press Enter'}
        aria-label='Add a topic'
        aria-describedby={`${id}-hint`}
        className={cn(chInputClass, 'w-full max-w-[360px]')}
        onChange={(e) => {
          const parts = e.target.value.split(',');

          if (parts.length > 1) add(parts.slice(0, -1));
          setText(cutChars(parts[parts.length - 1], TOPIC_MAX));
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          add([text]);
          setText('');
        }}
        onBlur={() => {
          if (!text.trim()) return;
          add([text]);
          setText('');
        }}
      />
      <span id={`${id}-hint`} className='text-xs text-text-tertiary'>
        Up to {TOPICS_MAX} topics of {TOPIC_MAX} characters or fewer. Press Enter or type a comma after each one.
      </span>
      <span aria-live='polite' className='text-xs text-text-secondary empty:hidden'>
        {note}
      </span>
      {!full && offer.length > 0 && (
        <div className='flex flex-wrap items-center gap-1.5'>
          <span className='text-xs text-text-tertiary'>In the Catalog:</span>
          {offer.map((s) => (
            <button
              key={s}
              type='button'
              aria-label={`Add topic ${s}`}
              className='rounded-full border border-border-primary px-2 py-0.5 text-xs text-text-secondary hover:bg-fill-content-hover hover:text-text-primary'
              onClick={() => add([s])}
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Topics used across the Catalog (for suggestions and the Topic filter), A–Z, each once. */
export function catalogTopics(cards: CourseCard[]): string[] {
  const out: string[] = [];

  cards.forEach((c) => {
    if (!c.archived) cardTopics(c).forEach((t) => out.some((x) => sameTopic(x, t)) || out.push(t));
  });
  return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/** Topics, the lesson list and the button words. `loadCatalog` gives topic suggestions (none if it fails). */
export function CourseLookSettings({
  settings,
  onChange,
  loadCatalog,
}: {
  settings: CourseLook;
  onChange: (patch: CourseLook) => void;
  loadCatalog?: () => Promise<CourseCard[]>;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const load = useRef(loadCatalog);
  const mode = sidebarOf(settings);

  useEffect(() => {
    let alive = true;

    load.current?.().then(
      (cards) => alive && setSuggestions(catalogTopics(cards)),
      () => undefined
    );
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      <ChSection
        title='Topics'
        hint='Shown on the course in the Catalog, where people can pick a topic to find courses.'
      >
        <TopicsField
          value={readTopicsLoose(settings.tags)}
          onChange={(tags) => onChange({ tags })}
          suggestions={suggestions}
        />
      </ChSection>
      <ChSection
        title='How it looks'
        hint='For everyone taking the course. People can also pick a bigger text size for themselves.'
      >
        <div className='flex flex-col gap-4'>
          <label className='flex min-w-0 flex-col gap-1'>
            <span className='text-xs font-medium text-text-secondary'>Lesson list</span>
            <ChSelect
              value={mode}
              options={SIDEBAR_OPTIONS}
              onChange={(v) => onChange({ sidebar: v === 'open' ? undefined : v })}
              className='self-start'
            />
            <span className='text-xs text-text-tertiary'>{SIDEBAR_HINT[mode]}</span>
          </label>
          <WordsField labels={settings.labels} onChange={(labels) => onChange({ labels })} />
        </div>
      </ChSection>
    </>
  );
}

function readTopicsLoose(tags?: string[]) {
  return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string') : [];
}

// ---------------------------------------------------------------------------
// Studio: a lesson's icon and header picture (after its minimum time)
// ---------------------------------------------------------------------------

/** Work-related emoji for lesson icons (each well under ICON_MAX code points). */
const LESSON_ICONS: [string, string][] = [
  ['👋', 'Waving hand'],
  ['📘', 'Book'],
  ['📝', 'Notes'],
  ['💡', 'Light bulb'],
  ['🎯', 'Target'],
  ['🧩', 'Puzzle piece'],
  ['⭐', 'Star'],
  ['🏆', 'Trophy'],
  ['🎓', 'Graduation cap'],
  ['🧭', 'Compass'],
  ['🔑', 'Key'],
  ['📌', 'Pin'],
  ['🛡️', 'Shield'],
  ['⚠️', 'Warning'],
  ['❓', 'Question mark'],
  ['💬', 'Speech bubble'],
  ['📞', 'Phone'],
  ['✉️', 'Envelope'],
  ['💳', 'Bank card'],
  ['💰', 'Money bag'],
  ['🧾', 'Receipt'],
  ['📊', 'Bar chart'],
  ['📋', 'Clipboard'],
  ['📅', 'Calendar'],
  ['⏱️', 'Stopwatch'],
  ['🛠️', 'Tools'],
  ['⚙️', 'Gear'],
  ['🤝', 'Handshake'],
  ['👥', 'People'],
  ['🚀', 'Rocket'],
];

function IconPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const name = value ? LESSON_ICONS.find(([e]) => e === value)?.[1] || 'Your own icon' : 'None';
  const pick = (icon: string) => {
    onChange(icon);
    setOpen(false);
    toggle.current?.focus();
  };
  const cell = (on: boolean) =>
    cn(
      'flex h-9 items-center justify-center rounded-[8px] border text-lg leading-none',
      on ? 'border-border-theme-thick bg-fill-content-hover' : 'border-transparent hover:bg-fill-content-hover'
    );

  return (
    <div className='flex min-w-0 flex-col gap-1'>
      <span id={`${id}-label`} className='text-xs font-medium text-text-secondary'>
        Icon
      </span>
      <button
        ref={toggle}
        type='button'
        aria-expanded={open}
        aria-controls={open ? `${id}-icons` : undefined}
        aria-labelledby={`${id}-label ${id}-now`}
        className={cn(chInputClass, 'flex items-center gap-2 self-start text-left')}
        onClick={() => setOpen(!open)}
      >
        {value && (
          <span aria-hidden='true' className='text-base leading-none'>
            {value}
          </span>
        )}
        <span id={`${id}-now`}>{name}</span>
        <svg
          width='12'
          height='12'
          viewBox='0 0 12 12'
          fill='none'
          aria-hidden='true'
          focusable='false'
          className={cn('shrink-0', open && 'rotate-180')}
        >
          <path
            d='M3 4.5l3 3 3-3'
            stroke='currentColor'
            strokeWidth='1.5'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
        </svg>
      </button>
      {open && (
        <div
          id={`${id}-icons`}
          role='group'
          aria-label='Lesson icons'
          className='grid grid-cols-6 gap-1 rounded-[10px] border border-border-primary p-1.5'
        >
          <button
            type='button'
            aria-pressed={!value}
            className={cn(cell(!value), 'col-span-2 text-xs')}
            onClick={() => pick('')}
          >
            None
          </button>
          {LESSON_ICONS.map(([icon, label]) => (
            <button
              key={icon}
              type='button'
              aria-pressed={value === icon}
              aria-label={label}
              title={label}
              className={cell(value === icon)}
              onClick={() => pick(icon)}
            >
              <span aria-hidden='true'>{icon}</span>
            </button>
          ))}
        </div>
      )}
      <span className='text-xs text-text-tertiary'>Shows before the lesson’s title.</span>
    </div>
  );
}

/** Studio's picture field (upload or link), passed in so this file doesn't import Studio. */
export type LookMediaField = ComponentType<{
  kind: 'image';
  label: string;
  value: string;
  onChange: (url: string) => void;
  hint?: ReactNode;
}>;

export function LessonLookEditor({
  lesson,
  update,
  media: Media,
}: {
  lesson: Lesson;
  update: (fn: (l: Lesson) => Lesson) => void;
  media: LookMediaField;
}) {
  const id = useId();
  const set = (patch: LessonLook) => update((l) => withLessonLook(l, patch));
  const header = lesson.header_image || '';

  return (
    <div className='grid grid-cols-1 gap-3 sm:grid-cols-2' data-testid='carehub-learning-lesson-look'>
      <IconPicker value={lesson.icon || ''} onChange={(icon) => set({ icon })} />
      <div className='flex min-w-0 flex-col gap-2'>
        <Media
          kind='image'
          label='Header picture'
          value={header}
          onChange={(v) => set({ header_image: v })}
          hint='Optional. A wide picture across the top of the lesson.'
        />
        {header && (
          <>
            <label className='flex min-w-0 flex-col gap-1'>
              <span className='text-xs font-medium text-text-secondary'>Header picture description</span>
              <input
                type='text'
                value={lesson.header_alt || ''}
                maxLength={300}
                placeholder='What the picture shows'
                aria-describedby={`${id}-alt`}
                className={chInputClass}
                onChange={(e) => set({ header_alt: e.target.value })}
              />
              <span id={`${id}-alt`} className='text-xs text-text-tertiary'>
                For people who can’t see it. Leave it empty if the picture is only decoration.
              </span>
            </label>
            <button
              type='button'
              className='self-start text-xs text-text-secondary hover:text-text-primary hover:underline'
              onClick={() => set({ header_image: '', header_alt: '' })}
            >
              Remove header picture
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The Catalog: topics on course tiles, and the Topic filter
// ---------------------------------------------------------------------------

export function TopicChips({ topics, max = 3 }: { topics: string[]; max?: number }) {
  if (!topics.length) return null;
  const shown = topics.slice(0, max);
  const more = topics.length - shown.length;

  return (
    <span className='flex min-w-0 flex-wrap gap-1'>
      <span className='sr-only'>Topics: </span>
      {shown.map((t, i) => (
        <span key={t} className='chl-chip chl-blue max-w-full'>
          <span className='min-w-0 truncate'>{t}</span>
          {i < shown.length - 1 || more > 0 ? <span className='sr-only'>, </span> : null}
        </span>
      ))}
      {more > 0 && (
        <span className='chl-chip chl-gray' title={topics.slice(max).join(', ')}>
          +{more}
          <span className='sr-only'> more</span>
        </span>
      )}
    </span>
  );
}

/** "Topic: All · Safety · …" toggle buttons; '' = all. Nothing when no course has a topic. */
export function TopicFilter({
  topics,
  value,
  onChange,
}: {
  topics: string[];
  value: string;
  onChange: (topic: string) => void;
}) {
  if (!topics.length) return null;
  const pill = (on: boolean) =>
    cn(
      'max-w-full truncate rounded-full border px-2.5 py-1 text-xs',
      on
        ? 'border-border-theme-thick bg-fill-content-hover font-medium text-text-primary'
        : 'border-border-primary text-text-secondary hover:text-text-primary'
    );

  return (
    <div
      role='group'
      aria-label='Topic'
      className='mb-3 flex min-w-0 flex-wrap items-center gap-1.5'
      data-testid='carehub-learning-topics'
    >
      <span className='text-xs font-medium text-text-secondary' aria-hidden='true'>
        Topic:
      </span>
      <button type='button' aria-pressed={!value} className={pill(!value)} onClick={() => onChange('')}>
        All
      </button>
      {topics.map((t) => {
        const on = Boolean(value) && sameTopic(value, t);

        return (
          <button key={t} type='button' aria-pressed={on} className={pill(on)} onClick={() => onChange(on ? '' : t)}>
            {t}
          </button>
        );
      })}
    </div>
  );
}

/** Does the card have this topic ('' = any)? */
export const hasTopic = (card: Pick<CourseCard, 'tags'>, topic: string) =>
  !topic || cardTopics(card).some((t) => sameTopic(t, topic));

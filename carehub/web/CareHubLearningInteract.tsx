// CareHub Learning: three more question kinds (fill in the blank, put in order, click the right spot) and the
// labeled graphic block (a picture with numbered notes). Everything for them lives here; the other Learning files
// only call in. Grading and the publish checks follow P3-QKINDS, with the same words as the server.
//
// Only types come from the other Learning files: they import this file, so runtime imports would make a cycle.
// Rich text, picture downloads and the Studio's picture field are passed in as props instead.

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type {
  ComponentType,
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { chInputClass } from './CareHubUi';

import type { Answer } from './CareHubLearningApi';

// ---------------------------------------------------------------------------
// Types and limits
// ---------------------------------------------------------------------------

export type InteractKind = 'fill_blank' | 'ordering' | 'hotspot';

export const INTERACT_KINDS: InteractKind[] = ['fill_blank', 'ordering', 'hotspot'];

/** Names for the "Type of question" menu and the "Add a question" buttons. */
export const INTERACT_KIND_OPTIONS: { value: InteractKind; label: string }[] = [
  { value: 'fill_blank', label: 'Fill in the blank' },
  { value: 'ordering', label: 'Put in order' },
  { value: 'hotspot', label: 'Click the right spot' },
];

/** The labeled graphic's entry in the Studio's block library. */
export const LABELED_GRAPHIC_INFO = {
  emoji: '📍',
  label: 'Labeled graphic',
  hint: 'Notes on a picture, e.g. each part of a screen',
};

export interface Picture {
  url: string;
  alt: string;
}

/** A put-in-order item. Final-quiz questions from the server have an opaque token instead of an id. */
export interface OrderItem {
  id: string;
  text: string;
  token?: string;
}

/** A rectangle in percent of the picture's width and height. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Spot extends Box {
  id: string;
}

/** A click on the picture, in percent of its width and height (0–100). */
export interface Point {
  x: number;
  y: number;
}

/** A numbered note on a labeled graphic; x and y are the marker's centre, in percent. */
export interface Marker {
  id: string;
  x: number;
  y: number;
  title: string;
  text: string;
}

/** What the three kinds add to a question. Each kind uses only its own fields. */
export interface InteractQuestionFields {
  /** fill_blank: the accepted answers. */
  answers?: string[];
  /** fill_blank: capital letters must match (final-quiz questions have it only when the server sends it). */
  case_sensitive?: boolean;
  /** fill_blank, final quiz only: the server took the accepted answers out. */
  blank?: boolean;
  /** ordering: stored in the right order (the final quiz sends them shuffled, with tokens). */
  items?: OrderItem[];
  /** hotspot: the picture to click. */
  image?: Picture;
  /** hotspot: the right spots (never sent to learners in the final quiz). */
  spots?: Spot[];
}

/** The parts of a question this file needs (CareHubLearningApi's Question fits). */
export interface InteractQuestion extends InteractQuestionFields {
  id: string;
  kind: string;
  prompt: string;
}

export interface LabeledGraphicBlock {
  id: string;
  type: 'labeled_graphic';
  image: Picture;
  markers: Marker[];
}

/** Where to show a picture link from (Care Hub files are downloaded with the sign-in token first). */
export type PictureSrc = {
  src: string;
  state: 'loading' | 'ready' | 'failed';
  percent?: number;
  fail?: () => void;
  retry?: () => void;
};

export type UsePictureSrc = (link: string) => PictureSrc;

/** Draws the picture link field (the Studio passes its upload field). */
export type PictureField = (value: string, onChange: (url: string) => void) => ReactNode;

/** Shows question text (the player passes its rich text). */
export type TextView = ComponentType<{ text: string }>;

const MAX_ANSWERS = 10;
const MAX_ACCEPTED_CHARS = 80;
const MAX_TYPED_CHARS = 200;
const MAX_ITEMS = 10;
const MAX_ITEM_CHARS = 200;
const MAX_SPOTS = 5;
const MIN_SPOT = 2;
const MAX_ALT_CHARS = 300;
const MAX_MARKERS = 20;
const MAX_TITLE_CHARS = 80;
const MAX_NOTE_CHARS = 1000;
const BLANK_RE = /_{3,}/;
const NO_PICTURE: Picture = { url: '', alt: '' };

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const tenth = (n: number) => Math.round(n * 10) / 10;
/** Length in characters, the way the server counts them (not UTF-16 units). */
const chars = (s: string) => Array.from(s).length;
/** Hotspot answers and right spots are objects of numbers, which the shared Answer type doesn't list. */
const toAnswer = (v: unknown) => v as Answer;
/** Text without rich text marks, for labels that screen readers read. */
const plain = (s: string) =>
  s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

function makeId(prefix: string) {
  const bytes = new Uint8Array(8);

  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }

  let s = '';

  for (const b of bytes) s += ID_CHARS[b % ID_CHARS.length];
  return `${prefix}_${s}`;
}

/** The same order every time for the same seed (FNV-1a hash, then mulberry32). */
function seededShuffle<T>(list: T[], seed: string): T[] {
  let h = 0x811c9dc5;

  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193) >>> 0;
  const next = () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = list.slice();

  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const tmp = out[i];

    out[i] = out[j];
    out[j] = tmp;
  }

  return out;
}

function arrayMove<T>(list: T[], from: number, to: number): T[] {
  const out = list.slice();
  const [moved] = out.splice(from, 1);

  out.splice(to, 0, moved);
  return out;
}

/** Same rule as urlAllowed in CareHubLearningApi: https://, a Care Hub link starting with /, or localhost. */
export function pictureLinkOk(url: string) {
  // Like the server: no control characters anywhere in the link, not even around it.
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);

    if (c <= 0x1f || c === 0x7f) return false;
  }

  const u = url.trim();

  if (!u) return false;
  if (/^https:\/\/\S+$/i.test(u)) return true;
  if (/^http:\/\/localhost(:\d+)?(\/\S*)?$/i.test(u)) return true;
  // "//host/x.png" and "/\host/x.png" would load a picture from another website.
  return u.startsWith('/') && !u.startsWith('//') && !u.startsWith('/\\');
}

export function isInteractKind(kind: unknown): kind is InteractKind {
  return kind === 'fill_blank' || kind === 'ordering' || kind === 'hotspot';
}

// ---------------------------------------------------------------------------
// Reading stored content
// ---------------------------------------------------------------------------

function readPicture(v: unknown): Picture {
  const o = obj(v);

  return { url: str(o.url), alt: str(o.alt) };
}

function readBox(v: unknown): Box | null {
  const o = obj(v);
  const x = num(o.x);
  const y = num(o.y);
  const w = num(o.w);
  const h = num(o.h);

  return x === null || y === null || w === null || h === null ? null : { x, y, w, h };
}

function readBoxes(v: unknown): Box[] {
  return arr(v)
    .map(readBox)
    .filter((b): b is Box => b !== null);
}

/** A hotspot answer: {x, y}, both 0–100. */
function readPoint(v: unknown): Point | null {
  const o = obj(v);
  const x = num(o.x);
  const y = num(o.y);

  return x === null || y === null || x < 0 || x > 100 || y < 0 || y > 100 ? null : { x, y };
}

/**
 * The new kinds' fields of a stored question, or of a final-quiz question from the server (`raw` is the whole
 * question object). Other kinds get none.
 */
export function interactFields(raw: unknown, kind: string): InteractQuestionFields {
  const o = obj(raw);

  if (kind === 'fill_blank') {
    const f: InteractQuestionFields = {
      answers: arr(o.answers).filter((a): a is string => typeof a === 'string'),
      case_sensitive: o.case_sensitive === true,
    };

    if (o.blank === true) {
      f.blank = true;
      // Final-quiz questions: only what the server says (missing = this page can't tell).
      if (typeof o.case_sensitive !== 'boolean') delete f.case_sensitive;
    }

    return f;
  }

  if (kind === 'ordering') {
    return {
      items: arr(o.items).map((x) => {
        const it = obj(x);
        const token = str(it.token);

        return token ? { id: str(it.id), text: str(it.text), token } : { id: str(it.id) || makeId('i'), text: str(it.text) };
      }),
    };
  }

  if (kind === 'hotspot') {
    const spots: Spot[] = [];

    for (const s of arr(o.spots)) {
      const b = readBox(s);

      if (b) spots.push({ id: str(obj(s).id) || makeId('s'), ...b });
    }

    return { image: readPicture(o.image), spots };
  }

  return {};
}

export function normalizeLabeledGraphic(raw: unknown, id: string): LabeledGraphicBlock {
  const o = obj(raw);

  return {
    id,
    type: 'labeled_graphic',
    image: readPicture(o.image),
    markers: arr(o.markers).map((x) => {
      const m = obj(x);

      return {
        id: str(m.id) || makeId('m'),
        x: clamp(num(m.x) ?? 50, 0, 100),
        y: clamp(num(m.y) ?? 50, 0, 100),
        title: str(m.title),
        text: str(m.text),
      };
    }),
  };
}

export function blankLabeledGraphic(id: string): LabeledGraphicBlock {
  return { id, type: 'labeled_graphic', image: { url: '', alt: '' }, markers: [] };
}

const FIELD_KEYS: (keyof InteractQuestionFields)[] = ['answers', 'case_sensitive', 'blank', 'items', 'image', 'spots'];

/** A copy without the new kinds' fields (for a question that switches to one of the older kinds). */
export function withoutInteractFields<Q extends InteractQuestionFields>(q: Q): Q {
  const next = { ...q };

  for (const k of FIELD_KEYS) delete (next as InteractQuestionFields)[k];
  return next;
}

type SeedQuestion = InteractQuestion & { options?: { text: string; correct: boolean }[] };

/** Switches a question to one of the new kinds, starting from its old answers where that makes sense. */
export function toInteractKind<Q extends SeedQuestion>(q: Q, kind: InteractKind): Q {
  if (q.kind === kind) return q;
  const choices = q.kind === 'single' || q.kind === 'multiple' ? (q.options || []).filter((o) => o.text.trim()) : [];
  const next = { ...withoutInteractFields(q), kind, options: [], pairs: [] } as Q;

  if (kind === 'fill_blank') {
    const right = choices.find((o) => o.correct);

    next.answers = [right ? right.text.trim().slice(0, MAX_ACCEPTED_CHARS) : ''];
    next.case_sensitive = false;
  } else if (kind === 'ordering') {
    const texts = choices.length >= 2 ? choices.slice(0, MAX_ITEMS).map((o) => o.text.trim().slice(0, MAX_ITEM_CHARS)) : ['', '', ''];

    next.items = texts.map((text) => ({ id: makeId('i'), text }));
  } else {
    next.image = { url: '', alt: '' };
    next.spots = [];
  }

  return next;
}

// ---------------------------------------------------------------------------
// Publish checks (the same words as the server)
// ---------------------------------------------------------------------------

function pictureProblem(url: string, who: string, out: string[]) {
  if (!url.trim()) out.push(`${who} needs a picture.`);
  else if (!pictureLinkOk(url)) out.push(`${who} needs a picture link that starts with https:// (or a Care Hub link starting with /).`);
}

function insidePicture(b: Box) {
  const e = 0.000001;

  return b.x >= -e && b.y >= -e && b.w >= MIN_SPOT - e && b.h >= MIN_SPOT - e && b.x + b.w <= 100 + e && b.y + b.h <= 100 + e;
}

/** Checks for the new kinds (call after the shared "needs a question" check). */
export function interactQuestionProblems(q: InteractQuestion, label: string, out: string[]) {
  if (q.kind === 'fill_blank') {
    const accepted = acceptedAnswers(q);

    if (!accepted.length) out.push(`${label} needs at least one accepted answer.`);
    else if (accepted.some((a) => chars(a) > MAX_ACCEPTED_CHARS)) out.push(`${label} has an accepted answer that is too long.`);
  } else if (q.kind === 'ordering') {
    const items = q.items || [];
    const seen = new Set<string>();
    const badIds = items.some((it) => {
      const id = it.id.trim();
      const bad = !id || seen.has(id);

      seen.add(id);
      return bad;
    });

    if (items.length < 2) out.push(`${label} needs at least two items to put in order.`);
    else if (items.some((it) => !it.text.trim())) out.push(`${label} has an empty item.`);
    else if (badIds) out.push(`${label} has items with missing or repeated ids. Try deleting and re-adding them.`);
  } else if (q.kind === 'hotspot') {
    const image = q.image || NO_PICTURE;
    const spots = q.spots || [];

    pictureProblem(image.url, label, out);
    if (!image.alt.trim()) out.push(`${label} needs a picture description.`);
    if (!spots.length) out.push(`${label} needs at least one right spot.`);
    else if (spots.some((s) => !insidePicture(s))) out.push(`${label} has a spot outside the picture.`);
  }
}

/** Checks for a labeled graphic block; `at` names the lesson, e.g. `"Welcome"` or `Lesson 2`. */
export function labeledGraphicProblems(b: LabeledGraphicBlock, at: string, out: string[]) {
  const who = `The labeled graphic in ${at}`;

  pictureProblem(b.image.url, who, out);
  if (!b.image.alt.trim()) out.push(`${who} needs a picture description.`);
  if (!b.markers.length) out.push(`${who} needs at least one marker.`);
  else if (b.markers.some((m) => !m.title.trim())) out.push(`${who} has a marker without a title.`);
}

// ---------------------------------------------------------------------------
// Answering and grading in the browser (knowledge checks and the Studio preview)
// ---------------------------------------------------------------------------

/** Fill-in-the-blank match form: trimmed, one space between words, one full stop at the end dropped, lowercase unless capitals must match. */
export function normalizeBlank(raw: string, caseSensitive: boolean) {
  let s = raw.trim().replace(/\s+/g, ' ');

  if (s.endsWith('.')) s = s.slice(0, -1);
  return caseSensitive ? s : s.toLowerCase();
}

/** Accepted answers, trimmed, without empty ones (the server skips those too). */
function acceptedAnswers(q: InteractQuestionFields) {
  return (q.answers || []).map((a) => a.trim()).filter((a) => normalizeBlank(a, true) !== '');
}

function blankRight(typed: string, accepted: string[], caseSensitive: boolean) {
  if (chars(typed) > MAX_TYPED_CHARS) return false;
  const got = normalizeBlank(typed, caseSensitive);

  return got !== '' && accepted.some((a) => normalizeBlank(a, caseSensitive) === got);
}

const keyOf = (it: OrderItem) => it.token || it.id;

/** Every item used once, and the texts read in the right order (items with the same text are interchangeable). */
function orderRight(items: OrderItem[], a: unknown) {
  if (!Array.isArray(a) || !items.length || a.length !== items.length) return false;
  const index = new Map(items.map((it, i) => [keyOf(it), i]));
  const used = new Set<number>();

  return a.every((k, pos) => {
    const i = typeof k === 'string' ? index.get(k) : undefined;

    if (i === undefined || used.has(i)) return false;
    used.add(i);
    return items[i].text.trim() === items[pos].text.trim();
  });
}

/** Inside the box; edges count. */
const inBox = (b: Box, p: Point) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

/** Grades a full (not sanitized) question of one of the new kinds. All-or-nothing, like the others. */
export function gradeInteract(q: InteractQuestion, a: Answer | undefined): boolean {
  if (q.kind === 'fill_blank') return typeof a === 'string' && blankRight(a, acceptedAnswers(q), q.case_sensitive === true);
  if (q.kind === 'ordering') return orderRight(q.items || [], a);
  if (q.kind === 'hotspot') {
    const p = readPoint(a);

    return p !== null && (q.spots || []).some((s) => inBox(s, p));
  }

  return false;
}

export function interactAnswered(q: InteractQuestion, a: Answer | undefined): boolean {
  if (q.kind === 'fill_blank') return typeof a === 'string' && a.trim() !== '';
  if (q.kind === 'ordering') return Array.isArray(a) && a.length > 0 && a.length === (q.items || []).length;
  return readPoint(a) !== null;
}

/** The right answer, in the same form the server sends after a quiz (for showing after a check). */
export function interactCorrectAnswer(q: InteractQuestion): Answer {
  if (q.kind === 'fill_blank') return acceptedAnswers(q);
  if (q.kind === 'ordering') return (q.items || []).map(keyOf);
  return toAnswer((q.spots || []).map(({ x, y, w, h }) => ({ x, y, w, h })));
}

/** A saved answer, if it has the right shape for the question. */
export function coerceInteractAnswer(q: InteractQuestion, raw: unknown): Answer | undefined {
  if (q.kind === 'fill_blank') return typeof raw === 'string' ? raw : undefined;
  if (q.kind === 'ordering') return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : undefined;
  const p = readPoint(raw);

  return p ? toAnswer(p) : undefined;
}

/** Words for an answer or a right answer, e.g. "Mix → Bake → Cool". */
export function interactAnswerText(q: InteractQuestion, a: Answer | undefined): string {
  if (a === undefined || a === null) return '';
  if (q.kind === 'fill_blank') {
    const all: unknown[] = Array.isArray(a) ? a : [a];
    const list = all.filter((s): s is string => typeof s === 'string' && s.trim() !== '');

    if (list.length <= 1) return list[0] || '';
    return `${list[0]} (also accepted: ${list.slice(1).join(', ')})`;
  }

  if (q.kind === 'ordering') {
    const items = q.items || [];

    return Array.isArray(a) ? a.map((k) => items.find((it) => keyOf(it) === k)?.text.trim() || '…').join(' → ') : '';
  }

  const p = readPoint(a);

  if (p) return `A spot ${Math.round(p.x)}% across and ${Math.round(p.y)}% down the picture`;
  const n = readBoxes(a).length;

  if (!n) return '';
  return n === 1 ? 'The marked spot on the picture' : `${n} marked spots on the picture`;
}

/** Rough time to look at a labeled graphic, in seconds (for the course length estimate). */
export function labeledGraphicSeconds(b: LabeledGraphicBlock) {
  return b.markers.reduce((n, m) => {
    const t = `${m.title} ${m.text}`.trim();

    return n + 5 + (t ? t.split(/\s+/).length : 0) * 0.3;
  }, 10);
}

/** Unique row keys: item ids, or the server's tokens in the final quiz. */
function itemKeys(items: OrderItem[]) {
  const seen = new Set<string>();

  return items.map((it, i) => {
    let k = keyOf(it) || `#${i}`;

    if (seen.has(k)) k = `${k}#${i}`;
    seen.add(k);
    return k;
  });
}

/** Where learners start: as the server sent it, or (practice and preview) a stable shuffle that never starts out right. */
function startOrder(qid: string, items: OrderItem[], keys: string[]) {
  if (items.some((it) => it.token)) return keys;
  const idx = seededShuffle(
    keys.map((_, i) => i),
    `${qid}:items`
  );
  const looksRight = idx.every((i, pos) => items[i].text.trim() === items[pos].text.trim());

  if (looksRight && idx.length > 1) idx.push(idx.shift() as number);
  return idx.map((i) => keys[i]);
}

/** The answer as an order of row keys, if it is one. */
function validOrder(a: unknown, keys: string[]): string[] | null {
  if (!Array.isArray(a) || !keys.length || a.length !== keys.length) return null;
  const known = new Set(keys);
  const seen = new Set<string>();

  for (const k of a) {
    if (typeof k !== 'string' || !known.has(k) || seen.has(k)) return null;
    seen.add(k);
  }

  return a as string[];
}

// ---------------------------------------------------------------------------
// Styles (dark mode follows the app's data-dark-mode, like the other Learning styles)
// ---------------------------------------------------------------------------

const INTERACT_CSS = `
.chi-sr{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.chi-frame{position:relative;margin:0 auto;max-width:100%}
.chi-frame>img{display:block;width:100%;height:auto;border-radius:10px;-webkit-user-select:none;user-select:none;-webkit-user-drag:none;-webkit-touch-callout:none}
.chi-layer{position:absolute;inset:0;border-radius:10px;-webkit-user-select:none;user-select:none}
.chi-layer:focus-visible{outline:3px solid #2563eb;outline-offset:3px}
.chi-pick{cursor:crosshair;touch-action:manipulation}
.chi-draw{touch-action:none}
.chi-dot{position:absolute;z-index:1;display:flex;align-items:center;justify-content:center;width:32px;height:32px;margin:-16px 0 0 -16px;padding:0;border:2px solid #fff;border-radius:999px;background:#2563eb;color:#fff;font-size:13px;font-weight:600;line-height:1;box-shadow:0 1px 4px rgba(0,0,0,.45);cursor:pointer}
.chi-dot:hover{background:#1d4ed8}
.chi-dot.chi-on{z-index:2;background:#1e3a8a;box-shadow:0 0 0 4px rgba(37,99,235,.45),0 1px 4px rgba(0,0,0,.45)}
.chi-move{cursor:grab;touch-action:none}
.chi-dot:focus-visible,.chi-spot:focus-visible{outline:3px solid #f59e0b;outline-offset:2px}
.chi-note{position:absolute;z-index:3;width:300px;max-width:calc(100% - 8px);max-height:340px;overflow:auto;padding:12px 14px;border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.2);line-height:1.45;text-align:left}
.chi-num{display:inline-flex;flex-shrink:0;align-items:center;justify-content:center;width:22px;height:22px;border-radius:999px;background:#2563eb;color:#fff;font-size:11px;font-weight:600;line-height:1}
.chi-pin{position:absolute;z-index:2;width:22px;height:22px;margin:-11px 0 0 -11px;border:3px solid #fff;border-radius:999px;background:#2563eb;box-shadow:0 0 0 1px rgba(0,0,0,.45),0 1px 4px rgba(0,0,0,.4);pointer-events:none}
.chi-pin.chi-ok{background:#16a34a}
.chi-pin.chi-no{background:#d97706}
.chi-aim{position:absolute;z-index:2;width:30px;height:30px;margin:-15px 0 0 -15px;border:2px dashed #1d4ed8;border-radius:999px;background:rgba(255,255,255,.4);box-shadow:0 0 0 1px rgba(255,255,255,.85);pointer-events:none}
.chi-box{position:absolute;z-index:1;border:2px solid #16a34a;border-radius:4px;background:rgba(34,197,94,.22);pointer-events:none}
.chi-spot{position:absolute;z-index:1;border:2px dashed #2563eb;border-radius:4px;background:rgba(37,99,235,.16);cursor:move;touch-action:none}
.chi-spot.chi-on{border-style:solid;background:rgba(37,99,235,.26)}
.chi-spot-n{position:absolute;left:2px;top:2px;min-width:18px;height:18px;padding:0 4px;border-radius:4px;background:#2563eb;color:#fff;font-size:11px;font-weight:600;line-height:18px;text-align:center;pointer-events:none}
.chi-handle{position:absolute;right:-9px;bottom:-9px;width:18px;height:18px;border:2px solid #2563eb;border-radius:4px;background:#fff;cursor:nwse-resize;touch-action:none}
.chi-draft{position:absolute;z-index:1;border:2px dashed #1d4ed8;border-radius:4px;background:rgba(37,99,235,.12);pointer-events:none}
.chi-grip{display:flex;flex-shrink:0;align-items:center;justify-content:center;width:24px;height:32px;border-radius:6px;cursor:grab;touch-action:none;opacity:.55;-webkit-user-select:none;user-select:none}
.chi-grip:hover{opacity:1;background:rgba(127,127,127,.14)}
.chi-lift{position:relative;z-index:2;box-shadow:0 8px 22px rgba(0,0,0,.18)}
.chi-dragging,.chi-dragging *{cursor:grabbing!important;-webkit-user-select:none!important;user-select:none!important}
.chi-step{display:flex;flex-shrink:0;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;font-size:15px;line-height:1;color:inherit;background:none}
.chi-step:hover{background:rgba(127,127,127,.14)}
.chi-step[aria-disabled='true']{opacity:.3;cursor:default;background:none}
.chi-step:focus-visible{outline:2px solid #2563eb;outline-offset:1px}
.chi-blank{display:inline-flex;align-items:center;max-width:100%;vertical-align:middle}
.chi-blank input.chi-ok,.chi-row.chi-ok{border-color:#22c55e}
.chi-blank input.chi-no,.chi-row.chi-no{border-color:#f59e0b}
:root[data-dark-mode='true'] .chi-note{box-shadow:0 10px 28px rgba(0,0,0,.6)}
:root[data-dark-mode='true'] .chi-num,:root[data-dark-mode='true'] .chi-spot-n{background:#3b82f6}
:root[data-dark-mode='true'] .chi-spot{border-color:#93c5fd;background:rgba(147,197,253,.2)}
:root[data-dark-mode='true'] .chi-handle{background:#1f2937;border-color:#93c5fd}
:root[data-dark-mode='true'] .chi-box{border-color:#4ade80;background:rgba(74,222,128,.24)}
:root[data-dark-mode='true'] .chi-layer:focus-visible,:root[data-dark-mode='true'] .chi-step:focus-visible{outline-color:#93c5fd}
`;

const CSS_ID = 'carehub-learning-interact-css';

function useInteractCss() {
  useLayoutEffect(() => {
    if (document.getElementById(CSS_ID)) return;
    const el = document.createElement('style');

    el.id = CSS_ID;
    el.textContent = INTERACT_CSS;
    document.head.appendChild(el);
  }, []);
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

const PlainText: TextView = ({ text }) => <span className='whitespace-pre-wrap break-words'>{text}</span>;

function usePlainSrc(link: string): PictureSrc {
  const [failed, setFailed] = useState('');

  return {
    src: link,
    state: link !== '' && failed === link ? 'failed' : 'ready',
    fail: () => setFailed(link),
    retry: () => setFailed(''),
  };
}

function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div className='rounded-[10px] border border-dashed border-border-primary px-4 py-6 text-center text-sm text-text-tertiary'>
      {children}
    </div>
  );
}

/** The picture, at most `maxHeight` tall, with `children` laid over it once it has loaded. */
function PictureFrame({
  picture,
  useSrc,
  maxHeight,
  className,
  children,
}: {
  picture: Picture;
  useSrc?: UsePictureSrc;
  maxHeight: number;
  className?: string;
  children?: ReactNode;
}) {
  const useSource = useSrc || usePlainSrc;
  const link = pictureLinkOk(picture.url) ? picture.url.trim() : '';
  const file = useSource(link);
  const [ratio, setRatio] = useState(0);
  const [broken, setBroken] = useState('');
  const [round, setRound] = useState(0);
  const img = useRef<HTMLImageElement | null>(null);

  useLayoutEffect(() => {
    const el = img.current;

    setRatio(el && el.complete && el.naturalWidth > 0 && el.naturalHeight > 0 ? el.naturalWidth / el.naturalHeight : 0);
  }, [file.src, round]);

  if (!link) return null;
  if (file.state === 'loading') {
    return (
      <div
        className={cn(
          'flex min-h-[160px] w-full items-center justify-center rounded-[10px] bg-fill-content-hover px-4 py-5 text-sm text-text-tertiary',
          className
        )}
      >
        Loading the picture…{file.percent ? ` ${file.percent}%` : ''}
      </div>
    );
  }

  if (file.state === 'failed' || (broken !== '' && broken === file.src)) {
    return (
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-dashed border-border-primary px-4 py-3 text-sm text-text-secondary',
          className
        )}
      >
        <span>
          <span aria-hidden='true'>⚠️ </span>We couldn’t load this picture.
        </span>
        <Button
          type='button'
          size='sm'
          variant='outline'
          onClick={() => {
            setBroken('');
            setRound((n) => n + 1);
            file.retry?.();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className={cn('chi-frame', className)} style={ratio ? { maxWidth: Math.max(200, Math.round(maxHeight * ratio)) } : undefined}>
      <img
        key={round}
        ref={img}
        src={file.src}
        alt={picture.alt}
        draggable={false}
        onLoad={(e) => {
          const el = e.currentTarget;

          if (el.naturalWidth > 0 && el.naturalHeight > 0) setRatio(el.naturalWidth / el.naturalHeight);
        }}
        onError={() => {
          setBroken(file.src);
          file.fail?.();
        }}
      />
      {ratio > 0 && children}
    </div>
  );
}

/** Puts focus back on a control after its list re-orders (moving a row can drop focus). */
function useRefocus() {
  const els = useRef(new Map<string, HTMLElement>());
  const want = useRef<string[]>([]);

  useLayoutEffect(() => {
    const keys = want.current;

    if (!keys.length) return;
    want.current = [];
    for (const k of keys) {
      const el = els.current.get(k);

      if (el && !(el as HTMLButtonElement).disabled) {
        if (document.activeElement !== el) el.focus();
        return;
      }
    }
  });

  return {
    reg: (key: string) => (el: HTMLElement | null) => {
      if (el) els.current.set(key, el);
      else els.current.delete(key);
    },
    /** Focus the first of these (that can take focus) after the next render. */
    later: (...keys: string[]) => {
      want.current = keys;
    },
  };
}

/** An element's width, kept up to date; attach with `ref`. */
function useWidth() {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    if (!el) return undefined;
    const update = () => setWidth(Math.round(el.getBoundingClientRect().width));

    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }

    const ro = new ResizeObserver(update);

    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  return { width, el, ref: setEl };
}

/** The point under the pointer, in percent of the rectangle (kept inside 0–100). */
function percentAt(clientX: number, clientY: number, r: DOMRect): Point {
  return {
    x: r.width ? clamp(((clientX - r.left) / r.width) * 100, 0, 100) : 0,
    y: r.height ? clamp(((clientY - r.top) / r.height) * 100, 0, 100) : 0,
  };
}

/** Follows one pointer (mouse, finger or pen) over `el` until it's let go. Returns a function that stops early. */
function follow(
  e: ReactPointerEvent,
  el: HTMLElement,
  onMove: (p: Point) => void,
  onEnd: (p: Point, moved: boolean, cancelled: boolean) => void
) {
  const rect = el.getBoundingClientRect();
  const pointer = e.pointerId;
  const sx = e.clientX;
  const sy = e.clientY;
  let moved = false;
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== pointer) return;
    if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 4) return;
    moved = true;
    ev.preventDefault();
    onMove(percentAt(ev.clientX, ev.clientY, rect));
  };
  const finish = (x: number, y: number, cancelled: boolean) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    onEnd(percentAt(x, y, rect), moved, cancelled);
  };
  const up = (ev: PointerEvent) => {
    if (ev.pointerId === pointer) finish(ev.clientX, ev.clientY, ev.type === 'pointercancel');
  };

  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  return () => finish(sx, sy, true);
}

function scrollBox(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;

    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }

  return null;
}

/** Dragging rows of a list by their grip; rows are the list's [data-chi-row] elements. Scrolls near the edges. */
function useRowDrag(onDrop: (from: number, to: number) => void) {
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const drop = useRef(onDrop);

  drop.current = onDrop;
  useEffect(() => () => stop.current?.(), []);

  const grab = (from: number) => (e: ReactPointerEvent<HTMLElement>) => {
    const list = listRef.current;

    if (e.button !== 0 || !list || stop.current) return;
    e.preventDefault();
    const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-chi-row]'));
    const box = scrollBox(list);
    const scrolled = () => (box ? box.scrollTop : window.scrollY);
    const top0 = scrolled();
    const mids = rows.map((r) => {
      const b = r.getBoundingClientRect();

      return b.top + b.height / 2;
    });
    const pointer = e.pointerId;
    let y = e.clientY;
    let to = from;
    let frame = 0;
    const place = () => {
      const shift = scrolled() - top0;
      let t = 0;

      mids.forEach((m, i) => {
        if (i !== from && y > m - shift) t += 1;
      });
      if (t !== to) {
        to = t;
        setDrag({ from, to });
      }
    };
    const tick = () => {
      const view = box ? box.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      const dy = y < view.top + 48 ? -10 : y > view.bottom - 48 ? 10 : 0;

      if (dy) {
        if (box) box.scrollTop += dy;
        else window.scrollBy(0, dy);
        place();
      }

      frame = requestAnimationFrame(tick);
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      ev.preventDefault();
      y = ev.clientY;
      place();
    };
    const finish = (commit: boolean) => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      document.documentElement.classList.remove('chi-dragging');
      stop.current = null;
      setDrag(null);
      if (commit && to !== from) drop.current(from, to);
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId === pointer) finish(ev.type === 'pointerup');
    };

    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    document.documentElement.classList.add('chi-dragging');
    frame = requestAnimationFrame(tick);
    stop.current = () => finish(false);
    setDrag({ from, to });
  };

  return { drag, listRef, grab };
}

const boxStyle = (b: Box): CSSProperties => ({ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%` });

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

const listReset: CSSProperties = { listStyle: 'none', margin: 0, padding: 0 };

function Legend({ number, prompt, Text }: { number?: number; prompt: string; Text: TextView }) {
  return (
    <legend className='mb-1 text-[15px] font-medium leading-snug text-text-primary'>
      {number !== undefined && <span className='mr-1 text-text-tertiary'>{number}.</span>}
      <Text text={prompt || 'Untitled question'} />
    </legend>
  );
}

// ---------------------------------------------------------------------------
// Learners: the three question kinds
// ---------------------------------------------------------------------------

export type InteractViewProps = {
  q: InteractQuestion;
  value: Answer | undefined;
  onChange: (a: Answer) => void;
  disabled?: boolean;
  /** The right answer — when given, the learner's answer is marked right or wrong. */
  reveal?: Answer;
  /** Unique per question on the page (used for field names and ids). */
  name: string;
  number?: number;
  Text?: TextView;
  useSrc?: UsePictureSrc;
};

/** Right, wrong, or '' when this page can't tell (a final-quiz question that doesn't say whether capitals must match). */
function blankMark(q: InteractQuestion, typed: string, accepted: string[]): '' | 'ok' | 'no' {
  const known = q.blank !== true || typeof q.case_sensitive === 'boolean';

  if (known) return blankRight(typed, accepted, q.case_sensitive === true) ? 'ok' : 'no';
  if (blankRight(typed, accepted, true)) return 'ok';
  return blankRight(typed, accepted, false) ? '' : 'no';
}

function FillBlankView({ q, value, onChange, disabled, reveal, name, number, Text = PlainText }: InteractViewProps) {
  const typed = typeof value === 'string' ? value : '';
  const accepted = reveal === undefined ? null : arr(reveal).filter((a): a is string => typeof a === 'string' && a.trim() !== '');
  const mark = accepted && accepted.length ? blankMark(q, typed, accepted) : '';
  const prompt = q.prompt || 'Untitled question';
  const gap = BLANK_RE.exec(prompt);
  const before = gap ? prompt.slice(0, gap.index) : prompt;
  const after = gap ? prompt.slice(gap.index + gap[0].length) : '';
  const box = (
    <span className={cn('chi-blank', gap ? 'mx-1' : 'w-full')}>
      <input
        type='text'
        name={name}
        value={typed}
        maxLength={MAX_TYPED_CHARS}
        disabled={disabled}
        aria-label='Your answer'
        placeholder={gap ? undefined : 'Type your answer'}
        autoComplete='off'
        autoCapitalize='off'
        autoCorrect='off'
        spellCheck={false}
        className={cn(chInputClass, 'min-w-0', !gap && 'w-full', mark === 'ok' ? 'chi-ok' : mark === 'no' ? 'chi-no' : '')}
        style={gap ? { width: `${clamp(chars(typed) + 3, 8, 32)}ch`, maxWidth: '100%' } : { maxWidth: 420 }}
        onChange={(e) => onChange(e.target.value)}
      />
      {mark === 'ok' && (
        <span className='chl-mark-right ml-1.5' role='img' aria-label='Correct'>
          ✓
        </span>
      )}
      {mark === 'no' && (
        <span className='chl-mark-wrong ml-1.5' role='img' aria-label='Not the right answer'>
          ×
        </span>
      )}
    </span>
  );

  return (
    <fieldset className='min-w-0'>
      {gap ? (
        <>
          <legend className='chi-sr'>{`${number !== undefined ? `${number}. ` : ''}${plain(`${before} blank ${after}`)}`}</legend>
          <div className='mb-1 text-[15px] font-medium leading-loose text-text-primary'>
            <span aria-hidden='true'>
              {number !== undefined && <span className='mr-1 text-text-tertiary'>{number}.</span>}
              {before.trim() && <Text text={before} />}
            </span>
            {box}
            {after.trim() && (
              <span aria-hidden='true'>
                <Text text={after} />
              </span>
            )}
          </div>
        </>
      ) : (
        <>
          <Legend number={number} prompt={prompt} Text={Text} />
          <div className='mt-2'>{box}</div>
        </>
      )}
      {accepted && accepted.length > 0 && mark !== 'ok' && (
        <div className='mt-2 text-sm text-text-secondary'>
          <div>
            Right answer: <span className='font-medium text-text-primary'>{accepted[0]}</span>
          </div>
          {accepted.length > 1 && <div>Also accepted: {accepted.slice(1).join(', ')}</div>}
        </div>
      )}
    </fieldset>
  );
}

/** Six dots, like the Studio's drag handles. */
function GripDots() {
  return (
    <svg width='10' height='16' viewBox='0 0 10 16' fill='currentColor' aria-hidden='true' focusable='false'>
      <circle cx='2.5' cy='3' r='1.4' />
      <circle cx='7.5' cy='3' r='1.4' />
      <circle cx='2.5' cy='8' r='1.4' />
      <circle cx='7.5' cy='8' r='1.4' />
      <circle cx='2.5' cy='13' r='1.4' />
      <circle cx='7.5' cy='13' r='1.4' />
    </svg>
  );
}

function OrderingView({ q, value, onChange, disabled, reveal, name, number, Text = PlainText }: InteractViewProps) {
  const items = useMemo(() => q.items || [], [q.items]);
  const keys = useMemo(() => itemKeys(items), [items]);
  const start = useMemo(() => startOrder(q.id, items, keys), [q.id, items, keys]);
  const textOf = useMemo(() => new Map(keys.map((k, i) => [k, items[i].text])), [keys, items]);
  const given = validOrder(value, keys);
  const order = given || start;
  const [said, setSaid] = useState('');
  const refocus = useRefocus();
  const move = (from: number, to: number) => {
    if (disabled || from === to || to < 0 || to >= order.length) return;
    onChange(arrayMove(order, from, to));
    setSaid(`Moved to position ${to + 1} of ${order.length}.`);
  };
  const { drag, listRef, grab } = useRowDrag(move);
  const shown = drag ? arrayMove(order, drag.from, drag.to) : order;
  const right = reveal === undefined ? null : validOrder(reveal, keys);
  const same = (a: string, b: string) => (textOf.get(a) || '').trim() === (textOf.get(b) || '').trim();
  const allRight = Boolean(right && given && given.every((k, i) => same(k, right[i])));

  if (!items.length) {
    return (
      <fieldset className='min-w-0'>
        <Legend number={number} prompt={q.prompt} Text={Text} />
      </fieldset>
    );
  }

  return (
    <fieldset className='min-w-0'>
      <Legend number={number} prompt={q.prompt} Text={Text} />
      {!disabled && <div className='mb-2 text-xs text-text-tertiary'>Drag the items into the right order, or use the arrow buttons.</div>}
      <ol ref={listRef} className='mt-2 flex flex-col gap-2' style={listReset}>
        {shown.map((k, i) => {
          const text = textOf.get(k) || '…';
          const mark = right && given ? (same(k, right[i]) ? 'ok' : 'no') : '';
          const label = plain(text) || `item ${i + 1}`;

          return (
            <li
              key={k}
              data-chi-row=''
              className={cn(
                'chi-row flex items-center gap-1.5 rounded-[10px] border py-1.5 text-sm',
                disabled ? 'px-3' : 'px-1.5',
                mark === 'ok' ? 'chi-ok' : mark === 'no' ? 'chi-no' : 'border-border-primary',
                drag && drag.to === i && 'chi-lift bg-background-primary'
              )}
            >
              {!disabled && (
                <span className='chi-grip' aria-hidden='true' title='Drag to move' onPointerDown={grab(i)}>
                  <GripDots />
                </span>
              )}
              <span className='w-5 shrink-0 text-text-tertiary' aria-hidden='true'>
                {i + 1}.
              </span>
              <span className='min-w-0 flex-1 py-1'>
                <Text text={text} />
              </span>
              {mark === 'ok' && (
                <span className='chl-mark-right px-1' role='img' aria-label='In the right place'>
                  ✓
                </span>
              )}
              {mark === 'no' && (
                <span className='chl-mark-wrong px-1' role='img' aria-label='Not in the right place'>
                  ×
                </span>
              )}
              {!disabled && (
                <>
                  <button
                    type='button'
                    ref={refocus.reg(`${k}:up`)}
                    className='chi-step'
                    aria-label={`Move “${label}” up`}
                    aria-disabled={i === 0}
                    onClick={() => {
                      if (i === 0) return;
                      refocus.later(`${k}:up`);
                      move(i, i - 1);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type='button'
                    ref={refocus.reg(`${k}:down`)}
                    className='chi-step'
                    aria-label={`Move “${label}” down`}
                    aria-disabled={i === shown.length - 1}
                    onClick={() => {
                      if (i === shown.length - 1) return;
                      refocus.later(`${k}:down`);
                      move(i, i + 1);
                    }}
                  >
                    ↓
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ol>
      <div className='chi-sr' aria-live='polite' id={`${name}-moved`}>
        {said}
      </div>
      {right && !allRight && (
        <div className='mt-2 text-sm text-text-secondary'>
          <div className='font-medium text-text-primary'>Right order:</div>
          <ol className='mt-1 list-decimal pl-5'>
            {right.map((k) => (
              <li key={k}>
                <Text text={textOf.get(k) || '…'} />
              </li>
            ))}
          </ol>
        </div>
      )}
    </fieldset>
  );
}

function HotspotView({ q, value, onChange, disabled, reveal, name, number, Text = PlainText, useSrc }: InteractViewProps) {
  const picture = q.image || NO_PICTURE;
  const point = readPoint(value);
  const boxes = reveal === undefined ? null : readBoxes(reveal);
  const [aim, setAim] = useState<Point | null>(null);
  const [keys, setKeys] = useState(false);
  const [said, setSaid] = useState('');
  const hit = Boolean(point && boxes && boxes.some((b) => inBox(b, point)));
  const helpId = `${name}-keys`;
  const pick = (p: Point) => {
    const v = { x: tenth(clamp(p.x, 0, 100)), y: tenth(clamp(p.y, 0, 100)) };

    onChange(toAnswer(v));
    setSaid(`Spot chosen, ${Math.round(v.x)}% across and ${Math.round(v.y)}% down.`);
  };
  const onClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    setAim(null);
    pick(percentAt(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect()));
  };
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const from = aim || point || { x: 50, y: 50 };

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(from);
      setAim(null);
      return;
    }

    const d = ARROWS[e.key];

    if (!d) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 2;

    setAim({ x: clamp(from.x + d[0] * step, 0, 100), y: clamp(from.y + d[1] * step, 0, 100) });
  };

  return (
    <fieldset className='min-w-0'>
      <Legend number={number} prompt={q.prompt} Text={Text} />
      {!disabled && <div className='mb-2 text-xs text-text-tertiary'>Click or tap the right spot on the picture.</div>}
      {pictureLinkOk(picture.url) ? (
        <PictureFrame picture={picture} useSrc={useSrc} maxHeight={480} className='mt-2'>
          <div
            className={cn('chi-layer', !disabled && 'chi-pick')}
            role={disabled ? undefined : 'application'}
            tabIndex={disabled ? undefined : 0}
            aria-label={disabled ? undefined : picture.alt.trim() ? `Picture: ${picture.alt.trim()}` : 'Picture'}
            aria-describedby={disabled ? undefined : helpId}
            onClick={onClick}
            onKeyDown={onKey}
            onFocus={(e) => {
              if (e.currentTarget.matches(':focus-visible')) {
                setKeys(true);
                setAim(point || { x: 50, y: 50 });
              }
            }}
            onBlur={() => {
              setKeys(false);
              setAim(null);
            }}
          >
            {boxes && boxes.map((b, i) => <span key={i} className='chi-box' style={boxStyle(b)} />)}
            {point && (
              <span className={cn('chi-pin', boxes && (hit ? 'chi-ok' : 'chi-no'))} style={{ left: `${point.x}%`, top: `${point.y}%` }} />
            )}
            {aim && <span className='chi-aim' style={{ left: `${aim.x}%`, top: `${aim.y}%` }} />}
          </div>
        </PictureFrame>
      ) : (
        <Placeholder>This question’s picture is missing.</Placeholder>
      )}
      {!disabled && (
        <div id={helpId} className={keys ? 'mt-1.5 text-xs text-text-tertiary' : 'chi-sr'}>
          Using a keyboard? Move the circle with the arrow keys (hold Shift to go faster) and press Enter to choose that spot.
        </div>
      )}
      <div className='chi-sr' aria-live='polite'>
        {said}
      </div>
      {boxes && (
        <div className='mt-2 text-sm text-text-secondary'>
          {point && hit && (
            <>
              <span className='chl-mark-right'>✓</span> You chose a right spot.{' '}
            </>
          )}
          {point && !hit && (
            <>
              <span className='chl-mark-wrong'>×</span> That isn’t a right spot.{' '}
            </>
          )}
          {boxes.length > 0 && (boxes.length === 1 ? 'The green box shows the right spot.' : 'The green boxes show the right spots.')}
        </div>
      )}
    </fieldset>
  );
}

/** A question of one of the new kinds, for knowledge checks, the final quiz and the Studio preview. */
export function InteractQuestionView(props: InteractViewProps) {
  useInteractCss();
  if (props.q.kind === 'fill_blank') return <FillBlankView {...props} />;
  if (props.q.kind === 'ordering') return <OrderingView {...props} />;
  return <HotspotView {...props} />;
}

// ---------------------------------------------------------------------------
// Learners: the labeled graphic block
// ---------------------------------------------------------------------------

/** Where a note opens next to its marker, keeping it inside the picture sideways. */
function notePlace(m: Point): CSSProperties {
  const s: CSSProperties = {};

  if (m.x < 34) s.left = `max(4px, calc(${m.x}% - 24px))`;
  else if (m.x > 66) s.right = `max(4px, calc(${100 - m.x}% - 24px))`;
  else {
    s.left = `${m.x}%`;
    s.transform = 'translateX(-50%)';
  }

  if (m.y < 55) s.top = `calc(${m.y}% + 24px)`;
  else s.bottom = `calc(${100 - m.y}% + 24px)`;
  return s;
}

/** A picture with numbered markers. Wide: a note opens next to the marker. Narrow (phones): the notes are listed below. */
export function LabeledGraphicView({ block, preview, useSrc }: { block: LabeledGraphicBlock; preview?: boolean; useSrc?: UsePictureSrc }) {
  useInteractCss();
  const [open, setOpen] = useState(-1);
  const { width, el, ref } = useWidth();
  const dots = useRef<(HTMLButtonElement | null)[]>([]);
  const target = useRef<HTMLElement | null>(null);
  const wantFocus = useRef(false);
  const markers = block.markers;
  const count = markers.length;
  const wide = width === 0 || width >= 500;
  const current = open >= 0 && open < count ? open : -1;
  const base = `chi-lg-${block.id}`;

  useEffect(() => {
    if (current < 0 || !el) return undefined;
    const onDown = (e: PointerEvent) => {
      if (!el.contains(e.target as Node)) setOpen(-1);
    };

    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [current, el]);

  useLayoutEffect(() => {
    if (!wantFocus.current) return;
    wantFocus.current = false;
    const t = target.current;

    if (!t) return;
    t.focus({ preventScroll: wide });
    if (!wide && typeof t.scrollIntoView === 'function') t.scrollIntoView({ block: 'nearest' });
  }, [current, wide]);

  if (!pictureLinkOk(block.image.url)) return preview ? <Placeholder>Add a picture to show the labeled graphic here.</Placeholder> : null;
  const show = (i: number) => {
    if (i === current) {
      target.current?.focus();
      return;
    }

    wantFocus.current = true;
    setOpen(i);
  };
  const close = (refocus: boolean) => {
    const i = current;

    setOpen(-1);
    if (refocus && i >= 0) dots.current[i]?.focus();
  };
  const setTarget = (n: HTMLElement | null) => {
    target.current = n;
  };
  const m = current >= 0 ? markers[current] : null;
  const card = m && wide && (
    <div
      id={`${base}-note`}
      role='group'
      aria-labelledby={`${base}-title`}
      className='chi-note border border-border-primary bg-background-primary text-text-primary'
      style={notePlace(m)}
    >
      <div className='flex items-start gap-2'>
        <div className='min-w-0 flex-1'>
          <div className='text-[11px] font-semibold uppercase tracking-wide text-text-tertiary'>
            {current + 1} of {count}
          </div>
          <div id={`${base}-title`} ref={setTarget} tabIndex={-1} className='break-words text-sm font-semibold outline-none'>
            {m.title.trim() || 'Untitled'}
          </div>
        </div>
        <button type='button' className='chi-step -mr-1.5 -mt-1' aria-label='Close note' onClick={() => close(true)}>
          ×
        </button>
      </div>
      {m.text.trim() && <div className='mt-1 whitespace-pre-line break-words text-sm text-text-secondary'>{m.text.trim()}</div>}
      {count > 1 && (
        <div className='mt-3 flex items-center justify-between gap-2'>
          <Button type='button' size='sm' variant='outline' disabled={current === 0} onClick={() => show(current - 1)}>
            Previous
          </Button>
          <Button type='button' size='sm' onClick={() => (current < count - 1 ? show(current + 1) : close(true))}>
            {current < count - 1 ? 'Next' : 'Done'}
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <figure
      ref={ref}
      className='m-0'
      onKeyDown={(e) => {
        if (e.key === 'Escape' && current >= 0) {
          e.stopPropagation();
          close(true);
        }
      }}
    >
      <PictureFrame picture={block.image} useSrc={useSrc} maxHeight={560}>
        <div
          className='chi-layer'
          onPointerDown={(e) => {
            if (e.target === e.currentTarget && current >= 0) setOpen(-1);
          }}
        >
          {markers.map((mk, i) => (
            <Fragment key={mk.id}>
              <button
                type='button'
                ref={(n) => {
                  dots.current[i] = n;
                }}
                className={cn('chi-dot', i === current && 'chi-on')}
                style={{ left: `${clamp(mk.x, 0, 100)}%`, top: `${clamp(mk.y, 0, 100)}%` }}
                aria-label={`${i + 1}. ${mk.title.trim() || 'Untitled'}`}
                aria-expanded={wide ? i === current : undefined}
                aria-controls={wide ? (i === current ? `${base}-note` : undefined) : `${base}-${i}`}
                onClick={() => (wide && i === current ? close(false) : show(i))}
              >
                {i + 1}
              </button>
              {i === current && card}
            </Fragment>
          ))}
        </div>
      </PictureFrame>
      {count > 0 && (
        <figcaption className='mt-1.5 text-center text-xs text-text-tertiary'>
          {wide ? 'Select a number to read about that part.' : 'Tap a number to jump to its note below.'}
        </figcaption>
      )}
      {!wide && count > 0 && (
        <ol className='mt-3 flex flex-col gap-2' style={listReset}>
          {markers.map((mk, i) => (
            <li
              key={mk.id}
              id={`${base}-${i}`}
              ref={i === current ? setTarget : undefined}
              tabIndex={-1}
              className={cn(
                'flex gap-2.5 rounded-[10px] border px-3 py-2.5 outline-none',
                i === current ? 'border-border-theme-thick bg-fill-content-hover' : 'border-border-primary'
              )}
            >
              <span className='chi-num mt-px' aria-hidden='true'>
                {i + 1}
              </span>
              <div className='min-w-0 flex-1'>
                <div className='break-words text-sm font-semibold'>{mk.title.trim() || 'Untitled'}</div>
                {mk.text.trim() && (
                  <div className='mt-0.5 whitespace-pre-line break-words text-sm text-text-secondary'>{mk.text.trim()}</div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Studio: small pieces (the same look as the Studio's own fields)
// ---------------------------------------------------------------------------

function IconBtn({
  label,
  onClick,
  disabled,
  danger,
  btnRef,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  btnRef?: (el: HTMLButtonElement | null) => void;
  children: ReactNode;
}) {
  return (
    <button
      ref={btnRef}
      type='button'
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-sm text-text-secondary hover:bg-fill-content-hover disabled:cursor-not-allowed disabled:opacity-30',
        danger && 'hover:text-text-error'
      )}
    >
      {children}
    </button>
  );
}

function AddLink({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type='button'
      disabled={disabled}
      onClick={onClick}
      className='self-start rounded-[8px] px-2 py-1 text-sm font-medium text-text-action hover:bg-fill-content-hover disabled:opacity-40'
    >
      + {children}
    </button>
  );
}

function Label({ children, hint, id }: { children: ReactNode; hint?: string; id?: string }) {
  return (
    <div id={id} className='text-xs font-medium text-text-secondary'>
      {children}
      {hint && <span className='font-normal text-text-tertiary'> — {hint}</span>}
    </div>
  );
}

/** The picture link (or the Studio's upload field) and its description. */
function PictureFields({
  picture,
  onChange,
  pictureField,
}: {
  picture: Picture;
  onChange: (p: Picture) => void;
  pictureField?: PictureField;
}) {
  const bad = picture.url.trim() !== '' && !pictureLinkOk(picture.url);

  return (
    <>
      {pictureField ? (
        pictureField(picture.url, (url) => onChange({ ...picture, url }))
      ) : (
        <label className='flex min-w-0 flex-col gap-1'>
          <span className='text-xs font-medium text-text-secondary'>Picture link</span>
          <input
            type='url'
            value={picture.url}
            placeholder='https://…'
            maxLength={2000}
            className={cn(chInputClass, 'w-full min-w-0')}
            onChange={(e) => onChange({ ...picture, url: e.target.value })}
          />
          <span className={cn('text-xs', bad ? 'text-text-error' : 'text-text-tertiary')}>
            {bad ? 'This link needs to start with https://' : 'Paste a link to the picture.'}
          </span>
        </label>
      )}
      <label className='flex min-w-0 flex-col gap-1'>
        <span className='text-xs font-medium text-text-secondary'>Describe the picture</span>
        <input
          type='text'
          value={picture.alt}
          maxLength={MAX_ALT_CHARS}
          placeholder='e.g. The order screen of the shop till'
          className={cn(chInputClass, 'w-full min-w-0')}
          onChange={(e) => onChange({ ...picture, alt: e.target.value })}
        />
        <span className='text-xs text-text-tertiary'>For people who can’t see the picture. Say what it shows.</span>
      </label>
    </>
  );
}

const PROMPT_PLACEHOLDER: Record<InteractKind, string> = {
  fill_blank: 'e.g. Fresh bread goes on the shelf at ___ every morning.',
  ordering: 'e.g. Put the steps for closing the shop in the right order.',
  hotspot: 'e.g. Click the button that starts a new order.',
};

function PromptField({ id, kind, value, onChange }: { id: string; kind: InteractKind; value: string; onChange: (v: string) => void }) {
  const box = useRef<HTMLTextAreaElement | null>(null);
  const caret = useRef<number | null>(null);
  const touched = useRef(false);
  const hasBlank = BLANK_RE.test(value);

  useLayoutEffect(() => {
    const el = box.current;
    const at = caret.current;

    if (at === null || !el) return;
    caret.current = null;
    el.focus();
    el.setSelectionRange(at, at);
  });

  const insertBlank = () => {
    const el = box.current;
    const start = el && touched.current ? el.selectionStart : value.length;
    const end = el && touched.current ? el.selectionEnd : value.length;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const head = before && !/\s$/.test(before) ? `${before} ` : before;
    const tail = after && !/^[\s.,;:!?)]/.test(after) ? ` ${after}` : after;

    caret.current = head.length + 3;
    onChange(`${head}___${tail}`);
  };

  return (
    <div className='flex min-w-0 flex-col gap-1'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <label htmlFor={id} className='text-xs font-medium text-text-secondary'>
          Question
        </label>
        {kind === 'fill_blank' && (
          <button
            type='button'
            disabled={hasBlank}
            onClick={insertBlank}
            className='rounded-[6px] px-1.5 py-0.5 text-xs font-medium text-text-action hover:bg-fill-content-hover disabled:opacity-40'
          >
            + Insert blank
          </button>
        )}
      </div>
      <textarea
        id={id}
        ref={box}
        value={value}
        rows={2}
        maxLength={20000}
        placeholder={PROMPT_PLACEHOLDER[kind]}
        className={cn(chInputClass, 'w-full min-w-0 resize-y leading-relaxed')}
        onFocus={() => {
          touched.current = true;
        }}
        onChange={(e) => onChange(e.target.value)}
      />
      {kind === 'fill_blank' && (
        <span className='text-xs text-text-tertiary'>
          {hasBlank
            ? 'Learners type their answer where the ___ is.'
            : 'Put ___ (three underscores) where the answer goes, or leave it out to show the box under the question.'}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Studio: the three question kinds
// ---------------------------------------------------------------------------

type SetFields = (patch: InteractQuestionFields) => void;

function AnswersEditor({ q, set }: { q: InteractQuestion; set: SetFields }) {
  const answers = q.answers && q.answers.length ? q.answers : [''];
  const refocus = useRefocus();
  const caseSensitive = q.case_sensitive === true;
  const put = (i: number, v: string) => set({ answers: answers.map((a, j) => (j === i ? v : a)) });

  return (
    <div className='flex flex-col gap-1.5'>
      <Label hint='any of these counts as right'>Accepted answers</Label>
      {answers.map((a, i) => (
        <div key={i} className='flex items-center gap-2'>
          <input
            ref={refocus.reg(`a${i}`)}
            type='text'
            value={a}
            maxLength={MAX_ACCEPTED_CHARS}
            placeholder={i === 0 ? 'The answer' : 'Another answer that counts'}
            aria-label={`Accepted answer ${i + 1}`}
            className={cn(chInputClass, 'w-full min-w-0')}
            onChange={(e) => put(i, e.target.value)}
          />
          <IconBtn
            label={`Remove accepted answer ${i + 1}`}
            danger
            disabled={answers.length <= 1}
            onClick={() => {
              refocus.later(`a${Math.max(0, i - 1)}`);
              set({ answers: answers.filter((_, j) => j !== i) });
            }}
          >
            ×
          </IconBtn>
        </div>
      ))}
      <AddLink
        disabled={answers.length >= MAX_ANSWERS}
        onClick={() => {
          refocus.later(`a${answers.length}`);
          set({ answers: [...answers, ''] });
        }}
      >
        Add another answer
      </AddLink>
      <label className='flex cursor-pointer items-start gap-2 text-sm'>
        <input
          type='checkbox'
          className='mt-[3px] shrink-0'
          checked={caseSensitive}
          onChange={(e) => set({ case_sensitive: e.target.checked })}
        />
        <span className='min-w-0 flex-1'>
          Capital letters must match
          <span className='block text-xs text-text-tertiary'>
            {caseSensitive ? '“Paris” counts, “paris” doesn’t.' : 'Off: “Paris” and “paris” both count.'} Extra spaces and a full stop at
            the end never matter.
          </span>
        </span>
      </label>
    </div>
  );
}

function ItemsEditor({ q, set }: { q: InteractQuestion; set: SetFields }) {
  const items = q.items || [];
  const refocus = useRefocus();
  const put = (next: OrderItem[]) => set({ items: next });
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= items.length) return;
    put(arrayMove(items, from, to));
  };
  const { drag, listRef, grab } = useRowDrag(move);
  const shown = drag ? arrayMove(items, drag.from, drag.to) : items;

  return (
    <div className='flex flex-col gap-1.5'>
      <Label hint='learners see them shuffled'>Items, in the right order</Label>
      <ol ref={listRef} className='flex flex-col gap-1.5' style={listReset}>
        {shown.map((it, i) => (
          <li
            key={it.id}
            data-chi-row=''
            className={cn('flex items-center gap-1.5 rounded-[8px]', drag && drag.to === i && 'chi-lift bg-background-primary')}
          >
            <span className='chi-grip' aria-hidden='true' title='Drag to move' onPointerDown={grab(i)}>
              <GripDots />
            </span>
            <span className='w-5 shrink-0 text-xs text-text-tertiary' aria-hidden='true'>
              {i + 1}.
            </span>
            <input
              ref={refocus.reg(`${it.id}:text`)}
              type='text'
              value={it.text}
              maxLength={MAX_ITEM_CHARS}
              placeholder={`Item ${i + 1}`}
              aria-label={`Item ${i + 1}`}
              className={cn(chInputClass, 'w-full min-w-0')}
              onChange={(e) => put(items.map((x) => (x.id === it.id ? { ...x, text: e.target.value } : x)))}
            />
            <IconBtn
              btnRef={refocus.reg(`${it.id}:up`)}
              label={`Move item ${i + 1} up`}
              disabled={i === 0}
              onClick={() => {
                refocus.later(`${it.id}:up`, `${it.id}:down`);
                move(i, i - 1);
              }}
            >
              ↑
            </IconBtn>
            <IconBtn
              btnRef={refocus.reg(`${it.id}:down`)}
              label={`Move item ${i + 1} down`}
              disabled={i === items.length - 1}
              onClick={() => {
                refocus.later(`${it.id}:down`, `${it.id}:up`);
                move(i, i + 1);
              }}
            >
              ↓
            </IconBtn>
            <IconBtn
              label={`Remove item ${i + 1}`}
              danger
              disabled={items.length <= 2}
              onClick={() => {
                const near = items[i + 1] || items[i - 1];

                if (near) refocus.later(`${near.id}:text`);
                put(items.filter((x) => x.id !== it.id));
              }}
            >
              ×
            </IconBtn>
          </li>
        ))}
      </ol>
      <AddLink
        disabled={items.length >= MAX_ITEMS}
        onClick={() => {
          const it = { id: makeId('i'), text: '' };

          refocus.later(`${it.id}:text`);
          put([...items, it]);
        }}
      >
        Add an item
      </AddLink>
    </div>
  );
}

/** A box from two corners, in whole percent, at least 2 × 2 and inside the picture. */
function boxBetween(a: Point, b: Point): Box {
  const x0 = Math.round(Math.min(a.x, b.x));
  const y0 = Math.round(Math.min(a.y, b.y));
  const w = clamp(Math.round(Math.max(a.x, b.x)) - x0, MIN_SPOT, 100);
  const h = clamp(Math.round(Math.max(a.y, b.y)) - y0, MIN_SPOT, 100);

  return { x: clamp(x0, 0, 100 - w), y: clamp(y0, 0, 100 - h), w, h };
}

function boxAround(p: Point, size: number): Box {
  return { x: clamp(Math.round(p.x - size / 2), 0, 100 - size), y: clamp(Math.round(p.y - size / 2), 0, 100 - size), w: size, h: size };
}

const boxOf = (s: Box): Box => ({ x: s.x, y: s.y, w: s.w, h: s.h });

function SpotCanvas({
  spots,
  onSpots,
  sel,
  onSel,
  helpId,
}: {
  spots: Spot[];
  onSpots: (s: Spot[]) => void;
  sel: string;
  onSel: (id: string) => void;
  helpId: string;
}) {
  const layer = useRef<HTMLDivElement | null>(null);
  const [live, setLive] = useState<{ id: string; box: Box } | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const full = spots.length >= MAX_SPOTS;

  useEffect(() => () => stop.current?.(), []);

  const start = (
    e: ReactPointerEvent<HTMLElement>,
    id: string,
    shape: (p: Point, p0: Point) => Box,
    commit: (p: Point, p0: Point, moved: boolean) => void
  ) => {
    const el = layer.current;

    if (e.button !== 0 || !el || stop.current) return;
    const p0 = percentAt(e.clientX, e.clientY, el.getBoundingClientRect());

    stop.current = follow(
      e,
      el,
      (p) => setLive({ id, box: shape(p, p0) }),
      (p, moved, cancelled) => {
        stop.current = null;
        setLive(null);
        if (!cancelled) commit(p, p0, moved);
      }
    );
  };
  const replace = (id: string, box: Box) => onSpots(spots.map((s) => (s.id === id ? { ...s, ...box } : s)));
  const draw = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || full) return;
    e.preventDefault();
    start(
      e,
      '',
      (p, p0) => boxBetween(p0, p),
      (p, p0, moved) => {
        const s = { id: makeId('s'), ...(moved ? boxBetween(p0, p) : boxAround(p0, 12)) };

        onSpots([...spots, s]);
        onSel(s.id);
      }
    );
  };
  const moveSpot = (s: Spot) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('chi-spot-n')) return;
    e.stopPropagation();
    onSel(s.id);
    const shape = (p: Point, p0: Point): Box => ({
      ...boxOf(s),
      x: clamp(Math.round(s.x + p.x - p0.x), 0, 100 - s.w),
      y: clamp(Math.round(s.y + p.y - p0.y), 0, 100 - s.h),
    });

    start(e, s.id, shape, (p, p0, moved) => {
      if (moved) replace(s.id, shape(p, p0));
    });
  };
  const sizeSpot = (s: Spot) => (e: ReactPointerEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    e.preventDefault();
    onSel(s.id);
    const shape = (p: Point): Box => ({
      x: s.x,
      y: s.y,
      w: clamp(Math.round(p.x - s.x), MIN_SPOT, 100 - s.x),
      h: clamp(Math.round(p.y - s.y), MIN_SPOT, 100 - s.y),
    });

    start(e, s.id, shape, (p, _p0, moved) => {
      if (moved) replace(s.id, shape(p));
    });
  };
  const onKey = (s: Spot) => (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onSpots(spots.filter((x) => x.id !== s.id));
      return;
    }

    const d = ARROWS[e.key];

    if (!d) return;
    e.preventDefault();
    replace(
      s.id,
      e.shiftKey
        ? { x: s.x, y: s.y, w: clamp(s.w + d[0], MIN_SPOT, 100 - s.x), h: clamp(s.h + d[1], MIN_SPOT, 100 - s.y) }
        : { x: clamp(s.x + d[0], 0, 100 - s.w), y: clamp(s.y + d[1], 0, 100 - s.h), w: s.w, h: s.h }
    );
  };

  return (
    <div
      ref={layer}
      className={cn('chi-layer', !full && 'chi-pick chi-draw')}
      role='application'
      aria-label='Picture with the right spots'
      aria-describedby={helpId}
      onPointerDown={draw}
    >
      {spots.map((s, i) => (
        <div
          key={s.id}
          role='button'
          tabIndex={0}
          aria-label={`Right spot ${i + 1}`}
          aria-describedby={helpId}
          className={cn('chi-spot', sel === s.id && 'chi-on')}
          style={boxStyle(live && live.id === s.id ? live.box : s)}
          onPointerDown={moveSpot(s)}
          onKeyDown={onKey(s)}
          onFocus={() => onSel(s.id)}
        >
          <span className='chi-spot-n' aria-hidden='true'>
            {i + 1}
          </span>
          <span className='chi-handle' aria-hidden='true' title='Drag to change the size' onPointerDown={sizeSpot(s)} />
        </div>
      ))}
      {live && live.id === '' && <span className='chi-draft' style={boxStyle(live.box)} />}
    </div>
  );
}

const SPARE_BOXES: Box[] = [
  { x: 40, y: 40, w: 20, h: 20 },
  { x: 10, y: 10, w: 20, h: 20 },
  { x: 70, y: 10, w: 20, h: 20 },
  { x: 10, y: 70, w: 20, h: 20 },
  { x: 70, y: 70, w: 20, h: 20 },
];

function SpotsEditor({
  q,
  set,
  useSrc,
  pictureField,
}: {
  q: InteractQuestion;
  set: SetFields;
  useSrc?: UsePictureSrc;
  pictureField?: PictureField;
}) {
  const image = q.image || NO_PICTURE;
  const spots = q.spots || [];
  const [sel, setSel] = useState('');
  const ok = pictureLinkOk(image.url);
  const helpId = `chi-spots-${q.id}`;
  const put = (next: Spot[]) => set({ spots: next });

  return (
    <div className='flex flex-col gap-3'>
      <PictureFields picture={image} onChange={(p) => set({ image: p })} pictureField={pictureField} />
      <div className='flex flex-col gap-1.5'>
        <Label hint={`up to ${MAX_SPOTS}`}>Right spots</Label>
        {ok ? (
          <>
            <div id={helpId} className='text-xs text-text-tertiary'>
              {spots.length >= MAX_SPOTS
                ? `This question has ${MAX_SPOTS} right spots, the most it can have. `
                : 'Drag across the picture to draw a box around a right spot, or click to drop a small one. '}
              Drag a box to move it, or its corner to change its size. With a keyboard: arrow keys move a box, Shift and the arrow keys
              change its size, and Delete removes it.
            </div>
            <PictureFrame picture={image} useSrc={useSrc} maxHeight={420}>
              <SpotCanvas spots={spots} onSpots={put} sel={sel} onSel={setSel} helpId={helpId} />
            </PictureFrame>
          </>
        ) : (
          <Placeholder>Add a picture above, then draw the right spots on it.</Placeholder>
        )}
        {spots.map((s, i) => (
          <div key={s.id} className='flex items-center gap-2 text-sm'>
            <span className='chi-num' aria-hidden='true'>
              {i + 1}
            </span>
            <span className='min-w-0 flex-1 text-text-secondary'>
              Right spot {i + 1}{' '}
              <span className='text-xs text-text-tertiary'>
                ({Math.round(s.w)}% wide, {Math.round(s.h)}% tall)
              </span>
            </span>
            <IconBtn label={`Delete right spot ${i + 1}`} danger onClick={() => put(spots.filter((x) => x.id !== s.id))}>
              ×
            </IconBtn>
          </div>
        ))}
        <AddLink
          disabled={!ok || spots.length >= MAX_SPOTS}
          onClick={() => {
            const s = { id: makeId('s'), ...SPARE_BOXES[spots.length % SPARE_BOXES.length] };

            put([...spots, s]);
            setSel(s.id);
          }}
        >
          Add a right spot
        </AddLink>
      </div>
    </div>
  );
}

/**
 * The Studio fields for one of the new kinds: the question text (with "Insert blank" for fill in the blank) and the
 * kind's own answers. The shared fields (type, points, feedback, explanation) stay in the Studio's question editor.
 */
export function InteractQuestionEditor<Q extends InteractQuestion>({
  q,
  onChange,
  useSrc,
  pictureField,
}: {
  q: Q;
  onChange: (q: Q) => void;
  useSrc?: UsePictureSrc;
  pictureField?: PictureField;
}) {
  useInteractCss();
  const kind: InteractKind = isInteractKind(q.kind) ? q.kind : 'fill_blank';
  const set = (patch: Partial<InteractQuestion>) => onChange({ ...q, ...patch });

  return (
    <>
      <PromptField id={`chi-prompt-${q.id}`} kind={kind} value={q.prompt} onChange={(prompt) => set({ prompt })} />
      {kind === 'fill_blank' && <AnswersEditor q={q} set={set} />}
      {kind === 'ordering' && <ItemsEditor q={q} set={set} />}
      {kind === 'hotspot' && <SpotsEditor q={q} set={set} useSrc={useSrc} pictureField={pictureField} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Studio: the labeled graphic block
// ---------------------------------------------------------------------------

function MarkerCanvas({
  markers,
  onMarkers,
  onAdd,
  sel,
  onSel,
  helpId,
  full,
}: {
  markers: Marker[];
  onMarkers: (m: Marker[]) => void;
  onAdd: (p: Point) => void;
  sel: string;
  onSel: (id: string) => void;
  helpId: string;
  full: boolean;
}) {
  const layer = useRef<HTMLDivElement | null>(null);
  const [live, setLive] = useState<{ id: string; p: Point } | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const dragEnd = useRef(0);

  useEffect(() => () => stop.current?.(), []);

  const put = (id: string, p: Point) =>
    onMarkers(markers.map((m) => (m.id === id ? { ...m, x: tenth(clamp(p.x, 0, 100)), y: tenth(clamp(p.y, 0, 100)) } : m)));
  const add = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || full || Date.now() - dragEnd.current < 400) return;
    onAdd(percentAt(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect()));
  };
  const grab = (m: Marker) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    const el = layer.current;

    if (e.button !== 0 || !el || stop.current) return;
    const p0 = percentAt(e.clientX, e.clientY, el.getBoundingClientRect());
    const at = (p: Point) => ({ x: clamp(m.x + p.x - p0.x, 0, 100), y: clamp(m.y + p.y - p0.y, 0, 100) });

    stop.current = follow(
      e,
      el,
      (p) => setLive({ id: m.id, p: at(p) }),
      (p, moved, cancelled) => {
        stop.current = null;
        setLive(null);
        if (moved) dragEnd.current = Date.now();
        if (moved && !cancelled) put(m.id, at(p));
      }
    );
  };
  const onKey = (m: Marker) => (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const d = ARROWS[e.key];

    if (!d) return;
    e.preventDefault();
    const step = e.shiftKey ? 5 : 1;

    put(m.id, { x: m.x + d[0] * step, y: m.y + d[1] * step });
  };

  return (
    <div ref={layer} className={cn('chi-layer', !full && 'chi-pick')} onClick={add}>
      {markers.map((m, i) => {
        const p = live && live.id === m.id ? live.p : m;

        return (
          <button
            key={m.id}
            type='button'
            className={cn('chi-dot chi-move', sel === m.id && 'chi-on')}
            style={{ left: `${clamp(p.x, 0, 100)}%`, top: `${clamp(p.y, 0, 100)}%` }}
            aria-label={`Marker ${i + 1}: ${m.title.trim() || 'no title yet'}`}
            aria-describedby={helpId}
            onPointerDown={grab(m)}
            onKeyDown={onKey(m)}
            onClick={() => onSel(m.id)}
            onFocus={() => onSel(m.id)}
          >
            {i + 1}
          </button>
        );
      })}
    </div>
  );
}

/** Where "Add a marker" puts a new marker (a loose grid, so they don't land on top of each other). */
function spareSpot(n: number): Point {
  return { x: 15 + (n % 5) * 17.5, y: 20 + (Math.floor(n / 5) % 4) * 20 };
}

export function LabeledGraphicEditor({
  block,
  onChange,
  useSrc,
  pictureField,
}: {
  block: LabeledGraphicBlock;
  onChange: (b: LabeledGraphicBlock) => void;
  useSrc?: UsePictureSrc;
  pictureField?: PictureField;
}) {
  useInteractCss();
  const [sel, setSel] = useState('');
  const refocus = useRefocus();
  const markers = block.markers;
  const full = markers.length >= MAX_MARKERS;
  const ok = pictureLinkOk(block.image.url);
  const helpId = `chi-markers-${block.id}`;
  const setMarkers = (next: Marker[]) => onChange({ ...block, markers: next });
  const setMarker = (id: string, patch: Partial<Marker>) => setMarkers(markers.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const add = (p: Point) => {
    if (full) return;
    const m: Marker = { id: makeId('m'), x: tenth(p.x), y: tenth(p.y), title: '', text: '' };

    refocus.later(`${m.id}:title`);
    setSel(m.id);
    setMarkers([...markers, m]);
  };
  const move = (i: number, to: number, key: string, other: string) => {
    if (to < 0 || to >= markers.length) return;
    refocus.later(key, other);
    setMarkers(arrayMove(markers, i, to));
  };

  return (
    <div className='flex flex-col gap-3'>
      <PictureFields picture={block.image} onChange={(image) => onChange({ ...block, image })} pictureField={pictureField} />
      <div className='flex flex-col gap-1.5'>
        <Label hint={`up to ${MAX_MARKERS}`}>Markers</Label>
        {ok ? (
          <>
            <div id={helpId} className='text-xs text-text-tertiary'>
              {full
                ? `This picture has ${MAX_MARKERS} markers, the most it can have. `
                : 'Click the picture to add a marker where you click. '}
              Drag a marker to move it. With a keyboard: Tab to a marker and use the arrow keys (hold Shift to go faster).
            </div>
            <PictureFrame picture={block.image} useSrc={useSrc} maxHeight={420}>
              <MarkerCanvas markers={markers} onMarkers={setMarkers} onAdd={add} sel={sel} onSel={setSel} helpId={helpId} full={full} />
            </PictureFrame>
          </>
        ) : (
          <Placeholder>Add a picture above, then click it to place markers.</Placeholder>
        )}
        {markers.length > 0 && (
          <ol className='flex flex-col gap-2' style={listReset}>
            {markers.map((m, i) => (
              <li
                key={m.id}
                className={cn(
                  'flex flex-col gap-1.5 rounded-[10px] border p-2.5',
                  sel === m.id ? 'border-border-theme-thick' : 'border-border-primary'
                )}
                onFocus={() => setSel(m.id)}
              >
                <div className='flex items-center gap-1.5'>
                  <span className='chi-num' aria-hidden='true'>
                    {i + 1}
                  </span>
                  <input
                    ref={refocus.reg(`${m.id}:title`)}
                    type='text'
                    value={m.title}
                    maxLength={MAX_TITLE_CHARS}
                    placeholder='Title, e.g. New order button'
                    aria-label={`Title of marker ${i + 1}`}
                    className={cn(chInputClass, 'w-full min-w-0')}
                    onChange={(e) => setMarker(m.id, { title: e.target.value })}
                  />
                  <IconBtn
                    btnRef={refocus.reg(`${m.id}:up`)}
                    label={`Move marker ${i + 1} up`}
                    disabled={i === 0}
                    onClick={() => move(i, i - 1, `${m.id}:up`, `${m.id}:down`)}
                  >
                    ↑
                  </IconBtn>
                  <IconBtn
                    btnRef={refocus.reg(`${m.id}:down`)}
                    label={`Move marker ${i + 1} down`}
                    disabled={i === markers.length - 1}
                    onClick={() => move(i, i + 1, `${m.id}:down`, `${m.id}:up`)}
                  >
                    ↓
                  </IconBtn>
                  <IconBtn
                    label={`Delete marker ${i + 1}`}
                    danger
                    onClick={() => {
                      const near = markers[i + 1] || markers[i - 1];

                      if (near) refocus.later(`${near.id}:title`);
                      setMarkers(markers.filter((x) => x.id !== m.id));
                    }}
                  >
                    ×
                  </IconBtn>
                </div>
                <textarea
                  value={m.text}
                  rows={2}
                  maxLength={MAX_NOTE_CHARS}
                  placeholder='What should people know about this part?'
                  aria-label={`Note for marker ${i + 1}`}
                  className={cn(chInputClass, 'w-full min-w-0 resize-y leading-relaxed')}
                  onChange={(e) => setMarker(m.id, { text: e.target.value })}
                />
              </li>
            ))}
          </ol>
        )}
        <AddLink disabled={full || !ok} onClick={() => add(spareSpot(markers.length))}>
          Add a marker
        </AddLink>
      </div>
    </div>
  );
}

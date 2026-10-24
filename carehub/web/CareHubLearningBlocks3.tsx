// CareHub Learning: five more lesson blocks — sorting activity, timeline, gallery, table and buttons — and links from
// text and buttons to another lesson or block of the same course ("#lesson-<id>" / "#block-<id>").
//
// Everything for them lives here; the other Learning files only call in. This file imports only types from them
// (they import this file, so runtime imports would make a cycle): rich text, picture/file downloads and the
// Studio's picture and file fields are passed in through small "kit" objects instead.
// Publish checks use the same words as the server (P4-QBANK section E).

import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type {
  ClipboardEvent as ReactClipboardEvent,
  ComponentType,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
} from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { UUID_RE } from './CareHubCore';
import { filterPages, useSharablePages } from './CareHubSharePage';
import { CareHubModal, chInputClass, ChSelect } from './CareHubUi';

import type { Block, Lesson } from './CareHubLearningApi';
import type { BlockCtx, FileLoad } from './CareHubLearningBlocks';

// ---------------------------------------------------------------------------
// Shapes and limits
// ---------------------------------------------------------------------------

export interface SortPile {
  id: string;
  title: string;
}

export interface SortCard {
  id: string;
  text: string;
  /** The pile (group) this card belongs in; "" while the author hasn't picked one. */
  pile_id: string;
}

export interface SortingBlock {
  id: string;
  type: 'sorting';
  prompt: string;
  piles: SortPile[];
  cards: SortCard[];
}

export interface TimelineItem {
  id: string;
  date: string;
  title: string;
  text: string;
  image_url: string;
  image_alt: string;
}

export interface TimelineBlock {
  id: string;
  type: 'timeline';
  items: TimelineItem[];
}

export type GalleryLayout = 'carousel' | 'grid';

export interface GalleryImage {
  id: string;
  url: string;
  alt: string;
  caption: string;
}

export interface GalleryBlock {
  id: string;
  type: 'gallery';
  layout: GalleryLayout;
  images: GalleryImage[];
}

export interface TableBlock {
  id: string;
  type: 'table';
  /** The first row is a header row. */
  header: boolean;
  rows: string[][];
  caption: string;
}

export type ButtonTarget =
  | { kind: 'link'; url: string }
  | { kind: 'file'; url: string; name: string }
  | { kind: 'page'; view_id: string; title: string }
  /** block_id "" = the top of the lesson. */
  | { kind: 'lesson'; lesson_id: string; block_id: string };

export type ButtonStyle = 'primary' | 'secondary';

export interface LinkButton {
  id: string;
  label: string;
  style: ButtonStyle;
  target: ButtonTarget;
}

export interface ButtonsBlock {
  id: string;
  type: 'buttons';
  items: LinkButton[];
}

export type Blocks3Block = SortingBlock | TimelineBlock | GalleryBlock | TableBlock | ButtonsBlock;
export type Blocks3Type = Blocks3Block['type'];

export const BLOCKS3_TYPES: readonly Blocks3Type[] = ['sorting', 'timeline', 'gallery', 'table', 'buttons'];

export function isBlocks3Type(type: unknown): type is Blocks3Type {
  return typeof type === 'string' && (BLOCKS3_TYPES as readonly string[]).includes(type);
}

/** Limits (characters are counted as Unicode code points, like the server). */
export const BLOCKS3_LIMITS = {
  piles: 4,
  pileTitle: 60,
  cards: 20,
  cardText: 200,
  entries: 20,
  entryText: 100,
  pictures: 12,
  rows: 30,
  cols: 6,
  cell: 300,
  buttons: 4,
  label: 60,
} as const;

const L = BLOCKS3_LIMITS;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A new id in the same form as newId in CareHubLearningApi ("c_k3j9x0a1"). */
function makeId(prefix: string) {
  const bytes = new Uint8Array(8);

  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }

  let s = '';

  for (let i = 0; i < bytes.length; i++) s += ID_CHARS[bytes[i] % ID_CHARS.length];
  return `${prefix}_${s}`;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown) {
  return typeof v === 'string' ? v : '';
}

/** Length in Unicode code points (an emoji counts once). */
function chars(s: string) {
  return [...s].length;
}

function cut(s: string, max: number) {
  const all = [...s];

  return all.length > max ? all.slice(0, max).join('') : s;
}

/** The saved id when it's usable, else a new one (also for a repeated id, so lists never share keys). */
function itemId(v: unknown, prefix: string, seen: Set<string>) {
  let id = str(v);

  if (!id || seen.has(id)) id = makeId(prefix);
  seen.add(id);
  return id;
}

function badIds(items: { id: string }[]) {
  const seen = new Set<string>();

  for (const it of items) {
    if (!it.id || seen.has(it.id)) return true;
    seen.add(it.id);
  }

  return false;
}

function words(s: string) {
  const t = s.trim();

  return t ? t.split(/\s+/).length : 0;
}

/** Text without the tiny markdown: **bold**, *italic* and [text](link) become their words. */
export function plainText(s: string) {
  return s
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1')
    .replace(/\*\*([^*\n]+?)\*\*/g, '$1')
    .replace(/\*([^*\n]+?)\*/g, '$1');
}

function cellText(v: unknown) {
  if (typeof v === 'string') return v;
  if ((typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean') return String(v);
  return '';
}

// ---------------------------------------------------------------------------
// Reading saved content (never trust shapes blindly), new blocks, copies
// ---------------------------------------------------------------------------

function readTarget(v: unknown): ButtonTarget {
  const t = obj(v);

  switch (t.kind) {
    case 'file':
      return { kind: 'file', url: str(t.url), name: str(t.name) };
    case 'page':
      return { kind: 'page', view_id: str(t.view_id), title: str(t.title) };
    case 'lesson':
      return { kind: 'lesson', lesson_id: str(t.lesson_id), block_id: str(t.block_id) };
    case 'link':
      return { kind: 'link', url: str(t.url) };
    default:
      return { kind: 'link', url: '' };
  }
}

/** Every row as long as the widest one (1–6 columns), at most 30 rows, cells cut to 300 characters. */
function readRows(v: unknown): string[][] {
  const raw = arr(v)
    .slice(0, L.rows)
    .map((r) =>
      arr(r)
        .slice(0, L.cols)
        .map((c) => cut(cellText(c), L.cell))
    );
  const width = Math.min(L.cols, Math.max(1, ...raw.map((r) => r.length)));
  const rows = raw.map((r) => (r.length < width ? [...r, ...Array.from({ length: width - r.length }, () => '')] : r));

  return rows.length ? rows : [['']];
}

/** A sorting, timeline, gallery, table or buttons block from saved JSON (o.type says which). */
export function normalizeBlocks3(o: Record<string, unknown>, id: string): Blocks3Block {
  const seen = new Set<string>();

  switch (o.type) {
    case 'sorting': {
      const piles = arr(o.piles)
        .slice(0, L.piles)
        .map((x): SortPile => {
          const p = obj(x);

          return { id: itemId(p.id, 'g', seen), title: cut(str(p.title), L.pileTitle) };
        });
      const pileIds = new Set(piles.map((p) => p.id));
      const cards = arr(o.cards)
        .slice(0, L.cards)
        .map((x): SortCard => {
          const c = obj(x);
          const pile = str(c.pile_id);

          return { id: itemId(c.id, 'c', seen), text: cut(str(c.text), L.cardText), pile_id: pileIds.has(pile) ? pile : '' };
        });

      return { id, type: 'sorting', prompt: str(o.prompt), piles, cards };
    }

    case 'timeline':
      return {
        id,
        type: 'timeline',
        items: arr(o.items)
          .slice(0, L.entries)
          .map((x): TimelineItem => {
            const it = obj(x);

            return {
              id: itemId(it.id, 't', seen),
              date: cut(str(it.date), L.entryText),
              title: cut(str(it.title), L.entryText),
              text: str(it.text),
              image_url: str(it.image_url),
              image_alt: str(it.image_alt),
            };
          }),
      };
    case 'gallery':
      return {
        id,
        type: 'gallery',
        layout: o.layout === 'grid' ? 'grid' : 'carousel',
        images: arr(o.images)
          .slice(0, L.pictures)
          .map((x): GalleryImage => {
            const im = obj(x);

            return { id: itemId(im.id, 'p', seen), url: str(im.url), alt: str(im.alt), caption: str(im.caption) };
          }),
      };
    case 'buttons':
      return {
        id,
        type: 'buttons',
        items: arr(o.items)
          .slice(0, L.buttons)
          .map((x): LinkButton => {
            const b = obj(x);

            return {
              id: itemId(b.id, 'k', seen),
              label: cut(str(b.label), L.label),
              style: b.style === 'secondary' ? 'secondary' : 'primary',
              target: readTarget(b.target),
            };
          }),
      };
    case 'table':
    default:
      return { id, type: 'table', header: o.header === true, rows: readRows(o.rows), caption: str(o.caption) };
  }
}

export function blankPile(): SortPile {
  return { id: makeId('g'), title: '' };
}

export function blankCard(pileId = ''): SortCard {
  return { id: makeId('c'), text: '', pile_id: pileId };
}

export function blankEntry(): TimelineItem {
  return { id: makeId('t'), date: '', title: '', text: '', image_url: '', image_alt: '' };
}

export function blankPicture(): GalleryImage {
  return { id: makeId('p'), url: '', alt: '', caption: '' };
}

export function blankButton(): LinkButton {
  return { id: makeId('k'), label: '', style: 'primary', target: { kind: 'link', url: '' } };
}

export function blankBlocks3(type: Blocks3Type, id: string): Blocks3Block {
  switch (type) {
    case 'sorting': {
      const piles = [blankPile(), blankPile()];

      return { id, type: 'sorting', prompt: '', piles, cards: [blankCard(piles[0].id), blankCard(piles[1].id)] };
    }

    case 'timeline':
      return { id, type: 'timeline', items: [blankEntry(), blankEntry()] };
    case 'gallery':
      return { id, type: 'gallery', layout: 'carousel', images: [blankPicture(), blankPicture()] };
    case 'buttons':
      return { id, type: 'buttons', items: [blankButton()] };
    case 'table':
    default:
      return {
        id,
        type: 'table',
        header: true,
        rows: [
          ['', ''],
          ['', ''],
          ['', ''],
        ],
        caption: '',
      };
  }
}

/** A copy with new ids for every item (the caller gives the block itself a new id). */
export function cloneBlocks3(b: Blocks3Block): Blocks3Block {
  switch (b.type) {
    case 'sorting': {
      const map = new Map<string, string>();

      b.piles.forEach((p) => map.set(p.id, makeId('g')));
      return {
        ...b,
        piles: b.piles.map((p) => ({ ...p, id: map.get(p.id) || makeId('g') })),
        cards: b.cards.map((c) => ({ ...c, id: makeId('c'), pile_id: map.get(c.pile_id) || '' })),
      };
    }

    case 'timeline':
      return { ...b, items: b.items.map((it) => ({ ...it, id: makeId('t') })) };
    case 'gallery':
      return { ...b, images: b.images.map((im) => ({ ...im, id: makeId('p') })) };
    case 'buttons':
      return { ...b, items: b.items.map((it) => ({ ...it, id: makeId('k'), target: { ...it.target } })) };
    case 'table':
    default:
      return { ...b, rows: b.rows.map((r) => [...r]) };
  }
}

/** Rough reading/doing time in seconds, for the course's estimated minutes. */
export function blocks3Seconds(b: Blocks3Block) {
  switch (b.type) {
    case 'sorting':
      return 10 + b.cards.length * 6 + words(b.prompt) * 0.3;
    case 'timeline':
      return b.items.reduce((n, it) => n + words(`${it.date} ${it.title} ${it.text}`) * 0.3 + (it.image_url.trim() ? 8 : 3), 0);
    case 'gallery':
      return b.images.reduce((n, im) => n + 6 + words(im.caption) * 0.3, 0);
    case 'buttons':
      return b.items.length * 2;
    case 'table':
    default:
      return 10 + words(`${b.caption} ${b.rows.flat().join(' ')}`) * 0.4;
  }
}

// ---------------------------------------------------------------------------
// Publish checks (same words as the server)
// ---------------------------------------------------------------------------

const PICTURE_LINK = 'has a picture link that must start with https:// (or be a Care Hub link starting with /).';

/**
 * Problems with one sorting, timeline, gallery, table or buttons block (other blocks are ignored).
 * `at` names the block the way the server does: block 2 of Lesson 1 ("Welcome").
 */
export function blocks3Problems(block: Block, at: string, out: string[], urlOk: (url: string) => boolean) {
  switch (block.type) {
    case 'sorting': {
      const s = `The sorting activity in ${at}`;
      const { piles, cards } = block;
      const pileIds = new Set(piles.map((p) => p.id));

      if (piles.length < 2 || piles.length > L.piles) out.push(`${s} needs two to four groups.`);
      if (piles.some((p) => !p.title.trim())) out.push(`${s} has a group without a name.`);
      if (cards.length < 2) out.push(`${s} needs at least two cards.`);
      if (cards.length > L.cards) out.push(`${s} can have at most 20 cards.`);
      if (cards.some((c) => !c.text.trim())) out.push(`${s} has an empty card.`);
      if (cards.some((c) => !pileIds.has(c.pile_id))) out.push(`${s} has a card that isn't in a group.`);
      if (piles.some((p) => chars(p.title) > L.pileTitle) || cards.some((c) => chars(c.text) > L.cardText)) {
        out.push(`${s} has a group name or card that is too long.`);
      }

      if (badIds([...piles, ...cards])) out.push(`${s} has groups or cards with missing or repeated ids. Try deleting and re-adding them.`);
      break;
    }

    case 'timeline': {
      const s = `The timeline in ${at}`;
      const { items } = block;

      if (items.length < 2) out.push(`${s} needs at least two entries.`);
      if (items.length > L.entries) out.push(`${s} can have at most 20 entries.`);
      if (items.some((it) => !it.date.trim() || !it.title.trim())) out.push(`${s} has an entry without a date or title.`);
      if (items.some((it) => chars(it.date) > L.entryText || chars(it.title) > L.entryText))
        out.push(`${s} has a date or title that is too long.`);
      if (items.some((it) => it.image_url.trim() && !urlOk(it.image_url))) out.push(`${s} ${PICTURE_LINK}`);
      if (items.some((it) => it.image_url.trim() && !it.image_alt.trim())) out.push(`${s} has a picture without a description.`);
      break;
    }

    case 'gallery': {
      const s = `The gallery in ${at}`;
      const { images } = block;

      if (images.length < 2) out.push(`${s} needs at least two pictures.`);
      if (images.length > L.pictures) out.push(`${s} can have at most 12 pictures.`);
      if (images.some((im) => !im.url.trim())) out.push(`${s} has a picture without a link.`);
      if (images.some((im) => im.url.trim() && !urlOk(im.url))) out.push(`${s} ${PICTURE_LINK}`);
      if (images.some((im) => !im.alt.trim())) out.push(`${s} has a picture without a description.`);
      break;
    }

    case 'table': {
      const s = `The table in ${at}`;
      const { rows } = block;

      if (!rows.length) out.push(`${s} needs at least one row.`);
      if (rows.length > L.rows || rows.some((r) => r.length > L.cols)) out.push(`${s} can have at most 30 rows and 6 columns.`);
      if (rows.some((r) => r.length !== rows[0].length)) out.push(`${s} has rows of different lengths.`);
      if (rows.some((r) => r.some((c) => chars(c) > L.cell))) out.push(`${s} has a cell that is too long (300 characters at most).`);
      if (rows.length && rows.every((r) => r.every((c) => !c.trim()))) out.push(`${s} is empty.`);
      break;
    }

    case 'buttons': {
      const { items } = block;

      if (!items.length) out.push(`The buttons block in ${at} needs at least one button.`);
      if (items.length > L.buttons) out.push(`The buttons block in ${at} can have at most 4 buttons.`);
      items.forEach((it) => {
        const label = it.label.trim();
        const who = label ? `The button “${label}” in ${at}` : `A button in ${at}`;
        const t = it.target;

        if (!label) out.push(`A button in ${at} needs a label.`);
        else if (chars(label) > L.label) out.push(`A button label in ${at} is too long (60 characters at most).`);
        if (t.kind === 'link') {
          if (!urlOk(t.url)) out.push(`${who} needs a link that starts with https:// (or a Care Hub link starting with /).`);
        } else if (t.kind === 'file') {
          if (!t.url.trim() || !urlOk(t.url)) out.push(`${who} needs a file.`);
        } else if (t.kind === 'page') {
          if (!UUID_RE.test(t.view_id)) out.push(`${who} needs a Care Hub page.`);
        } else if (t.kind !== 'lesson') {
          out.push(`${who} doesn't go anywhere yet.`);
        }
      });
      break;
    }

    default:
      break;
  }
}

const TEXT_LINK_RE = /\]\(#(lesson|block)-([A-Za-z0-9_-]+)\)/g;

/** True when a button's lesson target is still in the course (the block, if any, must be in that lesson). */
function lessonTargetOk(lessons: Lesson[], lessonId: string, blockId: string) {
  const lesson = lessons.find((l) => l.id === lessonId);

  return Boolean(lesson && (!blockId || lesson.blocks.some((b) => b.id === blockId)));
}

/**
 * Links that go nowhere: text links (#lesson-… / #block-…) anywhere in a lesson's blocks and buttons that open a
 * lesson. One message per lesson; `lessonName` names it the way the server does: Lesson 2 ("Refunds").
 */
export function blocks3LinkProblems(c: { lessons: Lesson[] }, out: string[], lessonName: (index: number, title: string) => string) {
  const lessonIds = new Set(c.lessons.map((l) => l.id));
  const blockIds = new Set<string>();

  c.lessons.forEach((l) => l.blocks.forEach((b) => blockIds.add(b.id)));
  c.lessons.forEach((l, i) => {
    const broken = l.blocks.some((b) => {
      if (
        b.type === 'buttons' &&
        b.items.some((it) => it.target.kind === 'lesson' && !lessonTargetOk(c.lessons, it.target.lesson_id, it.target.block_id))
      ) {
        return true;
      }

      for (const m of JSON.stringify(b).matchAll(TEXT_LINK_RE)) {
        if (m[1] === 'lesson' ? !lessonIds.has(m[2]) : !blockIds.has(m[2])) return true;
      }

      return false;
    });

    if (broken) out.push(`A link in ${lessonName(i, l.title)} goes to a lesson or block that's no longer in this course.`);
  });
}

// ---------------------------------------------------------------------------
// Search text (for the course search) and jump targets
// ---------------------------------------------------------------------------

/** The words people can read in a sorting, timeline, gallery, table or buttons block ("" for other blocks). */
export function blocks3SearchText(block: Block): string {
  let parts: string[];

  switch (block.type) {
    case 'sorting':
      parts = [block.prompt, ...block.piles.map((p) => p.title), ...block.cards.map((c) => c.text)];
      break;
    case 'timeline':
      parts = block.items.flatMap((it) => [it.date, it.title, it.text, it.image_url.trim() ? it.image_alt : '']);
      break;
    case 'gallery':
      parts = block.images.flatMap((im) => [im.caption, im.alt]);
      break;
    case 'table':
      parts = [block.caption, ...block.rows.flat()];
      break;
    case 'buttons':
      parts = block.items.map((it) => it.label);
      break;
    default:
      return '';
  }

  return parts.map(plainText).join(' ').replace(/\s+/g, ' ').trim();
}

/** Where a link or button goes: a lesson (block_id "") or a block (lesson_id "" = whichever lesson holds it). */
export interface JumpTarget {
  lesson_id: string;
  block_id: string;
}

/** "#lesson-<id>" or "#block-<id>" → a jump target (null for anything else). */
export function parseJumpHref(href: string): JumpTarget | null {
  const m = /^#(lesson|block)-([A-Za-z0-9_-]+)$/.exec(href.trim());

  if (!m) return null;
  return m[1] === 'lesson' ? { lesson_id: m[2], block_id: '' } : { lesson_id: '', block_id: m[2] };
}

/** The lesson (index and id) and block a target points at, or null when it's no longer in the course. */
export function findJump(lessons: Lesson[], t: JumpTarget): { index: number; lessonId: string; blockId: string } | null {
  if (t.lesson_id) {
    const index = lessons.findIndex((l) => l.id === t.lesson_id);

    if (index < 0 || !lessonTargetOk(lessons, t.lesson_id, t.block_id)) return null;
    return { index, lessonId: t.lesson_id, blockId: t.block_id };
  }

  if (!t.block_id) return null;
  const index = lessons.findIndex((l) => l.blocks.some((b) => b.id === t.block_id));

  return index < 0 ? null : { index, lessonId: lessons[index].id, blockId: t.block_id };
}

// ---------------------------------------------------------------------------
// Styles (added to the page once; light and dark)
// ---------------------------------------------------------------------------

const BLOCKS3_CSS = `
.chb3-flash{animation:chb3-flash 1.6s ease-out;border-radius:12px}
@keyframes chb3-flash{0%,35%{box-shadow:0 0 0 3px rgba(37,99,235,.55);background-color:rgba(37,99,235,.07)}100%{box-shadow:0 0 0 3px rgba(37,99,235,0);background-color:transparent}}
:root[data-dark-mode='true'] .chb3-flash{animation-name:chb3-flash-dark}
@keyframes chb3-flash-dark{0%,35%{box-shadow:0 0 0 3px rgba(96,165,250,.6);background-color:rgba(96,165,250,.1)}100%{box-shadow:0 0 0 3px rgba(96,165,250,0);background-color:transparent}}
.chb3-focus:focus-visible{outline:2px solid #2563eb;outline-offset:2px}
:root[data-dark-mode='true'] .chb3-focus:focus-visible{outline-color:#60a5fa}
.chb3-toast-wrap{position:fixed;left:0;right:0;bottom:24px;z-index:1500;display:flex;justify-content:center;padding:0 16px;pointer-events:none}
.chb3-toast{max-width:440px;border-radius:10px;padding:10px 14px;font-size:14px;line-height:1.45;background:#1f2937;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.25)}
:root[data-dark-mode='true'] .chb3-toast{background:#f3f4f6;color:#111827}
.chb3-tl{list-style:none;margin:0;padding:0}
.chb3-tl-item{display:grid;grid-template-columns:minmax(0,9rem) 20px minmax(0,1fr);column-gap:14px}
.chb3-tl-narrow .chb3-tl-item{grid-template-columns:20px minmax(0,1fr);column-gap:10px}
.chb3-tl-date{grid-column:1;grid-row:1;text-align:right;font-size:13px;font-weight:600;line-height:20px;overflow-wrap:anywhere}
.chb3-tl-narrow .chb3-tl-date{grid-column:2;text-align:left}
.chb3-tl-rail{grid-column:2;grid-row:1/span 2;position:relative;display:flex;justify-content:center}
.chb3-tl-narrow .chb3-tl-rail{grid-column:1}
.chb3-tl-rail::before{content:'';position:absolute;top:0;bottom:0;left:9px;width:2px;background:rgba(127,127,127,.3)}
.chb3-tl-item:first-child .chb3-tl-rail::before{top:6px}
.chb3-tl-item:last-child .chb3-tl-rail::before{bottom:auto;height:6px}
.chb3-tl-dot{position:relative;margin-top:4px;width:12px;height:12px;border-radius:999px;background:#2563eb}
:root[data-dark-mode='true'] .chb3-tl-dot{background:#60a5fa}
.chb3-tl-body{grid-column:3;grid-row:1;min-width:0;padding-bottom:22px}
.chb3-tl-narrow .chb3-tl-body{grid-column:2;grid-row:2}
.chb3-tl-item:last-child .chb3-tl-body{padding-bottom:0}
.chb3-table{border-collapse:collapse;width:100%;font-size:14px;line-height:1.45}
.chb3-table th,.chb3-table td{border-bottom:1px solid rgba(127,127,127,.25);padding:8px 12px;text-align:left;vertical-align:top;min-width:7rem}
.chb3-table th{font-weight:600;background:rgba(127,127,127,.08)}
.chb3-table tr:last-child td{border-bottom:0}
.chb3-stage{position:relative;display:flex;align-items:center;justify-content:center;width:100%;aspect-ratio:3/2;overflow:hidden;border-radius:10px;background:rgba(127,127,127,.1);touch-action:pan-y}
.chb3-stage img{width:100%;height:100%;object-fit:contain}
.chb3-thumb{display:block;width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:8px;background:rgba(127,127,127,.1)}
.chb3-lightbox{position:fixed;inset:0;z-index:1450;display:flex;flex-direction:column;background:rgba(10,10,12,.92);color:#fff}
.chb3-lb-stage{display:flex;flex:1;min-height:0;align-items:center;justify-content:center;padding:0 16px;touch-action:pan-y}
.chb3-lb-stage img{max-width:100%;max-height:calc(100vh - 170px);object-fit:contain}
.chb3-lb-btn{border:1px solid rgba(255,255,255,.35);border-radius:8px;padding:6px 12px;font-size:14px;color:#fff;background:rgba(255,255,255,.08)}
.chb3-lb-btn:hover{background:rgba(255,255,255,.16)}
.chb3-lb-btn[aria-disabled='true']{opacity:.4;cursor:not-allowed}
.chb3-lb-btn:focus-visible{outline:2px solid #93c5fd;outline-offset:2px}
.chb3-card{position:relative;touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab;transition:transform .22s ease,box-shadow .22s ease}
.chb3-card-drag{z-index:30;cursor:grabbing;transition:none;box-shadow:0 12px 28px rgba(0,0,0,.2)}
.chb3-pile{transition:background-color .15s ease}
.chb3-linkbtn{display:none}
.chb3-linkwrap:focus-within .chb3-linkbtn{display:inline-flex}
@media (prefers-reduced-motion: reduce){.chb3-flash{animation:none;outline:2px solid #2563eb;outline-offset:4px}.chb3-card,.chb3-pile{transition:none}}
`;

function useBlocks3Style() {
  useLayoutEffect(() => {
    if (typeof document === 'undefined' || document.head.querySelector('style[data-carehub-blocks3]')) return;
    const el = document.createElement('style');

    el.setAttribute('data-carehub-blocks3', '');
    el.textContent = BLOCKS3_CSS;
    document.head.appendChild(el);
  }, []);
}

function prefersStill() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

// ---------------------------------------------------------------------------
// Jumping to another lesson or block (text links and buttons, in the player and Preview)
// ---------------------------------------------------------------------------

/** Scrolls an element into view, moves focus to it and flashes it briefly. */
function bringIntoView(el: HTMLElement, block: ScrollLogicalPosition = 'start') {
  if (!el.matches('a[href], button, input, select, textarea, [tabindex]')) {
    el.setAttribute('tabindex', '-1');
    el.addEventListener('blur', () => el.removeAttribute('tabindex'), { once: true });
  }

  el.scrollIntoView({ behavior: prefersStill() ? 'auto' : 'smooth', block });
  el.focus({ preventScroll: true });
  el.classList.remove('chb3-flash');
  void el.offsetWidth;
  el.classList.add('chb3-flash');
  window.setTimeout(() => el.classList.remove('chb3-flash'), 1700);
}

export interface JumpApi {
  /** The lesson and block a target points at, or null when it's no longer in the course. */
  find: (t: JumpTarget) => ReturnType<typeof findJump>;
  /** True when the course goes in order and that lesson isn't open to this person yet. */
  locked: (t: JumpTarget) => boolean;
  /** Opens the lesson, scrolls to the block and moves focus there — or says why it can't. */
  go: (t: JumpTarget) => void;
  /** Links work in lessons only (never in the final quiz, so nobody loses their answers). */
  inLesson: boolean;
}

/** Set by the player (JumpArea). Course search can use it too: useContext(JumpContext)?.go({ lesson_id, block_id }). */
export const JumpContext = createContext<JumpApi | null>(null);

const LOCKED_REASON = 'Finish the earlier lessons first';

/**
 * Wraps the player. `current` is the open lesson's id ("" for the intro, quiz and results), `open` shows a lesson.
 * When the block sits after a Continue button that hasn't been pressed, the hidden blocks stay hidden: focus goes to
 * that Continue button (the lesson marks it with id "chl-gate-<id>") and a short message says why.
 */
export function JumpArea({
  lessons,
  current,
  preview,
  isLocked,
  isDone,
  open,
  children,
}: {
  lessons: Lesson[];
  current: string;
  preview: boolean;
  isLocked: (index: number) => boolean;
  isDone: (lessonId: string) => boolean;
  /** Branching: may return why it can't open yet (shown as a short message), or wait for the server first. */
  open: (lessonId: string) => void | string | Promise<boolean>;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const shown = useRef(current);
  const frame = useRef(0);
  const latest = useRef({ lessons, current, preview, isLocked, isDone, open });
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);

  useBlocks3Style();
  latest.current = { lessons, current, preview, isLocked, isDone, open };
  useLayoutEffect(() => {
    shown.current = current;
  }, [current]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = window.setTimeout(() => setToast(null), 5000);

    return () => window.clearTimeout(t);
  }, [toast]);

  const say = (text: string) => setToast({ text, n: Date.now() });
  const lockedAt = (found: { index: number; lessonId: string }) => {
    const s = latest.current;

    return !s.preview && !s.isDone(found.lessonId) && s.isLocked(found.index);
  };

  const api: JumpApi = {
    find: (t) => findJump(latest.current.lessons, t),
    locked: (t) => {
      const found = findJump(latest.current.lessons, t);

      return Boolean(found && lockedAt(found));
    },
    go: (t) => {
      const s = latest.current;
      const found = findJump(s.lessons, t);

      if (!found) return say('That part is no longer in this course.');
      if (lockedAt(found)) return say(`${LOCKED_REASON}.`);
      const opening = found.lessonId !== s.current ? s.open(found.lessonId) : undefined;

      if (typeof opening === 'string') return say(opening);
      cancelAnimationFrame(frame.current);
      let frames = 0;
      const step = () => {
        const root = box.current;

        frames += 1;
        if (!root || shown.current !== found.lessonId || frames < 2 || !root.querySelector('article h1')) {
          if (frames < 90) frame.current = requestAnimationFrame(step);
          return;
        }

        const heading = root.querySelector<HTMLElement>('article h1');
        const el = found.blockId ? root.querySelector<HTMLElement>(`[id="chl-b-${found.blockId}"]`) : heading;

        if (el) return bringIntoView(el);
        const gate = root.querySelector<HTMLElement>('[id^="chl-gate-"]');
        const button = gate?.querySelector<HTMLButtonElement>('button');

        if (gate) {
          bringIntoView(button && !button.disabled ? button : gate, 'center');
          say('That part of the lesson comes after this Continue button.');
        } else if (heading) bringIntoView(heading);
      };

      // Branching: a "Let them choose" lesson is finished on the server first, then the lesson picked opens.
      if (opening instanceof Promise) {
        void opening.then((ok) => {
          if (ok) frame.current = requestAnimationFrame(step);
        });
        return;
      }

      frame.current = requestAnimationFrame(step);
    },
    inLesson: current !== '',
  };

  return (
    <JumpContext.Provider value={api}>
      <div ref={box} className='contents'>
        {children}
      </div>
      {typeof document !== 'undefined' &&
        createPortal(
          <div className='chb3-toast-wrap' role='status' aria-live='polite'>
            {toast && (
              <div key={toast.n} className='chb3-toast'>
                {toast.text}
              </div>
            )}
          </div>,
          document.body
        )}
    </JumpContext.Provider>
  );
}

/** A text link to a lesson or block. Plain text when it goes nowhere (or outside a lesson). */
export function JumpLink({ href, children }: { href: string; children: ReactNode }) {
  const api = useContext(JumpContext);
  const target = parseJumpHref(href);

  if (!api || !target || !api.inLesson || !api.find(target)) return <>{children}</>;
  const locked = api.locked(target);

  return (
    <a
      href={href}
      title={locked ? LOCKED_REASON : undefined}
      className='text-text-action underline underline-offset-2'
      onClick={(e) => {
        e.preventDefault();
        api.go(target);
      }}
    >
      {children}
      {locked && <span className='sr-only'> (locked)</span>}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Learner views
// ---------------------------------------------------------------------------

/** What the learner views need from CareHubLearningBlocks (passed in, so this file has no runtime import of it). */
export interface Blocks3Kit {
  Text: ComponentType<{ text: string; className?: string }>;
  useSrc: (link: string) => FileLoad;
  useNarrow: () => boolean;
  urlOk: (url: string) => boolean;
  isCareHubFile: (url: string) => boolean;
  fileHref: (url: string) => string;
  fetchFile: (url: string, signal?: AbortSignal, onProgress?: (loaded: number, total: number) => void) => Promise<Blob>;
}

type ViewProps<B> = { block: B; ctx: BlockCtx; kit: Blocks3Kit };

function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div className='rounded-[10px] border border-dashed border-border-primary px-4 py-6 text-center text-sm text-text-tertiary'>
      {children}
    </div>
  );
}

/** A picture from a link or Care Hub's file storage, with loading and "try again" states. */
function Picture({
  url,
  alt,
  kit,
  box,
  img,
  plain,
}: {
  url: string;
  alt: string;
  kit: Blocks3Kit;
  box?: string;
  img?: string;
  plain?: boolean;
}) {
  const ok = kit.urlOk(url);
  const file = kit.useSrc(ok ? url : '');

  if (!ok) {
    return (
      <div className={cn('flex items-center justify-center rounded-[10px] bg-fill-content-hover p-4 text-sm text-text-tertiary', box)}>
        <span aria-hidden='true'>🖼️</span>
      </div>
    );
  }

  if (file.state === 'loading') {
    return (
      <div className={cn('flex items-center justify-center rounded-[10px] bg-fill-content-hover p-4 text-sm text-text-tertiary', box)}>
        Loading the picture…{file.percent > 0 ? ` ${file.percent}%` : ''}
      </div>
    );
  }

  if (file.state === 'failed' && plain) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-[10px] border border-dashed border-border-primary p-2 text-center text-xs text-text-tertiary',
          box
        )}
      >
        <span aria-hidden='true'>⚠️</span>
      </div>
    );
  }

  if (file.state === 'failed') {
    return (
      <div
        className={cn(
          'flex flex-wrap items-center justify-center gap-2 rounded-[10px] border border-dashed border-border-primary p-3 text-sm text-text-secondary',
          box
        )}
      >
        <span>
          <span aria-hidden='true'>⚠️ </span>
          We couldn’t load this picture.
        </span>
        <Button type='button' size='sm' variant='outline' onClick={file.retry}>
          Try again
        </Button>
      </div>
    );
  }

  return <img src={file.src} alt={alt} loading='lazy' className={img} onError={file.fail} />;
}

export function Blocks3View({ block, ctx, kit }: ViewProps<Blocks3Block>) {
  useBlocks3Style();
  switch (block.type) {
    case 'sorting':
      return <SortingView block={block} ctx={ctx} kit={kit} />;
    case 'timeline':
      return <TimelineView block={block} ctx={ctx} kit={kit} />;
    case 'gallery':
      return <GalleryView block={block} ctx={ctx} kit={kit} />;
    case 'table':
      return <TableView block={block} ctx={ctx} kit={kit} />;
    case 'buttons':
      return <ButtonsView block={block} ctx={ctx} kit={kit} />;
    default:
      return null;
  }
}

// ---- Buttons ----------------------------------------------------------------

const FILE_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/zip': 'zip',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'audio/mpeg': 'mp3',
  'video/mp4': 'mp4',
};

function withExtension(name: string, type: string) {
  if (/\.[a-z0-9]{1,5}$/i.test(name)) return name;
  const ext = FILE_EXTENSIONS[type.split(';')[0].trim().toLowerCase()];

  return ext ? `${name}.${ext}` : name;
}

function saveBlob(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');

  a.href = href;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 60000);
}

const BUTTON_BASE =
  'chb3-focus inline-flex min-h-[40px] max-w-full items-center justify-center gap-1.5 rounded-[10px] px-4 py-2 text-center text-sm font-medium no-underline';
const BUTTON_LOOK: Record<ButtonStyle, string> = {
  primary: 'bg-fill-theme-thick text-white hover:opacity-90',
  secondary: 'border border-border-primary text-text-primary hover:bg-fill-content-hover',
};

function NewTab() {
  return (
    <>
      <span aria-hidden='true'>↗</span>
      <span className='sr-only'> (opens in a new tab)</span>
    </>
  );
}

function ButtonsView({ block, ctx, kit }: ViewProps<ButtonsBlock>) {
  const items = block.items.filter((it) => it.label.trim());

  if (!items.length) return ctx.preview ? <Placeholder>Give a button a label to show it here.</Placeholder> : null;
  return (
    <div className='flex flex-wrap items-start gap-2'>
      {items.map((it) => (
        <OneButton key={it.id} item={it} ctx={ctx} kit={kit} />
      ))}
    </div>
  );
}

function OneButton({ item, ctx, kit }: { item: LinkButton; ctx: BlockCtx; kit: Blocks3Kit }) {
  const jump = useContext(JumpContext);
  const [percent, setPercent] = useState<number | null>(null);
  const [problem, setProblem] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const t = item.target;
  const label = item.label.trim();
  const look = cn(BUTTON_BASE, BUTTON_LOOK[item.style]);

  useEffect(() => () => abort.current?.abort(), []);
  const off = (why: string) => (
    <button
      type='button'
      aria-disabled='true'
      title={why}
      className={cn(look, 'cursor-not-allowed opacity-50')}
      onClick={(e) => e.preventDefault()}
    >
      {label}
      <span className='sr-only'> ({why})</span>
    </button>
  );

  if (t.kind === 'link') {
    if (!kit.urlOk(t.url)) return off('This button doesn’t have a link yet.');
    return (
      <a href={t.url.trim()} target='_blank' rel='noopener noreferrer' className={look}>
        {label}
        <NewTab />
      </a>
    );
  }

  if (t.kind === 'page') {
    if (!UUID_RE.test(t.view_id) || !ctx.workspaceId) return off('Pick a Care Hub page for this button.');
    return (
      <a href={`/app/${ctx.workspaceId}/${t.view_id}`} target='_blank' rel='noopener' className={look}>
        {label}
        <NewTab />
      </a>
    );
  }

  if (t.kind === 'lesson') {
    const target = { lesson_id: t.lesson_id, block_id: t.block_id };

    if (!jump) return off('Opens the lesson when people take the course.');
    if (!jump.find(target)) return off('The lesson or part this button opens is no longer in this course.');
    const locked = jump.locked(target);

    return (
      <button type='button' title={locked ? LOCKED_REASON : undefined} className={look} onClick={() => jump.go(target)}>
        {locked && <span aria-hidden='true'>🔒</span>}
        {label}
        {locked && <span className='sr-only'> (locked)</span>}
      </button>
    );
  }

  if (!kit.urlOk(t.url)) return off('This button doesn’t have a file yet.');
  const own = kit.isCareHubFile(t.url);
  const name = t.name.trim() || label || 'File';
  const href = own ? kit.fileHref(t.url) : t.url.trim();
  const download = async (e: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!own) return;
    e.preventDefault();
    if (percent !== null) return;
    const ctrl = new AbortController();

    abort.current = ctrl;
    setProblem(false);
    setPercent(0);
    try {
      const blob = await kit.fetchFile(t.url, ctrl.signal, (loaded, total) =>
        setPercent(total ? Math.min(99, Math.floor((loaded / total) * 100)) : 0)
      );

      saveBlob(blob, withExtension(name, blob.type));
    } catch {
      if (!ctrl.signal.aborted) setProblem(true);
    }

    if (!ctrl.signal.aborted) setPercent(null);
  };

  return (
    <span className='inline-flex max-w-full flex-col items-start gap-1'>
      <a
        href={href}
        target={own ? undefined : '_blank'}
        rel='noopener noreferrer'
        download={own ? name : undefined}
        aria-busy={percent !== null}
        onClick={download}
        className={look}
      >
        {label}
        {own ? <span aria-hidden='true'>↓</span> : <NewTab />}
        {percent !== null && <span className='text-xs opacity-80'>Downloading…{percent ? ` ${percent}%` : ''}</span>}
      </a>
      {problem && (
        <span role='alert' className='text-xs text-text-secondary'>
          We couldn’t download it just now.{' '}
          <a href={href} target='_blank' rel='noopener noreferrer' className='text-text-action underline underline-offset-2'>
            Open the file in a new tab
          </a>{' '}
          or try again.
        </span>
      )}
    </span>
  );
}

// ---- Table ------------------------------------------------------------------

function TableView({ block, ctx, kit }: ViewProps<TableBlock>) {
  const wrap = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const narrow = kit.useNarrow();
  const { Text } = kit;
  const { rows } = block;
  const empty = rows.every((r) => r.every((c) => !c.trim()));

  useEffect(() => {
    const el = wrap.current;

    if (!el) return undefined;
    const check = () => setOverflow(el.scrollWidth > el.clientWidth + 1);

    check();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const watch = new ResizeObserver(check);

    watch.observe(el);
    return () => watch.disconnect();
  }, [rows, empty]);

  if (empty) return ctx.preview ? <Placeholder>Fill in the table to show it here.</Placeholder> : null;
  const head = block.header ? rows[0] : null;
  const body = block.header ? rows.slice(1) : rows;
  const caption = block.caption.trim();

  return (
    <figure className='m-0'>
      <div
        ref={wrap}
        role='region'
        aria-label={caption ? plainText(caption) : 'Table'}
        tabIndex={overflow ? 0 : undefined}
        className='chb3-focus overflow-x-auto rounded-[10px] border border-border-primary'
      >
        <table className='chb3-table'>
          {head && (
            <thead>
              <tr>
                {head.map((c, i) => (
                  <th key={i} scope='col'>
                    <Text text={c} />
                  </th>
                ))}
              </tr>
            </thead>
          )}
          {body.length > 0 && (
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci}>
                      <Text text={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>
      {(caption || overflow) && (
        <figcaption className='mt-1.5 text-xs text-text-tertiary'>
          {caption && <Text text={caption} />}
          {overflow && (
            <span className='block'>{narrow ? 'Swipe sideways to see the whole table.' : 'Scroll sideways to see the whole table.'}</span>
          )}
        </figcaption>
      )}
    </figure>
  );
}

// ---- Timeline ---------------------------------------------------------------

function TimelineView({ block, ctx, kit }: ViewProps<TimelineBlock>) {
  const narrow = kit.useNarrow();
  const { Text } = kit;
  const items = block.items.filter((it) => it.date.trim() || it.title.trim() || it.text.trim());

  if (!items.length) return ctx.preview ? <Placeholder>Add entries with a date and a title to show the timeline here.</Placeholder> : null;
  return (
    <ol className={cn('chb3-tl', narrow && 'chb3-tl-narrow')}>
      {items.map((it) => (
        <li key={it.id} className='chb3-tl-item'>
          <div className='chb3-tl-date text-text-secondary'>{it.date}</div>
          <div className='chb3-tl-rail' aria-hidden='true'>
            <span className='chb3-tl-dot' />
          </div>
          <div className='chb3-tl-body'>
            {it.title.trim() && <div className='text-base font-semibold leading-snug'>{it.title}</div>}
            {it.text.trim() && (
              <div className='mt-1 text-sm leading-relaxed text-text-secondary'>
                <Text text={it.text} />
              </div>
            )}
            {it.image_url.trim() && (ctx.preview || kit.urlOk(it.image_url)) && (
              <div className='mt-2 max-w-[420px]'>
                <Picture url={it.image_url} alt={it.image_alt} kit={kit} box='min-h-[120px]' img='w-full rounded-[10px]' />
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ---- Gallery ----------------------------------------------------------------

function GalleryView({ block, ctx, kit }: ViewProps<GalleryBlock>) {
  const images = block.images.filter((im) => kit.urlOk(im.url));

  if (!images.length)
    return ctx.preview ? <Placeholder>Upload pictures or paste picture links to show the gallery here.</Placeholder> : null;
  return block.layout === 'grid' ? <GalleryGrid images={images} kit={kit} /> : <Carousel images={images} kit={kit} />;
}

/** Left/right swipes with a finger or pen (a mouse drags nothing here; it uses the buttons). */
function useSwipe(onSwipe: (dir: 1 | -1) => void) {
  const start = useRef<{ id: number; x: number; y: number } | null>(null);

  return {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'mouse') start.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      const s = start.current;

      start.current = null;
      if (!s || s.id !== e.pointerId) return;
      const dx = e.clientX - s.x;

      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - s.y)) onSwipe(dx < 0 ? 1 : -1);
    },
    onPointerCancel: () => {
      start.current = null;
    },
  };
}

function Carousel({ images, kit }: { images: GalleryImage[]; kit: Blocks3Kit }) {
  const [index, setIndex] = useState(0);
  const { Text } = kit;
  const count = images.length;
  const at = Math.min(index, count - 1);
  const im = images[at];
  const go = (d: number) => setIndex((i) => Math.max(0, Math.min(count - 1, Math.min(i, count - 1) + d)));
  const swipe = useSwipe(go);

  return (
    <div
      role='region'
      aria-roledescription='carousel'
      aria-label='Picture gallery'
      tabIndex={0}
      className='chb3-focus rounded-[12px]'
      onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          go(e.key === 'ArrowLeft' ? -1 : 1);
        }
      }}
    >
      <figure className='m-0'>
        <div className='chb3-stage' {...swipe}>
          <Picture key={im.id} url={im.url} alt={im.alt} kit={kit} box='h-full w-full' />
        </div>
        {im.caption.trim() && (
          <figcaption className='mt-1.5 text-center text-xs text-text-tertiary'>
            <Text text={im.caption} />
          </figcaption>
        )}
      </figure>
      <div className='mt-2 flex items-center justify-between gap-2'>
        <Button
          type='button'
          size='sm'
          variant='outline'
          aria-disabled={at === 0}
          className={cn(at === 0 && 'opacity-50')}
          onClick={() => go(-1)}
        >
          ← Previous
        </Button>
        <span className='text-xs text-text-secondary' aria-live='polite'>
          <span className='sr-only'>Picture </span>
          {at + 1} of {count}
        </span>
        <Button
          type='button'
          size='sm'
          variant='outline'
          aria-disabled={at === count - 1}
          className={cn(at === count - 1 && 'opacity-50')}
          onClick={() => go(1)}
        >
          Next →
        </Button>
      </div>
    </div>
  );
}

function GalleryGrid({ images, kit }: { images: GalleryImage[]; kit: Blocks3Kit }) {
  const narrow = kit.useNarrow();
  const [open, setOpen] = useState<number | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const { Text } = kit;

  const close = (last: number) => {
    setOpen(null);
    requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>(`[data-thumb="${last}"]`)?.focus());
  };

  return (
    <>
      <ul ref={list} className={cn('m-0 grid list-none gap-2 p-0', narrow ? 'grid-cols-2' : 'grid-cols-3')}>
        {images.map((im, i) => (
          <li key={im.id} className='min-w-0'>
            <button
              type='button'
              data-thumb={i}
              aria-haspopup='dialog'
              aria-label={`Open picture ${i + 1} of ${images.length}${im.alt.trim() ? `: ${im.alt.trim()}` : ''}`}
              className='chb3-focus block w-full rounded-[8px]'
              onClick={() => setOpen(i)}
            >
              <Picture url={im.url} alt='' kit={kit} box='aspect-square w-full' img='chb3-thumb' plain />
            </button>
            {im.caption.trim() && (
              <div className='chl-clamp2 mt-1 text-xs text-text-tertiary'>
                <Text text={im.caption} />
              </div>
            )}
          </li>
        ))}
      </ul>
      {open !== null && <Lightbox images={images} index={Math.min(open, images.length - 1)} kit={kit} onIndex={setOpen} onClose={close} />}
    </>
  );
}

/** The big view: a dialog with Previous / Next. Esc or Close shuts it and focus goes back to the picture's thumbnail. */
function Lightbox({
  images,
  index,
  kit,
  onIndex,
  onClose,
}: {
  images: GalleryImage[];
  index: number;
  kit: Blocks3Kit;
  onIndex: (i: number) => void;
  onClose: (last: number) => void;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const latest = useRef({ index, onClose });
  const { Text } = kit;
  const count = images.length;
  const im = images[index];
  const go = (d: number) => onIndex(Math.max(0, Math.min(count - 1, index + d)));
  const swipe = useSwipe(go);

  latest.current = { index, onClose };
  useEffect(() => {
    const before = document.body.style.overflow;
    // Capture phase, so Esc closes only this (not a window or dialog underneath that also listens for Esc).
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      latest.current.onClose(latest.current.index);
    };

    closeButton.current?.focus();
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onEsc, true);
    return () => {
      document.body.style.overflow = before;
      window.removeEventListener('keydown', onEsc, true);
    };
  }, []);

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      go(e.key === 'ArrowLeft' ? -1 : 1);
    } else if (e.key === 'Tab') {
      const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button, a[href]') || []);
      const first = items[0];
      const last = items[items.length - 1];

      if (!first) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return createPortal(
    <div ref={dialog} className='chb3-lightbox' role='dialog' aria-modal='true' aria-labelledby={titleId} onKeyDown={onKey}>
      <div className='flex items-center justify-between gap-2 px-4 py-3'>
        <span id={titleId} className='text-sm'>
          Picture {index + 1} of {count}
        </span>
        <button ref={closeButton} type='button' className='chb3-lb-btn' onClick={() => onClose(index)}>
          Close
        </button>
      </div>
      <div className='chb3-lb-stage' {...swipe}>
        <Picture key={im.id} url={im.url} alt={im.alt} kit={kit} box='h-40 w-full max-w-md' />
      </div>
      {im.caption.trim() && (
        <div className='px-4 pt-2 text-center text-sm'>
          <Text text={im.caption} />
        </div>
      )}
      <div className='flex items-center justify-center gap-3 px-4 py-4'>
        <button type='button' className='chb3-lb-btn' aria-disabled={index === 0} onClick={() => go(-1)}>
          ← Previous
        </button>
        <span className='text-sm' aria-live='polite'>
          {index + 1} of {count}
        </span>
        <button type='button' className='chb3-lb-btn' aria-disabled={index === count - 1} onClick={() => go(1)}>
          Next →
        </button>
      </div>
    </div>,
    document.body
  );
}

// ---- Sorting activity ---------------------------------------------------------

function shuffle<T>(list: T[]): T[] {
  const a = [...list];

  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [a[i], a[j]] = [a[j], a[i]];
  }

  return a;
}

function SortingView({ block, ctx, kit }: ViewProps<SortingBlock>) {
  const piles = block.piles.filter((p) => p.title.trim());
  const ids = new Set(piles.map((p) => p.id));
  const cards = block.cards.filter((c) => c.text.trim() && ids.has(c.pile_id));

  if (piles.length < 2 || !cards.length) {
    return ctx.preview ? <Placeholder>Add at least two groups and a card for each to try the sorting activity here.</Placeholder> : null;
  }

  // A new game whenever the groups or cards change (e.g. while editing in the Studio).
  return <SortingGame key={JSON.stringify([piles, cards])} block={block} piles={piles} cards={cards} ctx={ctx} kit={kit} />;
}

function SortingGame({
  block,
  piles,
  cards,
  ctx,
  kit,
}: {
  block: SortingBlock;
  piles: SortPile[];
  cards: SortCard[];
  ctx: BlockCtx;
  kit: Blocks3Kit;
}) {
  const { Text } = kit;
  const narrow = kit.useNarrow();
  const [order, setOrder] = useState(() => shuffle(cards));
  const [pos, setPos] = useState(0);
  const [note, setNote] = useState<{ good: boolean; text: string; sr: string; n: number } | null>(null);
  const [wrongPile, setWrongPile] = useState('');
  const [drag, setDrag] = useState<{ dx: number; dy: number; over: string } | null>(null);
  const grab = useRef<{ id: number; x: number; y: number } | null>(null);
  const pileEls = useRef(new Map<string, HTMLElement>());
  const root = useRef<HTMLDivElement>(null);
  const cardEl = useRef<HTMLDivElement>(null);
  const again = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<'again' | 'card' | ''>('');
  const reported = useRef(ctx.done.has(block.id));
  const card = pos < order.length ? order[pos] : null;

  useEffect(() => {
    if (!wrongPile) return undefined;
    const t = window.setTimeout(() => setWrongPile(''), 900);

    return () => window.clearTimeout(t);
  }, [wrongPile, note]);

  useEffect(() => {
    const want = focusNext.current;

    focusNext.current = '';
    if (want === 'again') again.current?.focus();
    else if (want === 'card') cardEl.current?.focus();
  }, [pos, order]);

  const say = (good: boolean, text: string, sr = text) => setNote({ good, text, sr, n: Date.now() });

  const place = (pileId: string) => {
    const pile = piles.find((p) => p.id === pileId);

    if (!card || !pile) return;
    if (card.pile_id !== pileId) {
      setWrongPile(pileId);
      say(false, 'Not quite — try another group.');
      return;
    }

    const next = order[pos + 1];
    const right = `Right — that goes in ${pile.title}.`;

    setWrongPile('');
    setPos(pos + 1);
    if (next) {
      say(true, right, `${right} Next card: ${plainText(next.text)}`);
      return;
    }

    say(true, right, `${right} All sorted!`);
    if (root.current?.contains(document.activeElement)) focusNext.current = 'again';
    if (!reported.current) {
      reported.current = true;
      ctx.onScenarioDone(block);
    }
  };

  const restart = () => {
    setOrder(shuffle(cards));
    setPos(0);
    setNote(null);
    setWrongPile('');
    focusNext.current = 'card';
  };

  const pileAt = (x: number, y: number) => {
    for (const [id, el] of pileEls.current) {
      const r = el.getBoundingClientRect();

      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id;
    }

    return '';
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    grab.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ dx: 0, dy: 0, over: '' });
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = grab.current;

    if (!g || g.id !== e.pointerId) return;
    setDrag({ dx: e.clientX - g.x, dy: e.clientY - g.y, over: pileAt(e.clientX, e.clientY) });
  };

  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = grab.current;

    if (!g || g.id !== e.pointerId) return;
    grab.current = null;
    const over = pileAt(e.clientX, e.clientY);

    setDrag(null);
    if (over) place(over);
  };

  const onCancel = () => {
    grab.current = null;
    setDrag(null);
  };

  return (
    <div ref={root} className='flex flex-col gap-3'>
      {block.prompt.trim() && (
        <div className='text-sm leading-relaxed'>
          <Text text={block.prompt} />
        </div>
      )}
      {card ? (
        <div className='flex flex-col items-center gap-1.5'>
          <div className='text-center text-xs text-text-tertiary'>
            Card {pos + 1} of {order.length} · drag it onto its group, or use the buttons
          </div>
          <div
            ref={cardEl}
            tabIndex={-1}
            className={cn(
              'chb3-card chb3-focus w-full max-w-[360px] rounded-[12px] border border-border-primary bg-fill-content px-4 py-4 text-center text-sm font-medium shadow-sm',
              drag && 'chb3-card-drag',
              !drag && note && !note.good && 'chl-bad'
            )}
            style={drag ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` } : undefined}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onCancel}
          >
            <Text text={card.text} />
          </div>
        </div>
      ) : (
        <div className='chl-good flex flex-col items-center gap-2 rounded-[12px] px-4 py-4 text-center'>
          <div className='text-base font-semibold'>All sorted!</div>
          <div className='text-sm text-text-secondary'>Every card is in the right group.</div>
          <Button ref={again} type='button' size='sm' variant='outline' onClick={restart}>
            Start again
          </Button>
        </div>
      )}
      <div
        aria-hidden='true'
        className={cn('min-h-[20px] text-center text-sm font-medium', note && (note.good ? 'chl-mark-right' : 'chl-mark-wrong'))}
      >
        {card && note?.text}
      </div>
      <div className='sr-only' aria-live='polite'>
        {note && <span key={note.n}>{note.sr}</span>}
      </div>
      <div className={cn('grid gap-2', !narrow && piles.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
        {piles.map((p) => {
          const sorted = order.slice(0, pos).filter((c) => c.pile_id === p.id);

          return (
            <div
              key={p.id}
              ref={(el) => {
                if (el) pileEls.current.set(p.id, el);
                else pileEls.current.delete(p.id);
              }}
              role='group'
              aria-label={p.title}
              className={cn(
                'chb3-pile flex min-w-0 flex-col gap-2 rounded-[12px] border border-border-primary p-3',
                drag?.over === p.id && 'chl-drop-target',
                wrongPile === p.id && 'chl-bad'
              )}
            >
              <div className='break-words text-sm font-semibold'>{p.title}</div>
              {card && (
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  className='h-auto min-h-[32px] whitespace-normal'
                  onClick={() => place(p.id)}
                >
                  Put in {p.title}
                </Button>
              )}
              {sorted.length > 0 && (
                <ul className='m-0 flex list-none flex-col gap-1 p-0'>
                  {sorted.map((c) => (
                    <li key={c.id} className='chl-good rounded-[8px] px-2 py-1 text-sm'>
                      <span className='chl-mark-right' aria-hidden='true'>
                        ✓{' '}
                      </span>
                      <Text text={c.text} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Studio: block menu entries, small fields, "Link to a lesson or block"
// ---------------------------------------------------------------------------

export const BLOCKS3_INFO: Record<Blocks3Type, { emoji: string; label: string; hint: string }> = {
  sorting: { emoji: '🧺', label: 'Sorting activity', hint: 'People sort cards into the right groups' },
  timeline: { emoji: '🗓️', label: 'Timeline', hint: 'Dates or steps along a line' },
  gallery: { emoji: '🎞️', label: 'Gallery', hint: 'Several pictures to flip through or open big' },
  table: { emoji: '📊', label: 'Table', hint: 'Rows and columns, like a small spreadsheet' },
  buttons: { emoji: '🔘', label: 'Buttons', hint: 'Buttons that open a link, file, page or lesson' },
};

type BlockNames = Record<string, { emoji: string; label: string }>;

/** What the editors need from CareHubLearningStudioBlocks (passed in, so this file has no runtime import of it). */
export interface Blocks3StudioKit {
  /** The Studio's picture field (upload or link). onUpload runs instead of onChange when an upload finishes. */
  picture: (o: { label: string; value: string; onChange: (url: string) => void; onUpload?: (url: string) => void }) => ReactNode;
  /** The Studio's file field (upload or link); onUpload gets the uploaded file's name. */
  file: (o: {
    label: string;
    value: string;
    name: string;
    onChange: (url: string) => void;
    onUpload: (url: string, name: string) => void;
  }) => ReactNode;
  /** Block names, for "Part of the lesson". */
  info: BlockNames;
  urlOk: (url: string) => boolean;
}

/** The lessons of the course being edited (the Studio sets it around a lesson's blocks). */
export const LinkCourseContext = createContext<Lesson[] | null>(null);

/** The block being edited (set by its card), so pickers can leave it out. */
export const LinkBlockContext = createContext<string | null>(null);

function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className='text-xs font-medium text-text-secondary'>{label}</span>
      {children}
      {hint && <span className='text-xs text-text-tertiary'>{hint}</span>}
    </label>
  );
}

function Line({
  value,
  onChange,
  placeholder,
  label,
  maxLength = 500,
  id,
  type = 'text',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
  maxLength?: number;
  id?: string;
  type?: 'text' | 'url' | 'search';
}) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      placeholder={placeholder}
      aria-label={label}
      maxLength={maxLength}
      className={cn(chInputClass, 'w-full min-w-0')}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** A text box with the "Link to a lesson or block" button. */
function Area({
  value,
  onChange,
  placeholder,
  label,
  rows = 2,
  info,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
  rows?: number;
  info: BlockNames;
}) {
  const box = useRef<HTMLTextAreaElement>(null);

  return (
    <LessonLinkWrap box={box} value={value} onChange={onChange} info={info}>
      <textarea
        ref={box}
        value={value}
        rows={rows}
        placeholder={placeholder}
        aria-label={label}
        maxLength={20000}
        className={cn(chInputClass, 'w-full min-w-0 resize-y leading-relaxed')}
        onChange={(e) => onChange(e.target.value)}
      />
    </LessonLinkWrap>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  danger,
  children,
  btnRef,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
  btnRef?: RefObject<HTMLButtonElement | null>;
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

function AddBtn({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
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

function move<T>(list: T[], from: number, to: number) {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [it] = next.splice(from, 1);

  next.splice(to, 0, it);
  return next;
}

/** Up / down / remove for one item of a list. */
function ItemTools({
  name,
  index,
  count,
  min,
  onMove,
  onRemove,
}: {
  name: string;
  index: number;
  count: number;
  min: number;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const up = useRef<HTMLButtonElement>(null);
  const down = useRef<HTMLButtonElement>(null);
  const remove = useRef<HTMLButtonElement>(null);
  const removeLabel = `Remove ${name}`;
  // Keep keyboard focus on the item after it moves (the button it used may now be off), and on the
  // next item after a remove, instead of dropping it on the page.
  const moveTo = (to: number, first: RefObject<HTMLButtonElement | null>, other: RefObject<HTMLButtonElement | null>) => {
    onMove(to);
    requestAnimationFrame(() => (first.current && !first.current.disabled ? first.current : other.current)?.focus());
  };
  const removeIt = () => {
    const mine = remove.current;
    const query = `button[aria-label="${removeLabel}"]`;
    let list = mine?.parentElement ?? null;

    while (list && list.querySelectorAll(query).length < 2) list = list.parentElement;
    const at = list && mine ? [...list.querySelectorAll(query)].indexOf(mine) : -1;

    onRemove();
    if (!list || at < 0) return;
    const scope = list;

    requestAnimationFrame(() => {
      const left = [...scope.querySelectorAll<HTMLButtonElement>(query)];
      const next = left[Math.min(at, left.length - 1)];

      if (!next) return;
      if (!next.disabled) return next.focus();
      let item: HTMLElement | null = next.parentElement;

      while (item && item !== scope && !item.querySelector('input, textarea')) item = item.parentElement;
      item?.querySelector<HTMLElement>('input, textarea')?.focus();
    });
  };

  return (
    <>
      <IconBtn btnRef={up} label='Move up' disabled={index === 0} onClick={() => moveTo(index - 1, up, down)}>
        ↑
      </IconBtn>
      <IconBtn btnRef={down} label='Move down' disabled={index === count - 1} onClick={() => moveTo(index + 1, down, up)}>
        ↓
      </IconBtn>
      <IconBtn btnRef={remove} label={removeLabel} danger disabled={count <= min} onClick={removeIt}>
        ×
      </IconBtn>
    </>
  );
}

const SNIPPET_SKIP = new Set([
  'id',
  'type',
  'url',
  'image_url',
  'view_id',
  'lesson_id',
  'block_id',
  'pile_id',
  'kind',
  'style',
  'layout',
  'tone',
  'width',
  'start',
  'next',
  'correct',
  'answers',
  'explanation',
  'feedback',
  'option_feedback',
  'target',
  'name',
]);

function blockWords(v: unknown, out: string[], depth = 0) {
  if (depth > 6 || out.join(' ').length > 60) return out;
  if (typeof v === 'string') {
    const t = plainText(v).replace(/\s+/g, ' ').trim();

    if (t) out.push(t);
  } else if (Array.isArray(v)) {
    v.forEach((x) => blockWords(x, out, depth + 1));
  } else if (v && typeof v === 'object') {
    Object.entries(v).forEach(([k, x]) => {
      if (!SNIPPET_SKIP.has(k)) blockWords(x, out, depth + 1);
    });
  }

  return out;
}

/** "3. Text · Welcome to the team" — a block's place, kind and first words, for "Part of the lesson". */
function blockLabel(b: Block, index: number, info: BlockNames) {
  const all = [...blockWords(b, []).join(' ')];
  const words = all.length > 48 ? `${all.slice(0, 47).join('')}…` : all.join('');

  return `${index + 1}. ${info[b.type]?.label || 'Block'}${words ? ` · ${words}` : ''}`;
}

/** Blocks a link can go to: everything except Continue buttons, dividers and the block being edited. */
function linkableParts(lesson: Lesson | undefined, info: BlockNames, here: string | null) {
  return (lesson?.blocks || []).flatMap((b, i) =>
    b.id === here || b.type === 'continue' || b.type === 'divider' ? [] : [{ value: b.id, label: blockLabel(b, i, info) }]
  );
}

/**
 * Adds "🔗 Link to a lesson or block" under a text box (shown while you're in the box; only inside a lesson's
 * blocks). It wraps the selected words in a link like [see Refunds](#lesson-l_ab12).
 */
export function LessonLinkWrap({
  box,
  value,
  onChange,
  info,
  children,
}: {
  box: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  value: string;
  onChange: (v: string) => void;
  info: BlockNames;
  children: ReactNode;
}) {
  const lessons = useContext(LinkCourseContext);
  const [picking, setPicking] = useState<{ start: number; end: number } | null>(null);

  useBlocks3Style();
  if (!lessons?.length) return <>{children}</>;
  const refocus = (caret: number) =>
    requestAnimationFrame(() => {
      const el = box.current;

      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });

  const insert = (text: string, href: string) => {
    if (!picking) return;
    const clean = text
      .replace(/[[\]\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Keep bold or italic stars outside the link: **[Refunds](#…)**.
    const m = /^(\*\*|\*)(.+)\1$/.exec(clean);
    const link = m ? `${m[1]}[${m[2]}](${href})${m[1]}` : `[${clean}](${href})`;

    onChange(value.slice(0, picking.start) + link + value.slice(picking.end));
    setPicking(null);
    refocus(picking.start + link.length);
  };

  return (
    <div className='chb3-linkwrap flex min-w-0 flex-col gap-1'>
      {children}
      <button
        type='button'
        className='chb3-linkbtn chb3-focus items-center gap-1 self-start rounded-[6px] px-1.5 py-0.5 text-xs font-medium text-text-action hover:bg-fill-content-hover'
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          const el = box.current;
          const start = Math.min(el?.selectionStart ?? value.length, value.length);
          const end = Math.max(start, Math.min(el?.selectionEnd ?? start, value.length));

          setPicking({ start, end });
        }}
      >
        <span aria-hidden='true'>🔗</span> Link to a lesson or block
      </button>
      {picking && (
        <LinkPicker
          lessons={lessons}
          info={info}
          words={value.slice(picking.start, picking.end)}
          onPick={insert}
          onClose={() => {
            refocus(picking.end);
            setPicking(null);
          }}
        />
      )}
    </div>
  );
}

function LinkPicker({
  lessons,
  info,
  words,
  onPick,
  onClose,
}: {
  lessons: Lesson[];
  info: BlockNames;
  words: string;
  onPick: (text: string, href: string) => void;
  onClose: () => void;
}) {
  const here = useContext(LinkBlockContext);
  const home = lessons.find((l) => l.blocks.some((b) => b.id === here)) || lessons[0];
  const [text, setText] = useState(() => words.replace(/\s+/g, ' ').trim());
  const [lessonId, setLessonId] = useState(home.id);
  const [blockId, setBlockId] = useState('');
  const lesson = lessons.find((l) => l.id === lessonId) || home;
  const parts = [{ value: '', label: 'The top of the lesson' }, ...linkableParts(lesson, info, here)];
  const ok = Boolean(text.trim());
  const add = () => {
    if (ok) onPick(text, blockId ? `#block-${blockId}` : `#lesson-${lesson.id}`);
  };

  return (
    <CareHubModal
      title='Link to a lesson or block'
      onClose={onClose}
      testId='carehub-learning-link-picker'
      footer={
        <div className='flex justify-end gap-2'>
          <Button type='button' variant='outline' onClick={onClose}>
            Cancel
          </Button>
          <Button type='button' disabled={!ok} onClick={add}>
            Add link
          </Button>
        </div>
      }
    >
      <form
        className='flex flex-col gap-3'
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Field label='Link text' hint='The words people click. Select words in the text box first to use them.'>
          <input
            autoFocus
            value={text}
            maxLength={200}
            placeholder='e.g. see the refunds lesson'
            className={cn(chInputClass, 'w-full min-w-0')}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
        <Field label='Lesson'>
          <ChSelect
            value={lesson.id}
            options={lessons.map((l, i) => ({ value: l.id, label: `${i + 1}. ${l.title.trim() || 'Untitled lesson'}` }))}
            onChange={(v) => {
              setLessonId(v);
              setBlockId('');
            }}
          />
        </Field>
        <Field label='Part of the lesson'>
          <ChSelect value={parts.some((p) => p.value === blockId) ? blockId : ''} options={parts} onChange={setBlockId} />
        </Field>
        <p className='m-0 text-xs text-text-tertiary'>
          The link takes people straight there. In a course that goes in order, it opens once the lessons before it are done.
        </p>
      </form>
    </CareHubModal>
  );
}

// ---------------------------------------------------------------------------
// Studio: editors
// ---------------------------------------------------------------------------

type EditorProps<B> = { block: B; onChange: (b: Block) => void; kit: Blocks3StudioKit };

export function Blocks3Editor({ block, onChange, kit }: EditorProps<Blocks3Block>) {
  useBlocks3Style();
  switch (block.type) {
    case 'sorting':
      return <SortingEditor block={block} onChange={onChange} kit={kit} />;
    case 'timeline':
      return <TimelineEditor block={block} onChange={onChange} kit={kit} />;
    case 'gallery':
      return <GalleryEditor block={block} onChange={onChange} kit={kit} />;
    case 'table':
      return <TableEditor block={block} onChange={onChange} kit={kit} />;
    case 'buttons':
      return <ButtonsEditor block={block} onChange={onChange} kit={kit} />;
    default:
      return null;
  }
}

/** After an upload, move to the picture's description so it isn't forgotten. */
function focusSoon(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.focus());
}

function SortingEditor({ block, onChange, kit }: EditorProps<SortingBlock>) {
  const { piles, cards } = block;
  const setPile = (i: number, title: string) => onChange({ ...block, piles: piles.map((p, j) => (j === i ? { ...p, title } : p)) });
  const setCard = (i: number, patch: Partial<SortCard>) =>
    onChange({ ...block, cards: cards.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const groupOptions = [
    { value: '', label: 'Pick a group' },
    ...piles.map((p, i) => ({ value: p.id, label: p.title.trim() || `Group ${i + 1}` })),
  ];

  return (
    <div className='flex flex-col gap-4'>
      <Field label='What to do (optional)'>
        <Area
          value={block.prompt}
          onChange={(v) => onChange({ ...block, prompt: v })}
          placeholder='e.g. Sort each request into the team that handles it.'
          info={kit.info}
        />
      </Field>
      <div className='flex flex-col gap-2'>
        <div className='text-xs font-medium text-text-secondary'>Groups (2 to 4)</div>
        {piles.map((p, i) => (
          <div key={p.id} className='flex items-center gap-1'>
            <Line
              value={p.title}
              onChange={(v) => setPile(i, v)}
              placeholder={`Group ${i + 1} name, e.g. Billing`}
              label={`Group ${i + 1} name`}
              maxLength={L.pileTitle}
            />
            <ItemTools
              name='group'
              index={i}
              count={piles.length}
              min={2}
              onMove={(to) => onChange({ ...block, piles: move(piles, i, to) })}
              onRemove={() =>
                onChange({
                  ...block,
                  piles: piles.filter((_, j) => j !== i),
                  cards: cards.map((c) => (c.pile_id === p.id ? { ...c, pile_id: '' } : c)),
                })
              }
            />
          </div>
        ))}
        <AddBtn disabled={piles.length >= L.piles} onClick={() => onChange({ ...block, piles: [...piles, blankPile()] })}>
          Add a group
        </AddBtn>
      </div>
      <div className='flex flex-col gap-2'>
        <div className='text-xs font-medium text-text-secondary'>Cards (2 to 20) and the group each belongs in</div>
        {cards.map((c, i) => (
          <div key={c.id} className='flex flex-col gap-1.5 rounded-[10px] border border-border-primary p-2.5 sm:flex-row sm:items-center'>
            <Line
              value={c.text}
              onChange={(v) => setCard(i, { text: v })}
              placeholder={`Card ${i + 1}, e.g. Refund request`}
              label={`Card ${i + 1} text`}
              maxLength={L.cardText}
            />
            <div className='flex items-center gap-1'>
              <ChSelect
                value={piles.some((p) => p.id === c.pile_id) ? c.pile_id : ''}
                options={groupOptions}
                onChange={(v) => setCard(i, { pile_id: v })}
                ariaLabel={`Group for card ${i + 1}`}
                className={cn('min-w-[140px] flex-1', !c.pile_id && 'text-text-tertiary')}
              />
              <ItemTools
                name='card'
                index={i}
                count={cards.length}
                min={2}
                onMove={(to) => onChange({ ...block, cards: move(cards, i, to) })}
                onRemove={() => onChange({ ...block, cards: cards.filter((_, j) => j !== i) })}
              />
            </div>
          </div>
        ))}
        <AddBtn
          disabled={cards.length >= L.cards}
          onClick={() => onChange({ ...block, cards: [...cards, blankCard(cards[cards.length - 1]?.pile_id || piles[0]?.id || '')] })}
        >
          Add a card
        </AddBtn>
      </div>
      <p className='m-0 text-xs text-text-tertiary'>
        People see one card at a time, in a random order, and drag it onto its group (or press the group’s button). A wrong group sends the
        card back to try again.
      </p>
    </div>
  );
}

function TimelineEditor({ block, onChange, kit }: EditorProps<TimelineBlock>) {
  const uid = useId();
  const { items } = block;
  const set = (i: number, patch: Partial<TimelineItem>) =>
    onChange({ ...block, items: items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });

  return (
    <div className='flex flex-col gap-2'>
      {items.map((it, i) => (
        <div key={it.id} className='flex flex-col gap-2 rounded-[10px] border border-border-primary p-2.5'>
          <div className='flex items-center gap-1'>
            <span className='flex-1 text-xs font-medium text-text-secondary'>Entry {i + 1}</span>
            <ItemTools
              name='entry'
              index={i}
              count={items.length}
              min={2}
              onMove={(to) => onChange({ ...block, items: move(items, i, to) })}
              onRemove={() => onChange({ ...block, items: items.filter((_, j) => j !== i) })}
            />
          </div>
          <div className='grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]'>
            <Field label='Date or step'>
              <Line value={it.date} onChange={(v) => set(i, { date: v })} placeholder='e.g. 2019 or Week 1' maxLength={L.entryText} />
            </Field>
            <Field label='Title'>
              <Line
                value={it.title}
                onChange={(v) => set(i, { title: v })}
                placeholder='e.g. We opened our first office'
                maxLength={L.entryText}
              />
            </Field>
          </div>
          <Field label='Description (optional)'>
            <Area value={it.text} onChange={(v) => set(i, { text: v })} placeholder='A sentence or two about it' info={kit.info} />
          </Field>
          {kit.picture({
            label: 'Picture (optional)',
            value: it.image_url,
            onChange: (url) => set(i, { image_url: url }),
            onUpload: (url) => {
              set(i, { image_url: url });
              if (!it.image_alt.trim()) focusSoon(`${uid}-alt-${it.id}`);
            },
          })}
          {it.image_url.trim() && (
            <Field label='Describe the picture' hint='For people who can’t see it. Needed to publish.'>
              <Line
                id={`${uid}-alt-${it.id}`}
                value={it.image_alt}
                onChange={(v) => set(i, { image_alt: v })}
                placeholder='e.g. The team outside the new office'
              />
            </Field>
          )}
        </div>
      ))}
      <AddBtn disabled={items.length >= L.entries} onClick={() => onChange({ ...block, items: [...items, blankEntry()] })}>
        Add an entry
      </AddBtn>
    </div>
  );
}

const LAYOUTS: { value: GalleryLayout; label: string }[] = [
  { value: 'carousel', label: 'One at a time, with Previous and Next' },
  { value: 'grid', label: 'A grid — click a picture to see it big' },
];

function GalleryEditor({ block, onChange, kit }: EditorProps<GalleryBlock>) {
  const uid = useId();
  const { images } = block;
  const set = (i: number, patch: Partial<GalleryImage>) =>
    onChange({ ...block, images: images.map((im, j) => (j === i ? { ...im, ...patch } : im)) });

  return (
    <div className='flex flex-col gap-3'>
      <Field label='Show the pictures'>
        <ChSelect value={block.layout} options={LAYOUTS} onChange={(v) => onChange({ ...block, layout: v })} />
      </Field>
      <div className='flex flex-col gap-2'>
        {images.map((im, i) => (
          <div key={im.id} className='flex flex-col gap-2 rounded-[10px] border border-border-primary p-2.5'>
            <div className='flex items-center gap-1'>
              <span className='flex-1 text-xs font-medium text-text-secondary'>Picture {i + 1}</span>
              <ItemTools
                name='picture'
                index={i}
                count={images.length}
                min={2}
                onMove={(to) => onChange({ ...block, images: move(images, i, to) })}
                onRemove={() => onChange({ ...block, images: images.filter((_, j) => j !== i) })}
              />
            </div>
            {kit.picture({
              label: 'Picture',
              value: im.url,
              onChange: (url) => set(i, { url }),
              onUpload: (url) => {
                set(i, { url });
                if (!im.alt.trim()) focusSoon(`${uid}-alt-${im.id}`);
              },
            })}
            <Field label='Describe the picture' hint={im.alt.trim() ? undefined : 'For people who can’t see it. Needed to publish.'}>
              <Line
                id={`${uid}-alt-${im.id}`}
                value={im.alt}
                onChange={(v) => set(i, { alt: v })}
                placeholder='e.g. The front desk at the main office'
              />
            </Field>
            <Field label='Caption (optional)'>
              <Line value={im.caption} onChange={(v) => set(i, { caption: v })} placeholder='Shown under the picture' />
            </Field>
          </div>
        ))}
        <AddBtn disabled={images.length >= L.pictures} onClick={() => onChange({ ...block, images: [...images, blankPicture()] })}>
          Add a picture
        </AddBtn>
      </div>
    </div>
  );
}

/** Cells copied from Excel or Google Sheets: tabs between cells, new lines between rows, "quoted" cells. */
function parseCells(text: string): string[][] {
  const t = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < t.length; i++) {
    const ch = t[i];

    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (t[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"' && !cell) quoted = true;
    else if (ch === '\t') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

function ToolBtn({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type='button'
      disabled={disabled}
      onClick={onClick}
      className='rounded-[8px] border border-border-primary px-2 py-1 text-xs font-medium hover:bg-fill-content-hover disabled:cursor-not-allowed disabled:opacity-40'
    >
      {children}
    </button>
  );
}

function TableEditor({ block, onChange }: EditorProps<TableBlock>) {
  const grid = useRef<HTMLDivElement>(null);
  const [cell, setCell] = useState({ r: 0, c: 0 });
  const [note, setNote] = useState('');
  const { rows } = block;
  const width = rows[0]?.length || 1;
  const r0 = Math.min(cell.r, rows.length - 1);
  const c0 = Math.min(cell.c, width - 1);
  const setRows = (next: string[][]) => onChange({ ...block, rows: next });
  const focusCell = (r: number, c: number) => {
    setCell({ r, c });
    requestAnimationFrame(() => grid.current?.querySelector<HTMLInputElement>(`[data-cell="${r}-${c}"]`)?.focus());
  };

  const setText = (r: number, c: number, v: string) =>
    setRows(rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)));
  const addRow = () => {
    setRows([...rows.slice(0, r0 + 1), Array.from({ length: width }, () => ''), ...rows.slice(r0 + 1)]);
    focusCell(r0 + 1, c0);
  };

  const removeRow = () => {
    setRows(rows.filter((_, i) => i !== r0));
    focusCell(Math.min(r0, rows.length - 2), c0);
  };

  const addColumn = () => {
    setRows(rows.map((row) => [...row.slice(0, c0 + 1), '', ...row.slice(c0 + 1)]));
    focusCell(r0, c0 + 1);
  };

  const removeColumn = () => {
    setRows(rows.map((row) => row.filter((_, j) => j !== c0)));
    focusCell(r0, Math.min(c0, width - 2));
  };

  const paste = (e: ReactClipboardEvent<HTMLInputElement>, r: number, c: number) => {
    const text = e.clipboardData.getData('text/plain');

    if (!/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return;
    e.preventDefault();
    const got = parseCells(text);
    const gotWidth = Math.max(...got.map((g) => g.length));
    let lost = r + got.length > L.rows || c + gotWidth > L.cols;
    const height = Math.max(rows.length, Math.min(L.rows, r + got.length));
    const cols = Math.max(width, Math.min(L.cols, c + gotWidth));
    const next = Array.from({ length: height }, (_, i) => Array.from({ length: cols }, (_, j) => rows[i]?.[j] ?? ''));

    got.forEach((g, i) =>
      g.forEach((v, j) => {
        if (r + i >= L.rows || c + j >= L.cols) return;
        const clean = v.replace(/\s*\n\s*/g, ' ');

        if (chars(clean) > L.cell) lost = true;
        next[r + i][c + j] = cut(clean, L.cell);
      })
    );
    setRows(next);
    setNote(
      lost
        ? 'Pasted. Some cells didn’t fit: a table can have up to 30 rows and 6 columns, and 300 characters in a cell.'
        : `Pasted ${got.length} ${got.length === 1 ? 'row' : 'rows'}.`
    );
  };

  return (
    <div className='flex flex-col gap-3'>
      <div ref={grid} className='overflow-x-auto rounded-[10px] border border-border-primary'>
        <table className='w-full border-collapse'>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className={cn(block.header && r === 0 && 'bg-fill-content-hover')}>
                {row.map((v, c) => (
                  <td key={c} className='min-w-[8rem] border-b border-r border-border-primary p-1'>
                    <input
                      data-cell={`${r}-${c}`}
                      value={v}
                      maxLength={L.cell}
                      aria-label={block.header && r === 0 ? `Header, column ${c + 1}` : `Row ${r + 1}, column ${c + 1}`}
                      className={cn(
                        'chb3-focus w-full min-w-0 rounded-[6px] bg-transparent px-2 py-1.5 text-sm',
                        block.header && r === 0 && 'font-semibold'
                      )}
                      onFocus={() => setCell({ r, c })}
                      onChange={(e) => setText(r, c, e.target.value)}
                      onPaste={(e) => paste(e, r, c)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className='flex flex-wrap items-center gap-1'>
        <span className='mr-1 text-xs text-text-tertiary'>
          Row {r0 + 1}, column {c0 + 1}:
        </span>
        <ToolBtn onClick={addRow} disabled={rows.length >= L.rows}>
          + Row below
        </ToolBtn>
        <ToolBtn onClick={removeRow} disabled={rows.length <= 1}>
          − Remove row
        </ToolBtn>
        <ToolBtn onClick={addColumn} disabled={width >= L.cols}>
          + Column to the right
        </ToolBtn>
        <ToolBtn onClick={removeColumn} disabled={width <= 1}>
          − Remove column
        </ToolBtn>
      </div>
      <label className='flex cursor-pointer items-center gap-2 text-sm'>
        <input type='checkbox' checked={block.header} onChange={(e) => onChange({ ...block, header: e.target.checked })} />
        The first row is a header
      </label>
      <Field label='Caption (optional)'>
        <Line value={block.caption} onChange={(v) => onChange({ ...block, caption: v })} placeholder='e.g. Opening hours at each office' />
      </Field>
      <p className='m-0 text-xs text-text-tertiary'>
        Up to 30 rows and 6 columns. Tab moves to the next cell. Tip: copy cells in Excel or Google Sheets and paste them into a cell.
      </p>
      <div role='status' className='text-xs text-text-secondary'>
        {note}
      </div>
    </div>
  );
}

const LOOKS: { value: ButtonStyle; label: string }[] = [
  { value: 'primary', label: 'Filled' },
  { value: 'secondary', label: 'Outline' },
];

const GOES_TO: { value: ButtonTarget['kind']; label: string }[] = [
  { value: 'link', label: 'A website or link' },
  { value: 'file', label: 'A file to download' },
  { value: 'page', label: 'A Care Hub page' },
  { value: 'lesson', label: 'A lesson or part of this course' },
];

function ButtonsEditor({ block, onChange, kit }: EditorProps<ButtonsBlock>) {
  const lessons = useContext(LinkCourseContext);
  const here = useContext(LinkBlockContext);
  const { items } = block;
  const set = (i: number, patch: Partial<LinkButton>) =>
    onChange({ ...block, items: items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  const fresh = (kind: ButtonTarget['kind']): ButtonTarget => {
    if (kind === 'file') return { kind, url: '', name: '' };
    if (kind === 'page') return { kind, view_id: '', title: '' };
    if (kind === 'lesson') {
      const home = lessons?.find((l) => l.blocks.some((b) => b.id === here)) || lessons?.[0];

      return { kind, lesson_id: home?.id || '', block_id: '' };
    }

    return { kind: 'link', url: '' };
  };

  return (
    <div className='flex flex-col gap-2'>
      {items.map((it, i) => (
        <div key={it.id} className='flex flex-col gap-2 rounded-[10px] border border-border-primary p-2.5'>
          <div className='flex items-center gap-1'>
            <span className='flex-1 text-xs font-medium text-text-secondary'>Button {i + 1}</span>
            <ItemTools
              name='button'
              index={i}
              count={items.length}
              min={1}
              onMove={(to) => onChange({ ...block, items: move(items, i, to) })}
              onRemove={() => onChange({ ...block, items: items.filter((_, j) => j !== i) })}
            />
          </div>
          <div className='grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]'>
            <Field label='Text on the button'>
              <Line value={it.label} onChange={(v) => set(i, { label: v })} placeholder='e.g. Open the refund form' maxLength={L.label} />
            </Field>
            <Field label='Look'>
              <ChSelect value={it.style} options={LOOKS} onChange={(v) => set(i, { style: v })} />
            </Field>
          </div>
          <Field label='Goes to'>
            <ChSelect
              value={it.target.kind}
              options={GOES_TO}
              onChange={(v) => {
                if (v !== it.target.kind) set(i, { target: fresh(v) });
              }}
            />
          </Field>
          <TargetEditor
            target={it.target}
            lessons={lessons}
            here={here}
            kit={kit}
            onChange={(target, name) => set(i, name && !it.label.trim() ? { target, label: cut(name, L.label) } : { target })}
          />
        </div>
      ))}
      <AddBtn disabled={items.length >= L.buttons} onClick={() => onChange({ ...block, items: [...items, blankButton()] })}>
        Add a button
      </AddBtn>
    </div>
  );
}

/** The fields for where a button goes. `name` (a page's name) fills in an empty button label. */
function TargetEditor({
  target: t,
  lessons,
  here,
  kit,
  onChange,
}: {
  target: ButtonTarget;
  lessons: Lesson[] | null;
  here: string | null;
  kit: Blocks3StudioKit;
  onChange: (t: ButtonTarget, name?: string) => void;
}) {
  if (t.kind === 'link') {
    const bad = Boolean(t.url.trim()) && !kit.urlOk(t.url);

    return (
      <Field
        label='Link'
        hint={
          bad ? (
            <span className='text-text-error'>Links must start with https:// (or be a Care Hub link starting with /).</span>
          ) : (
            'Opens in a new tab.'
          )
        }
      >
        <Line type='url' value={t.url} onChange={(v) => onChange({ ...t, url: v })} placeholder='https://' maxLength={2000} />
      </Field>
    );
  }

  if (t.kind === 'file') {
    return (
      <div className='flex flex-col gap-2'>
        {kit.file({
          label: 'File',
          value: t.url,
          name: t.name,
          onChange: (url) => onChange({ ...t, url }),
          onUpload: (url, name) => onChange({ ...t, url, name: t.name.trim() ? t.name : cut(name, 200) }),
        })}
        <Field label='File name when downloaded (optional)'>
          <Line value={t.name} onChange={(v) => onChange({ ...t, name: v })} placeholder='e.g. Refund checklist.pdf' maxLength={200} />
        </Field>
      </div>
    );
  }

  if (t.kind === 'page')
    return (
      <PagePicker
        viewId={t.view_id}
        title={t.title}
        onPick={(viewId, title) => onChange({ kind: 'page', view_id: viewId, title }, title)}
      />
    );
  return (
    <LessonTarget
      target={t}
      lessons={lessons}
      here={here}
      info={kit.info}
      onChange={(lessonId, blockId) => onChange({ kind: 'lesson', lesson_id: lessonId, block_id: blockId })}
    />
  );
}

/** Search the sidebar's pages, like the "Care Hub page" block. */
function PagePicker({ viewId, title, onPick }: { viewId: string; title: string; onPick: (viewId: string, title: string) => void }) {
  const pages = useSharablePages();
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState(!viewId);
  const found = useMemo(() => filterPages(pages, query, 8), [pages, query]);
  const current = pages.find((p) => p.viewId === viewId);

  if (viewId && !picking) {
    return (
      <div className='flex items-center gap-2 rounded-[10px] border border-border-primary px-3 py-2'>
        <span aria-hidden='true'>{current?.icon || '📄'}</span>
        <span className='min-w-0 flex-1'>
          <span className='block truncate text-sm font-medium'>{current?.name || title || 'Linked page'}</span>
          {current?.trail && <span className='block truncate text-xs text-text-tertiary'>{current.trail}</span>}
          {!current && (
            <span className='block text-xs text-text-tertiary'>This page isn’t in your sidebar (it may be private to someone else).</span>
          )}
        </span>
        <button type='button' className='text-sm font-medium text-text-action' onClick={() => setPicking(true)}>
          Change
        </button>
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-1.5'>
      <Line type='search' value={query} onChange={setQuery} placeholder='Search for a page' label='Search for a page' />
      <div className='flex max-h-[220px] flex-col overflow-y-auto rounded-[10px] border border-border-primary p-1'>
        {found.length ? (
          found.map((p) => (
            <button
              key={p.viewId}
              type='button'
              className='flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-sm hover:bg-fill-content-hover'
              onClick={() => {
                onPick(p.viewId, p.name);
                setPicking(false);
                setQuery('');
              }}
            >
              <span aria-hidden='true'>{p.icon || '📄'}</span>
              <span className='min-w-0 flex-1'>
                <span className='block truncate'>{p.name}</span>
                {p.trail && <span className='block truncate text-xs text-text-tertiary'>{p.trail}</span>}
              </span>
              {p.isPrivate && <span className='text-xs text-text-tertiary'>Private</span>}
            </button>
          ))
        ) : (
          <div className='px-2 py-3 text-center text-sm text-text-tertiary'>{pages.length ? 'No pages match.' : 'No pages found.'}</div>
        )}
      </div>
      {viewId && (
        <button type='button' className='self-start text-sm text-text-secondary underline' onClick={() => setPicking(false)}>
          Keep the current page
        </button>
      )}
      <span className='text-xs text-text-tertiary'>Opens in a new tab. Learners need access to the page to open it.</span>
    </div>
  );
}

function LessonTarget({
  target,
  lessons,
  here,
  info,
  onChange,
}: {
  target: { lesson_id: string; block_id: string };
  lessons: Lesson[] | null;
  here: string | null;
  info: BlockNames;
  onChange: (lessonId: string, blockId: string) => void;
}) {
  if (!lessons?.length) return <p className='m-0 text-xs text-text-tertiary'>Add a lesson to the course first.</p>;
  const lesson = lessons.find((l) => l.id === target.lesson_id);
  const parts = [{ value: '', label: 'The top of the lesson' }, ...linkableParts(lesson, info, here)];
  const partGone = Boolean(lesson && target.block_id && !parts.some((p) => p.value === target.block_id));
  const options = [
    ...(lesson ? [] : [{ value: '', label: 'Pick a lesson' }]),
    ...lessons.map((l, i) => ({ value: l.id, label: `${i + 1}. ${l.title.trim() || 'Untitled lesson'}` })),
  ];
  const problem = !lesson
    ? target.lesson_id
      ? 'The lesson this button opened is no longer in the course. Pick another one.'
      : 'Pick the lesson this button opens.'
    : partGone
      ? 'The part this button opened is no longer in that lesson. Pick another part, or the top of the lesson.'
      : '';

  return (
    <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
      <Field label='Lesson'>
        <ChSelect
          value={lesson ? lesson.id : ''}
          options={options}
          onChange={(v) => {
            if (v) onChange(v, '');
          }}
        />
      </Field>
      <Field label='Part of the lesson'>
        <ChSelect
          value={partGone ? '' : target.block_id}
          options={parts}
          disabled={!lesson}
          onChange={(v) => {
            if (lesson) onChange(lesson.id, v);
          }}
        />
      </Field>
      {problem && <p className='m-0 text-xs text-text-error sm:col-span-2'>{problem}</p>}
    </div>
  );
}

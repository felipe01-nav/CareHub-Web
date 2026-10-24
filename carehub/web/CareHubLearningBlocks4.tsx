// CareHub Learning: wave 6 lesson blocks — two-column text, code snippets and quote carousels — and the new looks of
// three older blocks: dividers (line, numbered, spacer), quotes on a photo, and image layouts (picture beside text,
// text on the picture, banner).
//
// Everything for them lives here; the other Learning files only call in. Like CareHubLearningBlocks3, this file
// imports only types from the files that call it (runtime imports would make a cycle): rich text, picture downloads
// and the Studio's picture field come in through small "kit" objects instead. It reuses a few helpers from
// CareHubLearningBlocks3 and CareHubUi, which import nothing back.
// Shapes: lead/WAVE6.md B1–B5. Characters are counted as Unicode code points, like the server.

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import type { ComponentType, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { LessonLinkWrap, plainText } from './CareHubLearningBlocks3';
import { chInputClass, ChSelect } from './CareHubUi';

import type { Block, BlockOf } from './CareHubLearningApi';
import type { BlockCtx, FileLoad } from './CareHubLearningBlocks';

// ---------------------------------------------------------------------------
// Shapes and limits
// ---------------------------------------------------------------------------

export type DividerStyle = 'line' | 'numbered' | 'spacer';
export type SpacerSize = 'small' | 'medium' | 'large';
export type CodeLanguage = 'plain' | 'json' | 'sql' | 'python' | 'javascript' | 'html' | 'css' | 'bash' | 'yaml' | 'xml';
export type ImageLayout = 'plain' | 'side' | 'text_on' | 'banner';
export type ImageSide = 'left' | 'right';

/** Two columns of text (tiny markdown), side by side when there's room; stacked on phones, left first. */
export interface ColumnsBlock {
  id: string;
  type: 'columns';
  left: string;
  right: string;
}

/** Plain text in a fixed-width font, with a Copy button. No colouring. */
export interface CodeBlock {
  id: string;
  type: 'code';
  language: CodeLanguage;
  code: string;
  caption: string;
}

export interface CarouselQuote {
  id: string;
  text: string;
  cite: string;
  /** A small round photo ("" = none). */
  image_url: string;
  /** "" = decorative. */
  image_alt: string;
}

/** Quotes shown one at a time, with Previous and Next. */
export interface QuoteCarouselBlock {
  id: string;
  type: 'quote_carousel';
  quotes: CarouselQuote[];
}

export type Blocks4Block = ColumnsBlock | CodeBlock | QuoteCarouselBlock;
export type Blocks4Type = Blocks4Block['type'];

export const BLOCKS4_TYPES: readonly Blocks4Type[] = ['columns', 'code', 'quote_carousel'];

export function isBlocks4Type(type: unknown): type is Blocks4Type {
  return typeof type === 'string' && (BLOCKS4_TYPES as readonly string[]).includes(type);
}

/** Limits (characters are counted as Unicode code points, like the server). */
export const BLOCKS4_LIMITS = {
  columnText: 5000,
  code: 10000,
  codeCaption: 200,
  quotes: 10,
  quoteText: 600,
  quoteCite: 100,
  sideText: 2000,
  overlayText: 300,
} as const;

const L = BLOCKS4_LIMITS;

const DIVIDER_STYLES: readonly DividerStyle[] = ['line', 'numbered', 'spacer'];
const SPACER_SIZES: readonly SpacerSize[] = ['small', 'medium', 'large'];
const IMAGE_LAYOUTS: readonly ImageLayout[] = ['plain', 'side', 'text_on', 'banner'];

export const CODE_LANGUAGES: { value: CodeLanguage; label: string }[] = [
  { value: 'plain', label: 'Plain text' },
  { value: 'json', label: 'JSON' },
  { value: 'sql', label: 'SQL' },
  { value: 'python', label: 'Python' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'bash', label: 'Bash' },
  { value: 'yaml', label: 'YAML' },
  { value: 'xml', label: 'XML' },
];

type DividerBlock = BlockOf<'divider'>;
type QuoteBlock = BlockOf<'quote'>;
type ImageBlock = BlockOf<'image'>;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A new id in the same form as newId in CareHubLearningApi ("qt_k3j9x0a1"). */
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

function oneOf<T extends string>(v: unknown, list: readonly T[], fallback: T): T {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback;
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

function words(s: string) {
  const t = s.trim();

  return t ? t.split(/\s+/).length : 0;
}

// ---------------------------------------------------------------------------
// The new fields of dividers, quotes and images (missing or unknown → today's look)
// ---------------------------------------------------------------------------

export function dividerStyle(b: { style?: unknown }): DividerStyle {
  return oneOf(b.style, DIVIDER_STYLES, 'line');
}

export function spacerSize(b: { size?: unknown }): SpacerSize {
  return oneOf(b.size, SPACER_SIZES, 'medium');
}

export function imageLayout(b: { layout?: unknown }): ImageLayout {
  return oneOf(b.layout, IMAGE_LAYOUTS, 'plain');
}

export function imageSide(b: { side?: unknown }): ImageSide {
  return b.side === 'right' ? 'right' : 'left';
}

/** Layouts that show the image's text. */
function layoutHasText(layout: ImageLayout) {
  return layout === 'side' || layout === 'text_on';
}

// The readers below leave out every value that means "today's look" ("line", "medium", "plain", "left", ""),
// so dividers, quotes and images made before these options are saved exactly as they were.

/** A saved divider's look (spread into the divider in normalizeBlock). */
export function dividerExtras(o: { style?: unknown; size?: unknown }): { style?: DividerStyle; size?: SpacerSize } {
  const style = dividerStyle(o);
  const size = spacerSize(o);

  return { ...(style === 'line' ? {} : { style }), ...(size === 'medium' ? {} : { size }) };
}

/** A saved quote's photo (spread into the quote in normalizeBlock). */
export function quoteExtras(o: { image_url?: unknown; image_alt?: unknown }): { image_url?: string; image_alt?: string } {
  const image_url = str(o.image_url);
  const image_alt = str(o.image_alt);

  return { ...(image_url ? { image_url } : {}), ...(image_alt ? { image_alt } : {}) };
}

/** A saved image's layout (spread into the image in normalizeBlock). The text keeps up to 2,000 characters in
 * every layout, so switching layouts never loses words; "Text on the picture" asks for 300 or fewer to publish. */
export function imageExtras(o: { layout?: unknown; side?: unknown; text?: unknown }): {
  layout?: ImageLayout;
  text?: string;
  side?: ImageSide;
} {
  const layout = imageLayout(o);
  const side = imageSide(o);
  const text = cut(str(o.text), L.sideText);

  return { ...(layout === 'plain' ? {} : { layout }), ...(text ? { text } : {}), ...(side === 'left' ? {} : { side }) };
}

/** The block with its divider / quote / image options re-read the same way (used by the editors). */
function lean<T extends DividerBlock | QuoteBlock | ImageBlock>(b: T): T {
  if (b.type === 'divider') {
    const { style, size, ...rest } = b;

    return { ...rest, ...dividerExtras({ style, size }) } as T;
  }
  if (b.type === 'quote') {
    const { image_url, image_alt, ...rest } = b;

    return { ...rest, ...quoteExtras({ image_url, image_alt }) } as T;
  }
  const { layout, side, text, ...rest } = b as ImageBlock;

  return { ...rest, ...imageExtras({ layout, side, text }) } as T;
}

// ---------------------------------------------------------------------------
// Reading saved blocks, new blocks, copies, reading time
// ---------------------------------------------------------------------------

export function normalizeBlocks4(o: Record<string, unknown>, id: string): Blocks4Block {
  switch (o.type) {
    case 'columns':
      return { id, type: 'columns', left: cut(str(o.left), L.columnText), right: cut(str(o.right), L.columnText) };
    case 'code':
      // Words first, so "Link to a lesson or block" names the block by its caption or code, not "sql".
      return {
        id,
        type: 'code',
        caption: cut(str(o.caption), L.codeCaption),
        code: cut(str(o.code), L.code),
        language: oneOf(o.language, CODE_LANGUAGES.map((l) => l.value), 'plain'),
      };
    case 'quote_carousel':
    default: {
      const seen = new Set<string>();

      return {
        id,
        type: 'quote_carousel',
        quotes: arr(o.quotes)
          .slice(0, L.quotes)
          .map((x): CarouselQuote => {
            const q = obj(x);

            return {
              id: itemId(q.id, 'qt', seen),
              text: cut(str(q.text), L.quoteText),
              cite: cut(str(q.cite), L.quoteCite),
              image_url: str(q.image_url),
              image_alt: str(q.image_alt),
            };
          }),
      };
    }
  }
}

export function blankCarouselQuote(): CarouselQuote {
  return { id: makeId('qt'), text: '', cite: '', image_url: '', image_alt: '' };
}

export function blankBlocks4(type: Blocks4Type, id: string): Blocks4Block {
  switch (type) {
    case 'columns':
      return { id, type, left: '', right: '' };
    case 'code':
      return { id, type, caption: '', code: '', language: 'plain' };
    case 'quote_carousel':
    default:
      return { id, type: 'quote_carousel', quotes: [blankCarouselQuote(), blankCarouselQuote()] };
  }
}

// "Numbered divider" and "Spacer" in the Add-a-block menu add a divider block too. The Studio makes the new block
// with blankBlock(type) while handling the click, so the menu says which look to use just before it does.
let pendingDivider: DividerStyle | null = null;

/** Runs `add` (which adds one divider block) so that the new divider gets this look. */
export function withDividerStyle(style: DividerStyle, add: () => void) {
  pendingDivider = style;
  try {
    add();
  } finally {
    window.setTimeout(() => {
      pendingDivider = null;
    }, 0);
  }
}

/** The look of a new divider: what the menu asked for (nothing = a plain line, as today). */
export function blankDividerExtras(): { style?: DividerStyle } {
  const style = pendingDivider;

  pendingDivider = null;
  return style && style !== 'line' ? { style } : {};
}

/** New ids inside a copied block (the block's own id is already new). */
export function cloneBlocks4(b: Blocks4Block): Blocks4Block {
  if (b.type !== 'quote_carousel') return b;
  return { ...b, quotes: b.quotes.map((q) => ({ ...q, id: makeId('qt') })) };
}

/** Rough time to read one of these blocks, or an image with its layout text, in seconds (course length estimate). */
export function blocks4Seconds(b: Blocks4Block | ImageBlock): number {
  switch (b.type) {
    case 'columns':
      return words(plainText(`${b.left} ${b.right}`)) * 0.3;
    case 'code':
      return 15 + Math.min(200, b.code.split('\n').length) * 1.5;
    case 'quote_carousel':
      return b.quotes.reduce((n, q) => n + 3 + words(plainText(q.text)) * 0.3, 0);
    case 'image':
      return 10 + (layoutHasText(imageLayout(b)) ? words(plainText(b.text || '')) * 0.3 : 0);
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Publish checks
// ---------------------------------------------------------------------------

const LINK_RULE = 'must start with https:// (or be a Care Hub link starting with /).';

/**
 * Problems with a two-column, code, quote carousel, quote or image block (other blocks are ignored).
 * `at` names the block the way the server does: block 2 of Lesson 1 ("Welcome").
 */
export function blocks4Problems(block: Block, at: string, out: string[], urlOk: (url: string) => boolean) {
  switch (block.type) {
    case 'columns':
      if (!block.left.trim() && !block.right.trim()) out.push(`The two-column text in ${at} is empty.`);
      break;
    case 'code':
      if (!block.code.trim()) out.push(`The code snippet in ${at} is empty.`);
      break;
    case 'quote_carousel': {
      const s = `The quote carousel in ${at}`;

      if (block.quotes.length < 2) out.push(`${s} needs at least 2 quotes.`);
      if (block.quotes.some((q) => !q.text.trim())) out.push(`${s} has an empty quote.`);
      if (block.quotes.some((q) => q.image_url.trim() && !urlOk(q.image_url))) out.push(`The quote picture link in ${at} ${LINK_RULE}`);
      break;
    }

    case 'quote': {
      const url = block.image_url || '';

      if (url.trim() && !urlOk(url)) out.push(`The quote picture link in ${at} ${LINK_RULE}`);
      break;
    }

    case 'image': {
      const layout = imageLayout(block);
      const text = block.text || '';

      if (layoutHasText(layout) && !text.trim()) out.push(`Add text to the picture in ${at}, or pick another layout.`);
      else if (layout === 'text_on' && chars(text) > L.overlayText) {
        out.push(`Shorten the text on the picture in ${at} to 300 characters or fewer.`);
      }

      break;
    }

    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Search text (for the course search)
// ---------------------------------------------------------------------------

/**
 * The words people can read in these blocks that the course search doesn't already know: two-column text, code and
 * its caption, carousel quotes, a quote photo's description and an image's layout text ("" for other blocks).
 */
export function blocks4SearchText(block: Block): string {
  let parts: string[];

  switch (block.type) {
    case 'columns':
      parts = [block.left, block.right].map(plainText);
      break;
    case 'code':
      // Code is searched as written (no markdown in it: "SELECT *" keeps its star).
      parts = [plainText(block.caption), block.code];
      break;
    case 'quote_carousel':
      parts = block.quotes.flatMap((q) => [q.text, q.cite, q.image_url.trim() ? q.image_alt : '']).map(plainText);
      break;
    case 'quote':
      parts = (block.image_url || '').trim() ? [block.image_alt || ''] : [];
      break;
    case 'image':
      parts = layoutHasText(imageLayout(block)) ? [plainText(block.text || '')] : [];
      break;
    default:
      return '';
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

const withSearch = new Map<(b: Block) => string, (b: Block) => string>();

/**
 * `other` plus blocks4SearchText, for the course search's extraText. The same function comes back for the same
 * `other`, so the search index isn't rebuilt on every render.
 */
export function withBlocks4Search(other: (b: Block) => string): (b: Block) => string {
  let both = withSearch.get(other);

  if (!both) {
    both = (b: Block) => [other(b), blocks4SearchText(b)].filter((t) => t.trim()).join(' ');
    withSearch.set(other, both);
  }

  return both;
}

// ---------------------------------------------------------------------------
// Styles (added to the page once; light and dark)
// ---------------------------------------------------------------------------

// Text over a photo is white on a black layer at 60% (plus a soft shadow): even on a white photo that's 5.7:1,
// so it stays readable in light and dark mode whatever the picture.
const BLOCKS4_CSS = `
.chb4-focus:focus-visible{outline:2px solid #2563eb;outline-offset:2px}
:root[data-dark-mode='true'] .chb4-focus:focus-visible{outline-color:#60a5fa}
.chb4-cq{container-type:inline-size}
.chb4-cols{display:grid;grid-template-columns:minmax(0,1fr);gap:16px}
@container (min-width:600px){.chb4-cols-2{grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:32px}}
.chb4-side{display:grid;grid-template-columns:minmax(0,1fr);gap:14px}
@container (min-width:480px){.chb4-side-2{grid-template-columns:minmax(0,2fr) minmax(0,3fr);column-gap:24px;align-items:start}.chb4-side-2.chb4-side-r{grid-template-columns:minmax(0,3fr) minmax(0,2fr)}.chb4-side-r .chb4-side-pic{order:2}}
div:has(> [id^="chl-b-"]),div:has(> [id^="chr-b-"]){counter-reset:chb4-num}
.chb4-num{display:flex;align-items:center;gap:12px;padding:2px 0;counter-increment:chb4-num}
.chb4-num-badge{display:inline-flex;flex-shrink:0;align-items:center;justify-content:center;min-width:30px;height:30px;padding:0 7px;border:2px solid #2563eb;border-radius:999px;color:#1d4ed8;font-size:13px;font-weight:700;line-height:1;font-variant-numeric:tabular-nums}
.chb4-num-badge::before{content:counter(chb4-num)}
:root[data-dark-mode='true'] .chb4-num-badge{border-color:#60a5fa;color:#93c5fd}
.chb4-code{overflow:hidden;border:1px solid rgba(127,127,127,.3);border-radius:10px;background:#f6f8fa;color:#1f2328}
:root[data-dark-mode='true'] .chb4-code{border-color:rgba(255,255,255,.16);background:#0d1117;color:#e6edf3}
.chb4-code-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 6px 4px 12px;border-bottom:1px solid rgba(127,127,127,.25);font-size:12px;line-height:20px}
.chb4-code-lang{color:#57606a;font-weight:600}
:root[data-dark-mode='true'] .chb4-code-lang{color:#9da7b3}
.chb4-code-copy{display:inline-flex;align-items:center;gap:4px;border:1px solid rgba(127,127,127,.45);border-radius:6px;padding:1px 8px;background:transparent;color:inherit;font:inherit;cursor:pointer}
.chb4-code-copy:hover{background:rgba(127,127,127,.12)}
.chb4-code-copy:focus-visible,.chb4-code-scroll:focus-visible{outline:2px solid #2563eb;outline-offset:-2px}
:root[data-dark-mode='true'] .chb4-code-copy:focus-visible,:root[data-dark-mode='true'] .chb4-code-scroll:focus-visible{outline-color:#60a5fa}
.chb4-code-scroll{overflow-x:auto}
.chb4-mono,.chb4-code pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace;font-size:13px;line-height:1.55;tab-size:4}
.chb4-code pre{margin:0;padding:12px 14px;white-space:pre;overflow-wrap:normal;background:transparent;color:inherit}
.chb4-dark{position:relative;overflow:hidden;border-radius:12px;background:#1f2937;color:#fff}
.chb4-fill{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.chb4-shade{position:absolute;inset:0;background:rgba(0,0,0,.6)}
.chb4-over{position:relative;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.5)}
.chb4-over a,.chb4-over a:hover{color:#fff;text-decoration:underline}
.chb4-over a:focus-visible{outline:2px solid #fff;outline-offset:2px}
.chb4-qpic{display:flex;align-items:center;min-height:240px;margin:0}
.chb4-qpic .chb4-over{width:100%;padding:32px 28px}
.chb4-on{display:flex;align-items:center;justify-content:center;min-height:240px}
.chb4-on .chb4-over{width:100%;max-width:40rem;padding:28px 24px;text-align:center;font-size:19px;font-weight:600;line-height:1.45}
.chb4-retry{position:absolute;top:8px;right:8px;z-index:1;border:1px solid rgba(255,255,255,.7);border-radius:6px;padding:2px 8px;background:rgba(0,0,0,.45);color:#fff;font-size:12px;line-height:18px;cursor:pointer}
.chb4-retry:focus-visible{outline:2px solid #fff;outline-offset:2px}
.chb4-note{position:absolute;left:10px;bottom:8px;color:#fff;font-size:12px}
.chb4-banner{display:block;width:100%;height:200px;object-fit:cover;border-radius:10px}
.chb4-qc{border:1px solid rgba(127,127,127,.3);border-radius:12px;padding:18px 18px 12px}
.chb4-qc-stage{display:grid;touch-action:pan-y}
.chb4-qc-stage>*{grid-area:1/1;min-width:0}
.chb4-qc-ghost{visibility:hidden}
.chb4-face{display:block;width:56px;height:56px;flex-shrink:0;border-radius:999px;object-fit:cover;background:rgba(127,127,127,.15)}
.chb4-qmark{display:block;height:22px;color:#2563eb;font-family:Georgia,'Times New Roman',serif;font-size:44px;line-height:44px}
:root[data-dark-mode='true'] .chb4-qmark{color:#60a5fa}
.chb4-lay{display:flex;flex-direction:column;align-items:center;gap:6px;padding:8px 6px;border:2px solid transparent;border-radius:10px;text-align:center;cursor:pointer;box-shadow:inset 0 0 0 1px rgba(127,127,127,.35)}
.chb4-lay:hover{background:rgba(127,127,127,.08)}
.chb4-lay-on{border-color:#2563eb;box-shadow:none}
:root[data-dark-mode='true'] .chb4-lay-on{border-color:#60a5fa}
.chb4-lay:has(input:focus-visible){outline:2px solid #2563eb;outline-offset:2px}
:root[data-dark-mode='true'] .chb4-lay:has(input:focus-visible){outline-color:#60a5fa}
.chb4-mini{position:relative;display:block;width:72px;height:46px;overflow:hidden;border-radius:6px;background:rgba(127,127,127,.12)}
.chb4-mini>span{position:absolute;display:block;border-radius:2px}
.chb4-mini-p{background:linear-gradient(135deg,#93c5fd,#2563eb)}
.chb4-mini-d{background:linear-gradient(135deg,#64748b,#1e293b)}
.chb4-mini-t{height:3px;background:rgba(127,127,127,.65)}
.chb4-mini-w{height:3px;background:#fff}
`;

function useBlocks4Style() {
  useLayoutEffect(() => {
    if (typeof document === 'undefined' || document.head.querySelector('style[data-carehub-blocks4]')) return;
    const el = document.createElement('style');

    el.setAttribute('data-carehub-blocks4', '');
    el.textContent = BLOCKS4_CSS;
    document.head.appendChild(el);
  }, []);
}

// ---------------------------------------------------------------------------
// Learner views (the player, Studio Preview and the draft review page all use them through BlockView)
// ---------------------------------------------------------------------------

/** What the learner views need from CareHubLearningBlocks (passed in, so this file has no runtime import of it). */
export interface Blocks4Kit {
  Text: ComponentType<{ text: string; className?: string }>;
  useSrc: (link: string) => FileLoad;
  urlOk: (url: string) => boolean;
}

/** What Blocks4View draws: the three new blocks, every divider and quote, and images with a layout other than "plain". */
export type Blocks4Viewable = Blocks4Block | DividerBlock | QuoteBlock | ImageBlock;

type ViewProps<B> = { block: B; ctx: BlockCtx; kit: Blocks4Kit };

export function Blocks4View({ block, ctx, kit }: ViewProps<Blocks4Viewable>) {
  useBlocks4Style();
  switch (block.type) {
    case 'columns':
      return <ColumnsView block={block} ctx={ctx} kit={kit} />;
    case 'code':
      return <CodeView block={block} ctx={ctx} kit={kit} />;
    case 'quote_carousel':
      return <QuoteCarouselView block={block} ctx={ctx} kit={kit} />;
    case 'divider':
      return <DividerView block={block} />;
    case 'quote':
      return <QuoteView block={block} kit={kit} />;
    case 'image':
      return <ImageLayoutView block={block} ctx={ctx} kit={kit} />;
    default:
      return null;
  }
}

function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div className='rounded-[10px] border border-dashed border-border-primary px-4 py-6 text-center text-sm text-text-tertiary'>
      {children}
    </div>
  );
}

const NO_PICTURE_YET = 'Upload a picture or paste a picture link to show it here.';

/** A picture with loading and "try again" states (`box` sizes the stand-ins). */
function Picture({ url, alt, kit, box, img }: { url: string; alt: string; kit: Blocks4Kit; box?: string; img?: string }) {
  const file = kit.useSrc(url);

  if (file.state === 'loading') {
    return (
      <div className={cn('flex items-center justify-center rounded-[10px] bg-fill-content-hover p-4 text-sm text-text-tertiary', box)}>
        Loading the picture…{file.percent > 0 ? ` ${file.percent}%` : ''}
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

/** A photo behind text: drawn once it has loaded (the dark box keeps the text readable until then). */
function Backdrop({ url, alt, kit }: { url: string; alt: string; kit: Blocks4Kit }) {
  const file = kit.useSrc(url);

  return (
    <>
      {file.state === 'ready' && file.src && <img src={file.src} alt={alt} loading='lazy' className='chb4-fill' onError={file.fail} />}
      <div className='chb4-shade' aria-hidden='true' />
      {file.state === 'loading' && (
        <span className='chb4-note' aria-hidden='true'>
          Loading the picture…
        </span>
      )}
      {file.state === 'failed' && (
        <button type='button' className='chb4-retry' onClick={file.retry}>
          Load the picture again
        </button>
      )}
    </>
  );
}

// ---- Dividers ---------------------------------------------------------------

const SPACER_PX: Record<SpacerSize, number> = { small: 16, medium: 32, large: 64 };

function DividerView({ block }: { block: DividerBlock }) {
  const style = dividerStyle(block);

  if (style === 'spacer') {
    return <div aria-hidden='true' style={{ height: SPACER_PX[spacerSize(block)] }} data-testid='carehub-learning-spacer' />;
  }

  if (style === 'numbered') {
    // The number counts the numbered dividers above it in the lesson (CSS counter, reset per lesson in BLOCKS4_CSS).
    return (
      <div role='separator' className='chb4-num' data-testid='carehub-learning-numbered-divider'>
        <span className='h-0 min-w-0 flex-1 border-t border-border-primary' />
        <span className='chb4-num-badge' aria-hidden='true' />
        <span className='h-0 min-w-0 flex-1 border-t border-border-primary' />
      </div>
    );
  }

  return <hr className='my-1 border-t border-border-primary' />;
}

// ---- Two columns ------------------------------------------------------------

function ColumnsView({ block, ctx, kit }: ViewProps<ColumnsBlock>) {
  const { Text } = kit;
  const sides = [block.left, block.right].filter((t) => t.trim());

  if (!sides.length) return ctx.preview ? <Placeholder>Write in either column to show the text here.</Placeholder> : null;
  return (
    <div className='chb4-cq'>
      <div className={cn('chb4-cols', sides.length === 2 && 'chb4-cols-2')} data-testid='carehub-learning-columns'>
        {sides.map((t, i) => (
          <div key={i} className='min-w-0 text-[15px] leading-relaxed'>
            <Text text={t} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Code snippet -----------------------------------------------------------

function languageName(language: CodeLanguage) {
  return CODE_LANGUAGES.find((l) => l.value === language)?.label || 'Plain text';
}

/** Copies with the older browser command when the clipboard can't be used (e.g. not https). */
function copyByHand(text: string) {
  const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const box = document.createElement('textarea');

  box.value = text;
  box.setAttribute('readonly', '');
  box.style.position = 'fixed';
  box.style.top = '0';
  box.style.left = '-9999px';
  document.body.appendChild(box);
  box.select();
  let ok = false;

  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }

  box.remove();
  back?.focus({ preventScroll: true });
  return ok;
}

function selectAll(el: HTMLElement) {
  const range = document.createRange();
  const sel = window.getSelection();

  range.selectNodeContents(el);
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function CodeView({ block, ctx }: ViewProps<CodeBlock>) {
  const [copied, setCopied] = useState<'' | 'done' | 'failed'>('');
  const pre = useRef<HTMLPreElement>(null);
  const timer = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  if (!block.code.trim()) return ctx.preview ? <Placeholder>Write or paste some code to show it here.</Placeholder> : null;
  const name = languageName(block.language);

  const copy = async () => {
    window.clearTimeout(timer.current);
    let ok = false;

    try {
      await navigator.clipboard.writeText(block.code);
      ok = true;
    } catch {
      ok = copyByHand(block.code);
    }

    if (!ok && pre.current) selectAll(pre.current);
    setCopied(ok ? 'done' : 'failed');
    timer.current = window.setTimeout(() => setCopied(''), ok ? 2000 : 8000);
  };

  return (
    <figure className='m-0' data-testid='carehub-learning-code'>
      <div className='chb4-code'>
        <div className='chb4-code-bar'>
          <span className='chb4-code-lang'>{name}</span>
          <button type='button' className='chb4-code-copy' onClick={copy} data-testid='carehub-learning-code-copy'>
            {copied === 'done' ? (
              <>
                <span aria-hidden='true'>✓</span> Copied
              </>
            ) : (
              'Copy'
            )}
          </button>
        </div>
        <div className='chb4-code-scroll' role='region' aria-label={`Code (${block.language === 'plain' ? 'plain text' : name})`} tabIndex={0}>
          <pre ref={pre}>
            <code>{block.code}</code>
          </pre>
        </div>
      </div>
      <p role='status' className={copied === 'failed' ? 'mt-1 text-xs text-text-secondary' : 'sr-only'}>
        {copied === 'done' ? 'Copied.' : copied === 'failed' ? 'We couldn’t copy it. The code is selected, so you can copy it yourself.' : ''}
      </p>
      {block.caption.trim() && <figcaption className='mt-1.5 text-xs text-text-tertiary'>{block.caption}</figcaption>}
    </figure>
  );
}

// ---- Quotes -----------------------------------------------------------------

function QuoteView({ block, kit }: { block: QuoteBlock; kit: Blocks4Kit }) {
  const { Text } = kit;
  const url = (block.image_url || '').trim();

  if (!block.text.trim()) return null;
  if (!url || !kit.urlOk(url)) {
    return (
      <blockquote className='m-0 border-l-4 border-border-primary pl-4'>
        <div className='text-lg italic leading-relaxed'>
          <Text text={block.text} />
        </div>
        {block.cite.trim() && <div className='mt-1 text-sm text-text-tertiary'>— {block.cite}</div>}
      </blockquote>
    );
  }

  return (
    <figure className='chb4-dark chb4-qpic' data-testid='carehub-learning-quote-picture'>
      <Backdrop url={url} alt={block.image_alt || ''} kit={kit} />
      <blockquote className='chb4-over m-0'>
        <div className='text-xl italic leading-relaxed'>
          <Text text={block.text} />
        </div>
        {block.cite.trim() && <div className='mt-2 text-sm font-medium'>— {block.cite}</div>}
      </blockquote>
    </figure>
  );
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

function QuoteCarouselView({ block, ctx, kit }: ViewProps<QuoteCarouselBlock>) {
  const quotes = block.quotes.filter((q) => q.text.trim());

  if (!quotes.length) return ctx.preview ? <Placeholder>Write at least two quotes to show the carousel here.</Placeholder> : null;
  return <QuoteCarousel quotes={quotes} kit={kit} />;
}

function Face({ url, alt, kit }: { url: string; alt: string; kit: Blocks4Kit }) {
  const file = kit.useSrc(url);

  if (file.state !== 'ready' || !file.src) return <span className='chb4-face' aria-hidden='true' />;
  return <img src={file.src} alt={alt} loading='lazy' className='chb4-face' onError={file.fail} />;
}

function QuoteSlide({ quote, kit, ghost }: { quote: CarouselQuote; kit: Blocks4Kit; ghost?: boolean }) {
  const { Text } = kit;
  const photo = Boolean(quote.image_url.trim()) && kit.urlOk(quote.image_url);

  return (
    <figure className='m-0 flex flex-col items-center gap-3 text-center'>
      {photo ? (
        ghost ? (
          <span className='chb4-face' />
        ) : (
          <Face url={quote.image_url} alt={quote.image_alt} kit={kit} />
        )
      ) : (
        <span className='chb4-qmark' aria-hidden='true'>
          “
        </span>
      )}
      <blockquote className='m-0 max-w-[40rem] text-lg italic leading-relaxed'>
        <Text text={quote.text} />
      </blockquote>
      {quote.cite.trim() && <figcaption className='text-sm text-text-secondary'>— {quote.cite}</figcaption>}
    </figure>
  );
}

function QuoteCarousel({ quotes, kit }: { quotes: CarouselQuote[]; kit: Blocks4Kit }) {
  const [index, setIndex] = useState(0);
  const count = quotes.length;
  const at = Math.min(index, count - 1);
  const quote = quotes[at];
  const go = (d: number) => setIndex((i) => Math.max(0, Math.min(count - 1, Math.min(i, count - 1) + d)));
  const swipe = useSwipe(go);

  return (
    <div
      role='region'
      aria-roledescription='carousel'
      aria-label='Quotes'
      tabIndex={0}
      className='chb4-focus chb4-qc'
      data-testid='carehub-learning-quote-carousel'
      onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
        if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.altKey && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          go(e.key === 'ArrowLeft' ? -1 : 1);
        }
      }}
    >
      <div className='chb4-qc-stage' {...swipe}>
        {/* Every quote, invisible in the same spot, so the box is as tall as the longest one and doesn't jump. */}
        {count > 1 &&
          quotes.map((q) => (
            <div key={q.id} className='chb4-qc-ghost' aria-hidden='true'>
              <QuoteSlide quote={q} kit={kit} ghost />
            </div>
          ))}
        <div aria-live='polite'>
          <div key={quote.id}>
            {count > 1 && <span className='sr-only'>{`Quote ${at + 1} of ${count}: `}</span>}
            <QuoteSlide quote={quote} kit={kit} />
          </div>
        </div>
      </div>
      {count > 1 && (
        <div className='mt-3 flex items-center justify-between gap-2'>
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
          <span className='text-xs text-text-secondary'>
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
      )}
    </div>
  );
}

// ---- Image layouts ----------------------------------------------------------

function ImageLayoutView({ block, ctx, kit }: ViewProps<ImageBlock>) {
  const { Text } = kit;
  const layout = imageLayout(block);
  const ok = kit.urlOk(block.url);
  const text = layoutHasText(layout) ? block.text || '' : '';
  const caption = block.caption.trim() ? (
    <figcaption className='mt-1.5 text-center text-xs text-text-tertiary'>
      <Text text={block.caption} />
    </figcaption>
  ) : null;

  if (!ok && !ctx.preview) return null;
  if (layout === 'side') {
    // Without text the picture takes the whole width (the Studio preview says where the text goes).
    const words = text.trim() ? <Text text={text} /> : ctx.preview ? <span className='text-text-tertiary'>Add text to show beside the picture.</span> : null;

    return (
      <div className='chb4-cq'>
        <div
          className={cn('chb4-side', words ? 'chb4-side-2' : '', imageSide(block) === 'right' && 'chb4-side-r')}
          data-testid='carehub-learning-image-side'
        >
          <figure className='chb4-side-pic m-0 min-w-0'>
            {ok ? (
              <Picture url={block.url} alt={block.alt} kit={kit} box='min-h-[140px] w-full' img='block w-full rounded-[10px]' />
            ) : (
              <Placeholder>{NO_PICTURE_YET}</Placeholder>
            )}
            {caption}
          </figure>
          {words && <div className='min-w-0 text-[15px] leading-relaxed'>{words}</div>}
        </div>
      </div>
    );
  }

  if (layout === 'text_on') {
    return (
      <figure className='m-0' data-testid='carehub-learning-image-text-on'>
        <div className='chb4-dark chb4-on'>
          {ok ? <Backdrop url={block.url} alt={block.alt} kit={kit} /> : <div className='chb4-shade' aria-hidden='true' />}
          <div className='chb4-over'>{text.trim() ? <Text text={text} /> : ctx.preview ? 'Add text to show on the picture.' : null}</div>
        </div>
        {caption}
      </figure>
    );
  }

  return (
    <figure className='m-0 w-full' data-testid='carehub-learning-image-banner'>
      {ok ? (
        <Picture url={block.url} alt={block.alt} kit={kit} box='h-[200px] w-full' img='chb4-banner' />
      ) : (
        <Placeholder>{NO_PICTURE_YET}</Placeholder>
      )}
      {caption}
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Studio: block menu entries and small fields
// ---------------------------------------------------------------------------

export const BLOCKS4_INFO: Record<Blocks4Type, { emoji: string; label: string; hint: string }> = {
  columns: { emoji: '📰', label: 'Two columns', hint: 'Two blocks of text side by side (stacked on phones)' },
  code: { emoji: '💻', label: 'Code snippet', hint: 'Code or text in a fixed-width font, with a Copy button' },
  quote_carousel: { emoji: '🗨️', label: 'Quote carousel', hint: 'Several quotes, shown one at a time' },
};

/** An extra entry in the Add-a-block menu that adds an existing kind of block with a different look. */
export interface MenuExtra {
  key: string;
  emoji: string;
  label: string;
  hint: string;
  pick: () => void;
}

const DIVIDER_INFO: Record<'numbered' | 'spacer', { emoji: string; label: string; hint: string }> = {
  numbered: { emoji: '🔢', label: 'Numbered divider', hint: 'A line with a number in a circle: 1, 2, 3 …' },
  spacer: { emoji: '↕️', label: 'Spacer', hint: 'Empty space between blocks' },
};

/** The entries to show right after `type` in the Add-a-block menu: "Numbered divider" and "Spacer" after Divider. */
export function blocks4MenuExtras(type: string, add: () => void): MenuExtra[] {
  if (type !== 'divider') return [];
  return (['numbered', 'spacer'] as const).map((style) => ({
    key: `divider-${style}`,
    ...DIVIDER_INFO[style],
    pick: () => withDividerStyle(style, add),
  }));
}

/** The Studio block card's name for a numbered divider or a spacer (null for every other block). */
export function blocks4CardInfo(b: Block): { emoji: string; label: string; hint: string } | null {
  if (b.type !== 'divider') return null;
  const style = dividerStyle(b);

  return style === 'line' ? null : DIVIDER_INFO[style];
}

type BlockNames = Record<string, { emoji: string; label: string }>;

/** What the editors need from CareHubLearningStudioBlocks (passed in, so this file has no runtime import of it). */
export interface Blocks4StudioKit {
  /** The Studio's picture field (upload or link). onUpload runs instead of onChange when an upload finishes. */
  picture: (o: { label: string; value: string; onChange: (url: string) => void; onUpload?: (url: string) => void }) => ReactNode;
  /** Block names, for "Link to a lesson or block". */
  info: BlockNames;
}

const FORMAT_TIP = 'Tip: **bold**, *italic*, [link text](https://…)';

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
  maxLength = 500,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  id?: string;
}) {
  return (
    <input
      id={id}
      type='text'
      value={value}
      placeholder={placeholder}
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
  rows = 2,
  maxLength = 20000,
  info,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
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
        maxLength={maxLength}
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

/** Up / down / remove for one item of a list (focus stays on the item after a move, and moves on after a remove). */
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

// ---------------------------------------------------------------------------
// Studio: editors
// ---------------------------------------------------------------------------

/** What Blocks4Editor edits: the three new blocks, dividers and quotes (images keep their editor; see ImageLayoutFields). */
export type Blocks4Editable = Blocks4Block | DividerBlock | QuoteBlock;

type EditorProps<B> = { block: B; onChange: (b: Block) => void; kit: Blocks4StudioKit };

export function Blocks4Editor({ block, onChange, kit }: EditorProps<Blocks4Editable>) {
  useBlocks4Style();
  switch (block.type) {
    case 'columns':
      return <ColumnsEditor block={block} onChange={onChange} kit={kit} />;
    case 'code':
      return <CodeEditor block={block} onChange={onChange} kit={kit} />;
    case 'quote_carousel':
      return <QuoteCarouselEditor block={block} onChange={onChange} kit={kit} />;
    case 'divider':
      return <DividerEditor block={block} onChange={onChange} kit={kit} />;
    case 'quote':
      return <QuoteEditor block={block} onChange={onChange} kit={kit} />;
    default:
      return null;
  }
}

function ColumnsEditor({ block, onChange, kit }: EditorProps<ColumnsBlock>) {
  return (
    <div className='flex flex-col gap-2'>
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
        <Field label='Left column'>
          <Area
            value={block.left}
            rows={5}
            maxLength={L.columnText}
            onChange={(v) => onChange({ ...block, left: v })}
            placeholder='Write something…'
            info={kit.info}
          />
        </Field>
        <Field label='Right column'>
          <Area
            value={block.right}
            rows={5}
            maxLength={L.columnText}
            onChange={(v) => onChange({ ...block, right: v })}
            placeholder='Write something…'
            info={kit.info}
          />
        </Field>
      </div>
      <p className='m-0 text-xs text-text-tertiary'>Side by side on wider screens. On phones the left column comes first. {FORMAT_TIP}</p>
    </div>
  );
}

function CodeEditor({ block, onChange }: EditorProps<CodeBlock>) {
  return (
    <div className='flex flex-col gap-3'>
      <Field label='Language' className='self-start'>
        <ChSelect value={block.language} options={CODE_LANGUAGES} onChange={(v) => onChange({ ...block, language: v })} ariaLabel='Language' />
      </Field>
      <Field label='Code' hint='Spaces and line breaks are kept as you type them. People get a Copy button.'>
        <textarea
          value={block.code}
          rows={8}
          maxLength={L.code}
          spellCheck={false}
          autoCapitalize='off'
          autoCorrect='off'
          wrap='off'
          placeholder='e.g. SELECT name, email FROM customers;'
          className={cn(chInputClass, 'chb4-mono w-full min-w-0 resize-y')}
          onChange={(e) => onChange({ ...block, code: e.target.value })}
        />
      </Field>
      <Field label='Caption (optional)'>
        <Line
          value={block.caption}
          maxLength={L.codeCaption}
          onChange={(v) => onChange({ ...block, caption: v })}
          placeholder='e.g. The text to paste into a reply'
        />
      </Field>
    </div>
  );
}

const DIVIDER_LOOKS: { value: DividerStyle; label: string }[] = [
  { value: 'line', label: 'Line' },
  { value: 'numbered', label: 'Numbered line' },
  { value: 'spacer', label: 'Empty space' },
];

const SPACE_OPTIONS: { value: SpacerSize; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

const DIVIDER_HINTS: Record<DividerStyle, string> = {
  line: 'A line between sections. Nothing to fill in.',
  numbered:
    'A line with a number in a circle. The numbers count up by themselves: the first numbered divider in a lesson shows 1, the next 2, and so on.',
  spacer: 'Empty space between blocks. Screen readers skip it.',
};

function DividerEditor({ block, onChange }: EditorProps<DividerBlock>) {
  const style = dividerStyle(block);
  const size = spacerSize(block);

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-wrap items-end gap-3'>
        <Field label='Style'>
          <ChSelect value={style} options={DIVIDER_LOOKS} onChange={(v) => onChange(lean({ ...block, style: v }))} ariaLabel='Divider style' />
        </Field>
        {style === 'spacer' && (
          <Field label='Space'>
            <ChSelect value={size} options={SPACE_OPTIONS} onChange={(v) => onChange(lean({ ...block, size: v }))} ariaLabel='Space size' />
          </Field>
        )}
      </div>
      <p className='m-0 text-xs text-text-tertiary'>{DIVIDER_HINTS[style]}</p>
    </div>
  );
}

function QuoteEditor({ block, onChange, kit }: EditorProps<QuoteBlock>) {
  const url = block.image_url || '';

  return (
    <div className='flex flex-col gap-3'>
      <Field label='Quote'>
        <Area value={block.text} rows={2} onChange={(v) => onChange({ ...block, text: v })} placeholder='What they said' info={kit.info} />
      </Field>
      <Field label='Who said it (optional)'>
        <Line value={block.cite} onChange={(v) => onChange({ ...block, cite: v })} placeholder='Name, role' />
      </Field>
      {kit.picture({
        label: 'Photo behind the quote (optional)',
        value: url,
        onChange: (image_url) => onChange(lean({ ...block, image_url })),
      })}
      {url.trim() ? (
        <Field
          label='Describe the photo (optional)'
          hint='Leave it empty if the photo is only there for decoration. The quote shows in white on the darkened photo.'
        >
          <Line value={block.image_alt || ''} onChange={(v) => onChange(lean({ ...block, image_alt: v }))} placeholder='e.g. Sam at the billing desk' />
        </Field>
      ) : null}
    </div>
  );
}

function QuoteCarouselEditor({ block, onChange, kit }: EditorProps<QuoteCarouselBlock>) {
  const { quotes } = block;
  const set = (i: number, patch: Partial<CarouselQuote>) =>
    onChange({ ...block, quotes: quotes.map((q, j) => (j === i ? { ...q, ...patch } : q)) });

  return (
    <div className='flex flex-col gap-2'>
      {quotes.map((q, i) => (
        <div key={q.id} className='flex flex-col gap-2 rounded-[10px] border border-border-primary p-2.5'>
          <div className='flex items-center gap-1'>
            <span className='flex-1 text-xs font-medium text-text-secondary'>Quote {i + 1}</span>
            <ItemTools
              name='quote'
              index={i}
              count={quotes.length}
              min={2}
              onMove={(to) => onChange({ ...block, quotes: move(quotes, i, to) })}
              onRemove={() => onChange({ ...block, quotes: quotes.filter((_, j) => j !== i) })}
            />
          </div>
          <Field label='Quote'>
            <Area value={q.text} maxLength={L.quoteText} onChange={(v) => set(i, { text: v })} placeholder='What they said' info={kit.info} />
          </Field>
          <Field label='Who said it (optional)'>
            <Line value={q.cite} maxLength={L.quoteCite} onChange={(v) => set(i, { cite: v })} placeholder='Name, role' />
          </Field>
          {kit.picture({ label: 'Photo (optional)', value: q.image_url, onChange: (url) => set(i, { image_url: url }) })}
          {q.image_url.trim() ? (
            <Field label='Describe the photo (optional)' hint='Leave it empty when the name already says who it is.'>
              <Line value={q.image_alt} onChange={(v) => set(i, { image_alt: v })} placeholder='e.g. Jordan Lee at the front counter' />
            </Field>
          ) : null}
        </div>
      ))}
      <AddBtn disabled={quotes.length >= L.quotes} onClick={() => onChange({ ...block, quotes: [...quotes, blankCarouselQuote()] })}>
        Add a quote
      </AddBtn>
      <p className='m-0 text-xs text-text-tertiary'>People see one quote at a time, with Previous and Next. Use 2 to 10 quotes.</p>
    </div>
  );
}

// ---- Image layouts (shown inside the image editor) ----------------------------------------------------------

const LAYOUT_OPTIONS: { value: ImageLayout; label: string }[] = [
  { value: 'plain', label: 'Just the picture' },
  { value: 'side', label: 'Picture beside text' },
  { value: 'text_on', label: 'Text on the picture' },
  { value: 'banner', label: 'Wide banner' },
];

const SIDE_OPTIONS: { value: ImageSide; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
];

/** [class, left, top, width, height] of each shape in a layout's small preview (72 × 46). */
const MINI: Record<ImageLayout, [string, number, number, number, number][]> = {
  plain: [
    ['chb4-mini-p', 14, 5, 44, 28],
    ['chb4-mini-t', 22, 37, 28, 3],
  ],
  side: [
    ['chb4-mini-p', 5, 8, 26, 30],
    ['chb4-mini-t', 36, 10, 31, 3],
    ['chb4-mini-t', 36, 17, 27, 3],
    ['chb4-mini-t', 36, 24, 31, 3],
    ['chb4-mini-t', 36, 31, 20, 3],
  ],
  text_on: [
    ['chb4-mini-d', 5, 5, 62, 36],
    ['chb4-mini-w', 17, 18, 38, 3],
    ['chb4-mini-w', 24, 25, 24, 3],
  ],
  banner: [
    ['chb4-mini-p', 5, 5, 62, 15],
    ['chb4-mini-t', 5, 25, 50, 3],
    ['chb4-mini-t', 5, 32, 40, 3],
  ],
};

function MiniLayout({ layout }: { layout: ImageLayout }) {
  return (
    <span className='chb4-mini' aria-hidden='true'>
      {MINI[layout].map(([cls, left, top, width, height], i) => (
        <span key={i} className={cls} style={{ left, top, width, height }} />
      ))}
    </span>
  );
}

/** Layout choice (with small previews), the side and the layout's text, for the Studio's image editor. */
export function ImageLayoutFields({ block, onChange, info }: { block: ImageBlock; onChange: (b: Block) => void; info: BlockNames }) {
  useBlocks4Style();
  const name = useId();
  const layout = imageLayout(block);
  const text = block.text || '';
  const count = chars(text);
  const set = (patch: Partial<ImageBlock>) => onChange(lean({ ...block, ...patch }));

  return (
    <div className='flex flex-col gap-3'>
      <fieldset className='m-0 min-w-0 border-0 p-0'>
        <legend className='mb-1 p-0 text-xs font-medium text-text-secondary'>Layout</legend>
        <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
          {LAYOUT_OPTIONS.map((o) => (
            <label key={o.value} className={cn('chb4-lay', layout === o.value && 'chb4-lay-on')} data-testid={`carehub-learning-image-layout-${o.value}`}>
              <input
                type='radio'
                className='sr-only'
                name={name}
                value={o.value}
                checked={layout === o.value}
                onChange={() => set({ layout: o.value })}
              />
              <MiniLayout layout={o.value} />
              <span className='text-xs leading-tight'>
                {layout === o.value && <span aria-hidden='true'>✓ </span>}
                {o.label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {layout === 'side' && (
        <Field label='Picture on the' className='self-start'>
          <ChSelect value={imageSide(block)} options={SIDE_OPTIONS} onChange={(v) => set({ side: v })} ariaLabel='Picture on the' />
        </Field>
      )}
      {layoutHasText(layout) && (
        <Field
          label={layout === 'side' ? 'Text beside the picture' : 'Text on the picture'}
          hint={
            layout === 'side' ? (
              `On phones the picture comes first, then the text. ${FORMAT_TIP}`
            ) : count > L.overlayText ? (
              <span className='chl-mark-wrong'>
                {count} of {L.overlayText} characters. Shorten it to publish.
              </span>
            ) : (
              `${count} of ${L.overlayText} characters. Shown in white on the darkened picture.`
            )
          }
        >
          <Area
            value={text}
            rows={layout === 'side' ? 4 : 2}
            maxLength={L.sideText}
            onChange={(v) => set({ text: v })}
            placeholder={layout === 'side' ? 'What to read next to the picture' : 'A few words to show on the picture'}
            info={info}
          />
        </Field>
      )}
    </div>
  );
}

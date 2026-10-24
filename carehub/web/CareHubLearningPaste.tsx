/**
 * Care Hub Learning — "Turn text into blocks".
 *
 * An author pastes a guide (Word, Google Docs, a web page, an email or plain text) and gets tidy lesson blocks with the
 * wording kept exactly. Everything happens in the browser, no AI and no server change: clipboard HTML is read in an inert
 * DOMParser document (never put into the page, never kept), plain text is read line by line, and only existing block kinds
 * are made — heading, paragraph, list, quote, divider, and blocks3's table once the normaliser knows it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import type { ClipboardEvent as ReactClipboardEvent } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { blankLesson, newId, normalizeBlock, plural, urlAllowed } from './CareHubLearningApi';
import { BlockView } from './CareHubLearningBlocks';
import { BLOCK_INFO, Toggle } from './CareHubLearningStudioBlocks';
import { CareHubModal, chInputClass, ChNote } from './CareHubUi';

import type { Block, Content, ListStyle } from './CareHubLearningApi';
import type { BlockCtx } from './CareHubLearningBlocks';

export const PASTE_MAX_CHARS = 100_000;
export const PASTE_MAX_BLOCKS = 300;
/** Clipboard HTML bigger than this (pictures inlined as data: URLs) is slimmed first, and read as plain text if still too big. */
const HTML_MAX = 5_000_000;
/** blocks3's table limits: 1–30 rows × 1–6 columns, cells ≤ 300 characters. */
const TABLE_ROWS = 30;
const TABLE_COLS = 6;
const TABLE_CELL = 300;

export type PasteItem =
  | { kind: 'heading'; text: string; level: 1 | 2 | 3 }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; style: ListStyle; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'divider' }
  | { kind: 'table'; header: boolean; rows: string[][]; caption: string };

export interface PasteRead {
  source: 'html' | 'text';
  items: PasteItem[];
  /** Pictures left out. */
  pictures: number;
  /** What the paste area shows: the reading written with the tiny markdown, so editing it keeps the structure. */
  text: string;
}

export interface PastePlan {
  /** Blocks for the open lesson. */
  intro: Block[];
  /** New lessons (only with "Start a new lesson at each main heading"). */
  lessons: { title: string; blocks: Block[] }[];
  count: number;
  /** More than PASTE_MAX_BLOCKS blocks: the rest is left out. */
  cut: boolean;
  /** The text has headings (its own or guessed). */
  headings: boolean;
}

export interface PasteAdded {
  lessonId: string;
  blockIds: string[];
  lessonIds: string[];
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Same as CareHubLearningBlocks: **bold**, *italic*, [label](url) — no nesting, no escapes. */
const INLINE_SOURCE = String.raw`\*\*([^*\n]+?)\*\*|\*([^*\n]+?)\*|\[([^\]\n]+)\]\(([^)\s]+)\)`;
const LINE_BREAK = /\r\n?|[\n\v\f\u0085\u2028\u2029]/;
const SPACE_RUN = /[\t \u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+/g;

/** Removes control characters and invisible marks (zero-width space, word joiner, BOM, soft hyphen); tabs stay. */
function dropInvisible(s: string) {
  let out = '';
  let from = 0;

  for (let k = 0; k < s.length; k++) {
    const c = s.charCodeAt(k);

    if ((c < 32 && c !== 9) || (c >= 127 && c < 160) || c === 0xad || c === 0x200b || c === 0x2060 || c === 0xfeff) {
      out += s.slice(from, k);
      from = k + 1;
    }
  }

  return from ? out + s.slice(from) : s;
}

/** One line of text: invisible marks out, every run of spaces (tabs, no-break spaces…) becomes one space. */
function tidy(s: string) {
  return dropInvisible(s).replace(SPACE_RUN, ' ');
}

/** The words a reader sees in tiny markdown (bold/italic markers and link targets left out). */
export function visibleText(md: string, depth = 0): string {
  return md.replace(new RegExp(INLINE_SOURCE, 'g'), (_m, b?: string, i?: string, label?: string) => {
    if (b !== undefined) return depth < 3 ? visibleText(b, depth + 1) : b;
    if (i !== undefined) return depth < 3 ? visibleText(i, depth + 1) : i;
    return label || '';
  });
}

function stripWholeBold(md: string) {
  const m = /^\*\*([^*\n]+)\*\*$/.exec(md);

  return m ? m[1] : md;
}

/** Characters the tiny markdown can't have in a link target are percent-encoded; null when the link isn't allowed. */
function linkTarget(raw: string | null) {
  const u = (raw || '').replace(/[\t\n\r]/g, '').trim();

  if (!u || u.startsWith('#')) return '';
  const enc = u.replace(/[\s()*[\]]/g, (ch) => {
    const c = ch.charCodeAt(0);

    return c < 128 ? `%${c.toString(16).toUpperCase().padStart(2, '0')}` : encodeURIComponent(ch);
  });

  return urlAllowed(enc) ? enc : '';
}

// ---------------------------------------------------------------------------
// Inline runs → tiny markdown
// ---------------------------------------------------------------------------

interface Fmt {
  b: boolean;
  i: boolean;
  href: string;
  pre: boolean;
}

interface Run {
  t: string;
  b: boolean;
  i: boolean;
  href: string;
}

const BR: Run = { t: '\n', b: false, i: false, href: '' };
const PLAIN: Fmt = { b: false, i: false, href: '', pre: false };

function same(a: Run, b: Run) {
  return a.b === b.b && a.i === b.i && a.href === b.href;
}

/** Splits runs into lines; per line: adjacent runs with the same formatting merged, spaces collapsed and trimmed. */
function runLines(runs: Run[]): Run[][] {
  const lines: Run[][] = [];
  let cur: Run[] = [];
  const end = () => {
    while (cur.length && !cur[0].t.trimStart()) cur.shift();
    while (cur.length && !cur[cur.length - 1].t.trimEnd()) cur.pop();
    if (cur.length) {
      cur[0] = { ...cur[0], t: cur[0].t.trimStart() };
      cur[cur.length - 1] = { ...cur[cur.length - 1], t: cur[cur.length - 1].t.trimEnd() };
    }
    lines.push(cur);
    cur = [];
  };

  for (const r of runs) {
    if (r.t === '\n') {
      end();
      continue;
    }
    let t = r.t;
    const prev = cur[cur.length - 1];

    if (prev && prev.t.endsWith(' ') && t.startsWith(' ')) t = t.slice(1);
    if (!t) continue;
    if (prev && (same(prev, r) || (!t.trim() && !r.href && !prev.href))) cur[cur.length - 1] = { ...prev, t: prev.t + t };
    else cur.push({ ...r, t });
  }
  end();
  return lines;
}

/** Moves outer spaces outside the markers; formatting is dropped when the text has an asterisk the markdown can't hold. */
function wrap(t: string, mark: string) {
  const core = t.trim();

  if (!mark || !core || core.includes('*')) return t;
  const at = t.indexOf(core);

  return `${t.slice(0, at)}${mark}${core}${mark}${t.slice(at + core.length)}`;
}

function lineMd(line: Run[], bold: boolean) {
  let out = '';

  for (let k = 0; k < line.length; ) {
    const href = line[k].href;
    let j = k;

    while (j < line.length && line[j].href === href) j++;
    const group = line.slice(k, j);

    k = j;
    if (href) {
      const label = group.map((r) => r.t).join('');
      const core = label.trim();

      if (core && !core.includes(']')) {
        const at = label.indexOf(core);
        const text = group.filter((r) => r.t.trim());
        const mark = core.includes('*') ? '' : bold && text.every((r) => r.b) ? '**' : text.every((r) => r.i || (bold && r.b)) ? '*' : '';

        out += `${label.slice(0, at)}${mark}[${core}](${href})${mark}${label.slice(at + core.length)}`;
        continue;
      }
    }
    for (const r of group) out += wrap(r.t, bold && r.b ? '**' : r.i ? '*' : '');
  }

  return out;
}

/** Runs → markdown lines ('' for an empty line). */
function mdLines(runs: Run[], bold = true) {
  return runLines(runs).map((l) => lineMd(l, bold));
}

/** Runs → one line (headings, list items, table cells): line breaks become spaces. */
function oneLine(runs: Run[], bold = true) {
  return mdLines(runs, bold)
    .filter(Boolean)
    .join(' ');
}

/** Runs → paragraphs: empty lines split them, single line breaks stay. */
function paragraphs(runs: Run[]) {
  const out: string[] = [];
  let cur: string[] = [];

  for (const l of [...mdLines(runs), '']) {
    if (l) cur.push(l);
    else if (cur.length) {
      out.push(cur.join('\n'));
      cur = [];
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Clipboard HTML (Word, Google Docs, web pages, emails)
// ---------------------------------------------------------------------------

const DROP = new Set(
  (
    'script style noscript template iframe frame frameset object embed applet nav svg math canvas video audio source track map ' +
    'area link meta title head base input select textarea option optgroup datalist output progress meter dialog xml'
  ).split(' ')
);
const DROP_ROLES = new Set(['navigation', 'search', 'toolbar', 'menubar', 'menu']);
/** Paragraph-like blocks. */
const PARA = new Set(
  'p section article header footer main aside address figure figcaption details summary dl dt dd fieldset legend hgroup li caption td th tr tbody thead tfoot form body'.split(
    ' '
  )
);
/** Line-like blocks: emails write one div per line and an empty one between paragraphs. */
const LINE = new Set(['div', 'center']);
const HEADING_TAG = /^h([1-6])$/;
const CHECK_CLASS = /(^|[\s_-])(task-?list|to-?do|check-?list|checkbox)/i;
const CHECK_MARK = /^(?:\[[ xX✓✔]\]|[☐☑☒])\s*/;

function styleOf(el: Element): Record<string, string> {
  const out: Record<string, string> = Object.create(null);

  for (const part of (el.getAttribute('style') || '').split(';')) {
    const k = part.indexOf(':');

    if (k > 0) out[part.slice(0, k).trim().toLowerCase()] = part.slice(k + 1).replace(/!important/i, '').trim().toLowerCase();
  }

  return out;
}

function isHidden(el: Element, st: Record<string, string>) {
  return (
    el.hasAttribute('hidden') ||
    el.getAttribute('aria-hidden') === 'true' ||
    st.display === 'none' ||
    st.visibility === 'hidden' ||
    st['mso-hide'] === 'all' ||
    st['mso-list'] === 'ignore' ||
    st['mso-element'] === 'comment-list' ||
    DROP_ROLES.has(el.getAttribute('role') || '')
  );
}

function tagOf(el: Element) {
  return el.localName.toLowerCase();
}

function kids(el: Element) {
  return Array.from(el.children).filter((c) => !isHidden(c, styleOf(c)));
}

class HtmlReader {
  items: PasteItem[] = [];
  pictures = 0;
  private runs: Run[] = [];
  /** > 0 while gathering one block's text (heading, list item, cell, quote): blocks inside become line breaks. */
  private collecting = 0;
  /** Lists met inside a list item, read after it (nested lists join their parent list). */
  private nested: Element[] | null = null;
  /** The Word list being read (Word writes list items as paragraphs with mso-list: lN levelN). */
  private wordList: { id: string; item: Extract<PasteItem, { kind: 'list' }> } | null = null;

  emit(item: PasteItem) {
    const last = this.items[this.items.length - 1];

    this.wordList = null;
    if (item.kind === 'list' && last?.kind === 'list' && last.style === item.style) {
      last.items.push(...item.items);
      return last;
    }
    this.items.push(item);
    return item;
  }

  flush() {
    if (this.collecting) return;
    const runs = this.runs;

    this.runs = [];
    for (const text of paragraphs(runs)) this.emit({ kind: 'paragraph', text });
  }

  private lineBreak() {
    const last = this.runs[this.runs.length - 1];

    if (last && last !== BR) this.runs.push(BR);
  }

  private collect(el: Element, f: Fmt, nested: Element[] | null = null) {
    const saved = this.runs;
    const savedNested = this.nested;

    this.runs = [];
    this.nested = nested;
    this.collecting++;
    this.children(el, f);
    this.collecting--;
    const out = this.runs;

    this.runs = saved;
    this.nested = savedNested;
    return out;
  }

  children(el: Element, f: Fmt) {
    for (const c of Array.from(el.childNodes)) this.walk(c, f);
  }

  private text(s: string, f: Fmt) {
    const src = f.pre ? s : s.replace(/[\t\n\r\f ]+/g, ' ');

    src.split(LINE_BREAK).forEach((part, k) => {
      if (k) this.runs.push(BR);
      const t = tidy(part);

      if (t) this.runs.push({ t, b: f.b, i: f.i, href: f.href });
    });
  }

  walk(node: Node, f: Fmt) {
    if (node.nodeType === 3) {
      this.text(node.nodeValue || '', f);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = tagOf(el);
    const st = styleOf(el);

    if (DROP.has(tag) || tag.startsWith('v:') || isHidden(el, st)) return;
    if (tag === 'button' && !el.hasAttribute('aria-expanded')) return;
    if (tag === 'form' && !el.querySelector('p,h1,h2,h3,h4,h5,h6,li,table,blockquote,pre')) return;
    if (tag === 'br') {
      this.runs.push(BR);
      return;
    }
    if (tag === 'img') {
      this.image(el, f);
      return;
    }

    const g = this.format(el, tag, st, f);

    if (this.collecting) {
      if ((tag === 'ul' || tag === 'ol') && this.nested) {
        this.nested.push(el);
        return;
      }
      const block = PARA.has(tag) || LINE.has(tag) || HEADING_TAG.test(tag) || /^(ul|ol|menu|blockquote|pre|table|hr)$/.test(tag);

      if (block) this.lineBreak();
      this.children(el, g);
      if (block) this.lineBreak();
      return;
    }

    const cls = el.getAttribute('class') || '';
    const level = this.headingLevel(el, tag, cls);

    if (level) {
      this.flush();
      const text = oneLine(this.collect(el, { ...g, b: false }), false);

      if (text) this.emit({ kind: 'heading', text, level });
      return;
    }
    if (tag === 'hr') {
      this.flush();
      this.emit({ kind: 'divider' });
      return;
    }
    if (tag === 'ul' || tag === 'ol' || tag === 'menu') {
      this.flush();
      this.list(el, tag, st, g);
      return;
    }
    if (tag === 'blockquote' || /\bMso(Intense)?Quote\b/.test(cls)) {
      this.flush();
      const text = mdLines(this.collect(el, g))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      if (text) this.emit({ kind: 'quote', text });
      return;
    }
    if (tag === 'table') {
      this.flush();
      this.table(el, g);
      return;
    }
    const word = /^(l\d+)\s+level\d+/.exec(st['mso-list'] || '');

    if (word && (tag === 'p' || tag === 'div' || tag === 'li')) {
      this.flush();
      this.wordItem(el, word[1], g);
      return;
    }
    if (PARA.has(tag) || tag === 'pre') {
      this.flush();
      this.children(el, g);
      this.flush();
      return;
    }
    if (LINE.has(tag)) {
      this.lineBreak();
      this.children(el, g);
      this.lineBreak();
      return;
    }
    this.children(el, g);
  }

  private format(el: Element, tag: string, st: Record<string, string>, f: Fmt): Fmt {
    let { b, i, href, pre } = f;
    const fw = st['font-weight'] || '';
    const fs = st['font-style'] || '';

    if (tag === 'b' || tag === 'strong') b = true;
    if (/^(bold|bolder|[6-9]00)$/.test(fw)) b = true;
    else if (/^(normal|lighter|[1-5]00)$/.test(fw)) b = false;
    if (/^(i|em|cite|dfn|var)$/.test(tag)) i = true;
    if (/^(italic|oblique)/.test(fs)) i = true;
    else if (fs === 'normal') i = false;
    if (tag === 'a') href = linkTarget(el.getAttribute('href'));
    if (tag === 'pre' || /^pre/.test(st['white-space'] || '')) pre = true;
    else if (st['white-space'] === 'normal' || st['white-space'] === 'nowrap') pre = false;
    return { b, i, href, pre };
  }

  private headingLevel(el: Element, tag: string, cls: string): 0 | 1 | 2 | 3 {
    const h = HEADING_TAG.exec(tag);

    if (h) return h[1] === '1' ? 1 : h[1] === '2' ? 2 : 3;
    if (el.getAttribute('role') === 'heading') {
      const n = parseInt(el.getAttribute('aria-level') || '2', 10);

      return n === 1 ? 1 : n >= 3 ? 3 : 2;
    }
    if (/\bMsoTitle\b/.test(cls)) return 1;
    if (/\bMsoSubtitle\b/.test(cls)) return 2;
    return 0;
  }

  private image(el: Element, f: Fmt) {
    const alt = (el.getAttribute('alt') || '').trim();
    const st = styleOf(el);

    // Emoji pictures (Gmail, Slack, social sites) are text.
    if (alt && alt.length <= 16 && (el.hasAttribute('data-emoji') || /emoji/i.test(el.getAttribute('class') || ''))) {
      this.text(alt, f);
      return;
    }
    const w = parseFloat(el.getAttribute('width') || st.width || '');
    const h = parseFloat(el.getAttribute('height') || st.height || '');

    if (w <= 2 || h <= 2) return; // tracking pixels and spacers
    this.pictures++;
  }

  private list(el: Element, tag: string, st: Record<string, string>, f: Fmt) {
    const first = kids(el).find((c) => tagOf(c) === 'li');
    const type = st['list-style-type'] || (first ? styleOf(first)['list-style-type'] : '') || '';
    let style: ListStyle = tag === 'ol' ? 'number' : 'bullet';

    if (/^(decimal|lower|upper|roman|alpha|armenian|georgian|cjk|hebrew|hiragana|katakana)/.test(type)) style = 'number';
    else if (/^(disc|circle|square)/.test(type)) style = 'bullet';
    const allCheck = CHECK_CLASS.test(el.getAttribute('class') || '');
    const items: { raw: string; text: string; check: boolean }[] = [];
    const visit = (listEl: Element) => {
      for (const c of kids(listEl)) {
        const ct = tagOf(c);

        if (ct === 'ul' || ct === 'ol' || ct === 'menu') {
          visit(c);
          continue;
        }
        if (DROP.has(ct)) continue;
        const nested: Element[] = [];
        let check =
          allCheck ||
          c.getAttribute('role') === 'checkbox' ||
          c.hasAttribute('aria-checked') ||
          CHECK_CLASS.test(c.getAttribute('class') || '') ||
          /^(checked|unchecked)$/i.test(c.getAttribute('class') || '') ||
          Array.from(c.querySelectorAll('input')).some((x) => (x.getAttribute('type') || '').toLowerCase() === 'checkbox' && x.closest('li') === c);
        const raw = oneLine(this.collect(c, f, nested));
        const text = raw.replace(CHECK_MARK, '');

        if (text !== raw) check = true;
        if (text) items.push({ raw, text, check });
        for (const n of nested) visit(n);
      }
    };

    visit(el);
    if (!items.length) return;
    const checks = items.filter((x) => x.check).length;
    // A checklist when most items have a checkbox; otherwise "[x]"-like marks stay part of the wording.
    const isCheck = checks > 0 && checks * 2 >= items.length;

    this.emit({ kind: 'list', style: isCheck ? 'check' : style, items: items.map((x) => (isCheck ? x.text : x.raw)) });
  }

  private wordItem(el: Element, id: string, f: Fmt) {
    const marker = Array.from(el.querySelectorAll('span'))
      .filter((s) => styleOf(s)['mso-list'] === 'ignore')
      .map((s) => tidy(s.textContent || '').trim())
      .join('');
    let text = oneLine(this.collect(el, f));
    let style: ListStyle = /^\(?([0-9]{1,3}|[a-z]{1,2}|[ivxlcdm]{1,6})[.)]$/i.test(marker) ? 'number' : 'bullet';

    if (/^[☐☑☒□]$/.test(marker) || CHECK_MARK.test(text)) {
      style = 'check';
      text = text.replace(CHECK_MARK, '');
    }
    if (!text) return;
    const open = this.wordList;

    if (open && open.id === id && this.items[this.items.length - 1] === open.item) {
      open.item.items.push(text);
      return;
    }
    const item = this.emit({ kind: 'list', style, items: [text] });

    if (item.kind === 'list') this.wordList = { id, item };
  }

  private table(el: Element, f: Fmt) {
    const rowEls: Element[] = [];

    for (const c of kids(el)) {
      const ct = tagOf(c);

      if (ct === 'tr') rowEls.push(c);
      else if (ct === 'thead' || ct === 'tbody' || ct === 'tfoot') rowEls.push(...kids(c).filter((r) => tagOf(r) === 'tr'));
    }
    const cellsOf = (r: Element) => kids(r).filter((c) => /^t[dh]$/.test(tagOf(c)));
    const role = el.getAttribute('role') || '';
    const layout =
      role === 'presentation' ||
      role === 'none' ||
      !!el.querySelector('table,h1,h2,h3,h4,h5,h6,ul,ol,blockquote,hr') ||
      rowEls.every((r) => cellsOf(r).length <= 1);

    if (layout) {
      // A layout table (emails, page columns): its cells are just more blocks.
      for (const r of rowEls) {
        for (const c of cellsOf(r)) {
          this.flush();
          this.children(c, f);
          this.flush();
        }
      }
      return;
    }

    const headRow = rowEls.findIndex((r) => tagOf(r.parentElement || r) === 'thead');
    let header = headRow === 0 || (rowEls.length > 0 && cellsOf(rowEls[0]).every((c) => tagOf(c) === 'th'));
    let rows: string[][] = rowEls.map((r) => {
      const out: string[] = [];

      for (const c of cellsOf(r)) {
        out.push(oneLine(this.collect(c, f)));
        const span = Math.min(parseInt(c.getAttribute('colspan') || '1', 10) || 1, 20);

        for (let k = 1; k < span; k++) out.push('');
      }

      return out;
    });
    const captionEl = kids(el).find((c) => tagOf(c) === 'caption');
    const caption = captionEl ? oneLine(this.collect(captionEl, f)) : '';

    rows = rows.filter((r) => r.some(Boolean));
    if (!rows.length) {
      if (caption) this.emit({ kind: 'paragraph', text: caption });
      return;
    }
    const width = rows.reduce((n, r) => Math.max(n, r.length), 0);
    const used = Array.from({ length: width }, (_, k) => rows.some((r) => !!r[k]));

    rows = rows.map((r) => r.filter((_, k) => used[k]));
    // No <th>: a first row that is all bold reads as the header.
    if (!header && rows.length > 1 && rows[0].every((c) => !c || /^\*\*[^*\n]+\*\*$/.test(c))) header = true;
    if (header) rows[0] = rows[0].map(stripWholeBold);
    this.emit({ kind: 'table', header, rows, caption });
  }
}

/** Reads clipboard HTML; null when it is too big to read (then the plain text is used). */
export function readHtml(html: string): PasteRead | null {
  let src = html;

  if (src.length > HTML_MAX) src = src.replace(/(\s(?:src|href|srcset)\s*=\s*)(["'])data:[\s\S]*?\2/gi, '$1$2$2');
  if (src.length > HTML_MAX || typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(src, 'text/html');
  const r = new HtmlReader();

  if (doc.body) {
    r.children(doc.body, PLAIN);
    r.flush();
  }
  return { source: 'html', items: r.items, pictures: r.pictures, text: itemsText(r.items) };
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

const PT_HEADING = /^(#{1,6})\s+(.+?)(?:\s+#+)?$/;
const PT_DIVIDER = /^([-_*=—])(?:\s*\1){2,}$/;
const PT_MARK = /^(?:\[[ xX✓✔]\]|[☐☑☒])\s+(.*)$/;
const PT_BULLET = /^[-*•◦▪‣●○–]\s+(.*)$/;
const PT_NUMBER = /^\d{1,3}[.)]\s+(.*)$/;
const PT_QUOTE = /^>\s?(.*)$/;
const PT_ROW = /^\|.*\|$/;
const PT_RULE = /^\|(?:\s*:?-{3,}:?\s*\|)+$/;

/** Reads plain text: blank lines split paragraphs; #, -, *, •, 1., 1), [ ], >, --- and | a | b | lines make structure. */
export function readPlainText(raw: string): PasteRead {
  const items: PasteItem[] = [];
  let para: string[] = [];
  // A run of list lines: '-' and '[ ]' lines together, numbered ones apart.
  let list: { number: boolean; items: { raw: string; text: string; check: boolean; boxOnly: boolean }[] } | null = null;
  let quote: string[] | null = null;
  let rows: string[][] | null = null;
  let header = false;
  let blank = false;
  const endPara = () => {
    if (para.length) items.push({ kind: 'paragraph', text: para.join('\n') });
    para = [];
  };
  const endList = () => {
    if (list) {
      const checks = list.items.filter((x) => x.check).length;
      // Same rule as for pasted HTML: a checklist when most lines have a box, otherwise "[x]" stays part of the wording.
      const style: ListStyle = list.number ? 'number' : checks > 0 && checks * 2 >= list.items.length ? 'check' : 'bullet';

      items.push({ kind: 'list', style, items: list.items.map((x) => (style === 'check' ? x.text : x.raw)) });
    }
    list = null;
  };
  const endQuote = () => {
    const text = (quote || []).join('\n').replace(/\n{3,}/g, '\n\n').trim();

    if (text) items.push({ kind: 'quote', text });
    quote = null;
  };
  const endTable = () => {
    if (rows?.length) items.push({ kind: 'table', header, rows, caption: '' });
    rows = null;
    header = false;
  };
  const endAll = () => {
    endPara();
    endList();
    endQuote();
    endTable();
  };
  const addItem = (number: boolean, raw: string, boxOnly: boolean, afterBlank: boolean) => {
    const box = number ? null : PT_MARK.exec(raw);

    endPara();
    endQuote();
    endTable();
    // A blank line before a different kind of list line starts a new list.
    if (list && (list.number !== number || (afterBlank && list.items[list.items.length - 1].boxOnly !== boxOnly))) endList();
    if (!list) list = { number, items: [] };
    list.items.push({ raw, text: box ? box[1] : raw, check: !!box, boxOnly });
  };

  for (const rawLine of raw.split(LINE_BREAK)) {
    const indent = (/^[\t \u00A0]*/.exec(rawLine)?.[0] || '').replace(/\t/g, '    ').length;
    const t = tidy(rawLine).trim();
    let m: RegExpExecArray | null;

    if (!t) {
      endPara();
      endQuote();
      endTable();
      blank = true;
      continue;
    }
    const wasBlank = blank;

    blank = false;
    if ((m = PT_HEADING.exec(t))) {
      endAll();
      items.push({ kind: 'heading', text: m[2], level: m[1].length === 1 ? 1 : m[1].length === 2 ? 2 : 3 });
    } else if (PT_DIVIDER.test(t)) {
      endAll();
      items.push({ kind: 'divider' });
    } else if (PT_ROW.test(t)) {
      endPara();
      endList();
      endQuote();
      if (rows && rows.length === 1 && PT_RULE.test(t.replace(/\s+/g, ''))) {
        header = true;
        continue;
      }
      if (!rows) rows = [];
      rows.push(
        t
          .slice(1, -1)
          .split('|')
          .map((c) => c.trim())
      );
    } else if ((m = PT_QUOTE.exec(t))) {
      endPara();
      endList();
      endTable();
      if (!quote) quote = [];
      quote.push(m[1].trim());
    } else if ((m = PT_BULLET.exec(t))) addItem(false, m[1], false, wasBlank);
    else if (PT_MARK.test(t)) addItem(false, t, true, wasBlank);
    else if ((m = PT_NUMBER.exec(t))) addItem(true, m[1], false, wasBlank);
    else if (list && !wasBlank && indent >= 2) {
      // (list is only set inside addItem, which TypeScript can't follow here.)
      const cur: { items: { raw: string; text: string }[] } = list;
      const last = cur.items[cur.items.length - 1];

      last.raw += ` ${t}`;
      last.text += ` ${t}`;
    } else {
      endList();
      endQuote();
      endTable();
      para.push(t);
    }
  }
  endAll();
  return { source: 'text', items, pictures: 0, text: raw };
}

/** The reading written as text for the paste area (tiny markdown + the plain-text marks readPlainText understands). */
function itemsText(items: PasteItem[]) {
  return items
    .map((it) => {
      switch (it.kind) {
        case 'heading':
          return `${'#'.repeat(it.level)} ${it.text}`;
        case 'paragraph':
          return it.text;
        case 'list':
          return it.items.map((x, k) => `${it.style === 'number' ? `${k + 1}.` : it.style === 'check' ? '[ ]' : '-'} ${x}`).join('\n');
        case 'quote':
          return it.text
            .split('\n')
            .map((l) => (l ? `> ${l}` : '>'))
            .join('\n');
        case 'divider':
          return '---';
        case 'table': {
          const lines = it.rows.map((r) => `| ${r.join(' | ')} |`);

          if (it.header) lines.splice(1, 0, `|${it.rows[0].map(() => ' --- |').join('')}`);
          return (it.caption ? `${it.caption}\n\n` : '') + lines.join('\n');
        }
      }
    })
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// Plan: guessed headings, lessons, blocks
// ---------------------------------------------------------------------------

function shortLine(md: string) {
  const v = visibleText(md).trim();

  return !md.includes('\n') && v.length > 0 && v.length <= 60 && /\p{L}/u.test(v) && !/[.,;:…]$/.test(v);
}

function bodyAfter(md: string, title: string) {
  const v = visibleText(md).trim();

  return v.length > visibleText(title).trim().length && (/[.!?…:;"'”’)\]]$/.test(v) || v.length > 60);
}

/** "Guess headings": a short line on its own (≤ 60 characters, no full stop) before a longer paragraph → heading 2. */
function guessHeadings(items: PasteItem[], firstLines: boolean): PasteItem[] {
  if (items.some((it) => it.kind === 'heading')) return items;
  const out: PasteItem[] = [];

  items.forEach((it, k) => {
    const next = items[k + 1];

    if (it.kind !== 'paragraph') out.push(it);
    else if (shortLine(it.text) && next?.kind === 'paragraph' && bodyAfter(next.text, it.text)) {
      out.push({ kind: 'heading', text: stripWholeBold(it.text), level: 2 });
    } else {
      const nl = it.text.indexOf('\n');
      const head = it.text.slice(0, nl);
      const rest = it.text.slice(nl + 1);

      // Plain text often has the title right above its paragraph, without a blank line.
      if (firstLines && nl > 0 && shortLine(head) && bodyAfter(rest, head)) {
        out.push({ kind: 'heading', text: stripWholeBold(head), level: 2 }, { kind: 'paragraph', text: rest });
      } else out.push(it);
    }
  });

  return out;
}

function paragraphBlock(text: string): Block {
  return { id: newId('b'), type: 'paragraph', text };
}

/** blocks3's table when the normaliser knows it and the table fits (long ones split, header repeated); otherwise one paragraph per row. */
function tableBlocks(t: Extract<PasteItem, { kind: 'table' }>): Block[] {
  const cols = t.rows.reduce((n, r) => Math.max(n, r.length), 0);

  if (cols <= TABLE_COLS && t.rows.every((r) => r.every((c) => c.length <= TABLE_CELL))) {
    const head = t.header ? t.rows.slice(0, 1) : [];
    const body = t.header ? t.rows.slice(1) : t.rows;
    const per = TABLE_ROWS - head.length;
    const out: Block[] = [];

    for (let k = 0; k === 0 || k < body.length; k += per) {
      const rows = [...head, ...body.slice(k, k + per)].map((r) => [...r, ...Array<string>(cols - r.length).fill('')]);
      const b = normalizeBlock({ id: newId('b'), type: 'table', header: t.header, rows, caption: k ? '' : t.caption });

      if (!b) break;
      out.push(b);
    }
    if (out.length) return out;
  }

  const out: Block[] = t.caption ? [paragraphBlock(t.caption)] : [];

  for (const r of t.rows) {
    const cells = r.filter((c) => c.trim());

    if (cells.length) out.push(paragraphBlock(cells.join(' · ')));
  }

  return out;
}

function itemBlocks(it: PasteItem): Block[] {
  switch (it.kind) {
    case 'heading':
      return [{ id: newId('b'), type: 'heading', text: it.text, level: it.level }];
    case 'paragraph':
      return [paragraphBlock(it.text)];
    case 'list':
      return [{ id: newId('b'), type: 'list', style: it.style, items: it.items }];
    case 'quote':
      return [{ id: newId('b'), type: 'quote', text: it.text, cite: '' }];
    case 'divider':
      return [{ id: newId('b'), type: 'divider' }];
    case 'table':
      return tableBlocks(it);
  }
}

export function planPaste(read: PasteRead, opts: { guessHeadings: boolean; splitLessons: boolean }): PastePlan {
  const items = opts.guessHeadings ? guessHeadings(read.items, read.source === 'text') : read.items;
  const top = items.reduce((n, it) => (it.kind === 'heading' ? Math.min(n, it.level) : n), 4);
  const plan: PastePlan = { intro: [], lessons: [], count: 0, cut: false, headings: top < 4 };
  let target = plan.intro;

  for (const it of items) {
    if (opts.splitLessons && it.kind === 'heading' && it.level === top) {
      if (plan.count >= PASTE_MAX_BLOCKS) {
        plan.cut = true;
        break;
      }
      const lesson = { title: visibleText(it.text).trim(), blocks: [] as Block[] };

      plan.lessons.push(lesson);
      target = lesson.blocks;
      continue;
    }
    for (const b of itemBlocks(it)) {
      if (plan.count >= PASTE_MAX_BLOCKS) {
        plan.cut = true;
        break;
      }
      target.push(b);
      plan.count++;
    }
    if (plan.cut) break;
  }

  return plan;
}

/** Adds the plan to the open lesson (new lessons right after it), with fresh ids; null when the lesson is gone. */
export function insertPaste(c: Content, lessonId: string, plan: PastePlan): { content: Content; added: PasteAdded } | null {
  const at = c.lessons.findIndex((l) => l.id === lessonId);

  if (at < 0 || (!plan.count && !plan.lessons.length)) return null;
  const fresh = (bs: Block[]) => bs.map((b) => ({ ...b, id: newId('b') }));
  const intro = fresh(plan.intro);
  const lessons = plan.lessons.map((p) => ({ ...blankLesson(p.title), blocks: fresh(p.blocks) }));
  const next = c.lessons.slice();

  next[at] = { ...next[at], blocks: [...next[at].blocks, ...intro] };
  next.splice(at + 1, 0, ...lessons);
  return { content: { ...c, lessons: next }, added: { lessonId, blockIds: intro.map((b) => b.id), lessonIds: lessons.map((l) => l.id) } };
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

const noop = () => undefined;
const PREVIEW_CTX: BlockCtx = { workspaceId: '', preview: true, kc: {}, done: new Set(), onKcAnswer: noop, onScenarioDone: noop, onMedia: noop };
const INFO = BLOCK_INFO as Partial<Record<string, { emoji: string; label: string }>>;

function typeLabel(b: Block) {
  const info = INFO[b.type] || { emoji: '▦', label: 'Table' };

  if (b.type === 'heading') return `${info.emoji} Heading ${b.level}`;
  if (b.type === 'list') return `${info.emoji} ${b.style === 'number' ? 'Numbered list' : b.style === 'check' ? 'Checklist' : 'Bulleted list'}`;
  return `${info.emoji} ${info.label}`;
}

function PreviewBlock({ block }: { block: Block }) {
  return (
    <div className='flex min-w-0 flex-col gap-1'>
      <div className='text-[11px] font-medium text-text-tertiary'>{typeLabel(block)}</div>
      <div className='min-w-0 break-words'>
        <BlockView block={block} ctx={PREVIEW_CTX} />
      </div>
    </div>
  );
}

function summaryText(plan: PastePlan) {
  return `${plural(plan.count, 'block')}${plan.lessons.length ? ` in ${plural(plan.lessons.length, 'new lesson')}` : ''}`;
}

/**
 * "Paste text" for the open lesson. Mount it always (it renders nothing while lessonId is ''). Adding is one step of
 * Studio's undo history ("paste text"); `onAdded` gets the words for Studio's undo message.
 */
export function PasteTextDialog({
  lessonId,
  draft,
  update,
  onAdded,
  onClose,
}: {
  lessonId: string;
  draft: Content;
  update: (fn: (c: Content) => Content, label?: string) => void;
  onAdded: (label: string) => void;
  onClose: () => void;
}) {
  const lesson = lessonId ? draft.lessons.find((l) => l.id === lessonId) : undefined;

  if (!lesson) return null;

  const add = (plan: PastePlan) => {
    const box: { r: ReturnType<typeof insertPaste> } = { r: null };

    update((c) => {
      box.r = insertPaste(c, lessonId, plan);
      return box.r ? box.r.content : c;
    }, 'paste text');
    if (!box.r) return;
    onAdded(`Added ${summaryText(plan)}.`);
    onClose();
  };

  return <PasteBody lessonTitle={lesson.title} onAdd={add} onClose={onClose} />;
}

function PasteBody({ lessonTitle, onAdd, onClose }: { lessonTitle: string; onAdd: (plan: PastePlan) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const [read, setRead] = useState<PasteRead | null>(null);
  const [pictures, setPictures] = useState(0);
  const [guess, setGuess] = useState(true);
  const [split, setSplit] = useState(false);
  const timer = useRef(0);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const tooLong = text.length > PASTE_MAX_CHARS;
  const plan = useMemo(() => (read && !tooLong ? planPaste(read, { guessHeadings: guess, splitLessons: split }) : null), [read, tooLong, guess, split]);
  const empty = !plan || (!plan.count && !plan.lessons.length);

  // Focus stays in the dialog (Tab / Shift+Tab wrap) and goes back to the "Paste text" button afterwards.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = boxRef.current?.closest<HTMLElement>('[role="dialog"]') || null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !dialog) return;
      const els = Array.from(
        dialog.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),textarea,input:not([disabled]),select,[tabindex]:not([tabindex="-1"])')
      ).filter((x) => x.getClientRects().length > 0);
      const active = document.activeElement;

      if (!els.length) return;
      if (e.shiftKey && (active === els[0] || !dialog.contains(active))) {
        e.preventDefault();
        els[els.length - 1].focus();
      } else if (!e.shiftKey && (active === els[els.length - 1] || !dialog.contains(active))) {
        e.preventDefault();
        els[0].focus();
      }
    };

    dialog?.setAttribute('aria-label', 'Turn text into blocks');
    areaRef.current?.focus();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.clearTimeout(timer.current);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const readLater = (v: string) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setRead(v.trim() && v.length <= PASTE_MAX_CHARS ? readPlainText(v) : null), v.length > 20000 ? 400 : 200);
  };

  const onPaste = (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    const whole = !ta.value.trim() || (ta.selectionStart === 0 && ta.selectionEnd === ta.value.length);

    if (!whole) return; // pasted into the middle of the text: the browser adds it as plain text
    setPictures(0);
    const html = e.clipboardData.getData('text/html');
    const plain = e.clipboardData.getData('text/plain');

    if (!html.trim() || plain.length > PASTE_MAX_CHARS) return;
    const r = readHtml(html);

    if (!r || (!r.items.length && plain.trim())) return;
    // HTML without any structure or formatting (a code editor, a plain email): the plain text may say more ("- " lists…).
    const flat = r.items.every((it) => it.kind === 'paragraph' && !/\*|\]\(/.test(it.text));

    if (flat && readPlainText(plain).items.some((it) => it.kind !== 'paragraph')) return;
    e.preventDefault();
    window.clearTimeout(timer.current);
    setText(r.text);
    setRead(r);
    setPictures(r.pictures);
  };

  const status = tooLong ? '' : plan ? (empty ? 'No text found yet.' : summaryText(plan)) : '';
  const splitHint = plan && !plan.headings ? 'There are no headings in this text.' : 'The biggest headings become lesson titles. Blocks before the first one go into this lesson.';

  return (
    <CareHubModal
      title='Turn text into blocks'
      wide='xl'
      testId='chl-paste-dialog'
      onClose={onClose}
      footer={
        <>
          <Button type='button' variant='ghost' onClick={onClose}>
            Cancel
          </Button>
          <Button type='button' disabled={empty} onClick={() => plan && !empty && onAdd(plan)}>
            Add to lesson
          </Button>
        </>
      }
    >
      <div ref={boxRef} className='grid gap-4 md:grid-cols-2'>
        <div className='flex min-w-0 flex-col gap-2'>
          <label htmlFor='chl-paste-area' className='text-sm font-medium'>
            Paste your text here
          </label>
          <textarea
            id='chl-paste-area'
            ref={areaRef}
            value={text}
            onPaste={onPaste}
            onChange={(e) => {
              const v = e.target.value;

              setText(v);
              if (!v.trim()) setPictures(0);
              readLater(v);
            }}
            aria-describedby='chl-paste-hint'
            placeholder='From Word, Google Docs, a web page, an email or plain text'
            className={cn(chInputClass, 'h-[200px] w-full resize-y leading-relaxed md:h-[44vh]')}
          />
          <p id='chl-paste-hint' className='text-xs text-text-tertiary'>
            Headings, lists, quotes, tables, bold, italic and links are kept, and the wording stays exactly as it is. Pictures are left out.
          </p>
          {tooLong && <ChNote tone='error'>That’s a lot of text. Paste up to 100,000 characters at a time.</ChNote>}
          <div className='flex flex-col gap-2 pt-1'>
            <Toggle checked={guess} onChange={setGuess} label='Guess headings' hint='A short line on its own before a longer paragraph becomes a heading.' />
            <Toggle checked={split} onChange={setSplit} label='Start a new lesson at each main heading' hint={splitHint} disabled={!!plan && !plan.headings} />
          </div>
        </div>
        <div className='flex min-w-0 flex-col gap-2'>
          <div className='flex flex-wrap items-baseline justify-between gap-2'>
            <div id='chl-paste-preview' className='text-sm font-medium'>
              Preview
            </div>
            <div role='status' aria-live='polite' className='text-xs text-text-secondary'>
              {status}
            </div>
          </div>
          {plan?.cut && <ChNote tone='warn'>Only the first 300 blocks will be added.</ChNote>}
          {pictures > 0 && (
            <ChNote>
              {pictures === 1 ? '1 picture wasn’t copied — add it with an Image block.' : `${pictures} pictures weren’t copied — add them with an Image block.`}
            </ChNote>
          )}
          <div
            role='region'
            aria-labelledby='chl-paste-preview'
            tabIndex={0}
            className='flex min-h-[120px] flex-col gap-4 rounded-[10px] border border-border-primary p-3 md:h-[44vh] md:overflow-y-auto'
          >
            {!plan || empty ? (
              <p className='text-sm text-text-tertiary'>The blocks will show here.</p>
            ) : (
              <>
                {plan.lessons.length > 0 && plan.intro.length > 0 && (
                  <div className='text-xs font-semibold text-text-secondary'>Added to “{lessonTitle.trim() || 'this lesson'}”</div>
                )}
                {plan.intro.map((b) => (
                  <PreviewBlock key={b.id} block={b} />
                ))}
                {plan.lessons.map((l, k) => (
                  <section key={k} className={cn('flex flex-col gap-4', (k > 0 || plan.intro.length > 0) && 'border-t border-border-primary pt-4')}>
                    <div className='text-xs font-semibold text-text-secondary'>New lesson: {l.title}</div>
                    {l.blocks.length ? l.blocks.map((b) => <PreviewBlock key={b.id} block={b} />) : <p className='text-sm text-text-tertiary'>No blocks yet.</p>}
                  </section>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </CareHubModal>
  );
}

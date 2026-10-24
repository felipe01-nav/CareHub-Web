// CareHub Learning (lane player3): search inside a course, video captions and media transcripts.
// The shared learning files import this one, so it only *type*-imports from them (blocks3's file is fine: it imports
// only types itself — its jump and search text are used here). What they own (the link rule, the sign-in file
// download, rich text, the upload field) is handed in by the caller.
import { useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { ComponentType, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { blocks3SearchText, JumpContext } from './CareHubLearningBlocks3';
import { withBlocks4Search } from './CareHubLearningBlocks4';
import { chInputClass } from './CareHubUi';

import type { Block, Lesson } from './CareHubLearningApi';

export const TRANSCRIPT_MAX = 20000;
export const CAPTIONS_LABEL_MAX = 40;
export const CAPTIONS_ACCEPT = '.vtt,.srt,text/vtt';
export const CAPTIONS_WRONG = 'This captions file doesn’t look right. Use a .vtt or .srt file.';
export const SEARCH_LIMIT = 50;
export const LOCKED_TEXT = 'Opens after you finish the lessons before it';
export const GATED_TEXT = 'Press Continue in this lesson to get there.';
const CAPTIONS_MAX_BYTES = 2 * 1024 * 1024;

type Rec = Record<string, unknown>;

function rec(v: unknown): Rec {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {};
}

function txt(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

// ---------------------------------------------------------------------------
// Content fields (video: captions + transcript; audio: transcript)
// ---------------------------------------------------------------------------

export interface VideoExtras {
  /** A .vtt file: an uploaded Care Hub file or an https:// link. "" = none. */
  captions_url: string;
  /** The name in the video's captions menu. */
  captions_label: string;
  transcript: string;
}

export interface AudioExtras {
  transcript: string;
}

/** Normaliser part for a video block. Missing fields get safe defaults; limits are cut. */
/** Cut to at most max UTF-16 units without splitting an emoji (so it's never over max characters either). */
function cut(s: string, max: number) {
  if (s.length <= max) return s;
  const c = s.charCodeAt(max - 1);

  return s.slice(0, c >= 0xd800 && c <= 0xdbff ? max - 1 : max);
}

function chars(s: string | undefined) {
  return Array.from(s || '').length;
}

export function videoExtras(raw: unknown): VideoExtras {
  const o = rec(raw);

  return {
    captions_url: cut(txt(o.captions_url), 2000),
    captions_label: typeof o.captions_label === 'string' ? cut(o.captions_label, CAPTIONS_LABEL_MAX) : 'English',
    transcript: cut(txt(o.transcript), TRANSCRIPT_MAX),
  };
}

export function audioExtras(raw: unknown): AudioExtras {
  return { transcript: cut(txt(rec(raw).transcript), TRANSCRIPT_MAX) };
}

export function blankVideoExtras(): VideoExtras {
  return { captions_url: '', captions_label: 'English', transcript: '' };
}

export function blankAudioExtras(): AudioExtras {
  return { transcript: '' };
}

/**
 * Publish checks, same words and limits as the server. at = where the block is, as the server says it
 * ("block 2 of Lesson 1 (\"Welcome\")").
 */
export function mediaExtrasProblems(
  b: { type: string; captions_url?: string; captions_label?: string; transcript?: string },
  at: string,
  linkOk: (url: string) => boolean,
  out: string[]
) {
  if (b.type !== 'video' && b.type !== 'audio') return;
  if (b.type === 'video') {
    const url = b.captions_url || '';

    if (url.trim() && !linkOk(url)) {
      out.push(`The video in ${at} has a captions link that must start with https:// (or be a Care Hub link starting with /).`);
    }

    if (chars(b.captions_label) > CAPTIONS_LABEL_MAX) out.push(`The video in ${at} has a captions label that is too long (40 characters at most).`);
  }

  if (chars(b.transcript) > TRANSCRIPT_MAX) {
    out.push(`The ${b.type} in ${at} has a transcript that is too long (20,000 characters at most).`);
  }
}

// ---------------------------------------------------------------------------
// Captions files (.srt → .vtt, checks, loading)
// ---------------------------------------------------------------------------

const TIME = String.raw`(?:\d{1,3}:)?\d{1,2}:\d{1,2}[,.]\d{1,3}`;
const TIMING = new RegExp(String.raw`^\s*(${TIME})\s*-->\s*(${TIME})`);

function vttTime(t: string) {
  const m = t.trim().match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/);

  if (!m) return '';
  return `${(m[1] || '0').padStart(2, '0')}:${m[2].padStart(2, '0')}:${m[3].padStart(2, '0')}.${m[4].padEnd(3, '0')}`;
}

/**
 * Captions text → WebVTT. A WebVTT file is kept as it is; an .srt file is converted. null = it doesn't look like
 * captions (no "WEBVTT" start, or no timed lines).
 */
export function captionsToVtt(raw: string): string | null {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

  if (/^WEBVTT(?=$|[ \t\n])/.test(text)) return text.includes('-->') ? (text.endsWith('\n') ? text : `${text}\n`) : null;
  const cues: string[] = [];

  for (const chunk of text.split(/\n\s*\n/)) {
    const lines = chunk.split('\n');

    while (lines.length && !lines[0].trim()) lines.shift();
    const at = lines.findIndex((l) => l.includes('-->'));

    // An optional number line, then the timing line ("00:00:01,000 --> 00:00:04,000").
    if (at < 0 || at > 1) continue;
    const m = lines[at].match(TIMING);
    const start = m ? vttTime(m[1]) : '';
    const end = m ? vttTime(m[2]) : '';
    const words = lines
      .slice(at + 1)
      .map((l) => l.replace(/\{\\[^}]*\}/g, '').replace(/-->/g, '→'))
      .join('\n')
      .trim();

    if (start && end && words) cues.push(`${start} --> ${end}\n${words}`);
  }

  return cues.length ? `WEBVTT\n\n${cues.join('\n\n')}\n` : null;
}

/** Bytes → text: UTF-8 (or UTF-16 with a byte-order mark); older .srt files saved as Windows text still read right. */
function decodeText(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const enc = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  const text = new TextDecoder(enc).decode(bytes);

  if (enc !== 'utf-8' || !text.includes('\uFFFD')) return text;
  try {
    return new TextDecoder('windows-1252').decode(bytes);
  } catch {
    return text;
  }
}

/** Studio, before upload: .srt becomes .vtt in the browser; anything that isn't captions is refused. */
export async function prepareCaptionsFile(file: File): Promise<File> {
  if (file.size > CAPTIONS_MAX_BYTES) throw new Error(`“${file.name}” is too big for a captions file. The limit is 2 MB.`);
  const vtt = captionsToVtt(decodeText(await file.arrayBuffer()));

  if (!vtt) throw new Error(CAPTIONS_WRONG);
  const base = file.name.replace(/\.[^./\\]{1,8}$/, '').trim() || 'captions';

  return new File([vtt], `${base}.vtt`, { type: 'text/vtt' });
}

export interface CaptionFiles {
  /** True for files kept in Care Hub (downloaded with the sign-in token). */
  isCareHubFile: (url: string) => boolean;
  fetchFile: (url: string, signal: AbortSignal) => Promise<Blob>;
}

/** Downloads captions and returns WebVTT text (throws if it can't be read or isn't captions). */
export async function loadCaptions(url: string, signal: AbortSignal, files?: CaptionFiles): Promise<string> {
  const u = url.trim();
  let blob: Blob;

  if (files && files.isCareHubFile(u)) {
    blob = await files.fetchFile(u, signal);
  } else {
    const res = await fetch(u, { signal, credentials: 'omit' });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    blob = await res.blob();
  }

  if (blob.size > CAPTIONS_MAX_BYTES) throw new Error('This captions file is too big.');
  const vtt = captionsToVtt(decodeText(await blob.arrayBuffer()));

  if (!vtt) throw new Error(CAPTIONS_WRONG);
  return vtt;
}

/** The captions as a same-origin object URL, so a <track> works for links on other websites too. "" until ready. */
function useCaptionsSrc(url: string, files: CaptionFiles) {
  const [src, setSrc] = useState('');
  const latest = useRef(files);

  latest.current = files;
  useEffect(() => {
    const u = url.trim();

    setSrc('');
    if (!u) return undefined;
    const ctrl = new AbortController();
    let made = '';

    loadCaptions(u, ctrl.signal, latest.current)
      .then((vtt) => {
        if (ctrl.signal.aborted) return;
        made = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
        setSrc(made);
      })
      .catch(() => undefined);
    return () => {
      ctrl.abort();
      if (made) URL.revokeObjectURL(made);
    };
  }, [url]);

  return src;
}

/**
 * Put inside a <video>: its captions as <track kind="captions" default>. Renders nothing without captions or if they
 * can't be read (the video still plays). Pass only links that pass the link rule.
 */
export function CaptionsTrack({ url, label, files }: { url: string; label?: string; files: CaptionFiles }) {
  const src = useCaptionsSrc(url, files);
  const ref = useRef<HTMLTrackElement | null>(null);

  useEffect(() => {
    const track = ref.current?.track;

    // The track arrives after the video, so turn it on here ("default" only counts for tracks there from the start).
    if (src && track) track.mode = 'showing';
  }, [src]);

  if (!src) return null;
  return <track ref={ref} kind='captions' src={src} label={(label || '').trim() || 'English'} default />;
}

// ---------------------------------------------------------------------------
// Transcript (learner)
// ---------------------------------------------------------------------------

const TRANSCRIPT_ASK = 'carehub-learning-open-transcript';
let transcriptAsk: { blockId: string; term: string; at: number } | null = null;

/** Search picked a match inside this block's transcript: open it (now, or when the lesson has opened). */
function askTranscript(blockId: string, term: string) {
  transcriptAsk = { blockId, term, at: Date.now() };
  window.dispatchEvent(new Event(TRANSCRIPT_ASK));
}

function takeTranscriptAsk(blockId: string) {
  const ask = transcriptAsk;

  if (!ask || ask.blockId !== blockId || Date.now() - ask.at > 3000) return null;
  transcriptAsk = null;
  return ask;
}

/** Scrolls the transcript box to the first place the (folded) search words are. */
function scrollToMatch(region: HTMLElement, term: string) {
  const walk = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);

  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    const map = foldWithMap(node.textContent || '');
    const at = term ? map.folded.indexOf(term) : -1;

    if (at < 0) continue;
    const range = document.createRange();

    range.setStart(node, map.from[at]);
    range.setEnd(node, map.to[at + term.length - 1]);
    region.scrollTop += range.getBoundingClientRect().top - region.getBoundingClientRect().top - 24;
    return;
  }
}

/** "Show transcript" under a video or audio player; the text opens in a scrollable region. */
export function MediaTranscript({
  text,
  kind,
  Text,
  blockId,
}: {
  text: string;
  kind: 'video' | 'audio';
  Text: ComponentType<{ text: string }>;
  /** The block's id, so a search result inside the transcript can open it. */
  blockId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState<{ term: string } | null>(null);
  const region = useRef<HTMLDivElement | null>(null);
  const id = useId();

  useEffect(() => {
    if (!blockId) return undefined;
    const check = () => {
      const a = takeTranscriptAsk(blockId);

      if (a) {
        setOpen(true);
        setAsk({ term: a.term });
      }
    };

    check();
    window.addEventListener(TRANSCRIPT_ASK, check);
    return () => window.removeEventListener(TRANSCRIPT_ASK, check);
  }, [blockId]);

  useEffect(() => {
    const el = region.current;

    if (!ask || !open || !el) return undefined;
    scrollToMatch(el, ask.term);
    // The jump scrolls to the block and focuses it first; then show the open transcript and move focus into it.
    const t = window.setTimeout(() => {
      const a = document.activeElement;
      const still = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

      el.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' });
      if (!a || a === document.body || a.contains(el)) el.focus({ preventScroll: true });
    }, 600);

    return () => window.clearTimeout(t);
  }, [ask, open]);

  if (!text.trim()) return null;
  return (
    <div className='mt-2'>
      <Button type='button' size='sm' variant='outline' aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden='true'>📝</span> {open ? 'Hide transcript' : 'Show transcript'}
      </Button>
      <div
        ref={region}
        id={id}
        role='region'
        aria-label={kind === 'video' ? 'Video transcript' : 'Audio transcript'}
        tabIndex={0}
        hidden={!open}
        className='mt-2 max-h-[320px] overflow-y-auto overscroll-contain rounded-[10px] border border-border-primary px-3 py-2 text-sm leading-relaxed'
      >
        <Text text={text} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Studio fields (captions + transcript)
// ---------------------------------------------------------------------------

/** What the captions upload-or-link field gets (Studio's MediaField takes these as props). */
export interface CaptionsFieldProps {
  label: string;
  value: string;
  onChange: (url: string) => void;
  hint: ReactNode;
  placeholder: string;
  accept: string;
  noun: string;
  prepare: (file: File) => Promise<File>;
}

export interface MediaExtrasBlock {
  url: string;
  captions_url?: string;
  captions_label?: string;
  transcript?: string;
}

type LinkCheck = 'idle' | 'checking' | 'ok' | 'bad';

/** For a pasted https:// captions link: can the browser read it? (Other websites must allow it.) */
function useLinkCheck(url: string): LinkCheck {
  const [state, setState] = useState<LinkCheck>('idle');

  useEffect(() => {
    const u = url.trim();

    if (!/^https?:\/\//i.test(u) || u.includes('/api/file_storage/')) {
      setState('idle');
      return undefined;
    }

    setState('checking');
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      loadCaptions(u, ctrl.signal)
        .then(() => {
          if (!ctrl.signal.aborted) setState('ok');
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setState('bad');
        });
    }, 700);

    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [url]);

  return state;
}

const LINK_CHECK_TEXT: Record<LinkCheck, string> = {
  idle: '',
  checking: 'Checking the captions file…',
  ok: '✓ Captions file found.',
  bad: 'We couldn’t read captions from this link — that website may not allow it. Upload the file instead.',
};

function Labeled({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className='flex min-w-0 flex-col gap-1'>
      <span className='text-xs font-medium text-text-secondary'>{label}</span>
      {children}
      {hint && <span className='text-xs text-text-tertiary'>{hint}</span>}
    </label>
  );
}

/**
 * Studio: captions (video files only) and transcript fields for a video or audio block. Leave out captionsField for
 * audio. playerCaptions = a YouTube, Vimeo or Loom link (their player has its own captions).
 */
export function MediaExtrasFields<B extends MediaExtrasBlock>({
  block,
  onChange,
  playerCaptions,
  captionsField,
}: {
  block: B;
  onChange: (b: B) => void;
  playerCaptions?: boolean;
  captionsField?: (p: CaptionsFieldProps) => ReactNode;
}) {
  const captionsUrl = block.captions_url || '';
  const check = useLinkCheck(captionsField && !playerCaptions ? captionsUrl : '');
  const transcript = block.transcript || '';
  const near = transcript.length > TRANSCRIPT_MAX - 4000;

  return (
    <>
      {captionsField &&
        (playerCaptions ? (
          <p className='m-0 text-xs text-text-tertiary'>YouTube, Vimeo and Loom show their own captions — turn them on in that video’s settings.</p>
        ) : (
          <>
            {captionsField({
              label: 'Captions (optional)',
              value: captionsUrl,
              onChange: (url) => onChange({ ...block, captions_url: url }),
              hint: (
                <>
                  Upload a .vtt or .srt file, or paste a link to a .vtt file. Captions show on the video for people who can’t hear it.
                  {check !== 'idle' && (
                    <span className={cn('mt-0.5 block', check === 'ok' && 'chl-mark-right', check === 'bad' && 'text-text-error')} role={check === 'bad' ? 'alert' : undefined}>
                      {LINK_CHECK_TEXT[check]}
                    </span>
                  )}
                </>
              ),
              placeholder: 'https://… (a .vtt file)',
              accept: CAPTIONS_ACCEPT,
              noun: 'captions',
              prepare: prepareCaptionsFile,
            })}
            {captionsUrl.trim() && (
              <Labeled label='Captions language' hint='The name people see in the video’s captions menu.'>
                <input
                  type='text'
                  value={block.captions_label ?? 'English'}
                  placeholder='English'
                  maxLength={CAPTIONS_LABEL_MAX}
                  className={cn(chInputClass, 'w-full min-w-0')}
                  onChange={(e) => onChange({ ...block, captions_label: e.target.value })}
                />
              </Labeled>
            )}
          </>
        ))}
      <Labeled
        label='Transcript (optional)'
        hint={
          <>
            Add a transcript so people who can’t listen can read it.
            {near && ` ${transcript.length.toLocaleString('en-US')} of ${TRANSCRIPT_MAX.toLocaleString('en-US')} characters.`}
          </>
        }
      >
        <textarea
          value={transcript}
          rows={4}
          maxLength={TRANSCRIPT_MAX}
          placeholder='Type or paste what is said…'
          className={cn(chInputClass, 'w-full min-w-0 resize-y leading-relaxed')}
          onChange={(e) => onChange({ ...block, transcript: e.target.value })}
        />
      </Labeled>
    </>
  );
}

// ---------------------------------------------------------------------------
// Search: text of every block (never the final quiz, knowledge-check answers or feedback)
// ---------------------------------------------------------------------------

export interface SearchPart {
  text: string;
  /** Where in the block, when it helps ("transcript"). */
  where?: string;
}

const KIND_LABEL: Record<string, string> = {
  lesson: 'Lesson title',
  heading: 'Heading',
  paragraph: 'Text',
  statement: 'Statement',
  quote: 'Quote',
  callout: 'Callout',
  list: 'List',
  image: 'Picture',
  video: 'Video',
  audio: 'Audio',
  file: 'File',
  page_link: 'Care Hub page',
  accordion: 'Accordion',
  tabs: 'Tabs',
  process: 'Process',
  flashcards: 'Flashcards',
  knowledge_check: 'Knowledge check',
  scenario: 'Scenario',
  labeled_graphic: 'Labeled graphic',
  sorting: 'Sorting activity',
  timeline: 'Timeline',
  gallery: 'Gallery',
  table: 'Table',
  buttons: 'Buttons',
};

/** Tiny-markdown text → what a reader sees (no ** or * marks, links become their words, spaces tidied). */
export function plainSearchText(text: string) {
  return text
    .replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, '$1')
    .replace(/\*\*([^*\n]+?)\*\*/g, '$1')
    .replace(/\*([^*\n]+?)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The searchable text of a block, plus extraText (blocks3SearchText) — the only text for kinds this file doesn't know. */
export function blockSearchParts(block: Block, extraText?: (b: Block) => string): SearchPart[] {
  let more = '';

  try {
    const t = extraText ? extraText(block) : '';

    more = typeof t === 'string' ? t : '';
  } catch {
    more = '';
  }

  const known = knownSearchParts(block);

  return more.trim() ? [...(known || []), { text: more }] : known || [];
}

function knownSearchParts(block: Block): SearchPart[] | null {
  const b = block as unknown as Rec;
  const one = (...values: unknown[]): SearchPart[] => values.map((v) => ({ text: txt(v) }));
  const items = (key: string, fields: string[]): SearchPart[] => arr(b[key]).flatMap((it) => fields.map((f) => ({ text: txt(rec(it)[f]) })));

  switch (txt(b.type)) {
    case 'heading':
    case 'paragraph':
    case 'statement':
      return one(b.text);
    case 'quote':
      return one(b.text, b.cite);
    case 'callout':
      return one(b.title, b.text);
    case 'list':
      return one(...arr(b.items));
    case 'image':
      return one(b.alt, b.caption);
    case 'video':
    case 'audio':
      return [{ text: txt(b.caption) }, { text: txt(b.transcript), where: 'transcript' }];
    case 'file':
      return one(b.name);
    case 'page_link':
      return one(b.title);
    case 'accordion':
    case 'tabs':
    case 'process':
      return items('items', ['title', 'text']);
    case 'flashcards':
      return items('cards', ['front', 'back']);
    case 'knowledge_check':
      // The question only — never its answers, feedback or explanation.
      return one(rec(b.question).prompt);
    case 'scenario':
      return [
        ...one(b.title, b.intro),
        ...arr(b.steps).flatMap((st) => [{ text: txt(rec(st).text) }, ...arr(rec(st).choices).map((c) => ({ text: txt(rec(c).text) }))]),
      ];
    case 'labeled_graphic':
      return [{ text: txt(rec(b.image).alt) }, ...items('markers', ['title', 'text'])];
    case 'survey':
      // The survey's title, questions and choices (never anyone's answers).
      return [
        ...one(b.title),
        ...arr(b.questions).flatMap((q) => [
          { text: txt(rec(q).prompt) },
          ...arr(rec(q).options).map((o) => ({ text: txt(rec(o).text) })),
        ]),
      ];
    case 'divider':
    case 'continue':
    case 'embed':
      return [];
    default:
      return null;
  }
}

const MARKS = /\p{M}/gu;

/** Case- and accent-insensitive form ("Café" → "cafe"); curly quotes and long dashes match plain ones. */
export function foldSearch(text: string) {
  return text
    .normalize('NFD')
    .replace(MARKS, '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-');
}

/** Folded text plus, for each folded character, where it came from in the original. */
function foldWithMap(text: string) {
  let folded = '';
  const from: number[] = [];
  const to: number[] = [];

  for (let i = 0; i < text.length; ) {
    const len = (text.codePointAt(i) || 0) > 0xffff ? 2 : 1;
    const f = foldSearch(text.slice(i, i + len));

    for (let k = 0; k < f.length; k++) {
      from.push(i);
      to.push(i + len);
    }

    folded += f;
    i += len;
  }

  return { folded, from, to };
}

export function cleanQuery(q: string) {
  return q.replace(/\s+/g, ' ').trim();
}

interface IndexPart {
  text: string;
  folded: string;
  where?: string;
}

interface IndexEntry {
  blockId: string;
  type: string;
  parts: IndexPart[];
}

interface IndexLesson {
  id: string;
  index: number;
  title: string;
  entries: IndexEntry[];
}

export type SearchIndex = IndexLesson[];

export function buildSearchIndex(lessons: Lesson[], extraText?: (b: Block) => string): SearchIndex {
  const parts = (list: SearchPart[]) =>
    list
      .map((p) => {
        const text = plainSearchText(p.text);

        return { text, folded: foldSearch(text), where: p.where };
      })
      .filter((p) => p.folded);

  return arr(lessons).map((raw, index) => {
    const l = rec(raw);
    const titleText = txt(l.title);
    const entries: IndexEntry[] = [{ blockId: '', type: 'lesson', parts: parts([{ text: titleText }]) }];

    for (const b of arr(l.blocks)) {
      const found = parts(blockSearchParts(b as Block, extraText));

      if (found.length) entries.push({ blockId: txt(rec(b).id), type: txt(rec(b).type), parts: found });
    }

    return { id: txt(l.id), index, title: plainSearchText(titleText) || `Lesson ${index + 1}`, entries };
  });
}

export interface SearchHit {
  key: string;
  lessonId: string;
  lessonIndex: number;
  lessonTitle: string;
  /** "" = the lesson itself (its title). */
  blockId: string;
  label: string;
  pre: string;
  hit: string;
  post: string;
  /** The match is in a video or audio transcript (the jump opens it). */
  inTranscript: boolean;
  /** The folded words that matched (to find them again in the transcript). */
  term: string;
}

const SNIP_BEFORE = 40;
const SNIP_AFTER = 80;

function isLow(code: number) {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** A short piece of text around the match, cut at spaces where possible. */
function snippet(text: string, folded: string, start: number) {
  const map = foldWithMap(text);
  let at = map.folded.indexOf(folded, Math.max(0, start - 8));

  if (at < 0) at = map.folded.indexOf(folded);
  if (at < 0) return { pre: '', hit: '', post: text.length > SNIP_AFTER ? `${text.slice(0, SNIP_AFTER)}…` : text };
  const s = map.from[at];
  let e = map.to[at + folded.length - 1];

  while (e < text.length && /\p{M}/u.test(text[e])) e++;
  let a = Math.max(0, s - SNIP_BEFORE);
  let z = Math.min(text.length, e + SNIP_AFTER);

  if (a > 0) {
    const sp = text.indexOf(' ', a);

    if (sp >= 0 && sp < s) a = sp + 1;
    else if (isLow(text.charCodeAt(a))) a++;
  }

  if (z < text.length) {
    const sp = text.lastIndexOf(' ', z);

    if (sp > e) z = sp;
    else if (isLow(text.charCodeAt(z))) z++;
  }

  return { pre: (a > 0 ? '…' : '') + text.slice(a, s), hit: text.slice(s, e), post: text.slice(e, z) + (z < text.length ? '…' : '') };
}

/** Matches in course order, one per block (its first match). total counts every matching block. */
export function searchCourse(index: SearchIndex, query: string, limit = SEARCH_LIMIT): { hits: SearchHit[]; total: number } {
  const clean = cleanQuery(query);
  const q = foldSearch(clean);
  const hits: SearchHit[] = [];
  let total = 0;

  if (Array.from(clean).length < 2 || !q) return { hits, total };
  // "greet visitor" also finds "greet a visitor": every word of 2+ letters, anywhere in the same block.
  const words = q.split(' ').filter((w) => Array.from(w).length > 1);
  const longest = words.reduce((a, w) => (w.length > a.length ? w : a), '');

  for (const lesson of index) {
    for (const entry of lesson.entries) {
      let term = q;
      let part = entry.parts.find((p) => p.folded.includes(q));

      if (!part && words.length > 1 && words.every((w) => entry.parts.some((p) => p.folded.includes(w)))) {
        term = longest;
        part = entry.parts.find((p) => p.folded.includes(term));
      }
      if (!part) continue;
      total++;
      if (hits.length >= limit) continue;
      const label = (KIND_LABEL[entry.type] || 'Lesson content') + (part.where === 'transcript' ? ' transcript' : '');

      hits.push({
        key: `${lesson.id}:${entry.blockId}`,
        lessonId: lesson.id,
        lessonIndex: lesson.index,
        lessonTitle: lesson.title,
        blockId: entry.blockId,
        label,
        ...snippet(part.text, term, part.folded.indexOf(term)),
        inTranscript: part.where === 'transcript',
        term,
      });
    }
  }

  return { hits, total };
}

// ---------------------------------------------------------------------------
// Search: button + panel
// ---------------------------------------------------------------------------

export interface CourseSearchProps {
  lessons: Lesson[];
  /** The blocks of a lesson the learner sees now (the player's splitAtGate). The others sit after a Continue button
   * nobody has pressed: their results say so, without their words, and the jump goes to that Continue button. */
  shownBlocks?: (lesson: Lesson) => Block[];
  className?: string;
}

/** After a jump: blocks3's jump moves focus to the block (or the Continue button). If focus is still lost, fallback. */
function focusAfterJump(fallback: () => void) {
  let frames = 0;
  const step = () => {
    const a = document.activeElement;

    if (a && a !== document.body && a.isConnected) return;
    if (++frames < 100) window.requestAnimationFrame(step);
    else fallback();
  };

  window.requestAnimationFrame(step);
}

/**
 * The "Search" button for the player header; opens the "Search this course" panel. Lives inside blocks3's JumpArea:
 * locks and jumps come from JumpContext. Nothing shows outside it.
 */
export function CourseSearch({ lessons, shownBlocks, className }: CourseSearchProps) {
  const jump = useContext(JumpContext);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const opener = useRef<HTMLButtonElement | null>(null);

  if (!jump) return null;
  const close = () => {
    setOpen(false);
    window.setTimeout(() => opener.current?.focus(), 0);
  };
  const isBehindContinue = (lessonId: string, blockId: string) => {
    const lesson = lessons.find((l) => l.id === lessonId);

    if (!shownBlocks || !lesson || !lesson.blocks.some((b) => b.id === blockId)) return false;
    return !shownBlocks(lesson).some((b) => b.id === blockId);
  };

  return (
    <>
      <Button
        ref={opener}
        type='button'
        size='sm'
        variant='outline'
        aria-haspopup='dialog'
        className={className}
        data-testid='carehub-learning-search-button'
        onClick={() => setOpen(true)}
      >
        <span aria-hidden='true'>🔍</span> Search
      </Button>
      {open && (
        <SearchPanel
          lessons={lessons}
          isLocked={(lessonId) => jump.locked({ lesson_id: lessonId, block_id: '' })}
          isBehindContinue={isBehindContinue}
          extraText={withBlocks4Search(blocks3SearchText)}
          query={query}
          onQuery={setQuery}
          onClose={close}
          onPick={(h, gated) => {
            setOpen(false);
            if (h.inTranscript && !gated) askTranscript(h.blockId, h.term);
            jump.go({ lesson_id: h.lessonId, block_id: h.blockId });
            focusAfterJump(() => opener.current?.focus());
          }}
        />
      )}
    </>
  );
}

function SearchPanel({
  lessons,
  isLocked,
  isBehindContinue,
  extraText,
  query,
  onQuery,
  onClose,
  onPick,
}: {
  lessons: Lesson[];
  isLocked: (lessonId: string) => boolean;
  isBehindContinue?: (lessonId: string, blockId: string) => boolean;
  extraText?: (b: Block) => string;
  query: string;
  onQuery: (q: string) => void;
  onClose: () => void;
  onPick: (h: SearchHit, gated: boolean) => void;
}) {
  const baseId = useId();
  const panel = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const [term, setTerm] = useState(query);
  const index = useMemo(() => buildSearchIndex(lessons, extraText), [lessons, extraText]);
  const { hits, total } = useMemo(() => searchCourse(index, term), [index, term]);
  const shown = cleanQuery(term);
  const short = Array.from(shown).length < 2;

  useEffect(() => {
    if (term === query) return undefined;
    const t = window.setTimeout(() => setTerm(query), 150);

    return () => window.clearTimeout(t);
  }, [query, term]);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const gatedHit = (h: SearchHit) => Boolean(h.blockId && isBehindContinue && isBehindContinue(h.lessonId, h.blockId));
  const pick = (h: SearchHit) => {
    if (!isLocked(h.lessonId)) onPick(h, gatedHit(h));
  };

  const status = short
    ? ''
    : total === 0
      ? `No results for “${shown}”.`
      : `${total} ${total === 1 ? 'result' : 'results'}${total > hits.length ? `. Showing the first ${hits.length}.` : ''}`;

  const groups: { lessonId: string; lessonIndex: number; title: string; hits: SearchHit[] }[] = [];

  for (const h of hits) {
    const last = groups[groups.length - 1];

    if (last && last.lessonId === h.lessonId) last.hits.push(h);
    else groups.push({ lessonId: h.lessonId, lessonIndex: h.lessonIndex, title: h.lessonTitle, hits: [h] });
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const root = panel.current;

    if (!root) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }

    if (e.key === 'Tab') {
      const all = Array.from(root.querySelectorAll<HTMLElement>('input, button, [tabindex="0"]')).filter((el) => !el.closest('[hidden]'));
      const first = all[0];
      const last = all[all.length - 1];

      if (first && last && e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (first && last && !e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }

      return;
    }

    const list = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-search-result]'));
    const i = list.indexOf(e.target as HTMLButtonElement);
    let next: HTMLElement | null | undefined = null;

    if (e.key === 'ArrowDown') next = e.target === input.current ? list[0] : i >= 0 ? list[Math.min(i + 1, list.length - 1)] : null;
    else if (e.key === 'ArrowUp' && i >= 0) next = i === 0 ? input.current : list[i - 1];
    else if (e.key === 'Home' && i >= 0) next = list[0];
    else if (e.key === 'End' && i >= 0) next = list[list.length - 1];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  return createPortal(
    <div
      className='fixed inset-0 z-[1400] flex justify-end bg-black/30'
      data-testid='carehub-learning-search'
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role='dialog'
        aria-modal='true'
        aria-labelledby={`${baseId}-title`}
        className='flex h-full w-full max-w-[440px] flex-col bg-background-primary text-text-primary shadow-xl'
        onKeyDown={onKeyDown}
      >
        <div className='flex items-center gap-2 border-b border-border-primary px-4 py-3'>
          <h2 id={`${baseId}-title`} className='m-0 min-w-0 flex-1 truncate text-base font-semibold'>
            Search this course
          </h2>
          <button
            type='button'
            aria-label='Close search'
            className='flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-lg text-text-secondary hover:bg-fill-content-hover'
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className='border-b border-border-primary px-4 py-3'>
          <input
            ref={input}
            type='search'
            value={query}
            aria-label='Search this course'
            aria-describedby={`${baseId}-hint`}
            placeholder='Search this course'
            maxLength={200}
            autoComplete='off'
            spellCheck={false}
            className={cn(chInputClass, 'w-full min-w-0')}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              const first = searchCourse(index, query, 1).hits[0];

              if (first) pick(first);
            }}
          />
          <p id={`${baseId}-hint`} className='m-0 mt-1.5 text-xs text-text-tertiary'>
            Looks in lesson titles and everything in the lessons (not the final quiz).
          </p>
          <p role='status' className='m-0 mt-1 min-h-[1rem] text-xs font-medium text-text-secondary'>
            {status}
          </p>
        </div>
        <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2'>
          {short ? (
            <p className='m-0 px-2 py-6 text-center text-sm text-text-tertiary'>Type at least 2 letters to search.</p>
          ) : total === 0 ? (
            <p className='m-0 px-2 py-6 text-center text-sm text-text-tertiary'>Nothing in this course matches. Try fewer or different words.</p>
          ) : (
            <>
              {groups.map((g) => {
                const locked = isLocked(g.lessonId);
                const gid = `${baseId}-g${g.lessonIndex}`;

                return (
                  <div key={g.lessonId} role='group' aria-labelledby={gid} className='mb-2'>
                    <h3 id={gid} className='m-0 px-2 pb-1 pt-2 text-xs font-semibold text-text-secondary'>
                      Lesson {g.lessonIndex + 1} · {g.title}
                    </h3>
                    {locked && (
                      <p id={`${gid}-lock`} className='m-0 px-2 pb-1 text-xs text-text-tertiary'>
                        <span aria-hidden='true'>🔒 </span>
                        {LOCKED_TEXT}
                      </p>
                    )}
                    <ul className='m-0 list-none p-0'>
                      {g.hits.map((h) => {
                        const gated = !locked && gatedHit(h);

                        return (
                          <li key={h.key}>
                            <button
                              type='button'
                              data-search-result=''
                              aria-disabled={locked || undefined}
                              aria-describedby={locked ? `${gid}-lock` : undefined}
                              className={cn(
                                'flex w-full flex-col items-start gap-0.5 rounded-[8px] px-2 py-2 text-left',
                                locked ? 'cursor-not-allowed opacity-60' : 'hover:bg-fill-content-hover'
                              )}
                              onClick={() => pick(h)}
                            >
                              <span className='text-[11px] font-medium uppercase tracking-wide text-text-tertiary'>{h.label}</span>
                              {gated ? (
                                // Not shown yet in the lesson, so its words aren't shown here either.
                                <span className='min-w-0 max-w-full break-words text-sm text-text-secondary'>
                                  <span aria-hidden='true'>⏸ </span>
                                  {GATED_TEXT}
                                </span>
                              ) : (
                                <span className='min-w-0 max-w-full break-words text-sm text-text-primary'>
                                  {h.pre}
                                  <strong className='font-semibold'>{h.hit}</strong>
                                  {h.post}
                                </span>
                              )}
                              <span className='sr-only'>{`, in lesson ${g.lessonIndex + 1}, ${g.title}`}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
              {total > hits.length && <p className='m-0 px-2 py-2 text-xs text-text-tertiary'>Showing the first {hits.length}.</p>}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

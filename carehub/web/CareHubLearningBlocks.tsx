// CareHub Learning: how course blocks look. Shared by the course player and the Studio preview.
// Text supports a tiny markdown subset (**bold**, *italic*, [link](https://…), line breaks) — never raw HTML.
import { createContext, useContext, useMemo, useRef, useState } from 'react';

import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import {
  correctAnswerOf,
  gradeQuestion,
  hashString,
  isAnswered,
  matchingRights,
  presetInfo,
  urlAllowed,
} from './CareHubLearningApi';
import { UUID_RE } from './CareHubCore';
import { chInputClass } from './CareHubUi';

import type { Answer, Block, BlockOf, ChipTone, KcRecord, Preset, Question, ScenarioChoice } from './CareHubLearningApi';

// ---------------------------------------------------------------------------
// Styles that must follow dark mode (Tailwind's dark: variants don't apply in this app)
// ---------------------------------------------------------------------------

export const LEARNING_CSS = `
.chl-chip{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:18px;white-space:nowrap}
.chl-gray{background:rgba(127,127,127,.16);color:inherit}
.chl-blue{background:#dbeafe;color:#1e40af}
.chl-green{background:#dcfce7;color:#166534}
.chl-red{background:#fee2e2;color:#991b1b}
.chl-amber{background:#fef3c7;color:#92400e}
.chl-purple{background:#ede9fe;color:#5b21b6}
:root[data-dark-mode='true'] .chl-blue{background:rgba(59,130,246,.24);color:#bfdbfe}
:root[data-dark-mode='true'] .chl-green{background:rgba(34,197,94,.22);color:#bbf7d0}
:root[data-dark-mode='true'] .chl-red{background:rgba(239,68,68,.24);color:#fecaca}
:root[data-dark-mode='true'] .chl-amber{background:rgba(245,158,11,.22);color:#fde68a}
:root[data-dark-mode='true'] .chl-purple{background:rgba(139,92,246,.26);color:#ddd6fe}
.chl-track{background:rgba(127,127,127,.2)}
.chl-fill{background:#16a34a;transition:width .3s ease}
:root[data-dark-mode='true'] .chl-fill{background:#4ade80}
.chl-box-info,.chl-box-tip,.chl-box-warning,.chl-box-success,.chl-good,.chl-bad{border-width:1px;border-style:solid}
.chl-box-info{background:#eff6ff;border-color:#bfdbfe}
.chl-box-tip{background:#f5f3ff;border-color:#ddd6fe}
.chl-box-warning,.chl-bad{background:#fffbeb;border-color:#fde68a}
.chl-box-success,.chl-good{background:#f0fdf4;border-color:#bbf7d0}
:root[data-dark-mode='true'] .chl-box-info{background:rgba(59,130,246,.12);border-color:rgba(59,130,246,.38)}
:root[data-dark-mode='true'] .chl-box-tip{background:rgba(139,92,246,.14);border-color:rgba(139,92,246,.4)}
:root[data-dark-mode='true'] .chl-box-warning,:root[data-dark-mode='true'] .chl-bad{background:rgba(245,158,11,.12);border-color:rgba(245,158,11,.38)}
:root[data-dark-mode='true'] .chl-box-success,:root[data-dark-mode='true'] .chl-good{background:rgba(34,197,94,.12);border-color:rgba(34,197,94,.38)}
.chl-right{border-color:#22c55e}
.chl-wrong{border-color:#f59e0b}
.chl-mark-right{color:#16a34a}
.chl-mark-wrong{color:#d97706}
:root[data-dark-mode='true'] .chl-mark-right{color:#4ade80}
:root[data-dark-mode='true'] .chl-mark-wrong{color:#fbbf24}
.chl-them{background:rgba(127,127,127,.13)}
.chl-you{background:#e0e7ff}
:root[data-dark-mode='true'] .chl-you{background:rgba(99,102,241,.28)}
.chl-cover-0{background:linear-gradient(135deg,#c7d2fe,#fbcfe8)}
.chl-cover-1{background:linear-gradient(135deg,#bbf7d0,#bae6fd)}
.chl-cover-2{background:linear-gradient(135deg,#fde68a,#fecaca)}
.chl-cover-3{background:linear-gradient(135deg,#ddd6fe,#a5f3fc)}
.chl-cover-4{background:linear-gradient(135deg,#fed7aa,#fef08a)}
.chl-cover-5{background:linear-gradient(135deg,#e9d5ff,#bfdbfe)}
:root[data-dark-mode='true'] .chl-cover{filter:brightness(.62) saturate(.9)}
.chl-clamp2{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.chl-flash{perspective:900px}
.chl-flash-inner{transition:transform .35s ease;transform-style:preserve-3d;position:relative;min-height:140px}
.chl-flash.chl-flipped .chl-flash-inner{transform:rotateY(180deg)}
.chl-flash-face{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;text-align:center;border-radius:12px}
.chl-flash-back{transform:rotateY(180deg)}
@media (prefers-reduced-motion: reduce){.chl-flash-inner,.chl-fill{transition:none}}
`;

export function LearningStyle() {
  return <style data-carehub-learning=''>{LEARNING_CSS}</style>;
}

/** Narrow (phone) layout — set by the player from its own width, so the Studio phone preview is faithful. */
export const NarrowContext = createContext(false);

export function useNarrowLayout() {
  return useContext(NarrowContext);
}

export function Chip({ tone = 'gray', children, title }: { tone?: ChipTone; children: ReactNode; title?: string }) {
  return (
    <span className={cn('chl-chip', `chl-${tone}`)} title={title}>
      {children}
    </span>
  );
}

export function ProgressBar({ percent, className, label }: { percent: number; className?: string; label?: string }) {
  const p = Math.max(0, Math.min(100, Math.round(Number.isFinite(percent) ? percent : 0)));

  return (
    <div
      className={cn('chl-track h-1.5 w-full overflow-hidden rounded-full', className)}
      role='progressbar'
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={p}
      aria-label={label || 'Progress'}
    >
      <div className='chl-fill h-full rounded-full' style={{ width: `${p}%` }} />
    </div>
  );
}

export function CourseCover({ cover, preset, seed, className }: { cover: string; preset: Preset; seed: string; className?: string }) {
  const [broken, setBroken] = useState('');

  if (cover && urlAllowed(cover) && broken !== cover) {
    return <img src={cover} alt='' loading='lazy' className={cn('h-full w-full object-cover', className)} onError={() => setBroken(cover)} />;
  }

  return (
    <div
      aria-hidden='true'
      className={cn(`chl-cover chl-cover-${hashString(seed) % 6} flex h-full w-full items-center justify-center text-3xl`, className)}
    >
      {presetInfo(preset).emoji}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rich text
// ---------------------------------------------------------------------------

const INLINE_SOURCE = String.raw`\*\*([^*\n]+?)\*\*|\*([^*\n]+?)\*|\[([^\]\n]+)\]\(([^)\s]+)\)`;

export function safeHref(url: string): string | null {
  const u = url.trim();

  if (/^https?:\/\/\S+$/i.test(u) || /^mailto:\S+$/i.test(u)) return u;
  if (u.startsWith('/') && !u.startsWith('//')) return u;
  return null;
}

function inline(text: string, key: string, depth = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const re = new RegExp(INLINE_SOURCE, 'g');
  let last = 0;
  let n = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;

    if (m[1] !== undefined) {
      out.push(<strong key={k}>{depth < 3 ? inline(m[1], k, depth + 1) : m[1]}</strong>);
    } else if (m[2] !== undefined) {
      out.push(<em key={k}>{depth < 3 ? inline(m[2], k, depth + 1) : m[2]}</em>);
    } else {
      const href = safeHref(m[4] || '');

      out.push(
        href ? (
          <a key={k} href={href} target='_blank' rel='noopener noreferrer' className='text-text-action underline underline-offset-2'>
            {m[3]}
          </a>
        ) : (
          m[3]
        )
      );
    }

    last = re.lastIndex;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichText({ text, className }: { text: string; className?: string }) {
  const nodes = useMemo(() => inline(text || '', 'rt'), [text]);

  return <span className={cn('whitespace-pre-wrap break-words', className)}>{nodes}</span>;
}

// ---------------------------------------------------------------------------
// Questions (knowledge checks and the final quiz)
// ---------------------------------------------------------------------------

export function coerceAnswer(q: Question, raw: unknown): Answer | undefined {
  if (q.kind === 'multiple') return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : undefined;
  if (q.kind === 'matching') {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const m: Record<string, string> = {};

    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === 'string') m[k] = v;
    return m;
  }

  return typeof raw === 'string' ? raw : undefined;
}

export function QuestionView({
  q,
  value,
  onChange,
  disabled,
  reveal,
  name,
  number,
}: {
  q: Question;
  value: Answer | undefined;
  onChange: (a: Answer) => void;
  disabled?: boolean;
  /** The correct answer — when given, right and wrong choices are marked. */
  reveal?: Answer;
  name: string;
  number?: number;
}) {
  const narrow = useNarrowLayout();
  const rights = useMemo(() => (q.kind === 'matching' ? matchingRights(q) : []), [q]);
  const multiple = q.kind === 'multiple';
  const hint =
    q.kind === 'multiple' ? 'Choose all that apply.' : q.kind === 'matching' ? 'Match each item with the right answer.' : '';

  return (
    <fieldset className='min-w-0'>
      <legend className='mb-1 text-[15px] font-medium leading-snug text-text-primary'>
        {number !== undefined && <span className='mr-1 text-text-tertiary'>{number}.</span>}
        <RichText text={q.prompt || 'Untitled question'} />
      </legend>
      {hint && <div className='mb-2 text-xs text-text-tertiary'>{hint}</div>}
      {q.kind === 'matching' ? (
        <div className='mt-2 flex flex-col gap-2'>
          {q.pairs.map((p) => {
            const current = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
            const picked = current[p.id] || '';
            const want = reveal && typeof reveal === 'object' && !Array.isArray(reveal) ? reveal[p.id] : undefined;
            const mark = want === undefined ? '' : picked === want ? 'right' : 'wrong';

            return (
              <div
                key={p.id}
                className={cn(
                  'flex gap-2 rounded-[10px] border px-3 py-2.5',
                  narrow ? 'flex-col' : 'items-center',
                  mark === 'right' ? 'chl-right' : mark === 'wrong' ? 'chl-wrong' : 'border-border-primary'
                )}
              >
                <div className='min-w-0 flex-1 text-sm'>
                  <RichText text={p.left || '…'} />
                </div>
                <select
                  aria-label={`Match for ${p.left || 'this item'}`}
                  className={cn(chInputClass, narrow ? 'w-full' : 'w-[48%]')}
                  value={picked}
                  disabled={disabled}
                  onChange={(e) => onChange({ ...current, [p.id]: e.target.value })}
                >
                  <option value=''>Choose…</option>
                  {rights.map((r) => (
                    <option key={r.token} value={r.token}>
                      {r.text}
                    </option>
                  ))}
                </select>
                {mark === 'wrong' && (
                  <div className='text-xs text-text-secondary'>
                    <span className='chl-mark-wrong'>×</span> Answer: {rights.find((r) => r.token === want)?.text || '—'}
                  </div>
                )}
                {mark === 'right' && (
                  <span className='chl-mark-right text-sm' aria-label='Correct'>
                    ✓
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className='mt-2 flex flex-col gap-2' role={multiple ? 'group' : 'radiogroup'}>
          {q.options.map((o) => {
            const selected = multiple ? Array.isArray(value) && value.includes(o.id) : value === o.id;
            const isRight = reveal !== undefined && (Array.isArray(reveal) ? reveal.includes(o.id) : reveal === o.id);
            const mark = reveal === undefined ? '' : isRight ? 'right' : selected ? 'wrong' : '';

            return (
              <label
                key={o.id}
                className={cn(
                  'flex items-start gap-2.5 rounded-[10px] border px-3 py-2.5 text-sm',
                  disabled ? 'cursor-default' : 'cursor-pointer hover:bg-fill-content-hover',
                  mark === 'right' ? 'chl-right' : mark === 'wrong' ? 'chl-wrong' : selected ? 'border-border-theme-thick' : 'border-border-primary',
                  selected && 'bg-fill-content-hover'
                )}
              >
                <input
                  type={multiple ? 'checkbox' : 'radio'}
                  name={name}
                  className='mt-0.5 shrink-0'
                  checked={selected}
                  disabled={disabled}
                  onChange={() => {
                    if (multiple) {
                      const list = Array.isArray(value) ? value : [];

                      onChange(list.includes(o.id) ? list.filter((x) => x !== o.id) : [...list, o.id]);
                    } else {
                      onChange(o.id);
                    }
                  }}
                />
                <span className='min-w-0 flex-1'>
                  <RichText text={o.text || '…'} />
                </span>
                {mark === 'right' && (
                  <span className='chl-mark-right' aria-label='Correct answer'>
                    ✓
                  </span>
                )}
                {mark === 'wrong' && (
                  <span className='chl-mark-wrong' aria-label='Not the right answer'>
                    ×
                  </span>
                )}
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

export function Feedback({ good, title, text, explanation }: { good: boolean; title: string; text?: string; explanation?: string }) {
  return (
    <div role='status' className={cn('mt-3 rounded-[10px] px-3 py-2.5 text-sm', good ? 'chl-good' : 'chl-bad')}>
      <div className='font-semibold'>
        <span aria-hidden='true'>{good ? '✅ ' : '💡 '}</span>
        {title}
      </div>
      {text && (
        <div className='mt-1'>
          <RichText text={text} />
        </div>
      )}
      {explanation && (
        <div className='mt-1 text-text-secondary'>
          <RichText text={explanation} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export interface BlockCtx {
  workspaceId: string;
  preview: boolean;
  /** Saved knowledge-check answers (block id → answer). */
  kc: Record<string, KcRecord>;
  /** Blocks already completed (finished scenarios, clicked Continue buttons). */
  done: Set<string>;
  onKcAnswer: (block: BlockOf<'knowledge_check'>, answer: Answer, correct: boolean) => void;
  onScenarioDone: (block: BlockOf<'scenario'>) => void;
  onMedia: (blockId: string, playing: boolean) => void;
}

function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div className='rounded-[10px] border border-dashed border-border-primary px-4 py-6 text-center text-sm text-text-tertiary'>{children}</div>
  );
}

/** YouTube / Vimeo / Loom links → their embeddable player address. */
export function videoEmbedUrl(url: string): string | null {
  const u = url.trim();
  let m =
    u.match(/^https?:\/\/(?:www\.|m\.)?youtube\.com\/watch\?(?:[^#]*&)?v=([\w-]{6,})/i) ||
    u.match(/^https?:\/\/youtu\.be\/([\w-]{6,})/i) ||
    u.match(/^https?:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/(?:embed|shorts|live)\/([\w-]{6,})/i);

  if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  m = u.match(/^https?:\/\/(?:www\.)?vimeo\.com\/(?:video\/)?(\d+)(?:\/([0-9a-f]{6,}))?/i);
  if (m) return `https://player.vimeo.com/video/${m[1]}${m[2] ? `?h=${m[2]}` : ''}`;
  m = u.match(/^https?:\/\/player\.vimeo\.com\/video\/(\d+)(\?[^#\s]*)?/i);
  if (m) return `https://player.vimeo.com/video/${m[1]}${m[2] || ''}`;
  m = u.match(/^https?:\/\/(?:www\.)?loom\.com\/(?:share|embed)\/([\w-]+)/i);
  if (m) return `https://www.loom.com/embed/${m[1]}`;
  return null;
}

function fileName(url: string) {
  const clean = url.split(/[?#]/)[0];
  const last = clean.split('/').filter(Boolean).pop() || '';

  try {
    return decodeURIComponent(last) || 'File';
  } catch {
    return last || 'File';
  }
}

function sameOrigin(url: string) {
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

const TONE_EMOJI: Record<string, string> = { info: 'ℹ️', tip: '💡', warning: '⚠️', success: '✅' };

export function BlockView({ block, ctx }: { block: Block; ctx: BlockCtx }) {
  switch (block.type) {
    case 'heading': {
      if (!block.text.trim()) return null;
      if (block.level === 1) return <h2 className='text-2xl font-semibold leading-tight'><RichText text={block.text} /></h2>;
      if (block.level === 3) return <h4 className='text-lg font-semibold leading-snug'><RichText text={block.text} /></h4>;
      return <h3 className='text-xl font-semibold leading-snug'><RichText text={block.text} /></h3>;
    }

    case 'paragraph':
      if (!block.text.trim()) return null;
      return (
        <p className='text-[15px] leading-relaxed'>
          <RichText text={block.text} />
        </p>
      );
    case 'statement':
      if (!block.text.trim()) return null;
      return (
        <div className='border-y-2 border-border-primary px-2 py-5 text-center text-xl font-semibold leading-snug'>
          <RichText text={block.text} />
        </div>
      );
    case 'quote':
      if (!block.text.trim()) return null;
      return (
        <blockquote className='m-0 border-l-4 border-border-primary pl-4'>
          <div className='text-lg italic leading-relaxed'>
            <RichText text={block.text} />
          </div>
          {block.cite.trim() && <div className='mt-1 text-sm text-text-tertiary'>— {block.cite}</div>}
        </blockquote>
      );
    case 'callout':
      if (!block.title.trim() && !block.text.trim()) return null;
      return (
        <div className={cn('flex gap-3 rounded-[12px] px-4 py-3', `chl-box-${block.tone}`)}>
          <span className='text-lg leading-6' aria-hidden='true'>
            {TONE_EMOJI[block.tone] || 'ℹ️'}
          </span>
          <div className='min-w-0 flex-1 text-[15px] leading-relaxed'>
            {block.title.trim() && <div className='font-semibold'>{block.title}</div>}
            {block.text.trim() && <RichText text={block.text} />}
          </div>
        </div>
      );
    case 'list': {
      const items = block.items.filter((x) => x.trim());

      if (!items.length) return null;
      if (block.style === 'number') {
        return (
          <ol className='list-decimal space-y-1 pl-6 text-[15px] leading-relaxed'>
            {items.map((it, i) => (
              <li key={i}>
                <RichText text={it} />
              </li>
            ))}
          </ol>
        );
      }

      if (block.style === 'check') {
        return (
          <ul className='space-y-1.5 text-[15px] leading-relaxed'>
            {items.map((it, i) => (
              <li key={i} className='flex gap-2'>
                <span className='chl-mark-right font-semibold' aria-hidden='true'>
                  ✓
                </span>
                <span className='min-w-0 flex-1'>
                  <RichText text={it} />
                </span>
              </li>
            ))}
          </ul>
        );
      }

      return (
        <ul className='list-disc space-y-1 pl-6 text-[15px] leading-relaxed'>
          {items.map((it, i) => (
            <li key={i}>
              <RichText text={it} />
            </li>
          ))}
        </ul>
      );
    }

    case 'divider':
      return <hr className='my-1 border-t border-border-primary' />;
    case 'image':
      if (!urlAllowed(block.url)) return ctx.preview ? <Placeholder>Add an image link to show the picture here.</Placeholder> : null;
      return (
        <figure className={cn('mx-auto my-0 w-full', block.width === 'small' ? 'max-w-[320px]' : block.width === 'medium' ? 'max-w-[560px]' : '')}>
          <img src={block.url} alt={block.alt} loading='lazy' className='w-full rounded-[10px]' />
          {block.caption.trim() && (
            <figcaption className='mt-1.5 text-center text-xs text-text-tertiary'>
              <RichText text={block.caption} />
            </figcaption>
          )}
        </figure>
      );
    case 'video':
      return <VideoBlock block={block} ctx={ctx} />;
    case 'audio':
      if (!urlAllowed(block.url)) return ctx.preview ? <Placeholder>Add an audio link to play it here.</Placeholder> : null;
      return (
        <figure className='m-0'>
          <audio
            src={block.url}
            controls
            preload='metadata'
            className='w-full'
            onPlay={() => ctx.onMedia(block.id, true)}
            onPause={() => ctx.onMedia(block.id, false)}
            onEnded={() => ctx.onMedia(block.id, false)}
          />
          {block.caption.trim() && (
            <figcaption className='mt-1 text-xs text-text-tertiary'>
              <RichText text={block.caption} />
            </figcaption>
          )}
        </figure>
      );
    case 'file':
      if (!urlAllowed(block.url)) return ctx.preview ? <Placeholder>Add a file link to show it here.</Placeholder> : null;
      return (
        <a
          href={block.url}
          target='_blank'
          rel='noopener noreferrer'
          className='flex items-center gap-3 rounded-[12px] border border-border-primary px-4 py-3 hover:bg-fill-content-hover'
        >
          <span className='text-xl' aria-hidden='true'>
            📎
          </span>
          <span className='min-w-0 flex-1 truncate text-sm font-medium'>{block.name.trim() || fileName(block.url)}</span>
          <span className='shrink-0 text-xs text-text-tertiary'>Open ↗</span>
        </a>
      );
    case 'embed': {
      if (!/^https:\/\/\S+$/i.test(block.url.trim())) {
        return ctx.preview ? <Placeholder>Add an https:// link to embed it here.</Placeholder> : null;
      }

      const own = sameOrigin(block.url);

      return (
        <iframe
          src={block.url.trim()}
          title='Embedded content'
          loading='lazy'
          referrerPolicy='no-referrer'
          sandbox={own ? 'allow-scripts allow-popups allow-forms' : 'allow-scripts allow-same-origin allow-popups allow-forms allow-presentation'}
          className='w-full rounded-[10px] border border-border-primary'
          style={{ height: Math.max(120, Math.min(2000, block.height || 480)) }}
        />
      );
    }

    case 'accordion':
      return <AccordionBlock block={block} />;
    case 'tabs':
      return <TabsBlock block={block} />;
    case 'flashcards':
      return <FlashcardsBlock block={block} />;
    case 'knowledge_check':
      return <KnowledgeCheck block={block} ctx={ctx} />;
    case 'scenario':
      return <ScenarioBlock block={block} ctx={ctx} />;
    case 'page_link': {
      const ok = UUID_RE.test(block.view_id) && Boolean(ctx.workspaceId);

      if (!ok) return ctx.preview ? <Placeholder>Pick a Care Hub page to link to.</Placeholder> : null;
      return (
        <a
          href={`/app/${ctx.workspaceId}/${block.view_id}`}
          target='_blank'
          rel='noopener'
          className='flex items-center gap-3 rounded-[12px] border border-border-primary px-4 py-3 hover:bg-fill-content-hover'
        >
          <span className='text-xl' aria-hidden='true'>
            📄
          </span>
          <span className='min-w-0 flex-1'>
            <span className='block truncate text-sm font-medium'>{block.title.trim() || 'Open page'}</span>
            <span className='block text-xs text-text-tertiary'>Care Hub page · opens in a new tab</span>
          </span>
          <span className='shrink-0 text-xs text-text-tertiary'>↗</span>
        </a>
      );
    }

    case 'continue':
    default:
      return null;
  }
}

function VideoBlock({ block, ctx }: { block: BlockOf<'video'>; ctx: BlockCtx }) {
  const embed = videoEmbedUrl(block.url);
  const caption = block.caption.trim() ? (
    <figcaption className='mt-1.5 text-xs text-text-tertiary'>
      <RichText text={block.caption} />
    </figcaption>
  ) : null;

  if (embed) {
    return (
      <figure className='m-0'>
        <div className='relative w-full overflow-hidden rounded-[10px] bg-black' style={{ paddingTop: '56.25%' }}>
          <iframe
            src={embed}
            title={block.caption.trim() || 'Video'}
            className='absolute inset-0 h-full w-full'
            allow='autoplay; fullscreen; picture-in-picture; encrypted-media'
            allowFullScreen
          />
        </div>
        {caption}
      </figure>
    );
  }

  if (!urlAllowed(block.url)) return ctx.preview ? <Placeholder>Add a video link (YouTube, Vimeo, Loom or a video file).</Placeholder> : null;
  return (
    <figure className='m-0'>
      <video
        src={block.url}
        controls
        preload='metadata'
        playsInline
        className='w-full rounded-[10px] bg-black'
        onPlay={() => ctx.onMedia(block.id, true)}
        onPause={() => ctx.onMedia(block.id, false)}
        onEnded={() => ctx.onMedia(block.id, false)}
      />
      {caption}
    </figure>
  );
}

function AccordionBlock({ block }: { block: BlockOf<'accordion'> }) {
  const [open, setOpen] = useState<string[]>([]);
  const items = block.items.filter((it) => it.title.trim() || it.text.trim());

  if (!items.length) return null;
  return (
    <div className='overflow-hidden rounded-[12px] border border-border-primary'>
      {items.map((it, i) => {
        const isOpen = open.includes(it.id);

        return (
          <div key={it.id} className={cn(i > 0 && 'border-t border-border-primary')}>
            <button
              type='button'
              aria-expanded={isOpen}
              className='flex w-full items-center gap-3 px-4 py-3 text-left text-[15px] font-medium hover:bg-fill-content-hover'
              onClick={() => setOpen((list) => (list.includes(it.id) ? list.filter((x) => x !== it.id) : [...list, it.id]))}
            >
              <span className='min-w-0 flex-1'>{it.title.trim() || 'Untitled'}</span>
              <span aria-hidden='true' className='text-lg text-text-tertiary'>
                {isOpen ? '−' : '+'}
              </span>
            </button>
            {isOpen && (
              <div className='px-4 pb-4 text-[15px] leading-relaxed'>
                <RichText text={it.text} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TabsBlock({ block }: { block: BlockOf<'tabs'> }) {
  const items = block.items.filter((it) => it.title.trim() || it.text.trim());
  const [active, setActive] = useState(0);
  const current = items[Math.min(active, items.length - 1)];

  if (!items.length || !current) return null;
  return (
    <div className='rounded-[12px] border border-border-primary'>
      <div role='tablist' className='flex gap-1 overflow-x-auto border-b border-border-primary px-2 pt-2'>
        {items.map((it, i) => (
          <button
            key={it.id}
            type='button'
            role='tab'
            aria-selected={it.id === current.id}
            className={cn(
              'shrink-0 rounded-t-[8px] px-3 py-2 text-sm',
              it.id === current.id ? 'bg-fill-content-hover font-semibold text-text-primary' : 'text-text-secondary hover:text-text-primary'
            )}
            onClick={() => setActive(i)}
          >
            {it.title.trim() || `Tab ${i + 1}`}
          </button>
        ))}
      </div>
      <div role='tabpanel' className='px-4 py-3 text-[15px] leading-relaxed'>
        <RichText text={current.text} />
      </div>
    </div>
  );
}

function FlashcardsBlock({ block }: { block: BlockOf<'flashcards'> }) {
  const narrow = useNarrowLayout();
  const [flipped, setFlipped] = useState<string[]>([]);
  const cards = block.cards.filter((c) => c.front.trim() || c.back.trim());

  if (!cards.length) return null;
  return (
    <div>
      <div className='mb-2 text-xs text-text-tertiary'>Tap a card to flip it.</div>
      <div className={cn('grid gap-3', narrow ? 'grid-cols-1' : cards.length === 1 ? 'grid-cols-1' : cards.length === 2 || cards.length === 4 ? 'grid-cols-2' : 'grid-cols-3')}>
        {cards.map((c) => {
          const isFlipped = flipped.includes(c.id);

          return (
            <button
              key={c.id}
              type='button'
              aria-pressed={isFlipped}
              aria-label={isFlipped ? `Back: ${c.back}` : `Front: ${c.front}. Tap to flip.`}
              className={cn('chl-flash w-full text-left', isFlipped && 'chl-flipped')}
              onClick={() => setFlipped((list) => (list.includes(c.id) ? list.filter((x) => x !== c.id) : [...list, c.id]))}
            >
              <div className='chl-flash-inner'>
                <div className='chl-flash-face border border-border-primary bg-background-primary'>
                  <div className='text-[15px] font-semibold'>
                    <RichText text={c.front || '…'} />
                  </div>
                  <div className='mt-2 text-[11px] text-text-tertiary'>Tap to flip</div>
                </div>
                <div className='chl-flash-face chl-flash-back border border-border-primary bg-fill-content-hover'>
                  <div className='text-sm leading-relaxed'>
                    <RichText text={c.back || '…'} />
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function KnowledgeCheck({ block, ctx }: { block: BlockOf<'knowledge_check'>; ctx: BlockCtx }) {
  const q = block.question;
  const saved = ctx.kc[block.id];
  const [answer, setAnswer] = useState<Answer | undefined>(() => (saved ? coerceAnswer(q, saved.answer) : undefined));
  const [checked, setChecked] = useState(Boolean(saved && saved.answer !== undefined));
  const correct = checked && gradeQuestion(q, answer);

  return (
    <div className='rounded-[12px] border border-border-primary p-4'>
      <div className='mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary'>Knowledge check</div>
      <QuestionView
        q={q}
        name={`kc-${block.id}`}
        value={answer}
        disabled={checked}
        reveal={checked ? correctAnswerOf(q) : undefined}
        onChange={(a) => setAnswer(a)}
      />
      {checked ? (
        <>
          <Feedback
            good={correct}
            title={correct ? 'That’s right!' : 'Not quite.'}
            text={correct ? q.feedback_correct : q.feedback_incorrect}
            explanation={q.explanation}
          />
          <div className='mt-3'>
            <Button type='button' size='sm' variant='outline' onClick={() => setChecked(false)}>
              Try again
            </Button>
          </div>
        </>
      ) : (
        <div className='mt-3'>
          <Button
            type='button'
            size='sm'
            disabled={!isAnswered(q, answer)}
            onClick={() => {
              if (answer === undefined) return;
              setChecked(true);
              ctx.onKcAnswer(block, answer, gradeQuestion(q, answer));
            }}
          >
            Check answer
          </Button>
        </div>
      )}
    </div>
  );
}

function ScenarioBlock({ block, ctx }: { block: BlockOf<'scenario'>; ctx: BlockCtx }) {
  const steps = useMemo(() => new Map(block.steps.map((s) => [s.id, s])), [block.steps]);
  const first = steps.has(block.start) ? block.start : block.steps[0]?.id || '';
  const [history, setHistory] = useState<{ stepId: string; choice: ScenarioChoice }[]>([]);
  const [current, setCurrent] = useState(first);
  const [picked, setPicked] = useState<ScenarioChoice | null>(null);
  const [ended, setEnded] = useState(false);
  const reported = useRef(ctx.done.has(block.id));
  const step = steps.get(current);

  if (!block.steps.length) return ctx.preview ? <Placeholder>Add steps to this scenario.</Placeholder> : null;
  const finish = () => {
    setEnded(true);
    if (!reported.current) {
      reported.current = true;
      ctx.onScenarioDone(block);
    }
  };

  const goOn = () => {
    if (!picked) return;
    const nextHistory = [...history, { stepId: current, choice: picked }];

    setHistory(nextHistory);
    setPicked(null);
    if (!picked.next || !steps.has(picked.next) || nextHistory.length > 200) finish();
    else setCurrent(picked.next);
  };

  const restart = () => {
    setHistory([]);
    setPicked(null);
    setEnded(false);
    setCurrent(first);
  };

  const good = history.filter((h) => h.choice.good).length;
  const bubble = (who: 'them' | 'you', text: string, key: string) => (
    <div key={key} className={cn('flex', who === 'you' ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[85%] rounded-[14px] px-3 py-2 text-[15px] leading-relaxed', who === 'you' ? 'chl-you' : 'chl-them')}>
        <RichText text={text || '…'} />
      </div>
    </div>
  );

  return (
    <div className='rounded-[12px] border border-border-primary p-4'>
      <div className='mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary'>
        <span aria-hidden='true'>💬 </span>Scenario
      </div>
      {block.title.trim() && <div className='text-lg font-semibold'>{block.title}</div>}
      {block.intro.trim() && (
        <div className='mt-1 text-[15px] leading-relaxed text-text-secondary'>
          <RichText text={block.intro} />
        </div>
      )}
      {ctx.done.has(block.id) && !history.length && !picked && !ended && (
        <div className='mt-2 text-xs text-text-tertiary'>You finished this scenario before — try it again any time.</div>
      )}
      <div className='mt-3 flex flex-col gap-2' aria-live='polite'>
        {history.map((h, i) => {
          const s = steps.get(h.stepId);

          return (
            <div key={`${h.stepId}-${i}`} className='flex flex-col gap-2'>
              {bubble('them', s?.text || '', 't')}
              {bubble('you', h.choice.text, 'y')}
              {h.choice.feedback.trim() && (
                <div className={cn('rounded-[10px] px-3 py-2 text-xs', h.choice.good ? 'chl-good' : 'chl-bad')}>
                  <RichText text={h.choice.feedback} />
                </div>
              )}
            </div>
          );
        })}
        {!ended && step && (
          <>
            {bubble('them', step.text, 'current')}
            {picked ? (
              <>
                {bubble('you', picked.text, 'picked')}
                <Feedback good={picked.good} title={picked.good ? 'Good choice' : 'Think about it'} text={picked.feedback} />
                <div>
                  <Button type='button' size='sm' onClick={goOn}>
                    {picked.next && steps.has(picked.next) ? 'Continue' : 'See how it ends'}
                  </Button>
                </div>
              </>
            ) : (
              <div className='mt-1 flex flex-col gap-2'>
                <div className='text-xs text-text-tertiary'>What do you say?</div>
                {step.choices.map((c) => (
                  <button
                    key={c.id}
                    type='button'
                    className='rounded-[10px] border border-border-primary px-3 py-2.5 text-left text-sm hover:bg-fill-content-hover'
                    onClick={() => setPicked(c)}
                  >
                    <RichText text={c.text || '…'} />
                  </button>
                ))}
                {!step.choices.length && (
                  <div>
                    <Button type='button' size='sm' onClick={finish}>
                      Finish
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
        {(ended || (!step && !picked)) && (
          <div className='mt-1 rounded-[10px] bg-fill-content-hover px-3 py-3 text-sm'>
            <div className='font-semibold'>
              <span aria-hidden='true'>🏁 </span>End of the scenario
            </div>
            {history.length > 0 && (
              <div className='mt-0.5 text-text-secondary'>
                You made {good} good {good === 1 ? 'choice' : 'choices'} out of {history.length}.
              </div>
            )}
            <div className='mt-2 flex gap-2'>
              <Button type='button' size='sm' variant='outline' onClick={restart}>
                Try again
              </Button>
              {!ended && (
                <Button type='button' size='sm' onClick={finish}>
                  Done
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

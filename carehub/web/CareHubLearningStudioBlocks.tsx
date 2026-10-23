// CareHub Learning Studio: the block library, form fields, uploads, drag to reorder, and the editor for each
// kind of block and question.
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';

import type { DragEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';

import { executeAPIRequest, getAxios } from '@/application/services/js-services/http/core';
import { cn } from '@/lib/utils';

import { chErrorText } from './CareHubCore';
import { clampInt, EMBED_SITES, embedKind, newId, setQuestionKind, urlAllowed } from './CareHubLearningApi';
import { isCareHubFile, ProgressBar, useFileSrc, videoEmbedUrl } from './CareHubLearningBlocks';
import { filterPages, useSharablePages } from './CareHubSharePage';
import { CareHubModal, chInputClass, ChSelect } from './CareHubUi';

import type {
  Block,
  BlockOf,
  BlockType,
  FlashCard,
  ImageWidth,
  ListStyle,
  QOption,
  QPair,
  Question,
  QuestionKind,
  ScenarioChoice,
  ScenarioStep,
  TextItem,
  Tone,
} from './CareHubLearningApi';

// ---------------------------------------------------------------------------
// The block library
// ---------------------------------------------------------------------------

export const BLOCK_INFO: Record<BlockType, { emoji: string; label: string; hint: string }> = {
  heading: { emoji: '🔠', label: 'Heading', hint: 'A title for a section' },
  paragraph: { emoji: '📝', label: 'Text', hint: 'A paragraph of text' },
  statement: { emoji: '📣', label: 'Statement', hint: 'One big sentence that stands out' },
  quote: { emoji: '💭', label: 'Quote', hint: 'Someone’s words, with who said them' },
  callout: { emoji: '💡', label: 'Callout', hint: 'A tip, note or warning in a colored box' },
  list: { emoji: '📋', label: 'List', hint: 'Bullets, numbers or a checklist' },
  divider: { emoji: '➖', label: 'Divider', hint: 'A line between sections' },
  image: { emoji: '🖼️', label: 'Image', hint: 'A picture you upload or link to' },
  video: { emoji: '🎬', label: 'Video', hint: 'Upload a video, or a YouTube, Vimeo or Loom link' },
  audio: { emoji: '🎧', label: 'Audio', hint: 'A sound clip you upload or link to' },
  file: { emoji: '📎', label: 'File', hint: 'A file people can download' },
  embed: { emoji: '🧩', label: 'Embed', hint: 'Show a Google Doc or Form, Canva, Miro, Figma and more' },
  accordion: { emoji: '🔽', label: 'Accordion', hint: 'Sections people open one at a time' },
  tabs: { emoji: '🗂️', label: 'Tabs', hint: 'Sections side by side' },
  process: { emoji: '👣', label: 'Process', hint: 'Steps people go through one at a time' },
  flashcards: { emoji: '🃏', label: 'Flashcards', hint: 'Cards people flip to test themselves' },
  continue: { emoji: '⏬', label: 'Continue button', hint: 'Shows the rest of the lesson one step at a time' },
  knowledge_check: { emoji: '✅', label: 'Knowledge check', hint: 'A practice question with instant feedback' },
  scenario: { emoji: '💬', label: 'Scenario', hint: 'A branching conversation to practice' },
  page_link: { emoji: '🔗', label: 'Care Hub page', hint: 'A link to a page in this workspace' },
};

export const BLOCK_GROUPS: { title: string; types: BlockType[] }[] = [
  { title: 'Text', types: ['heading', 'paragraph', 'statement', 'quote', 'callout', 'list', 'divider'] },
  { title: 'Media', types: ['image', 'video', 'audio', 'file', 'embed'] },
  { title: 'Interactive', types: ['knowledge_check', 'scenario', 'flashcards', 'accordion', 'tabs', 'process', 'continue'] },
  { title: 'Links', types: ['page_link'] },
];

export function BlockLibrary({ onPick, onClose }: { onPick: (type: BlockType) => void; onClose: () => void }) {
  return (
    <CareHubModal title='Add a block' wide onClose={onClose} testId='carehub-learning-block-library'>
      <div className='flex flex-col gap-4'>
        {BLOCK_GROUPS.map((g) => (
          <div key={g.title}>
            <div className='mb-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary'>{g.title}</div>
            <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
              {g.types.map((t) => (
                <button
                  key={t}
                  type='button'
                  onClick={() => onPick(t)}
                  className='flex items-start gap-2.5 rounded-[10px] border border-border-primary px-3 py-2.5 text-left hover:bg-fill-content-hover'
                  data-testid={`carehub-learning-add-${t}`}
                >
                  <span className='text-lg leading-6' aria-hidden='true'>
                    {BLOCK_INFO[t].emoji}
                  </span>
                  <span className='min-w-0 flex-1'>
                    <span className='block text-sm font-medium'>{BLOCK_INFO[t].label}</span>
                    <span className='block text-xs text-text-tertiary'>{BLOCK_INFO[t].hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </CareHubModal>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

export const FORMAT_HINT = 'Tip: **bold**, *italic*, [link text](https://…)';
export const SAMPLE_PICTURES = [1, 2, 3, 4, 5, 6].map((n) => `/covers/m_cover_image_${n}.png`);

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className='text-xs font-medium text-text-secondary'>{label}</span>
      {children}
      {hint && <span className='text-xs text-text-tertiary'>{hint}</span>}
    </label>
  );
}

export function TextLine({
  value,
  onChange,
  placeholder,
  ariaLabel,
  maxLength = 500,
  className,
  type = 'text',
  autoFocus,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  maxLength?: number;
  className?: string;
  type?: 'text' | 'url' | 'search';
  autoFocus?: boolean;
  id?: string;
}) {
  return (
    <input
      id={id}
      type={type}
      autoFocus={autoFocus}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      maxLength={maxLength}
      className={cn(chInputClass, 'w-full min-w-0', className)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function TextBox({
  value,
  onChange,
  placeholder,
  ariaLabel,
  rows = 3,
  maxLength = 20000,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  rows?: number;
  maxLength?: number;
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      placeholder={placeholder}
      aria-label={ariaLabel}
      maxLength={maxLength}
      className={cn(chInputClass, 'w-full min-w-0 resize-y leading-relaxed')}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={cn('flex items-start gap-2 text-sm', disabled ? 'opacity-60' : 'cursor-pointer')}>
      <input type='checkbox' className='mt-[3px] shrink-0' checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className='min-w-0 flex-1'>
        {label}
        {hint && <span className='block text-xs text-text-tertiary'>{hint}</span>}
      </span>
    </label>
  );
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  ariaLabel,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  ariaLabel?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      type='number'
      inputMode='numeric'
      min={min}
      max={max}
      aria-label={ariaLabel}
      className={cn(chInputClass, 'w-24', className)}
      value={draft ?? String(value)}
      onChange={(e) => {
        const raw = e.target.value;
        const n = Number(raw);

        setDraft(raw);
        if (raw.trim() !== '' && Number.isFinite(n)) onChange(clampInt(n, min, max));
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

export function CopyIcon() {
  return (
    <svg width='14' height='14' viewBox='0 0 16 16' fill='none' aria-hidden='true' focusable='false'>
      <rect x='5.5' y='5.5' width='8' height='8' rx='1.5' stroke='currentColor' strokeWidth='1.5' />
      <path d='M10.5 3.5V3A1.5 1.5 0 0 0 9 1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h.5' stroke='currentColor' strokeWidth='1.5' />
    </svg>
  );
}

export function IconButton({
  label,
  onClick,
  disabled,
  children,
  danger,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <button
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

export function AddButton({ onClick, children, disabled }: { onClick: () => void; children: ReactNode; disabled?: boolean }) {
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

function linkProblem(url: string, httpsOnly = false) {
  const u = url.trim();

  if (!u) return '';
  if (!urlAllowed(u) || (httpsOnly && !/^https:\/\//i.test(u))) return 'This link needs to start with https://';
  return '';
}

/** Plain words when an embed's website isn't one embeds can show (learners would only get an "Open ↗" link). */
function embedProblem(url: string) {
  const u = url.trim();

  if (!/^https:\/\//i.test(u) || embedKind(u)) return '';
  return `Embeds can’t show this website. They can show ${EMBED_SITES}. For other websites, add a link instead.`;
}

export function UrlField({
  label,
  value,
  onChange,
  placeholder,
  httpsOnly,
  problem: extraProblem,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  httpsOnly?: boolean;
  /** Shown in red when the link itself is fine, e.g. a website embeds can't show. */
  problem?: string;
  hint?: ReactNode;
}) {
  const problem = linkProblem(value, httpsOnly) || extraProblem || '';

  return (
    <Field label={label} hint={problem ? <span className='text-text-error'>{problem}</span> : hint}>
      <TextLine type='url' value={value} onChange={onChange} placeholder={placeholder || 'https://…'} maxLength={2000} />
    </Field>
  );
}

export function PicturePicker({ value, onPick, label = 'Or pick a sample picture' }: { value: string; onPick: (url: string) => void; label?: string }) {
  return (
    <div>
      <div className='mb-1 text-xs text-text-tertiary'>{label}</div>
      <div className='flex flex-wrap gap-1.5'>
        {SAMPLE_PICTURES.map((url, i) => (
          <button
            key={url}
            type='button'
            aria-label={`Sample picture ${i + 1}`}
            aria-pressed={value === url}
            onClick={() => onPick(url)}
            className={cn(
              'h-10 w-14 overflow-hidden rounded-[6px] border-2',
              value === url ? 'border-border-theme-thick' : 'border-transparent hover:border-border-primary'
            )}
          >
            <img src={url} alt='' className='h-full w-full object-cover' />
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Uploads (Care Hub's file storage — the same place pictures in pages go, so they're in the nightly backups)
// ---------------------------------------------------------------------------

export type UploadKind = 'image' | 'video' | 'audio' | 'file';

/** Where uploads go: this workspace's file storage, in a folder named after the course. */
export const UploadContext = createContext<{ workspaceId: string; courseId: string } | null>(null);

const MB = 1024 * 1024;

const UPLOAD_RULES: Record<UploadKind, { max: number; accept: string; noun: string; tip: string; wrong: string }> = {
  image: {
    max: 10 * MB,
    accept: 'image/png,image/jpeg,image/gif,image/webp,image/avif',
    noun: 'picture',
    tip: 'try a smaller picture, or save it as a JPG',
    wrong: 'isn’t a picture we can show. Pick a PNG, JPG, GIF or WebP file.',
  },
  video: {
    max: 50 * MB,
    accept: 'video/*',
    noun: 'video',
    tip: 'for longer videos paste a Loom, YouTube or Vimeo link',
    wrong: 'isn’t a video file. Pick an MP4, MOV or WebM video — or paste a YouTube, Vimeo or Loom link.',
  },
  audio: {
    max: 25 * MB,
    accept: 'audio/*',
    noun: 'audio file',
    tip: 'try a shorter clip, or save it as an MP3',
    wrong: 'isn’t an audio file. Pick an MP3, M4A or WAV file.',
  },
  file: { max: 25 * MB, accept: '', noun: 'file', tip: 'try a smaller file, or paste a link to it instead', wrong: '' },
};

function sizeText(bytes: number) {
  const mb = bytes / MB;

  return mb >= 10 ? `${Math.round(mb)} MB` : mb >= 0.1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function tooBigText(kind: UploadKind, bytes: number) {
  const rule = UPLOAD_RULES[kind];

  return `This ${rule.noun} is ${sizeText(bytes)}. The limit is ${sizeText(rule.max)} — ${rule.tip}.`;
}

function typeOk(kind: UploadKind, file: File) {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();

  if (kind === 'image') return /^image\/(png|jpeg|gif|webp|avif)$/.test(type) || (!type && /\.(png|jpe?g|gif|webp|avif)$/.test(name));
  if (kind === 'video') return type.startsWith('video/') || (!type && /\.(mp4|m4v|mov|webm|ogv)$/.test(name));
  if (kind === 'audio') return type.startsWith('audio/') || (!type && /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/.test(name));
  return true;
}

/** Problems we can spot before sending anything. */
export function uploadProblem(kind: UploadKind, file: File) {
  if (!typeOk(kind, file)) return `“${file.name}” ${UPLOAD_RULES[kind].wrong}`;
  if (file.size > UPLOAD_RULES[kind].max) return tooBigText(kind, file.size);
  if (!file.size) return `“${file.name}” is empty.`;
  return '';
}

/** Files a browser could run as a page are stored as plain downloads. */
function uploadType(kind: UploadKind, file: File) {
  const type = file.type.toLowerCase();

  if (!type || (kind === 'file' && /html|svg|xml|javascript|ecmascript/.test(type))) return 'application/octet-stream';
  return file.type;
}

/** Sends a file to Care Hub's file storage and returns its Care Hub address ("/api/file_storage/…"). */
export async function uploadToCareHub(
  file: File,
  where: { workspaceId: string; courseId: string },
  kind: UploadKind,
  signal: AbortSignal,
  onProgress: (percent: number) => void
) {
  const folder = `/api/file_storage/${where.workspaceId}/v1/blob/${encodeURIComponent(where.courseId)}`;
  const data = await executeAPIRequest<{ file_id: string }>(() =>
    getAxios()?.put(folder, file, {
      headers: { 'Content-Type': uploadType(kind, file) },
      signal,
      onUploadProgress: (e) => {
        const total = e.total || file.size;

        if (total) onProgress(Math.min(99, Math.floor((e.loaded / total) * 100)));
      },
    })
  );

  if (!data || typeof data.file_id !== 'string' || !data.file_id) throw new Error('The upload didn’t finish. Please try again.');
  return `${folder}/${data.file_id}`;
}

function uploadErrorText(err: unknown, kind: UploadKind, file: File) {
  const e = (err || {}) as { httpStatus?: number; status?: number; message?: string; response?: { status?: number } };
  const status = e.httpStatus || e.status || e.response?.status || 0;

  if (status === 413 || /\b413\b|too large/i.test(e.message || '')) return tooBigText(kind, Math.max(file.size, UPLOAD_RULES[kind].max + 1));
  return `Couldn’t upload “${file.name}”. ${chErrorText(err)}`;
}

function SmallButton({ onClick, children, ariaLabel }: { onClick: () => void; children: ReactNode; ariaLabel?: string }) {
  return (
    <button
      type='button'
      aria-label={ariaLabel}
      onClick={onClick}
      className='shrink-0 rounded-[8px] border border-border-primary px-2.5 py-1.5 text-sm font-medium hover:bg-fill-content-hover'
    >
      {children}
    </button>
  );
}

function UploadedThumb({ url }: { url: string }) {
  const file = useFileSrc(url);

  return (
    <span className='flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-fill-content-hover text-xs text-text-tertiary'>
      {file.state === 'ready' ? <img src={file.src} alt='' className='h-full w-full object-cover' onError={file.fail} /> : file.state === 'loading' ? '…' : '⚠️'}
    </span>
  );
}

const UPLOADED_NAME: Record<UploadKind, string> = { image: 'picture', video: 'video', audio: 'audio', file: 'file' };

/**
 * A link field with an Upload button (and drop-a-file). Pasting a link keeps working. After an upload the field
 * shows "Uploaded" with Replace / Remove instead of the long Care Hub address.
 */
export function MediaField({
  kind,
  label,
  value,
  onChange,
  onUpload,
  hint,
  placeholder,
  uploadedName,
}: {
  kind: UploadKind;
  label: string;
  value: string;
  onChange: (url: string) => void;
  /** Called instead of onChange when an upload finishes, with the file that was sent. */
  onUpload?: (url: string, file: File) => void;
  hint?: ReactNode;
  placeholder?: string;
  uploadedName?: string;
}) {
  const where = useContext(UploadContext);
  const id = useId();
  const picker = useRef<HTMLInputElement | null>(null);
  const abort = useRef<AbortController | null>(null);
  const latest = useRef({ onChange, onUpload });
  const [busy, setBusy] = useState<{ name: string; percent: number } | null>(null);
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const rule = UPLOAD_RULES[kind];
  const own = isCareHubFile(value);
  const problem = own ? '' : linkProblem(value);

  latest.current = { onChange, onUpload };
  useEffect(() => () => abort.current?.abort(), []);

  const send = async (file: File) => {
    if (!where || abort.current) return;
    const bad = uploadProblem(kind, file);

    if (bad) {
      setError(bad);
      return;
    }

    const ctrl = new AbortController();

    abort.current = ctrl;
    setError('');
    setBusy({ name: file.name, percent: 0 });
    try {
      const url = await uploadToCareHub(file, where, kind, ctrl.signal, (percent) =>
        setBusy((b) => (b && b.percent === percent ? b : { name: file.name, percent }))
      );

      if (ctrl.signal.aborted) return;
      const { onChange: change, onUpload: uploaded } = latest.current;

      if (uploaded) uploaded(url, file);
      else change(url);
    } catch (e) {
      if (!ctrl.signal.aborted) setError(uploadErrorText(e, kind, file));
    } finally {
      if (abort.current === ctrl) {
        abort.current = null;
        setBusy(null);
      }
    }
  };

  const cancel = () => {
    abort.current?.abort();
    abort.current = null;
    setBusy(null);
  };

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types || []).includes('Files');
  const status = error ? (
    <span role='alert' className='text-xs text-text-error'>
      {error}
    </span>
  ) : problem ? (
    <span className='text-xs text-text-error'>{problem}</span>
  ) : hint ? (
    <span className='text-xs text-text-tertiary'>{hint}</span>
  ) : null;

  return (
    <div
      role='group'
      aria-labelledby={`${id}-label`}
      className={cn('flex min-w-0 flex-col gap-1 rounded-[10px]', over && 'chl-drop-target')}
      onDragOver={(e) => {
        if (!where || busy || !hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (!over) setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        if (!where || busy || !hasFiles(e)) return;
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files?.[0];

        if (file) void send(file);
      }}
    >
      {busy || own ? (
        <span id={`${id}-label`} className='text-xs font-medium text-text-secondary'>
          {label}
        </span>
      ) : (
        <label id={`${id}-label`} htmlFor={`${id}-url`} className='text-xs font-medium text-text-secondary'>
          {label}
        </label>
      )}
      {busy ? (
        <div className='flex items-center gap-2 rounded-[8px] border border-border-primary px-3 py-2'>
          <div className='min-w-0 flex-1' role='status'>
            <div className='truncate text-sm'>
              Uploading “{busy.name}”… {busy.percent}%
            </div>
            <ProgressBar percent={busy.percent} className='mt-1.5' label='Upload progress' />
          </div>
          <SmallButton onClick={cancel}>Cancel</SmallButton>
        </div>
      ) : own ? (
        <div className='flex flex-wrap items-center gap-2 rounded-[8px] border border-border-primary px-3 py-2'>
          {kind === 'image' && <UploadedThumb url={value} />}
          <span className='min-w-0 flex-1 truncate text-sm'>
            <span className='chl-mark-right' aria-hidden='true'>
              ✓{' '}
            </span>
            {uploadedName?.trim() ? `Uploaded “${uploadedName.trim()}”` : `Uploaded ${UPLOADED_NAME[kind]}`}
          </span>
          {where && (
            <SmallButton onClick={() => picker.current?.click()} ariaLabel={`Replace the ${UPLOADED_NAME[kind]}`}>
              Replace
            </SmallButton>
          )}
          <SmallButton onClick={() => latest.current.onChange('')} ariaLabel={`Remove the ${UPLOADED_NAME[kind]}`}>
            Remove
          </SmallButton>
        </div>
      ) : (
        <div className='flex min-w-0 items-center gap-2'>
          <TextLine id={`${id}-url`} type='url' value={value} onChange={onChange} placeholder={placeholder || 'https://…'} maxLength={2000} />
          {where && <SmallButton onClick={() => picker.current?.click()}>Upload</SmallButton>}
        </div>
      )}
      <input
        ref={picker}
        type='file'
        accept={rule.accept || undefined}
        className='hidden'
        tabIndex={-1}
        aria-hidden='true'
        onChange={(e) => {
          const file = e.target.files?.[0];

          e.target.value = '';
          if (file) void send(file);
        }}
      />
      {status}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drag to reorder (mouse, pen or finger on the grip; the ↑ ↓ buttons stay for keyboards and phones)
// ---------------------------------------------------------------------------

export type DropEdge = 'before' | 'after' | null;

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const oy = window.getComputedStyle(p).overflowY;

    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 1) return p;
  }

  return null;
}

/**
 * Reorders the children of a list marked with data-drag-item. Put `ref={setList}` on the list and
 * `onPointerDown={grab(i)}` on each item's grip; onMove(from, to) runs once, when the item is dropped.
 */
export function useDragSort(onMove: (from: number, to: number) => void) {
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const list = useRef<HTMLElement | null>(null);
  const moveRef = useRef(onMove);
  const stop = useRef<(() => void) | null>(null);

  moveRef.current = onMove;
  useEffect(() => () => stop.current?.(), []);

  const setList = useRef((el: HTMLElement | null) => {
    list.current = el;
  }).current;

  const grab = (from: number) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || !list.current || stop.current) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const pointer = e.pointerId;
    const startY = e.clientY;
    const scroller = scrollParent(list.current);
    let y = e.clientY;
    let to = from;
    let started = false;
    let frame = 0;

    try {
      handle.setPointerCapture(pointer);
    } catch {
      // Not every browser lets us capture; the window listeners below still work.
    }

    const place = () => {
      const items = Array.from(list.current?.children || []).filter((el): el is HTMLElement => el instanceof HTMLElement && el.hasAttribute('data-drag-item'));
      let n = 0;

      items.forEach((el, i) => {
        if (i === from) return;
        const r = el.getBoundingClientRect();

        if (r.top + r.height / 2 < y) n += 1;
      });
      to = Math.min(n, Math.max(0, items.length - 1));
      setDrag((d) => (d && d.from === from && d.to === to ? d : { from, to }));
    };

    const tick = () => {
      frame = 0;
      if (!started) return;
      const box = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      const top = Math.max(box.top, 0) + 48;
      const bottom = Math.min(box.bottom, window.innerHeight) - 48;
      const speed = y < top ? -Math.min(18, Math.ceil((top - y) / 3)) : y > bottom ? Math.min(18, Math.ceil((y - bottom) / 3)) : 0;
      let scrolled = false;

      if (speed) {
        const before = scroller ? scroller.scrollTop : window.scrollY;

        if (scroller) scroller.scrollTop += speed;
        else window.scrollBy(0, speed);
        scrolled = (scroller ? scroller.scrollTop : window.scrollY) !== before;
      }

      place();
      if (scrolled) frame = window.requestAnimationFrame(tick);
    };

    const onPointerMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      y = ev.clientY;
      if (!started) {
        if (Math.abs(y - startY) < 4) return;
        started = true;
        document.body.style.cursor = 'grabbing';
      }

      ev.preventDefault();
      if (!frame) frame = window.requestAnimationFrame(tick);
    };

    const finish = (keep: boolean) => {
      const wasStarted = started;

      stop.current?.();
      setDrag(null);
      if (keep && wasStarted && to !== from) moveRef.current(from, to);
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId === pointer) finish(true);
    };

    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId === pointer) finish(false);
    };

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    };

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
    stop.current = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      started = false;
      document.body.style.cursor = '';
      try {
        handle.releasePointerCapture(pointer);
      } catch {
        // Already released.
      }

      stop.current = null;
    };
  };

  /** Where to draw the drop line for item i while dragging. */
  const edgeOf = (i: number): DropEdge => {
    if (!drag || drag.to === drag.from || i !== drag.to) return null;
    return drag.to > drag.from ? 'after' : 'before';
  };

  return { drag, setList, grab, edgeOf };
}

/** The six-dot grip people drag. Hidden from screen readers — they use the move buttons instead. */
export function DragGrip({ onPointerDown, className }: { onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void; className?: string }) {
  return (
    <span
      aria-hidden='true'
      title='Drag to move'
      onPointerDown={onPointerDown}
      className={cn(
        'flex h-7 w-5 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded-[6px] text-text-tertiary hover:bg-fill-content-hover',
        className
      )}
    >
      <svg width='10' height='16' viewBox='0 0 10 16' fill='currentColor' aria-hidden='true' focusable='false'>
        <circle cx='2.5' cy='3' r='1.4' />
        <circle cx='7.5' cy='3' r='1.4' />
        <circle cx='2.5' cy='8' r='1.4' />
        <circle cx='7.5' cy='8' r='1.4' />
        <circle cx='2.5' cy='13' r='1.4' />
        <circle cx='7.5' cy='13' r='1.4' />
      </svg>
    </span>
  );
}

/** The line that shows where a dragged item will land. `gap` is the list's gap in pixels. */
export function DropLine({ edge, gap }: { edge: DropEdge; gap: number }) {
  if (!edge) return null;
  const offset = -(gap / 2) - 1.5;

  return (
    <span
      aria-hidden='true'
      className='chl-drop pointer-events-none absolute inset-x-0 z-10 h-[3px] rounded-full'
      style={edge === 'before' ? { top: offset } : { bottom: offset }}
    />
  );
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);

  next.splice(to, 0, item);
  return next;
}

// ---------------------------------------------------------------------------
// Questions (knowledge checks and the final quiz)
// ---------------------------------------------------------------------------

const KIND_OPTIONS: { value: QuestionKind; label: string }[] = [
  { value: 'single', label: 'One right answer' },
  { value: 'multiple', label: 'Several right answers' },
  { value: 'true_false', label: 'True or false' },
  { value: 'matching', label: 'Match the pairs' },
];

export function QuestionEditor({ q, onChange, inQuiz }: { q: Question; onChange: (q: Question) => void; inQuiz?: boolean }) {
  const set = (patch: Partial<Question>) => onChange({ ...q, ...patch });
  const setOption = (i: number, patch: Partial<QOption>) => set({ options: q.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  const markCorrect = (i: number, on: boolean) => {
    if (q.kind === 'multiple') setOption(i, { correct: on });
    else set({ options: q.options.map((o, j) => ({ ...o, correct: j === i })) });
  };
  const setPair = (i: number, patch: Partial<QPair>) => set({ pairs: q.pairs.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const group = `q-${q.id}`;

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-wrap items-end gap-3'>
        <Field label='Type of question' className='min-w-[180px] flex-1'>
          <ChSelect value={q.kind} options={KIND_OPTIONS} onChange={(k) => onChange(setQuestionKind(q, k))} ariaLabel='Type of question' />
        </Field>
        {inQuiz && (
          <Field label='Points'>
            <NumberField value={q.points} min={1} max={100} onChange={(v) => set({ points: v })} ariaLabel='Points' className='w-20' />
          </Field>
        )}
      </div>
      <Field label='Question'>
        <TextBox value={q.prompt} rows={2} onChange={(v) => set({ prompt: v })} placeholder='What should the learner answer?' />
      </Field>

      {(q.kind === 'single' || q.kind === 'multiple') && (
        <div className='flex flex-col gap-1.5'>
          <div className='text-xs font-medium text-text-secondary'>
            Answers <span className='font-normal text-text-tertiary'>— tick the {q.kind === 'multiple' ? 'right ones' : 'right one'}</span>
          </div>
          {q.options.map((o, i) => (
            <div key={o.id} className='flex items-center gap-2'>
              <input
                type={q.kind === 'multiple' ? 'checkbox' : 'radio'}
                name={group}
                checked={o.correct}
                aria-label={`Answer ${i + 1} is right`}
                onChange={(e) => markCorrect(i, e.target.checked)}
              />
              <TextLine value={o.text} onChange={(v) => setOption(i, { text: v })} placeholder={`Answer ${i + 1}`} ariaLabel={`Answer ${i + 1}`} />
              <IconButton label='Remove answer' danger disabled={q.options.length <= 2} onClick={() => set({ options: q.options.filter((_, j) => j !== i) })}>
                ×
              </IconButton>
            </div>
          ))}
          <AddButton
            disabled={q.options.length >= 10}
            onClick={() => set({ options: [...q.options, { id: newId('o'), text: '', correct: false }] })}
          >
            Add an answer
          </AddButton>
        </div>
      )}

      {q.kind === 'true_false' && (
        <div className='flex flex-col gap-1.5'>
          <div className='text-xs font-medium text-text-secondary'>The right answer is</div>
          <div className='flex gap-4'>
            {q.options.map((o, i) => (
              <label key={o.id} className='flex cursor-pointer items-center gap-2 text-sm'>
                <input type='radio' name={group} checked={o.correct} onChange={() => markCorrect(i, true)} />
                {o.text}
              </label>
            ))}
          </div>
        </div>
      )}

      {q.kind === 'matching' && (
        <div className='flex flex-col gap-1.5'>
          <div className='text-xs font-medium text-text-secondary'>
            Pairs <span className='font-normal text-text-tertiary'>— learners see the right side shuffled</span>
          </div>
          {q.pairs.map((p, i) => (
            <div key={p.id} className='flex flex-wrap items-center gap-2 sm:flex-nowrap'>
              <TextLine value={p.left} onChange={(v) => setPair(i, { left: v })} placeholder='This…' ariaLabel={`Pair ${i + 1}, left`} className='flex-1' />
              <span className='text-text-tertiary' aria-hidden='true'>
                →
              </span>
              <TextLine value={p.right} onChange={(v) => setPair(i, { right: v })} placeholder='…goes with this' ariaLabel={`Pair ${i + 1}, right`} className='flex-1' />
              <IconButton label='Remove pair' danger disabled={q.pairs.length <= 2} onClick={() => set({ pairs: q.pairs.filter((_, j) => j !== i) })}>
                ×
              </IconButton>
            </div>
          ))}
          <AddButton disabled={q.pairs.length >= 10} onClick={() => set({ pairs: [...q.pairs, { id: newId('p'), left: '', right: '' }] })}>
            Add a pair
          </AddButton>
        </div>
      )}

      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
        <Field label='Feedback when right'>
          <TextLine value={q.feedback_correct} onChange={(v) => set({ feedback_correct: v })} placeholder='That’s right!' />
        </Field>
        <Field label='Feedback when wrong'>
          <TextLine value={q.feedback_incorrect} onChange={(v) => set({ feedback_incorrect: v })} placeholder='Not quite.' />
        </Field>
      </div>
      <Field label='Explanation (optional)' hint={inQuiz ? 'Shown with the right answer, depending on the quiz settings.' : 'Shown after answering.'}>
        <TextBox value={q.explanation} rows={2} onChange={(v) => set({ explanation: v })} placeholder='Why this is the right answer' />
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lists of items (lists, accordions, tabs, processes, flashcards)
// ---------------------------------------------------------------------------

function ItemsEditor({
  items,
  onChange,
  noun,
  min = 1,
  max = 20,
  textPlaceholder = 'What people see when they open it',
}: {
  items: TextItem[];
  onChange: (items: TextItem[]) => void;
  noun: string;
  min?: number;
  max?: number;
  textPlaceholder?: string;
}) {
  const set = (i: number, patch: Partial<TextItem>) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));

  return (
    <div className='flex flex-col gap-2'>
      {items.map((it, i) => (
        <div key={it.id} className='flex flex-col gap-1.5 rounded-[10px] border border-border-primary p-2.5'>
          <div className='flex items-center gap-1'>
            <TextLine value={it.title} onChange={(v) => set(i, { title: v })} placeholder={`${noun} ${i + 1} title`} ariaLabel={`${noun} ${i + 1} title`} />
            <IconButton label='Move up' disabled={i === 0} onClick={() => onChange(move(items, i, i - 1))}>
              ↑
            </IconButton>
            <IconButton label='Move down' disabled={i === items.length - 1} onClick={() => onChange(move(items, i, i + 1))}>
              ↓
            </IconButton>
            <IconButton label={`Remove ${noun.toLowerCase()}`} danger disabled={items.length <= min} onClick={() => onChange(items.filter((_, j) => j !== i))}>
              ×
            </IconButton>
          </div>
          <TextBox value={it.text} rows={3} onChange={(v) => set(i, { text: v })} placeholder={textPlaceholder} ariaLabel={`${noun} ${i + 1} text`} />
        </div>
      ))}
      <AddButton disabled={items.length >= max} onClick={() => onChange([...items, { id: newId('i'), title: '', text: '' }])}>
        Add a {noun.toLowerCase()}
      </AddButton>
    </div>
  );
}

function CardsEditor({ cards, onChange }: { cards: FlashCard[]; onChange: (cards: FlashCard[]) => void }) {
  const set = (i: number, patch: Partial<FlashCard>) => onChange(cards.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <div className='flex flex-col gap-2'>
      {cards.map((c, i) => (
        <div key={c.id} className='flex flex-col gap-1.5 rounded-[10px] border border-border-primary p-2.5'>
          <div className='flex items-center gap-1'>
            <span className='flex-1 text-xs font-medium text-text-secondary'>Card {i + 1}</span>
            <IconButton label='Move up' disabled={i === 0} onClick={() => onChange(move(cards, i, i - 1))}>
              ↑
            </IconButton>
            <IconButton label='Move down' disabled={i === cards.length - 1} onClick={() => onChange(move(cards, i, i + 1))}>
              ↓
            </IconButton>
            <IconButton label='Remove card' danger disabled={cards.length <= 1} onClick={() => onChange(cards.filter((_, j) => j !== i))}>
              ×
            </IconButton>
          </div>
          <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
            <TextBox value={c.front} rows={2} onChange={(v) => set(i, { front: v })} placeholder='Front (question or word)' ariaLabel={`Card ${i + 1} front`} />
            <TextBox value={c.back} rows={2} onChange={(v) => set(i, { back: v })} placeholder='Back (answer)' ariaLabel={`Card ${i + 1} back`} />
          </div>
        </div>
      ))}
      <AddButton disabled={cards.length >= 30} onClick={() => onChange([...cards, { id: newId('c'), front: '', back: '' }])}>
        Add a card
      </AddButton>
    </div>
  );
}

function ListItemsEditor({ items, onChange }: { items: string[]; onChange: (items: string[]) => void }) {
  return (
    <div className='flex flex-col gap-1.5'>
      {items.map((it, i) => (
        <div key={i} className='flex items-center gap-1'>
          <TextLine value={it} onChange={(v) => onChange(items.map((x, j) => (j === i ? v : x)))} placeholder={`Item ${i + 1}`} ariaLabel={`Item ${i + 1}`} />
          <IconButton label='Move up' disabled={i === 0} onClick={() => onChange(move(items, i, i - 1))}>
            ↑
          </IconButton>
          <IconButton label='Remove item' danger disabled={items.length <= 1} onClick={() => onChange(items.filter((_, j) => j !== i))}>
            ×
          </IconButton>
        </div>
      ))}
      <AddButton disabled={items.length >= 50} onClick={() => onChange([...items, ''])}>
        Add an item
      </AddButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

function stepName(steps: ScenarioStep[], id: string) {
  const i = steps.findIndex((s) => s.id === id);

  if (i < 0) return '';
  const text = steps[i].text.trim();

  return `Step ${i + 1}${text ? ` — ${text.length > 32 ? `${text.slice(0, 32)}…` : text}` : ''}`;
}

function ScenarioEditor({ block, onChange }: { block: BlockOf<'scenario'>; onChange: (b: Block) => void }) {
  const set = (patch: Partial<BlockOf<'scenario'>>) => onChange({ ...block, ...patch });
  const setStep = (i: number, patch: Partial<ScenarioStep>) => set({ steps: block.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const setChoice = (si: number, ci: number, patch: Partial<ScenarioChoice>) =>
    setStep(si, { choices: block.steps[si].choices.map((c, j) => (j === ci ? { ...c, ...patch } : c)) });
  const nextOptions = [{ value: '', label: 'End the scenario' }, ...block.steps.map((s) => ({ value: s.id, label: stepName(block.steps, s.id) }))];
  const removeStep = (i: number) => {
    const id = block.steps[i].id;
    const steps = block.steps
      .filter((_, j) => j !== i)
      .map((s) => ({ ...s, choices: s.choices.map((c) => (c.next === id ? { ...c, next: '' } : c)) }));

    set({ steps, start: block.start === id ? steps[0]?.id || '' : block.start });
  };
  const addStep = () => {
    const step: ScenarioStep = { id: newId('s'), text: '', choices: [{ id: newId('ch'), text: '', feedback: '', good: true, next: '' }] };

    set({ steps: [...block.steps, step], start: block.start || step.id });
  };

  return (
    <div className='flex flex-col gap-3'>
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
        <Field label='Title'>
          <TextLine value={block.title} onChange={(v) => set({ title: v })} placeholder='e.g. A customer calls about a late order' />
        </Field>
        <Field label='Starts at'>
          <ChSelect
            value={block.start}
            options={block.steps.map((s) => ({ value: s.id, label: stepName(block.steps, s.id) }))}
            onChange={(v) => set({ start: v })}
            ariaLabel='First step'
          />
        </Field>
      </div>
      <Field label='Set the scene (optional)'>
        <TextBox value={block.intro} rows={2} onChange={(v) => set({ intro: v })} placeholder='Who is the learner talking to, and what is going on?' />
      </Field>
      {block.steps.map((s, si) => (
        <div key={s.id} className='flex flex-col gap-2 rounded-[10px] border border-border-primary p-2.5'>
          <div className='flex items-center gap-1'>
            <span className='flex-1 text-xs font-semibold text-text-secondary'>
              Step {si + 1}
              {block.start === s.id ? ' · first' : ''}
            </span>
            <IconButton label='Remove step' danger disabled={block.steps.length <= 1} onClick={() => removeStep(si)}>
              ×
            </IconButton>
          </div>
          <TextBox value={s.text} rows={2} onChange={(v) => setStep(si, { text: v })} placeholder='What the other person says or what happens' ariaLabel={`Step ${si + 1} text`} />
          <div className='text-xs font-medium text-text-secondary'>Choices for the learner</div>
          {s.choices.map((c, ci) => (
            <div key={c.id} className='flex flex-col gap-1.5 rounded-[8px] bg-fill-content p-2'>
              <div className='flex items-center gap-1'>
                <TextLine value={c.text} onChange={(v) => setChoice(si, ci, { text: v })} placeholder={`Choice ${ci + 1}: what the learner says or does`} ariaLabel={`Step ${si + 1} choice ${ci + 1}`} />
                <IconButton
                  label='Remove choice'
                  danger
                  disabled={s.choices.length <= 1}
                  onClick={() => setStep(si, { choices: s.choices.filter((_, j) => j !== ci) })}
                >
                  ×
                </IconButton>
              </div>
              <TextLine value={c.feedback} onChange={(v) => setChoice(si, ci, { feedback: v })} placeholder='Feedback after this choice (optional)' ariaLabel='Feedback' />
              <div className='flex flex-wrap items-center gap-x-4 gap-y-1.5'>
                <Toggle checked={c.good} onChange={(v) => setChoice(si, ci, { good: v })} label='Good choice' />
                <label className='flex min-w-0 items-center gap-2 text-sm'>
                  <span className='shrink-0 text-xs text-text-secondary'>Then</span>
                  <ChSelect value={c.next} options={nextOptions} onChange={(v) => setChoice(si, ci, { next: v })} ariaLabel='What happens next' className='max-w-[220px]' />
                </label>
              </div>
            </div>
          ))}
          <AddButton
            disabled={s.choices.length >= 6}
            onClick={() => setStep(si, { choices: [...s.choices, { id: newId('ch'), text: '', feedback: '', good: false, next: '' }] })}
          >
            Add a choice
          </AddButton>
        </div>
      ))}
      <AddButton disabled={block.steps.length >= 20} onClick={addStep}>
        Add a step
      </AddButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Care Hub page link
// ---------------------------------------------------------------------------

function PageLinkEditor({ block, onChange }: { block: BlockOf<'page_link'>; onChange: (b: Block) => void }) {
  const pages = useSharablePages();
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState(!block.view_id);
  const found = useMemo(() => filterPages(pages, query, 8), [pages, query]);
  const current = pages.find((p) => p.viewId === block.view_id);

  return (
    <div className='flex flex-col gap-3'>
      {block.view_id && !picking ? (
        <div className='flex items-center gap-2 rounded-[10px] border border-border-primary px-3 py-2'>
          <span aria-hidden='true'>{current?.icon || '📄'}</span>
          <span className='min-w-0 flex-1'>
            <span className='block truncate text-sm font-medium'>{current?.name || block.title || 'Linked page'}</span>
            {current?.trail && <span className='block truncate text-xs text-text-tertiary'>{current.trail}</span>}
            {!current && <span className='block text-xs text-text-tertiary'>This page isn’t in your sidebar (it may be private to someone else).</span>}
          </span>
          <button type='button' className='text-sm font-medium text-text-action' onClick={() => setPicking(true)}>
            Change
          </button>
        </div>
      ) : (
        <div className='flex flex-col gap-1.5'>
          <TextLine type='search' value={query} onChange={setQuery} placeholder='Search for a page' ariaLabel='Search for a page' />
          <div className='flex max-h-[220px] flex-col overflow-y-auto rounded-[10px] border border-border-primary p-1'>
            {found.length ? (
              found.map((p) => (
                <button
                  key={p.viewId}
                  type='button'
                  className='flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-sm hover:bg-fill-content-hover'
                  onClick={() => {
                    onChange({ ...block, view_id: p.viewId, title: block.title.trim() ? block.title : p.name });
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
          {block.view_id && (
            <button type='button' className='self-start text-sm text-text-secondary underline' onClick={() => setPicking(false)}>
              Keep the current page
            </button>
          )}
        </div>
      )}
      <Field label='Link text' hint='Learners need access to the page to open it.'>
        <TextLine value={block.title} onChange={(v) => onChange({ ...block, title: v })} placeholder='e.g. Read the refund policy' />
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One block's fields
// ---------------------------------------------------------------------------

const TONES: { value: Tone; label: string }[] = [
  { value: 'info', label: 'ℹ️ Note' },
  { value: 'tip', label: '💡 Tip' },
  { value: 'warning', label: '⚠️ Warning' },
  { value: 'success', label: '✅ Good to know' },
];
const LIST_STYLES: { value: ListStyle; label: string }[] = [
  { value: 'bullet', label: 'Bullets' },
  { value: 'number', label: 'Numbers' },
  { value: 'check', label: 'Checklist' },
];
const WIDTHS: { value: ImageWidth; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'full', label: 'Full width' },
];
const LEVELS: { value: string; label: string }[] = [
  { value: '1', label: 'Large' },
  { value: '2', label: 'Medium' },
  { value: '3', label: 'Small' },
];

function ImageEditor({ block, onChange }: { block: BlockOf<'image'>; onChange: (b: Block) => void }) {
  const altId = useId();
  const needsAlt = Boolean(block.url.trim()) && !block.alt.trim();

  return (
    <div className='flex flex-col gap-3'>
      <MediaField
        kind='image'
        label='Picture'
        value={block.url}
        onChange={(url) => onChange({ ...block, url })}
        onUpload={(url) => {
          onChange({ ...block, url });
          // Ask for a description straight away — it's read aloud for people who can't see the picture.
          if (!block.alt.trim()) window.setTimeout(() => document.getElementById(altId)?.focus(), 0);
        }}
        hint='Upload a picture (up to 10 MB) or paste a link.'
      />
      <PicturePicker value={block.url} onPick={(url) => onChange({ ...block, url })} />
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
        <Field
          label='Describe the picture'
          hint={
            needsAlt ? (
              <span className='chl-mark-wrong'>Please describe it — it’s read aloud for people who can’t see it.</span>
            ) : (
              'Read aloud for people who can’t see it.'
            )
          }
        >
          <TextLine id={altId} value={block.alt} onChange={(v) => onChange({ ...block, alt: v })} placeholder='e.g. A baker boxing an order' />
        </Field>
        <Field label='Caption (optional)'>
          <TextLine value={block.caption} onChange={(v) => onChange({ ...block, caption: v })} />
        </Field>
      </div>
      <Field label='Size' className='self-start'>
        <ChSelect value={block.width} options={WIDTHS} onChange={(v) => onChange({ ...block, width: v })} ariaLabel='Picture size' />
      </Field>
    </div>
  );
}

export function BlockEditor({ block, onChange }: { block: Block; onChange: (b: Block) => void }) {
  switch (block.type) {
    case 'heading':
      return (
        <div className='flex flex-wrap items-end gap-3'>
          <Field label='Heading' className='min-w-[200px] flex-1'>
            <TextLine value={block.text} onChange={(v) => onChange({ ...block, text: v })} placeholder='Section title' />
          </Field>
          <Field label='Size'>
            <ChSelect
              value={String(block.level)}
              options={LEVELS}
              onChange={(v) => onChange({ ...block, level: v === '1' ? 1 : v === '3' ? 3 : 2 })}
              ariaLabel='Heading size'
            />
          </Field>
        </div>
      );
    case 'paragraph':
      return (
        <Field label='Text' hint={FORMAT_HINT}>
          <TextBox value={block.text} rows={4} onChange={(v) => onChange({ ...block, text: v })} placeholder='Write something…' />
        </Field>
      );
    case 'statement':
      return (
        <Field label='Statement' hint='Keep it short — it shows in large type.'>
          <TextBox value={block.text} rows={2} onChange={(v) => onChange({ ...block, text: v })} placeholder='The one thing to remember' />
        </Field>
      );
    case 'quote':
      return (
        <div className='flex flex-col gap-3'>
          <Field label='Quote'>
            <TextBox value={block.text} rows={2} onChange={(v) => onChange({ ...block, text: v })} placeholder='What they said' />
          </Field>
          <Field label='Who said it (optional)'>
            <TextLine value={block.cite} onChange={(v) => onChange({ ...block, cite: v })} placeholder='Name, role' />
          </Field>
        </div>
      );
    case 'callout':
      return (
        <div className='flex flex-col gap-3'>
          <div className='flex flex-wrap items-end gap-3'>
            <Field label='Style'>
              <ChSelect value={block.tone} options={TONES} onChange={(v) => onChange({ ...block, tone: v })} ariaLabel='Callout style' />
            </Field>
            <Field label='Title (optional)' className='min-w-[180px] flex-1'>
              <TextLine value={block.title} onChange={(v) => onChange({ ...block, title: v })} placeholder='e.g. Remember' />
            </Field>
          </div>
          <Field label='Text' hint={FORMAT_HINT}>
            <TextBox value={block.text} rows={3} onChange={(v) => onChange({ ...block, text: v })} />
          </Field>
        </div>
      );
    case 'list':
      return (
        <div className='flex flex-col gap-3'>
          <Field label='Style' className='self-start'>
            <ChSelect value={block.style} options={LIST_STYLES} onChange={(v) => onChange({ ...block, style: v })} ariaLabel='List style' />
          </Field>
          <ListItemsEditor items={block.items} onChange={(items) => onChange({ ...block, items })} />
        </div>
      );
    case 'divider':
      return <div className='text-sm text-text-tertiary'>A line between sections. Nothing to fill in.</div>;
    case 'image':
      return <ImageEditor block={block} onChange={onChange} />;
    case 'video': {
      const u = block.url.trim();
      const known = !u || Boolean(videoEmbedUrl(u)) || isCareHubFile(u) || /\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/i.test(u);

      return (
        <div className='flex flex-col gap-3'>
          <MediaField
            kind='video'
            label='Video'
            value={block.url}
            onChange={(v) => onChange({ ...block, url: v })}
            placeholder='https://… (YouTube, Vimeo, Loom or a video file)'
            hint={
              known
                ? 'Upload a video (up to 50 MB), or paste a YouTube, Vimeo or Loom link — they play right in the lesson.'
                : 'We’ll show this as a link to open the video.'
            }
          />
          <Field label='Caption (optional)'>
            <TextLine value={block.caption} onChange={(v) => onChange({ ...block, caption: v })} />
          </Field>
        </div>
      );
    }

    case 'audio':
      return (
        <div className='flex flex-col gap-3'>
          <MediaField
            kind='audio'
            label='Audio'
            value={block.url}
            onChange={(v) => onChange({ ...block, url: v })}
            hint='Upload a sound file (up to 25 MB) or paste a link.'
          />
          <Field label='Caption (optional)'>
            <TextLine value={block.caption} onChange={(v) => onChange({ ...block, caption: v })} />
          </Field>
        </div>
      );
    case 'file':
      return (
        <div className='flex flex-col gap-3'>
          <MediaField
            kind='file'
            label='File'
            value={block.url}
            uploadedName={block.name}
            onChange={(v) => onChange({ ...block, url: v })}
            onUpload={(url, file) => onChange({ ...block, url, name: block.name.trim() ? block.name : file.name.slice(0, 200) })}
            hint='Upload a file (up to 25 MB) or paste a link.'
          />
          <Field label='File name shown to learners (optional)'>
            <TextLine value={block.name} onChange={(v) => onChange({ ...block, name: v })} placeholder='e.g. Refund checklist (PDF)' />
          </Field>
        </div>
      );
    case 'embed':
      return (
        <div className='flex flex-wrap items-end gap-3'>
          <div className='min-w-[220px] flex-1'>
            <UrlField
              label='Website link'
              httpsOnly
              value={block.url}
              onChange={(v) => onChange({ ...block, url: v })}
              problem={embedProblem(block.url)}
              hint={`Embeds can show ${EMBED_SITES}. For other websites, add a link instead.`}
            />
          </div>
          <Field label='Height (px)'>
            <NumberField value={block.height} min={200} max={1200} onChange={(v) => onChange({ ...block, height: v })} ariaLabel='Height in pixels' />
          </Field>
        </div>
      );
    case 'accordion':
      return <ItemsEditor noun='Section' items={block.items} onChange={(items) => onChange({ ...block, items })} />;
    case 'tabs':
      return <ItemsEditor noun='Tab' items={block.items} onChange={(items) => onChange({ ...block, items })} />;
    case 'process':
      return (
        <div className='flex flex-col gap-2'>
          <div className='text-xs text-text-tertiary'>People see one step at a time, with Back and Next buttons. Use 2 to 12 steps.</div>
          <ItemsEditor
            noun='Step'
            min={2}
            max={12}
            textPlaceholder='What to do in this step'
            items={block.items}
            onChange={(items) => onChange({ ...block, items })}
          />
        </div>
      );
    case 'flashcards':
      return <CardsEditor cards={block.cards} onChange={(cards) => onChange({ ...block, cards })} />;
    case 'continue':
      return (
        <div className='flex flex-col gap-3'>
          <Field label='Button text' className='max-w-[320px]'>
            <TextLine value={block.label} onChange={(v) => onChange({ ...block, label: v })} placeholder='Continue' maxLength={60} />
          </Field>
          <Toggle
            checked={block.require_complete}
            onChange={(v) => onChange({ ...block, require_complete: v })}
            label='Wait until the questions and scenarios above are done'
            hint='Everything below this button stays hidden until the learner presses it.'
          />
        </div>
      );
    case 'knowledge_check':
      return <QuestionEditor q={block.question} onChange={(question) => onChange({ ...block, question })} />;
    case 'scenario':
      return <ScenarioEditor block={block} onChange={onChange} />;
    case 'page_link':
      return <PageLinkEditor block={block} onChange={onChange} />;
    default:
      return null;
  }
}

/** One block in the lesson editor: its name, drag grip, move/duplicate/delete controls, and its fields. */
export function BlockCard({
  block,
  index,
  count,
  onChange,
  onMove,
  onDuplicate,
  onDelete,
  onAddBelow,
  onGrab,
  dragging,
  dropEdge = null,
}: {
  block: Block;
  index: number;
  count: number;
  onChange: (b: Block) => void;
  onMove: (delta: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAddBelow: () => void;
  /** Starts dragging this block (from the grip). */
  onGrab?: (e: ReactPointerEvent<HTMLElement>) => void;
  dragging?: boolean;
  dropEdge?: DropEdge;
}) {
  const info = BLOCK_INFO[block.type];

  return (
    <div
      id={`chs-b-${block.id}`}
      data-drag-item=''
      className={cn('relative scroll-mt-4 rounded-[12px] border border-border-primary', dragging && 'opacity-50')}
      data-testid='carehub-learning-block'
    >
      <DropLine edge={dropEdge} gap={12} />
      <div className={cn('flex items-center gap-0.5 border-b border-border-primary py-1 pr-1', onGrab ? 'pl-1' : 'pl-3')}>
        {onGrab && <DragGrip onPointerDown={onGrab} />}
        <span className='mr-1.5' aria-hidden='true'>
          {info.emoji}
        </span>
        <span className='min-w-0 flex-1 truncate text-xs font-semibold text-text-secondary'>{info.label}</span>
        <IconButton label='Move up' disabled={index === 0} onClick={() => onMove(-1)}>
          ↑
        </IconButton>
        <IconButton label='Move down' disabled={index >= count - 1} onClick={() => onMove(1)}>
          ↓
        </IconButton>
        <IconButton label='Duplicate' onClick={onDuplicate}>
          <CopyIcon />
        </IconButton>
        <IconButton label='Add a block below' onClick={onAddBelow}>
          ＋
        </IconButton>
        <IconButton label='Delete block' danger onClick={onDelete}>
          🗑
        </IconButton>
      </div>
      <div className='p-3'>
        <BlockEditor block={block} onChange={onChange} />
      </div>
    </div>
  );
}

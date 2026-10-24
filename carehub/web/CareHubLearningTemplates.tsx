// CareHub Learning: block templates. Save one block, or all the blocks of a lesson, under a name; everyone who builds
// courses in this workspace can then add it to any lesson from the block library. Server: /learning/templates (the list
// has no blocks; one GET returns a template's blocks). A template never points at a course: when it's added, its blocks
// get fresh ids and links to lessons or blocks are cleared (they belonged to the course it was saved from).
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { chCall, CH_API } from './CareHubCore';
import { cloneBlock, learningNotLive, lErrorText, normalizeBlock, num, plural, str } from './CareHubLearningApi';
import { BLOCK_INFO } from './CareHubLearningStudioBlocks';
import { CareHubModal, ChNote, chInputClass } from './CareHubUi';

import type { Block, Lesson } from './CareHubLearningApi';

// ---------------------------------------------------------------------------
// Limits and words (the server checks the same things and answers with the same words)
// ---------------------------------------------------------------------------

export const TEMPLATE_NAME_MAX = 80;
export const TEMPLATE_BLOCKS_MAX = 50;
export const TEMPLATE_BYTES_MAX = 512 * 1024;
export const TEMPLATES_MAX = 200;

const NAME_MSG = 'Give the template a name.';
const NAME_LONG_MSG = 'Keep the template name to 80 characters or fewer.';
const NAME_TAKEN_MSG = 'A template with this name already exists.';
const FULL_MSG = 'This workspace has 200 templates. Delete one you no longer need first.';
const EMPTY_MSG = 'Pick at least one block to save.';
const MANY_MSG = 'A template can hold up to 50 blocks.';
const BIG_MSG = 'These blocks are too big for a template (over 512 KB). Use links for big images and videos.';
const SKIPPED_MSG = 'Some blocks couldn’t be added. Reload the page and try again.';
const UNLINKED_MSG = 'Links to lessons in the original course were removed. Pick new ones if you need them.';

// ---------------------------------------------------------------------------
// Types and server calls
// ---------------------------------------------------------------------------

/** A saved template as the list shows it (the list never sends blocks). */
export interface TemplateInfo {
  id: string;
  name: string;
  block_count: number;
  /** Distinct block types, in the order they first appear. */
  block_types: string[];
  saved_by_name: string;
  saved_ms: number;
  updated_ms: number;
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function readInfo(v: unknown): TemplateInfo | null {
  const o = rec(v);
  const id = str(o.id);

  if (!id) return null;
  return {
    id,
    name: str(o.name).trim() || 'Untitled template',
    block_count: Math.max(0, Math.round(num(o.block_count))),
    block_types: Array.isArray(o.block_types) ? o.block_types.filter((t): t is string => typeof t === 'string') : [],
    saved_by_name: str(o.saved_by_name).trim() || 'Former member',
    saved_ms: num(o.saved_ms),
    updated_ms: num(o.updated_ms),
  };
}

const base = (ws: string) => `${CH_API}/${ws}/learning/templates`;
const one = (ws: string, id: string) => `${base(ws)}/${encodeURIComponent(id)}`;

export const templatesApi = {
  list: (ws: string) =>
    chCall<unknown>('get', base(ws)).then((d) => {
      const list = rec(d).templates;

      return (Array.isArray(list) ? list : []).map(readInfo).filter((t): t is TemplateInfo => t !== null);
    }),
  /** The saved blocks, exactly as they were saved (not checked yet). */
  blocks: (ws: string, id: string) =>
    chCall<unknown>('get', one(ws, id)).then((d) => {
      const list = rec(rec(d).template).blocks;

      return Array.isArray(list) ? (list as unknown[]) : [];
    }),
  create: (ws: string, name: string, blocks: Block[]) =>
    chCall<unknown>('post', base(ws), { name, blocks }).then((d) => readInfo(rec(d).template)),
  rename: (ws: string, id: string, name: string) => chCall<unknown>('put', one(ws, id), { name }).then((d) => readInfo(rec(d).template)),
  remove: (ws: string, id: string) => chCall<unknown>('delete', one(ws, id)).then(() => undefined),
};

// ---------------------------------------------------------------------------
// Names, sizes and adding (pure helpers)
// ---------------------------------------------------------------------------

/** Same as the server's idea of white space (Rust char::is_whitespace). */
function isSpace(c: number) {
  return (
    (c >= 0x09 && c <= 0x0d) ||
    c === 0x20 ||
    c === 0x85 ||
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000
  );
}

/** Control characters and text-direction overrides, which the server removes from names. */
function isHidden(c: number) {
  return c < 0x20 || (c >= 0x7f && c <= 0x9f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069);
}

/** The name the server will keep: one line, single spaces, no hidden characters, trimmed. */
export function tidyTemplateName(raw: string) {
  let out = '';
  let gap = false;

  for (const ch of raw) {
    const c = ch.codePointAt(0) ?? 0;

    if (isSpace(c)) {
      gap = true;
      continue;
    }

    if (isHidden(c)) continue;
    if (gap && out) out += ' ';
    gap = false;
    out += ch;
  }

  return out;
}

const chars = (s: string) => [...s].length;
const cut = (s: string, max: number) => [...s].slice(0, max).join('').trimEnd();
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** A suggested name that isn't taken yet: "Text", "Text 2", "Text 3"… */
export function freeTemplateName(wanted: string, list: TemplateInfo[]) {
  const start = cut(tidyTemplateName(wanted), TEMPLATE_NAME_MAX) || 'Template';
  const taken = (name: string) => list.some((t) => sameName(t.name, name));

  if (!taken(start)) return start;
  for (let n = 2; n < 1000; n += 1) {
    const tail = ` ${n}`;
    const name = cut(start, TEMPLATE_NAME_MAX - tail.length) + tail;

    if (!taken(name)) return name;
  }

  return start;
}

/** Problems with a (tidied) name, in the server's order. `ownId` = the template being renamed. */
function nameProblem(name: string, list: TemplateInfo[], ownId = '') {
  if (!name) return NAME_MSG;
  if (chars(name) > TEMPLATE_NAME_MAX) return NAME_LONG_MSG;
  if (list.some((t) => t.id !== ownId && sameName(t.name, name))) return NAME_TAKEN_MSG;
  return '';
}

/** The size the server measures: compact JSON, in bytes. */
const jsonBytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

/** Problems with what's being saved, known before anyone types a name. */
function contentProblem(count: number, bytes: number, templates: BlockTemplates) {
  if (!count) return EMPTY_MSG;
  if (count > TEMPLATE_BLOCKS_MAX) return MANY_MSG;
  if (bytes > TEMPLATE_BYTES_MAX) return BIG_MSG;
  if (templates.status === 'live' && templates.list.length >= TEMPLATES_MAX) return FULL_MSG;
  return '';
}

const TEXT_JUMP_RE = /\[([^\]\n]+)\]\(#(?:lesson|block)-[A-Za-z0-9_-]+\)/g;

/**
 * A copy of saved JSON without links into the course it came from: text links [words](#lesson-…) / (#block-…) keep
 * only their words, and buttons that open a lesson keep their label but lose the lesson (the author picks a new one).
 * Page, file and web links are kept.
 */
function unlink(v: unknown, cleared: { n: number }): unknown {
  if (typeof v === 'string') {
    return v.replace(TEXT_JUMP_RE, (_all, words: string) => {
      cleared.n += 1;
      return words;
    });
  }

  if (Array.isArray(v)) return v.map((x) => unlink(x, cleared));
  if (!v || typeof v !== 'object') return v;
  const out: Record<string, unknown> = {};

  for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = unlink(x, cleared);
  if (out.kind === 'lesson' && 'lesson_id' in out) {
    if (out.lesson_id || out.block_id) cleared.n += 1;
    out.lesson_id = '';
    out.block_id = '';
  }

  return out;
}

export interface TemplateBlocks {
  blocks: Block[];
  /** Saved blocks this version of Care Hub can't read (left out). */
  skipped: number;
  /** Links and buttons that pointed at a lesson or block (cleared). */
  unlinked: number;
}

/** Saved blocks → blocks for this lesson: links into the old course cleared, unknown kinds left out, fresh ids. */
export function blocksFromTemplate(saved: unknown[]): TemplateBlocks {
  const cleared = { n: 0 };
  const blocks: Block[] = [];
  let skipped = 0;

  for (const raw of saved) {
    const b = normalizeBlock(unlink(raw, cleared));

    if (b) blocks.push(cloneBlock(b));
    else skipped += 1;
  }

  return { blocks, skipped, unlinked: cleared.n };
}

// ---------------------------------------------------------------------------
// The workspace's templates (one list per workspace, shared by everything in the open course)
// ---------------------------------------------------------------------------

/** loading → live; off = the server doesn't have templates yet (HTTP 404): everything stays hidden. */
export type TemplatesStatus = 'loading' | 'live' | 'off' | 'error';

export interface BlockTemplates {
  status: TemplatesStatus;
  /** A–Z by name. */
  list: TemplateInfo[];
  /** Why the list couldn't be loaded (status "error"). */
  error: string;
  reload: () => void;
  save: (name: string, blocks: Block[]) => Promise<TemplateInfo | null>;
  rename: (id: string, name: string) => Promise<TemplateInfo | null>;
  remove: (id: string) => Promise<void>;
  /** The saved blocks of one template (not checked yet: see blocksFromTemplate). */
  blocksOf: (id: string) => Promise<unknown[]>;
}

const listCache = new Map<string, TemplateInfo[]>();

function sortTemplates(list: TemplateInfo[]) {
  return list.slice().sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const TEMPLATES_CSS = `
.cht-focus:focus-visible{outline:2px solid #2563eb;outline-offset:2px}
:root[data-dark-mode='true'] .cht-focus:focus-visible{outline-color:#60a5fa}
`;

function useTemplatesStyle() {
  useLayoutEffect(() => {
    if (typeof document === 'undefined' || document.head.querySelector('style[data-carehub-templates]')) return;
    const el = document.createElement('style');

    el.setAttribute('data-carehub-templates', '');
    el.textContent = TEMPLATES_CSS;
    document.head.appendChild(el);
  }, []);
}

/**
 * The workspace's block templates for the course editor: one GET when the editor opens (the last list is shown
 * meanwhile), and again after every save, rename or delete.
 */
export function useBlockTemplates(workspaceId: string): BlockTemplates {
  const [list, setList] = useState<TemplateInfo[]>(() => listCache.get(workspaceId) || []);
  const [status, setStatus] = useState<TemplatesStatus>(() => (listCache.has(workspaceId) ? 'live' : 'loading'));
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const listRef = useRef(list);

  listRef.current = list;
  useTemplatesStyle();

  useEffect(() => {
    let current = true;

    templatesApi.list(workspaceId).then(
      (got) => {
        if (!current) return;
        const next = sortTemplates(got);

        listCache.set(workspaceId, next);
        setList(next);
        setStatus('live');
        setError('');
      },
      (err) => {
        if (!current) return;
        if (learningNotLive(err)) {
          listCache.delete(workspaceId);
          setStatus('off');
          return;
        }

        setError(lErrorText(err));
        setStatus((s) => (s === 'live' ? s : 'error'));
      }
    );
    return () => {
      current = false;
    };
  }, [workspaceId, tick]);

  const refresh = () => setTick((t) => t + 1);
  const put = (next: TemplateInfo[]) => {
    const sorted = sortTemplates(next);

    listCache.set(workspaceId, sorted);
    listRef.current = sorted;
    setList(sorted);
    setStatus('live');
  };

  return {
    status,
    list,
    error,
    reload: () => {
      setStatus((s) => (s === 'error' ? 'loading' : s));
      refresh();
    },
    save: (name, blocks) =>
      templatesApi
        .create(workspaceId, name, blocks)
        .then((info) => {
          if (info) put([...listRef.current.filter((t) => t.id !== info.id), info]);
          return info;
        })
        .finally(refresh),
    rename: (id, name) =>
      templatesApi
        .rename(workspaceId, id, name)
        .then((info) => {
          if (info) put(listRef.current.map((t) => (t.id === id ? info : t)));
          return info;
        })
        .finally(refresh),
    remove: (id) =>
      templatesApi
        .remove(workspaceId, id)
        .then(() => put(listRef.current.filter((t) => t.id !== id)))
        .finally(refresh),
    blocksOf: (id) => templatesApi.blocks(workspaceId, id),
  };
}

// ---------------------------------------------------------------------------
// Saving: "Save as template" (a block) and "Save lesson as template" (all its blocks)
// ---------------------------------------------------------------------------

const canSave = (t: BlockTemplates) => t.status === 'live' || t.status === 'error';

function blockSummary(blocks: Block[]) {
  const labels: string[] = [];

  for (const b of blocks) {
    const label = BLOCK_INFO[b.type]?.label || 'Block';

    if (!labels.includes(label)) labels.push(label);
  }

  const shown = labels.slice(0, 4).join(', ');

  return `${plural(blocks.length, 'block')}: ${labels.length > 4 ? `${shown} and ${labels.length - 4} more` : shown}`;
}

function SaveTemplateDialog({
  templates,
  blocks,
  suggestion,
  onClose,
  onSaved,
}: {
  templates: BlockTemplates;
  blocks: Block[];
  suggestion: string;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const [name, setName] = useState(() => freeTemplateName(suggestion, templates.list));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const uid = useId();
  const [bytes] = useState(() => jsonBytes(blocks));
  const fixed = contentProblem(blocks.length, bytes, templates);
  const shown = fixed || problem;

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || fixed) return;
    const clean = tidyTemplateName(name);
    const bad = nameProblem(clean, templates.list);

    setProblem(bad);
    if (bad) {
      input.current?.focus();
      return;
    }

    setBusy(true);
    try {
      const info = await templates.save(clean, blocks);

      onSaved(info?.name || clean);
    } catch (err) {
      setProblem(lErrorText(err));
      setBusy(false);
      input.current?.focus();
    }
  };

  return (
    <CareHubModal
      title='Save as a block template'
      onClose={onClose}
      testId='carehub-learning-template-save'
      footer={
        <>
          <Button type='button' size='sm' variant='outline' className='cht-focus' onClick={onClose}>
            Cancel
          </Button>
          <Button type='submit' size='sm' form={`${uid}-form`} className='cht-focus' disabled={busy || Boolean(fixed)}>
            {busy ? 'Saving…' : 'Save template'}
          </Button>
        </>
      }
    >
      <form id={`${uid}-form`} className='flex flex-col gap-3' onSubmit={(e) => void submit(e)} noValidate>
        <div className='flex flex-col gap-1'>
          <label htmlFor={`${uid}-name`} className='text-sm font-medium'>
            Name
          </label>
          <input
            ref={input}
            id={`${uid}-name`}
            className={cn(chInputClass, 'w-full')}
            value={name}
            maxLength={TEMPLATE_NAME_MAX}
            autoComplete='off'
            aria-invalid={problem ? true : undefined}
            aria-describedby={`${uid}-what${shown ? ` ${uid}-problem` : ''}`}
            onChange={(e) => {
              setName(e.target.value);
              if (problem) setProblem('');
            }}
          />
          <div id={`${uid}-what`} className='text-xs text-text-tertiary'>
            {blockSummary(blocks)}
          </div>
        </div>
        <ChNote>Everyone who builds courses in this workspace can use it.</ChNote>
        {shown && (
          <div id={`${uid}-problem`} role='alert'>
            <ChNote tone='error'>{shown}</ChNote>
          </div>
        )}
      </form>
    </CareHubModal>
  );
}

/** A bookmark with a plus: "keep this to use again". */
function TemplateIcon() {
  return (
    <svg width='14' height='14' viewBox='0 0 16 16' fill='none' aria-hidden='true' focusable='false'>
      <path
        d='M4 1.75h8a.75.75 0 0 1 .75.75v11.2a.3.3 0 0 1-.48.24L8 10.75l-4.27 3.19a.3.3 0 0 1-.48-.24V2.5A.75.75 0 0 1 4 1.75Z'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinejoin='round'
      />
      <path d='M8 4.25v3.5M6.25 6h3.5' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
    </svg>
  );
}

function SavedToast({ text, onDone }: { text: string; onDone: () => void }) {
  const done = useRef(onDone);

  done.current = onDone;
  useEffect(() => {
    const t = window.setTimeout(() => done.current(), 6000);

    return () => window.clearTimeout(t);
  }, [text]);

  return createPortal(
    <div
      role='status'
      className='fixed bottom-16 left-1/2 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-[10px] bg-[#1f2329] px-4 py-2 text-sm text-white shadow-lg'
      data-testid='carehub-learning-template-saved'
    >
      <span className='min-w-0'>{text}</span>
      <button
        type='button'
        aria-label='Dismiss'
        className='cht-focus rounded-[4px] opacity-70 hover:opacity-100'
        onClick={() => done.current()}
      >
        ×
      </button>
    </div>,
    document.body
  );
}

/** The save dialog, the "Saved" note and where focus goes back to (shared by both save buttons). */
function useSaveFlow(templates: BlockTemplates) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState('');
  const opener = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    opener.current?.focus();
  };
  const render = (blocks: Block[], suggestion: string) => (
    <>
      {open && (
        <SaveTemplateDialog
          templates={templates}
          blocks={blocks}
          suggestion={suggestion}
          onClose={close}
          onSaved={(name) => {
            close();
            setSaved(`Saved “${name}” to templates.`);
          }}
        />
      )}
      {saved && <SavedToast text={saved} onDone={() => setSaved('')} />}
    </>
  );

  return { opener, show: () => setOpen(true), render };
}

/** "Save as template" for one block: an icon button for the block's header row (BlockCard `extra`). */
export function SaveBlockTemplateButton({ templates, block }: { templates: BlockTemplates; block: Block }) {
  const flow = useSaveFlow(templates);

  return (
    <>
      {canSave(templates) && (
        <button
          ref={flow.opener}
          type='button'
          aria-label='Save as template'
          title='Save as template'
          onClick={flow.show}
          className='cht-focus flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-sm text-text-secondary hover:bg-fill-content-hover'
          data-testid='carehub-learning-save-template'
        >
          <TemplateIcon />
        </button>
      )}
      {flow.render([block], BLOCK_INFO[block.type]?.label || 'Block')}
    </>
  );
}

/** "Save lesson as template": all the lesson's blocks (not its title or minimum time). Hidden when it has none. */
export function SaveLessonTemplateButton({ templates, lesson }: { templates: BlockTemplates; lesson: Lesson }) {
  const flow = useSaveFlow(templates);

  return (
    <>
      {canSave(templates) && lesson.blocks.length > 0 && (
        <Button
          ref={flow.opener}
          type='button'
          size='sm'
          variant='ghost'
          className='cht-focus'
          onClick={flow.show}
          data-testid='carehub-learning-save-lesson-template'
        >
          Save lesson as template
        </Button>
      )}
      {flow.render(lesson.blocks, lesson.title.trim() || 'Untitled lesson')}
    </>
  );
}

// ---------------------------------------------------------------------------
// The block library's "Templates" section: add (click or Enter), rename, delete
// ---------------------------------------------------------------------------

const onEscape = (fn: () => void) => (e: ReactKeyboardEvent) => {
  if (e.key !== 'Escape') return;
  // Close just this part, not the whole library.
  e.stopPropagation();
  fn();
};

function typeEmoji(type: string) {
  return (BLOCK_INFO as Record<string, { emoji: string } | undefined>)[type]?.emoji || '🧱';
}

function ActionButton({
  id,
  label,
  onClick,
  danger,
  children,
}: {
  id?: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      id={id}
      type='button'
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'cht-focus flex h-7 w-7 items-center justify-center rounded-[6px] text-sm text-text-secondary hover:bg-fill-content-hover',
        danger && 'hover:text-text-error'
      )}
    >
      {children}
    </button>
  );
}

function RenameForm({ templates, template, onDone }: { templates: BlockTemplates; template: TemplateInfo; onDone: () => void }) {
  const [name, setName] = useState(template.name);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const uid = useId();

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const clean = tidyTemplateName(name);
    const bad = nameProblem(clean, templates.list, template.id);

    setProblem(bad);
    if (bad) {
      input.current?.focus();
      return;
    }

    if (clean === template.name) {
      onDone();
      return;
    }

    setBusy(true);
    try {
      await templates.rename(template.id, clean);
      onDone();
    } catch (err) {
      setProblem(lErrorText(err));
      setBusy(false);
      input.current?.focus();
    }
  };

  return (
    <form className='flex flex-col gap-2 p-2.5' onSubmit={(e) => void submit(e)} onKeyDown={onEscape(onDone)} noValidate>
      <label htmlFor={`${uid}-name`} className='break-words text-xs font-medium text-text-secondary'>
        Rename “{template.name}”
      </label>
      <input
        ref={input}
        id={`${uid}-name`}
        className={cn(chInputClass, 'w-full')}
        value={name}
        maxLength={TEMPLATE_NAME_MAX}
        autoComplete='off'
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? `${uid}-problem` : undefined}
        onChange={(e) => {
          setName(e.target.value);
          if (problem) setProblem('');
        }}
      />
      {problem && (
        <div id={`${uid}-problem`} role='alert'>
          <ChNote tone='error'>{problem}</ChNote>
        </div>
      )}
      <div className='flex flex-wrap justify-end gap-2'>
        <Button type='button' size='sm' variant='outline' className='cht-focus' onClick={onDone}>
          Cancel
        </Button>
        <Button type='submit' size='sm' className='cht-focus' disabled={busy}>
          {busy ? 'Saving…' : 'Rename'}
        </Button>
      </div>
    </form>
  );
}

function DeleteAsk({
  templates,
  template,
  onCancel,
  onDeleted,
}: {
  templates: BlockTemplates;
  template: TemplateInfo;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const cancel = useRef<HTMLButtonElement>(null);
  const uid = useId();

  useEffect(() => {
    cancel.current?.focus();
  }, []);

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setProblem('');
    try {
      await templates.remove(template.id);
      onDeleted();
    } catch (err) {
      setProblem(lErrorText(err));
      setBusy(false);
    }
  };

  return (
    <div
      role='group'
      aria-labelledby={`${uid}-ask`}
      className='flex flex-col gap-2 border-t border-border-primary p-2.5'
      onKeyDown={onEscape(onCancel)}
      data-testid='carehub-learning-template-delete'
    >
      <p id={`${uid}-ask`} className='text-xs'>
        Delete this template? Courses that used it keep their blocks.
      </p>
      {problem && (
        <div role='alert'>
          <ChNote tone='error'>{problem}</ChNote>
        </div>
      )}
      <div className='flex flex-wrap justify-end gap-2'>
        <Button ref={cancel} type='button' size='sm' variant='outline' className='cht-focus' onClick={onCancel}>
          Cancel
        </Button>
        <Button type='button' size='sm' variant='destructive' className='cht-focus' disabled={busy} onClick={() => void remove()}>
          {busy ? 'Deleting…' : 'Delete template'}
        </Button>
      </div>
    </div>
  );
}

/**
 * The "Templates" section of the block library (BlockLibrary `children`). Picking a template fetches its blocks and
 * hands fresh copies to `onAdd` with the words for the "Added" note; Rename and Delete work in place.
 */
export function TemplatesSection({ templates, onAdd }: { templates: BlockTemplates; onAdd: (blocks: Block[], label: string) => void }) {
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState('');
  const [editing, setEditing] = useState('');
  const [asking, setAsking] = useState('');
  const [problem, setProblem] = useState('');
  const [focusId, setFocusId] = useState('');
  const alive = useRef(true);
  const uid = useId();

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!focusId) return;
    document.getElementById(focusId)?.focus();
    setFocusId('');
  }, [focusId]);

  if (templates.status === 'off') return null;
  const { list } = templates;
  const q = query.trim().toLowerCase();
  const shown = q ? list.filter((t) => t.name.toLowerCase().includes(q)) : list;
  const searchable = list.length > 8;
  const titleId = `${uid}-title`;
  const addId = (t: TemplateInfo) => `${uid}-add-${t.id}`;

  const add = async (t: TemplateInfo) => {
    if (adding) return;
    setAdding(t.id);
    setProblem('');
    try {
      const got = blocksFromTemplate(await templates.blocksOf(t.id));

      if (!alive.current) return;
      if (!got.blocks.length) {
        setProblem(SKIPPED_MSG);
        setAdding('');
        return;
      }

      const words = [`Added “${t.name}”.`];

      if (got.unlinked) words.push(UNLINKED_MSG);
      if (got.skipped) words.push(SKIPPED_MSG);
      onAdd(got.blocks, words.join(' '));
    } catch (err) {
      if (!alive.current) return;
      setProblem(lErrorText(err));
      setAdding('');
      // It may have been deleted by someone else: show the list as it is now.
      templates.reload();
    }
  };

  const deleted = (t: TemplateInfo) => {
    const i = shown.findIndex((x) => x.id === t.id);
    const next = shown[i + 1] || shown[i - 1];

    setAsking('');
    setFocusId(next ? addId(next) : searchable ? `${uid}-search` : titleId);
  };

  return (
    <section aria-labelledby={titleId} className='flex flex-col gap-2' data-testid='carehub-learning-template-section'>
      <div className='flex flex-wrap items-end gap-x-3 gap-y-2'>
        <div className='min-w-0 flex-1'>
          <h3 id={titleId} tabIndex={-1} className='text-xs font-semibold uppercase tracking-wide text-text-tertiary outline-none'>
            Templates
          </h3>
          <p className='text-xs text-text-tertiary'>Your team’s saved blocks</p>
        </div>
        {searchable && (
          <input
            id={`${uid}-search`}
            type='search'
            value={query}
            placeholder='Search templates'
            aria-label='Search templates'
            autoComplete='off'
            className={cn(chInputClass, 'w-full sm:w-56')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.stopPropagation();
                setQuery('');
              }
            }}
          />
        )}
      </div>

      {problem && (
        <div role='alert'>
          <ChNote tone='error'>{problem}</ChNote>
        </div>
      )}
      {templates.status === 'error' && !list.length && (
        <ChNote tone='error'>
          <div className='flex flex-wrap items-center gap-2'>
            <span className='min-w-0 flex-1'>{templates.error}</span>
            <Button type='button' size='sm' variant='outline' className='cht-focus' onClick={templates.reload}>
              Try again
            </Button>
          </div>
        </ChNote>
      )}
      {templates.status === 'loading' && !list.length && <p className='text-xs text-text-tertiary'>Loading templates…</p>}
      {templates.status === 'live' && !list.length && (
        <p className='text-xs text-text-tertiary'>No templates yet. Use “Save as template” on any block to add one.</p>
      )}
      {q && !shown.length && <p className='text-xs text-text-tertiary'>No templates match “{query.trim()}”.</p>}

      {shown.length > 0 && (
        <ul className='grid grid-cols-1 gap-2 sm:grid-cols-2' aria-labelledby={titleId}>
          {shown.map((t) => (
            <li
              key={t.id}
              className='flex min-w-0 flex-col rounded-[10px] border border-border-primary'
              data-testid='carehub-learning-template'
            >
              {editing === t.id ? (
                <RenameForm
                  templates={templates}
                  template={t}
                  onDone={() => {
                    setEditing('');
                    setFocusId(`${uid}-ren-${t.id}`);
                  }}
                />
              ) : (
                <div className='flex min-w-0 items-start'>
                  <button
                    id={addId(t)}
                    type='button'
                    aria-disabled={adding ? true : undefined}
                    aria-busy={adding === t.id ? true : undefined}
                    onClick={() => void add(t)}
                    className={cn(
                      'cht-focus flex min-w-0 flex-1 items-start gap-2.5 self-stretch rounded-[10px] px-3 py-2.5 text-left hover:bg-fill-content-hover',
                      adding && adding !== t.id && 'opacity-60'
                    )}
                    data-testid='carehub-learning-add-template'
                  >
                    <span className='text-lg leading-6' aria-hidden='true'>
                      {t.block_count === 1 ? typeEmoji(t.block_types[0] || '') : '📚'}
                    </span>
                    <span className='min-w-0 flex-1'>
                      <span className='block break-words text-sm font-medium'>{t.name}</span>
                      <span className='block text-xs text-text-tertiary'>
                        {adding === t.id ? 'Adding…' : `${plural(t.block_count, 'block')} · saved by ${t.saved_by_name}`}
                      </span>
                    </span>
                  </button>
                  <div className='flex shrink-0 gap-0.5 p-1.5'>
                    <ActionButton
                      id={`${uid}-ren-${t.id}`}
                      label={`Rename “${t.name}”`}
                      onClick={() => {
                        setAsking('');
                        setEditing(t.id);
                      }}
                    >
                      ✏️
                    </ActionButton>
                    <ActionButton
                      id={`${uid}-del-${t.id}`}
                      label={`Delete “${t.name}”`}
                      danger
                      onClick={() => {
                        setEditing('');
                        setAsking(asking === t.id ? '' : t.id);
                      }}
                    >
                      🗑
                    </ActionButton>
                  </div>
                </div>
              )}
              {asking === t.id && editing !== t.id && (
                <DeleteAsk
                  templates={templates}
                  template={t}
                  onCancel={() => {
                    setAsking('');
                    setFocusId(`${uid}-del-${t.id}`);
                  }}
                  onDeleted={() => deleted(t)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

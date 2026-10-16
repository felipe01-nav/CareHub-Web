// CareHub: Claude assistant (like Notion AI). A chat with Claude that can
// float over the page, sit in a side panel, or fill the screen. Conversations
// are saved on the Care Hub server for each person (private to them), and
// Claude can read the page that is open when you ask about it.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import {
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  FileText,
  History,
  Maximize2,
  PanelRight,
  Pencil,
  PictureInPicture2,
  Search,
  Sparkles,
  Square,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react';

import { executeAPIRequest, getAxios } from '@/application/services/js-services/http/core';
import { getTokenParsed } from '@/application/session/token';
import { cn } from '@/lib/utils';
import { getPlatform } from '@/utils/platform';

const API = '/api/carehub/assistant';
const UI_KEY = 'carehub-assistant-ui';
const LAST_KEY = 'carehub-assistant-last';
const FLOAT_W = 420;
const FLOAT_H = 600;
const SIDE_MIN = 340;
const SIDE_MAX = 760;
const MAX_PAGE_CHARS = 60000;

type Mode = 'float' | 'side' | 'full';

interface UiState {
  open: boolean;
  mode: Mode;
  sideWidth: number;
  floatPos: { x: number; y: number } | null;
}

interface Conversation {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  body: string;
  context: string;
  created_at: number;
  pending?: boolean;
  error?: boolean;
}

// ---------------------------------------------------------------------------
// Shared panel state (open / mode / size), so the page layout can make room
// for the side panel.
// ---------------------------------------------------------------------------

function loadUi(): UiState {
  const base: UiState = { open: false, mode: 'float', sideWidth: 420, floatPos: null };

  try {
    const raw = window.localStorage.getItem(UI_KEY);

    if (!raw) return base;
    const v = JSON.parse(raw) as Partial<UiState>;

    return {
      open: false,
      mode: v.mode === 'side' || v.mode === 'full' ? v.mode : 'float',
      sideWidth: Math.min(SIDE_MAX, Math.max(SIDE_MIN, Number(v.sideWidth) || 420)),
      floatPos:
        v.floatPos && Number.isFinite(v.floatPos.x) && Number.isFinite(v.floatPos.y) ? v.floatPos : null,
    };
  } catch {
    return base;
  }
}

let ui: UiState = typeof window === 'undefined' ? { open: false, mode: 'float', sideWidth: 420, floatPos: null } : loadUi();
let enabled = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function setUi(patch: Partial<UiState>) {
  ui = { ...ui, ...patch };
  try {
    window.localStorage.setItem(
      UI_KEY,
      JSON.stringify({ mode: ui.mode, sideWidth: ui.sideWidth, floatPos: ui.floatPos })
    );
  } catch {
    // storage can be unavailable
  }

  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function useUi() {
  return useSyncExternalStore(subscribe, () => ui);
}

function useEnabled() {
  return useSyncExternalStore(subscribe, () => enabled);
}

/** Opens the Claude panel (optionally with a question ready to send). */
export function openCarehubAssistant() {
  if (!enabled) return;
  setUi({ open: true });
}

/** Width the page should leave free on the right for the docked panel. */
export function useCarehubAssistantDockWidth() {
  const state = useUi();
  const on = useEnabled();

  if (!on || !state.open || state.mode !== 'side' || getPlatform().isMobile) return 0;
  return state.sideWidth;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function call<T>(method: 'get' | 'post' | 'put' | 'delete', url: string, data?: unknown) {
  return executeAPIRequest<T>(() => getAxios()?.request({ method, url, data }));
}

function errorText(err: unknown) {
  const msg = (err as { message?: string })?.message;

  return msg && msg.trim() ? msg : 'Something went wrong. Please try again.';
}

function pageTitle() {
  const t = (document.title || '').replace(/\s*\|\s*Care Hub\s*$/, '').trim();

  return t === 'Care Hub' ? '' : t;
}

function onPage(pathname: string) {
  const parts = pathname.split('/').filter(Boolean);

  return parts[0] === 'app' && parts.length >= 3;
}

/** The visible text of the page that is open (editor text, or the database). */
function pageText() {
  const root = document.querySelector('.appflowy-scroll-container') as HTMLElement | null;

  if (!root) return '';
  const editors = Array.from(root.querySelectorAll('[data-slate-editor="true"]')) as HTMLElement[];
  const top = editors.filter((el) => !editors.some((other) => other !== el && other.contains(el)));
  let text = top.map((el) => el.innerText).join('\n\n').trim();

  if (!text) text = (root.innerText || '').trim();

  return text.replace(/\n{3,}/g, '\n\n').slice(0, MAX_PAGE_CHARS);
}

function today() {
  try {
    return new Date().toLocaleString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    return new Date().toString();
  }
}

function groupLabel(ms: number) {
  const now = new Date();
  const d = new Date(ms);
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  if (ms >= startToday) return 'Today';
  if (ms >= startToday - 86400000) return 'Yesterday';
  if (ms >= startToday - 6 * 86400000) return 'Previous 7 days';
  if (ms >= startToday - 29 * 86400000) return 'Previous 30 days';
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Small Markdown renderer (safe: builds React elements, never raw HTML)
// ---------------------------------------------------------------------------

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)|(~~[^~]+~~)|(\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;

  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${key}-${i++}`;

    if (m[1]) {
      out.push(
        <code key={k} className='rounded bg-fill-content-hover px-1 py-0.5 font-mono text-[0.85em]'>
          {tok.slice(1, -1)}
        </code>
      );
    } else if (m[2] || m[3]) {
      out.push(<strong key={k}>{inline(tok.slice(2, -2), k)}</strong>);
    } else if (m[4] || m[5]) {
      out.push(<em key={k}>{inline(tok.slice(1, -1), k)}</em>);
    } else if (m[6]) {
      out.push(<s key={k}>{inline(tok.slice(2, -2), k)}</s>);
    } else if (m[7]) {
      const label = tok.slice(1, tok.indexOf(']('));

      out.push(
        <a key={k} href={m[8]} target='_blank' rel='noreferrer' className='underline underline-offset-2'>
          {label}
        </a>
      );
    }

    last = m.index + tok.length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

function splitRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => {
    const lines = text.replace(/\r/g, '').split('\n');
    const out: ReactNode[] = [];
    let i = 0;
    let n = 0;

    while (i < lines.length) {
      const line = lines[i];
      const key = `b${n++}`;

      if (/^\s*```/.test(line)) {
        const code: string[] = [];

        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
        i++;
        out.push(
          <pre key={key} className='my-2 overflow-x-auto rounded-[8px] bg-fill-content-hover p-3 font-mono text-xs leading-5'>
            <code>{code.join('\n')}</code>
          </pre>
        );
        continue;
      }

      const h = /^(#{1,6})\s+(.*)$/.exec(line);

      if (h) {
        const level = h[1].length;
        const cls = level <= 1 ? 'text-lg' : level === 2 ? 'text-base' : 'text-sm';

        out.push(
          <div key={key} className={cn('mb-1 mt-3 font-semibold first:mt-0', cls)}>
            {inline(h[2], key)}
          </div>
        );
        i++;
        continue;
      }

      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        const head = splitRow(line);
        const rows: string[][] = [];

        i += 2;
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(splitRow(lines[i++]));
        out.push(
          <div key={key} className='my-2 overflow-x-auto'>
            <table className='w-full border-collapse text-xs'>
              <thead>
                <tr>
                  {head.map((c, ci) => (
                    <th key={ci} className='border border-border-primary px-2 py-1 text-left font-semibold'>
                      {inline(c, `${key}h${ci}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => (
                  <tr key={ri}>
                    {r.map((c, ci) => (
                      <td key={ci} className='border border-border-primary px-2 py-1 align-top'>
                        {inline(c, `${key}r${ri}c${ci}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        continue;
      }

      const listRe = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

      if (listRe.test(line)) {
        const items: { indent: number; ordered: boolean; text: string; num: string }[] = [];

        while (i < lines.length && listRe.test(lines[i])) {
          const m = listRe.exec(lines[i]) as RegExpExecArray;

          items.push({
            indent: Math.min(3, Math.floor(m[1].replace(/\t/g, '  ').length / 2)),
            ordered: /\d/.test(m[2]),
            num: m[2].replace(/[.)]$/, ''),
            text: m[3],
          });
          i++;
        }

        out.push(
          <div key={key} className='my-1.5 flex flex-col gap-0.5'>
            {items.map((it, ii) => (
              <div key={ii} className='flex gap-2' style={{ paddingLeft: it.indent * 18 }}>
                <span className='w-4 shrink-0 text-right text-text-secondary'>{it.ordered ? `${it.num}.` : '•'}</span>
                <span className='min-w-0 flex-1'>{inline(it.text, `${key}i${ii}`)}</span>
              </div>
            ))}
          </div>
        );
        continue;
      }

      if (/^\s*>/.test(line)) {
        const quote: string[] = [];

        while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
        out.push(
          <div key={key} className='my-2 border-l-2 border-border-primary pl-3 text-text-secondary'>
            {inline(quote.join(' '), key)}
          </div>
        );
        continue;
      }

      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
        out.push(<hr key={key} className='my-3 border-border-primary' />);
        i++;
        continue;
      }

      if (!line.trim()) {
        i++;
        continue;
      }

      const para: string[] = [];

      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^\s*```/.test(lines[i]) &&
        !/^#{1,6}\s/.test(lines[i]) &&
        !listRe.test(lines[i]) &&
        !/^\s*>/.test(lines[i]) &&
        !/^\s*\|.*\|\s*$/.test(lines[i])
      ) {
        para.push(lines[i++]);
      }

      out.push(
        <p key={key} className='my-1.5 first:mt-0 last:mb-0'>
          {para.map((p, pi) => (
            <span key={pi}>
              {pi > 0 && <br />}
              {inline(p, `${key}p${pi}`)}
            </span>
          ))}
        </p>
      );
    }

    return out;
  }, [text]);

  return <div className='break-words text-sm leading-6 text-text-primary'>{blocks}</div>;
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function IconButton({
  title,
  onClick,
  active,
  children,
  testId,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <button
      type='button'
      title={title}
      aria-label={title}
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-text-secondary hover:bg-fill-content-hover hover:text-text-primary',
        active && 'bg-fill-content-hover text-text-primary'
      )}
    >
      {children}
    </button>
  );
}

function ClaudeMark({ size = 24 }: { size?: number }) {
  return (
    <div
      className='flex shrink-0 items-center justify-center rounded-full bg-[#171717] text-white dark:bg-[#e5e5e5] dark:text-[#171717]'
      style={{ width: size, height: size }}
    >
      <Sparkles style={{ width: size * 0.55, height: size * 0.55 }} />
    </div>
  );
}

function HistoryList({
  conversations,
  currentId,
  onPick,
  onRename,
  onDelete,
  onNew,
  autoFocus,
}: {
  conversations: Conversation[];
  currentId: string | null;
  onPick: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = term
      ? conversations.filter((c) => (c.title || 'New chat').toLowerCase().includes(term))
      : conversations;
    const out: { label: string; items: Conversation[] }[] = [];

    list.forEach((c) => {
      const label = groupLabel(c.updated_at);
      const g = out.find((x) => x.label === label);

      if (g) g.items.push(c);
      else out.push({ label, items: [c] });
    });
    return out;
  }, [conversations, q]);

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='flex items-center gap-1 px-2 pb-2 pt-1'>
        <div className='flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[8px] border border-border-primary px-2'>
          <Search className='h-3.5 w-3.5 shrink-0 text-text-tertiary' />
          <input
            autoFocus={autoFocus}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder='Search chats'
            className='min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-text-tertiary'
          />
        </div>
        <IconButton title='New chat' onClick={onNew}>
          <SquarePen className='h-4 w-4' />
        </IconButton>
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto px-2 pb-2'>
        {groups.length === 0 && (
          <div className='px-2 py-6 text-center text-xs text-text-tertiary'>
            {q.trim() ? 'No chats found' : 'Your chats with Claude will show up here.'}
          </div>
        )}
        {groups.map((g) => (
          <div key={g.label} className='mb-2'>
            <div className='px-2 pb-1 pt-2 text-[11px] font-medium text-text-tertiary'>{g.label}</div>
            {g.items.map((c) =>
              editing === c.id ? (
                <form
                  key={c.id}
                  className='px-1 py-0.5'
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (draft.trim()) onRename(c.id, draft.trim());
                    setEditing(null);
                  }}
                >
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => setEditing(null)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.stopPropagation();
                        setEditing(null);
                      }
                    }}
                    className='h-8 w-full rounded-[6px] border border-border-theme-thick bg-transparent px-2 text-sm outline-none'
                  />
                </form>
              ) : (
                <div
                  key={c.id}
                  className={cn(
                    'group flex h-8 cursor-pointer items-center gap-1 rounded-[6px] px-2 text-sm hover:bg-fill-content-hover',
                    currentId === c.id && 'bg-fill-content-hover font-medium'
                  )}
                  onClick={() => onPick(c.id)}
                  data-testid='carehub-assistant-history-item'
                >
                  <span className='min-w-0 flex-1 truncate'>{c.title || 'New chat'}</span>
                  {confirm === c.id ? (
                    <span className='flex shrink-0 items-center gap-1 text-xs' onClick={(e) => e.stopPropagation()}>
                      <button type='button' className='font-medium text-[#ef4444]' onClick={() => onDelete(c.id)}>
                        Delete
                      </button>
                      <button type='button' className='text-text-secondary' onClick={() => setConfirm(null)}>
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <span className='hidden shrink-0 items-center group-hover:flex' onClick={(e) => e.stopPropagation()}>
                      <IconButton
                        title='Rename'
                        onClick={() => {
                          setDraft(c.title);
                          setEditing(c.id);
                        }}
                      >
                        <Pencil className='h-3.5 w-3.5' />
                      </IconButton>
                      <IconButton title='Delete' onClick={() => setConfirm(c.id)}>
                        <Trash2 className='h-3.5 w-3.5' />
                      </IconButton>
                    </span>
                  )}
                </div>
              )
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MessageView({ msg }: { msg: Msg }) {
  const [copied, setCopied] = useState(false);

  if (msg.role === 'user') {
    return (
      <div className='flex flex-col items-end gap-1'>
        <div className='max-w-[85%] whitespace-pre-wrap break-words rounded-[14px] bg-fill-content-hover px-3 py-2 text-sm leading-6 text-text-primary'>
          {msg.body}
        </div>
        {msg.context && (
          <div className='flex items-center gap-1 text-[11px] text-text-tertiary'>
            <FileText className='h-3 w-3' />
            <span className='max-w-[220px] truncate'>{msg.context}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className='group flex gap-2.5' data-testid='carehub-assistant-answer'>
      <ClaudeMark size={22} />
      <div className='min-w-0 flex-1 pt-px'>
        {msg.pending && !msg.body ? (
          <div className='flex h-6 items-center gap-1'>
            {[0, 1, 2].map((d) => (
              <span
                key={d}
                className='h-1.5 w-1.5 animate-pulse rounded-full bg-[#a3a3a3]'
                style={{ animationDelay: `${d * 160}ms` }}
              />
            ))}
          </div>
        ) : msg.error ? (
          <div className='rounded-[8px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-sm text-[#b91c1c] dark:border-[#7f1d1d] dark:bg-[#450a0a] dark:text-[#fecaca]'>
            {msg.body}
          </div>
        ) : (
          <Markdown text={msg.body} />
        )}
        {!msg.pending && !msg.error && msg.body && (
          <div className='mt-1 flex h-6 items-center opacity-0 transition-opacity group-hover:opacity-100'>
            <button
              type='button'
              className='flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-xs text-text-secondary hover:bg-fill-content-hover hover:text-text-primary'
              onClick={() => {
                void navigator.clipboard?.writeText(msg.body).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? <Check className='h-3.5 w-3.5' /> : <Copy className='h-3.5 w-3.5' />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CareHubAssistant() {
  const state = useUi();
  const on = useEnabled();
  const isMobile = getPlatform().isMobile;
  const location = useLocation();
  const mode: Mode = isMobile ? 'full' : state.mode;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentId, setCurrentIdState] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(LAST_KEY);
    } catch {
      return null;
    }
  });
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [usePage, setUsePage] = useState(true);
  const [title, setTitle] = useState('');
  const [notice, setNotice] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const currentRef = useRef<string | null>(currentId);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const stickRef = useRef(true);
  const skipLoadRef = useRef<string | null>(null);

  const setCurrentId = useCallback((id: string | null) => {
    currentRef.current = id;
    setCurrentIdState(id);
    try {
      if (id) window.localStorage.setItem(LAST_KEY, id);
      else window.localStorage.removeItem(LAST_KEY);
    } catch {
      // ignore
    }
  }, []);

  // Is Claude switched on for this Care Hub?
  useEffect(() => {
    let alive = true;

    call<{ enabled: boolean }>('get', `${API}/status`)
      .then((res) => {
        if (!alive) return;
        enabled = !!res?.enabled;
        emit();
      })
      .catch(() => {
        enabled = false;
        emit();
      });
    return () => {
      alive = false;
    };
  }, []);

  // Cmd/Ctrl + J opens and closes the panel (like Notion AI).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j') {
        if (!enabled) return;
        e.preventDefault();
        setUi({ open: !ui.open });
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const res = await call<{ conversations: Conversation[] }>('get', `${API}/conversations`);

      setConversations(res?.conversations ?? []);
    } catch {
      // keep the old list
    }
  }, []);

  useEffect(() => {
    if (state.open && on) void loadConversations();
  }, [state.open, on, loadConversations]);

  // Load the messages of the chosen conversation.
  useEffect(() => {
    if (!state.open || !on) return;
    if (!currentId) {
      setMessages([]);
      return;
    }

    if (skipLoadRef.current === currentId) {
      skipLoadRef.current = null;
      return;
    }

    let alive = true;

    setLoadingMessages(true);
    call<{ messages: Msg[] }>('get', `${API}/conversations/${currentId}/messages`)
      .then((res) => {
        if (!alive) return;
        setMessages(res?.messages ?? []);
        stickRef.current = true;
      })
      .catch(() => {
        if (!alive) return;
        // The conversation was deleted (or belongs to another account): start fresh.
        setCurrentId(null);
        setMessages([]);
      })
      .finally(() => {
        if (alive) setLoadingMessages(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, state.open, on]);

  // Keep the page name up to date (the browser tab title is "<page> | Care Hub").
  const pageOpen = onPage(location.pathname);

  useEffect(() => {
    if (!state.open) return;
    const read = () => setTitle(pageOpen ? pageTitle() : '');

    read();
    const t = window.setInterval(read, 1500);

    return () => window.clearInterval(t);
  }, [state.open, pageOpen, location.pathname]);

  // Scroll to the newest message while Claude writes (unless you scrolled up).
  useEffect(() => {
    const el = scrollRef.current;

    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (state.open && !showHistory) window.setTimeout(() => inputRef.current?.focus(), 50);
  }, [state.open, showHistory, currentId, mode]);

  const newChat = useCallback(() => {
    if (busy) abortRef.current?.abort();
    setCurrentId(null);
    setMessages([]);
    setShowHistory(false);
    setNotice('');
    setInput('');
    window.setTimeout(() => inputRef.current?.focus(), 50);
  }, [busy, setCurrentId]);

  const pick = useCallback(
    (id: string) => {
      if (busy) abortRef.current?.abort();
      setShowHistory(false);
      setNotice('');
      if (id !== currentRef.current) {
        setMessages([]);
        setCurrentId(id);
      }
    },
    [busy, setCurrentId]
  );

  const rename = useCallback(async (id: string, t: string) => {
    setConversations((list) => list.map((c) => (c.id === id ? { ...c, title: t } : c)));
    try {
      await call('put', `${API}/conversations/${id}`, { title: t });
    } catch (err) {
      setNotice(errorText(err));
    }
  }, []);

  const remove = useCallback(
    async (id: string) => {
      setConversations((list) => list.filter((c) => c.id !== id));
      if (currentRef.current === id) {
        setCurrentId(null);
        setMessages([]);
      }

      try {
        await call('delete', `${API}/conversations/${id}`);
      } catch (err) {
        setNotice(errorText(err));
        void loadConversations();
      }
    },
    [loadConversations, setCurrentId]
  );

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();

      if (!text || busy) return;
      setNotice('');
      setBusy(true);
      setInput('');
      stickRef.current = true;

      const withPage = usePage && pageOpen;
      const pTitle = withPage ? pageTitle() || 'Untitled' : '';
      const pText = withPage ? pageText() : '';
      const now = Date.now();
      const answerId = `a-${now}`;

      setMessages((list) => [
        ...list,
        { id: `q-${now}`, role: 'user', body: text, context: pText ? pTitle : '', created_at: now },
        { id: answerId, role: 'assistant', body: '', context: '', created_at: now + 1, pending: true },
      ]);

      const update = (patch: Partial<Msg>) => {
        setMessages((list) => list.map((m) => (m.id === answerId ? { ...m, ...patch } : m)));
      };

      let id = currentRef.current;

      try {
        if (!id) {
          const created = await call<Conversation>('post', `${API}/conversations`, {});

          if (!created?.id) throw new Error('Could not start a new chat. Please try again.');
          id = created.id;
          skipLoadRef.current = id;
          setCurrentId(id);
          setConversations((list) => [created, ...list]);
        }

        // A small request first, so an expired login gets refreshed.
        await call('get', `${API}/status`);
        const token = getTokenParsed()?.access_token;
        const base = (getAxios()?.defaults.baseURL || '').replace(/\/$/, '');
        const controller = new AbortController();

        abortRef.current = controller;
        const res = await fetch(`${base}${API}/conversations/${id}/ask`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ text, page_title: pText ? pTitle : '', page_text: pText, today: today() }),
          signal: controller.signal,
        });
        const type = res.headers.get('content-type') || '';

        if (!res.ok || type.includes('application/json')) {
          let message = `Claude could not answer (error ${res.status}).`;

          try {
            const body = (await res.json()) as { message?: string };

            if (body?.message) message = body.message;
          } catch {
            // keep the generic message
          }

          update({ body: message, pending: false, error: true });
          return;
        }

        const reader = res.body?.getReader();

        if (!reader) {
          update({ body: await res.text(), pending: false });
          return;
        }

        const decoder = new TextDecoder();
        let answer = '';

        for (;;) {
          const { done, value } = await reader.read();

          if (done) break;
          answer += decoder.decode(value, { stream: true });
          if (currentRef.current === id) update({ body: answer });
        }

        answer += decoder.decode();
        update({ body: answer, pending: false });
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') {
          setMessages((list) =>
            list
              .map((m) => (m.id === answerId ? { ...m, pending: false } : m))
              .filter((m) => !(m.id === answerId && !m.body))
          );
        } else {
          update({ body: errorText(err), pending: false, error: true });
        }
      } finally {
        abortRef.current = null;
        setBusy(false);
        void loadConversations();
        // The short title is written a few seconds after the first answer.
        window.setTimeout(() => void loadConversations(), 5000);
      }
    },
    [busy, usePage, pageOpen, setCurrentId, loadConversations]
  );

  const stop = () => abortRef.current?.abort();

  // ----- floating window drag -----
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const floatPos = useMemo(() => {
    const w = Math.min(FLOAT_W, window.innerWidth - 16);
    const h = Math.min(FLOAT_H, window.innerHeight - 16);
    const p = state.floatPos ?? { x: window.innerWidth - w - 24, y: window.innerHeight - h - 24 };

    return {
      x: Math.max(8, Math.min(p.x, window.innerWidth - w - 8)),
      y: Math.max(8, Math.min(p.y, window.innerHeight - h - 8)),
      w,
      h,
    };
  }, [state.floatPos]);

  const onHeaderPointerDown = (e: ReactPointerEvent) => {
    if (mode !== 'float') return;
    if ((e.target as HTMLElement).closest('button, input, textarea')) return;
    dragRef.current = { dx: e.clientX - floatPos.x, dy: e.clientY - floatPos.y };
    const move = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      setUi({ floatPos: { x: ev.clientX - dragRef.current.dx, y: ev.clientY - dragRef.current.dy } });
    };

    const up = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ----- side panel resize -----
  const onResizeDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = state.sideWidth;
    const move = (ev: PointerEvent) => {
      setUi({ sideWidth: Math.min(SIDE_MAX, Math.max(SIDE_MIN, startW + (startX - ev.clientX))) });
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
    };

    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (!on) return null;

  if (!state.open) {
    return (
      <button
        type='button'
        title='Ask Claude (⌘J)'
        aria-label='Ask Claude'
        data-testid='carehub-assistant-launcher'
        onClick={() => setUi({ open: true })}
        className='fixed bottom-5 right-5 z-[1000] flex h-11 w-11 items-center justify-center rounded-full bg-[#171717] text-white shadow-lg transition-transform hover:scale-105 dark:bg-[#e5e5e5] dark:text-[#171717]'
        style={isMobile ? { bottom: 84, right: 16 } : undefined}
      >
        <Sparkles className='h-5 w-5' />
      </button>
    );
  }

  const current = conversations.find((c) => c.id === currentId);
  const heading = currentId ? current?.title || 'New chat' : 'New chat';
  const empty = messages.length === 0 && !loadingMessages;
  const pageChip = pageOpen && title ? title : '';

  const suggestions = [
    ...(pageChip
      ? [
          { label: 'Summarize this page', send: true },
          { label: 'List the action items on this page', send: true },
          { label: 'Ask a question about this page…', send: false },
        ]
      : []),
    { label: 'Draft a friendly reply to a customer…', send: false },
    { label: 'Help me plan my week', send: true },
    { label: 'Brainstorm ideas for…', send: false },
  ];

  const containerStyle: CSSProperties =
    mode === 'float'
      ? { left: floatPos.x, top: floatPos.y, width: floatPos.w, height: floatPos.h }
      : mode === 'side'
      ? { top: 0, right: 0, bottom: 0, width: state.sideWidth }
      : { inset: 0 };

  const header = (
    <div
      className={cn(
        'flex h-11 shrink-0 select-none items-center gap-1 border-b border-border-primary px-2',
        mode === 'float' && 'cursor-grab active:cursor-grabbing'
      )}
      onPointerDown={onHeaderPointerDown}
    >
      {mode !== 'full' || isMobile ? (
        <button
          type='button'
          className='flex min-w-0 items-center gap-1 rounded-[6px] px-1.5 py-1 text-sm font-medium hover:bg-fill-content-hover'
          onClick={() => setShowHistory((v) => !v)}
          title='Chat history'
          data-testid='carehub-assistant-history'
        >
          <History className='h-4 w-4 shrink-0 text-text-secondary' />
          <span className='min-w-0 truncate'>{heading}</span>
          <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-text-tertiary transition-transform', showHistory && 'rotate-180')} />
        </button>
      ) : (
        <div className='flex min-w-0 items-center gap-2 px-1.5 text-sm font-medium'>
          <ClaudeMark size={20} />
          <span className='min-w-0 truncate'>{heading}</span>
        </div>
      )}
      <div className='flex-1' />
      <IconButton title='New chat' onClick={newChat} testId='carehub-assistant-new'>
        <SquarePen className='h-4 w-4' />
      </IconButton>
      {!isMobile && (
        <div className='mx-1 flex items-center rounded-[8px] bg-fill-content-hover p-0.5'>
          <IconButton title='Floating' active={mode === 'float'} onClick={() => setUi({ mode: 'float' })} testId='carehub-assistant-float'>
            <PictureInPicture2 className='h-4 w-4' />
          </IconButton>
          <IconButton title='Side panel' active={mode === 'side'} onClick={() => setUi({ mode: 'side' })} testId='carehub-assistant-side'>
            <PanelRight className='h-4 w-4' />
          </IconButton>
          <IconButton title='Full screen' active={mode === 'full'} onClick={() => setUi({ mode: 'full' })} testId='carehub-assistant-full'>
            <Maximize2 className='h-4 w-4' />
          </IconButton>
        </div>
      )}
      <IconButton title='Close (⌘J)' onClick={() => setUi({ open: false })} testId='carehub-assistant-close'>
        <X className='h-4 w-4' />
      </IconButton>
    </div>
  );

  const composer = (
    <div className='shrink-0 px-3 pb-3 pt-1'>
      {notice && <div className='px-1 pb-1 text-xs text-[#b91c1c]'>{notice}</div>}
      <div className='rounded-[14px] border border-border-primary bg-background-primary p-2 shadow-sm focus-within:border-border-theme-thick'>
        <textarea
          ref={inputRef}
          value={input}
          rows={1}
          onChange={(e) => {
            setInput(e.target.value);
            const el = e.target;

            el.style.height = 'auto';
            el.style.height = `${Math.min(200, el.scrollHeight)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(input);
              const el = e.currentTarget;

              el.style.height = 'auto';
            }
          }}
          placeholder={pageChip && usePage ? 'Ask Claude about this page, or anything…' : 'Ask Claude anything…'}
          className='max-h-[200px] min-h-[24px] w-full resize-none bg-transparent px-1.5 py-1 text-sm leading-6 outline-none placeholder:text-text-tertiary'
          data-testid='carehub-assistant-input'
        />
        <div className='flex items-center gap-2 pt-1'>
          {pageChip ? (
            <button
              type='button'
              onClick={() => setUsePage((v) => !v)}
              title={usePage ? 'Claude can read this page. Click to leave it out.' : 'Click to let Claude read this page.'}
              className={cn(
                'flex min-w-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
                usePage
                  ? 'border-border-primary text-text-primary'
                  : 'border-dashed border-border-primary text-text-tertiary line-through'
              )}
              data-testid='carehub-assistant-page'
            >
              <FileText className='h-3 w-3 shrink-0' />
              <span className='max-w-[180px] truncate'>{pageChip}</span>
            </button>
          ) : (
            <span className='text-[11px] text-text-tertiary'>Claude can make mistakes. Check important info.</span>
          )}
          <div className='flex-1' />
          {busy ? (
            <button
              type='button'
              title='Stop'
              onClick={stop}
              className='flex h-7 w-7 items-center justify-center rounded-full bg-[#171717] text-white dark:bg-[#e5e5e5] dark:text-[#171717]'
              data-testid='carehub-assistant-stop'
            >
              <Square className='h-3 w-3 fill-current' />
            </button>
          ) : (
            <button
              type='button'
              title='Send (Enter)'
              disabled={!input.trim()}
              onClick={() => void send(input)}
              className='flex h-7 w-7 items-center justify-center rounded-full bg-[#171717] text-white disabled:opacity-30 dark:bg-[#e5e5e5] dark:text-[#171717]'
              data-testid='carehub-assistant-send'
            >
              <ArrowUp className='h-4 w-4' />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const conversation = (
    <div className='relative flex min-h-0 flex-1 flex-col'>
      <div
        ref={scrollRef}
        className='min-h-0 flex-1 overflow-y-auto'
        onScroll={(e) => {
          const el = e.currentTarget;

          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        <div className={cn('mx-auto flex w-full flex-col gap-5 px-4 py-4', mode === 'full' && 'max-w-[760px] py-8')}>
          {loadingMessages && messages.length === 0 && (
            <div className='py-10 text-center text-xs text-text-tertiary'>Loading…</div>
          )}
          {empty && (
            <div className={cn('flex flex-col gap-4 pt-6', mode === 'full' && 'pt-[12vh]')}>
              <ClaudeMark size={36} />
              <div className='text-xl font-semibold text-text-primary'>How can I help you today?</div>
              <div className='flex flex-col gap-1'>
                {suggestions.map((s) => (
                  <button
                    key={s.label}
                    type='button'
                    className='rounded-[8px] px-2 py-1.5 text-left text-sm text-text-secondary hover:bg-fill-content-hover hover:text-text-primary'
                    onClick={() => {
                      if (s.send) {
                        void send(s.label);
                      } else {
                        setInput(s.label.replace(/…$/, ' '));
                        inputRef.current?.focus();
                      }
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <MessageView key={m.id} msg={m} />
          ))}
        </div>
      </div>
      <div className={cn('mx-auto w-full', mode === 'full' && 'max-w-[760px]')}>{composer}</div>
      {showHistory && (mode !== 'full' || isMobile) && (
        <div className='absolute inset-0 z-10 flex flex-col bg-background-primary pt-1'>
          <HistoryList
            autoFocus
            conversations={conversations}
            currentId={currentId}
            onPick={pick}
            onRename={(id, t) => void rename(id, t)}
            onDelete={(id) => void remove(id)}
            onNew={newChat}
          />
        </div>
      )}
    </div>
  );

  return (
    <div
      data-testid='carehub-assistant'
      className={cn(
        'fixed flex flex-col overflow-hidden bg-background-primary text-text-primary',
        mode === 'float' && 'z-[1100] rounded-[14px] border border-border-primary shadow-2xl',
        mode === 'side' && 'z-[60] border-l border-border-primary',
        mode === 'full' && 'z-[1200]'
      )}
      style={containerStyle}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          if (showHistory) setShowHistory(false);
          else if (mode !== 'side') setUi({ open: false });
        }
      }}
    >
      {mode === 'side' && (
        <div
          className='absolute bottom-0 left-0 top-0 z-20 w-1.5 cursor-col-resize hover:bg-[#d4d4d4] dark:hover:bg-[#404040]'
          onPointerDown={onResizeDown}
          title='Drag to resize'
        />
      )}
      {header}
      {mode === 'full' && !isMobile ? (
        <div className='flex min-h-0 flex-1'>
          <div className='flex w-[260px] shrink-0 flex-col border-r border-border-primary pt-2'>
            <HistoryList
              conversations={conversations}
              currentId={currentId}
              onPick={pick}
              onRename={(id, t) => void rename(id, t)}
              onDelete={(id) => void remove(id)}
              onNew={newChat}
            />
          </div>
          {conversation}
        </div>
      ) : (
        conversation
      )}
    </div>
  );
}

export default CareHubAssistant;

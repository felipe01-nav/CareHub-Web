// CareHub Messages: direct messages and group chats between people in your
// workspace. Messages are stored on the Care Hub server; the page asks for new
// messages every few seconds while it is open, and the sidebar shows how many
// are unread. With permission, the browser also shows a notification.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { executeAPIRequest, getAxios } from '@/application/services/js-services/http/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import {
  AttachedPages,
  filterPages,
  GrantAccessDialog,
  PageCard,
  type PageEntry,
  PageGlyph,
  PageMentionList,
  PagePickerDialog,
  pagesInText,
  pageToken,
  plainMessageText,
  type ShareCheckPage,
  splitMessage,
  useSharablePages,
} from './CareHubSharePage';

export const CAREHUB_MESSAGES_PATH = '/app/messages';
const API = '/api/carehub/messages';
const OPEN_CHAT_POLL_MS = 3000;
const CHAT_LIST_POLL_MS = 10000;
const UNREAD_POLL_MS = 20000;

export interface Person {
  uuid: string;
  name: string;
  email: string;
  avatar: string;
}

export interface Chat {
  id: string;
  name: string;
  is_group: boolean;
  updated_at: number;
  unread: number;
  members: Person[];
  last: null | { body: string; deleted: boolean; mine: boolean; sender_name: string; created_at: number };
}

interface Message {
  id: string;
  mine: boolean;
  sender: Person | null;
  body: string;
  created_at: number;
  edited_at: number;
  deleted: boolean;
  pending?: boolean;
  failed?: boolean;
}

function call<T>(method: 'get' | 'post' | 'put' | 'delete', url: string, data?: unknown) {
  return executeAPIRequest<T>(() => getAxios()?.request({ method, url, data }));
}

function errorText(err: unknown) {
  const msg = (err as { message?: string })?.message;

  return msg && msg.trim() ? msg : 'Something went wrong. Please try again.';
}

export function personName(p: Person | null | undefined) {
  if (!p) return 'Someone';

  return p.name?.trim() || p.email?.split('@')[0] || 'Someone';
}

export function chatTitle(chat: Chat) {
  if (chat.name.trim()) return chat.name.trim();
  if (chat.members.length === 0) return 'Only you';

  return chat.members.map(personName).join(', ');
}

function lastPreview(chat: Chat) {
  const last = chat.last;

  if (!last) return 'No messages yet';
  const text = last.deleted ? 'Message deleted' : plainMessageText(last.body).replace(/\s+/g, ' ');

  if (last.mine) return `You: ${text}`;
  if (chat.is_group && last.sender_name) return `${last.sender_name.split(' ')[0]}: ${text}`;

  return text;
}

const DAY = 86400000;

function startOfDay(t: number) {
  const d = new Date(t);

  d.setHours(0, 0, 0, 0);

  return d.getTime();
}

const fmtTime = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function fmtListTime(t: number) {
  if (!t) return '';
  const today = startOfDay(Date.now());

  if (t >= today) return fmtTime(t);
  if (t >= today - DAY) return 'Yesterday';
  if (t >= today - 6 * DAY) return new Date(t).toLocaleDateString([], { weekday: 'short' });

  return new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function fmtDayHeader(t: number) {
  const today = startOfDay(Date.now());
  const day = startOfDay(t);

  if (day === today) return 'Today';
  if (day === today - DAY) return 'Yesterday';

  return new Date(t).toLocaleDateString([], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: day < today - 300 * DAY ? 'numeric' : undefined,
  });
}

function useNarrow(limit = 768) {
  const get = () => (typeof window === 'undefined' ? false : window.innerWidth < limit);
  const [narrow, setNarrow] = useState(get);

  useEffect(() => {
    const onResize = () => setNarrow(get());

    window.addEventListener('resize', onResize);

    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);

  return narrow;
}

// ---------------------------------------------------------------------------
// unread count (shared by the sidebar and the page) + notifications
// ---------------------------------------------------------------------------

interface UnreadState {
  unread: number;
  latest: number;
}

let unreadState: UnreadState = { unread: 0, latest: 0 };
const unreadListeners = new Set<(s: UnreadState) => void>();
let unreadStarted = false;
let unreadInitialised = false;

function publishUnread(next: UnreadState) {
  unreadState = next;
  unreadListeners.forEach((fn) => fn(next));
  try {
    const base = document.title.replace(/^\(\d+\) /, '');

    document.title = next.unread > 0 ? `(${next.unread}) ${base}` : base;
  } catch {
    // ignore
  }
}

async function notifyNewMessage() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const onMessages = window.location.pathname === CAREHUB_MESSAGES_PATH;

  if (onMessages && !document.hidden) return;
  try {
    const res = await call<{ chats: Chat[] }>('get', `${API}/chats`);
    const chat = (res?.chats ?? []).find((c) => c.unread > 0 && c.last && !c.last.mine);

    if (!chat || !chat.last) return;
    const who = chat.is_group ? `${chat.last.sender_name} in ${chatTitle(chat)}` : chat.last.sender_name || chatTitle(chat);
    const note = new Notification(who || 'New message', {
      body: chat.last.deleted ? 'Message deleted' : plainMessageText(chat.last.body),
      tag: `carehub-chat-${chat.id}`,
    });

    note.onclick = () => {
      window.focus();
      window.location.href = `${CAREHUB_MESSAGES_PATH}?chat=${chat.id}`;
    };
  } catch {
    // notifications are optional
  }
}

export async function refreshCareHubUnread() {
  try {
    const res = await call<UnreadState>('get', `${API}/unread`);
    const next = { unread: res?.unread ?? 0, latest: res?.latest ?? 0 };

    if (unreadInitialised && next.latest > unreadState.latest && next.unread > 0) {
      void notifyNewMessage();
    }

    unreadInitialised = true;
    publishUnread(next);
  } catch {
    // The server may not have Messages yet; try again later.
  }
}

function startUnreadPolling() {
  if (unreadStarted) return;
  unreadStarted = true;
  void refreshCareHubUnread();
  window.setInterval(() => void refreshCareHubUnread(), UNREAD_POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refreshCareHubUnread();
  });
}

export function useCareHubUnread() {
  const [state, setState] = useState(unreadState);

  useEffect(() => {
    unreadListeners.add(setState);
    startUnreadPolling();

    return () => {
      // Polling keeps running: one timer for the whole app.
      unreadListeners.delete(setState);
    };
  }, []);

  return state.unread;
}

// ---------------------------------------------------------------------------
// small pieces
// ---------------------------------------------------------------------------

function initials(p: Person | null | undefined) {
  const name = personName(p);
  const parts = name.split(/\s+/).filter(Boolean);

  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

export function Avatar({ person, size = 32, group }: { person?: Person | null; size?: number; group?: Person[] }) {
  if (group && group.length > 1) {
    return (
      <div className='relative shrink-0' style={{ width: size, height: size }}>
        <div className='absolute left-0 top-0'>
          <Avatar person={group[0]} size={Math.round(size * 0.68)} />
        </div>
        <div className='absolute bottom-0 right-0 rounded-full ring-2 ring-background-primary'>
          <Avatar person={group[1]} size={Math.round(size * 0.68)} />
        </div>
      </div>
    );
  }

  const avatar = person?.avatar?.trim() ?? '';
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.4)) };

  if (/^https?:\/\//.test(avatar)) {
    return <img src={avatar} alt='' className='shrink-0 rounded-full object-cover' style={style} />;
  }

  if (avatar && avatar.length <= 8 && !/^[\w-]+$/.test(avatar)) {
    return (
      <div className='flex shrink-0 items-center justify-center rounded-full bg-fill-content-hover' style={style}>
        <span style={{ fontSize: Math.round(size * 0.55) }}>{avatar}</span>
      </div>
    );
  }

  return (
    <div
      className='flex shrink-0 items-center justify-center rounded-full bg-[#171717] font-medium text-white dark:bg-[#e5e5e5] dark:text-[#171717]'
      style={style}
    >
      {initials(person)}
    </div>
  );
}

export function ChatBubbleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor'
      strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
      <path d='M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12Z' />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8'
      strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
      <path d='M12 20h9' />
      <path d='M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z' />
    </svg>
  );
}

function IconButton({ label, onClick, children, testId }: { label: string; onClick: () => void; children: ReactNode; testId?: string }) {
  return (
    <button
      type='button'
      aria-label={label}
      title={label}
      data-testid={testId}
      onClick={onClick}
      className='flex h-8 w-8 items-center justify-center rounded-[8px] text-text-secondary hover:bg-fill-content-hover hover:text-text-primary'
    >
      {children}
    </button>
  );
}

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;

function MessageText({ text }: { text: string }) {
  const parts = splitMessage(text);

  if (parts.length === 1 && 'text' in parts[0]) return <LinkText text={text} />;
  return (
    <>
      {parts.map((part, i) =>
        'page' in part ? (
          <PageCard key={i} page={part.page} />
        ) : part.text.trim() ? (
          <LinkText key={i} text={part.text.replace(/^\n+|\n+$/g, '')} />
        ) : null
      )}
    </>
  );
}

function LinkText({ text }: { text: string }) {
  const parts = text.split(URL_RE);

  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} target='_blank' rel='noreferrer' className='break-all underline underline-offset-2'>
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// page
// ---------------------------------------------------------------------------

export default function CareHubMessagesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const narrow = useNarrow();
  const [chats, setChats] = useState<Chat[]>([]);
  const [loadedChats, setLoadedChats] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [notifyAsk, setNotifyAsk] = useState(
    () => typeof Notification !== 'undefined' && Notification.permission === 'default'
  );
  const activeId = new URLSearchParams(location.search).get('chat') || '';

  const openChat = useCallback(
    (id: string) => {
      navigate(id ? `${CAREHUB_MESSAGES_PATH}?chat=${id}` : CAREHUB_MESSAGES_PATH);
    },
    [navigate]
  );

  const loadChats = useCallback(async () => {
    try {
      const res = await call<{ chats: Chat[] }>('get', `${API}/chats`);

      setChats(res?.chats ?? []);
      setLoadedChats(true);
      setError('');
    } catch (err) {
      setLoadedChats(true);
      setError(`Could not load messages: ${errorText(err)}`);
    }
  }, []);

  useEffect(() => {
    void loadChats();
    const timer = window.setInterval(() => void loadChats(), CHAT_LIST_POLL_MS);

    return () => window.clearInterval(timer);
  }, [loadChats]);

  const active = chats.find((c) => c.id === activeId) ?? null;

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();

    if (!q) return chats;

    return chats.filter(
      (c) =>
        chatTitle(c).toLowerCase().includes(q) ||
        c.members.some((m) => m.email.toLowerCase().includes(q))
    );
  }, [chats, filter]);

  const showList = !narrow || !activeId;
  const showChat = !narrow || Boolean(activeId);

  return (
    <div
      style={{ height: 'calc(100vh - 48px)' }}
      className='carehub-messages flex w-full min-w-0 flex-1 overflow-hidden bg-background-primary text-text-primary'
      data-testid='carehub-messages'
    >
      {showList && (
        <div
          className={cn(
            'flex shrink-0 flex-col border-r border-border-primary bg-surface-container-layer-00',
            narrow ? 'w-full border-r-0' : 'w-[300px]'
          )}
        >
          <div className='flex h-12 shrink-0 items-center gap-2 px-3'>
            <div className='flex-1 text-base font-semibold'>Messages</div>
            <IconButton label='New message' onClick={() => setNewOpen(true)} testId='carehub-messages-new'>
              <PencilIcon />
            </IconButton>
          </div>
          <div className='px-3 pb-2'>
            <Input placeholder='Search' value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          {notifyAsk && (
            <div className='mx-3 mb-2 rounded-[8px] border border-border-primary p-2.5 text-xs text-text-secondary'>
              Get a notification when someone messages you.
              <div className='mt-2 flex gap-2'>
                <Button
                  size='sm'
                  onClick={async () => {
                    try {
                      await Notification.requestPermission();
                    } catch {
                      // ignore
                    }

                    setNotifyAsk(false);
                  }}
                >
                  Turn on
                </Button>
                <Button size='sm' variant='ghost' onClick={() => setNotifyAsk(false)}>
                  Not now
                </Button>
              </div>
            </div>
          )}
          <div className='flex-1 overflow-y-auto px-1.5 pb-3' data-testid='carehub-chat-list'>
            {error && <div className='px-2 py-2 text-xs text-text-secondary'>{error}</div>}
            {loadedChats && !error && chats.length === 0 && (
              <div className='px-3 py-6 text-center text-sm text-text-secondary'>
                No conversations yet.
                <div className='mt-3'>
                  <Button size='sm' onClick={() => setNewOpen(true)}>
                    Start a conversation
                  </Button>
                </div>
              </div>
            )}
            {shown.map((chat) => (
              <button
                key={chat.id}
                type='button'
                data-testid='carehub-chat-row'
                onClick={() => openChat(chat.id)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-[8px] px-2 py-2 text-left hover:bg-fill-content-hover',
                  chat.id === activeId && 'bg-fill-content-hover'
                )}
              >
                <Avatar person={chat.members[0]} group={chat.members.length > 1 ? chat.members : undefined} size={34} />
                <div className='min-w-0 flex-1'>
                  <div className='flex items-baseline gap-2'>
                    <div className={cn('min-w-0 flex-1 truncate text-sm', chat.unread > 0 ? 'font-semibold' : 'font-medium')}>
                      {chatTitle(chat)}
                    </div>
                    <div className='shrink-0 text-[11px] text-text-tertiary'>{fmtListTime(chat.last?.created_at ?? chat.updated_at)}</div>
                  </div>
                  <div className='flex items-center gap-2'>
                    <div className={cn('min-w-0 flex-1 truncate text-xs', chat.unread > 0 ? 'text-text-primary' : 'text-text-secondary')}>
                      {lastPreview(chat)}
                    </div>
                    {chat.unread > 0 && (
                      <span className='flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-[#ef4444] px-1 text-[10px] font-semibold text-white'>
                        {chat.unread > 99 ? '99+' : chat.unread}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {showChat && (
        <div className='flex min-w-0 flex-1 flex-col'>
          {active ? (
            <Conversation
              key={active.id}
              chat={active}
              narrow={narrow}
              onBack={() => openChat('')}
              onChanged={loadChats}
              onLeft={async () => {
                openChat('');
                await loadChats();
              }}
            />
          ) : activeId && !loadedChats ? null : (
            <div className='flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-text-secondary'>
              <ChatBubbleIcon className='h-8 w-8' />
              <div className='text-sm'>Choose a conversation, or start a new one.</div>
              <Button size='sm' onClick={() => setNewOpen(true)}>
                New message
              </Button>
            </div>
          )}
        </div>
      )}

      {newOpen && (
        <PeoplePicker
          title='New message'
          action='Start chat'
          allowName
          onClose={() => setNewOpen(false)}
          onPick={async (members, name) => {
            const chat = await call<Chat>('post', `${API}/chats`, { members, name });

            setNewOpen(false);
            await loadChats();
            if (chat?.id) openChat(chat.id);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// one conversation
// ---------------------------------------------------------------------------

function Conversation({
  chat,
  narrow,
  onBack,
  onChanged,
  onLeft,
}: {
  chat: Chat;
  narrow: boolean;
  onBack: () => void;
  onChanged: () => Promise<void>;
  onLeft: () => Promise<void>;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [othersReadAt, setOthersReadAt] = useState(0);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [menu, setMenu] = useState(false);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [attached, setAttached] = useState<PageEntry[]>([]);
  const [pickingPage, setPickingPage] = useState(false);
  const [mention, setMention] = useState<{ start: number; end: number; query: string } | null>(null);
  const [mentionActive, setMentionActive] = useState(0);
  const [grantAsk, setGrantAsk] = useState<{ body: string; pages: PageEntry[]; checks: ShareCheckPage[] } | null>(
    null
  );
  const sharablePages = useSharablePages();
  const mentionPages = useMemo(
    () =>
      mention
        ? filterPages(
            sharablePages.filter((p) => !attached.some((a) => a.viewId === p.viewId)),
            mention.query,
            8
          )
        : [],
    [mention, sharablePages, attached]
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const cursorRef = useRef(0);
  const stickRef = useRef(true);

  const merge = useCallback((incoming: Message[]) => {
    if (incoming.length === 0) return;
    for (const m of incoming) cursorRef.current = Math.max(cursorRef.current, m.created_at, m.edited_at);
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));

      for (const m of incoming) byId.set(m.id, m);

      return Array.from(byId.values()).sort((a, b) => a.created_at - b.created_at);
    });
  }, []);

  const markRead = useCallback(async () => {
    if (document.hidden) return;
    try {
      await call('post', `${API}/chats/${chat.id}/read`);
      void refreshCareHubUnread();
      void onChanged();
    } catch {
      // ignore
    }
  }, [chat.id, onChanged]);

  // first page
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await call<{ messages: Message[]; has_more: boolean; others_read_at: number }>(
          'get',
          `${API}/chats/${chat.id}/messages`
        );

        if (cancelled) return;
        cursorRef.current = 0;
        setMessages([]);
        merge(res?.messages ?? []);
        setHasMore(Boolean(res?.has_more));
        setOthersReadAt(res?.others_read_at ?? 0);
        setLoaded(true);
        void markRead();
      } catch (err) {
        if (!cancelled) setError(errorText(err));
        setLoaded(true);
      }
    })();
    inputRef.current?.focus();

    return () => {
      cancelled = true;
    };
  }, [chat.id, merge, markRead]);

  // new messages
  useEffect(() => {
    if (!loaded) return;
    const timer = window.setInterval(async () => {
      try {
        const res = await call<{ messages: Message[]; others_read_at: number }>(
          'get',
          `${API}/chats/${chat.id}/messages?after=${cursorRef.current}`
        );
        const incoming = res?.messages ?? [];

        setOthersReadAt(res?.others_read_at ?? 0);
        if (incoming.length) {
          merge(incoming);
          if (incoming.some((m) => !m.mine)) void markRead();
        }
      } catch {
        // try again next time
      }
    }, OPEN_CHAT_POLL_MS);

    const onVisible = () => {
      if (!document.hidden) void markRead();
    };

    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [chat.id, loaded, merge, markRead]);

  // keep scrolled to the bottom unless the person scrolled up
  useEffect(() => {
    const el = scrollRef.current;

    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const loadOlder = async () => {
    const first = messages.find((m) => !m.pending);

    if (!first) return;
    const el = scrollRef.current;
    const before = el ? el.scrollHeight - el.scrollTop : 0;

    try {
      const res = await call<{ messages: Message[]; has_more: boolean }>(
        'get',
        `${API}/chats/${chat.id}/messages?before=${first.created_at}`
      );

      stickRef.current = false;
      merge(res?.messages ?? []);
      setHasMore(Boolean(res?.has_more));
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - before;
      });
    } catch (err) {
      setError(errorText(err));
    }
  };

  // Page cards go at the end of the message text.
  const composeBody = (text: string, pages: PageEntry[]) =>
    [text.trim(), ...pages.map((p) => pageToken(p))].filter(Boolean).join('\n');

  const findMention = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const match = /(^|\s)@([^\s@]{0,40})$/.exec(before);

    if (!match) return null;
    return { start: caret - match[2].length - 1, end: caret, query: match[2] };
  };

  const pickMention = (page: PageEntry) => {
    if (!mention) return;
    const next = draft.slice(0, mention.start) + draft.slice(mention.end);

    setDraft(next);
    setAttached((prev) => (prev.some((p) => p.viewId === page.viewId) ? prev : [...prev, page].slice(0, 10)));
    setMention(null);
    setMentionActive(0);
    requestAnimationFrame(() => {
      const el = inputRef.current;

      if (!el) return;
      el.focus();
      el.setSelectionRange(mention.start, mention.start);
    });
  };

  // Before sending page cards, check that everyone in the chat can open them.
  const submit = async (text: string, pages: PageEntry[]) => {
    const body = composeBody(text, pages);

    if (!body) return;
    setDraft('');
    setAttached([]);
    setMention(null);
    if (inputRef.current) inputRef.current.style.height = 'auto';
    if (pagesInText(body).length && chat.members.length) {
      try {
        const res = await call<{ pages: ShareCheckPage[] }>('post', `${API}/chats/${chat.id}/share-check`, { body });
        const checks = res?.pages ?? [];

        if (checks.some((c) => c.missing.length) || pages.some((p) => p.isPrivate)) {
          setGrantAsk({ body, pages, checks });
          return;
        }
      } catch {
        // checking is optional; send anyway
      }
    }

    void send(body);
  };

  const send = async (text: string, retryId?: string, grant = false) => {
    const body = text.trim();

    if (!body) return;
    const tempId = retryId ?? `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const temp: Message = {
      id: tempId,
      mine: true,
      sender: null,
      body,
      created_at: Date.now() + 1e12,
      edited_at: 0,
      deleted: false,
      pending: true,
    };

    stickRef.current = true;
    setMessages((prev) => [...prev.filter((m) => m.id !== tempId), temp]);
    try {
      const saved = await call<Message & { granted?: string[] }>('post', `${API}/chats/${chat.id}/messages`, {
        body,
        grant,
      });

      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      if (saved) merge([saved]);
      if (saved?.granted?.length) setError(`${saved.granted.join(', ')} can now open the shared page.`);
      void onChanged();
    } catch (err) {
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, failed: true } : m)));
      setError(errorText(err));
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    const text = editing.text.trim();

    if (!text) return;
    try {
      await call('put', `${API}/message/${editing.id}`, { body: text });
      setMessages((prev) => prev.map((m) => (m.id === editing.id ? { ...m, body: text, edited_at: Date.now() } : m)));
      setEditing(null);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const remove = async (id: string) => {
    try {
      await call('delete', `${API}/message/${id}`);
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, body: '', deleted: true } : m)));
      void onChanged();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const lastMineSeen = useMemo(() => {
    if (chat.is_group) return '';
    const mine = [...messages].reverse().find((m) => m.mine && !m.pending);

    return mine && othersReadAt >= mine.created_at ? mine.id : '';
  }, [chat.is_group, messages, othersReadAt]);

  const title = chatTitle(chat);

  return (
    <>
      <div className='flex h-12 shrink-0 items-center gap-2 border-b border-border-primary px-3'>
        {narrow && (
          <IconButton label='Back' onClick={onBack}>
            <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'
              strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
              <path d='m15 18-6-6 6-6' />
            </svg>
          </IconButton>
        )}
        <Avatar person={chat.members[0]} group={chat.members.length > 1 ? chat.members : undefined} size={28} />
        <div className='min-w-0 flex-1'>
          <div className='truncate text-sm font-semibold' data-testid='carehub-chat-title'>{title}</div>
          {chat.is_group && (
            <div className='truncate text-[11px] text-text-tertiary'>{chat.members.length + 1} people</div>
          )}
        </div>
        <div className='relative'>
          <IconButton label='Conversation options' onClick={() => setMenu((v) => !v)}>
            <svg width='16' height='16' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
              <circle cx='5' cy='12' r='1.6' />
              <circle cx='12' cy='12' r='1.6' />
              <circle cx='19' cy='12' r='1.6' />
            </svg>
          </IconButton>
          {menu && (
            <div
              className='absolute right-0 top-9 z-[20] w-48 rounded-[10px] border border-border-primary bg-background-primary p-1 shadow-lg'
              onMouseLeave={() => setMenu(false)}
            >
              {[
                { label: 'Add people', run: () => setAdding(true) },
                { label: chat.is_group ? 'Rename' : 'Name this chat', run: () => setRenaming(chat.name || '') },
                {
                  label: 'Leave conversation',
                  run: async () => {
                    if (!window.confirm('Leave this conversation? You will no longer see its messages.')) return;
                    try {
                      await call('put', `${API}/chats/${chat.id}`, { leave: true });
                      await onLeft();
                    } catch (err) {
                      setError(errorText(err));
                    }
                  },
                },
              ].map((item) => (
                <button
                  key={item.label}
                  type='button'
                  className='block w-full rounded-[6px] px-2.5 py-1.5 text-left text-sm hover:bg-fill-content-hover'
                  onClick={() => {
                    setMenu(false);
                    void item.run();
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {renaming !== null && (
        <form
          className='flex items-center gap-2 border-b border-border-primary px-3 py-2'
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await call('put', `${API}/chats/${chat.id}`, { name: renaming });
              setRenaming(null);
              await onChanged();
            } catch (err) {
              setError(errorText(err));
            }
          }}
        >
          <Input autoFocus placeholder='Conversation name' value={renaming} onChange={(e) => setRenaming(e.target.value)} />
          <Button size='sm' type='submit'>Save</Button>
          <Button size='sm' variant='ghost' type='button' onClick={() => setRenaming(null)}>Cancel</Button>
        </form>
      )}

      <div
        ref={scrollRef}
        className='flex-1 overflow-y-auto px-4 py-3'
        data-testid='carehub-chat-messages'
        onScroll={(e) => {
          const el = e.currentTarget;

          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {hasMore && (
          <div className='mb-3 text-center'>
            <Button size='sm' variant='ghost' onClick={loadOlder}>
              Show earlier messages
            </Button>
          </div>
        )}
        {loaded && messages.length === 0 && (
          <div className='flex h-full flex-col items-center justify-center gap-2 text-center text-text-secondary'>
            <Avatar person={chat.members[0]} group={chat.members.length > 1 ? chat.members : undefined} size={48} />
            <div className='text-sm font-medium text-text-primary'>{title}</div>
            <div className='text-xs'>This is the start of your conversation.</div>
          </div>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || startOfDay(prev.created_at) !== startOfDay(m.created_at);
          const grouped =
            !newDay && prev && prev.mine === m.mine && prev.sender?.uuid === m.sender?.uuid && m.created_at - prev.created_at < 5 * 60000;
          const shownTime = m.pending ? Date.now() : m.created_at;

          return (
            <div key={m.id}>
              {newDay && !m.pending && (
                <div className='my-3 flex items-center gap-3 text-[11px] font-medium text-text-tertiary'>
                  <div className='h-px flex-1 bg-border-primary' />
                  {fmtDayHeader(m.created_at)}
                  <div className='h-px flex-1 bg-border-primary' />
                </div>
              )}
              <div
                className={cn('group relative flex gap-2.5 rounded-[8px] px-2 hover:bg-fill-content-hover/50', grouped ? 'py-0.5' : 'mt-2 py-1')}
                data-testid='carehub-message'
              >
                <div className='w-8 shrink-0'>
                  {!grouped && (m.mine ? <MeAvatar /> : <Avatar person={m.sender} size={32} />)}
                </div>
                <div className='min-w-0 flex-1'>
                  {!grouped && (
                    <div className='flex items-baseline gap-2'>
                      <span className='text-sm font-semibold'>{m.mine ? 'You' : personName(m.sender)}</span>
                      <span className='text-[11px] text-text-tertiary'>{fmtTime(shownTime)}</span>
                    </div>
                  )}
                  {editing?.id === m.id ? (
                    <div className='mt-1 flex flex-col gap-2'>
                      <textarea
                        autoFocus
                        className='min-h-[60px] w-full resize-y rounded-[8px] border border-border-primary bg-transparent p-2 text-sm outline-none focus:border-border-theme-thick'
                        value={editing.text}
                        onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            void saveEdit();
                          }

                          if (e.key === 'Escape') setEditing(null);
                        }}
                      />
                      <div className='flex gap-2'>
                        <Button size='sm' onClick={saveEdit}>Save</Button>
                        <Button size='sm' variant='ghost' onClick={() => setEditing(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={cn(
                        'whitespace-pre-wrap break-words text-sm leading-relaxed',
                        m.deleted && 'italic text-text-tertiary',
                        m.pending && !m.failed && 'opacity-60'
                      )}
                    >
                      {m.deleted ? 'Message deleted' : <MessageText text={m.body} />}
                      {m.edited_at > 0 && !m.deleted && <span className='ml-1 text-[11px] text-text-tertiary'>(edited)</span>}
                    </div>
                  )}
                  {m.failed && (
                    <div className='mt-0.5 text-xs text-[#dc2626]'>
                      Not sent.{' '}
                      <button type='button' className='underline' onClick={() => void send(m.body, m.id)}>
                        Try again
                      </button>
                    </div>
                  )}
                  {lastMineSeen === m.id && <div className='mt-0.5 text-[11px] text-text-tertiary'>Seen</div>}
                </div>
                {m.mine && !m.deleted && !m.pending && editing?.id !== m.id && (
                  <div className='absolute right-2 top-0 hidden -translate-y-1/2 gap-0.5 rounded-[8px] border border-border-primary bg-background-primary p-0.5 shadow-sm group-hover:flex'>
                    <button
                      type='button'
                      className='rounded-[6px] px-2 py-0.5 text-xs hover:bg-fill-content-hover'
                      onClick={() => setEditing({ id: m.id, text: m.body })}
                    >
                      Edit
                    </button>
                    <button
                      type='button'
                      className='rounded-[6px] px-2 py-0.5 text-xs hover:bg-fill-content-hover'
                      onClick={() => {
                        if (window.confirm('Delete this message?')) void remove(m.id);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <div role='alert' className='mx-4 mb-2 flex items-center gap-3 rounded-[8px] border border-border-primary px-3 py-2 text-xs'>
          <span className='flex-1 text-text-secondary'>{error}</span>
          <button type='button' className='text-text-secondary hover:text-text-primary' onClick={() => setError('')}>
            Dismiss
          </button>
        </div>
      )}

      <form
        className='relative shrink-0 px-4 pb-4'
        onSubmit={(e) => {
          e.preventDefault();
          void submit(draft, attached);
        }}
      >
        {mention && (
          <div className='relative'>
            <PageMentionList pages={mentionPages} active={mentionActive} onPick={pickMention} />
          </div>
        )}
        <AttachedPages pages={attached} onRemove={(id) => setAttached((prev) => prev.filter((p) => p.viewId !== id))} />
        <div className='flex items-end gap-2 rounded-[12px] border border-border-primary bg-background-primary p-2 focus-within:border-border-theme-thick'>
          <button
            type='button'
            title='Share a page (or type @)'
            aria-label='Share a page'
            data-testid='carehub-share-page'
            onClick={() => setPickingPage(true)}
            className='flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-text-secondary hover:bg-fill-content-hover hover:text-text-primary'
          >
            <PageGlyph />
          </button>
          <textarea
            ref={inputRef}
            rows={1}
            data-testid='carehub-chat-input'
            placeholder={`Message ${title}`}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              const el = e.target;
              const found = findMention(el.value, el.selectionStart ?? el.value.length);

              setMention(found);
              if (!found) setMentionActive(0);

              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
            }}
            onKeyDown={(e) => {
              if (mention && mentionPages.length) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  const step = e.key === 'ArrowDown' ? 1 : -1;

                  setMentionActive((i) => (i + step + mentionPages.length) % mentionPages.length);
                  return;
                }

                if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  pickMention(mentionPages[Math.min(mentionActive, mentionPages.length - 1)]);
                  return;
                }
              }

              if (mention && e.key === 'Escape') {
                e.preventDefault();
                setMention(null);
                return;
              }

              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !narrow) {
                e.preventDefault();
                void submit(draft, attached);
              }
            }}
            onBlur={() => setTimeout(() => setMention(null), 150)}
            className='max-h-[160px] min-h-[24px] flex-1 resize-none bg-transparent px-1 py-1 text-sm outline-none placeholder:text-text-tertiary'
          />
          <Button size='sm' type='submit' disabled={!draft.trim() && !attached.length} data-testid='carehub-chat-send'>
            Send
          </Button>
        </div>
        {!narrow && (
          <div className='mt-1 px-1 text-[11px] text-text-tertiary'>
            Enter to send · Shift + Enter for a new line · @ to share a page
          </div>
        )}
      </form>

      {pickingPage && (
        <PagePickerDialog
          exclude={attached.map((p) => p.viewId)}
          onClose={() => setPickingPage(false)}
          onPick={(pages) => {
            setAttached((prev) => [...prev, ...pages.filter((p) => !prev.some((a) => a.viewId === p.viewId))].slice(0, 10));
            setPickingPage(false);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
        />
      )}

      {grantAsk && (
        <GrantAccessDialog
          checks={grantAsk.checks}
          pages={grantAsk.pages}
          onCancel={() => {
            setDraft(grantAsk.body.replace(/\[\[page:[^\]]*\]\]/g, '').trim());
            setAttached(grantAsk.pages);
            setGrantAsk(null);
          }}
          onSend={(grant) => {
            const { body } = grantAsk;

            setGrantAsk(null);
            void send(body, undefined, grant);
          }}
        />
      )}

      {adding && (
        <PeoplePicker
          title='Add people'
          action='Add'
          exclude={chat.members.map((m) => m.uuid)}
          onClose={() => setAdding(false)}
          onPick={async (members) => {
            await call('put', `${API}/chats/${chat.id}`, { add: members });
            setAdding(false);
            await onChanged();
          }}
        />
      )}
    </>
  );
}

function MeAvatar() {
  return (
    <div className='flex h-8 w-8 items-center justify-center rounded-full bg-fill-content-hover text-[11px] font-medium text-text-secondary'>
      You
    </div>
  );
}

// ---------------------------------------------------------------------------
// choose people
// ---------------------------------------------------------------------------

function PeoplePicker({
  title,
  action,
  allowName,
  exclude = [],
  onClose,
  onPick,
}: {
  title: string;
  action: string;
  allowName?: boolean;
  exclude?: string[];
  onClose: () => void;
  onPick: (members: string[], name: string) => Promise<void>;
}) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await call<{ people: Person[] }>('get', `${API}/people`);

        setPeople((res?.people ?? []).filter((p) => !exclude.includes(p.uuid)));
      } catch (err) {
        setPeople([]);
        setError(errorText(err));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = (people ?? []).filter((p) => {
    const q = query.trim().toLowerCase();

    return !q || personName(p).toLowerCase().includes(q) || p.email.toLowerCase().includes(q);
  });

  return (
    <div
      className='fixed inset-0 z-[1300] flex items-center justify-center bg-black/30 p-4'
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        className='flex max-h-full w-[420px] max-w-full flex-col gap-3 rounded-[12px] border border-border-primary bg-background-primary p-5 shadow-xl'
        data-testid='carehub-people-picker'
        onSubmit={async (e) => {
          e.preventDefault();
          if (picked.length === 0) return;
          setBusy(true);
          try {
            await onPick(picked, name.trim());
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className='text-base font-semibold'>{title}</div>
        <Input autoFocus placeholder='Search people' value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className='max-h-[300px] min-h-[80px] overflow-y-auto'>
          {people === null && <div className='py-4 text-center text-sm text-text-secondary'>Loading…</div>}
          {people !== null && shown.length === 0 && (
            <div className='py-4 text-center text-sm text-text-secondary'>
              {people.length === 0 ? 'No one else is in your workspace yet.' : 'No one found.'}
            </div>
          )}
          {shown.map((p) => {
            const on = picked.includes(p.uuid);

            return (
              <label
                key={p.uuid}
                data-testid='carehub-person-row'
                className='flex cursor-pointer items-center gap-2.5 rounded-[8px] px-2 py-1.5 hover:bg-fill-content-hover'
              >
                <input
                  type='checkbox'
                  checked={on}
                  onChange={() => setPicked((prev) => (on ? prev.filter((x) => x !== p.uuid) : [...prev, p.uuid]))}
                />
                <Avatar person={p} size={28} />
                <div className='min-w-0 flex-1'>
                  <div className='truncate text-sm'>{personName(p)}</div>
                  <div className='truncate text-xs text-text-tertiary'>{p.email}</div>
                </div>
              </label>
            );
          })}
        </div>
        {allowName && picked.length > 1 && (
          <Input placeholder='Group name (optional)' value={name} onChange={(e) => setName(e.target.value)} />
        )}
        {error && <div className='text-xs text-[#dc2626]'>{error}</div>}
        <div className='flex justify-end gap-2'>
          <Button type='button' variant='outline' size='sm' onClick={onClose}>
            Cancel
          </Button>
          <Button type='submit' size='sm' disabled={busy || picked.length === 0} data-testid='carehub-people-confirm'>
            {action}
          </Button>
        </div>
      </form>
    </div>
  );
}

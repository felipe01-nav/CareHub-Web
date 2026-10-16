// CareHub Calendar: a full calendar inside Care Hub.
// - "My events" are saved on the Care Hub server (only you see them).
// - Personal calendars (iCloud, Google, Outlook) are added with their private
//   calendar link and shown read-only. They refresh every 15 minutes.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { executeAPIRequest, getAxios } from '@/application/services/js-services/http/core';
import { Button } from '@/components/ui/button';
import { dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { expandIcs, IcsEvent, parseIcs } from './CareHubIcs';

export const CAREHUB_CALENDAR_PATH = '/app/calendar';

const API = '/api/carehub/calendar';
const DAY = 86400000;
const HOUR_PX = 48;
const SNAP_MIN = 15;
const FEED_REFRESH_MS = 15 * 60 * 1000;
const OWN_ID = 'own';
const COLORS = ['#171717', '#2563eb', '#16a34a', '#ea580c', '#dc2626', '#9333ea', '#0891b2'];

type ViewMode = 'day' | 'week' | 'month';

interface ServerEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  all_day: boolean;
  location?: string;
  notes?: string;
  color?: string;
}

interface Feed {
  id: string;
  name: string;
  color: string;
  host?: string;
}

export interface CalEvent {
  key: string;
  id?: string;
  calendarId: string;
  calendarName: string;
  color: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  location: string;
  notes: string;
  url: string;
  readOnly: boolean;
}

interface FeedState {
  events: IcsEvent[];
  loadedAt: number;
  error?: string;
  loading?: boolean;
}

interface EditorState {
  id?: string;
  title: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  allDay: boolean;
  location: string;
  notes: string;
  color: string;
}

type DragState = {
  kind: 'create' | 'move' | 'resize';
  pointerId: number;
  startX: number;
  startY: number;
  dayIndex: number;
  startMin: number;
  curDay: number;
  curMin: number;
  grabOffsetMin: number;
  moved: boolean;
  event?: CalEvent;
};

// ---------------------------------------------------------------------------
// server calls
// ---------------------------------------------------------------------------

function call<T>(method: 'get' | 'post' | 'put' | 'delete', url: string, data?: unknown) {
  return executeAPIRequest<T>(() => getAxios()?.request({ method, url, data }));
}

function errorText(err: unknown) {
  const msg = (err as { message?: string })?.message;

  return msg && msg.trim() ? msg : 'Something went wrong. Please try again.';
}

// ---------------------------------------------------------------------------
// dates
// ---------------------------------------------------------------------------

function startOfDay(t: number) {
  const d = new Date(t);

  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function addDays(t: number, n: number) {
  const d = new Date(t);

  d.setDate(d.getDate() + n);
  return d.getTime();
}

function addMonths(t: number, n: number) {
  const d = new Date(t);

  return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime();
}

function startOfMonth(t: number) {
  const d = new Date(t);

  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function weekStartDay(): number {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const locale = new (Intl as any).Locale(navigator.language);
    const info = locale.getWeekInfo?.() ?? locale.weekInfo;

    if (info?.firstDay) return info.firstDay % 7;
  } catch {
    // ignore
  }

  return 1;
}

const WEEK_START = weekStartDay();

function startOfWeek(t: number) {
  const d = new Date(startOfDay(t));
  const diff = (d.getDay() - WEEK_START + 7) % 7;

  return addDays(d.getTime(), -diff);
}

function minutesOfDay(t: number) {
  const d = new Date(t);

  return d.getHours() * 60 + d.getMinutes();
}

function atMinutes(day: number, minutes: number) {
  const d = new Date(day);

  d.setHours(0, minutes, 0, 0);
  return d.getTime();
}

const pad = (n: number) => String(n).padStart(2, '0');

function toDateInput(t: number) {
  const d = new Date(t);

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toTimeInput(t: number) {
  const d = new Date(t);

  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromInputs(date: string, time: string) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (time || '00:00').split(':').map(Number);

  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0).getTime();
}

const fmtTime = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtWeekday = (t: number) => new Date(t).toLocaleDateString([], { weekday: 'short' });
const fmtLongDate = (t: number) =>
  new Date(t).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtHour = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' });

function rangeTitle(view: ViewMode, cursor: number) {
  if (view === 'day') return fmtLongDate(cursor);
  if (view === 'month') return new Date(cursor).toLocaleDateString([], { month: 'long', year: 'numeric' });
  const a = startOfWeek(cursor);
  const b = addDays(a, 6);
  const da = new Date(a);
  const db = new Date(b);

  if (da.getMonth() === db.getMonth()) return da.toLocaleDateString([], { month: 'long', year: 'numeric' });
  if (da.getFullYear() === db.getFullYear()) {
    return `${da.toLocaleDateString([], { month: 'short' })} – ${db.toLocaleDateString([], {
      month: 'short',
      year: 'numeric',
    })}`;
  }

  return `${da.toLocaleDateString([], { month: 'short', year: 'numeric' })} – ${db.toLocaleDateString([], {
    month: 'short',
    year: 'numeric',
  })}`;
}

function eventTimeText(e: CalEvent) {
  if (e.allDay) {
    const last = addDays(e.end, -1);

    if (startOfDay(last) <= startOfDay(e.start)) return `${fmtLongDate(e.start)} · All day`;
    return `${fmtLongDate(e.start)} – ${fmtLongDate(last)}`;
  }

  if (startOfDay(e.start) === startOfDay(e.end) || e.end - e.start < DAY) {
    return `${fmtLongDate(e.start)} · ${fmtTime(e.start)} – ${fmtTime(e.end)}`;
  }

  return `${fmtLongDate(e.start)} ${fmtTime(e.start)} – ${fmtLongDate(e.end)} ${fmtTime(e.end)}`;
}

// ---------------------------------------------------------------------------
// meeting links
// ---------------------------------------------------------------------------

export function findMeetingLink(...texts: Array<string | undefined>): { url: string; label: string } | null {
  const all = texts.filter(Boolean).join('\n');
  const urls = (all.match(/https?:\/\/[^\s<>"')\]]+/gi) || []).map((u) => u.replace(/[.,;]+$/, ''));

  if (!urls.length) return null;
  const pick = (re: RegExp) => urls.find((u) => re.test(u));
  const zoom = pick(/zoom\.(us|com)\//i);

  if (zoom) return { url: zoom, label: 'Join Zoom meeting' };
  const meet = pick(/meet\.google\.com\//i);

  if (meet) return { url: meet, label: 'Join Google Meet' };
  const teams = pick(/teams\.(microsoft|live)\.com\//i);

  if (teams) return { url: teams, label: 'Join Teams meeting' };
  const facetime = pick(/facetime\.apple\.com\//i);

  if (facetime) return { url: facetime, label: 'Join FaceTime' };
  return { url: urls[0], label: 'Open link' };
}

// ---------------------------------------------------------------------------
// small pieces
// ---------------------------------------------------------------------------

function useLocalState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);

      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const update = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        // ignore
      }
    },
    [key]
  );

  return [value, update];
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.6'
      strokeLinecap='round' strokeLinejoin='round' aria-hidden='true' className={className}>
      <rect x='3.5' y='5' width='17' height='15.5' rx='2' />
      <path d='M3.5 9.5h17M8 3v4M16 3v4' />
    </svg>
  );
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'
      strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
      {dir === 'left' ? <path d='M15 6l-6 6 6 6' /> : <path d='M9 6l6 6-6 6' />}
    </svg>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type='button'
      aria-label={label}
      title={label}
      onClick={onClick}
      className='flex h-8 w-8 items-center justify-center rounded-[8px] text-text-secondary hover:bg-fill-content-hover hover:text-text-primary'
    >
      {children}
    </button>
  );
}

/** Sidebar entry ("Calendar"), shown under Search. */
export function CareHubCalendarNavItem() {
  const navigate = useNavigate();
  const location = useLocation();
  const active = location.pathname === CAREHUB_CALENDAR_PATH;

  return (
    <div
      role='button'
      tabIndex={0}
      data-testid='carehub-calendar-nav'
      onClick={() => navigate(CAREHUB_CALENDAR_PATH)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') navigate(CAREHUB_CALENDAR_PATH);
      }}
      className={cn(dropdownMenuItemVariants(), active && 'bg-fill-content-hover')}
    >
      <CalendarIcon />
      Calendar
    </div>
  );
}

// ---------------------------------------------------------------------------
// layout of overlapping events in a day
// ---------------------------------------------------------------------------

interface Placed {
  event: CalEvent;
  top: number;
  height: number;
  col: number;
  cols: number;
  startMin: number;
  endMin: number;
}

function placeDay(events: CalEvent[], dayStart: number): Placed[] {
  const dayEnd = addDays(dayStart, 1);
  const items = events
    .filter((e) => !e.allDay && e.start < dayEnd && Math.max(e.end, e.start + 1) > dayStart)
    .map((e) => {
      const s = Math.max(e.start, dayStart);
      const en = Math.min(Math.max(e.end, e.start + 15 * 60000), dayEnd);
      const startMin = s === dayStart ? 0 : minutesOfDay(s);
      const endMin = en >= dayEnd ? 1440 : Math.max(minutesOfDay(en), startMin + 15);

      return { event: e, startMin, endMin };
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  const placed: Placed[] = [];
  let cluster: Array<{ startMin: number; endMin: number; event: CalEvent; col: number }> = [];
  let clusterEnd = -1;
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1));

    for (const c of cluster) {
      placed.push({
        event: c.event,
        startMin: c.startMin,
        endMin: c.endMin,
        top: (c.startMin / 60) * HOUR_PX,
        height: Math.max(18, ((c.endMin - c.startMin) / 60) * HOUR_PX - 2),
        col: c.col,
        cols,
      });
    }

    cluster = [];
  };

  for (const item of items) {
    if (cluster.length && item.startMin >= clusterEnd) flush();
    const used = new Set(cluster.filter((c) => c.endMin > item.startMin).map((c) => c.col));
    let col = 0;

    while (used.has(col)) col++;
    cluster.push({ ...item, col });
    clusterEnd = Math.max(clusterEnd, item.endMin);
    if (cluster.length === 1) clusterEnd = item.endMin;
  }

  if (cluster.length) flush();
  return placed;
}

// ---------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------

export default function CareHubCalendarPage() {
  const [view, setView] = useLocalState<ViewMode>('carehub-calendar-view', 'week');
  const [cursor, setCursor] = useState(() => startOfDay(Date.now()));
  const [now, setNow] = useState(() => Date.now());
  const [ownEvents, setOwnEvents] = useState<CalEvent[]>([]);
  const [ownColor, setOwnColor] = useLocalState<string>('carehub-calendar-own-color', COLORS[0]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [feedData, setFeedData] = useState<Record<string, FeedState>>({});
  const [hidden, setHidden] = useLocalState<string[]>('carehub-calendar-hidden', []);
  const [selected, setSelected] = useState<CalEvent | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [error, setError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);

    return () => window.clearInterval(timer);
  }, []);

  // ---- visible range ----
  const days = useMemo(() => {
    if (view === 'day') return [startOfDay(cursor)];
    if (view === 'week') {
      const a = startOfWeek(cursor);

      return Array.from({ length: 7 }, (_, i) => addDays(a, i));
    }

    const a = startOfWeek(startOfMonth(cursor));

    return Array.from({ length: 42 }, (_, i) => addDays(a, i));
  }, [view, cursor]);
  const rangeStart = days[0];
  const rangeEnd = addDays(days[days.length - 1], 1);

  // ---- my events (server) ----
  const loadOwn = useCallback(async () => {
    const from = Math.min(rangeStart, startOfDay(Date.now())) - DAY;
    const to = Math.max(rangeEnd, Date.now() + 2 * DAY) + DAY;

    try {
      const res = await call<{ events: ServerEvent[] }>('get', `${API}/events?from=${from}&to=${to}`);

      setOwnEvents(
        (res?.events ?? []).map((e) => ({
          key: `own:${e.id}`,
          id: e.id,
          calendarId: OWN_ID,
          calendarName: 'My events',
          color: e.color || '',
          title: e.title || '(No title)',
          start: e.start,
          end: e.end,
          allDay: e.all_day,
          location: e.location || '',
          notes: e.notes || '',
          url: '',
          readOnly: false,
        }))
      );
      setError('');
    } catch (err) {
      setError(`Could not load your events: ${errorText(err)}`);
    }
  }, [rangeStart, rangeEnd]);

  useEffect(() => {
    void loadOwn();
  }, [loadOwn, reloadTick]);

  // ---- personal calendars (links) ----
  const loadFeeds = useCallback(async () => {
    try {
      const res = await call<{ feeds: Feed[] }>('get', `${API}/feeds`);

      setFeeds(res?.feeds ?? []);
    } catch (err) {
      setError(`Could not load your calendars: ${errorText(err)}`);
    }
  }, []);

  useEffect(() => {
    void loadFeeds();
  }, [loadFeeds]);

  const loadFeed = useCallback(async (feed: Feed) => {
    setFeedData((prev) => ({
      ...prev,
      [feed.id]: { events: prev[feed.id]?.events ?? [], loadedAt: prev[feed.id]?.loadedAt ?? 0, loading: true },
    }));
    try {
      const res = await call<{ ics: string }>('get', `${API}/feeds/${feed.id}/ics`);
      const events = parseIcs(res?.ics ?? '');

      setFeedData((prev) => ({ ...prev, [feed.id]: { events, loadedAt: Date.now() } }));
    } catch (err) {
      setFeedData((prev) => ({
        ...prev,
        [feed.id]: { events: prev[feed.id]?.events ?? [], loadedAt: Date.now(), error: errorText(err) },
      }));
    }
  }, []);

  const feedDataRef = useRef(feedData);

  feedDataRef.current = feedData;

  useEffect(() => {
    const refresh = (force: boolean) => {
      for (const feed of feeds) {
        const state = feedDataRef.current[feed.id];

        if (force || !state || (!state.loading && Date.now() - state.loadedAt > FEED_REFRESH_MS)) {
          void loadFeed(feed);
        }
      }
    };

    refresh(reloadTick > 0);
    const timer = window.setInterval(() => refresh(false), 60000);

    return () => window.clearInterval(timer);
  }, [feeds, loadFeed, reloadTick]);

  // ---- all events in view ----
  const feedEvents = useCallback(
    (from: number, to: number) => {
      const out: CalEvent[] = [];

      for (const feed of feeds) {
        if (hidden.includes(feed.id)) continue;
        const state = feedData[feed.id];

        if (!state) continue;
        for (const o of expandIcs(state.events, from, to, feed.id)) {
          out.push({
            key: o.key,
            calendarId: feed.id,
            calendarName: feed.name,
            color: feed.color || COLORS[1],
            title: o.title,
            start: o.start,
            end: o.end,
            allDay: o.allDay,
            location: o.location,
            notes: o.description,
            url: o.url,
            readOnly: true,
          });
        }
      }

      return out;
    },
    [feedData, feeds, hidden]
  );

  const events = useMemo(() => {
    const own = hidden.includes(OWN_ID)
      ? []
      : ownEvents
          .filter((e) => e.start < rangeEnd && Math.max(e.end, e.start + 1) > rangeStart)
          .map((e) => ({ ...e, color: e.color || ownColor }));

    return [...own, ...feedEvents(rangeStart, rangeEnd)].sort((a, b) => a.start - b.start);
  }, [feedEvents, hidden, ownColor, ownEvents, rangeEnd, rangeStart]);

  const nextUp = useMemo(() => {
    const until = now + DAY;
    const own = hidden.includes(OWN_ID) ? [] : ownEvents.map((e) => ({ ...e, color: e.color || ownColor }));
    const all = [...own, ...feedEvents(now - DAY, until)]
      .filter((e) => !e.allDay && e.end > now && e.start < until)
      .sort((a, b) => a.start - b.start);

    return all[0] ?? null;
  }, [feedEvents, hidden, now, ownColor, ownEvents]);

  // keep the side panel in sync with fresh data
  useEffect(() => {
    if (!selected) return;
    const fresh = [...ownEvents, ...events].find((e) => e.key === selected.key);

    if (fresh && fresh !== selected && (fresh.title !== selected.title || fresh.start !== selected.start || fresh.end !== selected.end)) {
      setSelected({ ...fresh, color: fresh.color || ownColor });
    }
  }, [events, ownColor, ownEvents, selected]);

  // ---- navigation ----
  const go = useCallback(
    (dir: -1 | 1) => {
      if (view === 'day') setCursor((c) => addDays(c, dir));
      else if (view === 'week') setCursor((c) => addDays(c, 7 * dir));
      else setCursor((c) => addMonths(c, dir));
    },
    [view]
  );

  const today = useCallback(() => setCursor(startOfDay(Date.now())), []);

  // scroll to the working day when the time grid opens
  useEffect(() => {
    const el = scrollRef.current;

    if (!el || view === 'month') return;
    const containsToday = days.some((d) => d === startOfDay(Date.now()));
    const hour = containsToday ? Math.max(0, new Date().getHours() - 2) : 7;

    el.scrollTop = hour * HOUR_PX;
    // only when switching view
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // ---- editor ----
  const openNew = useCallback(
    (start: number, end: number, allDay = false) => {
      setSelected(null);
      setEditor({
        title: '',
        startDate: toDateInput(start),
        startTime: toTimeInput(start),
        endDate: toDateInput(allDay ? addDays(end, -1) : end),
        endTime: toTimeInput(end),
        allDay,
        location: '',
        notes: '',
        color: '',
      });
    },
    []
  );

  const openEdit = useCallback((e: CalEvent) => {
    if (e.readOnly || !e.id) return;
    setEditor({
      id: e.id,
      title: e.title === '(No title)' ? '' : e.title,
      startDate: toDateInput(e.start),
      startTime: toTimeInput(e.start),
      endDate: toDateInput(e.allDay ? addDays(e.end, -1) : e.end),
      endTime: toTimeInput(e.end),
      allDay: e.allDay,
      location: e.location,
      notes: e.notes,
      color: ownEvents.find((o) => o.id === e.id)?.color || '',
    });
  }, [ownEvents]);

  const saveEvent = useCallback(
    async (state: EditorState) => {
      let start: number;
      let end: number;

      if (state.allDay) {
        start = fromInputs(state.startDate, '00:00');
        end = addDays(fromInputs(state.endDate || state.startDate, '00:00'), 1);
      } else {
        start = fromInputs(state.startDate, state.startTime);
        end = fromInputs(state.endDate || state.startDate, state.endTime);
      }

      if (Number.isNaN(start) || Number.isNaN(end)) throw new Error('Please enter a valid date and time.');
      if (end <= start) throw new Error('The end must be after the start.');
      const body = {
        title: state.title.trim(),
        start,
        end,
        all_day: state.allDay,
        location: state.location.trim(),
        notes: state.notes,
        color: state.color,
      };

      if (state.id) await call('put', `${API}/events/${state.id}`, body);
      else await call('post', `${API}/events`, body);
      await loadOwn();
    },
    [loadOwn]
  );

  const deleteEvent = useCallback(
    async (id: string) => {
      await call('delete', `${API}/events/${id}`);
      setSelected(null);
      await loadOwn();
    },
    [loadOwn]
  );

  const moveEvent = useCallback(
    async (e: CalEvent, start: number, end: number) => {
      if (!e.id) return;
      setOwnEvents((prev) => prev.map((o) => (o.id === e.id ? { ...o, start, end } : o)));
      try {
        await call('put', `${API}/events/${e.id}`, {
          title: e.title === '(No title)' ? '' : e.title,
          start,
          end,
          all_day: e.allDay,
          location: e.location,
          notes: e.notes,
          color: ownEvents.find((o) => o.id === e.id)?.color || '',
        });
      } catch (err) {
        setError(`Could not move the event: ${errorText(err)}`);
      }

      await loadOwn();
    },
    [loadOwn, ownEvents]
  );

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;

      if (editor || e.metaKey || e.ctrlKey || e.altKey) return;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      if (e.key === 'Escape') setSelected(null);
      else if (e.key === 't') today();
      else if (e.key === 'd') setView('day');
      else if (e.key === 'w') setView('week');
      else if (e.key === 'm') setView('month');
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor, go, setView, today]);

  // ---- dragging in the time grid ----
  const pointToSlot = useCallback(
    (clientX: number, clientY: number) => {
      const body = bodyRef.current;

      if (!body) return { day: 0, min: 0 };
      const rect = body.getBoundingClientRect();
      const colWidth = rect.width / days.length;
      const day = Math.min(days.length - 1, Math.max(0, Math.floor((clientX - rect.left) / colWidth)));
      const rawMin = ((clientY - rect.top) / HOUR_PX) * 60;
      const min = Math.min(1440, Math.max(0, Math.round(rawMin / SNAP_MIN) * SNAP_MIN));

      return { day, min, rawMin };
    },
    [days.length]
  );

  const startDrag = useCallback(
    (e: ReactPointerEvent, kind: DragState['kind'], event?: CalEvent) => {
      if (e.button !== 0) return;
      const slot = pointToSlot(e.clientX, e.clientY);
      let grabOffsetMin = 0;
      let startMin = kind === 'create' ? Math.floor((slot.rawMin ?? 0) / SNAP_MIN) * SNAP_MIN : slot.min;
      let dayIndex = slot.day;

      if (event && kind !== 'create') {
        const evDay = days.findIndex((d) => d === startOfDay(event.start));

        if (evDay >= 0) dayIndex = evDay;
        startMin = minutesOfDay(event.start);
        grabOffsetMin = slot.min - startMin + (slot.day - dayIndex) * 1440;
      }

      const state: DragState = {
        kind,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        dayIndex,
        startMin,
        curDay: slot.day,
        curMin: kind === 'create' ? startMin : slot.min,
        grabOffsetMin,
        moved: false,
        event,
      };

      dragRef.current = state;
      setDrag(state);
      e.preventDefault();
      e.stopPropagation();
    },
    [days, pointToSlot]
  );

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const cur = dragRef.current;

      if (!cur || e.pointerId !== cur.pointerId) return;
      const slot = pointToSlot(e.clientX, e.clientY);
      const moved = cur.moved || Math.abs(e.clientY - cur.startY) > 4 || Math.abs(e.clientX - cur.startX) > 4;
      const next = { ...cur, curDay: slot.day, curMin: slot.min, moved };

      dragRef.current = next;
      setDrag(next);
    };

    const onUp = (e: PointerEvent) => {
      const cur = dragRef.current;

      if (!cur || e.pointerId !== cur.pointerId) return;
      dragRef.current = null;
      setDrag(null);
      const day = days[cur.dayIndex];

      if (cur.kind === 'create') {
        if (!cur.moved) {
          const start = atMinutes(day, Math.min(cur.startMin, 1440 - 60));

          openNew(start, start + 60 * 60000);
          return;
        }

        const a = Math.min(cur.startMin, cur.curMin);
        const b = Math.max(cur.startMin, cur.curMin, a + SNAP_MIN);

        openNew(atMinutes(day, a), atMinutes(day, b));
        return;
      }

      const ev = cur.event;

      if (!ev) return;
      if (!cur.moved) {
        setSelected(ev);
        return;
      }

      if (cur.kind === 'move') {
        const dur = ev.end - ev.start;
        const minutes = cur.curMin - cur.grabOffsetMin + (cur.curDay - cur.dayIndex) * 1440;
        const start = atMinutes(day, minutes);

        if (start !== ev.start) void moveEvent(ev, start, start + dur);
      } else {
        const end = atMinutes(day, Math.max(cur.curMin, cur.startMin + SNAP_MIN));

        if (end !== ev.end) void moveEvent(ev, ev.start, end);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [days, drag, moveEvent, openNew, pointToSlot]);

  // the event as it looks while being dragged
  const dragPreview = useMemo(() => {
    if (!drag || !drag.moved) return null;
    const day = days[drag.dayIndex];

    if (drag.kind === 'create') {
      const a = Math.min(drag.startMin, drag.curMin);
      const b = Math.max(drag.startMin, drag.curMin, a + SNAP_MIN);

      return { key: '__new', start: atMinutes(day, a), end: atMinutes(day, b) };
    }

    const ev = drag.event;

    if (!ev) return null;
    if (drag.kind === 'move') {
      const minutes = drag.curMin - drag.grabOffsetMin + (drag.curDay - drag.dayIndex) * 1440;
      const start = atMinutes(day, minutes);

      return { key: ev.key, start, end: start + (ev.end - ev.start) };
    }

    return { key: ev.key, start: ev.start, end: atMinutes(day, Math.max(drag.curMin, drag.startMin + SNAP_MIN)) };
  }, [days, drag]);

  const shownEvents = useMemo(() => {
    if (!dragPreview || dragPreview.key === '__new') return events;
    return events.map((e) => (e.key === dragPreview.key ? { ...e, start: dragPreview.start, end: dragPreview.end } : e));
  }, [dragPreview, events]);

  const toggleHidden = (id: string) => {
    setHidden(hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id]);
  };

  return (
    <div
      style={{ height: 'calc(100vh - 48px)' }}
      className='carehub-calendar flex w-full min-w-0 flex-1 overflow-hidden bg-background-primary text-text-primary'
      data-testid='carehub-calendar'
    >
      <CalendarSidebar
        cursor={cursor}
        view={view}
        days={days}
        onPickDay={(d) => setCursor(d)}
        onCreate={() => {
          const start = atMinutes(startOfDay(Date.now()), (new Date().getHours() + 1) * 60);

          openNew(start, start + 60 * 60000);
        }}
        nextUp={nextUp}
        now={now}
        onOpenEvent={setSelected}
        feeds={feeds}
        feedData={feedData}
        hidden={hidden}
        onToggle={toggleHidden}
        ownColor={ownColor}
        onOwnColor={setOwnColor}
        onFeedsChanged={async () => {
          await loadFeeds();
        }}
      />

      <div className='flex min-w-0 flex-1 flex-col'>
        <div className='flex h-12 shrink-0 items-center gap-1 border-b border-border-primary px-4'>
          <Button variant='outline' size='sm' onClick={today}>
            Today
          </Button>
          <IconButton label='Previous' onClick={() => go(-1)}>
            <Chevron dir='left' />
          </IconButton>
          <IconButton label='Next' onClick={() => go(1)}>
            <Chevron dir='right' />
          </IconButton>
          <div className='ml-2 truncate text-lg font-semibold' data-testid='carehub-calendar-title'>
            {rangeTitle(view, cursor)}
          </div>
          <div className='flex-1' />
          <IconButton label='Refresh' onClick={() => setReloadTick((n) => n + 1)}>
            <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'
              strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
              <path d='M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7' />
            </svg>
          </IconButton>
          <div className='ml-1 flex rounded-[8px] border border-border-primary p-0.5' role='tablist'>
            {(['day', 'week', 'month'] as ViewMode[]).map((v) => (
              <button
                key={v}
                type='button'
                role='tab'
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={cn(
                  'rounded-[6px] px-3 py-1 text-sm capitalize',
                  view === v ? 'bg-fill-content-hover font-medium text-text-primary' : 'text-text-secondary hover:text-text-primary'
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div role='alert' className='mx-4 mt-3 flex items-center gap-3 rounded-[8px] border border-border-primary px-3 py-2 text-sm'>
            <span className='flex-1 text-text-secondary'>{error}</span>
            <button type='button' className='text-text-secondary hover:text-text-primary' onClick={() => setError('')}>
              Dismiss
            </button>
          </div>
        )}

        <div className='flex min-h-0 flex-1'>
          <div className='flex min-w-0 flex-1 flex-col'>
            {view === 'month' ? (
              <MonthGrid
                days={days}
                cursor={cursor}
                events={events}
                onOpen={setSelected}
                onCreate={(day) => openNew(atMinutes(day, 9 * 60), atMinutes(day, 10 * 60))}
                onMore={(day) => {
                  setCursor(day);
                  setView('day');
                }}
              />
            ) : (
              <TimeGrid
                days={days}
                now={now}
                events={shownEvents}
                draggingKey={drag?.moved ? drag.event?.key : undefined}
                createPreview={dragPreview?.key === '__new' ? dragPreview : null}
                bodyRef={bodyRef}
                scrollRef={scrollRef}
                onStartDrag={startDrag}
                onOpen={setSelected}
                onCreateAllDay={(day) => openNew(day, addDays(day, 1), true)}
              />
            )}
          </div>
          {selected && (
            <EventPanel
              event={selected}
              onClose={() => setSelected(null)}
              onEdit={() => openEdit(selected)}
              onDelete={async () => {
                if (selected.id) await deleteEvent(selected.id);
              }}
            />
          )}
        </div>
      </div>

      {editor && (
        <EventEditor
          initial={editor}
          defaultColor={ownColor}
          onClose={() => setEditor(null)}
          onSave={async (state) => {
            await saveEvent(state);
            setEditor(null);
          }}
          onDelete={
            editor.id
              ? async () => {
                  await deleteEvent(editor.id as string);
                  setEditor(null);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// left column: mini month, next up, calendars
// ---------------------------------------------------------------------------

function CalendarSidebar(props: {
  cursor: number;
  view: ViewMode;
  days: number[];
  onPickDay: (day: number) => void;
  onCreate: () => void;
  nextUp: CalEvent | null;
  now: number;
  onOpenEvent: (e: CalEvent) => void;
  feeds: Feed[];
  feedData: Record<string, FeedState>;
  hidden: string[];
  onToggle: (id: string) => void;
  ownColor: string;
  onOwnColor: (c: string) => void;
  onFeedsChanged: () => Promise<void>;
}) {
  const { cursor, view, days, onPickDay, onCreate, nextUp, now, onOpenEvent, feeds, feedData, hidden, onToggle } = props;
  const [miniMonth, setMiniMonth] = useState(() => startOfMonth(cursor));
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState('');

  useEffect(() => {
    setMiniMonth(startOfMonth(cursor));
  }, [cursor]);

  const miniDays = useMemo(() => {
    const a = startOfWeek(miniMonth);

    return Array.from({ length: 42 }, (_, i) => addDays(a, i));
  }, [miniMonth]);
  const todayStart = startOfDay(now);
  const selectedSet = new Set(view === 'month' ? [] : days);
  const link = nextUp ? findMeetingLink(nextUp.url, nextUp.location, nextUp.notes) : null;

  const removeFeed = async (id: string) => {
    try {
      await call('delete', `${API}/feeds/${id}`);
      setRemoving(null);
      setRemoveError('');
      await props.onFeedsChanged();
    } catch (err) {
      setRemoveError(errorText(err));
    }
  };

  return (
    <div className='flex w-[256px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-border-primary bg-surface-container-layer-00 p-3'>
      <Button size='sm' className='w-full shrink-0' onClick={onCreate} data-testid='carehub-calendar-create'>
        New event
      </Button>

      <div className='shrink-0'>
        <div className='mb-1 flex items-center justify-between px-1'>
          <span className='text-sm font-medium'>
            {new Date(miniMonth).toLocaleDateString([], { month: 'long', year: 'numeric' })}
          </span>
          <div className='flex'>
            <IconButton label='Previous month' onClick={() => setMiniMonth(addMonths(miniMonth, -1))}>
              <Chevron dir='left' />
            </IconButton>
            <IconButton label='Next month' onClick={() => setMiniMonth(addMonths(miniMonth, 1))}>
              <Chevron dir='right' />
            </IconButton>
          </div>
        </div>
        <div className='grid grid-cols-7 text-center text-[11px] text-text-tertiary'>
          {miniDays.slice(0, 7).map((d) => (
            <div key={d} className='py-1'>
              {fmtWeekday(d).slice(0, 2)}
            </div>
          ))}
        </div>
        <div className='grid grid-cols-7 text-center text-xs'>
          {miniDays.map((d) => {
            const inMonth = new Date(d).getMonth() === new Date(miniMonth).getMonth();
            const isToday = d === todayStart;

            return (
              <button
                key={d}
                type='button'
                onClick={() => onPickDay(d)}
                className={cn('flex h-7 items-center justify-center', selectedSet.has(d) && 'bg-fill-content-hover')}
              >
                <span
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-full hover:bg-fill-content-hover',
                    !inMonth && 'text-text-tertiary'
                  )}
                  style={isToday ? { background: 'var(--text-primary)', color: 'var(--background-primary)' } : undefined}
                >
                  {new Date(d).getDate()}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className='shrink-0'>
        <div className='mb-2 px-1 text-xs font-medium uppercase tracking-wide text-text-tertiary'>Next up</div>
        {nextUp ? (
          <div className='rounded-[8px] border border-border-primary bg-background-primary p-3'>
            <button type='button' className='block w-full text-left' onClick={() => onOpenEvent(nextUp)}>
              <div className='flex items-center gap-2'>
                <span className='h-2 w-2 shrink-0 rounded-full' style={{ background: nextUp.color }} />
                <span className='truncate text-sm font-medium'>{nextUp.title}</span>
              </div>
              <div className='mt-1 text-xs text-text-secondary'>
                {nextUp.start <= now
                  ? `Now · until ${fmtTime(nextUp.end)}`
                  : `${startOfDay(nextUp.start) === todayStart ? 'Today' : 'Tomorrow'} · ${fmtTime(nextUp.start)}` +
                    (nextUp.start - now < 60 * 60000 ? ` (in ${Math.max(1, Math.round((nextUp.start - now) / 60000))} min)` : '')}
              </div>
            </button>
            {link && (
              <Button size='sm' className='mt-3 w-full' onClick={() => window.open(link.url, '_blank', 'noopener')}>
                {link.label}
              </Button>
            )}
          </div>
        ) : (
          <div className='px-1 text-sm text-text-secondary'>Nothing in the next 24 hours.</div>
        )}
      </div>

      <div className='shrink-0'>
        <div className='mb-1 px-1 text-xs font-medium uppercase tracking-wide text-text-tertiary'>Calendars</div>
        <CalendarRow
          name='My events'
          color={props.ownColor}
          visible={!hidden.includes(OWN_ID)}
          onToggle={() => onToggle(OWN_ID)}
          extra={
            <div className='flex gap-1 pl-7 pt-1'>
              {COLORS.map((c) => (
                <button
                  key={c}
                  type='button'
                  aria-label='Colour'
                  onClick={() => props.onOwnColor(c)}
                  className={cn('h-3.5 w-3.5 rounded-full', props.ownColor === c && 'ring-2 ring-offset-1 ring-[var(--border-theme-thick)]')}
                  style={{ background: c }}
                />
              ))}
            </div>
          }
        />
        {feeds.map((feed) => {
          const state = feedData[feed.id];

          return (
            <CalendarRow
              key={feed.id}
              name={feed.name}
              color={feed.color || COLORS[1]}
              visible={!hidden.includes(feed.id)}
              onToggle={() => onToggle(feed.id)}
              note={
                state?.error
                  ? `Couldn't load: ${state.error}`
                  : state?.loading && !state.loadedAt
                    ? 'Loading…'
                    : feed.host
                      ? `Read-only · ${feed.host}`
                      : 'Read-only'
              }
              onRemove={() => setRemoving(feed.id)}
              extra={
                removing === feed.id ? (
                  <div className='flex items-center gap-2 pl-7 pt-1 text-xs'>
                    <span className='text-text-secondary'>Remove this calendar?</span>
                    <button type='button' className='font-medium text-text-primary underline' onClick={() => void removeFeed(feed.id)}>
                      Remove
                    </button>
                    <button type='button' className='text-text-secondary' onClick={() => setRemoving(null)}>
                      Cancel
                    </button>
                  </div>
                ) : null
              }
            />
          );
        })}
        {removeError && <div className='px-1 pt-1 text-xs text-text-secondary'>{removeError}</div>}
        {adding ? (
          <AddCalendarForm
            onCancel={() => setAdding(false)}
            onAdded={async () => {
              setAdding(false);
              await props.onFeedsChanged();
            }}
          />
        ) : (
          <button
            type='button'
            onClick={() => setAdding(true)}
            className='mt-1 w-full rounded-[8px] px-2 py-1.5 text-left text-sm text-text-secondary hover:bg-fill-content-hover hover:text-text-primary'
            data-testid='carehub-calendar-add'
          >
            + Add calendar (iCloud, Google)
          </button>
        )}
      </div>
    </div>
  );
}

function CalendarRow(props: {
  name: string;
  color: string;
  visible: boolean;
  onToggle: () => void;
  note?: string;
  onRemove?: () => void;
  extra?: ReactNode;
}) {
  return (
    <div className='group rounded-[8px] px-1 py-1 hover:bg-fill-content-hover'>
      <div className='flex items-center gap-2'>
        <button
          type='button'
          role='checkbox'
          aria-checked={props.visible}
          aria-label={`Show ${props.name}`}
          onClick={props.onToggle}
          className='flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border'
          style={{ background: props.visible ? props.color : 'transparent', borderColor: props.color }}
        >
          {props.visible && (
            <svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='3' aria-hidden='true'>
              <path d='M5 12l5 5 9-10' />
            </svg>
          )}
        </button>
        <div className='min-w-0 flex-1'>
          <div className='truncate text-sm'>{props.name}</div>
          {props.note && <div className='truncate text-[11px] text-text-tertiary'>{props.note}</div>}
        </div>
        {props.onRemove && (
          <button
            type='button'
            aria-label={`Remove ${props.name}`}
            onClick={props.onRemove}
            className='hidden h-6 w-6 items-center justify-center rounded-[6px] text-text-secondary hover:text-text-primary group-hover:flex'
          >
            ×
          </button>
        )}
      </div>
      {props.extra}
    </div>
  );
}

function AddCalendarForm({ onCancel, onAdded }: { onCancel: () => void; onAdded: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [color, setColor] = useState(COLORS[1]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [help, setHelp] = useState<'icloud' | 'google' | null>(null);

  const submit = async () => {
    setError('');
    if (!url.trim()) {
      setError('Paste the calendar link first.');
      return;
    }

    setBusy(true);
    try {
      await call('post', `${API}/feeds`, { name: name.trim() || 'My calendar', url: url.trim(), color });
      await onAdded();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className='mt-2 flex flex-col gap-2 rounded-[8px] border border-border-primary bg-background-primary p-3'
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      data-testid='carehub-calendar-add-form'
    >
      <div className='text-sm font-medium'>Add a calendar</div>
      <Input placeholder='Name, e.g. iCloud' value={name} onChange={(e) => setName(e.target.value)} />
      <Input placeholder='Calendar link (webcal:// or https://)' value={url} onChange={(e) => setUrl(e.target.value)} />
      <div className='flex gap-1'>
        {COLORS.map((c) => (
          <button
            key={c}
            type='button'
            aria-label='Colour'
            onClick={() => setColor(c)}
            className={cn('h-4 w-4 rounded-full', color === c && 'ring-2 ring-offset-1 ring-[var(--border-theme-thick)]')}
            style={{ background: c }}
          />
        ))}
      </div>
      <div className='flex gap-3 text-xs'>
        <button type='button' className='text-text-secondary underline' onClick={() => setHelp(help === 'icloud' ? null : 'icloud')}>
          iCloud link?
        </button>
        <button type='button' className='text-text-secondary underline' onClick={() => setHelp(help === 'google' ? null : 'google')}>
          Google link?
        </button>
      </div>
      {help === 'icloud' && (
        <div className='rounded-[6px] bg-fill-content-hover p-2 text-xs leading-relaxed text-text-secondary'>
          On iPhone: open Calendar → Calendars → tap ⓘ next to your calendar → turn on <b>Public Calendar</b> → <b>Share
          Link</b> → Copy. Paste it here. Anyone who has this long link can see the calendar, so keep it private.
        </div>
      )}
      {help === 'google' && (
        <div className='rounded-[6px] bg-fill-content-hover p-2 text-xs leading-relaxed text-text-secondary'>
          On a computer: open calendar.google.com → ⚙ Settings → click your calendar on the left → <b>Integrate
          calendar</b> → copy <b>Secret address in iCal format</b>. Paste it here.
        </div>
      )}
      {error && <div role='alert' className='text-xs text-text-error'>{error}</div>}
      <div className='flex justify-end gap-2'>
        <Button type='button' variant='ghost' size='sm' onClick={onCancel}>
          Cancel
        </Button>
        <Button type='submit' size='sm' disabled={busy}>
          {busy ? 'Adding…' : 'Add'}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// week / day grid
// ---------------------------------------------------------------------------

function EventChip({ event, onOpen }: { event: CalEvent; onOpen: (e: CalEvent) => void }) {
  return (
    <button
      type='button'
      onClick={(e) => {
        e.stopPropagation();
        onOpen(event);
      }}
      className='flex w-full min-w-0 items-center gap-1 truncate rounded-[4px] px-1.5 py-0.5 text-left text-xs font-medium'
      style={{ background: `${event.color}24`, color: 'var(--text-primary)', borderLeft: `3px solid ${event.color}` }}
      title={event.title}
    >
      <span className='truncate'>{event.title}</span>
    </button>
  );
}

function TimeGrid(props: {
  days: number[];
  now: number;
  events: CalEvent[];
  draggingKey?: string;
  createPreview: { start: number; end: number } | null;
  bodyRef: MutableRefObject<HTMLDivElement | null>;
  scrollRef: MutableRefObject<HTMLDivElement | null>;
  onStartDrag: (e: ReactPointerEvent, kind: DragState['kind'], event?: CalEvent) => void;
  onOpen: (e: CalEvent) => void;
  onCreateAllDay: (day: number) => void;
}) {
  const { days, now, events, draggingKey, createPreview, bodyRef, scrollRef, onStartDrag, onOpen, onCreateAllDay } = props;
  const todayStart = startOfDay(now);
  const allDayByDay = days.map((d) => events.filter((e) => e.allDay && e.start < addDays(d, 1) && e.end > d));
  const placedByDay = useMemo(() => days.map((d) => placeDay(events, d)), [days, events]);

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='flex shrink-0 border-b border-border-primary'>
        <div className='w-14 shrink-0' />
        {days.map((d) => {
          const isToday = d === todayStart;

          return (
            <div key={d} className='flex flex-1 flex-col items-center py-2'>
              <span className='text-xs text-text-secondary'>{fmtWeekday(d)}</span>
              <span
                className='mt-0.5 flex h-7 min-w-[28px] items-center justify-center rounded-full px-1 text-base font-medium'
                style={isToday ? { background: 'var(--text-primary)', color: 'var(--background-primary)' } : undefined}
              >
                {new Date(d).getDate()}
              </span>
            </div>
          );
        })}
      </div>
      <div className='flex shrink-0 border-b border-border-primary'>
        <div className='flex w-14 shrink-0 items-start justify-end pr-2 pt-1 text-[11px] text-text-tertiary'>All day</div>
        {days.map((d, i) => (
          <div
            key={d}
            className='flex min-h-[28px] min-w-0 flex-1 flex-col gap-0.5 border-l border-border-primary p-0.5'
            onDoubleClick={() => onCreateAllDay(d)}
          >
            {allDayByDay[i].slice(0, 3).map((e) => (
              <EventChip key={e.key} event={e} onOpen={onOpen} />
            ))}
            {allDayByDay[i].length > 3 && (
              <span className='px-1 text-[11px] text-text-secondary'>+{allDayByDay[i].length - 3} more</span>
            )}
          </div>
        ))}
      </div>
      <div ref={scrollRef} className='relative min-h-0 flex-1 overflow-y-auto'>
        <div className='relative flex' style={{ height: 24 * HOUR_PX }}>
          <div className='relative w-14 shrink-0'>
            {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
              <div key={h} className='absolute right-2 text-[11px] text-text-tertiary' style={{ top: h * HOUR_PX - 7 }}>
                {fmtHour(h)}
              </div>
            ))}
          </div>
          <div ref={bodyRef} className='relative flex flex-1 select-none'>
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className='pointer-events-none absolute left-0 right-0 border-t border-border-primary'
                style={{ top: h * HOUR_PX }}
              />
            ))}
            {days.map((d, i) => (
              <div
                key={d}
                className='relative min-w-0 flex-1 border-l border-border-primary'
                onPointerDown={(e) => onStartDrag(e, 'create')}
                data-testid='carehub-calendar-day'
              >
                {placedByDay[i].map((p) => {
                  const e = p.event;
                  const editable = !e.readOnly && Boolean(e.id);

                  return (
                    <div
                      key={e.key}
                      data-testid='carehub-calendar-event'
                      onPointerDown={(ev) => {
                        if (editable) onStartDrag(ev, 'move', e);
                        else ev.stopPropagation();
                      }}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        if (!editable) onOpen(e);
                      }}
                      className={cn(
                        'absolute overflow-hidden rounded-[6px] px-1.5 py-0.5 text-xs leading-tight',
                        editable ? 'cursor-grab' : 'cursor-pointer',
                        draggingKey === e.key && 'shadow-lg'
                      )}
                      style={{
                        top: p.top,
                        height: p.height,
                        left: `calc(${(p.col / p.cols) * 100}% + 1px)`,
                        width: `calc(${100 / p.cols}% - 4px)`,
                        background: `${e.color}24`,
                        borderLeft: `3px solid ${e.color}`,
                        color: 'var(--text-primary)',
                        zIndex: draggingKey === e.key ? 5 : 1,
                      }}
                      title={`${e.title} · ${fmtTime(e.start)} – ${fmtTime(e.end)}`}
                    >
                      <div className='truncate font-medium'>{e.title}</div>
                      {p.height > 30 && (
                        <div className='truncate text-text-secondary'>
                          {fmtTime(e.start)} – {fmtTime(e.end)}
                        </div>
                      )}
                      {editable && (
                        <div
                          className='absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize'
                          onPointerDown={(ev) => onStartDrag(ev, 'resize', e)}
                        />
                      )}
                    </div>
                  );
                })}
                {createPreview && startOfDay(createPreview.start) === d && (
                  <div
                    className='pointer-events-none absolute left-0.5 right-1 rounded-[6px] border border-border-theme-thick px-1.5 py-0.5 text-xs'
                    style={{
                      top: (minutesOfDay(createPreview.start) / 60) * HOUR_PX,
                      height: Math.max(18, ((createPreview.end - createPreview.start) / 3600000) * HOUR_PX - 2),
                      background: 'var(--fill-content-hover)',
                      zIndex: 6,
                    }}
                  >
                    {fmtTime(createPreview.start)} – {fmtTime(createPreview.end)}
                  </div>
                )}
                {d === todayStart && (
                  <div
                    className='pointer-events-none absolute left-0 right-0'
                    style={{ top: (minutesOfDay(now) / 60) * HOUR_PX, zIndex: 4 }}
                  >
                    <div className='relative h-[2px] bg-[#ef4444]'>
                      <div className='absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-[#ef4444]' />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// month grid
// ---------------------------------------------------------------------------

function MonthGrid(props: {
  days: number[];
  cursor: number;
  events: CalEvent[];
  onOpen: (e: CalEvent) => void;
  onCreate: (day: number) => void;
  onMore: (day: number) => void;
}) {
  const { days, cursor, events, onOpen, onCreate, onMore } = props;
  const month = new Date(cursor).getMonth();
  const todayStart = startOfDay(Date.now());

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='grid shrink-0 grid-cols-7 border-b border-border-primary'>
        {days.slice(0, 7).map((d) => (
          <div key={d} className='py-2 text-center text-xs text-text-secondary'>
            {fmtWeekday(d)}
          </div>
        ))}
      </div>
      <div className='grid min-h-0 flex-1 grid-cols-7 grid-rows-6'>
        {days.map((d) => {
          const dayEvents = events
            .filter((e) => e.start < addDays(d, 1) && Math.max(e.end, e.start + 1) > d)
            .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start);
          const inMonth = new Date(d).getMonth() === month;

          return (
            <div
              key={d}
              className='flex min-h-0 min-w-0 flex-col gap-0.5 overflow-hidden border-b border-l border-border-primary p-1'
              onClick={() => onCreate(d)}
              data-testid='carehub-calendar-month-day'
            >
              <div className='flex justify-end'>
                <span
                  className={cn('flex h-6 min-w-[24px] items-center justify-center rounded-full px-1 text-xs', !inMonth && 'text-text-tertiary')}
                  style={d === todayStart ? { background: 'var(--text-primary)', color: 'var(--background-primary)' } : undefined}
                >
                  {new Date(d).getDate()}
                </span>
              </div>
              {dayEvents.slice(0, 3).map((e) =>
                e.allDay ? (
                  <EventChip key={e.key} event={e} onOpen={onOpen} />
                ) : (
                  <button
                    key={e.key}
                    type='button'
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onOpen(e);
                    }}
                    className='flex min-w-0 items-center gap-1 rounded-[4px] px-1 py-0.5 text-left text-xs hover:bg-fill-content-hover'
                    title={e.title}
                  >
                    <span className='h-1.5 w-1.5 shrink-0 rounded-full' style={{ background: e.color }} />
                    <span className='shrink-0 text-text-secondary'>{fmtTime(e.start)}</span>
                    <span className='truncate'>{e.title}</span>
                  </button>
                )
              )}
              {dayEvents.length > 3 && (
                <button
                  type='button'
                  className='px-1 text-left text-[11px] text-text-secondary hover:text-text-primary'
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onMore(d);
                  }}
                >
                  +{dayEvents.length - 3} more
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// details panel and editor
// ---------------------------------------------------------------------------

function EventPanel({
  event,
  onClose,
  onEdit,
  onDelete,
}: {
  event: CalEvent;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
}) {
  const link = findMeetingLink(event.url, event.location, event.notes);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setConfirm(false);
    setError('');
  }, [event.key]);

  return (
    <div
      className='flex w-[320px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-border-primary p-4'
      data-testid='carehub-calendar-panel'
    >
      <div className='flex items-start gap-2'>
        <span className='mt-1.5 h-3 w-3 shrink-0 rounded-[3px]' style={{ background: event.color }} />
        <div className='min-w-0 flex-1 break-words text-lg font-semibold leading-snug'>{event.title}</div>
        <IconButton label='Close' onClick={onClose}>
          ×
        </IconButton>
      </div>
      <div className='text-sm text-text-secondary'>{eventTimeText(event)}</div>
      {link && (
        <Button className='w-full' onClick={() => window.open(link.url, '_blank', 'noopener')} data-testid='carehub-calendar-join'>
          {link.label}
        </Button>
      )}
      {event.location && (
        <div>
          <div className='text-xs font-medium uppercase tracking-wide text-text-tertiary'>Location</div>
          <div className='mt-1 break-words text-sm'>{event.location}</div>
        </div>
      )}
      {event.notes && (
        <div>
          <div className='text-xs font-medium uppercase tracking-wide text-text-tertiary'>Notes</div>
          <div className='mt-1 whitespace-pre-wrap break-words text-sm'>{event.notes}</div>
        </div>
      )}
      <div className='text-xs text-text-tertiary'>
        {event.calendarName}
        {event.readOnly ? ' · read-only (change it in that calendar app)' : ''}
      </div>
      {!event.readOnly && (
        <div className='flex flex-col gap-2'>
          {confirm ? (
            <div className='flex items-center gap-2 text-sm'>
              <span className='flex-1 text-text-secondary'>Delete this event?</span>
              <Button
                size='sm'
                variant='destructive'
                onClick={async () => {
                  try {
                    await onDelete();
                  } catch (err) {
                    setError(errorText(err));
                  }
                }}
              >
                Delete
              </Button>
              <Button size='sm' variant='ghost' onClick={() => setConfirm(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className='flex gap-2'>
              <Button size='sm' variant='outline' onClick={onEdit}>
                Edit
              </Button>
              <Button size='sm' variant='ghost' onClick={() => setConfirm(true)}>
                Delete
              </Button>
            </div>
          )}
          {error && <div className='text-xs text-text-error'>{error}</div>}
        </div>
      )}
    </div>
  );
}

function EventEditor({
  initial,
  defaultColor,
  onClose,
  onSave,
  onDelete,
}: {
  initial: EditorState;
  defaultColor: string;
  onClose: () => void;
  onSave: (s: EditorState) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [state, setState] = useState<EditorState>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<EditorState>) => setState((s) => ({ ...s, ...patch }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await onSave(state);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const labelCls = 'text-xs font-medium text-text-secondary';
  const fieldCls =
    'h-9 rounded-[8px] border border-border-primary bg-transparent px-2 text-sm text-text-primary outline-none focus:border-border-theme-thick';

  return (
    <div
      className='fixed inset-0 z-[1300] flex items-center justify-center bg-black/30 p-4'
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        className='flex max-h-full w-[460px] max-w-full flex-col gap-3 overflow-y-auto rounded-[12px] border border-border-primary bg-background-primary p-5 shadow-xl'
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        data-testid='carehub-calendar-editor'
      >
        <div className='text-base font-semibold'>{state.id ? 'Edit event' : 'New event'}</div>
        <Input autoFocus placeholder='Title' value={state.title} onChange={(e) => set({ title: e.target.value })} />
        <label className='flex cursor-pointer items-center gap-2 text-sm'>
          <input type='checkbox' className='h-4 w-4' checked={state.allDay} onChange={(e) => set({ allDay: e.target.checked })} />
          All day
        </label>
        <div className='grid grid-cols-[60px_1fr_130px] items-center gap-2'>
          <span className={labelCls}>Starts</span>
          <input
            type='date'
            className={fieldCls}
            value={state.startDate}
            onChange={(e) => {
              const v = e.target.value;

              set({ startDate: v, endDate: !state.endDate || state.endDate < v ? v : state.endDate });
            }}
          />
          {!state.allDay ? (
            <input type='time' step={300} className={fieldCls} value={state.startTime} onChange={(e) => set({ startTime: e.target.value })} />
          ) : (
            <span />
          )}
          <span className={labelCls}>Ends</span>
          <input type='date' className={fieldCls} value={state.endDate} onChange={(e) => set({ endDate: e.target.value })} />
          {!state.allDay ? (
            <input type='time' step={300} className={fieldCls} value={state.endTime} onChange={(e) => set({ endTime: e.target.value })} />
          ) : (
            <span />
          )}
        </div>
        <div className='flex flex-col gap-1'>
          <span className={labelCls}>Location or video link (Zoom, Meet, Teams)</span>
          <Input placeholder='https://zoom.us/j/…' value={state.location} onChange={(e) => set({ location: e.target.value })} />
        </div>
        <div className='flex flex-col gap-1'>
          <span className={labelCls}>Notes</span>
          <textarea
            rows={4}
            className='rounded-[8px] border border-border-primary bg-transparent p-2 text-sm text-text-primary outline-none focus:border-border-theme-thick'
            value={state.notes}
            onChange={(e) => set({ notes: e.target.value })}
          />
        </div>
        <div className='flex items-center gap-2'>
          <span className={labelCls}>Colour</span>
          {COLORS.map((c) => (
            <button
              key={c}
              type='button'
              aria-label='Colour'
              onClick={() => set({ color: c === defaultColor ? '' : c })}
              className={cn(
                'h-4 w-4 rounded-full',
                (state.color || defaultColor) === c && 'ring-2 ring-offset-1 ring-[var(--border-theme-thick)]'
              )}
              style={{ background: c }}
            />
          ))}
        </div>
        {error && (
          <div role='alert' className='text-sm text-text-error'>
            {error}
          </div>
        )}
        <div className='mt-1 flex items-center gap-2'>
          {onDelete && (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={async () => {
                setBusy(true);
                try {
                  await onDelete();
                } catch (err) {
                  setError(errorText(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Delete
            </Button>
          )}
          <div className='flex-1' />
          <Button type='button' variant='outline' size='sm' onClick={onClose}>
            Cancel
          </Button>
          <Button type='submit' size='sm' disabled={busy} data-testid='carehub-calendar-save'>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </div>
  );
}

// CareHub sidebar top: Home / Messages / Calendar buttons (like Notion) and a
// short "Upcoming events" list under them.
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { cn } from '@/lib/utils';

import { CAREHUB_CALENDAR_PATH, type CalEvent, loadUpcomingEvents, upcomingTimeText } from './CareHubCalendar';
import { CAREHUB_MESSAGES_PATH, ChatBubbleIcon, useCareHubUnread } from './CareHubMessages';

const LAST_PAGE_KEY = 'carehub-last-page';
const COLLAPSED_KEY = 'carehub-sidebar-upcoming-collapsed';
const REFRESH_MS = 5 * 60 * 1000;

function HomeIcon() {
  return (
    <svg width='18' height='18' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
      <path d='M11.3 3.3a1 1 0 0 1 1.4 0l8 7.6a1 1 0 0 1-.7 1.7H19v7.4a1 1 0 0 1-1 1h-3.6a1 1 0 0 1-1-1v-4.6h-2.8V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7.4H4a1 1 0 0 1-.7-1.7Z' />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8'
      strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
      <rect x='3.5' y='5' width='17' height='15.5' rx='2.5' />
      <path d='M3.5 10h17' strokeWidth='3' />
      <path d='M8 3v4M16 3v4' />
    </svg>
  );
}

function currentTab(path: string) {
  if (path.startsWith(CAREHUB_MESSAGES_PATH)) return 'messages';
  if (path.startsWith(CAREHUB_CALENDAR_PATH)) return 'calendar';

  return 'home';
}

export function CareHubSidebarTabs({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const unread = useCareHubUnread();
  const tab = currentTab(location.pathname);

  // Remember the last normal page, so "Home" goes back to it.
  useEffect(() => {
    if (tab === 'home' && location.pathname.startsWith('/app/') && location.pathname !== '/app/trash') {
      try {
        sessionStorage.setItem(LAST_PAGE_KEY, location.pathname + location.search);
      } catch {
        // ignore
      }
    }
  }, [tab, location.pathname, location.search]);

  const go = (path: string) => {
    navigate(path);
    onNavigate?.();
  };

  const goHome = () => {
    let last = '';

    try {
      last = sessionStorage.getItem(LAST_PAGE_KEY) || '';
    } catch {
      // ignore
    }

    go(last || '/app');
  };

  const items = [
    { id: 'home', label: 'Home', icon: <HomeIcon />, run: goHome, badge: 0 },
    { id: 'messages', label: 'Messages', icon: <ChatBubbleIcon />, run: () => go(CAREHUB_MESSAGES_PATH), badge: unread },
    { id: 'calendar', label: 'Calendar', icon: <CalendarIcon />, run: () => go(CAREHUB_CALENDAR_PATH), badge: 0 },
  ];

  return (
    <div className='flex w-full items-center gap-1 py-1' data-testid='carehub-sidebar-tabs' role='tablist'>
      {items.map((item) => {
        const active = tab === item.id;

        return (
          <button
            key={item.id}
            type='button'
            role='tab'
            aria-selected={active}
            aria-label={item.label}
            title={item.label}
            data-testid={`carehub-tab-${item.id}`}
            onClick={item.run}
            className={cn(
              'relative flex h-9 items-center gap-2 rounded-[10px] px-2.5 text-sm transition-colors',
              active
                ? 'bg-fill-content-hover font-medium text-text-primary'
                : 'text-text-secondary hover:bg-fill-content-hover hover:text-text-primary'
            )}
          >
            <span className='relative flex items-center'>
              {item.icon}
              {item.badge > 0 && (
                <span
                  data-testid='carehub-unread-badge'
                  className='absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ef4444] px-1 text-[10px] font-semibold leading-none text-white'
                >
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </span>
            {active && <span>{item.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function CareHubUpcomingEvents({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [events, setEvents] = useState<CalEvent[] | null>(null);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const onCalendar = location.pathname === CAREHUB_CALENDAR_PATH;

  useEffect(() => {
    if (collapsed) return;
    let alive = true;
    const load = async () => {
      try {
        const next = await loadUpcomingEvents(7, 5);

        if (alive) setEvents(next);
      } catch {
        if (alive) setEvents([]);
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
    // Reload when coming back from the calendar, where events may have changed.
  }, [collapsed, onCalendar]);

  const toggle = () => {
    const next = !collapsed;

    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      // ignore
    }
  };

  const open = (path: string) => {
    navigate(path);
    onNavigate?.();
  };

  return (
    <div className='mx-1 mb-1 flex flex-col' data-testid='carehub-upcoming'>
      <button
        type='button'
        onClick={toggle}
        className='flex h-7 items-center gap-1 rounded-[6px] px-2 text-left text-xs font-medium text-text-tertiary hover:bg-fill-content-hover'
      >
        <span className='flex-1'>Upcoming events</span>
        <svg
          width='12'
          height='12'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          strokeWidth='2'
          className={cn('transition-transform', collapsed ? '-rotate-90' : '')}
          aria-hidden='true'
        >
          <path d='m6 9 6 6 6-6' />
        </svg>
      </button>
      {!collapsed && (
        <>
          {events !== null && events.length === 0 && (
            <div className='px-2 py-1 text-xs text-text-tertiary'>Nothing in the next 7 days</div>
          )}
          {(events ?? []).map((e) => (
            <button
              key={e.key}
              type='button'
              data-testid='carehub-upcoming-row'
              onClick={() => open(`${CAREHUB_CALENDAR_PATH}?date=${e.start}`)}
              className='flex h-8 w-full items-center gap-2.5 rounded-[6px] px-2 text-left text-sm hover:bg-fill-content-hover'
            >
              <span className='h-3 w-3 shrink-0 rounded-[3px]' style={{ background: e.color || '#171717' }} />
              <span className='min-w-0 flex-1 truncate text-text-primary'>{e.title}</span>
              <span className='shrink-0 text-xs text-text-tertiary'>{upcomingTimeText(e)}</span>
            </button>
          ))}
          <button
            type='button'
            onClick={() => open(CAREHUB_CALENDAR_PATH)}
            className='flex h-8 w-full items-center gap-2.5 rounded-[6px] px-2 text-left text-sm text-text-secondary hover:bg-fill-content-hover'
          >
            <span className='flex w-3 justify-center text-text-tertiary'>···</span>
            View all
          </button>
        </>
      )}
    </div>
  );
}

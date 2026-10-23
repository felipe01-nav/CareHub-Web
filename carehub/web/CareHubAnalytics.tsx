// CareHub analytics: who opened and edited which pages, and when.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { cn } from '@/lib/utils';

import {
  chCall,
  chErrorText,
  CH_API,
  formatWhen,
  lastWorkspaceId,
  tzMinutesEast,
  useCareHubCan,
  useCareHubMe,
} from './CareHubCore';
import { CareHubModal, ChBars, ChCard, ChNote, ChPersonChip, ChSection } from './CareHubUi';

export const CAREHUB_ANALYTICS_PATH = '/app/analytics';

interface APerson {
  uuid: string;
  name: string;
  email?: string;
  avatar?: string | null;
}

interface WorkspaceAnalytics {
  days: number;
  tracking_since?: number | null;
  totals: { views: number; edits: number; people: number; pages: number; editors: number; versions: number };
  daily: { day: number; views: number; edits: number; people: number }[];
  hours: { hour: number; count: number }[];
  weekdays: { weekday: number; count: number }[];
  pages: { page_id: string; title: string; views: number; edits: number; people: number; last_at: number }[];
  people: { person: APerson; views: number; edits: number; pages: number; last_at: number }[];
}

interface PageAnalytics {
  title: string;
  first_seen?: number | null;
  views: number;
  edits: number;
  people: number;
  last_viewed?: number | null;
  last_edited?: number | null;
  versions: number;
  daily: { day: number; views: number; edits: number }[];
  visitors: { person: APerson; views: number; edits: number; last_at: number }[];
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dayLabel(day: number) {
  return new Date(day * 86400000).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Fills in days with no activity so the chart has no gaps. */
function fillDays<T extends { day: number }>(rows: T[], days: number, empty: (day: number) => T) {
  const today = Math.floor((Date.now() + tzMinutesEast() * 60000) / 86400000);
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out: T[] = [];

  for (let d = today - days + 1; d <= today; d++) out.push(byDay.get(d) || empty(d));
  return out;
}

function hourLabel(h: number) {
  return h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`;
}

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
];

function RangePicker({ value, onChange }: { value: number; onChange: (d: number) => void }) {
  return (
    <div className='flex rounded-[10px] border border-border-primary p-0.5'>
      {RANGES.map((r) => (
        <button
          key={r.days}
          type='button'
          onClick={() => onChange(r.days)}
          className={cn(
            'rounded-[8px] px-2.5 py-1 text-xs',
            value === r.days ? 'bg-fill-content-hover font-medium text-text-primary' : 'text-text-secondary hover:text-text-primary'
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

function Legend() {
  return (
    <div className='flex gap-3 text-[11px] text-text-tertiary'>
      <span className='flex items-center gap-1'>
        <span className='inline-block h-2 w-2 rounded-sm bg-[#6366f1]' /> Views
      </span>
      <span className='flex items-center gap-1'>
        <span className='inline-block h-2 w-2 rounded-sm bg-[#f59e0b]' /> Edits
      </span>
    </div>
  );
}

export default function CareHubAnalyticsPage() {
  const ctxWorkspace = useCurrentWorkspaceId();
  const workspaceId = ctxWorkspace || lastWorkspaceId() || '';
  const me = useCareHubMe(workspaceId);
  const allowed = useCareHubCan(workspaceId, 'analytics');
  const navigate = useNavigate();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<WorkspaceAnalytics | null>(null);
  const [error, setError] = useState('');
  const [pageOpen, setPageOpen] = useState<{ id: string; title: string } | null>(null);

  useEffect(() => {
    document.title = 'Analytics · Care Hub';
  }, []);

  useEffect(() => {
    if (!workspaceId || !allowed) return;
    let cancelled = false;

    setError('');
    chCall<WorkspaceAnalytics>('get', `${CH_API}/${workspaceId}/analytics?days=${days}&tz=${tzMinutesEast()}`)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(chErrorText(e)));
    return () => {
      cancelled = true;
    };
  }, [workspaceId, days, allowed]);

  const daily = useMemo(
    () => (data ? fillDays(data.daily, Math.min(days, 90), (day) => ({ day, views: 0, edits: 0, people: 0 })) : []),
    [data, days]
  );

  if (me && !allowed) {
    return (
      <div className='mx-auto max-w-[720px] p-8'>
        <ChNote>Analytics are only for people with the “See analytics” permission. Ask an admin if you need it.</ChNote>
      </div>
    );
  }

  const hours = Array.from({ length: 24 }, (_, h) => data?.hours.find((x) => x.hour === h)?.count || 0);
  const weekdays = Array.from({ length: 7 }, (_, w) => data?.weekdays.find((x) => x.weekday === w)?.count || 0);

  return (
    <div className='carehub-analytics mx-auto w-full max-w-[1000px] px-4 py-6 sm:px-8' data-testid='carehub-analytics'>
      <div className='mb-5 flex flex-wrap items-center gap-3'>
        <h1 className='flex-1 text-2xl font-semibold'>📈 Analytics</h1>
        <RangePicker value={days} onChange={setDays} />
      </div>
      {error && (
        <div className='mb-4'>
          <ChNote tone='error'>{error}</ChNote>
        </div>
      )}
      {!data ? (
        !error && <div className='text-sm text-text-tertiary'>Loading…</div>
      ) : (
        <>
          {data.tracking_since && Date.now() - data.tracking_since < days * 86400000 && (
            <div className='mb-4'>
              <ChNote>Counting started {formatWhen(data.tracking_since)}, so older activity isn’t included.</ChNote>
            </div>
          )}
          <div className='mb-6 flex flex-wrap gap-3'>
            <ChCard label='Page views' value={data.totals.views.toLocaleString()} />
            <ChCard label='Edits' value={data.totals.edits.toLocaleString()} hint='visits with changes' />
            <ChCard label='Active people' value={data.totals.people} hint={`${data.totals.editors} edited`} />
            <ChCard label='Pages used' value={data.totals.pages} />
            <ChCard label='Saved versions' value={data.totals.versions} />
          </div>

          <ChSection title='Activity by day' right={<Legend />} hint={days > 90 ? 'Last 90 days shown' : undefined}>
            <ChBars
              height={140}
              color='#6366f1'
              second='#f59e0b'
              data={daily.map((d) => ({
                label: dayLabel(d.day),
                value: d.views,
                value2: d.edits,
                title: `${dayLabel(d.day)}: ${d.views} views, ${d.edits} edits, ${d.people} people`,
              }))}
            />
            <div className='mt-1 flex justify-between text-[10px] text-text-tertiary'>
              <span>{daily[0] && dayLabel(daily[0].day)}</span>
              <span>Today</span>
            </div>
          </ChSection>

          <div className='flex flex-col gap-6 md:flex-row'>
            <div className='min-w-0 flex-[2]'>
              <ChSection title='Busiest hours'>
                <ChBars height={90} data={hours.map((c, h) => ({ label: hourLabel(h), value: c, title: `${hourLabel(h)}: ${c}` }))} />
                <div className='mt-1 flex justify-between text-[10px] text-text-tertiary'>
                  <span>12 AM</span>
                  <span>6 AM</span>
                  <span>12 PM</span>
                  <span>6 PM</span>
                  <span>11 PM</span>
                </div>
              </ChSection>
            </div>
            <div className='min-w-0 flex-1'>
              <ChSection title='Busiest days'>
                <ChBars height={90} data={weekdays.map((c, w) => ({ label: WEEKDAYS[w], value: c, title: `${WEEKDAYS[w]}: ${c}` }))} />
                <div className='mt-1 flex justify-between text-[10px] text-text-tertiary'>
                  {WEEKDAYS.map((w) => (
                    <span key={w}>{w[0]}</span>
                  ))}
                </div>
              </ChSection>
            </div>
          </div>

          <ChSection title='Top pages' hint='Click a page for details'>
            {data.pages.length === 0 ? (
              <div className='text-sm text-text-tertiary'>No page visits yet.</div>
            ) : (
              <div className='overflow-x-auto'>
                <table className='w-full text-sm'>
                  <thead>
                    <tr className='text-left text-xs text-text-tertiary'>
                      <th className='py-1 pr-2 font-normal'>Page</th>
                      <th className='px-2 py-1 text-right font-normal'>Views</th>
                      <th className='px-2 py-1 text-right font-normal'>Edits</th>
                      <th className='px-2 py-1 text-right font-normal'>People</th>
                      <th className='py-1 pl-2 text-right font-normal'>Last</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pages.slice(0, 50).map((p) => (
                      <tr key={p.page_id} className='border-t border-border-primary hover:bg-fill-content-hover'>
                        <td className='max-w-[320px] py-1.5 pr-2'>
                          <button
                            type='button'
                            className='block max-w-full truncate text-left hover:underline'
                            onClick={() => setPageOpen({ id: p.page_id, title: p.title || 'Untitled' })}
                          >
                            {p.title || 'Untitled'}
                          </button>
                        </td>
                        <td className='px-2 text-right'>{p.views}</td>
                        <td className='px-2 text-right'>{p.edits}</td>
                        <td className='px-2 text-right'>{p.people}</td>
                        <td className='whitespace-nowrap pl-2 text-right text-xs text-text-tertiary'>{formatWhen(p.last_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ChSection>

          <ChSection title='People'>
            {data.people.length === 0 ? (
              <div className='text-sm text-text-tertiary'>Nobody yet.</div>
            ) : (
              <div className='flex flex-col'>
                {data.people.map((p) => (
                  <div key={p.person.uuid} className='flex items-center gap-3 border-t border-border-primary py-2 text-sm'>
                    <ChPersonChip name={p.person.name} avatar={p.person.avatar} size={28} />
                    <div className='min-w-0 flex-1'>
                      <div className='truncate'>{p.person.name || p.person.email}</div>
                      <div className='truncate text-xs text-text-tertiary'>
                        {p.views} views · {p.edits} edits · {p.pages} pages
                      </div>
                    </div>
                    <div className='shrink-0 text-xs text-text-tertiary'>{formatWhen(p.last_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </ChSection>
        </>
      )}
      {pageOpen && (
        <PageAnalyticsDialog
          workspaceId={workspaceId}
          pageId={pageOpen.id}
          title={pageOpen.title}
          onClose={() => setPageOpen(null)}
          onOpenPage={() => {
            navigate(`/app/${workspaceId}/${pageOpen.id}`);
            setPageOpen(null);
          }}
        />
      )}
    </div>
  );
}

export function PageAnalyticsDialog({
  workspaceId,
  pageId,
  title,
  onClose,
  onOpenPage,
}: {
  workspaceId: string;
  pageId: string;
  title?: string;
  onClose: () => void;
  onOpenPage?: () => void;
}) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<PageAnalytics | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    setError('');
    chCall<PageAnalytics>('get', `${CH_API}/${workspaceId}/analytics/page/${pageId}?days=${days}&tz=${tzMinutesEast()}`)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(chErrorText(e)));
    return () => {
      cancelled = true;
    };
  }, [workspaceId, pageId, days]);

  const daily = useMemo(
    () => (data ? fillDays(data.daily, Math.min(days, 90), (day) => ({ day, views: 0, edits: 0 })) : []),
    [data, days]
  );

  return (
    <CareHubModal
      wide
      title={`📈 ${data?.title || title || 'Page analytics'}`}
      onClose={onClose}
      testId='carehub-page-analytics'
      footer={
        onOpenPage ? (
          <button type='button' className='text-sm text-text-action hover:underline' onClick={onOpenPage}>
            Open page
          </button>
        ) : undefined
      }
    >
      <div className='mb-4 flex justify-end'>
        <RangePicker value={days} onChange={setDays} />
      </div>
      {error && <ChNote tone='error'>{error}</ChNote>}
      {!data ? (
        !error && <div className='text-sm text-text-tertiary'>Loading…</div>
      ) : (
        <>
          <div className='mb-5 flex flex-wrap gap-3'>
            <ChCard label='Views' value={data.views} />
            <ChCard label='Edits' value={data.edits} />
            <ChCard label='People' value={data.people} />
            <ChCard label='Versions' value={data.versions} />
          </div>
          <div className='mb-4 grid grid-cols-1 gap-1 text-xs text-text-secondary sm:grid-cols-2'>
            <div>Last viewed: {data.last_viewed ? formatWhen(data.last_viewed) : '—'}</div>
            <div>Last edited: {data.last_edited ? formatWhen(data.last_edited) : '—'}</div>
            {data.first_seen && <div>First seen: {formatWhen(data.first_seen)}</div>}
          </div>
          <ChSection title='By day' right={<Legend />}>
            <ChBars
              height={110}
              color='#6366f1'
              second='#f59e0b'
              data={daily.map((d) => ({
                label: dayLabel(d.day),
                value: d.views,
                value2: d.edits,
                title: `${dayLabel(d.day)}: ${d.views} views, ${d.edits} edits`,
              }))}
            />
          </ChSection>
          <ChSection title='Who visited'>
            {data.visitors.length === 0 ? (
              <div className='text-sm text-text-tertiary'>No visits in this period.</div>
            ) : (
              data.visitors.map((v) => (
                <div key={v.person.uuid} className='flex items-center gap-3 border-t border-border-primary py-2 text-sm'>
                  <ChPersonChip name={v.person.name} avatar={v.person.avatar} />
                  <div className='min-w-0 flex-1 truncate'>{v.person.name || v.person.email}</div>
                  <div className='shrink-0 text-xs text-text-tertiary'>
                    {v.views} views · {v.edits} edits · {formatWhen(v.last_at)}
                  </div>
                </div>
              ))
            )}
          </ChSection>
        </>
      )}
    </CareHubModal>
  );
}

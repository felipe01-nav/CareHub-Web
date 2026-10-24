// CareHub: Learning reports → "Overview" tab. The last 7, 30 or 90 days at a glance: who's learning, courses finished,
// quiz pass rate, certificates, what's overdue right now, and activity by day. Read-only.
import { useCallback, useEffect, useState } from 'react';

import type { MouseEvent, ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { chCall, CH_API, tzMinutesEast } from './CareHubCore';
import { isTransientError, LEARNING_PATH, learningNotLive, lErrorText, num, plural, str } from './CareHubLearningApi';
import { ChCard, ChNote, ChSection } from './CareHubUi';

// Same addresses as CareHubLearningReports.tsx (not imported from there: that file imports this one).
const REPORTS_HOME = `${LEARNING_PATH}/reports`;
const TEAMS_REPORT = `${REPORTS_HOME}/teams`;
const courseReport = (id: string) => `${REPORTS_HOME}/course/${id}`;

const DAY_MS = 86400000;
/** Chart colours (also used by the legend). Dark amber dots (5:1 on white), ringed in the page colour so they show on a bar too. */
const BAR = 'var(--fill-theme-thick, #6366f1)';
const DOT = '#b45309';
const DOT_RING = 'var(--background-primary, #fff)';

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export type OverviewDays = 7 | 30 | 90;
export const OVERVIEW_DAYS: OverviewDays[] = [7, 30, 90];

/** One day on the chart: people who did any learning that day, and courses finished that day. */
export interface OverviewDay {
  day_ms: number;
  active: number;
  finished: number;
}

export interface OverviewCourse {
  course_id: string;
  title: string;
  status: 'draft' | 'published' | 'archived';
  active: number;
  finished: number;
}

/**
 * GET /learning/reports/overview: this period and the one just before it (same length), current members only.
 * `tz_minutes` is the time zone we asked for (each day starts at midnight there); the server doesn't send it.
 */
export interface LearningOverview {
  days: number;
  since_ms: number;
  until_ms: number;
  tz_minutes: number;
  members: number;
  active: number;
  active_prev: number;
  finished: number;
  finished_prev: number;
  attempts: number;
  passed: number;
  attempts_prev: number;
  passed_prev: number;
  certificates: number;
  certificates_prev: number;
  by_day: OverviewDay[];
  top_courses: OverviewCourse[];
}

/** What's overdue right now, from the Teams report: the total, and the most overdue courses (up to 5). */
export interface OverdueNow {
  total: number;
  courses: { course_id: string; title: string; overdue: number }[];
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function countOf(v: unknown) {
  return Math.max(0, Math.round(num(v)));
}

function overviewOf(v: unknown, days: number, tz: number): LearningOverview {
  const o = obj(v);

  return {
    days: countOf(o.days) || days,
    since_ms: num(o.since_ms),
    until_ms: num(o.until_ms),
    tz_minutes: tz,
    members: countOf(o.members),
    active: countOf(o.active),
    active_prev: countOf(o.active_prev),
    finished: countOf(o.finished),
    finished_prev: countOf(o.finished_prev),
    attempts: countOf(o.attempts),
    passed: countOf(o.passed),
    attempts_prev: countOf(o.attempts_prev),
    passed_prev: countOf(o.passed_prev),
    certificates: countOf(o.certificates),
    certificates_prev: countOf(o.certificates_prev),
    by_day: arr(o.by_day)
      .map((d): OverviewDay => {
        const x = obj(d);

        return { day_ms: num(x.day_ms), active: countOf(x.active), finished: countOf(x.finished) };
      })
      .sort((a, b) => a.day_ms - b.day_ms),
    top_courses: arr(o.top_courses)
      .map((c): OverviewCourse => {
        const x = obj(c);
        const status = str(x.status);

        return {
          course_id: str(x.course_id),
          title: str(x.title).trim() || 'Untitled course',
          status: status === 'draft' || status === 'archived' ? status : 'published',
          active: countOf(x.active),
          finished: countOf(x.finished),
        };
      })
      .filter((c) => c.course_id),
  };
}

function overdueOf(v: unknown): OverdueNow {
  const courses = arr(obj(v).courses)
    .map((c) => {
      const x = obj(c);

      return { course_id: str(x.course_id), title: str(x.title).trim() || 'Untitled course', overdue: countOf(x.overdue) };
    })
    .filter((c) => c.course_id);

  return {
    total: courses.reduce((n, c) => n + c.overdue, 0),
    courses: courses
      .filter((c) => c.overdue > 0)
      .sort((a, b) => b.overdue - a.overdue || a.title.localeCompare(b.title))
      .slice(0, 5),
  };
}

const reportsBase = (ws: string) => `${CH_API}/${ws}/learning/reports`;

export const overviewApi = {
  overview: (ws: string, days: number) => {
    const tz = tzMinutesEast();

    return chCall<unknown>('get', `${reportsBase(ws)}/overview?days=${days}&tz_minutes=${tz}`).then((d) => overviewOf(d, days, tz));
  },
  /** The Teams report already has every assigned course's overdue count. */
  overdue: (ws: string) => chCall<unknown>('get', `${reportsBase(ws)}/teams`).then(overdueOf),
};

/** The period in the address: `?days=30` or `?days=90`; anything else is the last 7 days. */
export function overviewDays(search: string): OverviewDays {
  const d = new URLSearchParams(search).get('days');

  return d === '30' ? 30 : d === '90' ? 90 : 7;
}

/** Whole-number percentage, or null when there were no attempts. */
function passRate(passed: number, attempts: number) {
  return attempts > 0 ? Math.min(100, Math.round((passed / attempts) * 100)) : null;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Fri 23 Oct" for the day starting at `ms` in the report's time zone (with the year when it isn't this year). */
function dayLabel(ms: number, tz: number) {
  const t = new Date(ms + tz * 60000);
  const year = t.getUTCFullYear() !== new Date().getFullYear() ? ` ${t.getUTCFullYear()}` : '';

  return `${WEEKDAYS[t.getUTCDay()]} ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}${year}`;
}

/**
 * Loads once per `load` (keep it stable with useCallback). While a new `load` runs, the last data stays on screen
 * (`stale`), so switching the period doesn't blank the page.
 */
function useLoad<T>(load: () => Promise<T>) {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<{ load: (() => Promise<T>) | null; data: T | null; error: unknown }>({
    load: null,
    data: null,
    error: null,
  });

  useEffect(() => {
    let alive = true;

    load().then(
      (data) => {
        if (alive) setState({ load, data, error: null });
      },
      (e: unknown) => {
        if (!alive) return;
        setState((s) => ({
          load,
          data: s.load === load ? s.data : null,
          error: e || new Error('Something went wrong. Please try again.'),
        }));
      }
    );
    return () => {
      alive = false;
    };
  }, [load, tick]);

  const reload = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
    setTick((n) => n + 1);
  }, []);
  const mine = state.load === load;

  return { data: state.data, stale: !mine && state.data !== null, error: mine ? state.error : null, reload };
}

/** Width of an element in pixels, kept up to date. Pass the returned ref callback to the element. */
function useWidth(): [number, (el: HTMLDivElement | null) => void] {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!el) return undefined;
    const measure = () => setWidth(Math.floor(el.getBoundingClientRect().width));

    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);

    observer?.observe(el);
    return () => observer?.disconnect();
  }, [el]);

  return [width, setEl];
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

function Loading() {
  return <div className='text-sm text-text-tertiary'>Loading…</div>;
}

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className='flex flex-col items-start gap-3'>
      <ChNote tone={learningNotLive(error) ? 'info' : 'error'}>{lErrorText(error)}</ChNote>
      {isTransientError(error) && (
        <Button type='button' variant='outline' onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** A real link (so it can open in a new tab) that moves within the app on a plain click. */
function AppLink({ to, children, className, testId }: { to: string; children: ReactNode; className?: string; testId?: string }) {
  const navigate = useNavigate();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };

  return (
    <a
      href={to}
      onClick={onClick}
      className={cn('rounded-[4px] text-text-primary underline-offset-2 hover:underline', className)}
      data-testid={testId}
    >
      {children}
    </a>
  );
}

function PeriodPicker({ days, onPick }: { days: OverviewDays; onPick: (days: OverviewDays) => void }) {
  return (
    <div role='group' aria-label='Period' className='inline-flex rounded-[10px] border border-border-primary p-0.5'>
      {OVERVIEW_DAYS.map((d) => (
        <button
          key={d}
          type='button'
          aria-pressed={days === d}
          onClick={() => onPick(d)}
          className={cn(
            'rounded-[8px] px-3 py-1 text-sm',
            days === d ? 'bg-fill-content-hover font-medium text-text-primary' : 'text-text-secondary hover:text-text-primary'
          )}
          data-testid={`carehub-learning-overview-days-${d}`}
        >
          Last {d} days
        </button>
      ))}
    </div>
  );
}

/** "▲ 3 on the previous 7 days" / "▼ …" / "Same as the previous 7 days". */
function Change({ now, prev, days, unit }: { now: number; prev: number; days: number; unit?: [string, string] }) {
  const diff = now - prev;
  const n = Math.abs(diff);

  if (diff === 0) return <span className='block'>Same as the previous {days} days</span>;
  return (
    <span className='block'>
      <span aria-hidden='true'>{diff > 0 ? '▲' : '▼'} </span>
      <span className='sr-only'>{diff > 0 ? 'Up' : 'Down'} </span>
      {unit ? plural(n, unit[0], unit[1]) : n} on the previous {days} days
    </span>
  );
}

function OverviewCards({ o }: { o: LearningOverview }) {
  const rate = passRate(o.passed, o.attempts);
  const ratePrev = passRate(o.passed_prev, o.attempts_prev);

  return (
    <>
      <ChCard
        label='Active learners'
        value={o.active}
        hint={
          <>
            <span className='block'>
              {o.active} of {plural(o.members, 'person', 'people')}
            </span>
            <Change now={o.active} prev={o.active_prev} days={o.days} />
          </>
        }
      />
      <ChCard label='Courses finished' value={o.finished} hint={<Change now={o.finished} prev={o.finished_prev} days={o.days} />} />
      <ChCard
        label='Quiz pass rate'
        value={rate === null ? <span aria-hidden='true'>—</span> : `${rate}%`}
        hint={
          rate === null ? (
            'No quiz attempts yet'
          ) : (
            <>
              <span className='block'>
                {o.passed} of {plural(o.attempts, 'attempt')}
              </span>
              {ratePrev !== null && <Change now={rate} prev={ratePrev} days={o.days} unit={['point', 'points']} />}
            </>
          )
        }
      />
      <ChCard label='Certificates issued' value={o.certificates} hint={<Change now={o.certificates} prev={o.certificates_prev} days={o.days} />} />
    </>
  );
}

function OverdueCard({ data, error, onRetry }: { data: OverdueNow | null; error: unknown; onRetry: () => void }) {
  let value: ReactNode = <span aria-hidden='true'>…</span>;
  let hint: ReactNode = 'Loading…';

  if (data) {
    value = data.total;
    hint =
      data.total > 0 ? (
        <AppLink to={TEAMS_REPORT} className='font-medium underline' testId='carehub-learning-overview-see-overdue'>
          See overdue
        </AppLink>
      ) : (
        'Nothing is overdue'
      );
  } else if (error) {
    value = <span aria-hidden='true'>—</span>;
    hint = (
      <>
        Couldn’t load this.{' '}
        {isTransientError(error) && (
          <button type='button' onClick={onRetry} className='rounded-[4px] text-text-primary underline underline-offset-2'>
            Try again
          </button>
        )}
      </>
    );
  }

  return <ChCard label='Overdue now' value={value} hint={hint} />;
}

const CHART_H = 160;
const AXIS_W = 28;

/** A bar per day for active learners and a dot for courses finished, plus the same numbers as a table for screen readers. */
function ActivityChart({ o }: { o: LearningOverview }) {
  const [width, setEl] = useWidth();
  const days = o.by_day;
  const max = Math.max(1, ...days.map((d) => Math.max(d.active, d.finished)));
  const slot = days.length ? Math.max(0, width - AXIS_W) / days.length : 0;
  const barW = Math.max(1, Math.min(28, slot * 0.7));
  const dotR = Math.max(2, Math.min(4.5, slot * 0.35));
  const top = 10;
  const base = CHART_H - 1;
  const y = (v: number) => base - ((base - top) * v) / max;

  return (
    <div data-testid='carehub-learning-overview-chart'>
      <div ref={setEl} className='w-full' style={{ height: CHART_H }}>
        {width > 0 && (
          <svg width={width} height={CHART_H} aria-hidden='true' focusable='false' className='block text-text-tertiary'>
            <line x1={AXIS_W} x2={width} y1={y(max)} y2={y(max)} stroke='currentColor' strokeOpacity={0.35} strokeDasharray='3 3' />
            <line x1={AXIS_W} x2={width} y1={base + 0.5} y2={base + 0.5} stroke='currentColor' strokeOpacity={0.5} />
            <text x={AXIS_W - 6} y={y(max) + 4} textAnchor='end' fontSize={11} fill='currentColor'>
              {max}
            </text>
            <text x={AXIS_W - 6} y={base} textAnchor='end' fontSize={11} fill='currentColor'>
              0
            </text>
            {days.map((d, i) => {
              const cx = AXIS_W + slot * i + slot / 2;

              return (
                <g key={d.day_ms} data-testid='carehub-learning-overview-day'>
                  <title>{`${dayLabel(d.day_ms, o.tz_minutes)}: ${plural(d.active, 'active learner')}, ${plural(d.finished, 'course')} finished`}</title>
                  <rect x={AXIS_W + slot * i} y={0} width={slot} height={CHART_H} fill='transparent' />
                  {d.active > 0 && (
                    <rect x={cx - barW / 2} y={y(d.active)} width={barW} height={base - y(d.active)} rx={Math.min(3, barW / 2)} fill={BAR} />
                  )}
                  {d.finished > 0 && <circle cx={cx} cy={y(d.finished)} r={dotR} fill={DOT} stroke={DOT_RING} strokeWidth={1.5} />}
                </g>
              );
            })}
          </svg>
        )}
      </div>
      {days.length > 0 && (
        <div className='mt-1 flex justify-between gap-2 text-[11px] text-text-tertiary' style={{ paddingLeft: AXIS_W }} aria-hidden='true'>
          <span>{dayLabel(days[0].day_ms, o.tz_minutes)}</span>
          <span>{dayLabel(days[days.length - 1].day_ms, o.tz_minutes)}</span>
        </div>
      )}
      <div className='mt-2 flex flex-wrap gap-4 text-xs text-text-secondary' aria-hidden='true'>
        <span className='inline-flex items-center gap-1.5'>
          <span className='inline-block h-2.5 w-2.5 rounded-[2px]' style={{ background: BAR }} />
          Active learners
        </span>
        <span className='inline-flex items-center gap-1.5'>
          <span className='inline-block h-2.5 w-2.5 rounded-full' style={{ background: DOT }} />
          Courses finished
        </span>
      </div>
      <div className='sr-only'>
        <table data-testid='carehub-learning-overview-table'>
          <caption>Activity by day, last {o.days} days</caption>
          <thead>
            <tr>
              <th scope='col'>Day</th>
              <th scope='col'>Active learners</th>
              <th scope='col'>Courses finished</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day_ms}>
                <th scope='row'>{dayLabel(d.day_ms, o.tz_minutes)}</th>
                <td>{d.active}</td>
                <td>{d.finished}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface ListRow {
  id: string;
  title: string;
  tag?: string;
  cells: number[];
}

/** A short list of courses: the title opens the course report, then a number column or two. */
function CourseList({ head, rows, testId }: { head: string[]; rows: ListRow[]; testId: string }) {
  return (
    <div className='overflow-x-auto rounded-[12px] border border-border-primary' data-testid={testId}>
      <table className='w-full text-sm'>
        <thead>
          <tr className='border-b border-border-primary text-left text-xs text-text-tertiary'>
            {head.map((h, i) => (
              <th key={h} scope='col' className={cn('px-3 py-2 font-normal', i > 0 && 'w-[1%] whitespace-nowrap text-right')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className='border-b border-border-primary last:border-b-0'>
              <th scope='row' className='px-3 py-2 text-left font-normal'>
                <AppLink to={courseReport(r.id)}>{r.title}</AppLink>
                {r.tag && (
                  <span className='ml-2 whitespace-nowrap rounded-[6px] bg-fill-content-hover px-1.5 py-0.5 text-[11px] text-text-secondary'>
                    {r.tag}
                  </span>
                )}
              </th>
              {r.cells.map((n, i) => (
                <td key={i} className={cn('px-3 py-2 text-right tabular-nums', n === 0 && 'text-text-tertiary')}>
                  {n}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

/** Reports → Overview. `nav` is the Reports tab bar (passed in, so this file doesn't import the reports file). */
export function LearningReportsOverview({ workspaceId, nav }: { workspaceId: string; nav?: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const days = overviewDays(location.search);
  const loadOverview = useCallback(() => overviewApi.overview(workspaceId, days), [workspaceId, days]);
  const loadOverdue = useCallback(() => overviewApi.overdue(workspaceId), [workspaceId]);
  const ov = useLoad(loadOverview);
  const od = useLoad(loadOverdue);
  const o = ov.data;

  const pick = (d: OverviewDays) => {
    const q = new URLSearchParams(location.search);

    if (d === 7) q.delete('days');
    else q.set('days', String(d));
    const s = q.toString();

    navigate(`${location.pathname}${s ? `?${s}` : ''}`, { replace: true });
  };

  const empty = !!o && o.active === 0 && o.finished === 0 && o.attempts === 0 && o.certificates === 0;

  return (
    <div data-testid='carehub-learning-report-overview'>
      {nav && <div className='mb-5 flex flex-wrap items-center gap-2'>{nav}</div>}
      <div className='mb-4 flex flex-wrap items-center gap-x-3 gap-y-2'>
        <PeriodPicker days={days} onPick={pick} />
        {o && o.until_ms > o.since_ms && (
          <span className='text-xs text-text-tertiary' data-testid='carehub-learning-overview-range'>
            {dayLabel(o.since_ms, o.tz_minutes)} – {dayLabel(o.until_ms - DAY_MS, o.tz_minutes)}
          </span>
        )}
      </div>
      <div aria-busy={ov.stale || undefined} className={cn('transition-opacity', ov.stale && 'opacity-60')}>
        {!o && <div className='mb-4'>{ov.error ? <LoadError error={ov.error} onRetry={ov.reload} /> : <Loading />}</div>}
        <div className='mb-6 flex flex-wrap gap-3' data-testid='carehub-learning-overview-cards'>
          {o && <OverviewCards o={o} />}
          <OverdueCard data={od.data} error={od.error} onRetry={od.reload} />
        </div>
        {o && empty && (
          <div
            className='mb-6 rounded-[12px] border border-dashed border-border-primary px-4 py-6 text-center text-sm text-text-tertiary'
            data-testid='carehub-learning-overview-empty'
          >
            No learning activity in the last {o.days} days.
          </div>
        )}
        {o && !empty && (
          <>
            <ChSection title='Activity by day' hint='People who did any learning each day, and courses finished.'>
              <ActivityChart o={o} />
            </ChSection>
            {o.top_courses.length > 0 && (
              <ChSection title='Most active courses' hint={`By how many people worked on them in the last ${o.days} days.`}>
                <CourseList
                  head={['Course', 'Active learners', 'Finished']}
                  rows={o.top_courses.map((c) => ({
                    id: c.course_id,
                    title: c.title,
                    tag: c.status === 'draft' ? 'Draft' : c.status === 'archived' ? 'Archived' : undefined,
                    cells: [c.active, c.finished],
                  }))}
                  testId='carehub-learning-overview-top'
                />
              </ChSection>
            )}
          </>
        )}
      </div>
      {od.data && od.data.courses.length > 0 && (
        <ChSection title='Most overdue' hint='Courses with the most people past their due date right now.'>
          <CourseList
            head={['Course', 'Overdue']}
            rows={od.data.courses.map((c) => ({ id: c.course_id, title: c.title, cells: [c.overdue] }))}
            testId='carehub-learning-overview-overdue'
          />
        </ChSection>
      )}
    </div>
  );
}

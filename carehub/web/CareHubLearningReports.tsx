// CareHub Learning: course reports. Who has started, finished or not yet opened each course, who is overdue,
// where people stop, how the quiz questions (and the answers people pick) and knowledge checks are going, the
// same view per person and per group (Teams), with CSV export. Open to people with the "See course reports" or
// "Build courses" permission; only people who can build courses can reset someone's progress.
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { ReactNode } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { chCall, CH_API, formatWhen, UUID_RE } from './CareHubCore';
import { formatDuration, isTransientError, LEARNING_PATH, learningNotLive, lErrorText, num, plural, statusInfo, str } from './CareHubLearningApi';
import { learningTitle, usePageTitle } from './CareHubLearningA11y';
// CareHubLearningAssignApi also imports reportsApi from this file. That's fine: each side only uses the other
// inside functions, never while the files are first loaded.
import { assignCoursePath, certificatePath, groupPath, shortDate } from './CareHubLearningAssignApi';
import { Chip, ProgressBar, RichText } from './CareHubLearningBlocks';
import { LearningReportsOverview } from './CareHubLearningOverview';
import { SurveyResults } from './CareHubLearningQbank';
import { CareHubModal, ChCard, chInputClass, ChNote, ChSection } from './CareHubUi';

import type { LearnStatus } from './CareHubLearningApi';

export const REPORTS_PATH = `${LEARNING_PATH}/reports`;
export const PEOPLE_PATH = `${REPORTS_PATH}/people`;
export const TEAMS_PATH = `${REPORTS_PATH}/teams`;
/** The course list. The reports home (REPORTS_PATH) shows the Overview tab. */
export const COURSES_PATH = `${REPORTS_PATH}?tab=courses`;

const STUDIO_PATH = `${LEARNING_PATH}/studio`;
const coursePath = (id: string) => `${REPORTS_PATH}/course/${id}`;
const personPath = (uid: string) => `${PEOPLE_PATH}/${uid}`;

// ---------------------------------------------------------------------------
// Report data (parsed defensively: a surprise in the data must not break the page)
// ---------------------------------------------------------------------------

export type CourseState = 'draft' | 'published' | 'archived';

export interface ReportPerson {
  uid: string;
  name: string;
  email: string;
}

export interface CourseSummary {
  id: string;
  title: string;
  status: CourseState;
  version: number;
  members: number;
  started: number;
  in_progress: number;
  /** Completed or passed. */
  finished: number;
  passed: number;
  failed: number;
  not_started: number;
  avg_score: number | null;
  avg_time_ms: number;
  last_activity_ms: number | null;
}

export interface ReportProgress {
  status: LearnStatus;
  percent: number;
  score: number | null;
  attempts: number;
  time_ms: number;
  started_ms: number;
  last_ms: number;
  completed_ms: number | null;
  ack_ms: number | null;
  /** When their finish runs out (the course needs renewing); null = never. */
  expires_ms: number | null;
  expired: boolean;
}

export interface CourseReportRow extends ReportPerson, ReportProgress {
  awaiting_ack: boolean;
  version: number;
}

export interface QuestionStat {
  id: string;
  prompt: string;
  answered: number;
  correct_pct: number;
}

export interface CourseReport {
  course: { id: string; title: string; version: number; quiz: boolean; pass_mark: number };
  rows: CourseReportRow[];
  not_started: ReportPerson[];
  questions: QuestionStat[];
}

/**
 * One answer to a quiz question and how many attempts picked it. Matching questions have one row per pair
 * ("left → right"), counted when it was matched right; the newer kinds use buckets such as "Right order".
 */
export interface AnswerStat {
  id: string;
  text: string;
  correct: boolean;
  picked: number;
}

export interface QuestionInsight {
  id: string;
  prompt: string;
  kind: string;
  answered: number;
  correct_pct: number;
  answers: AnswerStat[];
}

export interface KnowledgeCheckStat {
  block_id: string;
  lesson_id: string;
  lesson_title: string;
  prompt: string;
  answered: number;
  correct_pct: number;
}

/** One lesson, in course order: who opened it, who finished it, and who is partway through the course on it now. */
export interface LessonStop {
  id: string;
  title: string;
  opened: number;
  done: number;
  stopped_here: number;
}

export interface DueInfo {
  uid: string;
  due_ms: number | null;
  required: boolean;
  overdue: boolean;
  assigned_ms: number;
}

export interface GroupStat {
  id: string;
  name: string;
  members: number;
  assigned: number;
  finished: number;
  in_progress: number;
  not_started: number;
  overdue: number;
}

export interface CertificateInfo {
  uid: string;
  code: string;
  issued_ms: number;
}

/** Extra detail for one course report. Older servers don't have it, and then the report simply leaves it out. */
export interface CourseInsights {
  assigned: number;
  overdue: number;
  due: DueInfo[];
  questions: QuestionInsight[];
  knowledge_checks: KnowledgeCheckStat[];
  lessons: LessonStop[];
  groups: GroupStat[];
  certificates: CertificateInfo[];
}

/** One course on the Teams tab. Counts are over the people it's assigned to. */
export interface TeamCourseStat {
  course_id: string;
  title: string;
  assigned: number;
  finished: number;
  in_progress: number;
  not_started: number;
  overdue: number;
}

/** The Teams tab: every group, and every published course that's assigned to someone. */
export interface TeamsReport {
  groups: GroupStat[];
  courses: TeamCourseStat[];
}

export interface PersonSummary extends ReportPerson {
  started: number;
  finished: number;
  in_progress: number;
  failed: number;
  avg_score: number | null;
  time_ms: number;
  last_ms: number | null;
}

export interface PersonCourseRow extends ReportProgress {
  course_id: string;
  title: string;
}

export interface PersonReport {
  person: ReportPerson;
  rows: PersonCourseRow[];
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function numOrNull(v: unknown) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Person ids are 64-bit numbers, so they travel as text. */
function uidOf(v: unknown) {
  if (typeof v === 'string') return /^\d{1,19}$/.test(v.trim()) ? v.trim() : '';
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? String(v) : '';
}

const LEARN_STATUSES: readonly string[] = ['in_progress', 'completed', 'passed', 'failed'];

function statusOf(v: unknown): LearnStatus {
  return typeof v === 'string' && LEARN_STATUSES.includes(v) ? (v as LearnStatus) : 'in_progress';
}

function courseStateOf(v: unknown): CourseState {
  return v === 'draft' || v === 'archived' ? v : 'published';
}

function personOf(v: unknown): ReportPerson {
  const o = obj(v);

  return { uid: uidOf(o.uid), name: str(o.name).trim(), email: str(o.email).trim() };
}

function progressOf(o: Record<string, unknown>): ReportProgress {
  return {
    status: statusOf(o.status),
    percent: Math.max(0, Math.min(100, Math.round(num(o.percent)))),
    score: numOrNull(o.score),
    attempts: Math.max(0, num(o.attempts)),
    time_ms: Math.max(0, num(o.time_ms)),
    started_ms: num(o.started_ms),
    last_ms: num(o.last_ms),
    completed_ms: numOrNull(o.completed_ms),
    ack_ms: numOrNull(o.ack_ms),
    expires_ms: numOrNull(o.expires_ms),
    expired: o.expired === true,
  };
}

function courseSummaryOf(v: unknown): CourseSummary {
  const o = obj(v);

  return {
    id: str(o.id),
    title: str(o.title).trim() || 'Untitled course',
    status: courseStateOf(o.status),
    version: num(o.version),
    members: num(o.members),
    started: num(o.started),
    in_progress: num(o.in_progress),
    finished: num(o.finished),
    passed: num(o.passed),
    failed: num(o.failed),
    not_started: num(o.not_started),
    avg_score: numOrNull(o.avg_score),
    avg_time_ms: Math.max(0, num(o.avg_time_ms)),
    last_activity_ms: numOrNull(o.last_activity_ms),
  };
}

function courseReportOf(v: unknown, id: string): CourseReport {
  const o = obj(v);
  const c = obj(o.course);

  return {
    course: {
      id: str(c.id, id),
      title: str(c.title).trim() || 'Untitled course',
      version: num(c.version),
      quiz: c.quiz === true,
      pass_mark: num(c.pass_mark),
    },
    rows: arr(o.rows)
      .map((r): CourseReportRow => {
        const x = obj(r);

        return { ...personOf(x), ...progressOf(x), awaiting_ack: x.awaiting_ack === true, version: num(x.version) };
      })
      .filter((r) => r.uid),
    not_started: arr(o.not_started)
      .map(personOf)
      .filter((p) => p.uid),
    questions: arr(o.questions).map((q, i) => {
      const x = obj(q);

      return {
        id: str(x.id) || `q${i}`,
        prompt: str(x.prompt),
        answered: Math.max(0, num(x.answered)),
        correct_pct: Math.max(0, Math.min(100, num(x.correct_pct))),
      };
    }),
  };
}

function personSummaryOf(v: unknown): PersonSummary {
  const o = obj(v);

  return {
    ...personOf(o),
    started: num(o.started),
    finished: num(o.finished),
    in_progress: num(o.in_progress),
    failed: num(o.failed),
    avg_score: numOrNull(o.avg_score),
    time_ms: Math.max(0, num(o.time_ms)),
    last_ms: numOrNull(o.last_ms),
  };
}

function personReportOf(v: unknown, uid: string): PersonReport {
  const o = obj(v);
  const person = personOf(o.person);

  return {
    person: { ...person, uid: person.uid || uid },
    rows: arr(o.rows)
      .map((r): PersonCourseRow => {
        const x = obj(r);

        return { ...progressOf(x), course_id: str(x.course_id), title: str(x.title).trim() || 'Untitled course' };
      })
      .filter((r) => r.course_id),
  };
}

/** The entries of a list that are objects; anything else is left out. */
function objects(v: unknown): unknown[] {
  return arr(v).filter((x) => Boolean(x) && typeof x === 'object' && !Array.isArray(x));
}

/** A count of people or attempts: a whole number, never below zero. */
function countOf(v: unknown) {
  return Math.max(0, Math.round(num(v)));
}

function percentOf(v: unknown) {
  return Math.max(0, Math.min(100, Math.round(num(v))));
}

function groupStatOf(v: unknown): GroupStat {
  const o = obj(v);

  return {
    id: str(o.id),
    name: str(o.name).trim() || 'Unnamed group',
    members: countOf(o.members),
    assigned: countOf(o.assigned),
    finished: countOf(o.finished),
    in_progress: countOf(o.in_progress),
    not_started: countOf(o.not_started),
    overdue: countOf(o.overdue),
  };
}

function insightsOf(v: unknown): CourseInsights {
  const o = obj(v);

  return {
    assigned: countOf(o.assigned),
    overdue: countOf(o.overdue),
    due: arr(o.due)
      .map((d): DueInfo => {
        const x = obj(d);

        return { uid: uidOf(x.uid), due_ms: numOrNull(x.due_ms), required: x.required === true, overdue: x.overdue === true, assigned_ms: num(x.assigned_ms) };
      })
      .filter((d) => d.uid),
    questions: objects(o.questions).map((q, i): QuestionInsight => {
      const x = obj(q);

      return {
        id: str(x.id) || `q${i}`,
        prompt: str(x.prompt),
        kind: str(x.kind),
        answered: countOf(x.answered),
        correct_pct: percentOf(x.correct_pct),
        answers: objects(x.answers).map((a, j): AnswerStat => {
          const y = obj(a);

          return { id: str(y.id) || `a${j}`, text: str(y.text), correct: y.correct === true, picked: countOf(y.picked) };
        }),
      };
    }),
    knowledge_checks: objects(o.knowledge_checks).map((k, i): KnowledgeCheckStat => {
      const x = obj(k);

      return {
        block_id: str(x.block_id) || `kc${i}`,
        lesson_id: str(x.lesson_id),
        lesson_title: str(x.lesson_title).trim(),
        prompt: str(x.prompt),
        answered: countOf(x.answered),
        correct_pct: percentOf(x.correct_pct),
      };
    }),
    lessons: objects(o.lessons).map((l, i): LessonStop => {
      const x = obj(l);

      return {
        id: str(x.id) || `l${i}`,
        title: str(x.title).trim(),
        opened: countOf(x.opened),
        done: countOf(x.done),
        stopped_here: countOf(x.stopped_here),
      };
    }),
    groups: arr(o.groups)
      .map(groupStatOf)
      .filter((g) => g.id),
    certificates: arr(o.certificates)
      .map((c): CertificateInfo => {
        const x = obj(c);

        return { uid: uidOf(x.uid), code: str(x.code).trim(), issued_ms: num(x.issued_ms) };
      })
      .filter((c) => c.uid && c.code),
  };
}

function teamsOf(v: unknown): TeamsReport {
  const o = obj(v);

  return {
    groups: arr(o.groups)
      .map(groupStatOf)
      .filter((g) => g.id),
    courses: arr(o.courses)
      .map((c): TeamCourseStat => {
        const x = obj(c);

        return {
          course_id: str(x.course_id),
          title: str(x.title).trim() || 'Untitled course',
          assigned: countOf(x.assigned),
          finished: countOf(x.finished),
          in_progress: countOf(x.in_progress),
          not_started: countOf(x.not_started),
          overdue: countOf(x.overdue),
        };
      })
      .filter((c) => c.course_id),
  };
}

const reportsBase = (ws: string) => `${CH_API}/${ws}/learning/reports`;
const enc = encodeURIComponent;

export const reportsApi = {
  courses: (ws: string) =>
    chCall<unknown>('get', `${reportsBase(ws)}/courses`).then((d) =>
      arr(obj(d).courses)
        .map(courseSummaryOf)
        .filter((c) => c.id)
    ),
  course: (ws: string, id: string) => chCall<unknown>('get', `${reportsBase(ws)}/courses/${enc(id)}`).then((d) => courseReportOf(d, id)),
  /** Answers per quiz question, knowledge checks, where people stop, due dates and groups (servers before Phase 2 answer 404). */
  insights: (ws: string, id: string) => chCall<unknown>('get', `${reportsBase(ws)}/courses/${enc(id)}/insights`).then(insightsOf),
  /** Groups and assigned courses for the Teams tab (also gives Reports → Courses its Assigned and Overdue columns). */
  teams: (ws: string) => chCall<unknown>('get', `${reportsBase(ws)}/teams`).then(teamsOf),
  people: (ws: string) =>
    chCall<unknown>('get', `${reportsBase(ws)}/people`).then((d) =>
      arr(obj(d).people)
        .map(personSummaryOf)
        .filter((p) => p.uid)
    ),
  person: (ws: string, uid: string) => chCall<unknown>('get', `${reportsBase(ws)}/people/${enc(uid)}`).then((d) => personReportOf(d, uid)),
  /** Clears someone's progress on a course so they start again (people who can build courses only). */
  reset: (ws: string, courseId: string, uid: string) => chCall<unknown>('post', `${reportsBase(ws)}/courses/${enc(courseId)}/reset`, { uid }),
};

// ---------------------------------------------------------------------------
// CSV export (opens cleanly in Excel, Numbers and Google Sheets)
// ---------------------------------------------------------------------------

export type CsvValue = string | number | null | undefined;

/**
 * One CSV cell. Text a spreadsheet would treat as a formula (starting with = + - @, a tab or a carriage
 * return) gets a leading apostrophe so it stays plain text.
 */
export function csvCell(v: CsvValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;

  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: CsvValue[][]) {
  return `${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function dayStamp(ms: number) {
  const d = new Date(ms);

  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Local date and time in a form spreadsheets read as a date. */
export function csvDate(ms: number | null | undefined) {
  if (!ms) return '';
  const d = new Date(ms);

  return `${dayStamp(ms)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Minutes, to one decimal place. */
export function csvMinutes(ms: number) {
  return Math.round(ms / 6000) / 10;
}

export function slug(text: string, fallback = 'report') {
  const s = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '');

  return s || fallback;
}

/** Saves a CSV file. The byte-order mark makes Excel read names with accents correctly. */
export function downloadCsv(name: string, header: string[], rows: CsvValue[][]) {
  const blob = new Blob(['\uFEFF', toCsv(header, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  a.href = url;
  a.download = `${name}-${dayStamp(Date.now())}.csv`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function nameOf(p: { name: string; email: string }) {
  return p.name || p.email || 'Unnamed member';
}

function pct(n: number, of: number) {
  return of > 0 ? Math.round((n / of) * 100) : 0;
}

function isDone(p: { status: LearnStatus }) {
  return p.status === 'completed' || p.status === 'passed';
}

function average(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function matches(p: { name: string; email: string }, query: string) {
  const q = query.trim().toLowerCase();

  return !q || `${p.name} ${p.email}`.toLowerCase().includes(q);
}

/** Course text without its formatting marks (**bold**, *italic*, [link](url)), for CSV files. */
function plainText(text: string) {
  return text
    .replace(/\*\*([^*\n]+?)\*\*/g, '$1')
    .replace(/\*([^*\n]+?)\*/g, '$1')
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1')
    .trim();
}

function statusLabel(p: { status: LearnStatus; awaiting_ack?: boolean } | null) {
  return statusInfo(p ? { status: p.status, awaiting_ack: Boolean(p.awaiting_ack) } : null).label;
}

/** Not started, in progress, almost done, didn't pass, finished. */
function statusRank(p: { status: LearnStatus; awaiting_ack?: boolean } | null) {
  if (!p) return 0;
  if (p.status === 'in_progress') return p.awaiting_ack ? 2 : 1;
  return p.status === 'failed' ? 3 : 4;
}

function shortDay(ms: number) {
  const d = new Date(ms);
  const today = new Date();

  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === new Date(Date.now() - 86400000).toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

function When({ ms, withTime }: { ms: number; withTime?: boolean }) {
  return (
    <span className='whitespace-nowrap' title={new Date(ms).toLocaleString()}>
      {withTime ? formatWhen(ms) : shortDay(ms)}
    </span>
  );
}

function Num({ n }: { n: number }) {
  return <span className={cn('tabular-nums', n === 0 && 'text-text-tertiary')}>{n}</span>;
}

/** Loads once per `load` (keep it stable with useCallback); `reload` keeps showing the old data until the new arrives. */
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
        setState((s) => ({ load, data: s.load === load ? s.data : null, error: e || new Error('Something went wrong. Please try again.') }));
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

  return { data: mine ? state.data : null, error: mine ? state.error : null, reload };
}

/** True while the element is narrower than `below` pixels. Pass the returned ref callback to the element. */
function useNarrow(below: number) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < below);

  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const check = () => setNarrow(el.clientWidth < below);
    const ro = new ResizeObserver(check);

    ro.observe(el);
    check();
    return () => ro.disconnect();
  }, [el, below]);

  return [setEl, narrow] as const;
}

// ---------------------------------------------------------------------------
// Table: sortable columns on wide screens, stacked cards on narrow ones
// ---------------------------------------------------------------------------

type SortKey = string | number | null;

export interface Col<T> {
  id: string;
  label: string;
  /** Return null for "nothing here": a dash in the table, left out of the card. */
  cell: (row: T) => ReactNode;
  /** Columns without a sort key can't be sorted. Empty values always go last. */
  sort?: (row: T) => SortKey;
  /** Right-aligned number column. */
  right?: boolean;
  /** Sort high-to-low (or newest first) on the first click. Number columns do this anyway. */
  desc?: boolean;
  /** Shown next to the title on cards, instead of in the details. */
  badge?: boolean;
  /** Left out of the narrow card view. */
  wideOnly?: boolean;
}

function compareKeys(a: SortKey, b: SortKey, desc: boolean) {
  const emptyA = a === null || a === '';
  const emptyB = b === null || b === '';

  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
  const c =
    typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });

  return desc ? -c : c;
}

function SortMark({ on, desc }: { on: boolean; desc: boolean }) {
  return (
    <svg
      aria-hidden='true'
      viewBox='0 0 10 10'
      width='10'
      height='10'
      className={cn('shrink-0', !on && 'opacity-0')}
      style={on && !desc ? { transform: 'rotate(180deg)' } : undefined}
    >
      <path d='M2 3.5 5 6.5 8 3.5' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' />
    </svg>
  );
}

function ReportTable<T>({
  rows,
  cols,
  rowKey,
  onOpen,
  actions,
  empty,
  testId,
  rowTestId = 'carehub-learning-report-row',
  initialSort,
}: {
  rows: T[];
  cols: Col<T>[];
  rowKey: (row: T) => string;
  onOpen?: (row: T) => void;
  actions?: (row: T) => ReactNode;
  empty: ReactNode;
  testId?: string;
  rowTestId?: string;
  /** Sorted by this column until someone picks another one. */
  initialSort?: { id: string; desc: boolean };
}) {
  const [measure, narrow] = useNarrow(620);
  const [sort, setSort] = useState<{ id: string; desc: boolean } | null>(initialSort ?? null);
  const sorted = useMemo(() => {
    const key = sort ? cols.find((c) => c.id === sort.id)?.sort : undefined;

    if (!sort || !key) return rows;
    return rows
      .map((row, i) => ({ row, i, k: key(row) }))
      .sort((a, b) => compareKeys(a.k, b.k, sort.desc) || a.i - b.i)
      .map((x) => x.row);
  }, [rows, cols, sort]);
  const sortable = cols.filter((c) => c.sort && (!narrow || !c.wideOnly));
  const firstDesc = (c: Col<T>) => Boolean(c.desc || c.right);
  const toggle = (c: Col<T>) => setSort((s) => (s && s.id === c.id ? { id: c.id, desc: !s.desc } : { id: c.id, desc: firstDesc(c) }));
  // Clicking anywhere on a row opens it, unless the click was the end of selecting text to copy.
  const openRow = (row: T) => {
    if (onOpen && !window.getSelection()?.toString()) onOpen(row);
  };
  const [titleCol, ...restCols] = cols;
  const dash = <span className='text-text-tertiary'>—</span>;

  let body: ReactNode;

  if (!rows.length) {
    body = <EmptyBox>{empty}</EmptyBox>;
  } else if (narrow) {
    const badges = restCols.filter((c) => c.badge);
    const details = restCols.filter((c) => !c.badge && !c.wideOnly);

    body = (
      <>
        {sortable.length > 0 && (
          <div className='mb-2 flex items-center justify-end gap-1.5 text-xs text-text-secondary'>
            <label className='flex items-center gap-1.5'>
              Sort by
              <select
                className={cn(chInputClass, 'py-1 text-xs')}
                value={sort?.id || ''}
                onChange={(e) => {
                  const c = cols.find((x) => x.id === e.target.value);

                  setSort(c ? { id: c.id, desc: firstDesc(c) } : null);
                }}
              >
                <option value=''>Default</option>
                {sortable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            {sort && (
              <button
                type='button'
                title='Reverse the order'
                aria-label='Reverse the order'
                className='flex h-7 w-7 items-center justify-center rounded-[6px] border border-border-primary hover:bg-fill-content-hover'
                onClick={() => setSort((s) => (s ? { id: s.id, desc: !s.desc } : s))}
              >
                <SortMark on desc={sort.desc} />
              </button>
            )}
          </div>
        )}
        <ul className='m-0 flex list-none flex-col gap-2 p-0'>
          {sorted.map((row) => {
            const title = titleCol.cell(row);
            const shown = details.map((c) => ({ c, v: c.cell(row) })).filter((x) => x.v !== null && x.v !== undefined && x.v !== false);
            const extra = actions?.(row);

            return (
              <li key={rowKey(row)} className='rounded-[12px] border border-border-primary p-3' data-testid={rowTestId}>
                <div className='flex items-start gap-2'>
                  <div className='min-w-0 flex-1'>
                    {onOpen ? (
                      <button type='button' className='w-full text-left' onClick={() => onOpen(row)}>
                        {title}
                      </button>
                    ) : (
                      title
                    )}
                  </div>
                  {badges.map((c) => (
                    <div key={c.id} className='shrink-0'>
                      {c.cell(row)}
                    </div>
                  ))}
                </div>
                {shown.length > 0 && (
                  <dl className='m-0 mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs'>
                    {shown.map(({ c, v }) => (
                      <div key={c.id} className='min-w-0'>
                        <dt className='text-text-tertiary'>{c.label}</dt>
                        <dd className='m-0 mt-0.5 min-w-0 break-words text-text-primary'>{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {extra ? <div className='mt-2 flex flex-wrap justify-end gap-1.5'>{extra}</div> : null}
              </li>
            );
          })}
        </ul>
      </>
    );
  } else {
    body = (
      <div className='overflow-x-auto rounded-[12px] border border-border-primary'>
        <table className='w-full border-collapse text-sm'>
          <thead>
            <tr className='text-left text-xs text-text-tertiary'>
              {cols.map((c) => {
                const on = sort?.id === c.id;

                return (
                  <th
                    key={c.id}
                    scope='col'
                    aria-sort={c.sort ? (on && sort ? (sort.desc ? 'descending' : 'ascending') : 'none') : undefined}
                    className={cn('whitespace-nowrap px-3 py-2 font-normal', c.right && 'text-right')}
                  >
                    {c.sort ? (
                      <button
                        type='button'
                        onClick={() => toggle(c)}
                        className={cn('inline-flex items-center gap-1 hover:text-text-primary', on && 'font-medium text-text-primary')}
                      >
                        {c.label}
                        <SortMark on={on} desc={Boolean(sort?.desc)} />
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                );
              })}
              {actions && (
                <th scope='col' className='px-3 py-2'>
                  <span className='sr-only'>Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={rowKey(row)}
                className={cn('border-t border-border-primary', onOpen && 'cursor-pointer hover:bg-fill-content-hover')}
                onClick={onOpen ? () => openRow(row) : undefined}
                data-testid={rowTestId}
              >
                {cols.map((c, i) => {
                  const v = c.cell(row);
                  const content = v === null || v === undefined || v === false ? dash : v;

                  return (
                    <td
                      key={c.id}
                      className={cn('px-3 py-2 align-middle', c.right && 'whitespace-nowrap text-right tabular-nums', i === 0 && 'min-w-[190px]')}
                    >
                      {i === 0 && onOpen ? (
                        <button
                          type='button'
                          className='max-w-full text-left hover:underline'
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpen(row);
                          }}
                        >
                          {content}
                        </button>
                      ) : (
                        content
                      )}
                    </td>
                  );
                })}
                {actions && (
                  <td className='whitespace-nowrap px-3 py-1.5 text-right' onClick={(e) => e.stopPropagation()}>
                    {actions(row)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div ref={measure} data-testid={testId}>
      {body}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared pieces
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

/** Shown above data that is still on screen when refreshing it failed. */
function RefreshError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className='mb-4 flex flex-wrap items-center gap-2'>
      <ChNote tone='error'>Couldn’t refresh this report: {lErrorText(error)}</ChNote>
      <Button type='button' size='sm' variant='outline' onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function EmptyBox({ children }: { children: ReactNode }) {
  return <div className='rounded-[12px] border border-dashed border-border-primary px-4 py-6 text-center text-sm text-text-tertiary'>{children}</div>;
}

function DownloadIcon() {
  return (
    <svg aria-hidden='true' viewBox='0 0 16 16' width='14' height='14' className='shrink-0'>
      <path
        d='M8 2.5v7m0 0L5 6.5m3 3 3-3M3 11.5v1a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1'
        fill='none'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  );
}

function CsvButton({
  onClick,
  title = 'Everything in this report, whatever is filtered, as a file for Excel or Google Sheets',
  ariaLabel,
  testId = 'carehub-learning-csv',
}: {
  onClick: () => void;
  title?: string;
  ariaLabel?: string;
  testId?: string;
}) {
  return (
    <Button
      type='button'
      size='sm'
      variant='outline'
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      data-testid={testId}
    >
      <span className='inline-flex items-center gap-1.5'>
        <DownloadIcon />
        Download CSV
      </span>
    </Button>
  );
}

function BackLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type='button'
      onClick={onClick}
      className='rounded-[8px] px-1.5 py-1 text-sm text-text-secondary hover:bg-fill-content-hover hover:text-text-primary'
      data-testid='carehub-learning-report-back'
    >
      ← {label}
    </button>
  );
}

function ReportsNav({ active }: { active: 'overview' | 'courses' | 'people' | 'teams' }) {
  const navigate = useNavigate();
  const items = [
    { id: 'overview' as const, label: 'Overview', to: REPORTS_PATH },
    { id: 'courses' as const, label: 'Courses', to: COURSES_PATH },
    { id: 'people' as const, label: 'People', to: PEOPLE_PATH },
    { id: 'teams' as const, label: 'Teams', to: TEAMS_PATH },
  ];

  return (
    <nav aria-label='Reports' className='inline-flex rounded-[10px] border border-border-primary p-0.5'>
      {items.map((t) => (
        <button
          key={t.id}
          type='button'
          aria-current={active === t.id ? 'page' : undefined}
          onClick={() => navigate(t.to)}
          className={cn(
            'rounded-[8px] px-3 py-1 text-sm',
            active === t.id ? 'bg-fill-content-hover font-medium text-text-primary' : 'text-text-secondary hover:text-text-primary'
          )}
          data-testid={`carehub-learning-reports-${t.id}`}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}

function FilterChips<K extends string>({
  value,
  options,
  onChange,
}: {
  value: K;
  options: { id: K; label: string; count: number }[];
  onChange: (id: K) => void;
}) {
  return (
    <div className='flex flex-wrap gap-1.5' role='group' aria-label='Show'>
      {options.map((o) => (
        <button
          key={o.id}
          type='button'
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'rounded-full border px-2.5 py-1 text-xs',
            value === o.id
              ? 'border-border-theme-thick font-medium text-text-primary'
              : 'border-border-primary text-text-secondary hover:bg-fill-content-hover'
          )}
          data-testid={`carehub-learning-filter-${o.id}`}
        >
          {o.label} <span className='tabular-nums text-text-tertiary'>{o.count}</span>
        </button>
      ))}
    </div>
  );
}

function SearchBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <input
      type='search'
      value={value}
      placeholder={label}
      aria-label={label}
      className={cn(chInputClass, 'w-full sm:w-[240px]')}
      onChange={(e) => onChange(e.target.value)}
      data-testid='carehub-learning-report-search'
    />
  );
}

function Toolbar({ children }: { children: ReactNode }) {
  return <div className='mb-3 flex flex-wrap items-center gap-2'>{children}</div>;
}

function Cards({ children }: { children: ReactNode }) {
  return <div className='mb-6 flex flex-wrap gap-3'>{children}</div>;
}

function PersonCell({ p }: { p: ReportPerson }) {
  const name = nameOf(p);

  return (
    <span className='block min-w-0'>
      <span className='block break-words font-medium text-text-primary'>{name}</span>
      {p.email && p.email !== name && <span className='block break-all text-xs text-text-tertiary'>{p.email}</span>}
    </span>
  );
}

function StatusCell({
  p,
  latest,
}: {
  p: { status: LearnStatus; awaiting_ack?: boolean; version?: number; expires_ms?: number | null; expired?: boolean } | null;
  latest?: number;
}) {
  const info = statusInfo(p ? { status: p.status, awaiting_ack: Boolean(p.awaiting_ack) } : null);
  const older = p && latest && p.version && p.version < latest ? p.version : 0;

  return (
    <span className='inline-flex flex-wrap items-center gap-1'>
      <Chip tone={info.tone}>{info.label}</Chip>
      {p?.expired && (
        <>
          <Chip tone='amber' title={p.expires_ms ? `Expired on ${shortDate(p.expires_ms)}` : undefined}>
            Expired
          </Chip>
          {p.expires_ms ? <span className='sr-only'>{` on ${shortDate(p.expires_ms)}`}</span> : null}
        </>
      )}
      {older > 0 && (
        <>
          <span className='text-[11px] text-text-tertiary' title={`Taking version ${older}. The latest is version ${latest}.`} aria-hidden='true'>
            v{older}
          </span>
          <span className='sr-only'>{`Taking version ${older}. The latest is version ${latest}.`}</span>
        </>
      )}
    </span>
  );
}

function PercentCell({ percent, label }: { percent: number; label: string }) {
  return (
    <span className='flex items-center gap-2'>
      <ProgressBar percent={percent} className='w-16 shrink-0' label={label} />
      <span className='text-xs tabular-nums text-text-secondary'>{percent}%</span>
    </span>
  );
}

/** An on/off filter that sits next to the filter chips. */
function ToggleChip({ on, onClick, testId, children }: { on: boolean; onClick: () => void; testId: string; children: ReactNode }) {
  return (
    <button
      type='button'
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-1 text-xs',
        on ? 'border-border-theme-thick font-medium text-text-primary' : 'border-border-primary text-text-secondary hover:bg-fill-content-hover'
      )}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

/** A count of overdue people (or courses): red when there are any. */
function OverdueNum({ n }: { n: number }) {
  return n > 0 ? <Chip tone='red'>{n}</Chip> : <Num n={0} />;
}

/** Opens someone's certificate. Stops the click from also opening the row it sits in. */
function CertificateChip({ code, who, onOpen }: { code: string; who: string; onOpen: (code: string) => void }) {
  return (
    <button
      type='button'
      className='chl-chip chl-green hover:underline'
      onClick={(e) => {
        e.stopPropagation();
        onOpen(code);
      }}
      title={`Certificate ${code}`}
      aria-label={`Open ${who}’s certificate`}
      data-testid='carehub-learning-report-certificate'
    >
      Certificate
    </button>
  );
}

// ---------------------------------------------------------------------------
// All courses
// ---------------------------------------------------------------------------

/**
 * A course's Assigned and Overdue numbers from the Teams report. That report only lists published courses that are
 * assigned to someone, so any other published course has no one assigned. Archived courses aren't counted (null).
 */
function assignedFor(c: CourseSummary, by: Map<string, TeamCourseStat>): { assigned: number; overdue: number } | null {
  return by.get(c.id) ?? (c.status === 'published' ? { assigned: 0, overdue: 0 } : null);
}

/** The reports home: the Overview tab, or the course list with `?tab=courses`. */
export function LearningReportsCourses({ workspaceId, canBuild }: { workspaceId: string; canBuild: boolean }) {
  const { search } = useLocation();
  const courses = new URLSearchParams(search).get('tab') === 'courses';

  usePageTitle(learningTitle(courses ? 'Courses' : '', 'Reports'));
  if (courses) {
    return <ReportsCourseList workspaceId={workspaceId} canBuild={canBuild} />;
  }
  return <LearningReportsOverview workspaceId={workspaceId} nav={<ReportsNav active='overview' />} />;
}

function ReportsCourseList({ workspaceId, canBuild }: { workspaceId: string; canBuild: boolean }) {
  const navigate = useNavigate();
  const load = useCallback(() => reportsApi.courses(workspaceId), [workspaceId]);
  const { data, error, reload } = useLoad(load);
  // Assigned and Overdue come from the Teams report, loaded on its own: if it isn't there (or fails), those
  // columns are simply left out.
  const loadTeams = useCallback(() => reportsApi.teams(workspaceId).catch((): TeamsReport | null => null), [workspaceId]);
  const { data: teams } = useLoad(loadTeams);
  const assignedBy = useMemo(() => (teams ? new Map(teams.courses.map((c) => [c.course_id, c])) : null), [teams]);
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();

    return (data || []).filter((c) => !q || c.title.toLowerCase().includes(q));
  }, [data, query]);
  const teamCols = useMemo<Col<CourseSummary>[]>(
    () =>
      assignedBy
        ? [
            {
              id: 'assigned',
              label: 'Assigned',
              right: true,
              sort: (c) => assignedFor(c, assignedBy)?.assigned ?? null,
              cell: (c) => {
                const t = assignedFor(c, assignedBy);

                return t ? <Num n={t.assigned} /> : null;
              },
            },
            {
              id: 'overdue',
              label: 'Overdue',
              right: true,
              sort: (c) => assignedFor(c, assignedBy)?.overdue ?? null,
              cell: (c) => {
                const t = assignedFor(c, assignedBy);

                return t ? <OverdueNum n={t.overdue} /> : null;
              },
            },
          ]
        : [],
    [assignedBy]
  );
  const cols = useMemo<Col<CourseSummary>[]>(
    () => [
      {
        id: 'course',
        label: 'Course',
        sort: (c) => c.title.toLowerCase(),
        cell: (c) => (
          <span className='block min-w-0'>
            <span className='flex min-w-0 flex-wrap items-center gap-1.5'>
              <span className='break-words font-medium text-text-primary'>{c.title}</span>
              {c.status === 'archived' && <Chip tone='amber'>Archived</Chip>}
            </span>
            <span className='block text-xs text-text-tertiary'>{c.version > 0 ? `Version ${c.version}` : 'Not published'}</span>
          </span>
        ),
      },
      {
        id: 'completion',
        label: 'Completion',
        desc: true,
        sort: (c) => pct(c.finished, c.members),
        cell: (c) => <PercentCell percent={pct(c.finished, c.members)} label={`${c.title}: share of members who finished`} />,
      },
      ...teamCols,
      { id: 'started', label: 'Started', right: true, sort: (c) => c.started, cell: (c) => <Num n={c.started} /> },
      { id: 'in_progress', label: 'In progress', right: true, wideOnly: true, sort: (c) => c.in_progress, cell: (c) => <Num n={c.in_progress} /> },
      { id: 'finished', label: 'Finished', right: true, sort: (c) => c.finished, cell: (c) => <Num n={c.finished} /> },
      { id: 'failed', label: 'Didn’t pass', right: true, sort: (c) => c.failed, cell: (c) => <Num n={c.failed} /> },
      { id: 'not_started', label: 'Not started', right: true, sort: (c) => c.not_started, cell: (c) => <Num n={c.not_started} /> },
      {
        id: 'score',
        label: 'Avg. score',
        right: true,
        sort: (c) => c.avg_score,
        cell: (c) => (c.avg_score === null ? null : `${c.avg_score}%`),
      },
      {
        id: 'time',
        label: 'Avg. time',
        right: true,
        sort: (c) => (c.started ? c.avg_time_ms : null),
        cell: (c) => (c.started ? formatDuration(c.avg_time_ms) : null),
      },
      {
        id: 'last',
        label: 'Last activity',
        desc: true,
        sort: (c) => c.last_activity_ms,
        cell: (c) => (c.last_activity_ms ? <When ms={c.last_activity_ms} withTime /> : null),
      },
    ],
    [teamCols]
  );

  const csv = () => {
    if (!data) return;
    downloadCsv(
      'course-reports',
      [
        'Course',
        'Status',
        'Version',
        'Members',
        'Started',
        'In progress',
        'Finished',
        'Passed',
        'Didn’t pass',
        'Not started',
        'Completion (% of members)',
        'Avg. score (%)',
        'Avg. time (minutes)',
        'Last activity',
        ...(assignedBy ? ['Assigned', 'Overdue'] : []),
      ],
      data.map((c) => [
        c.title,
        c.status === 'archived' ? 'Archived' : c.status === 'draft' ? 'Draft' : 'Published',
        c.version,
        c.members,
        c.started,
        c.in_progress,
        c.finished,
        c.passed,
        c.failed,
        c.not_started,
        pct(c.finished, c.members),
        c.avg_score,
        c.started ? csvMinutes(c.avg_time_ms) : null,
        csvDate(c.last_activity_ms),
        ...(assignedBy ? [assignedFor(c, assignedBy)?.assigned ?? null, assignedFor(c, assignedBy)?.overdue ?? null] : []),
      ])
    );
  };

  let body: ReactNode;

  if (!data) {
    body = error ? <LoadError error={error} onRetry={reload} /> : <Loading />;
  } else if (!data.length) {
    body = (
      <div className='rounded-[16px] border border-dashed border-border-primary px-5 py-10 text-center'>
        <div className='text-4xl' aria-hidden='true'>
          📊
        </div>
        <div className='mt-3 text-lg font-semibold'>No reports yet</div>
        <p className='mx-auto mt-1 max-w-[440px] text-sm text-text-secondary'>
          {canBuild
            ? 'A course shows up here once it’s published. Publish one in Studio to see who has started and finished it.'
            : 'A course shows up here once someone publishes it.'}
        </p>
        {canBuild && (
          <div className='mt-4'>
            <Button type='button' onClick={() => navigate(STUDIO_PATH)}>
              Go to Studio
            </Button>
          </div>
        )}
      </div>
    );
  } else {
    const archived = data.filter((c) => c.status === 'archived').length;
    const failed = data.reduce((n, c) => n + c.failed, 0);

    body = (
      <>
        {error ? <RefreshError error={error} onRetry={reload} /> : null}
        <Cards>
          <ChCard label='Courses' value={data.length} hint={archived ? `${archived} archived` : 'Published at least once'} />
          <ChCard label='Members' value={data[0].members} hint='Not counting guests' />
          <ChCard label='In progress' value={data.reduce((n, c) => n + c.in_progress, 0)} hint='Across all courses' />
          <ChCard label='Finished' value={data.reduce((n, c) => n + c.finished, 0)} hint='Across all courses' />
          {failed > 0 && <ChCard label='Didn’t pass' value={failed} hint='Used every quiz attempt' />}
        </Cards>
        <ChSection title='Courses' hint='Open a course to see each person, who hasn’t started, and how the quiz questions went.'>
          <Toolbar>
            <div className='flex-1' />
            <SearchBox value={query} onChange={setQuery} label='Search courses' />
          </Toolbar>
          <ReportTable
            rows={visible}
            cols={cols}
            rowKey={(c) => c.id}
            onOpen={(c) => navigate(coursePath(c.id))}
            empty={`No courses match “${query.trim()}”.`}
            testId='carehub-learning-report-table'
          />
        </ChSection>
      </>
    );
  }

  return (
    <div data-testid='carehub-learning-report-courses'>
      <div className='mb-5 flex flex-wrap items-center gap-2'>
        <ReportsNav active='courses' />
        <div className='flex-1' />
        {data && data.length > 0 && <CsvButton onClick={csv} />}
      </div>
      {body}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One course
// ---------------------------------------------------------------------------

type CourseFilter = 'all' | 'in_progress' | 'finished' | 'failed' | 'not_started';

interface CourseRow {
  person: ReportPerson;
  /** Null when they haven't opened the course. */
  e: CourseReportRow | null;
  /** When the course is assigned to them: their due date and whether they're overdue. */
  due: DueInfo | null;
  /** Their latest certificate for this course, if they have one. */
  cert: CertificateInfo | null;
}

function inCourseFilter(r: CourseRow, f: CourseFilter) {
  if (f === 'all') return true;
  if (f === 'not_started') return !r.e;
  if (!r.e) return false;
  if (f === 'finished') return isDone(r.e);
  return r.e.status === f;
}

const COURSE_EMPTY: Record<CourseFilter, string> = {
  all: 'No one is in this workspace yet.',
  in_progress: 'No one is partway through right now.',
  finished: 'No one has finished yet.',
  failed: 'No one has used up their quiz attempts without passing.',
  not_started: 'Everyone has opened this course.',
};

function courseCols(quiz: boolean, latest: number, showDue: boolean, openCert: (code: string) => void): Col<CourseRow>[] {
  const quizCols: Col<CourseRow>[] = quiz
    ? [
        {
          id: 'score',
          label: 'Score',
          right: true,
          sort: (r) => r.e?.score ?? null,
          cell: (r) => (r.e && r.e.score !== null ? `${r.e.score}%` : null),
        },
        { id: 'attempts', label: 'Attempts', right: true, sort: (r) => r.e?.attempts ?? null, cell: (r) => (r.e ? <Num n={r.e.attempts} /> : null) },
      ]
    : [];
  const dueCols: Col<CourseRow>[] = showDue
    ? [
        {
          id: 'due',
          label: 'Due',
          sort: (r) => r.due?.due_ms ?? null,
          cell: (r) =>
            r.due && (r.due.due_ms !== null || r.due.overdue) ? (
              <span className='inline-flex flex-wrap items-center gap-1'>
                {r.due.due_ms !== null && <span className='whitespace-nowrap'>{shortDate(r.due.due_ms)}</span>}
                {r.due.overdue && <Chip tone='red'>Overdue</Chip>}
              </span>
            ) : null,
        },
      ]
    : [];

  return [
    { id: 'person', label: 'Person', sort: (r) => nameOf(r.person).toLowerCase(), cell: (r) => <PersonCell p={r.person} /> },
    {
      id: 'status',
      label: 'Status',
      badge: true,
      sort: (r) => statusRank(r.e),
      cell: (r) =>
        r.cert ? (
          <span className='inline-flex flex-wrap items-center gap-1'>
            <StatusCell p={r.e} latest={latest} />
            <CertificateChip code={r.cert.code} who={nameOf(r.person)} onOpen={openCert} />
          </span>
        ) : (
          <StatusCell p={r.e} latest={latest} />
        ),
    },
    ...dueCols,
    {
      id: 'progress',
      label: 'Progress',
      desc: true,
      sort: (r) => r.e?.percent ?? null,
      cell: (r) => (r.e ? <PercentCell percent={r.e.percent} label={`${nameOf(r.person)}: progress`} /> : null),
    },
    ...quizCols,
    { id: 'time', label: 'Time', right: true, sort: (r) => r.e?.time_ms ?? null, cell: (r) => (r.e ? formatDuration(r.e.time_ms) : null) },
    {
      id: 'started',
      label: 'Started',
      desc: true,
      sort: (r) => r.e?.started_ms || null,
      cell: (r) => (r.e?.started_ms ? <When ms={r.e.started_ms} /> : null),
    },
    {
      id: 'last',
      label: 'Last activity',
      desc: true,
      sort: (r) => r.e?.last_ms || null,
      cell: (r) => (r.e?.last_ms ? <When ms={r.e.last_ms} withTime /> : null),
    },
    {
      id: 'finished',
      label: 'Finished',
      desc: true,
      sort: (r) => r.e?.completed_ms ?? null,
      cell: (r) => (r.e?.completed_ms ? <When ms={r.e.completed_ms} /> : null),
    },
  ];
}

export function LearningReportCourse({ workspaceId, canBuild }: { workspaceId: string; canBuild: boolean }) {
  const { courseId = '' } = useParams();

  if (!UUID_RE.test(courseId)) return <Navigate to={COURSES_PATH} replace />;
  return <CourseReportView key={courseId} workspaceId={workspaceId} courseId={courseId} canBuild={canBuild} />;
}

function CourseReportView({ workspaceId, courseId, canBuild }: { workspaceId: string; courseId: string; canBuild: boolean }) {
  const navigate = useNavigate();
  const load = useCallback(() => reportsApi.course(workspaceId, courseId), [workspaceId, courseId]);
  const { data, error, reload } = useLoad(load);
  // Extra detail from newer servers. Loaded on its own so it never holds up or breaks the report above:
  // if it isn't there (or fails), those parts are simply left out.
  const loadInsights = useCallback(() => reportsApi.insights(workspaceId, courseId).catch((): CourseInsights | null => null), [workspaceId, courseId]);
  const { data: insights, reload: reloadInsights } = useLoad(loadInsights);
  const [filter, setFilter] = useState<CourseFilter>('all');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [resetting, setResetting] = useState<CourseReportRow | null>(null);
  const [notice, setNotice] = useState('');

  const people = useMemo<CourseRow[]>(() => {
    if (!data) return [];
    const due = new Map((insights?.due || []).map((d) => [d.uid, d]));
    const certs = new Map<string, CertificateInfo>();

    for (const c of insights?.certificates || []) {
      const had = certs.get(c.uid);

      if (!had || c.issued_ms > had.issued_ms) certs.set(c.uid, c);
    }

    const row = (person: ReportPerson, e: CourseReportRow | null): CourseRow => ({
      person,
      e,
      due: due.get(person.uid) || null,
      cert: certs.get(person.uid) || null,
    });

    return [...data.rows.map((e) => row(e, e)), ...data.not_started.map((p) => row(p, null))];
  }, [data, insights]);
  const overdueCount = people.filter((r) => r.due?.overdue).length;
  // The "Overdue only" toggle hides when no one is overdue, so it stops filtering then too.
  const onlyOverdue = overdueOnly && overdueCount > 0;
  const shown = useMemo(
    () => people.filter((r) => inCourseFilter(r, filter) && (!onlyOverdue || Boolean(r.due?.overdue)) && matches(r.person, query)),
    [people, filter, onlyOverdue, query]
  );
  const quiz = Boolean(data?.course.quiz);
  const latest = data?.course.version || 0;
  const showDue = Boolean(insights && insights.due.some((d) => d.due_ms !== null || d.overdue));
  const cols = useMemo(() => courseCols(quiz, latest, showDue, (code) => navigate(certificatePath(code))), [quiz, latest, showDue, navigate]);

  usePageTitle(learningTitle(data?.course.title || '', 'Reports'));
  const back = <BackLink label='All courses' onClick={() => navigate(COURSES_PATH)} />;

  if (!data) {
    return (
      <div data-testid='carehub-learning-report-course'>
        <div className='mb-4'>{back}</div>
        {error ? <LoadError error={error} onRetry={reload} /> : <Loading />}
      </div>
    );
  }

  const { course, rows, not_started: notStarted, questions } = data;
  const members = rows.length + notStarted.length;
  const finished = rows.filter(isDone).length;
  const inProgress = rows.filter((r) => r.status === 'in_progress').length;
  const almost = rows.filter((r) => r.status === 'in_progress' && r.awaiting_ack).length;
  const failed = rows.filter((r) => r.status === 'failed').length;
  const avgScore = average(rows.flatMap((r) => (r.score === null ? [] : [r.score])));
  const avgTime = average(rows.map((r) => r.time_ms));
  const count = (f: CourseFilter) => people.filter((r) => inCourseFilter(r, f)).length;
  const filters: { id: CourseFilter; label: string; count: number }[] = [
    { id: 'all', label: 'Everyone', count: members },
    { id: 'in_progress', label: 'In progress', count: inProgress },
    { id: 'finished', label: 'Finished', count: finished },
    ...(quiz || failed ? [{ id: 'failed' as const, label: 'Didn’t pass', count: failed }] : []),
    { id: 'not_started', label: 'Not started', count: count('not_started') },
  ];

  const csv = () => {
    const header = [
      'Name',
      'Email',
      'Status',
      'Progress (%)',
      ...(quiz ? ['Score (%)', 'Quiz attempts'] : []),
      'Time (minutes)',
      'Started',
      'Last activity',
      'Finished',
      'Acknowledged',
      'Version',
    ];
    const lines = people.map(({ person, e }): CsvValue[] =>
      e
        ? [
            person.name,
            person.email,
            statusLabel(e),
            e.percent,
            ...(quiz ? [e.score, e.attempts] : []),
            csvMinutes(e.time_ms),
            csvDate(e.started_ms),
            csvDate(e.last_ms),
            csvDate(e.completed_ms),
            csvDate(e.ack_ms),
            e.version || null,
          ]
        : [person.name, person.email, 'Not started', ...header.slice(3).map(() => null)]
    );
    // Newer servers also say when it's due for each person it's assigned to, and who has a certificate.
    const assignment = ({ due, cert }: CourseRow): CsvValue[] =>
      insights ? [due && due.due_ms !== null ? dayStamp(due.due_ms) : null, due ? (due.overdue ? 'Yes' : 'No') : null, cert ? cert.code : null] : [];

    downloadCsv(
      `course-report-${slug(course.title, 'course')}`,
      [...header, ...(insights ? ['Due', 'Overdue', 'Certificate'] : [])],
      lines.map((line, i) => [...line, ...assignment(people[i])])
    );
  };

  return (
    <div data-testid='carehub-learning-report-course'>
      <div className='mb-4'>
        {back}
        <div className='mt-2 flex flex-wrap items-start gap-3'>
          <div className='min-w-[min(100%,240px)] flex-1'>
            <h2 className='m-0 break-words text-xl font-semibold'>{course.title}</h2>
            <div className='mt-1.5 flex flex-wrap items-center gap-1.5'>
              {course.version > 0 ? <Chip>{`Version ${course.version}`}</Chip> : <Chip tone='amber'>Not published</Chip>}
              {quiz && <Chip tone='purple'>{`Quiz · pass mark ${course.pass_mark}%`}</Chip>}
            </div>
            {insights && insights.assigned > 0 && (
              <div className='mt-1.5 flex flex-wrap items-center gap-1.5 text-sm text-text-secondary' data-testid='carehub-learning-report-assigned'>
                <span>{`${insights.assigned} assigned`}</span>
                <span aria-hidden='true'>·</span>
                {insights.overdue > 0 ? <Chip tone='red'>{`${insights.overdue} overdue`}</Chip> : <span>none overdue</span>}
              </div>
            )}
          </div>
          <div className='flex flex-wrap gap-1.5'>
            {insights && (
              <Button
                type='button'
                size='sm'
                variant='ghost'
                onClick={() => navigate(assignCoursePath(course.id))}
                data-testid='carehub-learning-see-assignments'
              >
                See assignments
              </Button>
            )}
            {canBuild && (
              <Button type='button' size='sm' variant='ghost' onClick={() => navigate(`${STUDIO_PATH}/${course.id}`)}>
                Edit in Studio
              </Button>
            )}
            <CsvButton onClick={csv} />
          </div>
        </div>
      </div>

      {error ? <RefreshError error={error} onRetry={reload} /> : null}
      {notice && (
        <div className='mb-4' role='status'>
          <ChNote tone='ok'>{notice}</ChNote>
        </div>
      )}

      <Cards>
        <ChCard label='Members' value={members} hint='Not counting guests' />
        <ChCard label='Started' value={rows.length} hint={`${pct(rows.length, members)}% of members`} />
        <ChCard label='Finished' value={finished} hint={`${pct(finished, members)}% of members`} />
        <ChCard label='In progress' value={inProgress} hint={almost ? `${almost} almost done` : undefined} />
        {(quiz || failed > 0) && <ChCard label='Didn’t pass' value={failed} hint='Used every quiz attempt' />}
        {quiz && <ChCard label='Avg. score' value={avgScore === null ? '—' : `${Math.round(avgScore)}%`} hint={`Pass mark ${course.pass_mark}%`} />}
        <ChCard label='Avg. time' value={avgTime === null ? '—' : formatDuration(avgTime)} hint='For people who started' />
      </Cards>

      <ChSection title='People' hint='Everyone in the workspace except guests.'>
        <Toolbar>
          <FilterChips value={filter} options={filters} onChange={setFilter} />
          {overdueCount > 0 && (
            <ToggleChip on={onlyOverdue} onClick={() => setOverdueOnly(!onlyOverdue)} testId='carehub-learning-overdue-only'>
              Overdue only <span className='tabular-nums text-text-tertiary'>{overdueCount}</span>
            </ToggleChip>
          )}
          <div className='flex-1' />
          <SearchBox value={query} onChange={setQuery} label='Search people' />
        </Toolbar>
        <ReportTable
          rows={shown}
          cols={cols}
          rowKey={(r) => r.person.uid}
          onOpen={(r) => navigate(personPath(r.person.uid))}
          actions={
            canBuild
              ? (r) =>
                  r.e ? (
                    <Button
                      type='button'
                      size='sm'
                      variant='ghost'
                      aria-label={`Reset ${nameOf(r.person)}’s progress`}
                      onClick={() => {
                        setNotice('');
                        setResetting(r.e);
                      }}
                      data-testid='carehub-learning-reset'
                    >
                      Reset
                    </Button>
                  ) : null
              : undefined
          }
          empty={query.trim() ? `No one matches “${query.trim()}”.` : onlyOverdue ? 'No one here is overdue.' : COURSE_EMPTY[filter]}
          testId='carehub-learning-report-table'
        />
      </ChSection>

      {insights && insights.groups.length > 0 && (
        <ChSection title='By group' hint='How the members of each group are doing with this course. Counts are for the members it’s assigned to.'>
          <GroupTable
            groups={insights.groups}
            barLabel={(g) => `${g.name}: share of members with this course who finished`}
            testId='carehub-learning-report-groups'
          />
        </ChSection>
      )}

      {insights && insights.lessons.length > 0 && <WherePeopleStop lessons={insights.lessons} courseTitle={course.title} />}

      {quiz && <QuestionStats questions={questions} version={course.version} details={insights ? insights.questions : null} courseTitle={course.title} />}

      {insights && insights.knowledge_checks.length > 0 && <KnowledgeChecks checks={insights.knowledge_checks} />}

      <SurveyResults workspaceId={workspaceId} courseId={course.id} Text={RichText} />

      {resetting && (
        <ResetDialog
          workspaceId={workspaceId}
          courseId={course.id}
          courseTitle={course.title}
          quiz={quiz}
          row={resetting}
          onClose={() => setResetting(null)}
          onDone={() => {
            setNotice(`${nameOf(resetting)}’s progress was reset. They’ll start “${course.title}” from the beginning next time.`);
            setResetting(null);
            reload();
            reloadInsights();
          }}
        />
      )}
    </div>
  );
}

/** Lowest share of right answers first; questions no one has answered yet go last. */
function hardness(q: { answered: number; correct_pct: number }) {
  return q.answered > 0 ? q.correct_pct : 101;
}

/** What the bars under a question count, in words. */
function answersCaption(kind: string) {
  if (kind === 'multiple') return 'What people picked. They could pick more than one answer, so this can add up to more than 100%.';
  if (kind === 'matching') return 'How often each pair was matched right.';
  if (kind === 'fill_blank') return 'What people typed, most common first.';
  if (kind === 'ordering') return 'How often the items were put in the right order.';
  if (kind === 'hotspot') return 'Where people clicked on the picture.';
  return 'What people picked.';
}

/** Picks of the most popular wrong answer, when there are at least two wrong answers to compare (0 = none to point out). */
function commonWrongPicks(q: QuestionInsight) {
  const wrong = q.answers.filter((a) => !a.correct && a.id !== 'other');

  return wrong.length >= 2 ? Math.max(...wrong.map((a) => a.picked)) : 0;
}

function AnswerBreakdown({ q, n }: { q: QuestionInsight; n: number }) {
  const top = commonWrongPicks(q);
  const typed = q.kind === 'fill_blank';

  return (
    <div className='mt-3 max-w-[760px]' data-testid='carehub-learning-report-answers'>
      <div className='mb-1.5 text-xs text-text-tertiary'>{answersCaption(q.kind)}</div>
      <ul className='m-0 flex list-none flex-col gap-1.5 p-0' aria-label={`Question ${n}: answers`}>
        {q.answers.map((a, i) => {
          const share = pct(a.picked, q.answered);
          const common = top > 0 && !a.correct && a.id !== 'other' && a.picked === top;

          return (
            <li key={`${a.id}-${i}`} className='flex flex-wrap items-center gap-x-3 gap-y-1' data-testid='carehub-learning-report-answer'>
              <span className='flex min-w-0 flex-1 basis-[220px] items-start gap-1.5 text-sm text-text-primary'>
                <span aria-hidden='true' className={cn('w-4 shrink-0 text-center font-semibold', a.correct ? 'chl-mark-right' : 'text-text-tertiary')}>
                  {a.correct ? '✓' : '·'}
                </span>
                <span className='min-w-0'>
                  {a.correct && <span className='sr-only'>Right answer: </span>}
                  {typed ? (
                    <span className='whitespace-pre-wrap break-words'>{a.text.trim() || '(left blank)'}</span>
                  ) : (
                    <RichText text={a.text.trim() || 'Untitled answer'} />
                  )}
                  {common && (
                    <span className='ml-1.5 inline-block align-middle'>
                      <Chip tone='amber'>Most common wrong answer</Chip>
                    </span>
                  )}
                </span>
              </span>
              <span className='flex shrink-0 items-center gap-2 pl-[22px] sm:pl-0'>
                <span className='chl-track block h-1.5 w-24 overflow-hidden rounded-full' aria-hidden='true'>
                  <span
                    className={cn('block h-full rounded-full', a.correct && 'chl-fill')}
                    style={a.correct ? { width: `${share}%` } : { width: `${share}%`, background: common ? '#f59e0b' : 'rgba(127,127,127,.6)' }}
                  />
                </span>
                <span className='w-[124px] whitespace-nowrap text-xs tabular-nums text-text-secondary'>
                  {share}% · {a.picked} of {q.answered}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function QuestionStats({
  questions,
  version,
  details,
  courseTitle,
}: {
  questions: QuestionStat[];
  version: number;
  /** How often each answer was picked (newer servers); null leaves that out. */
  details: QuestionInsight[] | null;
  courseTitle: string;
}) {
  const [hardest, setHardest] = useState(false);
  const anyAnswers = questions.some((q) => q.answered > 0);
  const byId = useMemo(() => new Map((details || []).map((d) => [d.id, d])), [details]);
  const numbered = useMemo(() => questions.map((q, i) => ({ q, n: i + 1 })), [questions]);
  const ordered = useMemo(() => (hardest ? [...numbered].sort((a, b) => hardness(a.q) - hardness(b.q) || a.n - b.n) : numbered), [numbered, hardest]);
  const hasDetails = byId.size > 0;
  const canSort = hasDetails && questions.filter((q) => q.answered > 0).length > 1;

  const csv = () => {
    const lines: CsvValue[][] = [];

    numbered.forEach(({ q, n }) => {
      const d = byId.get(q.id);

      d?.answers.forEach((a) => {
        lines.push([
          n,
          plainText(q.prompt) || 'Untitled question',
          d.kind === 'fill_blank' ? a.text.trim() : plainText(a.text),
          a.correct ? 'Yes' : 'No',
          a.picked,
          pct(a.picked, d.answered),
        ]);
      });
    });
    downloadCsv(
      `question-details-${slug(courseTitle, 'course')}`,
      ['Question no.', 'Question', 'Answer', 'Right answer?', 'Picked (attempts)', 'Picked (% of attempts)'],
      lines
    );
  };

  return (
    <ChSection
      title='Quiz questions'
      hint={
        anyAnswers
          ? `From quiz attempts on version ${version}. Every attempt counts, so people who tried again are counted more than once.`
          : `No one has taken the quiz on version ${version} yet.`
      }
    >
      {questions.length ? (
        <>
          {hasDetails && (
            <Toolbar>
              {canSort && (
                <ToggleChip on={hardest} onClick={() => setHardest((h) => !h)} testId='carehub-learning-hardest-first'>
                  Hardest first
                </ToggleChip>
              )}
              <div className='flex-1' />
              <CsvButton
                onClick={csv}
                title='Every answer to every quiz question and how often it was picked, as a file for Excel or Google Sheets'
                ariaLabel='Download question details (CSV)'
                testId='carehub-learning-csv-questions'
              />
            </Toolbar>
          )}
          <ol className='m-0 flex list-none flex-col gap-2 p-0'>
            {ordered.map(({ q, n }) => {
              const missed = q.answered >= 3 && q.correct_pct < 50;
              const d = byId.get(q.id);

              return (
                <li key={q.id} className='rounded-[12px] border border-border-primary p-3' data-testid='carehub-learning-report-question'>
                  <div className='flex items-start gap-2'>
                    <span className='w-6 shrink-0 text-sm tabular-nums text-text-tertiary'>{n}.</span>
                    <div className='min-w-0 flex-1'>
                      <div className='text-sm text-text-primary'>
                        <RichText text={q.prompt.trim() || 'Untitled question'} />
                      </div>
                      <div className='mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5'>
                        <ProgressBar percent={q.answered ? q.correct_pct : 0} className='w-40 max-w-full' label={`Question ${n}: answered correctly`} />
                        <span className='text-xs text-text-secondary'>
                          {q.answered ? `${q.correct_pct}% correct · ${plural(q.answered, 'answer')}` : 'No answers yet'}
                        </span>
                        {missed && <Chip tone='amber'>Often missed</Chip>}
                      </div>
                      {d && d.answered > 0 && d.answers.length > 0 && <AnswerBreakdown q={d} n={n} />}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        <EmptyBox>This quiz has no questions.</EmptyBox>
      )}
    </ChSection>
  );
}

interface KcRow extends KnowledgeCheckStat {
  /** Place in the course. */
  n: number;
}

function KnowledgeChecks({ checks }: { checks: KnowledgeCheckStat[] }) {
  const rows = useMemo(() => checks.map((k, n): KcRow => ({ ...k, n })).sort((a, b) => hardness(a) - hardness(b) || a.n - b.n), [checks]);
  const cols = useMemo<Col<KcRow>[]>(
    () => [
      {
        id: 'lesson',
        label: 'Lesson',
        sort: (r) => r.n,
        cell: (r) => <span className='break-words text-text-primary'>{r.lesson_title || 'Untitled lesson'}</span>,
      },
      {
        id: 'question',
        label: 'Question',
        sort: (r) => plainText(r.prompt).toLowerCase(),
        cell: (r) => <RichText text={r.prompt.trim() || 'Untitled question'} className='text-text-primary' />,
      },
      { id: 'answered', label: 'Answered', right: true, sort: (r) => r.answered, cell: (r) => <Num n={r.answered} /> },
      {
        id: 'right',
        label: '% right',
        sort: (r) => (r.answered > 0 ? r.correct_pct : null),
        cell: (r) => (r.answered > 0 ? <PercentCell percent={r.correct_pct} label={`${plainText(r.prompt) || 'Knowledge check'}: answered right`} /> : null),
      },
    ],
    []
  );

  return (
    <ChSection title='Knowledge checks' hint='Practice questions inside the lessons, hardest first. Each person’s latest answer counts.'>
      <ReportTable
        rows={rows}
        cols={cols}
        rowKey={(r) => `${r.block_id}-${r.n}`}
        empty='This course has no knowledge checks.'
        testId='carehub-learning-report-kcs'
        rowTestId='carehub-learning-report-kc'
      />
    </ChSection>
  );
}

interface StopRow extends LessonStop {
  /** Place in the course. */
  n: number;
}

function WherePeopleStop({ lessons, courseTitle }: { lessons: LessonStop[]; courseTitle: string }) {
  const rows = useMemo(() => lessons.map((l, n): StopRow => ({ ...l, n })), [lessons]);
  const most = rows.reduce((m, r) => Math.max(m, r.stopped_here), 0);
  const cols = useMemo<Col<StopRow>[]>(
    () => [
      {
        id: 'lesson',
        label: 'Lesson',
        sort: (r) => r.n,
        cell: (r) => (
          <span className='flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1'>
            <span className='min-w-0 break-words font-medium text-text-primary'>
              <span className='font-normal tabular-nums text-text-tertiary'>{r.n + 1}.</span> {r.title || 'Untitled lesson'}
            </span>
            {most > 0 && r.stopped_here === most && <Chip tone='amber'>Most people stop here</Chip>}
          </span>
        ),
      },
      { id: 'opened', label: 'Opened', right: true, sort: (r) => r.opened, cell: (r) => <Num n={r.opened} /> },
      { id: 'done', label: 'Done', right: true, sort: (r) => r.done, cell: (r) => <Num n={r.done} /> },
      {
        id: 'stopped',
        label: 'Stopped here',
        right: true,
        sort: (r) => r.stopped_here,
        cell: (r) =>
          most > 0 && r.stopped_here === most ? <span className='font-semibold tabular-nums text-text-primary'>{r.stopped_here}</span> : <Num n={r.stopped_here} />,
      },
    ],
    [most]
  );

  const csv = () =>
    downloadCsv(
      `where-people-stop-${slug(courseTitle, 'course')}`,
      ['Lesson no.', 'Lesson', 'Opened', 'Done', 'Stopped here'],
      rows.map((r) => [r.n + 1, r.title || 'Untitled lesson', r.opened, r.done, r.stopped_here])
    );

  return (
    <ChSection
      title='Where people stop'
      hint='Stopped here: people who started but haven’t finished, by the lesson they’re on now.'
      right={
        <CsvButton
          onClick={csv}
          title='Every lesson with how many people opened it, finished it and stopped there, as a file for Excel or Google Sheets'
          ariaLabel='Download where people stop (CSV)'
          testId='carehub-learning-csv-stops'
        />
      }
    >
      <ReportTable
        rows={rows}
        cols={cols}
        rowKey={(r) => `${r.id}-${r.n}`}
        empty='This course has no lessons.'
        testId='carehub-learning-report-stops'
        rowTestId='carehub-learning-report-stop'
      />
    </ChSection>
  );
}

function ResetDialog({
  workspaceId,
  courseId,
  courseTitle,
  quiz,
  row,
  onClose,
  onDone,
}: {
  workspaceId: string;
  courseId: string;
  courseTitle: string;
  quiz: boolean;
  row: CourseReportRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const name = nameOf(row);
  const close = () => {
    if (!busy) onClose();
  };
  const confirm = () => {
    setBusy(true);
    setError(null);
    reportsApi.reset(workspaceId, courseId, row.uid).then(
      () => onDone(),
      (e: unknown) => {
        setBusy(false);
        setError(e || new Error('Something went wrong. Please try again.'));
      }
    );
  };

  return (
    <CareHubModal
      title='Reset progress?'
      onClose={close}
      testId='carehub-learning-reset-dialog'
      footer={
        <>
          <Button type='button' variant='outline' disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button type='button' variant='destructive' loading={busy} disabled={busy} onClick={confirm} data-testid='carehub-learning-reset-confirm'>
            Reset progress
          </Button>
        </>
      }
    >
      <p className='m-0 text-sm text-text-primary'>
        {name} will start “{courseTitle}” again from the beginning
        {quiz ? ', with all their quiz attempts available again' : ''}. Their progress, time and
        {quiz ? ' score' : ' finish date'} for this course are cleared.
      </p>
      <p className='m-0 mt-2 text-sm text-text-secondary'>{quiz ? 'Their past quiz attempts are kept for history. ' : ''}This can’t be undone.</p>
      {error ? (
        <div className='mt-3'>
          <ChNote tone='error'>{lErrorText(error)}</ChNote>
        </div>
      ) : null}
    </CareHubModal>
  );
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

type PeopleFilter = 'all' | 'started' | 'not_started';

export function LearningReportsPeople({ workspaceId }: { workspaceId: string }) {
  usePageTitle(learningTitle('People', 'Reports'));
  const navigate = useNavigate();
  const load = useCallback(() => reportsApi.people(workspaceId), [workspaceId]);
  const { data, error, reload } = useLoad(load);
  const [filter, setFilter] = useState<PeopleFilter>('all');
  const [query, setQuery] = useState('');
  const shown = useMemo(
    () => (data || []).filter((p) => (filter === 'all' || (filter === 'started' ? p.started > 0 : p.started === 0)) && matches(p, query)),
    [data, filter, query]
  );
  const cols = useMemo<Col<PersonSummary>[]>(
    () => [
      { id: 'person', label: 'Person', sort: (p) => nameOf(p).toLowerCase(), cell: (p) => <PersonCell p={p} /> },
      { id: 'started', label: 'Started', right: true, sort: (p) => p.started, cell: (p) => <Num n={p.started} /> },
      { id: 'in_progress', label: 'In progress', right: true, sort: (p) => p.in_progress, cell: (p) => <Num n={p.in_progress} /> },
      { id: 'finished', label: 'Finished', right: true, sort: (p) => p.finished, cell: (p) => <Num n={p.finished} /> },
      { id: 'failed', label: 'Didn’t pass', right: true, sort: (p) => p.failed, cell: (p) => <Num n={p.failed} /> },
      { id: 'score', label: 'Avg. score', right: true, sort: (p) => p.avg_score, cell: (p) => (p.avg_score === null ? null : `${p.avg_score}%`) },
      {
        id: 'time',
        label: 'Time',
        right: true,
        sort: (p) => (p.started ? p.time_ms : null),
        cell: (p) => (p.started ? formatDuration(p.time_ms) : null),
      },
      {
        id: 'last',
        label: 'Last activity',
        desc: true,
        sort: (p) => p.last_ms,
        cell: (p) => (p.last_ms ? <When ms={p.last_ms} withTime /> : null),
      },
    ],
    []
  );

  const csv = () => {
    if (!data) return;
    downloadCsv(
      'people-report',
      ['Name', 'Email', 'Courses started', 'In progress', 'Finished', 'Didn’t pass', 'Avg. score (%)', 'Time (minutes)', 'Last activity'],
      data.map((p) => [p.name, p.email, p.started, p.in_progress, p.finished, p.failed, p.avg_score, csvMinutes(p.time_ms), csvDate(p.last_ms)])
    );
  };

  let body: ReactNode;

  if (!data) {
    body = error ? <LoadError error={error} onRetry={reload} /> : <Loading />;
  } else {
    const started = data.filter((p) => p.started > 0).length;
    const finishedOne = data.filter((p) => p.finished > 0).length;

    body = (
      <>
        {error ? <RefreshError error={error} onRetry={reload} /> : null}
        <Cards>
          <ChCard label='Members' value={data.length} hint='Not counting guests' />
          <ChCard label='Started a course' value={started} hint={`${pct(started, data.length)}% of members`} />
          <ChCard label='Finished a course' value={finishedOne} hint={`${pct(finishedOne, data.length)}% of members`} />
          <ChCard label='Haven’t started' value={data.length - started} hint='Any course' />
        </Cards>
        <ChSection title='People' hint='Open someone to see each course they’ve started and the ones they haven’t.'>
          <Toolbar>
            <FilterChips
              value={filter}
              options={[
                { id: 'all', label: 'Everyone', count: data.length },
                { id: 'started', label: 'Started a course', count: started },
                { id: 'not_started', label: 'Haven’t started', count: data.length - started },
              ]}
              onChange={setFilter}
            />
            <div className='flex-1' />
            <SearchBox value={query} onChange={setQuery} label='Search people' />
          </Toolbar>
          <ReportTable
            rows={shown}
            cols={cols}
            rowKey={(p) => p.uid}
            onOpen={(p) => navigate(personPath(p.uid))}
            empty={
              query.trim()
                ? `No one matches “${query.trim()}”.`
                : filter === 'not_started'
                  ? 'Everyone has started at least one course.'
                  : filter === 'started'
                    ? 'No one has started a course yet.'
                    : 'No one is in this workspace yet.'
            }
            testId='carehub-learning-report-table'
          />
        </ChSection>
      </>
    );
  }

  return (
    <div data-testid='carehub-learning-report-people'>
      <div className='mb-5 flex flex-wrap items-center gap-2'>
        <ReportsNav active='people' />
        <div className='flex-1' />
        {data && data.length > 0 && <CsvButton onClick={csv} />}
      </div>
      {body}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One person
// ---------------------------------------------------------------------------

export function LearningReportPerson({ workspaceId }: { workspaceId: string }) {
  const { uid = '' } = useParams();

  if (!/^\d{1,19}$/.test(uid)) return <Navigate to={PEOPLE_PATH} replace />;
  return <PersonReportView key={uid} workspaceId={workspaceId} uid={uid} />;
}

function PersonReportView({ workspaceId, uid }: { workspaceId: string; uid: string }) {
  const navigate = useNavigate();
  // The course list is only used for "Not started"; the page still works without it.
  const load = useCallback(
    () =>
      Promise.all([reportsApi.person(workspaceId, uid), reportsApi.courses(workspaceId).catch(() => null)]).then(([report, courses]) => ({
        report,
        courses,
      })),
    [workspaceId, uid]
  );
  const { data, error, reload } = useLoad(load);
  const rows = useMemo(() => data?.report.rows || [], [data]);
  const archived = useMemo(() => new Set((data?.courses || []).filter((c) => c.status === 'archived').map((c) => c.id)), [data]);
  const notStarted = useMemo(() => {
    const seen = new Set(rows.map((r) => r.course_id));

    return data?.courses ? data.courses.filter((c) => c.status !== 'archived' && !seen.has(c.id)) : null;
  }, [data, rows]);
  const hasScores = rows.some((r) => r.score !== null || r.attempts > 0);
  const hasAcks = rows.some((r) => r.ack_ms);
  const cols = useMemo<Col<PersonCourseRow>[]>(() => {
    const list: Col<PersonCourseRow>[] = [
      {
        id: 'course',
        label: 'Course',
        sort: (r) => r.title.toLowerCase(),
        cell: (r) => (
          <span className='flex min-w-0 flex-wrap items-center gap-1.5'>
            <span className='break-words font-medium text-text-primary'>{r.title}</span>
            {archived.has(r.course_id) && <Chip tone='amber'>Archived</Chip>}
          </span>
        ),
      },
      { id: 'status', label: 'Status', badge: true, sort: (r) => statusRank(r), cell: (r) => <StatusCell p={r} /> },
      {
        id: 'progress',
        label: 'Progress',
        desc: true,
        sort: (r) => r.percent,
        cell: (r) => <PercentCell percent={r.percent} label={`${r.title}: progress`} />,
      },
    ];

    if (hasScores) {
      list.push(
        { id: 'score', label: 'Score', right: true, sort: (r) => r.score, cell: (r) => (r.score === null ? null : `${r.score}%`) },
        { id: 'attempts', label: 'Attempts', right: true, sort: (r) => r.attempts, cell: (r) => (r.attempts ? r.attempts : null) }
      );
    }
    list.push(
      { id: 'time', label: 'Time', right: true, sort: (r) => r.time_ms, cell: (r) => formatDuration(r.time_ms) },
      {
        id: 'started',
        label: 'Started',
        desc: true,
        sort: (r) => r.started_ms || null,
        cell: (r) => (r.started_ms ? <When ms={r.started_ms} /> : null),
      },
      {
        id: 'last',
        label: 'Last activity',
        desc: true,
        sort: (r) => r.last_ms || null,
        cell: (r) => (r.last_ms ? <When ms={r.last_ms} withTime /> : null),
      },
      {
        id: 'finished',
        label: 'Finished',
        desc: true,
        sort: (r) => r.completed_ms,
        cell: (r) => (r.completed_ms ? <When ms={r.completed_ms} /> : null),
      }
    );
    if (hasAcks) {
      list.push({
        id: 'ack',
        label: 'Acknowledged',
        desc: true,
        sort: (r) => r.ack_ms,
        cell: (r) => (r.ack_ms ? <When ms={r.ack_ms} /> : null),
      });
    }
    return list;
  }, [archived, hasScores, hasAcks]);

  usePageTitle(learningTitle(data ? nameOf(data.report.person) : '', 'Reports'));
  const back = <BackLink label='People' onClick={() => navigate(PEOPLE_PATH)} />;

  if (!data) {
    return (
      <div data-testid='carehub-learning-report-person'>
        <div className='mb-4'>{back}</div>
        {error ? <LoadError error={error} onRetry={reload} /> : <Loading />}
      </div>
    );
  }

  const { person } = data.report;
  const name = nameOf(person);
  const finished = rows.filter(isDone).length;
  const inProgress = rows.filter((r) => r.status === 'in_progress').length;
  const failed = rows.filter((r) => r.status === 'failed').length;
  const avgScore = average(rows.flatMap((r) => (r.score === null ? [] : [r.score])));
  const totalTime = rows.reduce((n, r) => n + r.time_ms, 0);

  const csv = () => {
    const header = [
      'Course',
      'Status',
      'Progress (%)',
      'Score (%)',
      'Quiz attempts',
      'Time (minutes)',
      'Started',
      'Last activity',
      'Finished',
      'Acknowledged',
    ];
    const lines: CsvValue[][] = rows.map((r) => [
      r.title,
      statusLabel(r),
      r.percent,
      r.score,
      r.attempts,
      csvMinutes(r.time_ms),
      csvDate(r.started_ms),
      csvDate(r.last_ms),
      csvDate(r.completed_ms),
      csvDate(r.ack_ms),
    ]);

    for (const c of notStarted || []) lines.push([c.title, 'Not started', ...header.slice(2).map(() => null)]);
    downloadCsv(`person-report-${slug(name, 'person')}`, header, lines);
  };

  return (
    <div data-testid='carehub-learning-report-person'>
      <div className='mb-4'>
        {back}
        <div className='mt-2 flex flex-wrap items-start gap-3'>
          <div className='min-w-[min(100%,240px)] flex-1'>
            <h2 className='m-0 break-words text-xl font-semibold'>{name}</h2>
            {person.email && person.email !== name && <div className='mt-0.5 break-all text-sm text-text-secondary'>{person.email}</div>}
          </div>
          <CsvButton onClick={csv} />
        </div>
      </div>

      {error ? <RefreshError error={error} onRetry={reload} /> : null}

      <Cards>
        <ChCard label='Started' value={rows.length} hint={plural(rows.length, 'course')} />
        <ChCard label='Finished' value={finished} />
        <ChCard label='In progress' value={inProgress} />
        {failed > 0 && <ChCard label='Didn’t pass' value={failed} hint='Used every quiz attempt' />}
        {notStarted && <ChCard label='Not started' value={notStarted.length} hint='Published courses' />}
        {avgScore !== null && <ChCard label='Avg. score' value={`${Math.round(avgScore)}%`} hint='Courses with a quiz' />}
        <ChCard label='Time spent' value={rows.length ? formatDuration(totalTime) : '—'} hint='All courses' />
      </Cards>

      <ChSection title='Courses started' hint={rows.length ? 'Open a course to see everyone’s progress on it.' : undefined}>
        <ReportTable
          rows={rows}
          cols={cols}
          rowKey={(r) => r.course_id}
          onOpen={(r) => navigate(coursePath(r.course_id))}
          empty={`${name} hasn’t started any courses yet.`}
          testId='carehub-learning-report-table'
        />
      </ChSection>

      {notStarted && (
        <ChSection title='Not started' hint={notStarted.length ? `Published courses ${name} hasn’t opened yet.` : undefined}>
          {notStarted.length ? (
            <div className='grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3' data-testid='carehub-learning-report-not-started'>
              {notStarted.map((c) => (
                <button
                  key={c.id}
                  type='button'
                  onClick={() => navigate(coursePath(c.id))}
                  className='min-w-0 break-words rounded-[10px] border border-border-primary px-3 py-2 text-left text-sm hover:bg-fill-content-hover'
                >
                  {c.title}
                </button>
              ))}
            </div>
          ) : (
            <EmptyBox>{`${name} has opened every published course.`}</EmptyBox>
          )}
        </ChSection>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Teams: every group, and every course that's assigned to someone
// ---------------------------------------------------------------------------

const TEAMS_NOT_LIVE = 'Team reports will show here after the next Care Hub update.';

interface TeamCounts {
  assigned: number;
  finished: number;
  in_progress: number;
  not_started: number;
  overdue: number;
}

/** Completion bar, then the counts. Members only for groups. */
function countCols<T extends TeamCounts>(barLabel: (row: T) => string, members?: (row: T) => number): Col<T>[] {
  const memberCols: Col<T>[] = members ? [{ id: 'members', label: 'Members', right: true, sort: members, cell: (r) => <Num n={members(r)} /> }] : [];

  return [
    {
      id: 'completion',
      label: 'Completion',
      desc: true,
      sort: (r) => (r.assigned ? pct(r.finished, r.assigned) : null),
      cell: (r) => (r.assigned ? <PercentCell percent={pct(r.finished, r.assigned)} label={barLabel(r)} /> : null),
    },
    ...memberCols,
    { id: 'assigned', label: 'Assigned', right: true, sort: (r) => r.assigned, cell: (r) => <Num n={r.assigned} /> },
    { id: 'finished', label: 'Finished', right: true, sort: (r) => r.finished, cell: (r) => <Num n={r.finished} /> },
    { id: 'in_progress', label: 'In progress', right: true, sort: (r) => r.in_progress, cell: (r) => <Num n={r.in_progress} /> },
    { id: 'not_started', label: 'Not started', right: true, sort: (r) => r.not_started, cell: (r) => <Num n={r.not_started} /> },
    { id: 'overdue', label: 'Overdue', right: true, sort: (r) => r.overdue, cell: (r) => <OverdueNum n={r.overdue} /> },
  ];
}

/** Groups A–Z, with the most overdue first until someone sorts by another column. A row opens the group. */
function GroupTable({ groups, barLabel, testId }: { groups: GroupStat[]; barLabel: (g: GroupStat) => string; testId: string }) {
  const navigate = useNavigate();
  const rows = useMemo(() => [...groups].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })), [groups]);
  const cols: Col<GroupStat>[] = [
    {
      id: 'group',
      label: 'Group',
      sort: (g) => g.name.toLowerCase(),
      cell: (g) => <span className='break-words font-medium text-text-primary'>{g.name}</span>,
    },
    ...countCols<GroupStat>(barLabel, (g) => g.members),
  ];

  return (
    <ReportTable
      rows={rows}
      cols={cols}
      rowKey={(g) => g.id}
      onOpen={(g) => navigate(groupPath(g.id))}
      empty='No groups yet. Groups are made in Learning → Assign.'
      testId={testId}
      rowTestId='carehub-learning-report-group'
      initialSort={{ id: 'overdue', desc: true }}
    />
  );
}

const TEAM_COURSE_COLS: Col<TeamCourseStat>[] = [
  {
    id: 'course',
    label: 'Course',
    sort: (c) => c.title.toLowerCase(),
    cell: (c) => <span className='break-words font-medium text-text-primary'>{c.title}</span>,
  },
  ...countCols<TeamCourseStat>((c) => `${c.title}: share of assigned people who finished`),
];

export function LearningReportsTeams({ workspaceId }: { workspaceId: string }) {
  usePageTitle(learningTitle('Teams', 'Reports'));
  const navigate = useNavigate();
  const load = useCallback(() => reportsApi.teams(workspaceId), [workspaceId]);
  const { data, error, reload } = useLoad(load);

  const groupsCsv = () => {
    if (!data) return;
    downloadCsv(
      'team-report-groups',
      ['Group', 'Members', 'Assigned', 'Finished', 'In progress', 'Not started', 'Overdue', 'Completion (% of assigned)'],
      data.groups.map((g) => [
        g.name,
        g.members,
        g.assigned,
        g.finished,
        g.in_progress,
        g.not_started,
        g.overdue,
        g.assigned ? pct(g.finished, g.assigned) : null,
      ])
    );
  };
  const coursesCsv = () => {
    if (!data) return;
    downloadCsv(
      'team-report-courses',
      ['Course', 'Assigned', 'Finished', 'In progress', 'Not started', 'Overdue', 'Completion (% of assigned)'],
      data.courses.map((c) => [
        c.title,
        c.assigned,
        c.finished,
        c.in_progress,
        c.not_started,
        c.overdue,
        c.assigned ? pct(c.finished, c.assigned) : null,
      ])
    );
  };

  let body: ReactNode;

  if (!data) {
    if (!error) body = <Loading />;
    else if (learningNotLive(error)) body = <ChNote tone='info'>{TEAMS_NOT_LIVE}</ChNote>;
    else body = <LoadError error={error} onRetry={reload} />;
  } else {
    const overdue = data.courses.reduce((n, c) => n + c.overdue, 0);

    body = (
      <>
        {error ? <RefreshError error={error} onRetry={reload} /> : null}
        <Cards>
          <ChCard label='Groups' value={data.groups.length} hint='Made in Learning → Assign' />
          <ChCard label='Courses' value={data.courses.length} hint='Assigned to at least one person' />
          <ChCard label='Overdue' value={overdue} hint='Across all courses' />
        </Cards>
        <ChSection
          title='Groups'
          hint='How each group’s members are doing with the courses assigned to them. Someone with three courses counts three times.'
          right={
            data.groups.length > 0 ? (
              <CsvButton
                onClick={groupsCsv}
                title='Every group with its numbers, as a file for Excel or Google Sheets'
                ariaLabel='Download groups (CSV)'
                testId='carehub-learning-csv-team-groups'
              />
            ) : undefined
          }
        >
          <GroupTable
            groups={data.groups}
            barLabel={(g) => `${g.name}: share of assigned courses finished`}
            testId='carehub-learning-report-team-groups'
          />
        </ChSection>
        <ChSection
          title='Courses'
          hint='Published courses that are assigned to someone. Counts are for the people each one is assigned to.'
          right={
            data.courses.length > 0 ? (
              <CsvButton
                onClick={coursesCsv}
                title='Every assigned course with its numbers, as a file for Excel or Google Sheets'
                ariaLabel='Download courses (CSV)'
                testId='carehub-learning-csv-team-courses'
              />
            ) : undefined
          }
        >
          <ReportTable
            rows={data.courses}
            cols={TEAM_COURSE_COLS}
            rowKey={(c) => c.course_id}
            onOpen={(c) => navigate(coursePath(c.course_id))}
            empty='No courses are assigned to anyone yet. Courses are assigned in Learning → Assign.'
            testId='carehub-learning-report-team-courses'
            rowTestId='carehub-learning-report-team-course'
          />
        </ChSection>
      </>
    );
  }

  return (
    <div data-testid='carehub-learning-report-teams'>
      <div className='mb-5 flex flex-wrap items-center gap-2'>
        <ReportsNav active='teams' />
      </div>
      {body}
    </div>
  );
}

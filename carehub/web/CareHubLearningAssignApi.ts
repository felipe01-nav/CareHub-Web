// CareHub Learning: assigning courses (people, groups, roles, everyone), due dates, "Assigned to you" and
// certificates — types, server calls and small date helpers. Screens live in CareHubLearningAssign.tsx and
// CareHubLearningCertificate.tsx.
import { CH_API, chCall, tzMinutesEast } from './CareHubCore';
import { clampInt, lapi, LEARNING_PATH, num, PRESET_IDS, str } from './CareHubLearningApi';
import { reportsApi } from './CareHubLearningReports';

import type { ChipTone, CourseCard, LearnStatus, MyProgress } from './CareHubLearningApi';

export const ASSIGN_PATH = `${LEARNING_PATH}/assign`;
export const GROUPS_PATH = `${ASSIGN_PATH}/groups`;
export const CERTIFICATES_PATH = `${LEARNING_PATH}/certificates`;
export const VERIFY_PATH = `${LEARNING_PATH}/verify`;

export const assignCoursePath = (courseId: string) => `${ASSIGN_PATH}/course/${encodeURIComponent(courseId)}`;
export const assignmentPath = (id: string) => `${ASSIGN_PATH}/assignment/${encodeURIComponent(id)}`;
export const groupPath = (id: string) => `${GROUPS_PATH}/${encodeURIComponent(id)}`;
export const certificatePath = (code: string) => `${LEARNING_PATH}/certificate/${encodeURIComponent(code)}`;

/** Limits the server checks too (P2-API). */
export const MAX_TARGETS = 200;
export const MAX_NOTE = 500;
export const MAX_GROUP_NAME = 80;
export const MAX_GROUP_DESCRIPTION = 500;

/** Ids in links (assignment, group). Course ids are checked with UUID_RE. */
export const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TargetKind = 'person' | 'group' | 'role' | 'everyone';

export interface Target {
  kind: TargetKind;
  /** person: uid · group: group id · role: role id · everyone: "". */
  id: string;
}

export interface NamedTarget extends Target {
  name: string;
}

export interface Member {
  uid: string;
  name: string;
  email: string;
  role_id: string;
  role_name: string;
}

export interface Role {
  id: string;
  name: string;
  members: number;
}

export interface Group {
  id: string;
  name: string;
  description: string;
  member_uids: string[];
  members: number;
  /** Assignments that target this group. */
  courses: number;
  updated_ms: number;
}

export interface Counts {
  people: number;
  finished: number;
  in_progress: number;
  not_started: number;
  overdue: number;
}

export interface Assignment extends Counts {
  id: string;
  course_id: string;
  course_title: string;
  target: NamedTarget;
  due_ms: number | null;
  tz_minutes: number | null;
  required: boolean;
  note: string;
  calendar: boolean;
  created_ms: number;
  created_by_name: string;
  updated_ms: number;
}

export type AssigneeStatus = 'not_started' | LearnStatus;

export interface Assignee {
  uid: string;
  name: string;
  email: string;
  status: AssigneeStatus;
  percent: number;
  due_ms: number | null;
  overdue: boolean;
  assigned_ms: number;
  completed_ms: number | null;
}

export type AssignCourseStatus = 'published' | 'archived' | 'draft';

/** A course on the Assign tab, with counts over the distinct people it's assigned to. */
export interface AssignCourse {
  id: string;
  title: string;
  status: AssignCourseStatus;
  catalog: boolean;
  version: number;
  assigned: number;
  finished: number;
  in_progress: number;
  not_started: number;
  overdue: number;
}

/** A person's effective assignment for a course (earliest due, required if any assignment says so). */
export interface AssignmentInfo {
  due_ms: number | null;
  required: boolean;
  overdue: boolean;
  assigned_ms: number;
  note: string;
}

export interface AssignedCourse extends CourseCard {
  assignment: AssignmentInfo;
}

export interface Certificate {
  code: string;
  course_id: string;
  title: string;
  person_name: string;
  score: number | null;
  issued_ms: number;
  version: number;
}

export interface AssignBody {
  course_id: string;
  targets: Target[];
  due_ms: number | null;
  tz_minutes: number;
  required: boolean;
  note?: string;
  calendar?: boolean;
  notify?: boolean;
}

export interface AssignmentChanges {
  due_ms?: number | null;
  tz_minutes?: number;
  required?: boolean;
  note?: string;
  calendar?: boolean;
}

// ---------------------------------------------------------------------------
// Defensive parsing
// ---------------------------------------------------------------------------

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function bool(v: unknown, d = false) {
  return typeof v === 'boolean' ? v : d;
}

function oneOf<T extends string>(v: unknown, list: readonly T[], d: T): T {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : d;
}

function numOrNull(v: unknown) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function count(v: unknown) {
  return Math.max(0, Math.round(num(v)));
}

/** Person ids are 64-bit numbers, so they travel as text. */
export function uidOf(v: unknown) {
  if (typeof v === 'string') return /^\d{1,19}$/.test(v.trim()) ? v.trim() : '';
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? String(v) : '';
}

const TARGET_KINDS: readonly TargetKind[] = ['person', 'group', 'role', 'everyone'];
const LEARN_STATUSES: readonly LearnStatus[] = ['in_progress', 'completed', 'passed', 'failed'];

function memberOf(raw: unknown): Member {
  const o = obj(raw);

  return { uid: uidOf(o.uid), name: str(o.name).trim(), email: str(o.email).trim(), role_id: str(o.role_id), role_name: str(o.role_name) };
}

function roleOf(raw: unknown): Role {
  const o = obj(raw);
  const id = typeof o.id === 'number' ? String(o.id) : str(o.id);

  return { id, name: str(o.name).trim() || id, members: count(o.members) };
}

function groupOf(raw: unknown): Group {
  const o = obj(raw);
  const uids = arr(o.member_uids).map(uidOf).filter(Boolean);

  return {
    id: str(o.id),
    name: str(o.name).trim() || 'Untitled group',
    description: str(o.description),
    member_uids: Array.from(new Set(uids)),
    members: typeof o.members === 'number' ? count(o.members) : uids.length,
    courses: count(o.courses),
    updated_ms: num(o.updated_ms),
  };
}

function targetOf(raw: unknown): NamedTarget {
  const o = obj(raw);
  const kind = oneOf(o.kind, TARGET_KINDS, 'person');
  const id = kind === 'person' ? uidOf(o.id) : typeof o.id === 'number' ? String(o.id) : str(o.id);

  return { kind, id, name: str(o.name).trim() };
}

function assignmentOf(raw: unknown): Assignment {
  const o = obj(raw);

  return {
    id: str(o.id),
    course_id: str(o.course_id),
    course_title: str(o.course_title) || 'Untitled course',
    target: targetOf(o.target),
    due_ms: numOrNull(o.due_ms),
    tz_minutes: numOrNull(o.tz_minutes),
    required: bool(o.required, true),
    note: str(o.note),
    calendar: bool(o.calendar),
    people: count(o.people),
    finished: count(o.finished),
    in_progress: count(o.in_progress),
    not_started: count(o.not_started),
    overdue: count(o.overdue),
    created_ms: num(o.created_ms),
    created_by_name: str(o.created_by_name),
    updated_ms: num(o.updated_ms),
  };
}

function assigneeOf(raw: unknown): Assignee {
  const o = obj(raw);

  return {
    uid: uidOf(o.uid),
    name: str(o.name).trim(),
    email: str(o.email).trim(),
    status: o.status === 'not_started' ? 'not_started' : oneOf(o.status, LEARN_STATUSES, 'in_progress'),
    percent: clampInt(num(o.percent), 0, 100),
    due_ms: numOrNull(o.due_ms),
    overdue: bool(o.overdue),
    assigned_ms: num(o.assigned_ms),
    completed_ms: numOrNull(o.completed_ms),
  };
}

function assignCourseOf(raw: unknown): AssignCourse {
  const o = obj(raw);

  return {
    id: str(o.id),
    title: str(o.title) || 'Untitled course',
    status: oneOf(o.status, ['published', 'archived', 'draft'] as const, 'published'),
    catalog: bool(o.catalog, true),
    version: num(o.version, 1),
    assigned: count(o.assigned),
    finished: count(o.finished),
    in_progress: count(o.in_progress),
    not_started: count(o.not_started),
    overdue: count(o.overdue),
  };
}

function myOf(raw: unknown): MyProgress | null {
  const o = obj(raw);

  if (!raw || typeof raw !== 'object') return null;
  return {
    status: oneOf(o.status, LEARN_STATUSES, 'in_progress'),
    percent: clampInt(num(o.percent), 0, 100),
    score: typeof o.score === 'number' ? o.score : null,
    attempts: num(o.attempts),
    time_ms: num(o.time_ms),
    started_ms: num(o.started_ms),
    last_ms: num(o.last_ms),
    completed_ms: numOrNull(o.completed_ms),
    ack_ms: numOrNull(o.ack_ms),
    awaiting_ack: bool(o.awaiting_ack),
    version: num(o.version, 1),
  };
}

function assignedOf(raw: unknown): AssignedCourse {
  const o = obj(raw);
  const a = obj(o.assignment);

  return {
    id: str(o.id),
    title: str(o.title) || 'Untitled course',
    summary: str(o.summary),
    cover: str(o.cover),
    preset: oneOf(o.preset, PRESET_IDS, 'standard'),
    version: num(o.version, 1),
    lessons: num(o.lessons),
    est_minutes: num(o.est_minutes),
    quiz: bool(o.quiz),
    archived: bool(o.archived),
    updated_ms: num(o.updated_ms),
    my: myOf(o.my),
    assignment: {
      due_ms: numOrNull(a.due_ms),
      required: bool(a.required, true),
      overdue: bool(a.overdue),
      assigned_ms: num(a.assigned_ms),
      note: str(a.note),
    },
  };
}

function certificateOf(raw: unknown): Certificate {
  const o = obj(raw);

  return {
    code: str(o.code).trim().toUpperCase(),
    course_id: str(o.course_id),
    title: str(o.title) || 'Untitled course',
    person_name: str(o.person_name).trim(),
    score: numOrNull(o.score),
    issued_ms: num(o.issued_ms),
    version: num(o.version, 1),
  };
}

// ---------------------------------------------------------------------------
// Server calls
// ---------------------------------------------------------------------------

const base = (ws: string) => `${CH_API}/${ws}/learning`;
const enc = encodeURIComponent;

export const aapi = {
  members: (ws: string) =>
    chCall<unknown>('get', `${base(ws)}/members`).then((d) => {
      const o = obj(d);

      return {
        members: arr(o.members)
          .map(memberOf)
          .filter((m) => m.uid)
          .sort((a, b) => personName(a).localeCompare(personName(b))),
        roles: arr(o.roles)
          .map(roleOf)
          .filter((r) => r.id),
      };
    }),
  groups: (ws: string) =>
    chCall<unknown>('get', `${base(ws)}/groups`).then((d) =>
      arr(obj(d).groups)
        .map(groupOf)
        .filter((g) => g.id)
    ),
  createGroup: (ws: string, body: { name: string; description?: string; member_uids?: string[] }) =>
    chCall<unknown>('post', `${base(ws)}/groups`, body).then((d) => str(obj(d).id)),
  updateGroup: (ws: string, id: string, body: { name?: string; description?: string; member_uids?: string[] }) =>
    chCall<unknown>('put', `${base(ws)}/groups/${enc(id)}`, body).then((d) => ({ added: count(obj(d).added), removed: count(obj(d).removed) })),
  deleteGroup: (ws: string, id: string) =>
    chCall<unknown>('delete', `${base(ws)}/groups/${enc(id)}`).then((d) => ({ assignments_removed: count(obj(d).assignments_removed) })),

  assign: (ws: string, body: AssignBody) =>
    chCall<unknown>('post', `${base(ws)}/assignments`, body).then((d) => {
      const o = obj(d);

      return { created: count(o.created), updated: count(o.updated), people: count(o.people) };
    }),
  /** `courses` is null when the server doesn't send the course list (older server): use loadAssignOverview. */
  assignments: (ws: string, courseId?: string) =>
    chCall<unknown>('get', `${base(ws)}/assignments${courseId ? `?course_id=${enc(courseId)}` : ''}`).then((d) => {
      const o = obj(d);

      return {
        assignments: arr(o.assignments)
          .map(assignmentOf)
          .filter((a) => a.id),
        courses: Array.isArray(o.courses)
          ? o.courses
              .map(assignCourseOf)
              .filter((c) => c.id)
          : null,
      };
    }),
  assignment: (ws: string, id: string) =>
    chCall<unknown>('get', `${base(ws)}/assignments/${enc(id)}`).then((d) => {
      const o = obj(d);

      return {
        assignment: assignmentOf(o.assignment),
        people: arr(o.people)
          .map(assigneeOf)
          .filter((p) => p.uid),
      };
    }),
  updateAssignment: (ws: string, id: string, changes: AssignmentChanges) =>
    chCall<unknown>('put', `${base(ws)}/assignments/${enc(id)}`, changes),
  removeAssignment: (ws: string, id: string) => chCall<unknown>('delete', `${base(ws)}/assignments/${enc(id)}`),

  assigned: (ws: string) =>
    chCall<unknown>('get', `${base(ws)}/assigned`).then((d) =>
      arr(obj(d).courses)
        .map(assignedOf)
        .filter((c) => c.id)
    ),
  myCertificates: (ws: string) =>
    chCall<unknown>('get', `${base(ws)}/certificates/mine`).then((d) =>
      arr(obj(d).certificates)
        .map(certificateOf)
        .filter((c) => c.code)
    ),
  certificate: (ws: string, code: string) =>
    chCall<unknown>('get', `${base(ws)}/certificates/${enc(cleanCode(code))}`).then((d) => {
      const c = certificateOf(obj(d).certificate);

      if (!c.code) throw new Error(CERT_NOT_FOUND);
      return c;
    }),
};

export const CERT_NOT_FOUND = 'We couldn’t find a certificate with that code.';

// ---------------------------------------------------------------------------
// The Assign tab's course list (with a fallback for servers that don't send `courses` yet)
// ---------------------------------------------------------------------------

export interface AssignOverview {
  assignments: Assignment[];
  courses: AssignCourse[];
  /** False when the counts were added up from the assignments (people in two assignments count twice). */
  exact: boolean;
}

function sumInto(c: AssignCourse, a: Assignment) {
  c.assigned += a.people;
  c.finished += a.finished;
  c.in_progress += a.in_progress;
  c.not_started += a.not_started;
  c.overdue += a.overdue;
}

function blankCourse(id: string, title: string, status: AssignCourseStatus, catalog: boolean, version = 1): AssignCourse {
  return { id, title, status, catalog, version, assigned: 0, finished: 0, in_progress: 0, not_started: 0, overdue: 0 };
}

/**
 * Courses that can be (or were) assigned, with counts. Uses the server's `courses` list; older servers don't send it,
 * so then the list is pieced together from the catalog, Studio and Reports (whatever this person may read).
 */
export async function loadAssignOverview(ws: string, opts: { canBuild: boolean; canReports: boolean; courseId?: string }): Promise<AssignOverview> {
  const { assignments, courses } = await aapi.assignments(ws, opts.courseId);

  if (courses) return { assignments, courses: sortCourses(courses), exact: true };

  const quiet = <T,>(p: Promise<T[]>) => p.catch((): T[] => []);
  const [catalog, studio, reports] = await Promise.all([
    quiet(lapi.catalog(ws)),
    opts.canBuild ? quiet(lapi.studioList(ws)) : Promise.resolve([]),
    opts.canReports ? quiet(reportsApi.courses(ws)) : Promise.resolve([]),
  ]);
  const inCatalog = new Set(catalog.map((c) => c.id));
  const byId = new Map<string, AssignCourse>();
  const add = (c: AssignCourse) => {
    if (c.id && !byId.has(c.id)) byId.set(c.id, c);
  };

  for (const c of catalog) add(blankCourse(c.id, c.title, c.archived ? 'archived' : 'published', true, c.version));
  for (const r of studio) {
    if (r.published_version !== null) add(blankCourse(r.id, r.title, r.status === 'archived' ? 'archived' : 'published', inCatalog.has(r.id), r.published_version));
  }

  for (const r of reports) {
    if (r.status !== 'draft') add(blankCourse(r.id, r.title, r.status, inCatalog.has(r.id), r.version));
  }

  for (const a of assignments) add(blankCourse(a.course_id, a.course_title, 'published', inCatalog.has(a.course_id)));
  for (const a of assignments) {
    const c = byId.get(a.course_id);

    if (c) sumInto(c, a);
  }

  const list = [...byId.values()].filter((c) => !opts.courseId || c.id === opts.courseId);

  return { assignments, courses: sortCourses(list), exact: false };
}

function sortCourses(list: AssignCourse[]) {
  return [...list].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}

export function canAssignCourse(c: Pick<AssignCourse, 'status'>) {
  return c.status === 'published';
}

export function whyNotAssignable(c: Pick<AssignCourse, 'status'>) {
  if (c.status === 'archived') return 'This course is archived. Unarchive it before assigning it.';
  if (c.status === 'draft') return 'Publish this course before assigning it.';
  return '';
}

// ---------------------------------------------------------------------------
// People, targets and reach
// ---------------------------------------------------------------------------

export function personName(p: { name: string; email: string }) {
  return p.name.trim() || p.email.trim() || 'Someone';
}

export function matchesQuery(text: string, query: string) {
  const q = query.trim().toLowerCase();

  return !q || text.toLowerCase().includes(q);
}

export function targetKey(t: Target) {
  return `${t.kind}:${t.id}`;
}

/** How many distinct people these targets cover right now (guests and non-members never count). */
export function reachCount(targets: Target[], members: Member[], groups: Group[]) {
  const all = new Set(members.map((m) => m.uid));
  const reached = new Set<string>();

  for (const t of targets) {
    if (t.kind === 'everyone') return all.size;
    if (t.kind === 'person' && all.has(t.id)) reached.add(t.id);
    if (t.kind === 'role') members.filter((m) => m.role_id === t.id).forEach((m) => reached.add(m.uid));
    if (t.kind === 'group') {
      const g = groups.find((x) => x.id === t.id);

      g?.member_uids.forEach((uid) => {
        if (all.has(uid)) reached.add(uid);
      });
    }
  }

  return reached.size;
}

export function targetLabel(t: NamedTarget) {
  if (t.kind === 'everyone') return 'Everyone';
  const name = t.name.trim();

  if (t.kind === 'group') return name || 'A group';
  if (t.kind === 'role') return name || 'A role';
  return name || 'Someone';
}

export function targetKindLabel(kind: TargetKind) {
  return kind === 'group' ? 'Group' : kind === 'role' ? 'Role' : kind === 'everyone' ? 'Everyone in the workspace' : 'Person';
}

// ---------------------------------------------------------------------------
// Due dates ("Due Fri 30 Oct"): picked as a calendar date, stored as the end of that day
// ---------------------------------------------------------------------------

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

interface DayParts {
  y: number;
  m: number;
  d: number;
  wd: number;
}

/** Calendar date of `ms` in the browser's time zone, or in `tz` (minutes east of UTC) when it's given. */
function dayParts(ms: number, tz?: number | null): DayParts {
  if (typeof tz === 'number' && Number.isFinite(tz)) {
    const t = new Date(ms + tz * 60000);

    return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(), wd: t.getUTCDay() };
  }

  const t = new Date(ms);

  return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate(), wd: t.getDay() };
}

function dayNumber(p: DayParts) {
  return Math.round(Date.UTC(p.y, p.m, p.d) / 86400000);
}

/** "Fri 30 Oct" (with the year when it isn't this year). */
export function shortDate(ms: number, tz?: number | null) {
  const p = dayParts(ms, tz);
  const year = p.y !== new Date().getFullYear() ? ` ${p.y}` : '';

  return `${DAYS[p.wd]} ${p.d} ${MONTHS[p.m]}${year}`;
}

/** "30 October 2026". */
export function longDate(ms: number) {
  const p = dayParts(ms);

  return `${p.d} ${MONTHS_LONG[p.m]} ${p.y}`;
}

/** "Due today", "Due tomorrow" or "Due Fri 30 Oct". */
export function dueText(dueMs: number, tz?: number | null, now = Date.now()) {
  const diff = dayNumber(dayParts(dueMs, tz)) - dayNumber(dayParts(now, tz));

  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Due tomorrow';
  return `Due ${shortDate(dueMs, tz)}`;
}

/** The chip for a learner's due date: red when overdue, amber when it's today or tomorrow. Null when there's no due date. */
export function dueChip(due: { due_ms: number | null; overdue?: boolean }, done: boolean, now = Date.now()): { label: string; tone: ChipTone } | null {
  if (due.due_ms === null) return null;
  if (!done && (due.overdue || due.due_ms < now)) return { label: 'Overdue', tone: 'red' };
  const label = dueText(due.due_ms, null, now);

  return { label, tone: !done && label !== `Due ${shortDate(due.due_ms)}` ? 'amber' : 'gray' };
}

/** Value for <input type="date"> ("2026-10-30"). */
export function dateInputValue(ms: number, tz?: number | null) {
  const p = dayParts(ms, tz);

  return `${p.y}-${String(p.m + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

export function todayInputValue() {
  return dateInputValue(Date.now());
}

/** End of the picked day (23:59:59.999) in this browser's time zone, or null when the value isn't a real date. */
export function dueMsFor(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());

  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const t = new Date(y, mo, d, 23, 59, 59, 999);

  if (t.getFullYear() !== y || t.getMonth() !== mo || t.getDate() !== d) return null;
  return t.getTime();
}

/** What to send with a picked date: due_ms + tz_minutes, or null when no date is picked. */
export function dueFields(value: string): { due_ms: number | null; tz_minutes: number } | 'invalid' | 'past' {
  if (!value.trim()) return { due_ms: null, tz_minutes: tzMinutesEast() };
  const due = dueMsFor(value);

  if (due === null) return 'invalid';
  if (due <= Date.now()) return 'past';
  return { due_ms: due, tz_minutes: tzMinutesEast() };
}

// ---------------------------------------------------------------------------
// "Assigned to you"
// ---------------------------------------------------------------------------

/** Done for an assignment means completed or passed ("didn't pass" still needs doing). */
export function assignedDone(c: Pick<AssignedCourse, 'my'>) {
  return Boolean(c.my && (c.my.status === 'completed' || c.my.status === 'passed'));
}

export function assignedOverdue(c: Pick<AssignedCourse, 'my' | 'assignment'>, now = Date.now()) {
  if (assignedDone(c)) return false;
  return c.assignment.overdue || (c.assignment.due_ms !== null && c.assignment.due_ms < now);
}

/** Overdue first, then due soonest, then no due date, then by title; finished ones last (latest first). */
export function sortAssigned(list: AssignedCourse[], now = Date.now()) {
  const rank = (c: AssignedCourse) => (assignedDone(c) ? 3 : assignedOverdue(c, now) ? 0 : c.assignment.due_ms !== null ? 1 : 2);

  return [...list].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);

    if (ra !== rb) return ra - rb;
    if (ra <= 1) {
      const d = (a.assignment.due_ms ?? 0) - (b.assignment.due_ms ?? 0);

      if (d) return d;
    }

    if (ra === 3) {
      const d = (b.my?.completed_ms ?? 0) - (a.my?.completed_ms ?? 0);

      if (d) return d;
    }

    return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  });
}

// ---------------------------------------------------------------------------
// Certificate codes (XXXX-XXXX-XXXX, letters and digits; case and dashes don't matter)
// ---------------------------------------------------------------------------

export function cleanCode(raw: string) {
  const plain = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');

  return plain.length === 12 ? `${plain.slice(0, 4)}-${plain.slice(4, 8)}-${plain.slice(8)}` : plain;
}

export function looksLikeCode(raw: string) {
  const n = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').length;

  return n >= 6 && n <= 32;
}

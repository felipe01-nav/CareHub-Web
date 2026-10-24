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
export const PATHS_PATH = `${ASSIGN_PATH}/paths`;
export const pathPath = (id: string) => `${PATHS_PATH}/${encodeURIComponent(id)}`;

/** Limits the server checks too (P2-API). */
export const MAX_TARGETS = 200;
export const MAX_NOTE = 500;
export const MAX_GROUP_NAME = 80;
export const MAX_GROUP_DESCRIPTION = 500;
export const MAX_DUE_DAYS = 365;
export const MAX_PATH_TITLE = 80;
export const MAX_PATH_DESCRIPTION = 500;
export const MIN_PATH_COURSES = 2;
export const MAX_PATH_COURSES = 20;

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
  /** Due this many days after each person is added (instead of a date). */
  due_days: number | null;
  tz_minutes: number | null;
  required: boolean;
  note: string;
  calendar: boolean;
  created_ms: number;
  created_by_name: string;
  updated_ms: number;
  /** Set when this assignment comes from a learning path (change it on the Paths tab). */
  path_id: string | null;
  path_title: string | null;
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
  /** When their finish runs out; null = never. */
  expires_ms: number | null;
  expired: boolean;
  /** Marked complete by hand (null = not, or that finish isn't their latest any more). Missing on older servers: no Mark complete / Undo then. */
  marked?: MarkedComplete | null;
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
  /** Their due comes from a renewal (they finished it before and it ran out). */
  renewal: boolean;
  /** Learning paths this course reaches them through. */
  paths: string[];
  /** Also assigned to them outside a path. */
  direct: boolean;
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
  /** When the finish behind it runs out (the course needs renewing); null = never. */
  expires_ms: number | null;
  expired: boolean;
}

/** What to send for a due choice: a date (due_ms), a number of days after each person is added (due_days), or neither. */
export interface DueBody {
  due_ms: number | null;
  due_days: number | null;
  tz_minutes: number;
}

export interface AssignBody extends DueBody {
  course_id: string;
  targets: Target[];
  required: boolean;
  note?: string;
  calendar?: boolean;
  notify?: boolean;
}

export interface AssignmentChanges {
  /** Send due_ms or due_days to replace the due choice (the other one becomes empty). */
  due_ms?: number | null;
  due_days?: number | null;
  tz_minutes?: number;
  required?: boolean;
  note?: string;
  calendar?: boolean;
}

export type PathStatus = 'not_started' | 'in_progress' | 'finished';

/** A learning path: courses people take one after another (or in any order). Counts are over the distinct people on it. */
export interface LearningPath extends Counts {
  id: string;
  title: string;
  description: string;
  course_ids: string[];
  in_order: boolean;
  archived: boolean;
  created_ms: number;
  updated_ms: number;
  created_by_name: string;
  /** How many people, groups or roles it's assigned to. */
  targets: number;
}

export interface PathCourse {
  id: string;
  title: string;
  status: 'published' | 'archived';
}

/** Who a path is assigned to, with that assignment's settings and counts. */
export interface PathTarget extends Counts {
  target: NamedTarget;
  due_ms: number | null;
  due_days: number | null;
  tz_minutes: number | null;
  required: boolean;
  note: string;
  calendar: boolean;
  created_ms: number;
  updated_ms: number;
}

export interface PathStepRef {
  course_id: string;
  title: string;
}

export interface PathPerson {
  uid: string;
  name: string;
  email: string;
  status: PathStatus;
  percent: number;
  finished_courses: number;
  total_courses: number;
  next: PathStepRef | null;
  due_ms: number | null;
  overdue: boolean;
  assigned_ms: number;
}

export interface PathDetail {
  path: LearningPath;
  courses: PathCourse[];
  targets: PathTarget[];
  people: PathPerson[];
}

export interface MyPathStep extends PathStepRef {
  status: AssigneeStatus;
  percent: number;
  /** "Take them in this order": opens after the step before it is finished. */
  locked: boolean;
}

/** A path on My learning. */
export interface MyPath {
  id: string;
  title: string;
  description: string;
  in_order: boolean;
  status: PathStatus;
  percent: number;
  finished_courses: number;
  total_courses: number;
  due_ms: number | null;
  overdue: boolean;
  required: boolean;
  note: string;
  assigned_ms: number;
  next: PathStepRef | null;
  steps: MyPathStep[];
}

export interface PathBody {
  title: string;
  description?: string;
  course_ids: string[];
  in_order?: boolean;
}

export interface PathChanges {
  title?: string;
  description?: string;
  course_ids?: string[];
  in_order?: boolean;
  archived?: boolean;
}

export interface PathAssignBody extends DueBody {
  targets: Target[];
  required: boolean;
  note?: string;
  calendar?: boolean;
  notify?: boolean;
}

// ---------------------------------------------------------------------------
// Telling people about a new version, check reminders, marking someone complete by hand, path reports
// ---------------------------------------------------------------------------

export type AnnounceAction = 'tell' | 'retake';

/** Before publishing again: how many people (not you) finished an earlier version, and how many of them have it assigned. */
export interface AnnounceInfo {
  published_version: number | null;
  /** The last version people were told about (null = none yet). */
  announced_version: number | null;
  finished: number;
  assigned: number;
}

export interface AnnounceBody {
  /** The version that's live now (the one just published). */
  version: number;
  action: AnnounceAction;
  /** "Ask them to take it again" only: days the people who have it assigned get (1-365). */
  due_days?: number;
}

export interface AnnounceResult {
  /** People were already told about this version, so nothing was sent again. */
  already: boolean;
  version: number;
  action: AnnounceAction;
  /** How many people were told (or asked to take it again). */
  people: number;
  /** How many of them got a due date. */
  assigned: number;
}

/** "Remind me to check this course": when it was last updated (published) or checked, and when the next check is due. */
export interface ContentCheck {
  course_id: string;
  every_months: number;
  last_kind: 'published' | 'checked';
  last_ms: number;
  due_ms: number;
  due: boolean;
}

/** Someone marked this person complete by hand (e.g. after classroom training). */
export interface MarkedComplete {
  by_name: string;
  ms: number;
  reason: string;
}

export interface PathReportStep {
  course_id: string;
  status: AssigneeStatus;
  percent: number;
  completed_ms: number | null;
  due_ms: number | null;
  overdue: boolean;
}

export interface PathReportPerson {
  uid: string;
  name: string;
  email: string;
  status: PathStatus;
  percent: number;
  finished_courses: number;
  total_courses: number;
  due_ms: number | null;
  overdue: boolean;
  assigned_ms: number;
  /** One per course in PathReport.courses, in the same order. */
  steps: PathReportStep[];
}

/** Everyone on a path and how far they are with each of its courses (the published ones, in path order). */
export interface PathReport {
  path: { id: string; title: string; in_order: boolean; archived: boolean };
  courses: PathStepRef[];
  people: PathReportPerson[];
}

export const MAX_MARK_REASON = 200;
/** "Ask them to take it again": days people who have it assigned get, unless the author picks another number. */
export const RETAKE_DAYS = 14;

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

function daysOrNull(v: unknown) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : null;
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
    due_days: daysOrNull(o.due_days),
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
    path_id: str(o.path_id) || null,
    path_title: o.path_id ? str(o.path_title).trim() || 'Untitled path' : null,
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
    expires_ms: numOrNull(o.expires_ms),
    expired: bool(o.expired),
    ...('marked' in o ? { marked: markedOf(o.marked) } : {}),
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
    expires_ms: numOrNull(o.expires_ms),
    expired: bool(o.expired),
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
      renewal: bool(a.renewal),
      paths: arr(a.paths)
        .map((x) => str(x))
        .filter(Boolean),
      // Older servers don't say, and every assignment was direct then.
      direct: bool(a.direct, true),
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
    expires_ms: numOrNull(o.expires_ms),
    expired: bool(o.expired),
  };
}

const PATH_STATUSES: readonly PathStatus[] = ['not_started', 'in_progress', 'finished'];

function countsOf(o: Record<string, unknown>): Counts {
  return {
    people: count(o.people),
    finished: count(o.finished),
    in_progress: count(o.in_progress),
    not_started: count(o.not_started),
    overdue: count(o.overdue),
  };
}

function pathOf(raw: unknown): LearningPath {
  const o = obj(raw);

  return {
    id: str(o.id),
    title: str(o.title).trim() || 'Untitled path',
    description: str(o.description),
    course_ids: Array.from(
      new Set(
        arr(o.course_ids)
          .map((x) => str(x))
          .filter(Boolean)
      )
    ),
    in_order: bool(o.in_order, true),
    archived: bool(o.archived),
    created_ms: num(o.created_ms),
    updated_ms: num(o.updated_ms),
    created_by_name: str(o.created_by_name),
    targets: count(o.targets),
    ...countsOf(o),
  };
}

function pathCourseOf(raw: unknown): PathCourse {
  const o = obj(raw);

  return { id: str(o.id), title: str(o.title) || 'Untitled course', status: o.status === 'archived' ? 'archived' : 'published' };
}

function pathTargetOf(raw: unknown): PathTarget {
  const o = obj(raw);

  return {
    target: targetOf(o.target),
    due_ms: numOrNull(o.due_ms),
    due_days: daysOrNull(o.due_days),
    tz_minutes: numOrNull(o.tz_minutes),
    required: bool(o.required, true),
    note: str(o.note),
    calendar: bool(o.calendar),
    created_ms: num(o.created_ms),
    updated_ms: num(o.updated_ms),
    ...countsOf(o),
  };
}

function stepRefOf(raw: unknown): PathStepRef | null {
  const o = obj(raw);
  const id = str(o.course_id);

  return id ? { course_id: id, title: str(o.title) || 'Untitled course' } : null;
}

function pathPersonOf(raw: unknown): PathPerson {
  const o = obj(raw);

  return {
    uid: uidOf(o.uid),
    name: str(o.name).trim(),
    email: str(o.email).trim(),
    status: oneOf(o.status, PATH_STATUSES, 'not_started'),
    percent: clampInt(num(o.percent), 0, 100),
    finished_courses: count(o.finished_courses),
    total_courses: count(o.total_courses),
    next: stepRefOf(o.next),
    due_ms: numOrNull(o.due_ms),
    overdue: bool(o.overdue),
    assigned_ms: num(o.assigned_ms),
  };
}

function myStepOf(raw: unknown): MyPathStep | null {
  const o = obj(raw);
  const ref = stepRefOf(raw);

  if (!ref) return null;
  return {
    ...ref,
    status: o.status === 'not_started' ? 'not_started' : oneOf(o.status, LEARN_STATUSES, 'in_progress'),
    percent: clampInt(num(o.percent), 0, 100),
    locked: bool(o.locked),
  };
}

function myPathOf(raw: unknown): MyPath {
  const o = obj(raw);
  const steps = arr(o.steps)
    .map(myStepOf)
    .filter((x): x is MyPathStep => x !== null);

  return {
    id: str(o.id),
    title: str(o.title).trim() || 'Untitled path',
    description: str(o.description),
    in_order: bool(o.in_order, true),
    status: oneOf(o.status, PATH_STATUSES, 'not_started'),
    percent: clampInt(num(o.percent), 0, 100),
    finished_courses: count(o.finished_courses),
    total_courses: typeof o.total_courses === 'number' ? count(o.total_courses) : steps.length,
    due_ms: numOrNull(o.due_ms),
    overdue: bool(o.overdue),
    required: bool(o.required, true),
    note: str(o.note),
    assigned_ms: num(o.assigned_ms),
    next: stepRefOf(o.next),
    steps,
  };
}

const ANNOUNCE_ACTIONS: readonly AnnounceAction[] = ['tell', 'retake'];
const STEP_STATUSES: readonly AssigneeStatus[] = ['not_started', ...LEARN_STATUSES];

/** Null when it isn't there (not marked complete by hand). */
export function markedOf(raw: unknown): MarkedComplete | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = obj(raw);

  return { by_name: str(o.by_name).trim(), ms: num(o.ms), reason: str(o.reason).trim() };
}

function contentCheckOf(raw: unknown): ContentCheck | null {
  const o = obj(raw);
  const id = str(o.course_id);
  const due = numOrNull(o.due_ms);

  if (!id || due === null) return null;
  return {
    course_id: id,
    every_months: count(o.every_months),
    last_kind: o.last_kind === 'checked' ? 'checked' : 'published',
    last_ms: num(o.last_ms),
    due_ms: due,
    due: bool(o.due),
  };
}

function pathReportStepOf(raw: unknown, courseId: string): PathReportStep {
  const o = obj(raw);

  return {
    course_id: courseId,
    status: oneOf(o.status, STEP_STATUSES, 'not_started'),
    percent: clampInt(num(o.percent), 0, 100),
    completed_ms: numOrNull(o.completed_ms),
    due_ms: numOrNull(o.due_ms),
    overdue: bool(o.overdue),
  };
}

function pathReportPersonOf(raw: unknown, courses: PathStepRef[]): PathReportPerson {
  const o = obj(raw);
  const byCourse = new Map(arr(o.steps).map((s) => [str(obj(s).course_id), s]));

  return {
    ...pathPersonOf(o),
    // One step per course, in the report's order (a missing one counts as not started).
    steps: courses.map((c) => pathReportStepOf(byCourse.get(c.course_id), c.course_id)),
  };
}

function pathReportOf(raw: unknown): PathReport {
  const o = obj(raw);
  const p = obj(o.path);
  const id = str(p.id);

  if (!id) throw new Error(PATH_NOT_FOUND);
  const courses = arr(o.courses)
    .map(stepRefOf)
    .filter((c): c is PathStepRef => c !== null);

  return {
    path: { id, title: str(p.title).trim() || 'Untitled path', in_order: bool(p.in_order, true), archived: bool(p.archived) },
    courses,
    people: arr(o.people)
      .map((x) => pathReportPersonOf(x, courses))
      .filter((x) => x.uid),
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

  paths: (ws: string) =>
    chCall<unknown>('get', `${base(ws)}/paths`).then((d) =>
      arr(obj(d).paths)
        .map(pathOf)
        .filter((p) => p.id)
    ),
  path: (ws: string, id: string) =>
    chCall<unknown>('get', `${base(ws)}/paths/${enc(id)}`).then((d): PathDetail => {
      const o = obj(d);
      const path = pathOf(o.path);

      if (!path.id) throw new Error(PATH_NOT_FOUND);
      return {
        path,
        courses: arr(o.courses)
          .map(pathCourseOf)
          .filter((c) => c.id),
        targets: arr(o.targets).map(pathTargetOf),
        people: arr(o.people)
          .map(pathPersonOf)
          .filter((p) => p.uid),
      };
    }),
  createPath: (ws: string, body: PathBody) => chCall<unknown>('post', `${base(ws)}/paths`, body).then((d) => str(obj(d).id)),
  updatePath: (ws: string, id: string, changes: PathChanges) =>
    chCall<unknown>('put', `${base(ws)}/paths/${enc(id)}`, changes).then((d) => {
      const o = obj(d);

      return { added: count(o.added), removed: count(o.removed), assignments_removed: count(o.assignments_removed) };
    }),
  deletePath: (ws: string, id: string) =>
    chCall<unknown>('delete', `${base(ws)}/paths/${enc(id)}`).then((d) => ({ assignments_removed: count(obj(d).assignments_removed) })),
  /** The same target again updates its settings. */
  assignPath: (ws: string, id: string, body: PathAssignBody) =>
    chCall<unknown>('post', `${base(ws)}/paths/${enc(id)}/assign`, body).then((d) => {
      const o = obj(d);

      return { created: count(o.created), updated: count(o.updated), people: count(o.people) };
    }),
  unassignPath: (ws: string, id: string, targets: Target[]) =>
    chCall<unknown>('post', `${base(ws)}/paths/${enc(id)}/unassign`, { targets }).then((d) => ({ removed: count(obj(d).removed) })),
  myPaths: (ws: string) =>
    chCall<unknown>('get', `${base(ws)}/paths/mine`).then((d) =>
      arr(obj(d).paths)
        .map(myPathOf)
        .filter((p) => p.id && p.steps.length)
    ),

  // Telling people about a new version: called right after a publish (the publish never depends on it).
  announceInfo: (ws: string, courseId: string) =>
    chCall<unknown>('get', `${base(ws)}/studio/${enc(courseId)}/announce`).then((d): AnnounceInfo => {
      const o = obj(d);

      return {
        published_version: numOrNull(o.published_version),
        announced_version: numOrNull(o.announced_version),
        finished: count(o.finished),
        assigned: count(o.assigned),
      };
    }),
  /** Once per version: the same version again sends nothing (`already`). */
  announce: (ws: string, courseId: string, body: AnnounceBody) =>
    chCall<unknown>('post', `${base(ws)}/studio/${enc(courseId)}/announce`, body).then((d): AnnounceResult => {
      const o = obj(d);

      return {
        already: bool(o.already),
        version: count(o.version) || body.version,
        action: oneOf(o.action, ANNOUNCE_ACTIONS, body.action),
        people: count(o.people),
        assigned: count(o.assigned),
      };
    }),
  /** Published courses with "Remind me to check this course" switched on. */
  contentChecks: (ws: string) =>
    chCall<unknown>('get', `${base(ws)}/content-checks`).then((d) =>
      arr(obj(d).checks)
        .map(contentCheckOf)
        .filter((c): c is ContentCheck => c !== null)
    ),
  /** Resets the reminder clock without publishing. `due_ms` is null when no reminder runs (not published, or "Never"). */
  markChecked: (ws: string, courseId: string) =>
    chCall<unknown>('post', `${base(ws)}/studio/${enc(courseId)}/mark-checked`, {}).then((d) => {
      const o = obj(d);

      return { checked_ms: num(o.checked_ms, Date.now()), due_ms: numOrNull(o.due_ms) };
    }),
  markComplete: (ws: string, assignmentId: string, uid: string, reason: string) =>
    chCall<unknown>('post', `${base(ws)}/assignments/${enc(assignmentId)}/mark-complete`, reason ? { uid, reason } : { uid }).then((d) => {
      const o = obj(d);

      return { completed_ms: num(o.completed_ms, Date.now()), marked: markedOf(o.marked) };
    }),
  /** Puts back what was there before the hand-marked finish. Answers with the status and percent they're back to. */
  undoComplete: (ws: string, assignmentId: string, uid: string) =>
    chCall<unknown>('post', `${base(ws)}/assignments/${enc(assignmentId)}/undo-complete`, { uid }).then((d) => {
      const o = obj(d);

      return { status: oneOf(o.status, STEP_STATUSES, 'not_started'), percent: clampInt(num(o.percent), 0, 100) };
    }),
  pathReport: (ws: string, pathId: string) => chCall<unknown>('get', `${base(ws)}/paths/${enc(pathId)}/report`).then(pathReportOf),
};

export const CERT_NOT_FOUND = 'We couldn’t find a certificate with that code.';
export const PATH_NOT_FOUND = 'That learning path couldn’t be found. It may have been deleted.';

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

/** "21 Oct" (with the year when it isn't this year, or always with `withYear`: "21 Oct 2026"). */
export function dayMonth(ms: number, withYear = false) {
  const p = dayParts(ms);

  return `${p.d} ${MONTHS[p.m]}${withYear || p.y !== new Date().getFullYear() ? ` ${p.y}` : ''}`;
}

/** "Marked complete by Jordan Lee on 21 Oct". */
export function markedText(m: MarkedComplete) {
  return `Marked complete by ${m.by_name || 'someone'} on ${dayMonth(m.ms)}`;
}

/** "Due today", "Due tomorrow" or "Due Fri 30 Oct". */
export function dueText(dueMs: number, tz?: number | null, now = Date.now()) {
  const diff = dayNumber(dayParts(dueMs, tz)) - dayNumber(dayParts(now, tz));

  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Due tomorrow';
  return `Due ${shortDate(dueMs, tz)}`;
}

/**
 * The chip for a learner's due date: red when overdue, amber when it's today or tomorrow. Null when there's no due date.
 * `date` is the day ("Fri 30 Oct") when the label doesn't say it ("Overdue", "Due today", "Due tomorrow"), else "". Show it as
 * `{label}<span className='sr-only sm:not-sr-only'> · {date}</span>`: always in what screen readers say, seen on wider screens.
 */
export function dueChip(
  due: { due_ms: number | null; overdue?: boolean },
  done: boolean,
  now = Date.now()
): { label: string; date: string; tone: ChipTone } | null {
  if (due.due_ms === null) return null;
  const date = shortDate(due.due_ms);

  if (!done && (due.overdue || due.due_ms < now)) return { label: 'Overdue', date, tone: 'red' };
  const label = dueText(due.due_ms, null, now);
  const dated = label === `Due ${date}`;

  return { label, date: dated ? '' : date, tone: !done && !dated ? 'amber' : 'gray' };
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
// Due choice: no due date, a date, or a number of days after each person is added
// ---------------------------------------------------------------------------

export type DueMode = 'none' | 'date' | 'days';

/** What the due picker shows: the mode plus the raw date ("2026-10-30") and days ("14") text. */
export interface DueChoice {
  mode: DueMode;
  date: string;
  days: string;
}

export const DAYS_NEEDED = 'Pick a number of days between 1 and 365.';

/** "Due 14 days after they’re added". */
export function dueDaysText(days: number) {
  return `Due ${days} ${days === 1 ? 'day' : 'days'} after they’re added`;
}

/** The due part of an assignment in a list: "Due Fri 30 Oct", "Due 14 days after they’re added" or "No due date". */
export function dueSummary(a: { due_ms: number | null; due_days?: number | null; tz_minutes?: number | null }, now = Date.now()) {
  if (a.due_days) return dueDaysText(a.due_days);
  if (a.due_ms !== null) return dueText(a.due_ms, a.tz_minutes, now);
  return 'No due date';
}

/** The picker's starting point for an existing assignment (or a blank one). */
export function dueChoiceOf(a?: { due_ms: number | null; due_days?: number | null; tz_minutes?: number | null } | null): DueChoice {
  if (a?.due_days) return { mode: 'days', date: '', days: String(a.due_days) };
  if (a && a.due_ms !== null) return { mode: 'date', date: dateInputValue(a.due_ms, a.tz_minutes), days: '' };
  return { mode: 'none', date: '', days: '' };
}

/** A whole number of days 1-365 from what was typed, or null. */
export function daysValue(raw: string): number | null {
  const t = raw.trim();

  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);

  return n >= 1 && n <= MAX_DUE_DAYS ? n : null;
}

/** What to send for a due choice, or the message to show when it isn't right yet. */
export function dueBody(c: DueChoice): DueBody | string {
  const tz_minutes = tzMinutesEast();

  if (c.mode === 'days') {
    const days = daysValue(c.days);

    return days === null ? DAYS_NEEDED : { due_ms: null, due_days: days, tz_minutes };
  }

  if (c.mode === 'date') {
    if (!c.date.trim()) return 'Pick a due date, or choose “No due date”.';
    const due = dueFields(c.date);

    if (due === 'invalid') return 'That due date doesn’t look right.';
    if (due === 'past') return 'Pick a due date in the future.';
    return { due_ms: due.due_ms, due_days: null, tz_minutes };
  }

  return { due_ms: null, due_days: null, tz_minutes };
}

/** True when two choices mean the same due (ignores text left behind in the mode that isn't picked). */
export function sameDue(a: DueChoice, b: DueChoice) {
  if (a.mode !== b.mode) return false;
  if (a.mode === 'date') return a.date.trim() === b.date.trim();
  if (a.mode === 'days') return a.days.trim() === b.days.trim();
  return true;
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

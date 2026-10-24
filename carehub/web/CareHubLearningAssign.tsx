// CareHub Learning: the Assign tab (courses with their assignments, the Assign dialog, the people in an assignment,
// Groups) and the "Assigned to you" section at the top of My learning.
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { formatWhen, UUID_RE } from './CareHubCore';
import { formatMinutes, isTransientError, LEARNING_PATH, learningNotLive, lErrorText, plural, statusInfo } from './CareHubLearningApi';
import {
  aapi,
  ASSIGN_PATH,
  assignCoursePath,
  assignedDone,
  assignedOverdue,
  assignmentPath,
  canAssignCourse,
  daysValue,
  dueBody,
  dueChip,
  dueChoiceOf,
  dueSummary,
  dueText,
  GROUPS_PATH,
  groupPath,
  loadAssignOverview,
  MAX_GROUP_DESCRIPTION,
  MAX_DUE_DAYS,
  MAX_GROUP_NAME,
  MAX_NOTE,
  MAX_TARGETS,
  matchesQuery,
  PATHS_PATH,
  pathPath,
  personName,
  reachCount,
  SAFE_ID_RE,
  sameDue,
  shortDate,
  sortAssigned,
  targetKey,
  targetKindLabel,
  targetLabel,
  todayInputValue,
  whyNotAssignable,
} from './CareHubLearningAssignApi';
import { Chip, CourseCover, ProgressBar } from './CareHubLearningBlocks';
import { PEOPLE_PATH, REPORTS_PATH } from './CareHubLearningReports';
import { CareHubModal, ChCard, chInputClass, ChNote, ChPersonChip, ChSection } from './CareHubUi';

import type { CourseCard } from './CareHubLearningApi';
import type {
  AssignCourse,
  AssignedCourse,
  Assignee,
  Assignment,
  AssignmentChanges,
  DueChoice,
  Group,
  Member,
  NamedTarget,
  Role,
  TargetKind,
} from './CareHubLearningAssignApi';

export interface AssignPerms {
  /** May assign courses and change groups ("Assign courses" permission, or admin). */
  canAssign: boolean;
  canBuild: boolean;
  canReports: boolean;
}

const READ_ONLY_NOTE = 'You can look at assignments and groups here. Only people with the “Assign courses” permission can change them.';
const GROUPS_EXPLAINER = 'Groups are named lists of people. Assign a course to a group and anyone you add later gets it too.';

// ---------------------------------------------------------------------------
// Styles and small shared pieces
// ---------------------------------------------------------------------------

const ASSIGN_CSS = `
.chl-date{color-scheme:light}
:root[data-dark-mode='true'] .chl-date{color-scheme:dark}
.chl-check{accent-color:#4f46e5}
:root[data-dark-mode='true'] .chl-check{accent-color:#818cf8}
.chl-overdue{border-color:#fca5a5}
:root[data-dark-mode='true'] .chl-overdue{border-color:rgba(239,68,68,.55)}
.chl-alert{color:#b91c1c}
:root[data-dark-mode='true'] .chl-alert{color:#fca5a5}
.chl-warn{color:#b45309}
:root[data-dark-mode='true'] .chl-warn{color:#fcd34d}
`;

export function AssignStyle() {
  return <style data-carehub-learning-assign=''>{ASSIGN_CSS}</style>;
}

/** A message to show on the next screen (e.g. "Group deleted." after leaving the group's page). */
let flash = '';

/** Shows `text` on the next screen that uses useFlash (e.g. after deleting something and leaving its page). */
export function setFlash(text: string) {
  flash = text;
}

export function useFlash() {
  const [notice, setNotice] = useState(() => flash);

  useEffect(() => {
    flash = '';
  }, []);
  return [notice, setNotice] as const;
}

export function Loading() {
  return <div className='text-sm text-text-tertiary'>Loading…</div>;
}

export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
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

export function EmptyBox({ children }: { children: ReactNode }) {
  return <div className='rounded-[12px] border border-dashed border-border-primary px-4 py-6 text-center text-sm text-text-tertiary'>{children}</div>;
}

export function BackLink({ label, to, testId = 'carehub-learning-assign-back' }: { label: string; to: string; testId?: string }) {
  const navigate = useNavigate();

  return (
    <button
      type='button'
      onClick={() => navigate(to)}
      className='mb-3 rounded-[8px] px-1.5 py-1 text-sm text-text-secondary hover:bg-fill-content-hover hover:text-text-primary'
      data-testid={testId}
    >
      ← {label}
    </button>
  );
}

export function Notice({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  if (!text) return null;
  return (
    <div className='mb-4 flex items-start gap-2' role='status'>
      <div className='min-w-0 flex-1'>
        <ChNote tone='ok'>{text}</ChNote>
      </div>
      <button
        type='button'
        aria-label='Dismiss'
        onClick={onDismiss}
        className='flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-text-tertiary hover:bg-fill-content-hover'
      >
        ×
      </button>
    </div>
  );
}

export function AssignNav({ active }: { active: 'courses' | 'paths' | 'groups' }) {
  const navigate = useNavigate();
  const items = [
    { id: 'courses' as const, label: 'Courses', to: ASSIGN_PATH },
    { id: 'paths' as const, label: 'Paths', to: PATHS_PATH },
    { id: 'groups' as const, label: 'Groups', to: GROUPS_PATH },
  ];

  return (
    <nav aria-label='Assign' className='inline-flex rounded-[10px] border border-border-primary p-0.5'>
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
          data-testid={`carehub-learning-assign-nav-${t.id}`}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}

export function Stat({ label, n, alert }: { label: string; n: number; alert?: boolean }) {
  return (
    <span className='flex min-w-[52px] flex-col items-end'>
      <span className={cn('text-sm font-medium tabular-nums', n === 0 ? 'text-text-tertiary' : alert ? 'chl-alert' : 'text-text-primary')}>{n}</span>
      <span className='text-[11px] text-text-tertiary'>{label}</span>
    </span>
  );
}

export function Check({
  checked,
  onChange,
  label,
  hint,
  disabled,
  testId,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <label className={cn('flex items-start gap-2.5 text-sm', disabled ? 'opacity-60' : 'cursor-pointer')}>
      <input
        type='checkbox'
        className='chl-check mt-0.5 h-4 w-4 shrink-0'
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={testId}
      />
      <span className='min-w-0'>
        <span className='block'>{label}</span>
        {hint && <span className='block text-xs text-text-tertiary'>{hint}</span>}
      </span>
    </label>
  );
}

export function FieldLabel({ children, htmlFor, optional }: { children: ReactNode; htmlFor: string; optional?: boolean }) {
  return (
    <label htmlFor={htmlFor} className='mb-1 block text-sm font-medium'>
      {children}
      {optional && <span className='font-normal text-text-tertiary'> (optional)</span>}
    </label>
  );
}

export function List({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <ul className='m-0 list-none overflow-hidden rounded-[12px] border border-border-primary p-0' data-testid={testId}>
      {children}
    </ul>
  );
}

export function rowClass(i: number) {
  return cn('px-3 py-2.5', i > 0 && 'border-t border-border-primary');
}

/** Loads once per `load` (keep it stable with useCallback); `reload` keeps showing the old data until the new arrives. */
export function useLoad<T>(load: () => Promise<T>) {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<{ load: (() => Promise<T>) | null; data: T | null; error: unknown }>({ load: null, data: null, error: null });

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

export function TargetIcon({ kind }: { kind: TargetKind }) {
  const icon = kind === 'group' ? '👥' : kind === 'role' ? '🏷️' : kind === 'everyone' ? '🌐' : '👤';

  return (
    <span className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-fill-content-hover text-base' aria-hidden='true'>
      {icon}
    </span>
  );
}

export function DueChips({ a }: { a: Pick<Assignment, 'due_ms' | 'due_days' | 'tz_minutes' | 'required' | 'calendar' | 'overdue'> }) {
  return (
    <span className='flex flex-wrap items-center gap-1'>
      <Chip title={a.due_ms !== null && !a.due_days ? new Date(a.due_ms).toLocaleString() : undefined}>{dueSummary(a)}</Chip>
      <Chip tone={a.required ? 'purple' : 'gray'}>{a.required ? 'Required' : 'Optional'}</Chip>
      {a.calendar && (a.due_ms !== null || Boolean(a.due_days)) && (
        <Chip title='The due date is on their Care Hub calendars'>📅 On calendars</Chip>
      )}
      {a.overdue > 0 && <Chip tone='red'>{a.overdue} overdue</Chip>}
    </span>
  );
}

export function progressLine(c: { people: number; finished: number; in_progress: number; not_started: number }) {
  if (!c.people) return 'No one yet';
  return `${c.finished} of ${c.people} finished · ${c.in_progress} in progress · ${c.not_started} not started`;
}

// ---------------------------------------------------------------------------
// Pickers and dialogs
// ---------------------------------------------------------------------------

function PersonOption({ m, checked, disabled, onToggle }: { m: Member; checked: boolean; disabled?: boolean; onToggle: () => void }) {
  const name = personName(m);
  const extra = [m.email && m.email !== name ? m.email : '', m.role_name].filter(Boolean).join(' · ');

  return (
    <label className={cn('flex items-center gap-2.5 rounded-[8px] px-2 py-1.5', disabled ? 'opacity-60' : 'cursor-pointer hover:bg-fill-content-hover')}>
      <input type='checkbox' className='chl-check h-4 w-4 shrink-0' checked={checked} disabled={disabled} onChange={onToggle} />
      <span aria-hidden='true'>
        <ChPersonChip name={name} size={24} />
      </span>
      <span className='min-w-0 flex-1'>
        <span className='block truncate text-sm'>{name}</span>
        {extra && <span className='block truncate text-xs text-text-tertiary'>{extra}</span>}
      </span>
    </label>
  );
}

export function SearchInput({
  value,
  onChange,
  label,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      type='search'
      value={value}
      placeholder={label}
      aria-label={label}
      autoFocus={autoFocus}
      className={cn(chInputClass, 'w-full')}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Search + a scrolling list of checkboxes, one per member. */
function PeoplePicker({
  members,
  selected,
  onToggle,
  disabled,
  emptyText = 'No one here yet.',
  autoFocus,
}: {
  members: Member[];
  selected: Set<string>;
  onToggle: (m: Member) => void;
  disabled?: boolean;
  emptyText?: string;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState('');
  const shown = members.filter((m) => matchesQuery(`${m.name} ${m.email} ${m.role_name}`, query));

  return (
    <div className='flex flex-col gap-2'>
      <SearchInput value={query} onChange={setQuery} label='Search people' autoFocus={autoFocus} />
      <div className='max-h-[260px] overflow-y-auto rounded-[10px] border border-border-primary p-1' role='group' aria-label='People'>
        {shown.length ? (
          shown.map((m) => <PersonOption key={m.uid} m={m} checked={selected.has(m.uid)} disabled={disabled} onToggle={() => onToggle(m)} />)
        ) : (
          <div className='px-2 py-3 text-center text-sm text-text-tertiary'>{query.trim() ? `No one matches “${query.trim()}”.` : emptyText}</div>
        )}
      </div>
    </div>
  );
}

export function Confirm({
  title,
  children,
  confirmLabel,
  onConfirm,
  onClose,
  testId,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
  testId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const go = () => {
    setBusy(true);
    setError('');
    onConfirm().catch((e: unknown) => {
      setBusy(false);
      setError(lErrorText(e));
    });
  };

  return (
    <CareHubModal
      title={title}
      onClose={busy ? () => undefined : onClose}
      testId={testId}
      footer={
        <>
          <Button type='button' variant='outline' onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type='button' variant='destructive' onClick={go} loading={busy} data-testid='carehub-learning-confirm'>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-3 text-sm text-text-secondary'>
        {children}
        {error && <ChNote tone='error'>{error}</ChNote>}
      </div>
    </CareHubModal>
  );
}

/** "Due": no due date, on a date, or a number of days after each person is added. */
export function DuePicker({
  value,
  onChange,
  idPrefix,
  start,
}: {
  value: DueChoice;
  onChange: (v: DueChoice) => void;
  idPrefix: string;
  /** When changing an existing assignment: what it was (the hints then say what the change does). */
  start?: DueChoice;
}) {
  const set = (patch: Partial<DueChoice>) => onChange({ ...value, ...patch });
  const changed = Boolean(start && !sameDue(value, start));
  const days = daysValue(value.days);
  let hint = '';

  if (value.mode === 'none')
    hint = changed ? 'Removes the due date, its reminders and calendar entries.' : 'No due date — they can take it any time.';
  else if (value.mode === 'date')
    hint = changed ? 'Due by the end of that day. Reminders and calendar entries move to the new date.' : 'Due by the end of that day.';
  else if (changed && days)
    hint = `People already in it get ${plural(days, 'day')} from today. People added later get ${plural(days, 'day')} from the day they’re added.`;
  else hint = 'Counted from the day each person is added, so people who join later get the same time.';

  return (
    <fieldset className='m-0 min-w-0 border-0 p-0' data-testid='carehub-learning-due'>
      <legend className='mb-1 p-0 text-sm font-medium'>Due</legend>
      <div className='flex flex-col gap-2 text-sm'>
        <label className='flex cursor-pointer items-center gap-2'>
          <input
            type='radio'
            className='chl-check'
            name={`${idPrefix}-due`}
            checked={value.mode === 'none'}
            onChange={() => set({ mode: 'none' })}
            data-testid='carehub-learning-due-none'
          />
          No due date
        </label>
        <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
          <label className='flex cursor-pointer items-center gap-2'>
            <input
              type='radio'
              className='chl-check'
              name={`${idPrefix}-due`}
              checked={value.mode === 'date'}
              onChange={() => set({ mode: 'date' })}
              data-testid='carehub-learning-due-on-date'
            />
            On a date
          </label>
          <input
            id={`${idPrefix}-date`}
            type='date'
            min={todayInputValue()}
            value={value.date}
            aria-label='Due date'
            onClick={() => value.mode !== 'date' && set({ mode: 'date' })}
            onChange={(e) => set({ mode: 'date', date: e.target.value })}
            className={cn(chInputClass, 'chl-date w-[170px]', value.mode !== 'date' && 'opacity-60')}
            data-testid='carehub-learning-assign-due'
          />
        </div>
        <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
          <input
            id={`${idPrefix}-days-mode`}
            type='radio'
            className='chl-check'
            name={`${idPrefix}-due`}
            checked={value.mode === 'days'}
            onChange={() => set({ mode: 'days', days: value.days.trim() ? value.days : '14' })}
            aria-label='A number of days after they’re added'
            data-testid='carehub-learning-due-after-days'
          />
          <input
            type='number'
            inputMode='numeric'
            min={1}
            max={MAX_DUE_DAYS}
            step={1}
            value={value.days}
            placeholder='14'
            aria-label='Number of days after they’re added'
            onClick={() => value.mode !== 'days' && set({ mode: 'days' })}
            onChange={(e) => set({ mode: 'days', days: e.target.value })}
            className={cn(chInputClass, 'w-[76px]', value.mode !== 'days' && 'opacity-60')}
            data-testid='carehub-learning-due-days'
          />
          <label htmlFor={`${idPrefix}-days-mode`} className='cursor-pointer'>
            days after they’re added
          </label>
        </div>
      </div>
      <div className='mt-1 text-xs text-text-tertiary'>{hint}</div>
    </fieldset>
  );
}

/** Required / optional radios. */
export function RequiredPicker({ value, onChange, name }: { value: boolean; onChange: (v: boolean) => void; name: string }) {
  return (
    <fieldset className='m-0 border-0 p-0'>
      <legend className='mb-1 p-0 text-sm font-medium'>Required or optional?</legend>
      <div className='flex flex-col gap-1.5 text-sm'>
        <label className='flex cursor-pointer items-center gap-2'>
          <input type='radio' className='chl-check' name={name} checked={value} onChange={() => onChange(true)} />
          Required
        </label>
        <label className='flex cursor-pointer items-center gap-2'>
          <input type='radio' className='chl-check' name={name} checked={!value} onChange={() => onChange(false)} />
          Optional
        </label>
      </div>
    </fieldset>
  );
}

interface PickData {
  members: Member[];
  roles: Role[];
  groups: Group[];
}

const KIND_TABS: { id: TargetKind; label: string }[] = [
  { id: 'person', label: 'People' },
  { id: 'group', label: 'Groups' },
  { id: 'role', label: 'Roles' },
  { id: 'everyone', label: 'Everyone' },
];

const EVERYONE: NamedTarget = { kind: 'everyone', id: '', name: 'Everyone' };

/** Assign one course (or pick one), or a learning path, to people, groups, roles or everyone, with a due date. */
export function AssignDialog({
  workspaceId,
  course,
  courses,
  path,
  initialTargets,
  onClose,
  onAssigned,
}: {
  workspaceId: string;
  /** The course to assign; leave out to pick one from `courses`. */
  course?: AssignCourse;
  courses?: AssignCourse[];
  /** Assign this learning path instead of a course. */
  path?: { id: string; title: string };
  initialTargets?: NamedTarget[];
  onClose: () => void;
  onAssigned: (message: string) => void;
}) {
  const choices = useMemo(() => (courses || []).filter(canAssignCourse), [courses]);
  const [courseId, setCourseId] = useState(course?.id || '');
  const [targets, setTargets] = useState<NamedTarget[]>(initialTargets || []);
  const [tab, setTab] = useState<TargetKind>(initialTargets?.[0]?.kind === 'group' ? 'group' : 'person');
  const [data, setData] = useState<PickData | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [due, setDue] = useState<DueChoice>(() => dueChoiceOf(null));
  const [required, setRequired] = useState(true);
  const [note, setNote] = useState('');
  const [calendar, setCalendar] = useState(true);
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tries, setTries] = useState(0);

  useEffect(() => {
    let alive = true;

    setLoadError(null);
    Promise.all([aapi.members(workspaceId), aapi.groups(workspaceId)]).then(
      ([m, groups]) => {
        if (alive) setData({ members: m.members, roles: m.roles, groups });
      },
      (e: unknown) => {
        if (alive) setLoadError(e || new Error('Something went wrong. Please try again.'));
      }
    );
    return () => {
      alive = false;
    };
  }, [workspaceId, tries]);

  const picked = course || choices.find((c) => c.id === courseId) || null;
  const everyone = targets.some((t) => t.kind === 'everyone');
  const has = (kind: TargetKind, id: string) => targets.some((t) => t.kind === kind && t.id === id);
  const toggle = (t: NamedTarget) =>
    setTargets((list) => (list.some((x) => targetKey(x) === targetKey(t)) ? list.filter((x) => targetKey(x) !== targetKey(t)) : [...list, t]));
  const reach = data ? reachCount(targets, data.members, data.groups) : null;
  const countOf = (kind: TargetKind) => targets.filter((t) => t.kind === kind).length;
  const grows = targets.some((t) => t.kind !== 'person');
  const hasDue = due.mode !== 'none';
  const title = path?.title || picked?.title || 'a course';

  const submit = () => {
    if (!path && !picked) return setError('Pick a course to assign.');
    if (!path && picked && !canAssignCourse(picked)) return setError(whyNotAssignable(picked));
    if (!targets.length) return setError('Pick at least one person, group or role.');
    if (targets.length > MAX_TARGETS) return setError(`You can pick up to ${MAX_TARGETS} at once. Try a group or a role instead.`);
    const dueSend = dueBody(due);

    if (typeof dueSend === 'string') return setError(dueSend);
    setBusy(true);
    setError('');
    const common = {
      targets: targets.map((t) => ({ kind: t.kind, id: t.id })),
      ...dueSend,
      required,
      ...(note.trim() ? { note: note.trim() } : {}),
      calendar: hasDue && calendar,
      notify,
    };
    const sent = path
      ? aapi.assignPath(workspaceId, path.id, common)
      : aapi.assign(workspaceId, { course_id: picked ? picked.id : '', ...common });

    sent.then(
      (res) => {
        const more = res.updated ? ` ${plural(res.updated, 'earlier assignment')} updated.` : '';

        onAssigned(`Assigned “${title}” to ${plural(res.people, 'person', 'people')}.${more}`);
      },
      (e: unknown) => {
        setBusy(false);
        setError(lErrorText(e));
      }
    );
    return undefined;
  };

  let pickList: ReactNode = null;

  if (loadError) {
    pickList = <LoadError error={loadError} onRetry={() => setTries((n) => n + 1)} />;
  } else if (!data) {
    pickList = <Loading />;
  } else if (tab === 'everyone') {
    pickList = (
      <div className='rounded-[10px] border border-border-primary p-3'>
        <Check
          checked={everyone}
          onChange={(v) => setTargets(v ? [EVERYONE] : [])}
          label='Everyone in the workspace'
          hint={`${plural(data.members.length, 'person', 'people')} now, and anyone who joins later.${
            targets.length && !everyone ? ` This replaces the ${targets.length} you picked.` : ''
          }`}
          testId='carehub-learning-assign-everyone'
        />
      </div>
    );
  } else if (everyone) {
    pickList = <ChNote>Everyone is picked, so there’s no need to pick anyone else. Untick Everyone to choose instead.</ChNote>;
  } else if (tab === 'person') {
    pickList = (
      <PeoplePicker
        members={data.members}
        selected={new Set(targets.filter((t) => t.kind === 'person').map((t) => t.id))}
        onToggle={(m) => toggle({ kind: 'person', id: m.uid, name: personName(m) })}
        autoFocus
      />
    );
  } else if (tab === 'group') {
    pickList = data.groups.length ? (
      <div className='max-h-[260px] overflow-y-auto rounded-[10px] border border-border-primary p-1' role='group' aria-label='Groups'>
        {data.groups.map((g) => (
          <label key={g.id} className='flex cursor-pointer items-center gap-2.5 rounded-[8px] px-2 py-1.5 hover:bg-fill-content-hover'>
            <input
              type='checkbox'
              className='chl-check h-4 w-4 shrink-0'
              checked={has('group', g.id)}
              onChange={() => toggle({ kind: 'group', id: g.id, name: g.name })}
            />
            <span className='min-w-0 flex-1'>
              <span className='block truncate text-sm'>{g.name}</span>
              <span className='block truncate text-xs text-text-tertiary'>
                {plural(g.members, 'person', 'people')}
                {g.description.trim() ? ` · ${g.description.trim()}` : ''}
              </span>
            </span>
          </label>
        ))}
      </div>
    ) : (
      <EmptyBox>No groups yet. Make one on the Groups page, then assign courses to it.</EmptyBox>
    );
  } else {
    pickList = data.roles.length ? (
      <div className='max-h-[260px] overflow-y-auto rounded-[10px] border border-border-primary p-1' role='group' aria-label='Roles'>
        {data.roles.map((r) => (
          <label key={r.id} className='flex cursor-pointer items-center gap-2.5 rounded-[8px] px-2 py-1.5 hover:bg-fill-content-hover'>
            <input
              type='checkbox'
              className='chl-check h-4 w-4 shrink-0'
              checked={has('role', r.id)}
              onChange={() => toggle({ kind: 'role', id: r.id, name: r.name })}
            />
            <span className='min-w-0 flex-1 truncate text-sm'>{r.name}</span>
            <span className='shrink-0 text-xs text-text-tertiary'>{plural(r.members, 'person', 'people')}</span>
          </label>
        ))}
      </div>
    ) : (
      <EmptyBox>No roles to pick from.</EmptyBox>
    );
  }

  return (
    <CareHubModal
      title={path ? `Assign “${path.title}”` : course ? `Assign “${course.title}”` : 'Assign a course'}
      wide
      onClose={busy ? () => undefined : onClose}
      testId='carehub-learning-assign-dialog'
      footer={
        <>
          <Button type='button' variant='outline' onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type='button' onClick={submit} loading={busy} disabled={!targets.length} data-testid='carehub-learning-assign-submit'>
            {reach !== null && targets.length ? `Assign to ${plural(reach, 'person', 'people')}` : 'Assign'}
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-5'>
        {!course && !path && (
          <div>
            <FieldLabel htmlFor='chl-assign-course'>Course</FieldLabel>
            {choices.length ? (
              <select
                id='chl-assign-course'
                className={cn(chInputClass, 'w-full pr-7')}
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
              >
                <option value=''>Pick a course…</option>
                {choices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            ) : (
              <ChNote>There are no published courses to assign yet.</ChNote>
            )}
          </div>
        )}
        {!path && picked && !canAssignCourse(picked) && <ChNote tone='warn'>{whyNotAssignable(picked)}</ChNote>}

        <div>
          <div className='mb-2 text-sm font-medium'>Who should take it?</div>
          <div className='mb-3 flex flex-wrap gap-1.5' role='group' aria-label='Pick from'>
            {KIND_TABS.map((t) => {
              const n = countOf(t.id);

              return (
                <button
                  key={t.id}
                  type='button'
                  aria-pressed={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-sm',
                    tab === t.id ? 'border-border-theme-thick font-medium text-text-primary' : 'border-border-primary text-text-secondary hover:bg-fill-content-hover'
                  )}
                  data-testid={`carehub-learning-assign-tab-${t.id}`}
                >
                  {t.label}
                  {n > 0 && t.id !== 'everyone' && <span className='ml-1 tabular-nums text-text-tertiary'>{n}</span>}
                </button>
              );
            })}
          </div>
          {pickList}
          {targets.length > 0 && (
            <div className='mt-3 flex flex-wrap items-center gap-1.5' aria-label='Picked'>
              {targets.map((t) => (
                <span key={targetKey(t)} className='inline-flex max-w-full items-center gap-1 rounded-full bg-fill-content-hover py-0.5 pl-2.5 pr-1 text-xs'>
                  <span className='truncate'>
                    {targetLabel(t)}
                    {t.kind === 'group' || t.kind === 'role' ? <span className='text-text-tertiary'> · {targetKindLabel(t.kind).toLowerCase()}</span> : null}
                  </span>
                  <button
                    type='button'
                    aria-label={`Remove ${targetLabel(t)}`}
                    onClick={() => toggle(t)}
                    className='flex h-5 w-5 items-center justify-center rounded-full text-text-tertiary hover:bg-fill-content-hover hover:text-text-primary'
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          {reach !== null && targets.length > 0 && (
            <div className='mt-2 text-sm font-medium' data-testid='carehub-learning-assign-reach'>
              This reaches {plural(reach, 'person', 'people')}
              {reach === 0 ? ' right now' : ''}.
              {grows && <span className='font-normal text-text-tertiary'> People who join later get it too.</span>}
            </div>
          )}
        </div>

        <div className='grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'>
          <DuePicker value={due} onChange={setDue} idPrefix='chl-assign' />
          <RequiredPicker value={required} onChange={setRequired} name='chl-assign-required' />
        </div>

        <div>
          <FieldLabel htmlFor='chl-assign-note' optional>
            Note for them
          </FieldLabel>
          <textarea
            id='chl-assign-note'
            rows={2}
            maxLength={MAX_NOTE}
            value={note}
            placeholder={`Why it matters or when to do it, e.g. “Please finish before your next shift.”`}
            onChange={(e) => setNote(e.target.value)}
            className={cn(chInputClass, 'w-full resize-y')}
          />
          {note.length > MAX_NOTE - 100 && (
            <div className='mt-0.5 text-right text-[11px] text-text-tertiary'>
              {note.length}/{MAX_NOTE}
            </div>
          )}
        </div>

        <div className='flex flex-col gap-2.5'>
          <Check
            checked={calendar && hasDue}
            onChange={setCalendar}
            disabled={!hasDue}
            label='Add the due date to their Care Hub calendar'
            hint={hasDue ? undefined : 'Pick a due date or a number of days first.'}
            testId='carehub-learning-assign-calendar'
          />
          <Check
            checked={notify}
            onChange={setNotify}
            label='Send them a Care Hub message'
            hint={`They get a message about “${title}” with a link to start.`}
            testId='carehub-learning-assign-notify'
          />
        </div>

        {error && <ChNote tone='error'>{error}</ChNote>}
      </div>
    </CareHubModal>
  );
}

/** Change an assignment's due date, required/optional, note and calendar setting. */
function EditAssignmentDialog({
  workspaceId,
  assignment: a,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  assignment: Assignment;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [start] = useState(() => dueChoiceOf(a));
  const [due, setDue] = useState(start);
  const [required, setRequired] = useState(a.required);
  const [note, setNote] = useState(a.note);
  const [calendar, setCalendar] = useState(a.calendar);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const hasDue = due.mode !== 'none';

  const save = () => {
    const changes: AssignmentChanges = {};

    if (!sameDue(due, start)) {
      const dueSend = dueBody(due);

      if (typeof dueSend === 'string') return setError(dueSend);
      // The due choice is replaced whole: send the one that's picked (or due_ms: null for no due date).
      if (dueSend.due_days !== null) changes.due_days = dueSend.due_days;
      else changes.due_ms = dueSend.due_ms;
      changes.tz_minutes = dueSend.tz_minutes;
    }

    if (required !== a.required) changes.required = required;
    if (note.trim() !== a.note.trim()) changes.note = note.trim();
    if (calendar !== a.calendar) changes.calendar = calendar;
    if (!Object.keys(changes).length) {
      onClose();
      return undefined;
    }

    setBusy(true);
    setError('');
    aapi.updateAssignment(workspaceId, a.id, changes).then(
      () => onSaved('Saved. Everyone in this assignment sees the change.'),
      (e: unknown) => {
        setBusy(false);
        setError(lErrorText(e));
      }
    );
    return undefined;
  };

  return (
    <CareHubModal
      title={`Edit — ${targetLabel(a.target)}`}
      onClose={busy ? () => undefined : onClose}
      testId='carehub-learning-assignment-edit'
      footer={
        <>
          <Button type='button' variant='outline' onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type='button' onClick={save} loading={busy} data-testid='carehub-learning-assignment-save'>
            Save
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-4'>
        <div className='text-sm text-text-secondary'>“{a.course_title}”</div>
        <DuePicker value={due} onChange={setDue} idPrefix='chl-edit' start={start} />
        <RequiredPicker value={required} onChange={setRequired} name='chl-edit-required' />
        <div>
          <FieldLabel htmlFor='chl-edit-note' optional>
            Note for them
          </FieldLabel>
          <textarea
            id='chl-edit-note'
            rows={2}
            maxLength={MAX_NOTE}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={cn(chInputClass, 'w-full resize-y')}
          />
        </div>
        <Check
          checked={calendar && hasDue}
          onChange={setCalendar}
          disabled={!hasDue}
          label='Add the due date to their Care Hub calendar'
          hint={hasDue ? undefined : 'Pick a due date or a number of days first.'}
        />
        {error && <ChNote tone='error'>{error}</ChNote>}
      </div>
    </CareHubModal>
  );
}

function removeText(a: Assignment) {
  const who = a.target.kind === 'everyone' ? 'everyone' : targetLabel(a.target);

  return `“${a.course_title}” will no longer be assigned to ${who}${a.people ? ` (${plural(a.people, 'person', 'people')})` : ''}.`;
}

function RemoveAssignmentDialog({
  workspaceId,
  assignment,
  onClose,
  onRemoved,
}: {
  workspaceId: string;
  assignment: Assignment;
  onClose: () => void;
  onRemoved: (message: string) => void;
}) {
  return (
    <Confirm
      title='Remove this assignment?'
      confirmLabel='Remove'
      testId='carehub-learning-assignment-remove'
      onClose={onClose}
      onConfirm={() =>
        aapi.removeAssignment(workspaceId, assignment.id).then(() => onRemoved(`Removed. “${assignment.course_title}” is no longer assigned to ${targetLabel(assignment.target)}.`))
      }
    >
      <p className='m-0'>{removeText(assignment)}</p>
      <p className='m-0'>The progress people made is kept, and the due date comes off their calendars.</p>
    </Confirm>
  );
}

// ---------------------------------------------------------------------------
// Assign tab: courses
// ---------------------------------------------------------------------------

function CourseRow({ c, index, canAssign, onOpen, onAssign }: { c: AssignCourse; index: number; canAssign: boolean; onOpen: () => void; onAssign: () => void }) {
  return (
    <li className={cn(rowClass(index), 'flex flex-wrap items-center gap-x-4 gap-y-2')} data-testid='carehub-learning-assign-course'>
      <button type='button' onClick={onOpen} className='min-w-[180px] flex-1 text-left'>
        <span className='block break-words text-sm font-medium hover:underline'>{c.title}</span>
        <span className='mt-0.5 flex flex-wrap items-center gap-1'>
          {c.status === 'archived' && <Chip>Archived</Chip>}
          {c.status === 'published' && !c.catalog && <Chip title='Only people it’s assigned to (or who have the link) can find it'>Not in the catalog</Chip>}
          {c.status === 'published' && !c.assigned && <span className='text-xs text-text-tertiary'>Not assigned yet</span>}
        </span>
      </button>
      <span className='flex items-center gap-3'>
        <Stat label='Assigned' n={c.assigned} />
        <Stat label='Finished' n={c.finished} />
        <Stat label='Overdue' n={c.overdue} alert />
      </span>
      {canAssign && (
        <span className='w-[76px] shrink-0 text-right'>
          {canAssignCourse(c) ? (
            <Button type='button' size='sm' variant='outline' onClick={onAssign} data-testid='carehub-learning-assign-open'>
              Assign
            </Button>
          ) : (
            <span className='text-xs text-text-tertiary' title={whyNotAssignable(c)}>
              Can’t assign
            </span>
          )}
        </span>
      )}
    </li>
  );
}

function AssignCoursesView({ workspaceId, perms }: { workspaceId: string; perms: AssignPerms }) {
  const navigate = useNavigate();
  const { canBuild, canReports, canAssign } = perms;
  const load = useCallback(() => loadAssignOverview(workspaceId, { canBuild, canReports }), [workspaceId, canBuild, canReports]);
  const { data, error, reload } = useLoad(load);
  const [query, setQuery] = useState('');
  const [assigning, setAssigning] = useState<AssignCourse | null>(null);
  const [notice, setNotice] = useFlash();

  if (error && !data) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Loading />;

  const shown = data.courses.filter((c) => matchesQuery(c.title, query));
  const live = shown.filter((c) => c.status === 'published');
  const archived = shown.filter((c) => c.status === 'archived');
  const anyCourses = data.courses.length > 0;

  return (
    <>
      <div className='mb-4 flex flex-wrap items-center gap-2'>
        <AssignNav active='courses' />
        <div className='flex-1' />
        {data.courses.length > 6 && (
          <div className='w-full sm:w-[240px]'>
            <SearchInput value={query} onChange={setQuery} label='Search courses' />
          </div>
        )}
      </div>
      {!canAssign && (
        <div className='mb-4'>
          <ChNote>{READ_ONLY_NOTE}</ChNote>
        </div>
      )}
      <Notice text={notice} onDismiss={() => setNotice('')} />
      {error ? (
        <div className='mb-4'>
          <ChNote tone='error'>Couldn’t refresh: {lErrorText(error)}</ChNote>
        </div>
      ) : null}

      {!anyCourses ? (
        <EmptyBox>
          No published courses yet. Courses show up here once they’re published in Studio.
          {canBuild && (
            <div className='mt-3'>
              <Button type='button' size='sm' variant='outline' onClick={() => navigate(`${LEARNING_PATH}/studio`)}>
                Go to Studio
              </Button>
            </div>
          )}
        </EmptyBox>
      ) : (
        <>
          <ChSection
            title='Courses'
            hint={
              data.exact
                ? 'Assign a course to people, groups, roles or everyone. Only published courses can be assigned.'
                : 'Assign a course to people, groups, roles or everyone. Counts are added up per assignment, so someone assigned twice counts twice.'
            }
          >
            {live.length ? (
              <List testId='carehub-learning-assign-courses'>
                {live.map((c, i) => (
                  <CourseRow
                    key={c.id}
                    c={c}
                    index={i}
                    canAssign={canAssign}
                    onOpen={() => navigate(assignCoursePath(c.id))}
                    onAssign={() => setAssigning(c)}
                  />
                ))}
              </List>
            ) : (
              <EmptyBox>{query.trim() ? `No courses match “${query.trim()}”.` : 'No published courses right now.'}</EmptyBox>
            )}
          </ChSection>
          {archived.length > 0 && (
            <ChSection title='Archived' hint='These can’t be assigned until they’re unarchived in Studio. Their assignments are still here.'>
              <List>
                {archived.map((c, i) => (
                  <CourseRow key={c.id} c={c} index={i} canAssign={canAssign} onOpen={() => navigate(assignCoursePath(c.id))} onAssign={() => undefined} />
                ))}
              </List>
            </ChSection>
          )}
        </>
      )}

      {assigning && (
        <AssignDialog
          workspaceId={workspaceId}
          course={assigning}
          onClose={() => setAssigning(null)}
          onAssigned={(text) => {
            setAssigning(null);
            setNotice(text);
            reload();
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// One course: its assignments
// ---------------------------------------------------------------------------

/** "Part of the “Induction” path": a path's assignment is changed on its page, not here. */
function PartOfPath({ a }: { a: Pick<Assignment, 'path_id' | 'path_title'> }) {
  const navigate = useNavigate();

  if (!a.path_id) return null;
  const id = a.path_id;

  return (
    <button
      type='button'
      className='text-left text-xs text-text-secondary underline hover:text-text-primary'
      onClick={(e) => {
        e.stopPropagation();
        navigate(pathPath(id));
      }}
      title='Change it on the Paths tab'
      data-testid='carehub-learning-part-of-path'
    >
      Part of the “{a.path_title}” path
    </button>
  );
}

function AssignmentRow({
  a,
  index,
  canAssign,
  onOpen,
  onEdit,
  onRemove,
}: {
  a: Assignment;
  index: number;
  canAssign: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const by = [a.created_by_name ? `Assigned by ${a.created_by_name}` : 'Assigned', a.created_ms ? shortDate(a.created_ms) : ''].filter(Boolean).join(' · ');

  return (
    <li className={cn(rowClass(index), 'flex flex-wrap items-start gap-x-3 gap-y-2')} data-testid='carehub-learning-assignment'>
      <TargetIcon kind={a.target.kind} />
      <button type='button' onClick={onOpen} className='min-w-[200px] flex-1 text-left'>
        <span className='block text-sm'>
          <span className='font-medium hover:underline'>{targetLabel(a.target)}</span>
          <span className='text-xs text-text-tertiary'> · {targetKindLabel(a.target.kind)}</span>
        </span>
        <span className='mt-1 block'>
          <DueChips a={a} />
        </span>
        <span className='mt-1 block text-xs text-text-secondary'>{progressLine(a)}</span>
        {a.note.trim() && (
          <span className='mt-0.5 block truncate text-xs italic text-text-tertiary' title={a.note}>
            “{a.note.trim()}”
          </span>
        )}
        <span className='mt-0.5 block text-[11px] text-text-tertiary'>{by}</span>
      </button>
      {a.path_id ? (
        <span className='max-w-[220px] shrink-0 pt-1'>
          <PartOfPath a={a} />
        </span>
      ) : (
        canAssign && (
          <span className='flex shrink-0 gap-1.5'>
            <Button type='button' size='sm' variant='outline' onClick={onEdit} data-testid='carehub-learning-assignment-edit-open'>
              Edit
            </Button>
            <Button type='button' size='sm' variant='ghost' onClick={onRemove} data-testid='carehub-learning-assignment-remove-open'>
              Remove
            </Button>
          </span>
        )
      )}
    </li>
  );
}

function CourseAssignmentsView({ workspaceId, courseId, perms }: { workspaceId: string; courseId: string; perms: AssignPerms }) {
  const navigate = useNavigate();
  const { canBuild, canReports, canAssign } = perms;
  const load = useCallback(() => loadAssignOverview(workspaceId, { canBuild, canReports, courseId }), [workspaceId, canBuild, canReports, courseId]);
  const { data, error, reload } = useLoad(load);
  const [assigning, setAssigning] = useState(false);
  const [editing, setEditing] = useState<Assignment | null>(null);
  const [removing, setRemoving] = useState<Assignment | null>(null);
  const [notice, setNotice] = useFlash();

  if (error && !data) {
    return (
      <>
        <BackLink label='All courses' to={ASSIGN_PATH} />
        <LoadError error={error} onRetry={reload} />
      </>
    );
  }

  if (!data) return <Loading />;
  const list = data.assignments.filter((a) => a.course_id === courseId);
  const course = data.courses.find((c) => c.id === courseId) || null;

  if (!course && !list.length) {
    return (
      <>
        <BackLink label='All courses' to={ASSIGN_PATH} />
        <ChNote>This course can’t be assigned. It may not be published yet, or it was deleted.</ChNote>
      </>
    );
  }

  const title = course?.title || list[0]?.course_title || 'Untitled course';
  const status = course?.status || 'published';
  const assignable = canAssignCourse({ status });
  const done = (text: string) => {
    setAssigning(false);
    setEditing(null);
    setRemoving(null);
    setNotice(text);
    reload();
  };

  return (
    <>
      <BackLink label='All courses' to={ASSIGN_PATH} />
      <div className='mb-4 flex flex-wrap items-start gap-3'>
        <div className='min-w-0 flex-1'>
          <h2 className='m-0 break-words text-xl font-semibold'>{title}</h2>
          <div className='mt-1 flex flex-wrap items-center gap-1'>
            {status === 'archived' && <Chip>Archived</Chip>}
            {course && status === 'published' && !course.catalog && <Chip>Not in the catalog</Chip>}
          </div>
        </div>
        <div className='flex flex-wrap gap-2'>
          {canReports && (
            <Button type='button' variant='outline' onClick={() => navigate(`${REPORTS_PATH}/course/${encodeURIComponent(courseId)}`)}>
              See report
            </Button>
          )}
          {canAssign && assignable && (
            <Button type='button' onClick={() => setAssigning(true)} data-testid='carehub-learning-assign-open'>
              Assign
            </Button>
          )}
        </div>
      </div>
      {!canAssign && (
        <div className='mb-4'>
          <ChNote>{READ_ONLY_NOTE}</ChNote>
        </div>
      )}
      {canAssign && !assignable && (
        <div className='mb-4'>
          <ChNote tone='warn'>{whyNotAssignable({ status })}</ChNote>
        </div>
      )}
      <Notice text={notice} onDismiss={() => setNotice('')} />
      {error ? (
        <div className='mb-4'>
          <ChNote tone='error'>Couldn’t refresh: {lErrorText(error)}</ChNote>
        </div>
      ) : null}
      {course && (
        <div className='mb-6 flex flex-wrap gap-3'>
          <ChCard label='Assigned' value={course.assigned} hint={data.exact ? 'people' : 'added up per assignment'} />
          <ChCard label='Finished' value={course.finished} />
          <ChCard label='In progress' value={course.in_progress} />
          <ChCard label='Not started' value={course.not_started} />
          <ChCard label='Overdue' value={<span className={course.overdue ? 'chl-alert' : undefined}>{course.overdue}</span>} />
        </div>
      )}
      <ChSection title='Assignments' hint={list.length ? plural(list.length, 'assignment') : undefined}>
        {list.length ? (
          <List testId='carehub-learning-assignments'>
            {list.map((a, i) => (
              <AssignmentRow
                key={a.id}
                a={a}
                index={i}
                canAssign={canAssign}
                onOpen={() => navigate(assignmentPath(a.id))}
                onEdit={() => setEditing(a)}
                onRemove={() => setRemoving(a)}
              />
            ))}
          </List>
        ) : (
          <EmptyBox>
            Not assigned to anyone yet.
            {canAssign && assignable && (
              <div className='mt-3'>
                <Button type='button' size='sm' onClick={() => setAssigning(true)}>
                  Assign it
                </Button>
              </div>
            )}
          </EmptyBox>
        )}
      </ChSection>

      {assigning && course && <AssignDialog workspaceId={workspaceId} course={course} onClose={() => setAssigning(false)} onAssigned={done} />}
      {assigning && !course && (
        <AssignDialog
          workspaceId={workspaceId}
          course={{ id: courseId, title, status, catalog: true, version: 1, assigned: 0, finished: 0, in_progress: 0, not_started: 0, overdue: 0 }}
          onClose={() => setAssigning(false)}
          onAssigned={done}
        />
      )}
      {editing && <EditAssignmentDialog workspaceId={workspaceId} assignment={editing} onClose={() => setEditing(null)} onSaved={done} />}
      {removing && <RemoveAssignmentDialog workspaceId={workspaceId} assignment={removing} onClose={() => setRemoving(null)} onRemoved={done} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// One assignment: the people in it
// ---------------------------------------------------------------------------

type PeopleFilter = 'all' | 'not_started' | 'in_progress' | 'finished' | 'overdue';

function isFinishedStatus(s: Assignee['status']) {
  return s === 'completed' || s === 'passed';
}

function assigneeChip(p: Assignee) {
  if (p.status === 'not_started') return { label: 'Not started', tone: 'gray' as const };
  return statusInfo({ status: p.status, awaiting_ack: false });
}

function inFilter(p: Assignee, f: PeopleFilter) {
  if (f === 'all') return true;
  if (f === 'overdue') return p.overdue;
  if (f === 'finished') return isFinishedStatus(p.status);
  if (f === 'not_started') return p.status === 'not_started';
  return p.status === 'in_progress' || p.status === 'failed';
}

function peopleRank(p: Assignee) {
  if (p.overdue) return 0;
  if (p.status === 'not_started') return 1;
  if (!isFinishedStatus(p.status)) return 2;
  return 3;
}

function AssigneeRow({ p, index, canReports }: { p: Assignee; index: number; canReports: boolean }) {
  const navigate = useNavigate();
  const name = personName(p);
  const chip = assigneeChip(p);
  const when = p.completed_ms ? `Finished ${shortDate(p.completed_ms)}` : p.due_ms !== null ? dueText(p.due_ms) : 'No due date';
  const nameEl = (
    <>
      <span className='block truncate text-sm font-medium'>{name}</span>
      {p.email && p.email !== name && <span className='block truncate text-xs text-text-tertiary'>{p.email}</span>}
    </>
  );

  return (
    <li className={cn(rowClass(index), 'flex flex-wrap items-center gap-x-3 gap-y-1.5')} data-testid='carehub-learning-assignee'>
      <span aria-hidden='true'>
        <ChPersonChip name={name} size={28} />
      </span>
      {canReports ? (
        <button
          type='button'
          className='min-w-[150px] flex-1 text-left hover:underline'
          onClick={() => navigate(`${PEOPLE_PATH}/${encodeURIComponent(p.uid)}`)}
          title={`See ${name}’s courses`}
        >
          {nameEl}
        </button>
      ) : (
        <span className='min-w-[150px] flex-1'>{nameEl}</span>
      )}
      <span className='flex flex-wrap items-center gap-1'>
        <Chip tone={chip.tone}>{chip.label}</Chip>
        {p.expired && (
          <Chip tone='amber' title={p.expires_ms !== null ? `Expired on ${shortDate(p.expires_ms)}` : undefined}>
            Expired
          </Chip>
        )}
        {p.overdue && <Chip tone='red'>Overdue</Chip>}
      </span>
      <span className='flex w-[108px] shrink-0 items-center gap-2'>
        <ProgressBar percent={p.percent} className='w-14 shrink-0' label={`${name} progress`} />
        <span className='text-xs tabular-nums text-text-secondary'>{p.percent}%</span>
      </span>
      <span className='w-[124px] shrink-0 text-right text-xs text-text-tertiary'>{when}</span>
    </li>
  );
}

function AssignmentDetailView({ workspaceId, assignmentId, perms }: { workspaceId: string; assignmentId: string; perms: AssignPerms }) {
  const navigate = useNavigate();
  const load = useCallback(() => aapi.assignment(workspaceId, assignmentId), [workspaceId, assignmentId]);
  const { data, error, reload } = useLoad(load);
  const [filter, setFilter] = useState<PeopleFilter>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [notice, setNotice] = useFlash();

  const people = useMemo(
    () => [...(data?.people || [])].sort((a, b) => peopleRank(a) - peopleRank(b) || personName(a).localeCompare(personName(b))),
    [data]
  );

  if (error && !data) {
    return (
      <>
        <BackLink label='All courses' to={ASSIGN_PATH} />
        <LoadError error={error} onRetry={reload} />
      </>
    );
  }

  if (!data) return <Loading />;
  const a = data.assignment;
  const counts: Record<PeopleFilter, number> = {
    all: people.length,
    not_started: people.filter((p) => inFilter(p, 'not_started')).length,
    in_progress: people.filter((p) => inFilter(p, 'in_progress')).length,
    finished: people.filter((p) => inFilter(p, 'finished')).length,
    overdue: people.filter((p) => p.overdue).length,
  };
  const shown = people.filter((p) => inFilter(p, filter) && matchesQuery(`${p.name} ${p.email}`, query));
  const filters: { id: PeopleFilter; label: string }[] = [
    { id: 'all', label: 'Everyone' },
    { id: 'not_started', label: 'Not started' },
    { id: 'in_progress', label: 'In progress' },
    { id: 'finished', label: 'Finished' },
    { id: 'overdue', label: 'Overdue' },
  ];

  return (
    <>
      <BackLink label={a.course_title} to={assignCoursePath(a.course_id)} />
      <div className='mb-4 flex flex-wrap items-start gap-3'>
        <TargetIcon kind={a.target.kind} />
        <div className='min-w-0 flex-1'>
          <h2 className='m-0 break-words text-xl font-semibold'>{targetLabel(a.target)}</h2>
          <div className='mt-0.5 text-sm text-text-secondary'>
            {targetKindLabel(a.target.kind)} · “{a.course_title}”
          </div>
          <div className='mt-2'>
            <DueChips a={a} />
          </div>
          {a.note.trim() && <div className='mt-2 whitespace-pre-wrap break-words text-sm italic text-text-secondary'>“{a.note.trim()}”</div>}
        </div>
        {perms.canAssign && !a.path_id && (
          <div className='flex flex-wrap gap-2'>
            <Button type='button' variant='outline' onClick={() => setEditing(true)} data-testid='carehub-learning-assignment-edit-open'>
              Edit
            </Button>
            <Button type='button' variant='ghost' onClick={() => setRemoving(true)} data-testid='carehub-learning-assignment-remove-open'>
              Remove
            </Button>
          </div>
        )}
      </div>
      {a.path_id && (
        <div className='mb-4 flex flex-wrap items-center gap-2'>
          <div className='min-w-0 flex-1'>
            <ChNote>
              Part of the “{a.path_title}” path.{perms.canAssign ? ' Change it on the Paths tab.' : ''}
            </ChNote>
          </div>
          <Button
            type='button'
            size='sm'
            variant='outline'
            onClick={() => navigate(pathPath(a.path_id || ''))}
            data-testid='carehub-learning-open-path'
          >
            Open the path
          </Button>
        </div>
      )}
      <Notice text={notice} onDismiss={() => setNotice('')} />

      <ChSection title='People' hint={progressLine(a)}>
        <div className='mb-3 flex flex-wrap items-center gap-2'>
          <div className='flex flex-wrap gap-1.5' role='group' aria-label='Show'>
            {filters.map((f) => (
              <button
                key={f.id}
                type='button'
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs',
                  filter === f.id ? 'border-border-theme-thick font-medium text-text-primary' : 'border-border-primary text-text-secondary hover:bg-fill-content-hover'
                )}
                data-testid={`carehub-learning-assignee-filter-${f.id}`}
              >
                {f.label} <span className='tabular-nums text-text-tertiary'>{counts[f.id]}</span>
              </button>
            ))}
          </div>
          <div className='flex-1' />
          {people.length > 8 && (
            <div className='w-full sm:w-[220px]'>
              <SearchInput value={query} onChange={setQuery} label='Search people' />
            </div>
          )}
        </div>
        {shown.length ? (
          <List testId='carehub-learning-assignees'>
            {shown.map((p, i) => (
              <AssigneeRow key={p.uid} p={p} index={i} canReports={perms.canReports} />
            ))}
          </List>
        ) : (
          <EmptyBox>{people.length ? 'No one matches.' : 'No one is in this assignment right now.'}</EmptyBox>
        )}
      </ChSection>

      {editing && (
        <EditAssignmentDialog
          workspaceId={workspaceId}
          assignment={a}
          onClose={() => setEditing(false)}
          onSaved={(text) => {
            setEditing(false);
            setNotice(text);
            reload();
          }}
        />
      )}
      {removing && (
        <RemoveAssignmentDialog
          workspaceId={workspaceId}
          assignment={a}
          onClose={() => setRemoving(false)}
          onRemoved={(text) => {
            flash = text;
            navigate(assignCoursePath(a.course_id));
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

function NewGroupDialog({ workspaceId, onClose, onCreated }: { workspaceId: string; onClose: () => void; onCreated: (id: string, name: string) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [members, setMembers] = useState<Member[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tries, setTries] = useState(0);

  useEffect(() => {
    let alive = true;

    setLoadError(null);
    aapi.members(workspaceId).then(
      (m) => {
        if (alive) setMembers(m.members);
      },
      (e: unknown) => {
        if (alive) setLoadError(e || new Error('Something went wrong. Please try again.'));
      }
    );
    return () => {
      alive = false;
    };
  }, [workspaceId, tries]);

  const create = () => {
    const clean = name.trim();

    if (!clean) return setError('Give the group a name.');
    if (clean.length > MAX_GROUP_NAME) return setError(`Keep the name under ${MAX_GROUP_NAME} characters.`);
    setBusy(true);
    setError('');
    aapi.createGroup(workspaceId, { name: clean, description: description.trim(), member_uids: [...picked] }).then(
      (id) => onCreated(id, clean),
      (e: unknown) => {
        setBusy(false);
        setError(lErrorText(e));
      }
    );
    return undefined;
  };

  return (
    <CareHubModal
      title='New group'
      wide
      onClose={busy ? () => undefined : onClose}
      testId='carehub-learning-group-new'
      footer={
        <>
          <Button type='button' variant='outline' onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type='button' onClick={create} loading={busy} data-testid='carehub-learning-group-create'>
            Create group
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-4'>
        <p className='m-0 text-sm text-text-secondary'>{GROUPS_EXPLAINER}</p>
        <div>
          <FieldLabel htmlFor='chl-group-name'>Name</FieldLabel>
          <input
            id='chl-group-name'
            value={name}
            maxLength={MAX_GROUP_NAME}
            placeholder='e.g. Front desk, Night shift, New starters'
            onChange={(e) => setName(e.target.value)}
            className={cn(chInputClass, 'w-full')}
            autoFocus
          />
        </div>
        <div>
          <FieldLabel htmlFor='chl-group-description' optional>
            Description
          </FieldLabel>
          <input
            id='chl-group-description'
            value={description}
            maxLength={MAX_GROUP_DESCRIPTION}
            placeholder='Who is in it'
            onChange={(e) => setDescription(e.target.value)}
            className={cn(chInputClass, 'w-full')}
          />
        </div>
        <div>
          <div className='mb-1 text-sm font-medium'>
            People <span className='font-normal text-text-tertiary'>· {plural(picked.size, 'person', 'people')} picked</span>
          </div>
          {loadError ? (
            <LoadError error={loadError} onRetry={() => setTries((n) => n + 1)} />
          ) : members ? (
            <PeoplePicker
              members={members}
              selected={picked}
              onToggle={(m) =>
                setPicked((s) => {
                  const next = new Set(s);

                  if (next.has(m.uid)) next.delete(m.uid);
                  else next.add(m.uid);
                  return next;
                })
              }
            />
          ) : (
            <Loading />
          )}
        </div>
        {error && <ChNote tone='error'>{error}</ChNote>}
      </div>
    </CareHubModal>
  );
}

function GroupsView({ workspaceId, perms }: { workspaceId: string; perms: AssignPerms }) {
  const navigate = useNavigate();
  const load = useCallback(() => aapi.groups(workspaceId), [workspaceId]);
  const { data, error, reload } = useLoad(load);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useFlash();

  const top = (
    <div className='mb-4 flex flex-wrap items-center gap-2'>
      <AssignNav active='groups' />
      <div className='flex-1' />
      {perms.canAssign && (
        <Button type='button' onClick={() => setCreating(true)} data-testid='carehub-learning-group-new-open'>
          New group
        </Button>
      )}
    </div>
  );

  if (error && !data) {
    return (
      <>
        {top}
        <LoadError error={error} onRetry={reload} />
      </>
    );
  }

  const shown = (data || []).filter((g) => matchesQuery(`${g.name} ${g.description}`, query));

  return (
    <>
      {top}
      <p className='mb-4 mt-0 text-sm text-text-secondary'>{GROUPS_EXPLAINER}</p>
      {!perms.canAssign && (
        <div className='mb-4'>
          <ChNote>{READ_ONLY_NOTE}</ChNote>
        </div>
      )}
      <Notice text={notice} onDismiss={() => setNotice('')} />
      {!data ? (
        <Loading />
      ) : !data.length ? (
        <EmptyBox>
          No groups yet.
          {perms.canAssign && (
            <div className='mt-3'>
              <Button type='button' size='sm' onClick={() => setCreating(true)}>
                Make the first one
              </Button>
            </div>
          )}
        </EmptyBox>
      ) : (
        <>
          {data.length > 8 && (
            <div className='mb-3 w-full sm:w-[240px]'>
              <SearchInput value={query} onChange={setQuery} label='Search groups' />
            </div>
          )}
          {shown.length ? (
            <List testId='carehub-learning-groups'>
              {shown.map((g, i) => (
                <li key={g.id} className={cn(rowClass(i), 'flex items-center gap-3')} data-testid='carehub-learning-group'>
                  <TargetIcon kind='group' />
                  <button type='button' className='min-w-0 flex-1 text-left' onClick={() => navigate(groupPath(g.id))}>
                    <span className='block break-words text-sm font-medium hover:underline'>{g.name}</span>
                    {g.description.trim() && <span className='block truncate text-xs text-text-tertiary'>{g.description.trim()}</span>}
                  </button>
                  <span className='flex shrink-0 flex-col items-end gap-0.5 text-right text-xs text-text-secondary sm:flex-row sm:gap-3'>
                    <span>{plural(g.members, 'person', 'people')}</span>
                    <span className='text-text-tertiary'>{g.courses ? plural(g.courses, 'course') : 'No courses'}</span>
                  </span>
                </li>
              ))}
            </List>
          ) : (
            <EmptyBox>No groups match “{query.trim()}”.</EmptyBox>
          )}
        </>
      )}
      {creating && (
        <NewGroupDialog
          workspaceId={workspaceId}
          onClose={() => setCreating(false)}
          onCreated={(id, name) => {
            flash = `Created “${name}”. Now assign it a course.`;
            setCreating(false);
            navigate(groupPath(id));
          }}
        />
      )}
    </>
  );
}

interface GroupPageData {
  group: Group | null;
  members: Member[];
  /** Null when the assignments couldn't be loaded (the rest of the page still works). */
  overview: { assignments: Assignment[]; courses: AssignCourse[] } | null;
}

function sameSet(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function GroupDetailView({ workspaceId, groupId, perms }: { workspaceId: string; groupId: string; perms: AssignPerms }) {
  const navigate = useNavigate();
  const { canBuild, canReports, canAssign } = perms;
  const load = useCallback(
    (): Promise<GroupPageData> =>
      Promise.all([
        aapi.groups(workspaceId),
        aapi.members(workspaceId),
        loadAssignOverview(workspaceId, { canBuild, canReports }).catch(() => null),
      ]).then(([groups, m, overview]) => ({ group: groups.find((g) => g.id === groupId) || null, members: m.members, overview })),
    [workspaceId, groupId, canBuild, canReports]
  );
  const { data, error, reload } = useLoad(load);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useFlash();
  const group = data?.group || null;

  // Start (again) from the saved group whenever it loads.
  useEffect(() => {
    if (!group) return;
    setName(group.name);
    setDescription(group.description);
    setPicked(new Set(group.member_uids));
    setShowAll(!group.member_uids.length);
  }, [group]);

  const saved = useMemo(() => new Set(group?.member_uids || []), [group]);

  if (error && !data) {
    return (
      <>
        <BackLink label='All groups' to={GROUPS_PATH} />
        <LoadError error={error} onRetry={reload} />
      </>
    );
  }

  if (!data) return <Loading />;
  if (!group) {
    return (
      <>
        <BackLink label='All groups' to={GROUPS_PATH} />
        <ChNote>This group isn’t there any more. It may have been deleted.</ChNote>
      </>
    );
  }

  const assignments = (data.overview?.assignments || []).filter((a) => a.target.kind === 'group' && a.target.id === group.id);
  const added = [...picked].filter((uid) => !saved.has(uid)).length;
  const removed = [...saved].filter((uid) => !picked.has(uid)).length;
  const dirty = name.trim() !== group.name || description.trim() !== group.description.trim() || !sameSet(picked, saved);
  const known = new Set(data.members.map((m) => m.uid));
  const listed = showAll ? data.members : data.members.filter((m) => picked.has(m.uid));
  const gone = [...picked].filter((uid) => !known.has(uid)).length;

  const save = () => {
    const clean = name.trim();

    if (!clean) return setSaveError('Give the group a name.');
    const body: { name?: string; description?: string; member_uids?: string[] } = {};

    if (clean !== group.name) body.name = clean;
    if (description.trim() !== group.description.trim()) body.description = description.trim();
    if (!sameSet(picked, saved)) body.member_uids = [...picked];
    setSaving(true);
    setSaveError('');
    aapi.updateGroup(workspaceId, group.id, body).then(
      (res) => {
        setSaving(false);
        const gets = res.added && assignments.length ? ` They now have this group’s ${plural(assignments.length, 'course')}.` : '';
        const moved = [res.added ? `${plural(res.added, 'person', 'people')} added` : '', res.removed ? `${res.removed} removed` : '']
          .filter(Boolean)
          .join(', ');

        setNotice(`Saved${moved ? ` — ${moved}` : ''}.${gets}`);
        reload();
      },
      (e: unknown) => {
        setSaving(false);
        setSaveError(lErrorText(e));
      }
    );
    return undefined;
  };

  const discard = () => {
    setName(group.name);
    setDescription(group.description);
    setPicked(new Set(group.member_uids));
    setSaveError('');
  };

  const toggle = (m: Member) =>
    setPicked((s) => {
      const next = new Set(s);

      if (next.has(m.uid)) next.delete(m.uid);
      else next.add(m.uid);
      return next;
    });

  return (
    <>
      <BackLink label='All groups' to={GROUPS_PATH} />
      <Notice text={notice} onDismiss={() => setNotice('')} />
      {!canAssign && (
        <div className='mb-4'>
          <ChNote>{READ_ONLY_NOTE}</ChNote>
        </div>
      )}

      {canAssign ? (
        <div className='mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2'>
          <div>
            <FieldLabel htmlFor='chl-group-edit-name'>Group name</FieldLabel>
            <input
              id='chl-group-edit-name'
              value={name}
              maxLength={MAX_GROUP_NAME}
              onChange={(e) => setName(e.target.value)}
              className={cn(chInputClass, 'w-full text-base font-semibold')}
              data-testid='carehub-learning-group-name'
            />
          </div>
          <div>
            <FieldLabel htmlFor='chl-group-edit-description' optional>
              Description
            </FieldLabel>
            <input
              id='chl-group-edit-description'
              value={description}
              maxLength={MAX_GROUP_DESCRIPTION}
              placeholder='Who is in it'
              onChange={(e) => setDescription(e.target.value)}
              className={cn(chInputClass, 'w-full')}
            />
          </div>
        </div>
      ) : (
        <div className='mb-5'>
          <h2 className='m-0 break-words text-xl font-semibold'>{group.name}</h2>
          {group.description.trim() && <p className='mb-0 mt-1 text-sm text-text-secondary'>{group.description}</p>}
        </div>
      )}

      <ChSection
        title='People in this group'
        hint={`${plural(picked.size, 'person', 'people')}${gone ? ` (${gone} no longer in the workspace)` : ''}`}
        right={
          canAssign ? (
            <div className='flex gap-1.5' role='group' aria-label='Show'>
              {[
                { all: false, label: 'In this group' },
                { all: true, label: 'Add people' },
              ].map((o) => (
                <button
                  key={o.label}
                  type='button'
                  aria-pressed={showAll === o.all}
                  onClick={() => setShowAll(o.all)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs',
                    showAll === o.all ? 'border-border-theme-thick font-medium text-text-primary' : 'border-border-primary text-text-secondary hover:bg-fill-content-hover'
                  )}
                  data-testid={`carehub-learning-group-show-${o.all ? 'all' : 'in'}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          ) : undefined
        }
      >
        <PeoplePicker
          members={listed}
          selected={picked}
          onToggle={toggle}
          disabled={!canAssign}
          emptyText={showAll ? 'No one in the workspace yet.' : canAssign ? 'No one in this group yet. Choose “Add people” to add some.' : 'No one in this group yet.'}
        />
        {canAssign && (dirty || saveError) && (
          <div className='mt-3 flex flex-wrap items-center gap-2 rounded-[10px] bg-fill-content-hover px-3 py-2' data-testid='carehub-learning-group-savebar'>
            <span className='min-w-0 flex-1 text-sm'>
              Unsaved changes
              {added || removed ? (
                <span className='text-text-tertiary'>
                  {' '}
                  · {added ? `${added} to add` : ''}
                  {added && removed ? ', ' : ''}
                  {removed ? `${removed} to remove` : ''}
                </span>
              ) : null}
            </span>
            <Button type='button' size='sm' variant='ghost' onClick={discard} disabled={saving}>
              Discard
            </Button>
            <Button type='button' size='sm' onClick={save} loading={saving} disabled={!dirty} data-testid='carehub-learning-group-save'>
              Save changes
            </Button>
          </div>
        )}
        {saveError && (
          <div className='mt-2'>
            <ChNote tone='error'>{saveError}</ChNote>
          </div>
        )}
        {canAssign && added > 0 && assignments.length > 0 && (
          <div className='mt-2 text-xs text-text-tertiary'>
            When you save, the people you add get this group’s {plural(assignments.length, 'course')} straight away.
          </div>
        )}
      </ChSection>

      <ChSection
        title='Courses assigned to this group'
        right={
          canAssign && data.overview ? (
            <Button type='button' size='sm' variant='outline' onClick={() => setAssigning(true)} data-testid='carehub-learning-group-assign'>
              Assign a course
            </Button>
          ) : undefined
        }
      >
        {!data.overview ? (
          <ChNote tone='error'>Couldn’t load this group’s courses. Try again in a moment.</ChNote>
        ) : assignments.length ? (
          <List testId='carehub-learning-group-courses'>
            {assignments.map((a, i) => (
              <li key={a.id} className={cn(rowClass(i), 'flex flex-wrap items-center gap-x-3 gap-y-1')}>
                <button type='button' className='min-w-[180px] flex-1 text-left' onClick={() => navigate(assignmentPath(a.id))}>
                  <span className='block break-words text-sm font-medium hover:underline'>{a.course_title}</span>
                  <span className='block text-xs text-text-secondary'>{progressLine(a)}</span>
                </button>
                <PartOfPath a={a} />
                <DueChips a={a} />
              </li>
            ))}
          </List>
        ) : (
          <EmptyBox>No courses are assigned to this group yet.</EmptyBox>
        )}
      </ChSection>

      {canAssign && (
        <div className='mt-8 border-t border-border-primary pt-4'>
          <Button type='button' variant='destructive-outline' onClick={() => setDeleting(true)} data-testid='carehub-learning-group-delete'>
            Delete group
          </Button>
        </div>
      )}

      {assigning && data.overview && (
        <AssignDialog
          workspaceId={workspaceId}
          courses={data.overview.courses}
          initialTargets={[{ kind: 'group', id: group.id, name: group.name }]}
          onClose={() => setAssigning(false)}
          onAssigned={(text) => {
            setAssigning(false);
            setNotice(text);
            reload();
          }}
        />
      )}
      {deleting && (
        <Confirm
          title={`Delete “${group.name}”?`}
          confirmLabel='Delete group'
          testId='carehub-learning-group-delete-dialog'
          onClose={() => setDeleting(false)}
          onConfirm={() =>
            aapi.deleteGroup(workspaceId, group.id).then((res) => {
              const n = res.assignments_removed;

              flash = `Deleted “${group.name}”.${n ? ` ${plural(n, 'course assignment')} went with it.` : ''}`;
              navigate(GROUPS_PATH);
            })
          }
        >
          <p className='m-0'>
            {group.courses
              ? `This also removes its ${plural(group.courses, 'course assignment')}. People keep the progress they’ve made, and the due dates come off their calendars.`
              : 'No courses are assigned to it, so nothing else changes.'}
          </p>
          <p className='m-0'>The people in it stay in the workspace.</p>
        </Confirm>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// The Assign tab (route `assign/*`)
// ---------------------------------------------------------------------------

export function LearningAssignPage({ workspaceId, canAssign, canBuild, canReports }: { workspaceId: string } & AssignPerms) {
  const location = useLocation();
  const perms: AssignPerms = { canAssign, canBuild, canReports };
  const rest = location.pathname.startsWith(ASSIGN_PATH) ? location.pathname.slice(ASSIGN_PATH.length) : '';
  const parts = rest.split('/').filter(Boolean);
  let view: ReactNode;

  if (!parts.length) {
    view = <AssignCoursesView workspaceId={workspaceId} perms={perms} />;
  } else if (parts[0] === 'course' && parts.length === 2 && UUID_RE.test(parts[1])) {
    view = <CourseAssignmentsView key={parts[1]} workspaceId={workspaceId} courseId={parts[1]} perms={perms} />;
  } else if (parts[0] === 'assignment' && parts.length === 2 && SAFE_ID_RE.test(parts[1])) {
    view = <AssignmentDetailView key={parts[1]} workspaceId={workspaceId} assignmentId={parts[1]} perms={perms} />;
  } else if (parts[0] === 'groups' && parts.length === 1) {
    view = <GroupsView workspaceId={workspaceId} perms={perms} />;
  } else if (parts[0] === 'groups' && parts.length === 2 && SAFE_ID_RE.test(parts[1])) {
    view = <GroupDetailView key={parts[1]} workspaceId={workspaceId} groupId={parts[1]} perms={perms} />;
  } else {
    return <Navigate to={ASSIGN_PATH} replace />;
  }

  return (
    <div data-testid='carehub-learning-assign'>
      <AssignStyle />
      {view}
    </div>
  );
}

// ---------------------------------------------------------------------------
// My learning: "Assigned to you"
// ---------------------------------------------------------------------------

/**
 * The caller's assigned courses. `undefined` while loading (for up to 4 seconds), `null` when they couldn't be
 * loaded (e.g. the server doesn't have assignments yet) — then My learning simply doesn't show the section.
 */
export function useAssignedCourses(workspaceId: string, reload = 0): AssignedCourse[] | null | undefined {
  const key = `${workspaceId}:${reload}`;
  const [state, setState] = useState<{ key: string; list: AssignedCourse[] | null } | null>(null);
  const [slow, setSlow] = useState('');

  useEffect(() => {
    if (!workspaceId) return undefined;
    let alive = true;
    const timer = window.setTimeout(() => {
      if (alive) setSlow(key);
    }, 4000);

    aapi.assigned(workspaceId).then(
      (list) => {
        if (alive) setState({ key, list });
      },
      () => {
        if (alive) setState({ key, list: null });
      }
    );
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [workspaceId, key]);

  if (state && state.key === key) return state.list;
  return slow === key ? null : undefined;
}

function assignedMeta(c: AssignedCourse) {
  const bits = [plural(c.lessons, 'lesson')];

  if (c.est_minutes > 0) bits.push(`About ${formatMinutes(c.est_minutes)}`);
  return bits.join(' · ');
}

/** "Take it again" over the bottom corner of a finished course that has run out. It starts the course over; then the caller opens it. */
export function TakeAgain({
  title,
  onRetake,
  place,
  children,
}: {
  title: string;
  onRetake: () => Promise<void>;
  place: string;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const go = () => {
    setBusy(true);
    setError('');
    onRetake().then(
      () => setBusy(false),
      (e: unknown) => {
        setBusy(false);
        setError(lErrorText(e));
      }
    );
  };

  return (
    <div className='min-w-0'>
      <div className='relative'>
        {children}
        <span className={cn('absolute', place)}>
          <Button
            type='button'
            size='sm'
            variant='outline'
            onClick={go}
            loading={busy}
            aria-label={`Take it again: ${title}`}
            data-testid='carehub-learning-retake'
          >
            Take it again
          </Button>
        </span>
      </div>
      {error && (
        <div role='alert' className='chl-alert mt-1 px-1 text-xs'>
          {error}
        </div>
      )}
    </div>
  );
}

/** Text for a finish that ran out: "Expired on Fri 30 Oct". */
export function expiredText(p: { expires_ms?: number | null } | null | undefined) {
  return p?.expires_ms ? `Expired on ${shortDate(p.expires_ms)}` : 'Expired';
}

const RENEWAL_HINT = 'You finished this before and it has run out. Please take it again.';

function AssignedCard({ course, onOpen, onRetake }: { course: AssignedCourse; onOpen: () => void; onRetake?: () => Promise<void> }) {
  const p = course.my;
  const done = assignedDone(course);
  const overdue = assignedOverdue(course);
  const due = done ? null : dueChip({ due_ms: course.assignment.due_ms, overdue }, false);
  const action = done ? 'Review' : p ? 'Continue' : 'Start';
  const note = course.assignment.note.trim();
  const expired = done && Boolean(p?.expired);
  const retake = expired && onRetake ? onRetake : null;

  const card = (
    <button
      type='button'
      onClick={onOpen}
      className={cn(
        'flex w-full min-w-0 items-stretch gap-3 overflow-hidden rounded-[14px] border border-border-primary p-2.5 text-left hover:bg-fill-content-hover',
        overdue && 'chl-overdue'
      )}
      data-testid='carehub-learning-assigned'
    >
      <div className='h-[72px] w-[96px] shrink-0 overflow-hidden rounded-[10px]'>
        <CourseCover cover={course.cover} preset={course.preset} seed={course.id} />
      </div>
      <div className='flex min-w-0 flex-1 flex-col justify-between gap-1.5 py-0.5'>
        <div className='min-w-0'>
          <div className='truncate text-[15px] font-medium'>{course.title.trim() || 'Untitled course'}</div>
          <div className='mt-1 flex flex-wrap items-center gap-1'>
            {done ? (
              <>
                <Chip tone='green'>✓ Done</Chip>
                {expired && <Chip tone='amber'>Expired</Chip>}
              </>
            ) : (
              <>
                {course.assignment.renewal && (
                  <Chip tone='blue' title={RENEWAL_HINT}>
                    Renewal
                  </Chip>
                )}
                {due && (
                  <Chip tone={due.tone} title={course.assignment.due_ms !== null ? `Due ${new Date(course.assignment.due_ms).toLocaleDateString()}` : undefined}>
                    {due.label}
                  </Chip>
                )}
                {p?.status === 'failed' && <Chip tone='red'>Didn’t pass</Chip>}
                {p?.awaiting_ack && <Chip tone='amber'>Almost done</Chip>}
              </>
            )}
            <Chip tone={course.assignment.required ? 'purple' : 'gray'}>{course.assignment.required ? 'Required' : 'Optional'}</Chip>
          </div>
          {note && (
            <div className='mt-1 truncate text-xs italic text-text-secondary' title={note}>
              “{note}”
            </div>
          )}
        </div>
        <div className='flex items-center gap-2'>
          {p && !done ? (
            <>
              <ProgressBar percent={p.percent} className='flex-1' label={`${course.title} progress`} />
              <span className='shrink-0 text-xs text-text-secondary'>{p.percent}%</span>
            </>
          ) : (
            <span className={cn('min-w-0 flex-1 text-xs', expired ? 'chl-warn break-words font-medium' : 'truncate text-text-tertiary')}>
              {expired ? expiredText(p) : done && p?.completed_ms ? `Finished ${formatWhen(p.completed_ms)}` : assignedMeta(course)}
            </span>
          )}
          {retake ? (
            <span className='h-8 w-[112px] shrink-0' aria-hidden='true' />
          ) : (
            <span className='shrink-0 text-sm font-medium text-text-action'>{action} →</span>
          )}
        </div>
      </div>
    </button>
  );

  return retake ? (
    <TakeAgain title={course.title} onRetake={retake} place='bottom-2.5 right-2.5'>
      {card}
    </TakeAgain>
  ) : (
    card
  );
}

/** The "Assigned to you" section: to-do first (overdue, then soonest due), finished ones after. */
export function AssignedToYou({
  courses,
  onOpen,
  onRetake,
}: {
  courses: AssignedCourse[];
  onOpen: (c: CourseCard) => void;
  /** Starts a finished course that has run out over again (then opens it). */
  onRetake?: (c: CourseCard) => Promise<void>;
}) {
  const [showAllDone, setShowAllDone] = useState(false);
  const sorted = useMemo(() => sortAssigned(courses), [courses]);

  if (!sorted.length) return null;
  const todo = sorted.filter((c) => !assignedDone(c));
  const done = sorted.filter((c) => assignedDone(c));
  const overdue = todo.filter((c) => assignedOverdue(c)).length;
  const keepDone = todo.length ? 2 : 4;
  const shownDone = showAllDone ? done : done.slice(0, keepDone);
  const hint = todo.length ? `${todo.length} to do${overdue ? ` · ${overdue} overdue` : ''}` : 'All done — nice work!';

  return (
    <>
      <AssignStyle />
      <ChSection title='Assigned to you' hint={hint}>
        <div className='grid grid-cols-1 gap-3 md:grid-cols-2' data-testid='carehub-learning-assigned-list'>
          {[...todo, ...shownDone].map((c) => (
            <AssignedCard key={c.id} course={c} onOpen={() => onOpen(c)} onRetake={onRetake ? () => onRetake(c) : undefined} />
          ))}
        </div>
        {done.length > shownDone.length && (
          <button type='button' className='mt-2 text-sm text-text-secondary underline' onClick={() => setShowAllDone(true)}>
            Show {done.length - shownDone.length} more finished
          </button>
        )}
      </ChSection>
    </>
  );
}

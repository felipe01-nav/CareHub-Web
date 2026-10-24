// CareHub Learning: learning paths. The Paths tab on Assign (the list, one path's page, assigning it) and "Your learning
// paths" on My learning. A path is a set of courses people take one after another; assigning it assigns every course in it.
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { tzMinutesEast, UUID_RE } from './CareHubCore';
import { lErrorText, plural, statusInfo } from './CareHubLearningApi';
import { learningTitle, usePageTitle, useRefocus } from './CareHubLearningA11y';
import {
  AssignDialog,
  AssignNav,
  AssignStyle,
  BackLink,
  Check,
  Confirm,
  DueChips,
  DuePicker,
  EmptyBox,
  FieldLabel,
  List,
  Loading,
  LoadError,
  Notice,
  progressLine,
  RequiredPicker,
  rowClass,
  SearchInput,
  setFlash,
  Stat,
  TargetIcon,
  useFlash,
  useLoad,
} from './CareHubLearningAssign';
import {
  aapi,
  assignCoursePath,
  dueBody,
  dueChip,
  dueChoiceOf,
  dueText,
  loadAssignOverview,
  matchesQuery,
  MAX_NOTE,
  MAX_PATH_COURSES,
  MAX_PATH_DESCRIPTION,
  MAX_PATH_TITLE,
  MIN_PATH_COURSES,
  PATHS_PATH,
  pathPath,
  personName,
  sameDue,
  shortDate,
  targetKey,
  targetKindLabel,
  targetLabel,
} from './CareHubLearningAssignApi';
import { Chip, ProgressBar } from './CareHubLearningBlocks';
import { PEOPLE_PATH } from './CareHubLearningReports';
import { CareHubModal, ChCard, chInputClass, ChNote, ChPersonChip, ChSection } from './CareHubUi';

import type { AssignPerms } from './CareHubLearningAssign';
import type {
  AssignCourseStatus,
  DueBody,
  LearningPath,
  MyPath,
  MyPathStep,
  PathChanges,
  PathDetail,
  PathPerson,
  PathTarget,
} from './CareHubLearningAssignApi';

const PATHS_READ_ONLY = 'You can look at learning paths here. Only people with the “Assign courses” permission can change them.';
const PATHS_EXPLAINER =
  'A learning path is a set of courses to take together, in order or in any order. Assign the path and people get every course in it.';
const NAME_NEEDED = 'Give the path a name (up to 80 characters).';
const DESCRIPTION_TOO_LONG = 'Keep the description to 500 characters or fewer.';
const COURSES_NEEDED = 'A learning path needs 2 to 20 different courses.';
/** Why an archived course in a path is shown but not taken (a tooltip, and hidden text for screen readers). */
const LEFT_OUT = 'Left out of the path until it’s unarchived';

function orderText(inOrder: boolean) {
  return inOrder ? 'In this order' : 'Any order';
}

/** "2 of 5 courses finished". */
function finishedCoursesText(done: number, total: number) {
  return `${done} of ${plural(total, 'course')} finished`;
}

function SmallIconButton({
  label,
  onClick,
  disabled,
  children,
  buttonRef,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: string;
  buttonRef?: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={buttonRef}
      type='button'
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className='flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-sm text-text-secondary hover:bg-fill-content-hover hover:text-text-primary disabled:opacity-30 disabled:hover:bg-transparent'
    >
      <span aria-hidden='true'>{children}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// New path / edit a path
// ---------------------------------------------------------------------------

interface KnownCourse {
  title: string;
  status: AssignCourseStatus;
}

function PathEditorDialog({
  workspaceId,
  perms,
  detail,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  perms: AssignPerms;
  /** The path to edit; leave out for a new one. */
  detail?: PathDetail;
  onClose: () => void;
  onSaved: (id: string, message: string) => void;
}) {
  const editing = detail?.path || null;
  const { canBuild, canReports } = perms;
  const [title, setTitle] = useState(editing?.title || '');
  const [description, setDescription] = useState(editing?.description || '');
  const [ids, setIds] = useState<string[]>(() => (editing ? editing.course_ids : []));
  const [inOrder, setInOrder] = useState(editing ? editing.in_order : true);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(
    () => loadAssignOverview(workspaceId, { canBuild, canReports }).then((o) => o.courses),
    [workspaceId, canBuild, canReports]
  );
  const { data: courses, error: loadError, reload } = useLoad(load);
  // Keyboard focus stays in the course list when a row moves to the top or bottom, goes away or is added.
  const refocus = useRefocus();

  // Titles for the path's own courses (from its page) and every course that can be assigned.
  const known = useMemo(() => {
    const m = new Map<string, KnownCourse>();

    for (const c of courses || []) m.set(c.id, { title: c.title, status: c.status });
    for (const c of detail?.courses || []) if (!m.has(c.id)) m.set(c.id, { title: c.title, status: c.status });
    return m;
  }, [courses, detail]);
  const choices = (courses || []).filter((c) => c.status === 'published' && !ids.includes(c.id));
  const full = ids.length >= MAX_PATH_COURSES;
  const coursesChanged = Boolean(editing && ids.join(',') !== editing.course_ids.join(','));
  const rows = ids.map((id) => ({ id }));

  const move = (i: number, by: -1 | 1) =>
    setIds((list) => {
      const j = i + by;

      if (j < 0 || j >= list.length) return list;
      const next = [...list];

      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const add = () => {
    if (!pick || ids.includes(pick) || full) return;
    // The Add button turns off: back to the course picker, else the new row's ↑.
    refocus.later('pick', `up:${pick}`, 'title');
    setIds((list) => [...list, pick]);
    setPick('');
    setError('');
  };
  const remove = (id: string) => {
    setIds((list) => list.filter((x) => x !== id));
    setError('');
  };

  const save = () => {
    const name = title.trim();
    const about = description.trim();

    if (!name || name.length > MAX_PATH_TITLE) return setError(NAME_NEEDED);
    if (about.length > MAX_PATH_DESCRIPTION) return setError(DESCRIPTION_TOO_LONG);
    if (ids.length < MIN_PATH_COURSES || ids.length > MAX_PATH_COURSES) return setError(COURSES_NEEDED);
    const fail = (e: unknown) => {
      setBusy(false);
      setError(lErrorText(e));
    };

    if (!editing) {
      setBusy(true);
      setError('');
      aapi
        .createPath(workspaceId, { title: name, ...(about ? { description: about } : {}), course_ids: ids, in_order: inOrder })
        .then((id) => onSaved(id, `Path created. Assign it to people when you’re ready.`), fail);
      return undefined;
    }

    const changes: PathChanges = {};

    if (name !== editing.title) changes.title = name;
    if (about !== editing.description.trim()) changes.description = about;
    if (coursesChanged) changes.course_ids = ids;
    if (inOrder !== editing.in_order) changes.in_order = inOrder;
    if (!Object.keys(changes).length) {
      onClose();
      return undefined;
    }

    setBusy(true);
    setError('');
    aapi.updatePath(workspaceId, editing.id, changes).then((res) => {
      const bits = ['Saved.'];

      if (res.added && editing.targets) bits.push(`${plural(res.added, 'course')} added for everyone it’s assigned to.`);
      if (res.removed && editing.targets) bits.push(`${plural(res.removed, 'course')} taken off their list. They keep their progress.`);
      onSaved(editing.id, bits.join(' '));
    }, fail);
    return undefined;
  };

  return (
    <CareHubModal
      title={editing ? `Edit “${editing.title}”` : 'New learning path'}
      wide
      onClose={busy ? () => undefined : onClose}
      testId='carehub-learning-path-editor'
      footer={
        <>
          <Button type='button' variant='outline' onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type='button' onClick={save} loading={busy} data-testid='carehub-learning-path-save'>
            {editing ? 'Save' : 'Create path'}
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-5'>
        <div>
          <FieldLabel htmlFor='chl-path-title'>Title</FieldLabel>
          <input
            id='chl-path-title'
            value={title}
            maxLength={MAX_PATH_TITLE}
            placeholder='e.g. New starter induction'
            onChange={(e) => setTitle(e.target.value)}
            className={cn(chInputClass, 'w-full')}
            autoFocus
            ref={refocus.reg('title')}
            data-testid='carehub-learning-path-title'
          />
        </div>
        <div>
          <FieldLabel htmlFor='chl-path-description' optional>
            Description
          </FieldLabel>
          <textarea
            id='chl-path-description'
            rows={2}
            maxLength={MAX_PATH_DESCRIPTION}
            value={description}
            placeholder='What it covers and who it’s for.'
            onChange={(e) => setDescription(e.target.value)}
            className={cn(chInputClass, 'w-full resize-y')}
          />
          {description.length > MAX_PATH_DESCRIPTION - 100 && (
            <div className='mt-0.5 text-right text-[11px] text-text-tertiary'>
              {description.length}/{MAX_PATH_DESCRIPTION}
            </div>
          )}
        </div>

        <div>
          <div className='text-sm font-medium'>Courses</div>
          <div className='mb-2 text-xs text-text-tertiary'>
            Pick {MIN_PATH_COURSES} to {MAX_PATH_COURSES} published courses.{inOrder ? ' People take them from the top down.' : ''}
          </div>
          {ids.length ? (
            <ol
              className='m-0 list-none overflow-hidden rounded-[10px] border border-border-primary p-0'
              data-testid='carehub-learning-path-courses'
            >
              {ids.map((id, i) => {
                const c = known.get(id);
                const name = c?.title || 'Untitled course';

                return (
                  <li key={id} className={cn('flex items-center gap-1.5 py-1 pl-2.5 pr-1', i > 0 && 'border-t border-border-primary')}>
                    <span className='w-6 shrink-0 text-xs tabular-nums text-text-tertiary'>{i + 1}.</span>
                    <span className='min-w-0 flex-1 break-words text-sm'>{name}</span>
                    {c?.status === 'archived' && (
                      <>
                        <Chip title={LEFT_OUT}>Archived</Chip>
                        <span className='sr-only'>{` ${LEFT_OUT}.`}</span>
                      </>
                    )}
                    <SmallIconButton
                      label={`Move “${name}” up`}
                      disabled={i === 0}
                      onClick={() => {
                        refocus.moved(id, -1);
                        move(i, -1);
                      }}
                      buttonRef={refocus.reg(`up:${id}`)}
                    >
                      ↑
                    </SmallIconButton>
                    <SmallIconButton
                      label={`Move “${name}” down`}
                      disabled={i === ids.length - 1}
                      onClick={() => {
                        refocus.moved(id, 1);
                        move(i, 1);
                      }}
                      buttonRef={refocus.reg(`down:${id}`)}
                    >
                      ↓
                    </SmallIconButton>
                    <SmallIconButton
                      label={`Remove “${name}”`}
                      onClick={() => {
                        refocus.removed('rm', rows, i, 'pick', 'title');
                        remove(id);
                      }}
                      buttonRef={refocus.reg(`rm:${id}`)}
                    >
                      ×
                    </SmallIconButton>
                  </li>
                );
              })}
            </ol>
          ) : (
            <EmptyBox>No courses yet. Add at least two.</EmptyBox>
          )}
          <div className='mt-2 flex flex-wrap items-center gap-2'>
            {loadError ? (
              <LoadError error={loadError} onRetry={reload} />
            ) : !courses ? (
              <Loading />
            ) : choices.length ? (
              <>
                <select
                  ref={refocus.reg('pick')}
                  aria-label='Course to add'
                  className={cn(chInputClass, 'min-w-0 flex-1 pr-7')}
                  value={pick}
                  onChange={(e) => setPick(e.target.value)}
                  disabled={full}
                  data-testid='carehub-learning-path-pick'
                >
                  <option value=''>{full ? `A path can have up to ${MAX_PATH_COURSES} courses` : 'Pick a course to add…'}</option>
                  {choices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  onClick={add}
                  disabled={!pick || full}
                  data-testid='carehub-learning-path-add'
                >
                  Add
                </Button>
              </>
            ) : (
              <span className='text-xs text-text-tertiary'>
                {ids.length ? 'Every published course is in this path.' : 'There are no published courses yet.'}
              </span>
            )}
          </div>
        </div>

        <Check
          checked={inOrder}
          onChange={setInOrder}
          label='Take them in this order'
          hint={inOrder ? 'Each course opens once the one before it is finished.' : 'People can take the courses in any order.'}
          testId='carehub-learning-path-in-order'
        />

        {editing && editing.targets > 0 && coursesChanged && (
          <ChNote>
            Courses you add are assigned to everyone on this path straight away. Courses you take off are no longer assigned through it —
            people keep their progress.
          </ChNote>
        )}
        {error && <ChNote tone='error'>{error}</ChNote>}
      </div>
    </CareHubModal>
  );
}

// ---------------------------------------------------------------------------
// Change one of a path's assignments (a path is changed by assigning it again to the same people)
// ---------------------------------------------------------------------------

function PathTargetDialog({
  workspaceId,
  path,
  t,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  path: LearningPath;
  t: PathTarget;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [start] = useState(() => dueChoiceOf(t));
  const [due, setDue] = useState(start);
  const [required, setRequired] = useState(t.required);
  const [note, setNote] = useState(t.note);
  const [calendar, setCalendar] = useState(t.calendar);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const hasDue = due.mode !== 'none';

  const save = () => {
    let dueSend: DueBody | string;

    if (sameDue(due, start)) {
      // Unchanged: send it back exactly as it is (a date that has passed has to be changed first).
      dueSend =
        t.due_ms !== null && !t.due_days && t.due_ms <= Date.now()
          ? 'This due date has passed. Pick a new one, or another choice.'
          : { due_ms: t.due_days ? null : t.due_ms, due_days: t.due_days, tz_minutes: t.tz_minutes ?? tzMinutesEast() };
    } else {
      dueSend = dueBody(due);
    }

    if (typeof dueSend === 'string') return setError(dueSend);
    if (sameDue(due, start) && required === t.required && note.trim() === t.note.trim() && calendar === t.calendar) {
      onClose();
      return undefined;
    }

    setBusy(true);
    setError('');
    aapi
      .assignPath(workspaceId, path.id, {
        targets: [{ kind: t.target.kind, id: t.target.id }],
        ...dueSend,
        required,
        note: note.trim(),
        calendar: hasDue && calendar,
        notify: false,
      })
      .then(
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
      title={`Edit — ${targetLabel(t.target)}`}
      onClose={busy ? () => undefined : onClose}
      testId='carehub-learning-path-target-dialog'
      footer={
        <>
          <Button type='button' variant='outline' onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type='button' onClick={save} loading={busy} data-testid='carehub-learning-path-target-save'>
            Save
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-4'>
        <div className='text-sm text-text-secondary'>
          The “{path.title}” path · {plural(path.course_ids.length, 'course')}
        </div>
        <DuePicker value={due} onChange={setDue} idPrefix='chl-path-edit' start={start} />
        <RequiredPicker value={required} onChange={setRequired} name='chl-path-edit-required' />
        <div>
          <FieldLabel htmlFor='chl-path-edit-note' optional>
            Note for them
          </FieldLabel>
          <textarea
            id='chl-path-edit-note'
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

// ---------------------------------------------------------------------------
// The Paths tab: all paths
// ---------------------------------------------------------------------------

function PathRow({
  p,
  index,
  canAssign,
  onOpen,
  onAssign,
}: {
  p: LearningPath;
  index: number;
  canAssign: boolean;
  onOpen: () => void;
  onAssign: () => void;
}) {
  return (
    <li className={cn(rowClass(index), 'flex flex-wrap items-center gap-x-4 gap-y-2')} data-testid='carehub-learning-path'>
      <button type='button' onClick={onOpen} className='min-w-[180px] flex-1 text-left'>
        <span className='block break-words text-sm font-medium hover:underline'>{p.title}</span>
        <span className='mt-0.5 flex flex-wrap items-center gap-1 text-xs text-text-tertiary'>
          {p.archived && <Chip>Archived</Chip>}
          <span>{orderText(p.in_order)}</span>
          {!p.archived && !p.targets && <span>· Not assigned yet</span>}
        </span>
      </button>
      <span className='flex items-center gap-3'>
        <Stat label='Courses' n={p.course_ids.length} />
        <Stat label='People' n={p.people} />
        <Stat label='Finished' n={p.finished} />
        <Stat label='Overdue' n={p.overdue} alert />
      </span>
      {canAssign && (
        <span className='w-[76px] shrink-0 text-right'>
          {p.archived ? (
            <>
              <span className='text-xs text-text-tertiary' title='Unarchive it before assigning it.'>
                Can’t assign
              </span>
              <span className='sr-only'> Unarchive it before assigning it.</span>
            </>
          ) : (
            <Button type='button' size='sm' variant='outline' onClick={onAssign} data-testid='carehub-learning-path-assign-open'>
              Assign
            </Button>
          )}
        </span>
      )}
    </li>
  );
}

function PathsListView({ workspaceId, perms }: { workspaceId: string; perms: AssignPerms }) {
  usePageTitle(learningTitle('Paths', 'Assign'));
  const navigate = useNavigate();
  const { canAssign } = perms;
  const load = useCallback(() => aapi.paths(workspaceId), [workspaceId]);
  const { data, error, reload } = useLoad(load);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [assigning, setAssigning] = useState<LearningPath | null>(null);
  const [notice, setNotice] = useFlash();
  const nav = (
    <div className='mb-4 flex flex-wrap items-center gap-2'>
      <AssignNav active='paths' />
      <div className='flex-1' />
      {data && data.length > 6 && (
        <div className='w-full sm:w-[240px]'>
          <SearchInput value={query} onChange={setQuery} label='Search paths' />
        </div>
      )}
      {canAssign && data && (
        <Button type='button' onClick={() => setCreating(true)} data-testid='carehub-learning-path-new'>
          New path
        </Button>
      )}
    </div>
  );

  if (error && !data) {
    return (
      <>
        {nav}
        <LoadError error={error} onRetry={reload} />
      </>
    );
  }

  if (!data) return <Loading />;
  const shown = data.filter((p) => matchesQuery(`${p.title} ${p.description}`, query));
  const live = shown.filter((p) => !p.archived);
  const archived = shown.filter((p) => p.archived);
  const row = (p: LearningPath, i: number) => (
    <PathRow key={p.id} p={p} index={i} canAssign={canAssign} onOpen={() => navigate(pathPath(p.id))} onAssign={() => setAssigning(p)} />
  );

  return (
    <>
      {nav}
      {!canAssign && (
        <div className='mb-4'>
          <ChNote>{PATHS_READ_ONLY}</ChNote>
        </div>
      )}
      <Notice text={notice} onDismiss={() => setNotice('')} />
      {error ? (
        <div className='mb-4'>
          <ChNote tone='error'>Couldn’t refresh: {lErrorText(error)}</ChNote>
        </div>
      ) : null}

      {!data.length ? (
        <EmptyBox>
          No learning paths yet. {PATHS_EXPLAINER}
          {canAssign && (
            <div className='mt-3'>
              <Button type='button' size='sm' onClick={() => setCreating(true)}>
                New path
              </Button>
            </div>
          )}
        </EmptyBox>
      ) : (
        <>
          <ChSection title='Learning paths' hint={PATHS_EXPLAINER}>
            {live.length ? (
              <List testId='carehub-learning-paths'>{live.map(row)}</List>
            ) : (
              <EmptyBox>{query.trim() ? `No paths match “${query.trim()}”.` : 'No paths in use right now.'}</EmptyBox>
            )}
          </ChSection>
          {archived.length > 0 && (
            <ChSection title='Archived' hint='Archived paths aren’t assigned to anyone. Unarchive one to assign it again.'>
              <List>{archived.map(row)}</List>
            </ChSection>
          )}
        </>
      )}

      {creating && (
        <PathEditorDialog
          workspaceId={workspaceId}
          perms={perms}
          onClose={() => setCreating(false)}
          onSaved={(id, text) => {
            setFlash(text);
            navigate(pathPath(id));
          }}
        />
      )}
      {assigning && (
        <AssignDialog
          workspaceId={workspaceId}
          path={{ id: assigning.id, title: assigning.title }}
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
// One path: its courses, who it's assigned to, and how each person is getting on
// ---------------------------------------------------------------------------

type PeopleFilter = 'all' | 'not_started' | 'in_progress' | 'finished' | 'overdue';

function inFilter(p: PathPerson, f: PeopleFilter) {
  if (f === 'all') return true;
  if (f === 'overdue') return p.overdue;
  return p.status === f;
}

function peopleRank(p: PathPerson) {
  if (p.overdue) return 0;
  if (p.status === 'not_started') return 1;
  if (p.status === 'in_progress') return 2;
  return 3;
}

function pathStatusChip(status: PathPerson['status']) {
  if (status === 'finished') return { label: 'Finished', tone: 'green' as const };
  if (status === 'in_progress') return { label: 'In progress', tone: 'blue' as const };
  return { label: 'Not started', tone: 'gray' as const };
}

function PathPersonRow({ p, index, canReports }: { p: PathPerson; index: number; canReports: boolean }) {
  const navigate = useNavigate();
  const name = personName(p);
  const chip = pathStatusChip(p.status);
  const when = p.status === 'finished' ? 'All done' : p.due_ms !== null ? dueText(p.due_ms) : 'No due date';
  const nameEl = (
    <>
      <span className='block truncate text-sm font-medium'>{name}</span>
      {p.email && p.email !== name && <span className='block truncate text-xs text-text-tertiary'>{p.email}</span>}
    </>
  );

  return (
    <li className={cn(rowClass(index), 'flex flex-wrap items-center gap-x-3 gap-y-1.5')} data-testid='carehub-learning-path-person'>
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
        {p.overdue && <Chip tone='red'>Overdue</Chip>}
      </span>
      <span className='flex w-[156px] shrink-0 flex-col gap-0.5'>
        <span className='flex items-center gap-2'>
          <ProgressBar percent={p.percent} className='w-14 shrink-0' label={`${name} progress`} />
          <span className='text-xs tabular-nums text-text-secondary'>{p.percent}%</span>
        </span>
        <span className='text-[11px] text-text-tertiary'>{finishedCoursesText(p.finished_courses, p.total_courses)}</span>
      </span>
      <span className='w-[140px] shrink-0 text-left text-xs text-text-tertiary sm:text-right'>
        <span className='block'>{when}</span>
        {p.next && p.status !== 'finished' && (
          <span className='block truncate' title={`Next: ${p.next.title}`}>
            Next: {p.next.title}
          </span>
        )}
      </span>
    </li>
  );
}

type PathModal =
  | { kind: 'edit' }
  | { kind: 'assign' }
  | { kind: 'archive' }
  | { kind: 'delete' }
  | { kind: 'target'; t: PathTarget }
  | { kind: 'unassign'; t: PathTarget };

function PathDetailView({ workspaceId, pathId, perms }: { workspaceId: string; pathId: string; perms: AssignPerms }) {
  const navigate = useNavigate();
  const load = useCallback(() => aapi.path(workspaceId, pathId), [workspaceId, pathId]);
  const { data, error, reload } = useLoad(load);
  const [modal, setModal] = useState<PathModal | null>(null);
  const [filter, setFilter] = useState<PeopleFilter>('all');
  const [query, setQuery] = useState('');
  const [unarchiving, setUnarchiving] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useFlash();

  const people = useMemo(
    () => [...(data?.people || [])].sort((a, b) => peopleRank(a) - peopleRank(b) || personName(a).localeCompare(personName(b))),
    [data]
  );

  usePageTitle(learningTitle(data?.path.title || '', 'Paths', 'Assign'));
  if (error && !data) {
    return (
      <>
        <BackLink label='All paths' to={PATHS_PATH} />
        <LoadError error={error} onRetry={reload} />
      </>
    );
  }

  if (!data) return <Loading />;
  const { path, courses, targets } = data;
  const { canAssign } = perms;
  const done = (text: string) => {
    setModal(null);
    setActionError('');
    setNotice(text);
    reload();
  };
  const unarchive = () => {
    setUnarchiving(true);
    setActionError('');
    aapi.updatePath(workspaceId, path.id, { archived: false }).then(
      () => {
        setUnarchiving(false);
        done('Unarchived. Assign it to give it to people again.');
      },
      (e: unknown) => {
        setUnarchiving(false);
        setActionError(lErrorText(e));
      }
    );
  };
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
  const by = [path.created_by_name ? `Made by ${path.created_by_name}` : '', path.created_ms ? shortDate(path.created_ms) : '']
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <BackLink label='All paths' to={PATHS_PATH} />
      <div className='mb-4 flex flex-wrap items-start gap-3'>
        <div className='min-w-[min(100%,240px)] flex-1'>
          <h2 className='m-0 break-words text-xl font-semibold'>{path.title}</h2>
          <div className='mt-1 flex flex-wrap items-center gap-1.5 text-sm text-text-secondary'>
            {path.archived && <Chip>Archived</Chip>}
            <span>
              {plural(path.course_ids.length, 'course')} · {orderText(path.in_order)}
            </span>
          </div>
          {path.description.trim() && (
            <p className='m-0 mt-2 whitespace-pre-wrap break-words text-sm text-text-secondary'>{path.description.trim()}</p>
          )}
          {by && <div className='mt-1 text-[11px] text-text-tertiary'>{by}</div>}
        </div>
        {canAssign && (
          <div className='flex flex-wrap gap-2'>
            {!path.archived && (
              <Button type='button' onClick={() => setModal({ kind: 'assign' })} data-testid='carehub-learning-path-assign-open'>
                Assign
              </Button>
            )}
            <Button
              type='button'
              variant='outline'
              onClick={() => setModal({ kind: 'edit' })}
              data-testid='carehub-learning-path-edit-open'
            >
              Edit
            </Button>
            {path.archived ? (
              <Button
                type='button'
                variant='outline'
                onClick={unarchive}
                loading={unarchiving}
                data-testid='carehub-learning-path-unarchive'
              >
                Unarchive
              </Button>
            ) : (
              <Button
                type='button'
                variant='ghost'
                onClick={() => setModal({ kind: 'archive' })}
                data-testid='carehub-learning-path-archive'
              >
                Archive
              </Button>
            )}
          </div>
        )}
      </div>
      {!canAssign && (
        <div className='mb-4'>
          <ChNote>{PATHS_READ_ONLY}</ChNote>
        </div>
      )}
      {canAssign && path.archived && (
        <div className='mb-4'>
          <ChNote tone='warn'>This path is archived. Unarchive it before assigning it.</ChNote>
        </div>
      )}
      <Notice text={notice} onDismiss={() => setNotice('')} />
      {actionError && (
        <div className='mb-4'>
          <ChNote tone='error'>{actionError}</ChNote>
        </div>
      )}
      {error ? (
        <div className='mb-4'>
          <ChNote tone='error'>Couldn’t refresh: {lErrorText(error)}</ChNote>
        </div>
      ) : null}
      <div className='mb-6 flex flex-wrap gap-3'>
        <ChCard label='People' value={path.people} />
        <ChCard label='Finished' value={path.finished} />
        <ChCard label='In progress' value={path.in_progress} />
        <ChCard label='Not started' value={path.not_started} />
        <ChCard label='Overdue' value={<span className={path.overdue ? 'chl-alert' : undefined}>{path.overdue}</span>} />
      </div>

      <ChSection
        title='Courses'
        hint={path.in_order ? 'Each course opens once the one before it is finished.' : 'People can take them in any order.'}
      >
        {courses.length ? (
          <ol
            className='m-0 list-none overflow-hidden rounded-[12px] border border-border-primary p-0'
            data-testid='carehub-learning-path-steps'
          >
            {courses.map((c, i) => (
              <li key={c.id} className={cn(rowClass(i), 'flex flex-wrap items-center gap-2')}>
                <span className='w-6 shrink-0 text-sm tabular-nums text-text-tertiary'>{i + 1}.</span>
                <button
                  type='button'
                  className='min-w-0 flex-1 break-words text-left text-sm hover:underline'
                  onClick={() => navigate(assignCoursePath(c.id))}
                >
                  {c.title}
                </button>
                {c.status === 'archived' && (
                  <>
                    <Chip title={LEFT_OUT}>Archived</Chip>
                    <span className='sr-only'>{` ${LEFT_OUT}.`}</span>
                  </>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <EmptyBox>None of this path’s courses can be found any more.</EmptyBox>
        )}
      </ChSection>

      <ChSection title='Assigned to' hint={targets.length ? plural(targets.length, 'assignment') : undefined}>
        {targets.length ? (
          <List testId='carehub-learning-path-targets'>
            {targets.map((t, i) => (
              <li
                key={targetKey(t.target)}
                className={cn(rowClass(i), 'flex flex-wrap items-start gap-x-3 gap-y-2')}
                data-testid='carehub-learning-path-target'
              >
                <TargetIcon kind={t.target.kind} />
                <span className='min-w-[200px] flex-1'>
                  <span className='block text-sm'>
                    <span className='font-medium'>{targetLabel(t.target)}</span>
                    <span className='text-xs text-text-tertiary'> · {targetKindLabel(t.target.kind)}</span>
                  </span>
                  <span className='mt-1 block'>
                    <DueChips a={t} />
                  </span>
                  <span className='mt-1 block text-xs text-text-secondary'>{progressLine(t)}</span>
                  {t.note.trim() && (
                    <span className='mt-0.5 block truncate text-xs italic text-text-tertiary' title={t.note}>
                      “{t.note.trim()}”
                    </span>
                  )}
                </span>
                {canAssign && (
                  <span className='flex shrink-0 gap-1.5'>
                    <Button
                      type='button'
                      size='sm'
                      variant='outline'
                      onClick={() => setModal({ kind: 'target', t })}
                      data-testid='carehub-learning-path-target-edit'
                    >
                      Edit
                    </Button>
                    <Button
                      type='button'
                      size='sm'
                      variant='ghost'
                      onClick={() => setModal({ kind: 'unassign', t })}
                      data-testid='carehub-learning-path-target-remove'
                    >
                      Remove
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </List>
        ) : (
          <EmptyBox>
            Not assigned to anyone yet.
            {canAssign && !path.archived && (
              <div className='mt-3'>
                <Button type='button' size='sm' onClick={() => setModal({ kind: 'assign' })}>
                  Assign it
                </Button>
              </div>
            )}
          </EmptyBox>
        )}
      </ChSection>

      <ChSection title='People' hint={progressLine(path)}>
        {people.length > 0 && (
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
                    filter === f.id
                      ? 'border-border-theme-thick font-medium text-text-primary'
                      : 'border-border-primary text-text-secondary hover:bg-fill-content-hover'
                  )}
                  data-testid={`carehub-learning-path-filter-${f.id}`}
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
        )}
        {shown.length ? (
          <List testId='carehub-learning-path-people'>
            {shown.map((p, i) => (
              <PathPersonRow key={p.uid} p={p} index={i} canReports={perms.canReports} />
            ))}
          </List>
        ) : (
          <EmptyBox>{people.length ? 'No one matches.' : 'No one is on this path right now.'}</EmptyBox>
        )}
      </ChSection>

      {canAssign && (
        <div className='mt-8 border-t border-border-primary pt-4'>
          <Button
            type='button'
            variant='destructive-outline'
            onClick={() => setModal({ kind: 'delete' })}
            data-testid='carehub-learning-path-delete'
          >
            Delete path
          </Button>
        </div>
      )}

      {modal?.kind === 'edit' && (
        <PathEditorDialog
          workspaceId={workspaceId}
          perms={perms}
          detail={data}
          onClose={() => setModal(null)}
          onSaved={(_id, text) => done(text)}
        />
      )}
      {modal?.kind === 'assign' && (
        <AssignDialog
          workspaceId={workspaceId}
          path={{ id: path.id, title: path.title }}
          onClose={() => setModal(null)}
          onAssigned={done}
        />
      )}
      {modal?.kind === 'target' && (
        <PathTargetDialog workspaceId={workspaceId} path={path} t={modal.t} onClose={() => setModal(null)} onSaved={done} />
      )}
      {modal?.kind === 'unassign' && (
        <Confirm
          title='Remove this assignment?'
          confirmLabel='Remove'
          testId='carehub-learning-path-unassign'
          onClose={() => setModal(null)}
          onConfirm={() =>
            aapi
              .unassignPath(workspaceId, path.id, [{ kind: modal.t.target.kind, id: modal.t.target.id }])
              .then(() => done(`Removed. “${path.title}” is no longer assigned to ${targetLabel(modal.t.target)}.`))
          }
        >
          <p className='m-0'>
            “{path.title}” will no longer be assigned to {modal.t.target.kind === 'everyone' ? 'everyone' : targetLabel(modal.t.target)}
            {modal.t.people ? ` (${plural(modal.t.people, 'person', 'people')})` : ''}.
          </p>
          <p className='m-0'>The progress people made is kept, and the due date comes off their calendars.</p>
        </Confirm>
      )}
      {modal?.kind === 'archive' && (
        <Confirm
          title={`Archive “${path.title}”?`}
          confirmLabel='Archive'
          testId='carehub-learning-path-archive-confirm'
          onClose={() => setModal(null)}
          onConfirm={() =>
            aapi.updatePath(workspaceId, path.id, { archived: true }).then(() => done('Archived. People keep their progress.'))
          }
        >
          <p className='m-0'>It comes off everyone’s My learning and its assignments are removed. People keep their progress.</p>
          <p className='m-0'>If you unarchive it later, assign it again to give it to people.</p>
        </Confirm>
      )}
      {modal?.kind === 'delete' && (
        <Confirm
          title={`Delete “${path.title}”?`}
          confirmLabel='Delete path'
          testId='carehub-learning-path-delete-confirm'
          onClose={() => setModal(null)}
          onConfirm={() =>
            aapi.deletePath(workspaceId, path.id).then(() => {
              setFlash(`Deleted “${path.title}”.`);
              navigate(PATHS_PATH);
            })
          }
        >
          <p className='m-0'>People keep their progress, but the path and its assignments are removed.</p>
        </Confirm>
      )}
    </>
  );
}

/** The Paths tab (route `assign/paths/*`): the list, or one path's page. */
export function LearningPathsPage({ workspaceId, canAssign, canBuild, canReports }: { workspaceId: string } & AssignPerms) {
  const location = useLocation();
  const perms: AssignPerms = { canAssign, canBuild, canReports };
  const rest = location.pathname.startsWith(PATHS_PATH) ? location.pathname.slice(PATHS_PATH.length) : '';
  const parts = rest.split('/').filter(Boolean);
  let view = null;

  if (!parts.length) view = <PathsListView workspaceId={workspaceId} perms={perms} />;
  else if (parts.length === 1 && UUID_RE.test(parts[0]))
    view = <PathDetailView key={parts[0]} workspaceId={workspaceId} pathId={parts[0]} perms={perms} />;
  else return <Navigate to={PATHS_PATH} replace />;

  return (
    <div data-testid='carehub-learning-assign'>
      <AssignStyle />
      {view}
    </div>
  );
}

// ---------------------------------------------------------------------------
// My learning: "Your learning paths"
// ---------------------------------------------------------------------------

/**
 * The caller's learning paths. `undefined` while loading (for up to 4 seconds), `null` when they couldn't be loaded
 * (e.g. the server doesn't have paths yet) — then My learning simply doesn't show the section.
 */
export function useMyPaths(workspaceId: string, reload = 0): MyPath[] | null | undefined {
  const key = `${workspaceId}:${reload}`;
  const [state, setState] = useState<{ key: string; list: MyPath[] | null } | null>(null);
  const [slow, setSlow] = useState('');

  useEffect(() => {
    if (!workspaceId) return undefined;
    let alive = true;
    const timer = window.setTimeout(() => {
      if (alive) setSlow(key);
    }, 4000);

    aapi.myPaths(workspaceId).then(
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

function stepFinished(s: MyPathStep) {
  return s.status === 'completed' || s.status === 'passed';
}

function stepChip(s: MyPathStep) {
  if (s.status === 'not_started') return { label: 'Not started', tone: 'gray' as const };
  return statusInfo({ status: s.status, awaiting_ack: false });
}

function PathStepRow({ s, index, blocker, onOpen }: { s: MyPathStep; index: number; blocker: MyPathStep | null; onOpen: () => void }) {
  const finished = stepFinished(s);
  const chip = stepChip(s);
  const marker = (
    <span
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-medium',
        finished ? 'chl-green' : 'bg-fill-content-hover text-text-secondary'
      )}
      aria-hidden='true'
    >
      {finished ? '✓' : s.locked ? '🔒' : index + 1}
    </span>
  );

  if (s.locked) {
    return (
      <li className='flex items-start gap-2.5 px-2 py-1.5' data-testid='carehub-learning-path-step'>
        {marker}
        <span className='min-w-0 flex-1'>
          <span className='block break-words text-sm text-text-secondary'>{s.title}</span>
          <span className='block text-xs text-text-tertiary'>
            Opens after you finish “{blocker ? blocker.title : 'the course before it'}”
          </span>
        </span>
      </li>
    );
  }

  return (
    <li>
      <button
        type='button'
        onClick={onOpen}
        className='flex w-full items-start gap-2.5 rounded-[8px] px-2 py-1.5 text-left hover:bg-fill-content-hover'
        data-testid='carehub-learning-path-step'
      >
        {marker}
        <span className='min-w-0 flex-1 break-words pt-0.5 text-sm'>{s.title}</span>
        {!finished && s.status !== 'not_started' && (
          <span className='shrink-0 pt-0.5 text-xs tabular-nums text-text-secondary'>{s.percent}%</span>
        )}
        <span className='shrink-0 pt-0.5'>
          <Chip tone={chip.tone}>{chip.label}</Chip>
        </span>
      </button>
    </li>
  );
}

function PathCard({ p, onOpen }: { p: MyPath; onOpen: (courseId: string) => void }) {
  const finished = p.status === 'finished';
  const [open, setOpen] = useState(!finished);
  const due = finished ? null : dueChip({ due_ms: p.due_ms, overdue: p.overdue }, false);
  const next = finished ? null : p.next;
  const nextStep = next ? p.steps.find((s) => s.course_id === next.course_id) || null : null;
  const verb = nextStep && nextStep.status !== 'not_started' ? 'Continue' : 'Start';
  const note = p.note.trim();
  // A locked step waits for the nearest unfinished step before it.
  const blockerOf = (i: number) => {
    for (let j = i - 1; j >= 0; j -= 1) if (!stepFinished(p.steps[j])) return p.steps[j];
    return i > 0 ? p.steps[i - 1] : null;
  };

  return (
    <li
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-[14px] border border-border-primary p-3.5',
        p.overdue && !finished && 'chl-overdue'
      )}
      data-testid='carehub-learning-my-path'
    >
      <div className='flex min-w-0 items-start gap-3'>
        <div className='text-2xl leading-none' aria-hidden='true'>
          🧭
        </div>
        <div className='min-w-0 flex-1'>
          <h3 className='m-0 break-words text-[15px] font-medium'>{p.title}</h3>
          <div className='mt-1 flex flex-wrap items-center gap-1'>
            {finished ? (
              <Chip tone='green'>✓ Finished</Chip>
            ) : (
              due && (
                <Chip tone={due.tone} title={p.due_ms !== null ? `Due ${new Date(p.due_ms).toLocaleDateString()}` : undefined}>
                  {due.label}
                  {due.date && <span className='sr-only sm:not-sr-only'> · {due.date}</span>}
                </Chip>
              )
            )}
            <Chip tone={p.required ? 'purple' : 'gray'}>{p.required ? 'Required' : 'Optional'}</Chip>
            {!p.in_order && <Chip>Any order</Chip>}
          </div>
          {p.description.trim() && <p className='chl-clamp2 m-0 mt-1.5 text-sm text-text-secondary'>{p.description.trim()}</p>}
          {note && (
            <div className='mt-1 truncate text-xs italic text-text-secondary' title={note}>
              “{note}”
            </div>
          )}
        </div>
      </div>
      <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
        <ProgressBar percent={p.percent} className='min-w-[120px] flex-1' label={`${p.title} progress`} />
        <span className='shrink-0 text-xs text-text-secondary' data-testid='carehub-learning-my-path-count'>
          {finishedCoursesText(p.finished_courses, p.total_courses)}
        </span>
      </div>
      {open && (
        <ol className='-mx-1 m-0 flex list-none flex-col gap-0.5 p-0' aria-label={`Courses in “${p.title}”`}>
          {p.steps.map((s, i) => (
            <PathStepRow key={s.course_id} s={s} index={i} blocker={s.locked ? blockerOf(i) : null} onOpen={() => onOpen(s.course_id)} />
          ))}
        </ol>
      )}
      <div className='flex flex-wrap items-center gap-2'>
        {next && (
          <Button
            type='button'
            size='sm'
            onClick={() => onOpen(next.course_id)}
            className='max-w-full'
            data-testid='carehub-learning-my-path-next'
          >
            <span className='truncate'>
              {verb} “{next.title}”
            </span>
          </Button>
        )}
        <span className='flex-1' />
        <button
          type='button'
          className='rounded-[6px] px-1 text-xs text-text-secondary underline hover:text-text-primary'
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Hide the courses' : 'Show the courses'}
        </button>
      </div>
    </li>
  );
}

/** The "Your learning paths" section: unfinished paths first (as the server sorts them), finished ones after. */
export function YourLearningPaths({ paths, onOpen }: { paths: MyPath[]; onOpen: (courseId: string) => void }) {
  const [showAllDone, setShowAllDone] = useState(false);

  if (!paths.length) return null;
  const todo = paths.filter((p) => p.status !== 'finished');
  const done = paths.filter((p) => p.status === 'finished');
  const overdue = todo.filter((p) => p.overdue).length;
  const shownDone = showAllDone ? done : done.slice(0, todo.length ? 1 : 2);
  const hint = todo.length ? `${todo.length} to do${overdue ? ` · ${overdue} overdue` : ''}` : 'All done — nice work!';

  return (
    <>
      <AssignStyle />
      <ChSection title='Your learning paths' hint={hint}>
        <ul className='m-0 grid list-none grid-cols-1 items-start gap-3 p-0 md:grid-cols-2' data-testid='carehub-learning-my-paths'>
          {[...todo, ...shownDone].map((p) => (
            <PathCard key={p.id} p={p} onOpen={onOpen} />
          ))}
        </ul>
        {done.length > shownDone.length && (
          <button type='button' className='mt-2 text-sm text-text-secondary underline' onClick={() => setShowAllDone(true)}>
            Show {done.length - shownDone.length} more finished
          </button>
        )}
      </ChSection>
    </>
  );
}

// CareHub Learning Studio: the course list and the course editor (lessons, blocks, final quiz, settings,
// preview, publish, versions). Drafts autosave about 1.5 s after the last change; learners only ever see
// published versions.
import { useEffect, useMemo, useRef, useState } from 'react';

import type { ReactNode } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { formatWhen, UUID_RE } from './CareHubCore';
import {
  applyPreset,
  blankBlock,
  blankLesson,
  blankQuestion,
  cloneBlock,
  cloneLesson,
  cloneQuestion,
  DEFAULT_ACK,
  estimateMinutes,
  formatMinutes,
  isTransientError,
  lapi,
  LEARNING_PATH,
  learningNotLive,
  lErrorText,
  plural,
  presetInfo,
  PRESETS,
  starterContent,
  validateContent,
} from './CareHubLearningApi';
import { Chip, CourseCover } from './CareHubLearningBlocks';
import { LinkCourseContext } from './CareHubLearningBlocks3';
import { useStudioReview, WithCommentCount } from './CareHubLearningDrafts';
import { EXAMPLES } from './CareHubLearningExample';
import { INTERACT_KIND_OPTIONS } from './CareHubLearningInteract';
import { PasteTextDialog } from './CareHubLearningPaste';
import { CareHubLearningPlayer } from './CareHubLearningPlayer';
import {
  AddButton,
  BlockCard,
  BlockLibrary,
  CopyIcon,
  DragGrip,
  DropLine,
  Field,
  IconButton,
  MediaField,
  NumberField,
  PicturePicker,
  QuestionEditor,
  TextBox,
  TextLine,
  Toggle,
  UploadContext,
  useDragSort,
} from './CareHubLearningStudioBlocks';
import { CareHubModal, ChNote, ChSection, ChSelect } from './CareHubUi';

import type { ExampleCourse } from './CareHubLearningExample';
import type {
  Block,
  BlockType,
  Completion,
  Content,
  CourseSettings,
  CourseStatus,
  Lesson,
  Preset,
  Question,
  QuestionKind,
  Quiz,
  ShowAnswers,
  StudioCourse,
  StudioRow,
  VersionRow,
} from './CareHubLearningApi';

const STUDIO_PATH = `${LEARNING_PATH}/studio`;
const MAX_DRAFT_CHARS = 4 * 1024 * 1024;
const TOO_BIG_TEXT = 'This course is too big to save (over 4 MB). Use links for big images and videos.';

const COMPLETIONS: { value: Completion; label: string }[] = [
  { value: 'all_lessons', label: 'Finish every lesson' },
  { value: 'all_lessons_and_quiz', label: 'Finish every lesson and pass the quiz' },
  { value: 'pass_quiz', label: 'Pass the quiz (lessons are optional)' },
];
const SHOW_ANSWERS: { value: ShowAnswers; label: string }[] = [
  { value: 'after_pass', label: 'After they pass (or run out of tries)' },
  { value: 'after_submit', label: 'After every attempt' },
  { value: 'never', label: 'Never' },
];
const QUESTION_BUTTONS: { value: QuestionKind; label: string }[] = [
  { value: 'single', label: 'One right answer' },
  { value: 'multiple', label: 'Several right answers' },
  { value: 'true_false', label: 'True or false' },
  { value: 'matching', label: 'Matching' },
  ...INTERACT_KIND_OPTIONS,
];

function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);

  next.splice(to, 0, item);
  return next;
}

function learnerLink(courseId: string) {
  return `${window.location.origin}${LEARNING_PATH}/course/${courseId}`;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');

      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');

      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function CopyLinkButton({ courseId }: { courseId: string }) {
  const [copied, setCopied] = useState<'' | 'yes' | 'no'>('');

  return (
    <Button
      type='button'
      size='sm'
      variant='outline'
      onClick={() => {
        void copyText(learnerLink(courseId)).then((ok) => {
          setCopied(ok ? 'yes' : 'no');
          window.setTimeout(() => setCopied(''), 2000);
        });
      }}
    >
      {copied === 'yes' ? 'Copied ✓' : copied === 'no' ? 'Couldn’t copy' : 'Copy learner link'}
    </Button>
  );
}

function StatusChips({ status, version, unpublished }: { status: CourseStatus; version: number | null; unpublished: boolean }) {
  return (
    <span className='inline-flex flex-wrap items-center gap-1'>
      {status === 'archived' ? (
        <Chip tone='amber'>Archived</Chip>
      ) : status === 'published' ? (
        <Chip tone='green'>{`Published${version ? ` · v${version}` : ''}`}</Chip>
      ) : (
        <Chip>Draft</Chip>
      )}
      {unpublished && version !== null && <Chip tone='blue'>Unpublished changes</Chip>}
    </span>
  );
}

function PresetPicker({ value, onChange }: { value: Preset; onChange: (p: Preset) => void }) {
  return (
    <div role='radiogroup' aria-label='Course type' className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
      {PRESETS.map((p) => (
        <button
          key={p.id}
          type='button'
          role='radio'
          aria-checked={value === p.id}
          onClick={() => onChange(p.id)}
          className={cn(
            'flex items-start gap-2.5 rounded-[10px] border px-3 py-2.5 text-left',
            value === p.id ? 'border-border-theme-thick bg-fill-content-hover' : 'border-border-primary hover:bg-fill-content-hover'
          )}
        >
          <span className='text-lg leading-6' aria-hidden='true'>
            {p.emoji}
          </span>
          <span className='min-w-0 flex-1'>
            <span className='block text-sm font-medium'>{p.label}</span>
            <span className='block text-xs text-text-tertiary'>{p.hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function ConfirmModal({
  title,
  children,
  confirmLabel,
  danger,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  error?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <CareHubModal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button type='button' variant='ghost' onClick={onClose}>
            Cancel
          </Button>
          <Button type='button' variant={danger ? 'destructive' : 'default'} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-3 text-sm'>
        {children}
        {error && <ChNote tone='error'>{error}</ChNote>}
      </div>
    </CareHubModal>
  );
}

// ---------------------------------------------------------------------------
// Course list
// ---------------------------------------------------------------------------

function NewCourseModal({
  busy,
  error,
  onCreate,
  onClose,
}: {
  busy: boolean;
  error: string;
  onCreate: (title: string, preset: Preset) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [preset, setPreset] = useState<Preset>('standard');
  const submit = () => {
    if (title.trim() && !busy) onCreate(title.trim(), preset);
  };

  return (
    <CareHubModal
      title='New course'
      wide
      onClose={onClose}
      testId='carehub-learning-new-course'
      footer={
        <>
          <Button type='button' variant='ghost' onClick={onClose}>
            Cancel
          </Button>
          <Button type='button' loading={busy} disabled={!title.trim()} onClick={submit} data-testid='carehub-learning-create'>
            Create course
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-4'>
        <div
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        >
          <Field label='Course title'>
            <TextLine value={title} onChange={setTitle} placeholder='e.g. Handling refunds' maxLength={200} autoFocus />
          </Field>
        </div>
        <div>
          <div className='mb-2 text-xs font-medium text-text-secondary'>Start with</div>
          <PresetPicker value={preset} onChange={setPreset} />
          <div className='mt-2 text-xs text-text-tertiary'>You can change any of this later in the course settings.</div>
        </div>
        {error && <ChNote tone='error'>{error}</ChNote>}
      </div>
    </CareHubModal>
  );
}

function ExamplePickerModal({
  busy,
  error,
  onPick,
  onClose,
}: {
  /** The course type of the example being created, or ''. */
  busy: Preset | '';
  error: string;
  onPick: (example: ExampleCourse) => void;
  onClose: () => void;
}) {
  return (
    <CareHubModal
      title='Start from an example'
      wide
      onClose={onClose}
      testId='carehub-learning-examples'
      footer={
        <Button type='button' variant='ghost' onClick={onClose}>
          Cancel
        </Button>
      }
    >
      <div className='flex flex-col gap-3'>
        <p className='text-sm text-text-secondary'>
          There’s one example for each kind of course. Pick one to get your own copy as a draft — change anything you like before you publish it.
        </p>
        <ul className='m-0 flex list-none flex-col gap-2 p-0' aria-label='Example courses'>
          {EXAMPLES.map((ex, i) => {
            const info = presetInfo(ex.preset);
            const mine = busy === ex.preset;

            return (
              <li key={ex.preset}>
                <button
                  type='button'
                  autoFocus={i === 0}
                  disabled={Boolean(busy)}
                  aria-busy={mine || undefined}
                  onClick={() => onPick(ex)}
                  data-testid={`carehub-learning-example-${ex.preset}`}
                  className={cn(
                    'flex min-h-[44px] w-full items-start gap-2.5 rounded-[10px] border px-3 py-2.5 text-left',
                    mine ? 'border-border-theme-thick bg-fill-content-hover' : 'border-border-primary hover:bg-fill-content-hover',
                    busy && !mine && 'opacity-60'
                  )}
                >
                  <span className='text-lg leading-6' aria-hidden='true'>
                    {info.emoji}
                  </span>
                  <span className='min-w-0 flex-1'>
                    <span className='block text-sm font-medium'>{ex.title}</span>
                    <span className='block text-xs text-text-tertiary'>
                      {info.label} · {ex.description}
                    </span>
                  </span>
                  {mine && <span className='shrink-0 text-xs text-text-secondary'>Creating…</span>}
                </button>
              </li>
            );
          })}
        </ul>
        {error && <ChNote tone='error'>{error}</ChNote>}
      </div>
    </CareHubModal>
  );
}

function StudioRowView({
  row,
  busy,
  onEdit,
  onDuplicate,
  onArchive,
  onDelete,
  onReport,
}: {
  row: StudioRow;
  busy: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onArchive: (archived: boolean) => void;
  onDelete: () => void;
  onReport?: () => void;
}) {
  const everPublished = row.published_version !== null;
  const who = row.updated_by_name || row.created_by_name;

  return (
    <div className='flex flex-col gap-2 rounded-[12px] border border-border-primary p-3 sm:flex-row sm:items-center' data-testid='carehub-learning-studio-row'>
      <button type='button' className='min-w-0 flex-1 text-left' onClick={onEdit}>
        <span className='flex min-w-0 flex-wrap items-center gap-2'>
          <span className='min-w-0 break-words font-medium'>{row.title}</span>
          <StatusChips status={row.status} version={row.published_version} unpublished={row.has_unpublished_changes} />
        </span>
        <span className='mt-0.5 block text-xs text-text-tertiary'>
          {row.updated_ms ? `Edited ${formatWhen(row.updated_ms)}${who ? ` by ${who}` : ''}` : who ? `By ${who}` : ''}
          {everPublished ? ` · ${row.started} started · ${row.finished} finished` : ''}
        </span>
      </button>
      <div className='flex flex-wrap gap-1.5'>
        <Button type='button' size='sm' onClick={onEdit}>
          Edit
        </Button>
        <Button type='button' size='sm' variant='outline' disabled={busy} onClick={onDuplicate}>
          Duplicate
        </Button>
        {everPublished && onReport && (
          <Button type='button' size='sm' variant='ghost' onClick={onReport} data-testid='carehub-learning-studio-report'>
            Report
          </Button>
        )}
        {row.status === 'published' && (
          <Button type='button' size='sm' variant='ghost' disabled={busy} onClick={() => onArchive(true)}>
            Archive
          </Button>
        )}
        {row.status === 'archived' && (
          <Button type='button' size='sm' variant='ghost' disabled={busy} onClick={() => onArchive(false)}>
            Unarchive
          </Button>
        )}
        {!everPublished && row.status === 'draft' && (
          <Button type='button' size='sm' variant='ghost' disabled={busy} onClick={onDelete}>
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}

export function LearningStudioHome({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<StudioRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reload, setReload] = useState(0);
  const [newOpen, setNewOpen] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [picked, setPicked] = useState<Preset | ''>('');
  const [creating, setCreating] = useState<'' | 'new' | 'example'>('');
  const [createError, setCreateError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [toDelete, setToDelete] = useState<StudioRow | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    let alive = true;

    setError(null);
    lapi.studioList(workspaceId).then(
      (r) => {
        if (alive) setRows(r);
      },
      (e: unknown) => {
        if (alive) setError(e || new Error('Something went wrong. Please try again.'));
      }
    );
    return () => {
      alive = false;
    };
  }, [workspaceId, reload]);

  const create = async (kind: 'new' | 'example', title: string, preset: Preset, content: Content) => {
    setCreating(kind);
    setCreateError('');
    setNotice(null);
    try {
      const id = await lapi.studioCreate(workspaceId, { title, preset, content });

      if (!id) throw new Error('Couldn’t create the course. Please try again.');
      navigate(`${STUDIO_PATH}/${id}`);
    } catch (e) {
      const text = lErrorText(e);

      setCreateError(text);
      if (kind === 'example') setNotice({ tone: 'error', text });
      setCreating('');
    }
  };

  const act = async (row: StudioRow, run: () => Promise<unknown>, done: string) => {
    setBusyId(row.id);
    setNotice(null);
    try {
      await run();
      setNotice({ tone: 'ok', text: done });
      setReload((n) => n + 1);
    } catch (e) {
      setNotice({ tone: 'error', text: lErrorText(e) });
    } finally {
      setBusyId('');
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setBusyId(toDelete.id);
    setDeleteError('');
    try {
      await lapi.remove(workspaceId, toDelete.id);
      setNotice({ tone: 'ok', text: `Deleted “${toDelete.title}”.` });
      setToDelete(null);
      setReload((n) => n + 1);
    } catch (e) {
      setDeleteError(lErrorText(e));
    } finally {
      setBusyId('');
    }
  };

  if (error) {
    return (
      <div className='flex flex-col items-start gap-3'>
        <ChNote tone={learningNotLive(error) ? 'info' : 'error'}>{lErrorText(error)}</ChNote>
        <Button type='button' variant='outline' onClick={() => setReload((n) => n + 1)}>
          Try again
        </Button>
      </div>
    );
  }

  const active = (rows || []).filter((r) => r.status !== 'archived');
  const archived = (rows || []).filter((r) => r.status === 'archived');
  const list = showArchived ? [...active, ...archived] : active;

  return (
    <div data-testid='carehub-learning-studio'>
      <div className='mb-4 flex flex-wrap items-center gap-2'>
        <div className='min-w-0 flex-1 text-sm text-text-secondary'>Build courses from blocks, preview them, then publish.</div>
        <Button
          type='button'
          variant='outline'
          disabled={Boolean(creating)}
          onClick={() => {
            setCreateError('');
            setExamplesOpen(true);
          }}
          data-testid='carehub-learning-examples-open'
        >
          Start from an example
        </Button>
        <Button
          type='button'
          disabled={Boolean(creating)}
          onClick={() => {
            setCreateError('');
            setNewOpen(true);
          }}
          data-testid='carehub-learning-new'
        >
          + New course
        </Button>
      </div>
      {notice && (
        <div className='mb-4'>
          <ChNote tone={notice.tone}>{notice.text}</ChNote>
        </div>
      )}
      {!rows ? (
        <div className='text-sm text-text-tertiary'>Loading…</div>
      ) : !rows.length ? (
        <div className='rounded-[16px] border border-dashed border-border-primary px-5 py-10 text-center'>
          <div className='text-4xl' aria-hidden='true'>
            🧱
          </div>
          <div className='mt-3 text-lg font-semibold'>No courses yet</div>
          <p className='mx-auto mt-1 max-w-[440px] text-sm text-text-secondary'>
            Create your first course, or start from an example to see how each kind of course works.
          </p>
        </div>
      ) : (
        <div className='flex flex-col gap-2'>
          {list.map((r) => (
            <StudioRowView
              key={r.id}
              row={r}
              busy={busyId === r.id}
              onEdit={() => navigate(`${STUDIO_PATH}/${r.id}`)}
              onDuplicate={() =>
                void act(r, () => lapi.duplicate(workspaceId, r.id), `Made a copy of “${r.title}”. It’s a draft until you publish it.`)
              }
              onArchive={(on) =>
                void act(
                  r,
                  () => lapi.archive(workspaceId, r.id, on),
                  on
                    ? `Archived “${r.title}”. Learners can’t open it any more; their records are kept.`
                    : `“${r.title}” is available to learners again.`
                )
              }
              onDelete={() => {
                setDeleteError('');
                setToDelete(r);
              }}
              onReport={() => navigate(`${LEARNING_PATH}/reports/course/${r.id}`)}
            />
          ))}
          {archived.length > 0 && (
            <button type='button' className='self-start px-1 py-1 text-sm text-text-secondary underline' onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? 'Hide archived courses' : `Show archived courses (${archived.length})`}
            </button>
          )}
        </div>
      )}
      {examplesOpen && (
        <ExamplePickerModal
          busy={creating === 'example' ? picked : ''}
          error={createError}
          onClose={() => setExamplesOpen(false)}
          onPick={(ex) => {
            const content = ex.build();

            setPicked(ex.preset);
            void create('example', content.title, content.preset, content);
          }}
        />
      )}
      {newOpen && (
        <NewCourseModal
          busy={creating === 'new'}
          error={createError}
          onClose={() => setNewOpen(false)}
          onCreate={(title, preset) => void create('new', title, preset, starterContent(preset, title))}
        />
      )}
      {toDelete && (
        <ConfirmModal
          title='Delete this course?'
          confirmLabel='Delete course'
          danger
          busy={busyId === toDelete.id}
          error={deleteError}
          onConfirm={() => void confirmDelete()}
          onClose={() => setToDelete(null)}
        >
          <p>
            “{toDelete.title}” has never been published, so nobody has taken it. Deleting it can’t be undone.
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialogs used by the editor
// ---------------------------------------------------------------------------

function PreviewModal({
  workspaceId,
  courseId,
  content,
  startLessonId,
  label,
  onClose,
}: {
  workspaceId: string;
  courseId: string;
  content: Content;
  startLessonId?: string;
  label: string;
  onClose: () => void;
}) {
  const [phone, setPhone] = useState(false);

  return (
    <CareHubModal title={label} wide='xl' onClose={onClose} testId='carehub-learning-preview'>
      <div className='mb-3 flex justify-center'>
        <div className='inline-flex rounded-[10px] border border-border-primary p-0.5' role='group' aria-label='Screen size'>
          {[
            { id: false, text: '🖥️ Desktop' },
            { id: true, text: '📱 Phone' },
          ].map((o) => (
            <button
              key={String(o.id)}
              type='button'
              aria-pressed={phone === o.id}
              onClick={() => setPhone(o.id)}
              className={cn(
                'rounded-[8px] px-3 py-1 text-sm',
                phone === o.id ? 'bg-fill-content-hover font-medium text-text-primary' : 'text-text-secondary hover:text-text-primary'
              )}
            >
              {o.text}
            </button>
          ))}
        </div>
      </div>
      <div className={cn(phone ? 'mx-auto w-[375px] max-w-full rounded-[24px] border-[6px] border-border-primary px-3 py-4' : 'w-full')}>
        <CareHubLearningPlayer workspaceId={workspaceId} courseId={courseId} preview={content} startLessonId={startLessonId} />
      </div>
    </CareHubModal>
  );
}

function PublishModal({
  courseId,
  draft,
  everPublished,
  learnersStarted,
  onPublish,
  onClose,
}: {
  courseId: string;
  draft: Content;
  everPublished: boolean;
  learnersStarted: boolean;
  onPublish: (note: string) => Promise<number>;
  onClose: () => void;
}) {
  const problems = useMemo(() => validateContent(draft), [draft]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<number | null>(null);

  const go = async () => {
    setBusy(true);
    setError('');
    try {
      setDone(await onPublish(note));
    } catch (e) {
      setError(lErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (done !== null) {
    return (
      <CareHubModal
        title='Published 🎉'
        onClose={onClose}
        footer={
          <Button type='button' onClick={onClose}>
            Done
          </Button>
        }
      >
        <div className='flex flex-col gap-3 text-sm'>
          <p>
            Version {done} of “{draft.title.trim() || 'this course'}” is live.
            {draft.settings.catalog ? ' Everyone in the workspace can find it in the Catalog.' : ' It isn’t in the Catalog, so share the link.'}
          </p>
          <div>
            <CopyLinkButton courseId={courseId} />
          </div>
        </div>
      </CareHubModal>
    );
  }

  return (
    <CareHubModal
      title={everPublished ? 'Publish changes' : 'Publish course'}
      onClose={onClose}
      wide
      footer={
        <>
          <Button type='button' variant='ghost' onClick={onClose}>
            Cancel
          </Button>
          <Button type='button' loading={busy} onClick={() => void go()} data-testid='carehub-learning-publish-confirm'>
            Publish
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-3 text-sm'>
        {problems.length > 0 ? (
          <ChNote tone='warn'>
            <div className='font-medium'>Fix {problems.length === 1 ? 'this' : 'these'} first:</div>
            <ul className='mt-1 list-disc pl-5'>
              {problems.slice(0, 8).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            {problems.length > 8 && <div className='mt-1'>…and {problems.length - 8} more.</div>}
          </ChNote>
        ) : (
          <ChNote tone='ok'>Everything looks ready.</ChNote>
        )}
        <p className='text-text-secondary'>
          {everPublished
            ? learnersStarted
              ? 'People who already started keep the version they started. Everyone else gets this new version.'
              : 'Learners will get this new version.'
            : 'Once published, people in this workspace can take the course.'}
        </p>
        <Field label='What changed? (optional)'>
          <TextLine value={note} onChange={setNote} placeholder='e.g. Updated the refund steps' maxLength={300} />
        </Field>
        {error && <ChNote tone='error'>{error}</ChNote>}
      </div>
    </CareHubModal>
  );
}

function VersionsModal({
  workspaceId,
  courseId,
  versions,
  onPreview,
  beforeRestore,
  onRestored,
  onClose,
}: {
  workspaceId: string;
  courseId: string;
  versions: VersionRow[];
  onPreview: (content: Content, label: string) => void;
  beforeRestore: () => Promise<void>;
  onRestored: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<VersionRow | null>(null);

  const preview = async (v: VersionRow) => {
    setBusy(v.version);
    setError('');
    try {
      const d = await lapi.version(workspaceId, courseId, v.version);

      onPreview(d.content, `Version ${v.version}`);
    } catch (e) {
      setError(lErrorText(e));
    } finally {
      setBusy(null);
    }
  };

  const restore = async (v: VersionRow) => {
    setBusy(v.version);
    setError('');
    try {
      await beforeRestore();
      await lapi.rollback(workspaceId, courseId, v.version);
      onRestored();
    } catch (e) {
      setError(lErrorText(e));
      setBusy(null);
    }
  };

  if (confirm) {
    return (
      <ConfirmModal
        title={`Restore version ${confirm.version}?`}
        confirmLabel='Restore to draft'
        busy={busy === confirm.version}
        error={error}
        onConfirm={() => void restore(confirm)}
        onClose={() => setConfirm(null)}
      >
        <p>This replaces the current draft with version {confirm.version}. Learners keep seeing the published version until you publish again.</p>
      </ConfirmModal>
    );
  }

  return (
    <CareHubModal title='Versions' wide onClose={onClose}>
      <div className='flex flex-col gap-2 text-sm'>
        {!versions.length ? (
          <div className='py-4 text-center text-text-tertiary'>Nothing published yet. Each time you publish, a version is saved here.</div>
        ) : (
          versions.map((v, i) => (
            <div key={v.version} className='flex flex-col gap-2 rounded-[10px] border border-border-primary p-3 sm:flex-row sm:items-center'>
              <div className='min-w-0 flex-1'>
                <div className='font-medium'>
                  Version {v.version}
                  {i === 0 ? <span className='ml-2 font-normal text-text-tertiary'>· live now</span> : null}
                </div>
                <div className='text-xs text-text-tertiary'>
                  {formatWhen(v.published_ms)}
                  {v.published_by_name ? ` by ${v.published_by_name}` : ''}
                </div>
                {v.note && <div className='mt-1 break-words text-text-secondary'>{v.note}</div>}
              </div>
              <div className='flex flex-wrap gap-1.5'>
                <Button type='button' size='sm' variant='outline' loading={busy === v.version} disabled={busy !== null} onClick={() => void preview(v)}>
                  Preview
                </Button>
                <Button type='button' size='sm' variant='ghost' disabled={busy !== null} onClick={() => setConfirm(v)}>
                  Restore to draft
                </Button>
              </div>
            </div>
          ))
        )}
        {error && <ChNote tone='error'>{error}</ChNote>}
      </div>
    </CareHubModal>
  );
}
// ---------------------------------------------------------------------------
// Course editor
// ---------------------------------------------------------------------------

type SaveState = 'saved' | 'pending' | 'saving' | 'retrying';
type Problem = '' | 'stale' | 'too_big' | 'error';
type Selected = { kind: 'settings' } | { kind: 'quiz' } | { kind: 'lesson'; id: string };
type EditorModal =
  | { kind: 'preview'; content: Content; label: string; startLessonId?: string; back?: 'versions' }
  | { kind: 'publish' }
  | { kind: 'versions' }
  | { kind: 'library'; lessonId: string; index: number }
  | { kind: 'paste'; lessonId: string }
  | { kind: 'delete_lesson'; lessonId: string }
  | null;

interface Meta {
  status: CourseStatus;
  published_version: number | null;
  has_unpublished_changes: boolean;
  versions: VersionRow[];
}

function metaOf(c: StudioCourse): Meta {
  return {
    status: c.status,
    published_version: c.published_version,
    has_unpublished_changes: c.has_unpublished_changes,
    versions: c.versions,
  };
}

/** A quiz that's switched on always has at least one question to edit. */
function withQuizQuestion(c: Content): Content {
  return c.quiz.enabled && !c.quiz.questions.length ? { ...c, quiz: { ...c.quiz, questions: [blankQuestion('single')] } } : c;
}

function lessonName(l: Lesson, i: number) {
  return l.title.trim() || `Lesson ${i + 1}`;
}

function secondsText(n: number) {
  if (n < 60) return plural(n, 'second');
  const m = Math.floor(n / 60);
  const s = n % 60;

  return s ? `${m} min ${s} s` : `${m} min`;
}

function insertAt<T>(list: T[], index: number, item: T): T[] {
  const next = list.slice();

  next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
  return next;
}

/** True while the element is narrower than `below` pixels. */
function useNarrow(ref: { current: HTMLElement | null }, below: number) {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < below);

  useEffect(() => {
    const el = ref.current;

    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const check = () => setNarrow(el.clientWidth < below);
    const ro = new ResizeObserver(check);

    ro.observe(el);
    check();
    return () => ro.disconnect();
  }, [ref, below]);

  return narrow;
}

function BackToStudio({ onClick }: { onClick: () => void }) {
  return (
    <button
      type='button'
      onClick={onClick}
      className='rounded-[8px] px-1.5 py-1 text-sm text-text-secondary hover:bg-fill-content-hover hover:text-text-primary'
      data-testid='carehub-learning-back-to-studio'
    >
      ← Studio
    </button>
  );
}

export function LearningStudioEditor({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate();
  const { courseId = '' } = useParams();
  const valid = UUID_RE.test(courseId);
  const [attempt, setAttempt] = useState(0);
  const key = `${courseId}:${attempt}`;
  const [loaded, setLoaded] = useState<{ key: string; course: StudioCourse } | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!valid) return undefined;
    let alive = true;

    setError(null);
    lapi.studioGet(workspaceId, courseId).then(
      (course) => {
        if (alive) setLoaded({ key, course });
      },
      (e: unknown) => {
        if (alive) setError(e || new Error('Something went wrong. Please try again.'));
      }
    );
    return () => {
      alive = false;
    };
  }, [workspaceId, courseId, valid, key]);

  if (!valid) return <Navigate to={STUDIO_PATH} replace />;

  if (error) {
    return (
      <div className='flex flex-col items-start gap-3' data-testid='carehub-learning-editor-error'>
        <BackToStudio onClick={() => navigate(STUDIO_PATH)} />
        <ChNote tone={learningNotLive(error) ? 'info' : 'error'}>{lErrorText(error)}</ChNote>
        <Button type='button' variant='outline' onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </Button>
      </div>
    );
  }

  if (!loaded || loaded.key !== key) {
    return <div className='py-16 text-center text-sm text-text-tertiary'>Opening the course…</div>;
  }

  return (
    <Editor
      key={key}
      workspaceId={workspaceId}
      courseId={courseId}
      initial={loaded.course}
      onReload={() => setAttempt((n) => n + 1)}
    />
  );
}

function Editor({
  workspaceId,
  courseId,
  initial,
  onReload,
}: {
  workspaceId: string;
  courseId: string;
  initial: StudioCourse;
  onReload: () => void;
}) {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const narrow = useNarrow(rootRef, 760);
  const [draft, setDraft] = useState<Content>(initial.draft);
  const [meta, setMeta] = useState<Meta>(() => metaOf(initial));
  const [save, setSave] = useState<SaveState>('saved');
  const [problem, setProblem] = useState<Problem>('');
  const [saveError, setSaveError] = useState('');
  const [selected, setSelected] = useState<Selected>(() =>
    initial.draft.lessons[0] ? { kind: 'lesson', id: initial.draft.lessons[0].id } : { kind: 'settings' }
  );
  const [modal, setModal] = useState<EditorModal>(null);
  const [undo, setUndo] = useState<{ label: string; restore: () => void } | null>(null);
  const [focusId, setFocusId] = useState('');
  // drafts: review link + comments (header buttons, open-comment counts under blocks, their windows).
  const review = useStudioReview(workspaceId, courseId, draft, (lessonId, blockId) => {
    setSelected({ kind: 'lesson', id: lessonId });
    setFocusId(`chs-b-${blockId}`);
  });
  const [keeping, setKeeping] = useState(false);
  const uploadTarget = useMemo(() => ({ workspaceId, courseId }), [workspaceId, courseId]);
  const lessonDrag = useDragSort((from, to) =>
    update((c) => {
      const moved = moveItem(c.lessons, from, to);

      return moved === c.lessons ? c : { ...c, lessons: moved };
    })
  );
  const blockDrag = useDragSort((from, to) => {
    if (selected.kind === 'lesson') setBlocks(selected.id, (bs) => moveItem(bs, from, to));
  });

  const draftRef = useRef<Content>(initial.draft);
  const baseRef = useRef(initial.updated_ms);
  const dirtyRef = useRef(false);
  const blockedRef = useRef<'' | 'stale' | 'restoring'>('');
  const savingRef = useRef<Promise<boolean> | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const retryRef = useRef(3000);
  const lastErrorRef = useRef('');

  // ---- saving ----------------------------------------------------------------------------------

  const schedule = (ms: number) => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = undefined;
      void runSave();
    }, ms);
  };

  const saveNow = async (): Promise<boolean> => {
    if (blockedRef.current) return false;
    if (!dirtyRef.current) return true;
    const body: Content = { ...draftRef.current, est_minutes: estimateMinutes(draftRef.current) };
    let size = 0;

    try {
      size = new TextEncoder().encode(JSON.stringify(body)).length;
    } catch {
      size = 0;
    }

    if (size > MAX_DRAFT_CHARS) {
      lastErrorRef.current = TOO_BIG_TEXT;
      setSaveError(TOO_BIG_TEXT);
      setProblem('too_big');
      setSave('saved');
      return false;
    }

    dirtyRef.current = false;
    setSave('saving');
    try {
      baseRef.current = await lapi.studioSave(workspaceId, courseId, body, baseRef.current);
      retryRef.current = 3000;
      lastErrorRef.current = '';
      setSaveError('');
      setProblem('');
      setMeta((m) => (m.published_version !== null && !m.has_unpublished_changes ? { ...m, has_unpublished_changes: true } : m));
      setSave(dirtyRef.current ? 'pending' : 'saved');
      return true;
    } catch (e) {
      dirtyRef.current = true;
      const text = lErrorText(e);

      lastErrorRef.current = text;
      setSaveError(text);
      if (/someone else saved/i.test(text)) {
        blockedRef.current = 'stale';
        window.clearTimeout(timerRef.current);
        setProblem('stale');
        setSave('saved');
      } else if (/too big/i.test(text)) {
        setProblem('too_big');
        setSave('saved');
      } else if (isTransientError(e)) {
        const wait = retryRef.current;

        retryRef.current = Math.min(wait * 2, 30000);
        setSave('retrying');
        schedule(wait);
      } else {
        setProblem('error');
        setSave('saved');
      }

      return false;
    }
  };

  /** Saves never overlap: each one waits for the one before. */
  const runSave = (): Promise<boolean> => {
    const next = (savingRef.current || Promise.resolve(true)).then(() => saveNow());

    savingRef.current = next;
    void next.then(() => {
      if (savingRef.current === next) savingRef.current = null;
    });
    return next;
  };

  const runSaveRef = useRef(runSave);

  runSaveRef.current = runSave;

  const update = (fn: (c: Content) => Content) => {
    const next = fn(draftRef.current);

    if (next === draftRef.current) return;
    draftRef.current = next;
    dirtyRef.current = true;
    setDraft(next);
    if (blockedRef.current) return;
    setSave('pending');
    schedule(1500);
  };

  // Warn before closing the tab with unsaved changes; save on the way out of the editor.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current && !savingRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        window.clearTimeout(timerRef.current);
        void runSaveRef.current();
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(timerRef.current);
      if (dirtyRef.current && !blockedRef.current) void runSaveRef.current();
    };
  }, []);

  // Leaving the Versions dialog without restoring lets saving carry on.
  useEffect(() => {
    if (modal?.kind === 'versions' || blockedRef.current !== 'restoring') return;
    blockedRef.current = '';
    if (dirtyRef.current) schedule(0);
  });

  useEffect(() => {
    if (!undo) return undefined;
    const t = window.setTimeout(() => setUndo(null), 8000);

    return () => window.clearTimeout(t);
  }, [undo]);

  useEffect(() => {
    if (!focusId) return;
    const el = document.getElementById(focusId);

    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.querySelector<HTMLElement>('textarea, input:not([type="checkbox"]):not([type="radio"]), select')?.focus({ preventScroll: true });
    }

    setFocusId('');
  }, [focusId]);

  const lessons = draft.lessons;

  // If the open lesson disappears (deleted, restored version), open something that exists.
  useEffect(() => {
    if (selected.kind === 'lesson' && !lessons.some((l) => l.id === selected.id)) {
      setSelected(lessons[0] ? { kind: 'lesson', id: lessons[0].id } : { kind: 'settings' });
    }
  }, [selected, lessons]);

  const keepMine = async () => {
    setKeeping(true);
    try {
      const latest = await lapi.studioGet(workspaceId, courseId);

      baseRef.current = latest.updated_ms;
      setMeta(metaOf(latest));
      blockedRef.current = '';
      dirtyRef.current = true;
      setProblem('');
      await runSave();
    } catch (e) {
      setSaveError(lErrorText(e));
    } finally {
      setKeeping(false);
    }
  };

  const publish = async (note: string) => {
    window.clearTimeout(timerRef.current);
    if (blockedRef.current === 'stale') {
      throw new Error('Someone else saved this course a moment ago. Reload to see their changes, then publish.');
    }

    const ok = await runSave();

    if (!ok || dirtyRef.current) {
      throw new Error(`Nothing was published because your latest changes aren’t saved yet. ${lastErrorRef.current}`.trim());
    }

    let version = await lapi.publish(workspaceId, courseId, note);

    try {
      const fresh = await lapi.studioGet(workspaceId, courseId);

      setMeta(metaOf(fresh));
      if (!dirtyRef.current) baseRef.current = fresh.updated_ms;
      version = version || fresh.published_version || 0;
    } catch {
      setMeta((m) => ({ ...m, status: 'published', published_version: version || m.published_version, has_unpublished_changes: false }));
    }

    return version;
  };

  const beforeRestore = async () => {
    window.clearTimeout(timerRef.current);
    blockedRef.current = 'restoring';
    if (savingRef.current) await savingRef.current;
  };

  // ---- editing helpers -------------------------------------------------------------------------

  const setSettings = (patch: Partial<CourseSettings>) => update((c) => ({ ...c, settings: { ...c.settings, ...patch } }));

  const setLesson = (id: string, fn: (l: Lesson) => Lesson) =>
    update((c) => {
      let changed = false;
      const next = c.lessons.map((l) => {
        if (l.id !== id) return l;
        const n = fn(l);

        if (n !== l) changed = true;
        return n;
      });

      return changed ? { ...c, lessons: next } : c;
    });

  const setBlocks = (id: string, fn: (b: Block[]) => Block[]) =>
    setLesson(id, (l) => {
      const blocks = fn(l.blocks);

      return blocks === l.blocks ? l : { ...l, blocks };
    });

  const setQuiz = (fn: (q: Quiz) => Quiz) => update((c) => ({ ...c, quiz: fn(c.quiz) }));

  const setQuestions = (fn: (qs: Question[]) => Question[]) =>
    setQuiz((q) => {
      const questions = fn(q.questions);

      return questions === q.questions ? q : { ...q, questions, pool_size: Math.min(q.pool_size, questions.length) };
    });

  const addLesson = () => {
    const l = blankLesson('');

    update((c) => ({ ...c, lessons: [...c.lessons, l] }));
    setSelected({ kind: 'lesson', id: l.id });
    setFocusId('chs-lesson-title');
  };

  const moveLesson = (id: string, delta: number) =>
    update((c) => {
      const i = c.lessons.findIndex((l) => l.id === id);
      const moved = i < 0 ? c.lessons : moveItem(c.lessons, i, i + delta);

      return moved === c.lessons ? c : { ...c, lessons: moved };
    });

  const duplicateLesson = (id: string) => {
    const src = draftRef.current.lessons.find((l) => l.id === id);

    if (!src) return;
    const copy = cloneLesson(src);

    update((c) => ({ ...c, lessons: insertAt(c.lessons, c.lessons.findIndex((l) => l.id === id) + 1, copy) }));
    setSelected({ kind: 'lesson', id: copy.id });
  };

  const deleteLesson = (id: string) => {
    const list = draftRef.current.lessons;
    const i = list.findIndex((l) => l.id === id);

    if (i < 0) return;
    const neighbor = list[i + 1] || list[i - 1];

    update((c) => ({ ...c, lessons: c.lessons.filter((l) => l.id !== id) }));
    setSelected(neighbor ? { kind: 'lesson', id: neighbor.id } : { kind: 'settings' });
    setModal(null);
  };

  const addBlock = (lessonId: string, index: number, type: BlockType) => {
    const b = blankBlock(type);

    setBlocks(lessonId, (bs) => insertAt(bs, index, b));
    setModal(null);
    setFocusId(`chs-b-${b.id}`);
  };

  const deleteBlock = (lessonId: string, blockId: string) => {
    const blocks = draftRef.current.lessons.find((l) => l.id === lessonId)?.blocks || [];
    const index = blocks.findIndex((b) => b.id === blockId);

    if (index < 0) return;
    const block = blocks[index];

    setBlocks(lessonId, (bs) => bs.filter((b) => b.id !== blockId));
    setUndo({
      label: 'Block deleted.',
      restore: () => {
        setBlocks(lessonId, (bs) => (bs.some((b) => b.id === block.id) ? bs : insertAt(bs, index, block)));
        setSelected({ kind: 'lesson', id: lessonId });
        setFocusId(`chs-b-${block.id}`);
      },
    });
  };

  const deleteQuestion = (questionId: string) => {
    const qs = draftRef.current.quiz.questions;
    const index = qs.findIndex((q) => q.id === questionId);

    if (index < 0) return;
    const question = qs[index];

    setQuestions((list) => list.filter((q) => q.id !== questionId));
    setUndo({
      label: 'Question deleted.',
      restore: () => {
        setQuestions((list) => (list.some((q) => q.id === question.id) ? list : insertAt(list, index, question)));
        setSelected({ kind: 'quiz' });
        setFocusId(`chs-q-${question.id}`);
      },
    });
  };

  const addQuestion = (kind: QuestionKind) => {
    const q = blankQuestion(kind);

    setQuestions((qs) => [...qs, q]);
    setFocusId(`chs-q-${q.id}`);
  };

  const toggleQuiz = (on: boolean) =>
    update((c) => ({
      ...c,
      quiz: { ...c.quiz, enabled: on, questions: on && !c.quiz.questions.length ? [blankQuestion('single')] : c.quiz.questions },
      settings: {
        ...c.settings,
        completion: on ? (c.settings.completion === 'all_lessons' ? 'all_lessons_and_quiz' : c.settings.completion) : 'all_lessons',
      },
    }));

  const openPreview = (startLessonId?: string) =>
    setModal({ kind: 'preview', content: draftRef.current, label: startLessonId ? 'Preview' : 'Preview the course', startLessonId });

  // ---- panels ----------------------------------------------------------------------------------

  const everPublished = meta.published_version !== null;
  const s = draft.settings;
  const quiz = draft.quiz;

  const renderLesson = (lesson: Lesson, index: number) => {
    const courseDefault = s.min_seconds_per_lesson;

    return (
      <div className='flex flex-col gap-4' data-testid='carehub-learning-lesson-editor'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='text-xs font-semibold uppercase tracking-wide text-text-tertiary'>
            Lesson {index + 1} of {lessons.length}
          </span>
          <div className='ml-auto flex flex-wrap gap-1'>
            <Button type='button' size='sm' variant='ghost' onClick={() => openPreview(lesson.id)}>
              👁 Preview lesson
            </Button>
            <Button type='button' size='sm' variant='ghost' onClick={() => duplicateLesson(lesson.id)}>
              Duplicate
            </Button>
            <Button
              type='button'
              size='sm'
              variant='ghost'
              className='text-text-error'
              onClick={() => (lesson.blocks.length ? setModal({ kind: 'delete_lesson', lessonId: lesson.id }) : deleteLesson(lesson.id))}
            >
              Delete
            </Button>
          </div>
        </div>
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]'>
          <Field label='Lesson title'>
            <div id='chs-lesson-title'>
              <TextLine
                value={lesson.title}
                onChange={(v) => setLesson(lesson.id, (l) => ({ ...l, title: v }))}
                placeholder={`Lesson ${index + 1}`}
                maxLength={200}
              />
            </div>
          </Field>
          <Field
            label='Minimum time (seconds)'
            hint={
              lesson.min_seconds > 0
                ? `At least ${secondsText(lesson.min_seconds)} before it can be finished.`
                : courseDefault > 0
                  ? `0 uses the course default (${secondsText(courseDefault)}).`
                  : '0 = no minimum.'
            }
          >
            <NumberField
              value={lesson.min_seconds}
              min={0}
              max={3600}
              onChange={(v) => setLesson(lesson.id, (l) => ({ ...l, min_seconds: v }))}
              ariaLabel='Minimum time on this lesson, in seconds'
              className='w-28'
            />
          </Field>
        </div>
        <div ref={blockDrag.setList} className='flex flex-col gap-3'>
          {lesson.blocks.length === 0 ? (
            <div className='rounded-[12px] border border-dashed border-border-primary px-4 py-8 text-center text-sm text-text-secondary'>
              <div>This lesson is empty. Add text, pictures, videos, quick checks and more.</div>
              <div className='mt-3'>
                <Button type='button' size='sm' onClick={() => setModal({ kind: 'library', lessonId: lesson.id, index: 0 })}>
                  + Add a block
                </Button>
                <Button type='button' size='sm' variant='outline' className='ml-2' onClick={() => setModal({ kind: 'paste', lessonId: lesson.id })}>
                  Paste text
                </Button>
              </div>
            </div>
          ) : (
            lesson.blocks.map((b, i) => (
              <WithCommentCount
                card={BlockCard}
                openComments={review.badge(b.id)}
                key={b.id}
                block={b}
                index={i}
                count={lesson.blocks.length}
                onChange={(nb) => setBlocks(lesson.id, (bs) => bs.map((x) => (x.id === b.id ? nb : x)))}
                onMove={(delta) =>
                  setBlocks(lesson.id, (bs) => {
                    const j = bs.findIndex((x) => x.id === b.id);

                    return j < 0 ? bs : moveItem(bs, j, j + delta);
                  })
                }
                onDuplicate={() => {
                  const copy = cloneBlock(b);

                  setBlocks(lesson.id, (bs) => insertAt(bs, bs.findIndex((x) => x.id === b.id) + 1, copy));
                  setFocusId(`chs-b-${copy.id}`);
                }}
                onDelete={() => deleteBlock(lesson.id, b.id)}
                onAddBelow={() => setModal({ kind: 'library', lessonId: lesson.id, index: i + 1 })}
                onGrab={blockDrag.grab(i)}
                dragging={blockDrag.drag?.from === i}
                dropEdge={blockDrag.edgeOf(i)}
              />
            ))
          )}
          {lesson.blocks.length > 0 && (
            <AddButton onClick={() => setModal({ kind: 'library', lessonId: lesson.id, index: lesson.blocks.length })}>Add a block</AddButton>
          )}
          {lesson.blocks.length > 0 && <AddButton onClick={() => setModal({ kind: 'paste', lessonId: lesson.id })}>Paste text</AddButton>}
        </div>
      </div>
    );
  };

  const renderQuiz = () => (
    <div className='flex flex-col' data-testid='carehub-learning-quiz-editor'>
      <ChSection title='Final quiz' hint='A graded quiz at the end of the course. Answers are checked by Care Hub, not in the browser.'>
        <Toggle
          checked={quiz.enabled}
          onChange={toggleQuiz}
          label='Use a final quiz'
          hint={quiz.enabled ? undefined : 'Turn this on to add questions and a pass mark.'}
        />
      </ChSection>
      {quiz.enabled && (
        <>
          <ChSection title='Rules'>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              <Field label='Quiz title'>
                <TextLine value={quiz.title} onChange={(v) => setQuiz((q) => ({ ...q, title: v }))} placeholder='Final quiz' maxLength={200} />
              </Field>
              <Field label='The course is finished when people…'>
                <ChSelect value={s.completion} options={COMPLETIONS} onChange={(v) => setSettings({ completion: v })} ariaLabel='When the course is finished' />
              </Field>
              <Field label='Pass mark (%)'>
                <NumberField value={s.pass_mark} min={0} max={100} onChange={(v) => setSettings({ pass_mark: v })} ariaLabel='Pass mark' className='w-24' />
              </Field>
              <Field label='Tries allowed' hint='0 = unlimited'>
                <NumberField value={s.max_attempts} min={0} max={20} onChange={(v) => setSettings({ max_attempts: v })} ariaLabel='Tries allowed' className='w-24' />
              </Field>
              <Field label='Show the right answers'>
                <ChSelect value={s.show_answers} options={SHOW_ANSWERS} onChange={(v) => setSettings({ show_answers: v })} ariaLabel='When to show the right answers' />
              </Field>
              <Field
                label='Questions per attempt'
                hint={`0 = all ${quiz.questions.length}. A smaller number picks a random set each time.`}
              >
                <NumberField
                  value={quiz.pool_size}
                  min={0}
                  max={quiz.questions.length}
                  onChange={(v) => setQuiz((q) => ({ ...q, pool_size: v }))}
                  ariaLabel='Questions per attempt'
                  className='w-24'
                />
              </Field>
            </div>
            <div className='mt-3'>
              <Toggle checked={quiz.shuffle} onChange={(v) => setQuiz((q) => ({ ...q, shuffle: v }))} label='Shuffle the question order' />
            </div>
          </ChSection>
          <ChSection title={`Questions (${quiz.questions.length})`}>
            <div className='flex flex-col gap-3'>
              {quiz.questions.map((q, i) => (
                <div key={q.id} id={`chs-q-${q.id}`} className='scroll-mt-4 rounded-[12px] border border-border-primary' data-testid='carehub-learning-quiz-question'>
                  <div className='flex items-center gap-0.5 border-b border-border-primary py-1 pl-3 pr-1'>
                    <span className='min-w-0 flex-1 truncate text-xs font-semibold text-text-secondary'>Question {i + 1}</span>
                    <IconButton label='Move up' disabled={i === 0} onClick={() => setQuestions((qs) => moveItem(qs, i, i - 1))}>
                      ↑
                    </IconButton>
                    <IconButton label='Move down' disabled={i >= quiz.questions.length - 1} onClick={() => setQuestions((qs) => moveItem(qs, i, i + 1))}>
                      ↓
                    </IconButton>
                    <IconButton
                      label='Duplicate'
                      onClick={() => {
                        const copy = cloneQuestion(q);

                        setQuestions((qs) => insertAt(qs, qs.findIndex((x) => x.id === q.id) + 1, copy));
                        setFocusId(`chs-q-${copy.id}`);
                      }}
                    >
                      <CopyIcon />
                    </IconButton>
                    <IconButton label='Delete question' danger onClick={() => deleteQuestion(q.id)}>
                      🗑
                    </IconButton>
                  </div>
                  <div className='p-3'>
                    <QuestionEditor q={q} inQuiz onChange={(nq) => setQuestions((qs) => qs.map((x) => (x.id === q.id ? nq : x)))} />
                  </div>
                </div>
              ))}
              <div className='flex flex-wrap items-center gap-1'>
                <span className='mr-1 text-xs text-text-tertiary'>Add a question:</span>
                {QUESTION_BUTTONS.map((b) => (
                  <AddButton key={b.value} onClick={() => addQuestion(b.value)}>
                    {b.label}
                  </AddButton>
                ))}
              </div>
            </div>
          </ChSection>
        </>
      )}
    </div>
  );

  const renderSettings = () => {
    const est = estimateMinutes(draft);
    const tries = s.max_attempts ? plural(s.max_attempts, 'try', 'tries') : 'unlimited tries';

    return (
      <div className='flex flex-col' data-testid='carehub-learning-settings-editor'>
        <ChSection title='About this course'>
          <div className='flex flex-col gap-3'>
            <Field label='Course title'>
              <TextLine value={draft.title} onChange={(v) => update((c) => ({ ...c, title: v }))} placeholder='e.g. Handling refunds' maxLength={200} />
            </Field>
            <Field label='Short summary' hint='Shown on the course card and the start screen.'>
              <TextBox
                value={draft.summary}
                onChange={(v) => update((c) => ({ ...c, summary: v }))}
                placeholder='What people will learn, in a sentence or two.'
                rows={3}
                maxLength={1000}
              />
            </Field>
            <div className='flex flex-col gap-3 sm:flex-row'>
              <div className='h-24 w-40 shrink-0 overflow-hidden rounded-[10px] border border-border-primary'>
                <CourseCover cover={draft.cover} preset={draft.preset} seed={courseId} />
              </div>
              <div className='flex min-w-0 flex-1 flex-col gap-2'>
                <MediaField
                  kind='image'
                  label='Cover picture'
                  value={draft.cover}
                  onChange={(v) => update((c) => ({ ...c, cover: v }))}
                  hint='Upload a picture (up to 10 MB) or paste a link.'
                />
                <PicturePicker value={draft.cover} onPick={(url) => update((c) => ({ ...c, cover: url }))} />
                {draft.cover && (
                  <button
                    type='button'
                    className='self-start text-xs text-text-secondary hover:text-text-primary hover:underline'
                    onClick={() => update((c) => ({ ...c, cover: '' }))}
                  >
                    Remove picture
                  </button>
                )}
              </div>
            </div>
            {est > 0 && <div className='text-xs text-text-tertiary'>Takes about {formatMinutes(est)} (worked out from the lessons).</div>}
          </div>
        </ChSection>
        <ChSection title='Course type' hint='Picking a type sets good defaults below. You can still change each one.'>
          <PresetPicker value={draft.preset} onChange={(p) => update((c) => withQuizQuestion(applyPreset(c, p)))} />
        </ChSection>
        <ChSection title='How people take it'>
          <div className='flex flex-col gap-3'>
            <Field label='The course is finished when people…' hint={quiz.enabled ? undefined : 'Turn on the final quiz for more choices.'}>
              <ChSelect
                value={quiz.enabled ? s.completion : 'all_lessons'}
                options={COMPLETIONS}
                disabled={!quiz.enabled}
                onChange={(v) => setSettings({ completion: v })}
                ariaLabel='When the course is finished'
              />
            </Field>
            <Toggle
              checked={s.sequential}
              onChange={(v) => setSettings({ sequential: v })}
              label='Lessons in order'
              hint='Each lesson opens once the one before it is finished.'
            />
            <Field label='Minimum time per lesson (seconds)' hint='0 = no minimum. A lesson’s own setting wins.'>
              <NumberField
                value={s.min_seconds_per_lesson}
                min={0}
                max={3600}
                onChange={(v) => setSettings({ min_seconds_per_lesson: v })}
                ariaLabel='Minimum time per lesson, in seconds'
                className='w-28'
              />
            </Field>
            <div className='flex flex-wrap items-center gap-2 rounded-[10px] bg-fill-content px-3 py-2 text-sm'>
              <span className='min-w-0 flex-1'>
                {quiz.enabled
                  ? `Final quiz: ${plural(quiz.questions.length, 'question')}, pass mark ${s.pass_mark}%, ${tries}.`
                  : 'No final quiz.'}
              </span>
              <Button type='button' size='sm' variant='outline' onClick={() => setSelected({ kind: 'quiz' })}>
                {quiz.enabled ? 'Edit the quiz' : 'Set up a quiz'}
              </Button>
            </div>
            <Toggle
              checked={s.require_ack}
              onChange={(v) => setSettings({ require_ack: v, ack_text: v && !s.ack_text.trim() ? DEFAULT_ACK : s.ack_text })}
              label='Ask people to confirm at the end'
              hint='They tick a box to say they’ve read and understood it.'
            />
            {s.require_ack && (
              <Field label='What they confirm'>
                <TextLine value={s.ack_text} onChange={(v) => setSettings({ ack_text: v })} placeholder={DEFAULT_ACK} maxLength={300} />
              </Field>
            )}
            <Toggle
              checked={s.certificate}
              onChange={(v) => setSettings({ certificate: v })}
              label='Give a certificate when someone finishes'
              hint='When they finish, they see a “View my certificate” link. Certificates are listed on the Certificates page.'
            />
          </div>
        </ChSection>
        <ChSection title='Who can find it'>
          <div className='flex flex-col gap-3'>
            <Toggle
              checked={s.catalog}
              onChange={(v) => setSettings({ catalog: v })}
              label='Show in the Catalog'
              hint={s.catalog ? 'Everyone in the workspace can find it once it’s published.' : 'Hidden from the Catalog — people need the link.'}
            />
            <div className='flex flex-wrap items-center gap-2'>
              <CopyLinkButton courseId={courseId} />
              <span className='text-xs text-text-tertiary'>
                {everPublished ? 'Anyone in the workspace with the link can take it.' : 'The link works once you publish.'}
              </span>
            </div>
            <div className='text-xs text-text-tertiary'>
              To give this course to people with a due date, use the Assign tab (needs the “Assign courses” permission).
            </div>
          </div>
        </ChSection>
      </div>
    );
  };

  // ---- layout ----------------------------------------------------------------------------------

  const lessonIndex = selected.kind === 'lesson' ? lessons.findIndex((l) => l.id === selected.id) : -1;
  const panel =
    selected.kind === 'quiz' ? (
      renderQuiz()
    ) : lessonIndex >= 0 ? (
      <LinkCourseContext.Provider value={lessons}>{renderLesson(lessons[lessonIndex], lessonIndex)}</LinkCourseContext.Provider>
    ) : (
      renderSettings()
    );
  const selectedKey = selected.kind === 'lesson' ? `lesson:${selected.id}` : selected.kind;
  const statusText =
    save === 'pending' || save === 'saving'
      ? 'Saving…'
      : save === 'retrying'
        ? 'Couldn’t save — retrying'
        : problem
          ? 'Not saved'
          : '✓ Saved';
  const nothingNew = everPublished && meta.status === 'published' && !meta.has_unpublished_changes && save === 'saved' && !problem;
  const deleting = modal?.kind === 'delete_lesson' ? lessons.find((l) => l.id === modal.lessonId) || null : null;

  const outlineItem = (active: boolean, icon: string, label: string, detail: string, onClick: () => void, testId: string) => (
    <button
      type='button'
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      data-testid={testId}
      className={cn(
        'flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-sm',
        active ? 'bg-fill-content-hover font-medium text-text-primary' : 'text-text-secondary hover:bg-fill-content-hover hover:text-text-primary'
      )}
    >
      <span aria-hidden='true'>{icon}</span>
      <span className='min-w-0 flex-1 truncate'>{label}</span>
      {detail && <span className='shrink-0 text-xs font-normal text-text-tertiary'>{detail}</span>}
    </button>
  );

  const outline = (
    <nav
      ref={lessonDrag.setList}
      aria-label='Course outline'
      className='sticky top-4 flex max-h-[calc(100vh-120px)] flex-col gap-0.5 overflow-y-auto rounded-[12px] border border-border-primary p-2'
    >
      {outlineItem(selected.kind === 'settings', '⚙️', 'Course settings', '', () => setSelected({ kind: 'settings' }), 'carehub-learning-outline-settings')}
      <div className='mt-2 px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-text-tertiary'>Lessons</div>
      {lessons.map((l, i) => {
        const active = selected.kind === 'lesson' && selected.id === l.id;

        return (
          <div
            key={l.id}
            data-drag-item=''
            className={cn(
              'group relative flex items-center rounded-[8px]',
              active ? 'bg-fill-content-hover' : 'hover:bg-fill-content-hover',
              lessonDrag.drag?.from === i && 'opacity-50'
            )}
          >
            <DropLine edge={lessonDrag.edgeOf(i)} gap={2} />
            <DragGrip onPointerDown={lessonDrag.grab(i)} className='opacity-60 group-hover:opacity-100' />
            <button
              type='button'
              aria-current={active ? 'true' : undefined}
              onClick={() => setSelected({ kind: 'lesson', id: l.id })}
              className={cn('flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-0.5 pr-2 text-left text-sm', active ? 'font-medium' : 'text-text-secondary')}
              data-testid='carehub-learning-outline-lesson'
            >
              <span className='w-5 shrink-0 text-xs font-normal text-text-tertiary'>{i + 1}.</span>
              <span className={cn('min-w-0 flex-1 truncate', !l.title.trim() && 'italic text-text-tertiary')}>
                {l.title.trim() || 'Untitled lesson'}
              </span>
            </button>
            <span className='flex shrink-0 opacity-50 group-focus-within:opacity-100 group-hover:opacity-100'>
              <IconButton label={`Move ${lessonName(l, i)} up`} disabled={i === 0} onClick={() => moveLesson(l.id, -1)}>
                ↑
              </IconButton>
              <IconButton label={`Move ${lessonName(l, i)} down`} disabled={i >= lessons.length - 1} onClick={() => moveLesson(l.id, 1)}>
                ↓
              </IconButton>
            </span>
          </div>
        );
      })}
      {!lessons.length && <div className='px-2 py-1 text-xs text-text-tertiary'>No lessons yet.</div>}
      <div className='px-1 pt-1'>
        <AddButton onClick={addLesson}>Add a lesson</AddButton>
      </div>
      <div className='mt-2 border-t border-border-primary pt-2'>
        {outlineItem(
          selected.kind === 'quiz',
          '📝',
          'Final quiz',
          quiz.enabled ? plural(quiz.questions.length, 'question') : 'Off',
          () => setSelected({ kind: 'quiz' }),
          'carehub-learning-outline-quiz'
        )}
      </div>
    </nav>
  );

  const picker = (
    <div className='flex items-center gap-2'>
      <ChSelect<string>
        value={selectedKey}
        ariaLabel='Part of the course to edit'
        className='min-w-0 flex-1'
        options={[
          { value: 'settings', label: '⚙️ Course settings' },
          ...lessons.map((l, i) => ({ value: `lesson:${l.id}`, label: `${i + 1}. ${l.title.trim() || 'Untitled lesson'}` })),
          { value: 'quiz', label: `📝 Final quiz${quiz.enabled ? '' : ' (off)'}` },
        ]}
        onChange={(v) =>
          setSelected(v === 'settings' || v === 'quiz' ? { kind: v } : { kind: 'lesson', id: v.slice('lesson:'.length) })
        }
      />
      <Button type='button' size='sm' variant='outline' onClick={addLesson}>
        + Lesson
      </Button>
    </div>
  );

  return (
    <UploadContext.Provider value={uploadTarget}>
      <div ref={rootRef} className='flex flex-col gap-4' data-testid='carehub-learning-editor'>
        <div className='flex flex-col gap-2'>
          <div className='flex items-center gap-2'>
            <BackToStudio onClick={() => navigate(STUDIO_PATH)} />
            <span
              role='status'
              aria-live='polite'
              title={saveError || undefined}
              className={cn('ml-auto text-xs', save === 'retrying' || problem ? 'text-text-error' : 'text-text-tertiary')}
              data-testid='carehub-learning-save-status'
            >
              {statusText}
            </span>
          </div>
          <div className='flex flex-wrap items-center gap-x-3 gap-y-2'>
            <h1 className='min-w-0 max-w-full break-words text-xl font-semibold'>{draft.title.trim() || 'Untitled course'}</h1>
            <StatusChips status={meta.status} version={meta.published_version} unpublished={meta.has_unpublished_changes} />
            <div className='flex flex-wrap gap-1.5 sm:ml-auto'>
              <Button type='button' size='sm' variant='outline' onClick={() => openPreview()} data-testid='carehub-learning-preview-button'>
                👁 Preview
              </Button>
              {review.buttons}
              <Button type='button' size='sm' variant='outline' onClick={() => setModal({ kind: 'versions' })}>
                {meta.versions.length ? `Versions (${meta.versions.length})` : 'Versions'}
              </Button>
              <Button
                type='button'
                size='sm'
                disabled={nothingNew}
                title={nothingNew ? 'Nothing new to publish' : undefined}
                onClick={() => setModal({ kind: 'publish' })}
                data-testid='carehub-learning-publish'
              >
                {everPublished ? 'Publish changes' : 'Publish'}
              </Button>
            </div>
          </div>
        </div>

        {meta.status === 'archived' && (
          <ChNote>This course is archived, so nobody can start it. Unarchive it from the Studio list to bring it back.</ChNote>
        )}
        {problem === 'stale' && (
          <ChNote tone='warn'>
            <div className='flex flex-col gap-2'>
              <span>Someone else saved this course a moment ago. Reload to see their changes. Your latest edits here aren’t saved.</span>
              <div className='flex flex-wrap gap-2'>
                <Button type='button' size='sm' onClick={onReload}>
                  Reload their version
                </Button>
                <Button type='button' size='sm' variant='outline' loading={keeping} onClick={() => void keepMine()}>
                  Keep mine (replace theirs)
                </Button>
              </div>
            </div>
          </ChNote>
        )}
        {problem === 'too_big' && <ChNote tone='error'>{saveError || TOO_BIG_TEXT}</ChNote>}
        {problem === 'error' && (
          <ChNote tone='error'>
            <div className='flex flex-wrap items-center gap-2'>
              <span className='min-w-0 flex-1'>Your latest changes aren’t saved. {saveError}</span>
              <Button type='button' size='sm' variant='outline' onClick={() => void runSave()}>
                Try again
              </Button>
            </div>
          </ChNote>
        )}

        <div className={cn(narrow ? 'flex flex-col gap-4' : 'grid grid-cols-[250px_minmax(0,1fr)] items-start gap-6')}>
          {narrow ? picker : outline}
          <div className='min-w-0'>{panel}</div>
        </div>

        {undo && (
          <div
            role='status'
            className='fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-[10px] bg-[#1f2329] px-4 py-2 text-sm text-white shadow-lg'
          >
            <span className='min-w-0'>{undo.label}</span>
            <button
              type='button'
              className='font-semibold text-[#8ccaff] hover:underline'
              onClick={() => {
                undo.restore();
                setUndo(null);
              }}
            >
              Undo
            </button>
            <button type='button' aria-label='Dismiss' className='opacity-70 hover:opacity-100' onClick={() => setUndo(null)}>
              ×
            </button>
          </div>
        )}

        {review.modal}
        {modal?.kind === 'library' && (
          <BlockLibrary onPick={(t) => addBlock(modal.lessonId, modal.index, t)} onClose={() => setModal(null)} />
        )}
        <PasteTextDialog lessonId={modal?.kind === 'paste' ? modal.lessonId : ''} draft={draft} update={update} setUndo={setUndo} onClose={() => setModal(null)} />
        {modal?.kind === 'preview' && (
          <PreviewModal
            workspaceId={workspaceId}
            courseId={courseId}
            content={modal.content}
            startLessonId={modal.startLessonId}
            label={modal.label}
            onClose={() => setModal(modal.back === 'versions' ? { kind: 'versions' } : null)}
          />
        )}
        {modal?.kind === 'publish' && (
          <PublishModal
            courseId={courseId}
            draft={draft}
            everPublished={everPublished}
            learnersStarted={everPublished}
            onPublish={publish}
            onClose={() => setModal(null)}
          />
        )}
        {modal?.kind === 'versions' && (
          <VersionsModal
            workspaceId={workspaceId}
            courseId={courseId}
            versions={meta.versions}
            onPreview={(content, label) => setModal({ kind: 'preview', content, label, back: 'versions' })}
            beforeRestore={beforeRestore}
            onRestored={onReload}
            onClose={() => setModal(null)}
          />
        )}
        {deleting && (
          <ConfirmModal
            title='Delete this lesson?'
            confirmLabel='Delete lesson'
            danger
            onConfirm={() => deleteLesson(deleting.id)}
            onClose={() => setModal(null)}
          >
            <p>
              “{lessonName(deleting, lessons.indexOf(deleting))}” and its {plural(deleting.blocks.length, 'block')} will be removed from the
              draft. Learners keep the published version until you publish again.
            </p>
          </ConfirmModal>
        )}
      </div>
    </UploadContext.Provider>
  );
}

// CareHub Learning: telling people when a finished course changes (the Publish dialog's choice and result), "Remind me to
// check this course" (the course setting, the Studio list's Check due chip and its dialog), and the Mark complete / Undo
// dialogs of the Assign page. Studio and Assign only render these pieces; everything they need is fetched here.
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';

import { useNavigate } from 'react-router-dom';

import { useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { lastWorkspaceId } from './CareHubCore';
import { LEARNING_PATH, lErrorText, plural } from './CareHubLearningApi';
import { aapi, DAYS_NEEDED, daysValue, dayMonth, MAX_DUE_DAYS, MAX_MARK_REASON, RETAKE_DAYS } from './CareHubLearningAssignApi';
import { Chip } from './CareHubLearningBlocks';
import { CareHubModal, chInputClass, ChNote } from './CareHubUi';

import type { AnnounceAction, AnnounceInfo, AnnounceResult, ContentCheck } from './CareHubLearningAssignApi';

const NOTICES_CSS = `
.chn-check{accent-color:#4f46e5}
:root[data-dark-mode='true'] .chn-check{accent-color:#818cf8}
.chn-chip-button{min-height:24px;cursor:pointer}
.chn-chip-button:hover{text-decoration:underline}
`;

function NoticesStyle() {
  return <style data-carehub-learning-notices=''>{NOTICES_CSS}</style>;
}

/** A loading Button is disabled while it works, so the browser drops focus to the page. Put it back when the work ends. */
function useKeepFocus(busy: boolean, target: () => HTMLElement | null | undefined) {
  const was = useRef(busy);

  useLayoutEffect(() => {
    const ended = was.current && !busy;

    was.current = busy;
    if (!ended) return;
    const now = document.activeElement;

    if (!now || now === document.body) target()?.focus();
  });
}

/** The workspace these pieces work in (the Publish dialog and the Studio rows aren't given it). */
function useWs() {
  return useCurrentWorkspaceId() || lastWorkspaceId() || '';
}

// ---------------------------------------------------------------------------
// Content checks ("Remind me to check this course"): one shared copy per workspace, so every Studio row, the course
// settings and the Check due dialog agree. Loaded at most every 30 seconds; when it can't be loaded (an older server)
// nothing is shown.
// ---------------------------------------------------------------------------

interface ChecksState {
  checks: ReadonlyMap<string, ContentCheck>;
  at: number;
}

const checksByWs = new Map<string, ChecksState>();
const checksLoading = new Map<string, number>();
const checksListeners = new Set<() => void>();
let checksRequest = 0;

function subscribeChecks(listener: () => void) {
  checksListeners.add(listener);
  return () => {
    checksListeners.delete(listener);
  };
}

function setChecks(ws: string, next: ChecksState) {
  checksByWs.set(ws, next);
  for (const listener of [...checksListeners]) listener();
}

/** `force` loads again even when the copy is fresh (after a publish or a Mark as checked). */
function loadChecks(ws: string, force = false) {
  if (!ws) return;
  const have = checksByWs.get(ws);

  if (!force && (checksLoading.has(ws) || (have && Date.now() - have.at < 30_000))) return;
  const n = ++checksRequest;

  checksLoading.set(ws, n);
  aapi.contentChecks(ws).then(
    (list) => {
      if (checksLoading.get(ws) !== n) return;
      checksLoading.delete(ws);
      setChecks(ws, { checks: new Map(list.map((c) => [c.course_id, c])), at: Date.now() });
    },
    () => {
      if (checksLoading.get(ws) !== n) return;
      checksLoading.delete(ws);
      setChecks(ws, { checks: checksByWs.get(ws)?.checks ?? new Map(), at: Date.now() });
    }
  );
}

function useContentCheck(ws: string, courseId: string): ContentCheck | null {
  const state = useSyncExternalStore(subscribeChecks, () => (ws ? checksByWs.get(ws) : undefined));

  useEffect(() => {
    loadChecks(ws);
  }, [ws]);
  return state?.checks.get(courseId) ?? null;
}

/** Resets the course's reminder clock; the shared copy shows the new dates straight away. */
async function markCourseChecked(ws: string, courseId: string) {
  const reply = await aapi.markChecked(ws, courseId);
  const have = checksByWs.get(ws);
  const old = have?.checks.get(courseId);

  if (have && old) {
    const next = new Map(have.checks);

    if (reply.due_ms === null) next.delete(courseId);
    else next.set(courseId, { ...old, last_kind: 'checked', last_ms: reply.checked_ms, due_ms: reply.due_ms, due: reply.due_ms <= Date.now() });
    setChecks(ws, { ...have, checks: next });
  }
  loadChecks(ws, true);
  return reply;
}

function checkedText(dueMs: number | null) {
  return dueMs === null ? 'Marked as checked.' : `Marked as checked. Next check due ${dayMonth(dueMs)}.`;
}

function lastText(check: ContentCheck) {
  return `${check.last_kind === 'checked' ? 'Last checked' : 'Last updated'} ${dayMonth(check.last_ms)}`;
}

// ---------------------------------------------------------------------------
// Course settings: "Remind me to check this course"
// ---------------------------------------------------------------------------

const REVIEW_CHOICES = [3, 6, 12];

/** The course setting (right after Renewal). The reminder runs from the live version, so changes start once published. */
export function ReviewField({
  workspaceId,
  courseId,
  value,
  onChange,
}: {
  workspaceId: string;
  courseId: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const check = useContentCheck(workspaceId, courseId);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const markButton = useRef<HTMLButtonElement>(null);
  const months = [...new Set([...REVIEW_CHOICES, ...(value !== null && value >= 1 ? [value] : [])])].sort((a, b) => a - b);

  const mark = async () => {
    setBusy(true);
    setStatus('');
    setError('');
    try {
      const reply = await markCourseChecked(workspaceId, courseId);

      setStatus(checkedText(reply.due_ms));
    } catch (e) {
      setError(lErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  useKeepFocus(busy, () => markButton.current ?? box.current?.querySelector('select'));

  return (
    <div ref={box} className='flex min-w-0 flex-col gap-1' data-testid='carehub-learning-review'>
      <span className='text-xs font-medium text-text-secondary'>Check reminders</span>
      <label className='flex flex-wrap items-center gap-2 text-sm'>
        <span>Remind me to check this course:</span>
        <select
          className={cn(chInputClass, 'pr-7')}
          value={String(value ?? 0)}
          onChange={(e) => {
            const n = Number(e.target.value);

            onChange(Number.isInteger(n) && n >= 1 ? n : null);
          }}
          data-testid='carehub-learning-review-select'
        >
          <option value='0'>Never</option>
          {months.map((n) => (
            <option key={n} value={String(n)}>
              every {plural(n, 'month')}
            </option>
          ))}
        </select>
      </label>
      <span className='text-xs text-text-tertiary'>We’ll send you a Care Hub message when it’s time. Changes start once you publish.</span>
      {check && (
        <div className='mt-1 flex flex-wrap items-center gap-2 text-xs text-text-secondary'>
          <span>
            {lastText(check)}
            {check.due ? '' : ` · next check due ${dayMonth(check.due_ms)}`}
          </span>
          {check.due && <Chip tone='amber'>Check due</Chip>}
          <Button
            ref={markButton}
            type='button'
            size='sm'
            variant='outline'
            loading={busy}
            onClick={() => void mark()}
            data-testid='carehub-learning-review-mark'
          >
            Mark as checked
          </Button>
        </div>
      )}
      <p role='status' className={status ? 'm-0 text-xs text-text-secondary' : 'sr-only'} data-testid='carehub-learning-review-status'>
        {status}
      </p>
      {error && <ChNote tone='error'>{error}</ChNote>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Studio list: the Check due chip and its dialog
// ---------------------------------------------------------------------------

/** Shown on a Studio row when the course's check is due. Opens "Time to check …". */
export function CheckDueChip({ courseId, title }: { courseId: string; title: string }) {
  const ws = useWs();
  const navigate = useNavigate();
  const check = useContentCheck(ws, courseId);
  const [open, setOpen] = useState<ContentCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState('');
  const anchor = useRef<HTMLSpanElement>(null);
  const doneButton = useRef<HTMLButtonElement>(null);
  const markButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);

  useKeepFocus(busy, () => (done !== null ? doneButton.current : markButton.current));

  // After the dialog closes, focus goes back to the chip; if the chip has gone (checked), to the row's first button.
  useLayoutEffect(() => {
    if (!refocus.current || open) return;
    refocus.current = false;
    const now = document.activeElement;

    if (now && now !== document.body) return;
    const row = anchor.current?.closest('[data-testid="carehub-learning-studio-row"]');

    row?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  });

  useEffect(() => {
    if (done !== null) doneButton.current?.focus();
  }, [done]);

  const close = () => {
    refocus.current = true;
    setOpen(null);
    setDone(null);
    setError('');
  };

  const mark = async () => {
    setBusy(true);
    setError('');
    try {
      const reply = await markCourseChecked(ws, courseId);

      setDone(checkedText(reply.due_ms));
    } catch (e) {
      setError(lErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!check?.due && !open) return <span ref={anchor} hidden />;
  const shown = open ?? check;
  const name = title.trim() || 'this course';

  return (
    <>
      <span ref={anchor} hidden />
      <NoticesStyle />
      {check?.due && (
        <button
          type='button'
          className='chl-chip chl-amber chn-chip-button self-start sm:self-center'
          aria-haspopup='dialog'
          onClick={() => setOpen(check)}
          data-testid='carehub-learning-check-due'
        >
          Check due
        </button>
      )}
      {open && shown && (
        <CareHubModal
          title={<span className='whitespace-normal break-words'>Time to check “{name}”</span>}
          onClose={close}
          testId='carehub-learning-check-due-dialog'
          footer={
            done !== null ? (
              <Button ref={doneButton} type='button' onClick={close}>
                Done
              </Button>
            ) : (
              <>
                <Button
                  type='button'
                  variant='outline'
                  onClick={() => {
                    close();
                    navigate(`${LEARNING_PATH}/studio/${courseId}`);
                  }}
                  data-testid='carehub-learning-check-due-open'
                >
                  Open in Studio
                </Button>
                <Button ref={markButton} type='button' loading={busy} onClick={() => void mark()} data-testid='carehub-learning-check-due-mark'>
                  Mark as checked
                </Button>
              </>
            )
          }
        >
          <div className='flex flex-col gap-3 text-sm'>
            <p className='m-0'>
              It was last {shown.last_kind === 'checked' ? 'checked' : 'updated'} on {dayMonth(shown.last_ms)}. If it’s still right, mark it as
              checked and we’ll remind you again in {plural(shown.every_months, 'month')}.
            </p>
            <p role='status' className={done ? 'm-0 font-medium' : 'sr-only'} data-testid='carehub-learning-check-due-status'>
              {done}
            </p>
            {error && <ChNote tone='error'>{error}</ChNote>}
          </div>
        </CareHubModal>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Publish dialog: tell people who finished an earlier version
// ---------------------------------------------------------------------------

type AnnounceChoiceId = 'none' | AnnounceAction;

type AnnounceSent =
  | { state: 'idle' }
  | { state: 'sending' }
  | { state: 'done'; result: AnnounceResult; days: number }
  | { state: 'failed'; version: number };

export interface Announce {
  /** The choice is offered: the course was published before and someone finished an earlier version. */
  offered: boolean;
  info: AnnounceInfo | null;
  choice: AnnounceChoiceId;
  setChoice: (c: AnnounceChoiceId) => void;
  days: string;
  setDays: (v: string) => void;
  /** Telling people needs a note about what changed. */
  needsNote: boolean;
  /** Give the "What changed?" box this id (so a missing note can take focus). */
  noteId: string;
  daysId: string;
  /** Before publishing: what's missing (and focus goes there), or ''. */
  check: (note: string) => string;
  /** After a successful publish: tells people as chosen. Never throws; the result shows in <AnnounceDone>. */
  afterPublish: (version: number) => void;
  sent: AnnounceSent;
  retry: () => void;
}

/** For PublishModal: what to offer, the choice, and telling people once the new version is live. */
export function useAnnounce(courseId: string, everPublished: boolean): Announce {
  const ws = useWs();
  const noteId = useId();
  const daysId = useId();
  const [info, setInfo] = useState<AnnounceInfo | null>(null);
  const [choice, setChoice] = useState<AnnounceChoiceId>('none');
  const [days, setDays] = useState(String(RETAKE_DAYS));
  const [sent, setSent] = useState<AnnounceSent>({ state: 'idle' });

  useEffect(() => {
    if (!ws || !courseId || !everPublished) return undefined;
    let alive = true;

    // An older server (or no permission) answers with an error: then there's simply no choice.
    aapi.announceInfo(ws, courseId).then(
      (i) => {
        if (alive) setInfo(i);
      },
      () => undefined
    );
    return () => {
      alive = false;
    };
  }, [ws, courseId, everPublished]);

  const offered = Boolean(info && info.published_version !== null && info.finished > 0);
  const action: AnnounceAction | null = offered && choice !== 'none' ? choice : null;
  const withDays = action === 'retake' && Boolean(info && info.assigned > 0);

  const send = (version: number, act: AnnounceAction, dueDays: number | null) => {
    setSent({ state: 'sending' });
    void (async () => {
      try {
        const v = version > 0 ? version : ((await aapi.announceInfo(ws, courseId)).published_version ?? 0);
        const result = await aapi.announce(ws, courseId, { version: v, action: act, ...(dueDays !== null ? { due_days: dueDays } : {}) });

        setSent({ state: 'done', result, days: dueDays ?? RETAKE_DAYS });
      } catch {
        setSent({ state: 'failed', version });
      }
    })();
  };

  // What was chosen when publishing (kept for Try again).
  const chosen = useRef<{ action: AnnounceAction; days: number | null } | null>(null);

  return {
    offered,
    info,
    choice,
    setChoice,
    days,
    setDays,
    needsNote: action !== null,
    noteId,
    daysId,
    check: (note) => {
      if (action && !note.trim()) {
        document.getElementById(noteId)?.focus();
        return 'Add a note about what changed so people know.';
      }
      if (withDays && daysValue(days) === null) {
        document.getElementById(daysId)?.focus();
        return DAYS_NEEDED;
      }
      return '';
    },
    afterPublish: (version) => {
      if (ws) loadChecks(ws, true);
      if (!action || !ws) return;
      chosen.current = { action, days: withDays ? daysValue(days) : null };
      send(version, action, chosen.current.days);
    },
    sent,
    retry: () => {
      if (sent.state === 'failed' && chosen.current) send(sent.version, chosen.current.action, chosen.current.days);
    },
  };
}

const ANNOUNCE_OPTIONS: { id: AnnounceChoiceId; label: string; hint: string }[] = [
  { id: 'none', label: 'Don’t tell them', hint: 'Nothing changes for them.' },
  { id: 'tell', label: 'Tell them what changed', hint: 'They get a Care Hub message with your note. They stay finished.' },
  { id: 'retake', label: 'Ask them to take it again', hint: 'They get a message with your note and start the new version.' },
];

/** The choice in the Publish dialog (nothing when there's no one to tell, or the server can't do it). */
export function AnnounceChoice({ a }: { a: Announce }) {
  const hintId = useId();

  if (!a.offered || !a.info) return null;
  const { finished, assigned } = a.info;

  return (
    <fieldset className='m-0 min-w-0 rounded-[10px] border border-border-primary px-3 pb-3 pt-1' data-testid='carehub-learning-announce'>
      <NoticesStyle />
      <legend className='px-1 text-sm font-medium'>{plural(finished, 'person', 'people')} finished an earlier version.</legend>
      <div className='flex flex-col gap-2 text-sm'>
        {ANNOUNCE_OPTIONS.map((o) => (
          <label key={o.id} className='flex cursor-pointer items-start gap-2'>
            <input
              type='radio'
              className='chn-check mt-[3px] shrink-0'
              name={`${a.noteId}-announce`}
              checked={a.choice === o.id}
              onChange={() => a.setChoice(o.id)}
              data-testid={`carehub-learning-announce-${o.id}`}
            />
            <span className='min-w-0'>
              <span className='block'>{o.label}</span>
              <span className='block text-xs text-text-tertiary'>{o.hint}</span>
            </span>
          </label>
        ))}
        {a.choice === 'retake' && assigned > 0 && (
          <div className='flex flex-col gap-1 pl-6'>
            <span className='flex flex-wrap items-center gap-2'>
              <span aria-hidden='true'>Due in</span>
              <input
                id={a.daysId}
                type='number'
                inputMode='numeric'
                min={1}
                max={MAX_DUE_DAYS}
                step={1}
                value={a.days}
                placeholder={String(RETAKE_DAYS)}
                aria-label='Due in this many days'
                aria-describedby={hintId}
                onChange={(e) => a.setDays(e.target.value)}
                className={cn(chInputClass, 'w-[76px]')}
                data-testid='carehub-learning-announce-days'
              />
              <span aria-hidden='true'>days</span>
            </span>
            <span id={hintId} className='text-xs text-text-tertiary'>
              For the {plural(assigned, 'person', 'people')} who {assigned === 1 ? 'has' : 'have'} it assigned.
            </span>
          </div>
        )}
      </div>
    </fieldset>
  );
}

function announceText(r: AnnounceResult, days: number) {
  if (r.already) return 'People were already told about this version.';
  if (r.people <= 0) return 'Nobody needed telling this time.';
  const who = plural(r.people, 'person', 'people');

  if (r.action === 'tell') return `We told ${who} what changed.`;
  const asked = `We asked ${who} to take it again.`;
  const time = `${plural(days, 'day')} to do it.`;

  if (r.assigned <= 0) return asked;
  if (r.people === 1) return `${asked} They have ${time}`;
  if (r.assigned >= r.people) return `${asked} They all have ${time}`;
  return `${asked} ${r.assigned} of them ${r.assigned === 1 ? 'has' : 'have'} ${time}`;
}

/** The result in the Published 🎉 view. One container throughout, so screen readers hear each change. */
export function AnnounceDone({ a }: { a: Announce }) {
  const box = useRef<HTMLDivElement>(null);
  const s = a.sent;

  return (
    <div ref={box} tabIndex={-1} role='status' className='text-sm outline-none' data-testid='carehub-learning-announce-result'>
      {s.state === 'sending' && <p className='m-0 text-text-secondary'>Telling people…</p>}
      {s.state === 'done' && <p className='m-0'>{announceText(s.result, s.days)}</p>}
      {s.state === 'failed' && (
        <span className='flex flex-wrap items-center gap-2 text-xs text-text-secondary' data-testid='carehub-learning-announce-failed'>
          <span>We couldn’t tell people this time.</span>
          <Button
            type='button'
            size='sm'
            variant='outline'
            onClick={() => {
              box.current?.focus();
              a.retry();
            }}
            data-testid='carehub-learning-announce-retry'
          >
            Try again
          </Button>
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assign page: Mark complete / Undo mark complete
// ---------------------------------------------------------------------------

/** "Mark Jordan Lee complete?" — `onMark` saves (and closes the dialog); its error shows here. */
export function MarkCompleteDialog({
  name,
  course,
  onMark,
  onClose,
}: {
  name: string;
  course: string;
  onMark: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const id = useId();
  const confirm = useRef<HTMLButtonElement>(null);

  useKeepFocus(busy, () => confirm.current);

  const go = async () => {
    const r = reason.trim();

    if ([...r].length > MAX_MARK_REASON) {
      setError(`Keep the reason to ${MAX_MARK_REASON} characters or fewer.`);
      document.getElementById(id)?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onMark(r);
    } catch (e) {
      setError(lErrorText(e));
      setBusy(false);
    }
  };

  return (
    <CareHubModal
      title={<span className='whitespace-normal break-words'>Mark {name} complete?</span>}
      onClose={onClose}
      testId='carehub-learning-mark-complete-dialog'
      footer={
        <>
          <Button type='button' variant='ghost' onClick={onClose}>
            Cancel
          </Button>
          <Button ref={confirm} type='button' loading={busy} onClick={() => void go()} data-testid='carehub-learning-mark-complete-confirm'>
            Mark complete
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-3 text-sm'>
        <p className='m-0'>
          This counts as finishing “{course}” everywhere: My learning, due dates, learning paths, reports and certificates.
        </p>
        <div className='flex min-w-0 flex-col gap-1'>
          <label htmlFor={id} className='text-xs font-medium text-text-secondary'>
            Reason (optional)
          </label>
          <input
            id={id}
            type='text'
            value={reason}
            placeholder='Classroom training on 21 Oct'
            className={cn(chInputClass, 'w-full min-w-0')}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) {
                e.preventDefault();
                void go();
              }
            }}
            data-testid='carehub-learning-mark-complete-reason'
          />
        </div>
        {error && <ChNote tone='error'>{error}</ChNote>}
      </div>
    </CareHubModal>
  );
}

/** "Undo mark complete?" — `onUndo` puts things back (and closes the dialog); its error shows here. */
export function UndoCompleteDialog({ name, onUndo, onClose }: { name: string; onUndo: () => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirm = useRef<HTMLButtonElement>(null);

  useKeepFocus(busy, () => confirm.current);

  const go = async () => {
    setBusy(true);
    setError('');
    try {
      await onUndo();
    } catch (e) {
      setError(lErrorText(e));
      setBusy(false);
    }
  };

  return (
    <CareHubModal
      title='Undo mark complete?'
      onClose={onClose}
      testId='carehub-learning-undo-complete-dialog'
      footer={
        <>
          <Button type='button' variant='ghost' onClick={onClose}>
            Cancel
          </Button>
          <Button
            ref={confirm}
            type='button'
            variant='destructive'
            loading={busy}
            onClick={() => void go()}
            data-testid='carehub-learning-undo-complete-confirm'
          >
            Undo mark complete
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-3 text-sm'>
        <p className='m-0'>{name} goes back to where they were before. Any certificate from this finish is removed.</p>
        {error && <ChNote tone='error'>{error}</ChNote>}
      </div>
    </CareHubModal>
  );
}

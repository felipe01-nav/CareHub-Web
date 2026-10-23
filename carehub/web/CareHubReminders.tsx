// CareHub reminders: "Remind me" on pages and calendar events. The server
// sends a message in the "🔔 Care Hub" chat at the chosen time.
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';

import { chCall, chErrorText, CH_API, formatWhen } from './CareHubCore';
import { CareHubModal, ChNote, chInputClass } from './CareHubUi';

export interface CareHubReminder {
  id: string;
  page_id?: string | null;
  title: string;
  note?: string;
  remind_at: number;
  created_at?: number;
  sent_at?: number | null;
}

export function loadReminders(workspaceId: string) {
  return chCall<{ upcoming: CareHubReminder[]; sent: CareHubReminder[] }>('get', `${CH_API}/${workspaceId}/reminders`);
}

export function addReminder(workspaceId: string, r: { title: string; note?: string; remind_at: number; page_id?: string }) {
  return chCall<CareHubReminder>('post', `${CH_API}/${workspaceId}/reminders`, r);
}

export function deleteReminder(workspaceId: string, id: string) {
  return chCall('delete', `${CH_API}/${workspaceId}/reminders/${id}`);
}

function at(daysAhead: number, hour: number, minute = 0) {
  const d = new Date();

  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

function quickPicks(now = Date.now()) {
  const picks: { id: string; label: string; ms: number }[] = [];

  picks.push({ id: '1h', label: 'In 1 hour', ms: now + 60 * 60 * 1000 });
  const evening = at(0, 18);

  if (evening - now > 30 * 60 * 1000) picks.push({ id: 'evening', label: 'This evening (6 PM)', ms: evening });
  picks.push({ id: 'tomorrow', label: 'Tomorrow morning (9 AM)', ms: at(1, 9) });
  const today = new Date().getDay();
  const toMonday = ((8 - today) % 7) || 7;

  picks.push({ id: 'monday', label: 'Next Monday (9 AM)', ms: at(toMonday, 9) });
  return picks;
}

function toLocalInput(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ReminderDialog({
  workspaceId,
  pageId,
  title: initialTitle = '',
  at: initialAt,
  note: initialNote = '',
  onClose,
}: {
  workspaceId: string;
  pageId?: string;
  title?: string;
  at?: number;
  note?: string;
  onClose: () => void;
}) {
  const picks = useMemo(() => quickPicks(), []);
  const [choice, setChoice] = useState<string>(initialAt ? 'custom' : picks[0].id);
  const [custom, setCustom] = useState(toLocalInput(initialAt || Date.now() + 60 * 60 * 1000));
  const [title, setTitle] = useState(initialTitle || 'Reminder');
  const [note, setNote] = useState(initialNote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [list, setList] = useState<CareHubReminder[] | null>(null);

  const refresh = useCallback(() => {
    loadReminders(workspaceId)
      .then((r) => setList(r.upcoming || []))
      .catch(() => setList([]));
  }, [workspaceId]);

  useEffect(refresh, [refresh]);

  const when = choice === 'custom' ? new Date(custom).getTime() : picks.find((p) => p.id === choice)?.ms || 0;

  const save = async () => {
    setError('');
    setDone('');
    if (!when || Number.isNaN(when)) return setError('Pick a date and time.');
    if (when < Date.now() - 60 * 1000) return setError('That time has already passed.');
    setBusy(true);
    try {
      await addReminder(workspaceId, { title: title.trim() || 'Reminder', note: note.trim(), remind_at: when, page_id: pageId });
      setDone(`Done! You'll get a message in Messages → “🔔 Care Hub” ${formatWhen(when).toLowerCase().startsWith('today') ? '' : 'on '}${formatWhen(when)}.`);
      refresh();
    } catch (e) {
      setError(chErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CareHubModal
      title='⏰ Remind me'
      onClose={onClose}
      testId='carehub-reminder-dialog'
      footer={
        <>
          <Button variant='ghost' onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => void save()} loading={busy} disabled={busy}>
            Set reminder
          </Button>
        </>
      }
    >
      <label className='mb-1 block text-xs font-medium text-text-secondary'>What</label>
      <input className={`${chInputClass} mb-3 w-full`} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
      <label className='mb-1 block text-xs font-medium text-text-secondary'>When</label>
      <div className='mb-3 flex flex-col gap-1'>
        {picks.map((p) => (
          <label key={p.id} className='flex cursor-pointer items-center gap-2 rounded-[8px] px-2 py-1.5 text-sm hover:bg-fill-content-hover'>
            <input type='radio' checked={choice === p.id} onChange={() => setChoice(p.id)} />
            <span className='flex-1'>{p.label}</span>
            <span className='text-xs text-text-tertiary'>{formatWhen(p.ms)}</span>
          </label>
        ))}
        <label className='flex cursor-pointer flex-wrap items-center gap-2 rounded-[8px] px-2 py-1.5 text-sm hover:bg-fill-content-hover'>
          <input type='radio' checked={choice === 'custom'} onChange={() => setChoice('custom')} />
          <span>Pick a time</span>
          <input
            type='datetime-local'
            className={`${chInputClass} ml-auto`}
            value={custom}
            onFocus={() => setChoice('custom')}
            onChange={(e) => {
              setCustom(e.target.value);
              setChoice('custom');
            }}
          />
        </label>
      </div>
      <label className='mb-1 block text-xs font-medium text-text-secondary'>Note (optional)</label>
      <textarea
        className={`${chInputClass} mb-3 min-h-[64px] w-full`}
        value={note}
        maxLength={2000}
        placeholder='Anything you want to remember'
        onChange={(e) => setNote(e.target.value)}
      />
      {pageId && <div className='mb-3 text-xs text-text-tertiary'>The message will include a link to this page.</div>}
      {error && <ChNote tone='error'>{error}</ChNote>}
      {done && <ChNote tone='ok'>{done}</ChNote>}
      <div className='mt-4'>
        <div className='mb-1 text-xs font-medium text-text-secondary'>Your upcoming reminders</div>
        {list === null ? (
          <div className='text-xs text-text-tertiary'>Loading…</div>
        ) : list.length === 0 ? (
          <div className='text-xs text-text-tertiary'>None yet.</div>
        ) : (
          <div className='flex flex-col'>
            {list.map((r) => (
              <div key={r.id} className='flex items-center gap-2 border-b border-border-primary py-1.5 text-sm last:border-0'>
                <span className='min-w-0 flex-1 truncate'>{r.title}</span>
                <span className='shrink-0 text-xs text-text-tertiary'>{formatWhen(r.remind_at)}</span>
                <button
                  type='button'
                  className='shrink-0 rounded-[6px] px-1.5 text-xs text-text-tertiary hover:bg-fill-content-hover hover:text-text-primary'
                  onClick={() => {
                    void deleteReminder(workspaceId, r.id).then(refresh, (e) => setError(chErrorText(e)));
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </CareHubModal>
  );
}

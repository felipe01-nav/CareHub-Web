// CareHub calendar: "Take meeting notes" and "Remind me" buttons on events.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { Button } from '@/components/ui/button';

import type { CalEvent } from './CareHubCalendar';
import { B, chErrorText, createPageWithBlocks, ensureFolderPage, lastWorkspaceId, openCareHubDialog, useCareHubCan } from './CareHubCore';

const NOTES_KEY = 'carehub-meeting-notes';

function remembered(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(NOTES_KEY) || '{}');
  } catch {
    return {};
  }
}

function remember(key: string, value: string) {
  try {
    const all = remembered();

    all[key] = value;
    const keys = Object.keys(all);

    if (keys.length > 300) delete all[keys[0]];
    localStorage.setItem(NOTES_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
}

function whenText(e: CalEvent) {
  const d = new Date(e.start);
  const date = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  if (e.allDay) return date;
  return `${date}, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – ${new Date(e.end).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

export function CareHubEventActions({ event }: { event: CalEvent }) {
  const ctxWorkspace = useCurrentWorkspaceId();
  const workspaceId = ctxWorkspace || lastWorkspaceId() || '';
  const navigate = useNavigate();
  const canCreate = useCareHubCan(workspaceId, 'create');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = `${workspaceId}:${event.key}`;
  const existing = remembered()[key];

  if (!workspaceId) return null;

  const takeNotes = async () => {
    setError('');
    if (existing) {
      navigate(`/app/${workspaceId}/${existing}`);
      return;
    }

    setBusy(true);
    try {
      const folder = await ensureFolderPage(workspaceId, 'Meeting Notes');
      const date = new Date(event.start).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
      const blocks = [
        B.bold('When: ', whenText(event)),
        ...(event.location ? [B.bold('Where: ', event.location)] : []),
        B.bold('Calendar: ', event.calendarName),
        B.bold('Attendees: '),
        ...(event.notes ? [B.quote(event.notes.slice(0, 1500))] : []),
        B.h2('Agenda'),
        B.bullet(''),
        B.h2('Notes'),
        B.p(''),
        B.h2('Action items'),
        B.todo(''),
        B.h2('Decisions'),
        B.bullet(''),
      ];
      const viewId = await createPageWithBlocks(workspaceId, folder, `Meeting notes: ${event.title || 'Meeting'} – ${date}`, blocks);

      remember(key, viewId);
      navigate(`/app/${workspaceId}/${viewId}`);
    } catch (e) {
      setError(chErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const soon = event.start - 10 * 60 * 1000;

  return (
    <div className='flex flex-col gap-1.5' data-testid='carehub-event-actions'>
      <div className='flex gap-2'>
        {canCreate && (
          <Button variant='outline' className='flex-1' onClick={() => void takeNotes()} loading={busy} disabled={busy}>
            📝 {existing ? 'Open meeting notes' : 'Take meeting notes'}
          </Button>
        )}
        {event.start > Date.now() && (
          <Button
            variant='outline'
            className='flex-1'
            onClick={() =>
              openCareHubDialog({
                kind: 'reminder',
                workspaceId,
                title: event.title || 'Event',
                at: soon > Date.now() + 60000 ? soon : event.start,
                note: `Starts ${whenText(event)}${event.location ? ` · ${event.location}` : ''}`,
              })
            }
          >
            ⏰ Remind me
          </Button>
        )}
      </div>
      {error && <div className='text-xs text-[#dc2626]'>{error}</div>}
    </div>
  );
}

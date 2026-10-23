// CareHub: quiet helpers that run on every screen. Counts page visits for
// analytics, empties old trash for admins (if turned on) and shows the
// reminder / analytics / template windows opened from menus.
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import {
  CAREHUB_DIALOG_EVENT,
  CareHubDialogRequest,
  carehubCan,
  chCall,
  loadCareHubMe,
  loadCareHubSettings,
  recordPageActivity,
  rememberWorkspaceId,
  saveCareHubSetting,
  UUID_RE,
} from './CareHubCore';
import { PageAnalyticsDialog } from './CareHubAnalytics';
import { ReminderDialog } from './CareHubReminders';
import { SaveTemplateDialog } from './CareHubTemplates';

const TRASH_CHECK_KEY = 'carehub-trash-check';

function pageTitle() {
  return (document.title || '').replace(/\s*[|·-]\s*Care Hub\s*$/i, '').trim();
}

interface TrashItem {
  view_id?: string;
  view?: { view_id?: string };
}

async function emptyOldTrash(workspaceId: string) {
  const day = new Date().toDateString();

  try {
    if (localStorage.getItem(`${TRASH_CHECK_KEY}:${workspaceId}`) === day) return;
    localStorage.setItem(`${TRASH_CHECK_KEY}:${workspaceId}`, day);
  } catch {
    return;
  }

  const me = await loadCareHubMe(workspaceId);

  if (!me || !carehubCan(me, 'admin')) return;
  const settings = await loadCareHubSettings(workspaceId);
  const days = settings.retention?.trash_days || 0;

  if (!days) return;
  const res = await chCall<unknown>('get', `/api/workspace/${workspaceId}/trash`);
  const list = (Array.isArray(res) ? res : (res as { items?: TrashItem[] })?.items || []) as TrashItem[];
  const ids = list.map((t) => t.view_id || t.view?.view_id).filter((id): id is string => !!id && UUID_RE.test(id));
  const seen = { ...(settings.trash_seen || {}) };
  const now = Date.now();
  const next: Record<string, number> = {};

  for (const id of ids) {
    const first = seen[id] || now;

    if (now - first > days * 86400000) {
      try {
        await chCall('delete', `/api/workspace/${workspaceId}/trash/${id}`);
        continue;
      } catch {
        // keep it for next time
      }
    }

    next[id] = first;
  }

  await saveCareHubSetting(workspaceId, 'trash_seen', next);
}

export default function CareHubBackground() {
  const location = useLocation();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<CareHubDialogRequest | null>(null);

  // Page visits
  useEffect(() => {
    const parts = location.pathname.split('/');

    if (parts[1] !== 'app' || !UUID_RE.test(parts[2] || '')) return;
    const workspaceId = parts[2];

    rememberWorkspaceId(workspaceId);
    const pageId = parts[3];

    if (!pageId || !UUID_RE.test(pageId)) return;
    const timer = window.setTimeout(() => recordPageActivity(workspaceId, pageId, 'view', pageTitle()), 2000);

    return () => window.clearTimeout(timer);
  }, [location.pathname]);

  // Old trash (admins only, once a day)
  useEffect(() => {
    const parts = location.pathname.split('/');

    if (parts[1] !== 'app' || !UUID_RE.test(parts[2] || '')) return;
    const workspaceId = parts[2];
    const timer = window.setTimeout(() => {
      emptyOldTrash(workspaceId).catch(() => undefined);
    }, 20000);

    return () => window.clearTimeout(timer);
  }, [location.pathname]);

  // Windows opened from menus
  useEffect(() => {
    const onOpen = (e: Event) => setDialog((e as CustomEvent<CareHubDialogRequest>).detail);

    window.addEventListener(CAREHUB_DIALOG_EVENT, onOpen);
    return () => window.removeEventListener(CAREHUB_DIALOG_EVENT, onOpen);
  }, []);

  if (!dialog) return null;
  const close = () => setDialog(null);

  if (dialog.kind === 'reminder') {
    return (
      <ReminderDialog
        workspaceId={dialog.workspaceId}
        pageId={dialog.pageId}
        title={dialog.title}
        at={dialog.at}
        note={dialog.note}
        onClose={close}
      />
    );
  }

  if (dialog.kind === 'page-analytics') {
    return <PageAnalyticsDialog workspaceId={dialog.workspaceId} pageId={dialog.pageId} title={dialog.title} onClose={close} />;
  }

  if (dialog.kind === 'save-template') {
    return <SaveTemplateDialog workspaceId={dialog.workspaceId} pageId={dialog.pageId} title={dialog.title} onClose={close} />;
  }

  void navigate;
  return null;
}

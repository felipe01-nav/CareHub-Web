// CareHub core: small helpers shared by roles, analytics, page versions,
// reminders, automations, templates and the status page.
import { useEffect, useState } from 'react';

import { executeAPIRequest, getAxios } from '@/application/services/js-services/http/core';

export const CH_API = '/api/carehub/ws';
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function chCall<T>(method: 'get' | 'post' | 'put' | 'delete', url: string, data?: unknown) {
  return executeAPIRequest<T>(() => getAxios()?.request({ method, url, data }));
}

const SERVER_PREFIX =
  /^\s*(invalid request|not enough permissions|record not found|record already exists|invalid password|invalid email)\s*:\s*/i;

/**
 * Words to show for a failed Care Hub request. The app swaps server messages for generic ones
 * ("This request isn't valid."), but Care Hub's server writes its messages for people, so show those.
 */
export function chErrorText(err: unknown) {
  const e = (err || {}) as {
    message?: string;
    diagnosticMessage?: string;
    sourceDomain?: string;
    httpStatus?: number;
  };
  const generic =
    typeof e.message === 'string' && e.message.trim() ? e.message.trim() : 'Something went wrong. Please try again.';
  const server = typeof e.diagnosticMessage === 'string' ? e.diagnosticMessage.trim() : '';

  if (!server || server === 'Request failed' || e.sourceDomain === 'transport' || e.sourceDomain === 'client') {
    return generic;
  }

  if (/^internal error/i.test(server) || (e.httpStatus ?? 0) >= 500) {
    return server === generic ? generic : `${generic} (${server.slice(0, 200)})`;
  }

  return server.replace(SERVER_PREFIX, '').trim() || generic;
}

/** Minutes east of UTC, e.g. -360 in Utah in summer. */
export function tzMinutesEast() {
  return -new Date().getTimezoneOffset();
}

/** The workspace in a URL like /app/{workspace}/{page}. */
export function workspaceFromPath(path: string): string | null {
  const parts = path.split('/');

  return parts[1] === 'app' && UUID_RE.test(parts[2] || '') ? parts[2] : null;
}

export function lastWorkspaceId(): string | null {
  try {
    return localStorage.getItem('carehub-last-workspace');
  } catch {
    return null;
  }
}

export function rememberWorkspaceId(id: string) {
  try {
    localStorage.setItem('carehub-last-workspace', id);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Roles & permissions
// ---------------------------------------------------------------------------

export type CareHubPerm =
  | 'edit'
  | 'create'
  | 'comment'
  | 'share'
  | 'ai'
  | 'templates'
  | 'analytics'
  | 'automations'
  | 'learning_build'
  | 'learning_assign'
  | 'learning_analytics'
  | 'admin';

export const CAREHUB_PERMS: { id: CareHubPerm; label: string; hint: string }[] = [
  { id: 'edit', label: 'Edit pages', hint: 'Change text, tables and databases' },
  { id: 'create', label: 'Create pages', hint: 'Add pages and spaces, change the sidebar' },
  { id: 'comment', label: 'Comment', hint: 'Leave comments on pages' },
  { id: 'share', label: 'Share', hint: 'Share pages with others' },
  { id: 'ai', label: 'Use Claude (AI)', hint: 'AI writer, AI chat and the assistant' },
  { id: 'templates', label: 'Manage templates', hint: 'Save pages as templates and remove them' },
  { id: 'analytics', label: 'See analytics', hint: 'Who viewed and edited what' },
  { id: 'automations', label: 'Manage automations', hint: 'Scheduled and automatic messages' },
  { id: 'learning_build', label: 'Build courses', hint: 'Create, edit and publish courses, and see their reports' },
  { id: 'learning_assign', label: 'Assign courses', hint: 'Assign courses to people, roles or groups with due dates' },
  { id: 'learning_analytics', label: 'See course reports', hint: 'Read-only course and people reports, CSV export' },
  { id: 'admin', label: 'Admin', hint: 'Roles, data & backups, everything above' },
];

export interface CareHubRole {
  id: string;
  name: string;
  builtin?: boolean;
  perms: CareHubPerm[];
  description?: string;
}

export interface CareHubMe {
  role: { id: string; name: string };
  perms: CareHubPerm[];
  email: string;
  is_owner: boolean;
  is_guest: boolean;
  env_admin: boolean;
  roles: CareHubRole[];
}

const meCache = new Map<string, { me: CareHubMe; at: number }>();
const meLoading = new Map<string, Promise<CareHubMe | null>>();
const meListeners = new Set<() => void>();
const ME_TTL_MS = 5 * 60 * 1000;

export function loadCareHubMe(workspaceId: string, force = false): Promise<CareHubMe | null> {
  const cached = meCache.get(workspaceId);

  if (!force && cached && Date.now() - cached.at < ME_TTL_MS) return Promise.resolve(cached.me);
  const running = meLoading.get(workspaceId);

  if (running) return running;
  const promise = chCall<CareHubMe>('get', `${CH_API}/${workspaceId}/me`)
    .then((me) => {
      meCache.set(workspaceId, { me, at: Date.now() });
      meListeners.forEach((fn) => fn());
      return me;
    })
    .catch(() => cached?.me ?? null)
    .finally(() => meLoading.delete(workspaceId));

  meLoading.set(workspaceId, promise);
  return promise;
}

export function refreshCareHubMe(workspaceId: string) {
  void loadCareHubMe(workspaceId, true);
}

export function useCareHubMe(workspaceId?: string | null): CareHubMe | null {
  const [, setTick] = useState(0);

  useEffect(() => {
    const listener = () => setTick((n) => n + 1);

    meListeners.add(listener);
    if (workspaceId) void loadCareHubMe(workspaceId);
    const timer = window.setInterval(() => {
      if (workspaceId) void loadCareHubMe(workspaceId);
    }, ME_TTL_MS);

    return () => {
      meListeners.delete(listener);
      window.clearInterval(timer);
    };
  }, [workspaceId]);

  return workspaceId ? meCache.get(workspaceId)?.me ?? null : null;
}

/** Before the role is known, everyday things are allowed and admin things hidden. */
export function carehubCan(me: CareHubMe | null | undefined, perm: CareHubPerm) {
  if (!me) {
    return !['analytics', 'automations', 'learning_build', 'learning_assign', 'learning_analytics', 'admin'].includes(perm);
  }

  return me.perms.includes('admin') || me.perms.includes(perm);
}

export function useCareHubCan(workspaceId: string | null | undefined, perm: CareHubPerm) {
  return carehubCan(useCareHubMe(workspaceId), perm);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface CareHubRetention {
  versions_days: number;
  analytics_days: number;
  trash_days: number;
}

export interface CareHubSettings {
  roles: {
    default: string;
    assign: Record<string, string>;
    custom: CareHubRole[];
    list: CareHubRole[];
  };
  retention: CareHubRetention;
  templates: CareHubTemplate[];
  automations?: CareHubRule[];
  trash_seen?: Record<string, number> | null;
}

export function loadCareHubSettings(workspaceId: string) {
  return chCall<CareHubSettings>('get', `${CH_API}/${workspaceId}/settings`);
}

export function saveCareHubSetting<T>(workspaceId: string, key: string, value: unknown) {
  return chCall<T>('put', `${CH_API}/${workspaceId}/settings/${key}`, value);
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

const viewed = new Map<string, number>();

/** Records that this person opened (or edited) a page. At most every 10 minutes per page. */
export function recordPageActivity(workspaceId: string, pageId: string, kind: 'view' | 'edit', title = '') {
  if (!UUID_RE.test(workspaceId) || !UUID_RE.test(pageId)) return;
  const key = `${kind}:${pageId}`;
  const last = viewed.get(key) || 0;

  if (Date.now() - last < 10 * 60 * 1000) return;
  viewed.set(key, Date.now());
  void chCall('post', `${CH_API}/${workspaceId}/analytics/view`, { page_id: pageId, title, kind }).catch(() => {
    viewed.delete(key);
  });
}

// ---------------------------------------------------------------------------
// Dialogs opened from anywhere (page menu, calendar, sidebar)
// ---------------------------------------------------------------------------

export type CareHubDialogRequest =
  | { kind: 'reminder'; workspaceId: string; pageId?: string; title?: string; at?: number; note?: string }
  | { kind: 'page-analytics'; workspaceId: string; pageId: string; title?: string }
  | { kind: 'save-template'; workspaceId: string; pageId: string; title?: string };

export const CAREHUB_DIALOG_EVENT = 'carehub-dialog';

export function openCareHubDialog(request: CareHubDialogRequest) {
  window.dispatchEvent(new CustomEvent<CareHubDialogRequest>(CAREHUB_DIALOG_EVENT, { detail: request }));
}

// ---------------------------------------------------------------------------
// Pages with content (templates, meeting notes)
// ---------------------------------------------------------------------------

export interface SerdeBlock {
  type: string;
  data?: Record<string, unknown>;
  children?: SerdeBlock[];
}

export interface CareHubTemplate {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  blocks: SerdeBlock[];
  builtin?: boolean;
  created_by?: number;
  created_ms?: number;
}

export function block(type: string, text = '', data: Record<string, unknown> = {}, children: SerdeBlock[] = []): SerdeBlock {
  return { type, data: text ? { ...data, delta: [{ insert: text }] } : { ...data, delta: [] }, children };
}

export const B = {
  h1: (t: string) => block('heading', t, { level: 1 }),
  h2: (t: string) => block('heading', t, { level: 2 }),
  h3: (t: string) => block('heading', t, { level: 3 }),
  p: (t = '') => block('paragraph', t),
  bold: (label: string, rest = '') =>
    ({ type: 'paragraph', data: { delta: [{ insert: label, attributes: { bold: true } }, ...(rest ? [{ insert: rest }] : [])] }, children: [] }) as SerdeBlock,
  todo: (t = '') => block('todo_list', t, { checked: false }),
  bullet: (t = '') => block('bulleted_list', t),
  number: (t = '') => block('numbered_list', t),
  quote: (t: string) => block('quote', t),
  callout: (t: string, icon = '💡') => block('callout', t, { icon }),
  divider: () => ({ type: 'divider', data: {}, children: [] }) as SerdeBlock,
  toggle: (t: string, children: SerdeBlock[]) => block('toggle_list', t, {}, children),
};

interface FolderNode {
  view_id: string;
  name: string;
  is_space?: boolean;
  is_private?: boolean;
  extra?: unknown;
  children?: FolderNode[];
}

function extraOf(node: FolderNode): Record<string, unknown> {
  if (!node.extra) return {};
  if (typeof node.extra === 'string') {
    try {
      return JSON.parse(node.extra) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  return node.extra as Record<string, unknown>;
}

export function isSpaceNode(node: FolderNode) {
  return Boolean(node.is_space || extraOf(node).is_space);
}

export async function loadFolder(workspaceId: string, depth = 2) {
  return chCall<FolderNode>('get', `/api/workspace/${workspaceId}/folder?depth=${depth}`);
}

/** The first shared space (or the first space at all). */
export async function firstSpace(workspaceId: string) {
  const root = await loadFolder(workspaceId, 2);
  const spaces = (root.children || []).filter(isSpaceNode);
  const shared = spaces.find((s) => !s.is_private && extraOf(s).space_permission !== 1);

  return { space: shared || spaces[0] || (root.children || [])[0], root };
}

export async function createPage(workspaceId: string, parentId: string, name: string, layout = 0) {
  const page = await chCall<{ view_id: string }>('post', `/api/workspace/${workspaceId}/page-view`, {
    parent_view_id: parentId,
    layout,
    name,
  });

  return page.view_id;
}

export async function appendBlocks(workspaceId: string, viewId: string, blocks: SerdeBlock[]) {
  if (!blocks.length) return;
  // Small batches keep each request quick.
  for (let i = 0; i < blocks.length; i += 40) {
    await chCall('post', `/api/workspace/${workspaceId}/page-view/${viewId}/append-block`, {
      blocks: blocks.slice(i, i + 40),
    });
  }
}

export async function createPageWithBlocks(workspaceId: string, parentId: string, name: string, blocks: SerdeBlock[]) {
  const viewId = await createPage(workspaceId, parentId, name);

  await appendBlocks(workspaceId, viewId, blocks);
  return viewId;
}

/** Finds (or makes) a page with this name directly inside the first space. */
export async function ensureFolderPage(workspaceId: string, name: string) {
  const { space } = await firstSpace(workspaceId);

  if (!space) throw new Error('No space found in this workspace');
  const existing = (space.children || []).find((c) => (c.name || '').trim().toLowerCase() === name.toLowerCase());

  if (existing) return existing.view_id;
  const viewId = await createPage(workspaceId, space.view_id, name);

  return viewId;
}

export function formatWhen(ms: number) {
  const d = new Date(ms);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (sameDay) return `Today ${time}`;
  const yesterday = new Date(Date.now() - 86400000);

  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })} ${time}`;
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export interface CareHubRule {
  id: string;
  name: string;
  enabled: boolean;
  tz?: number;
  trigger:
    | { type: 'schedule'; every: 'day' | 'weekday' | 'week' | 'month'; time: string; weekday?: number; day?: number }
    | { type: 'form_submitted'; page_id?: string | null; page_title?: string }
    | { type: 'page_created'; include_own?: boolean };
  action: {
    type: 'message';
    to: 'people' | 'chat';
    people?: string[];
    chat_id?: string | null;
    text: string;
    page_id?: string | null;
    page_title?: string;
  };
  created_by?: number;
  created_ms?: number;
}

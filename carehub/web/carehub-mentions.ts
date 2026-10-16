// CareHub: "@" mention search done in the browser.
// This server has no mention-search service, so the @ menu (people, pages,
// dates) is built here from the workspace members and the page tree.
import dayjs from 'dayjs';

import {
  MentionSearchRequest,
  MentionSearchResponse,
  MentionSearchResultItem,
  MentionSearchSection,
  MentionSearchSectionKind,
  MentionTargetKind,
} from '@/application/types';

import { APIResponse, executeAPIRequest, getAxios } from './core';

interface RawPerson {
  person_id: string;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
}

interface RawView {
  view_id: string;
  name?: string;
  layout?: number;
  icon?: { ty?: number; value?: string } | null;
  extra?: Record<string, unknown> | string | null;
  children?: RawView[];
  last_edited_time?: string;
}

interface PageEntry {
  id: string;
  name: string;
  icon?: string;
  path: string;
  edited: number;
}

const CACHE_MS = 30_000;
const DATABASE_LAYOUTS = new Set([1, 2, 3, 5, 6, 7, 8, 9]);
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);

  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as Promise<T>;
  const value = load().catch((err) => {
    cache.delete(key);
    throw err;
  });

  cache.set(key, { at: Date.now(), value });
  return value;
}

function extraOf(view: RawView): Record<string, unknown> {
  if (!view.extra) return {};
  if (typeof view.extra === 'string') {
    try {
      return JSON.parse(view.extra) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  return view.extra;
}

function loadPeople(workspaceId: string) {
  return cached(`people:${workspaceId}`, async () => {
    const data = await executeAPIRequest<{ persons: RawPerson[] }>(() =>
      getAxios()?.get<APIResponse<{ persons: RawPerson[] }>>(`/api/workspace/${workspaceId}/mentionable-person`)
    );

    return data?.persons ?? [];
  });
}

function loadPages(workspaceId: string) {
  return cached(`pages:${workspaceId}`, async () => {
    const root = await executeAPIRequest<RawView>(() =>
      getAxios()?.get<APIResponse<RawView>>(`/api/workspace/${workspaceId}/view/${workspaceId}?depth=10`)
    );
    const pages: PageEntry[] = [];
    const walk = (views: RawView[], trail: string[], insideDatabase: boolean) => {
      views.forEach((view) => {
        const extra = extraOf(view);
        const isSpace = Boolean(extra.is_space);
        const isDatabase = DATABASE_LAYOUTS.has(view.layout ?? 0);
        const embedded = Boolean(extra.embedded);
        const name = view.name || 'Untitled';

        if (!isSpace && !insideDatabase && !embedded && view.layout !== 4) {
          pages.push({
            id: view.view_id,
            name,
            icon: view.icon && view.icon.ty === 0 ? view.icon.value : undefined,
            path: trail.join(' / '),
            edited: Date.parse(view.last_edited_time ?? '') || 0,
          });
        }

        walk(view.children || [], [...trail, name], insideDatabase || isDatabase);
      });
    };

    walk(root?.children || [], [], false);
    return pages;
  });
}

function score(text: string, query: string) {
  if (!query) return 1;
  const t = text.toLowerCase();

  if (t.startsWith(query)) return 3;
  if (t.split(/\s+/).some((w) => w.startsWith(query))) return 2;
  return t.includes(query) ? 1 : 0;
}

function section(kind: MentionSearchSectionKind, title: string, items: MentionSearchResultItem[]): MentionSearchSection {
  return { kind, title, items, has_more: false, status: 'ready' };
}

function dateItems(query: string): MentionSearchResultItem[] {
  const options = [
    { id: 'today', title: 'Today', date: dayjs() },
    { id: 'tomorrow', title: 'Tomorrow', date: dayjs().add(1, 'day') },
    { id: 'yesterday', title: 'Yesterday', date: dayjs().subtract(1, 'day') },
  ];

  return options
    .filter((o) => !query || o.title.toLowerCase().includes(query))
    .map((o) => ({
      kind: MentionTargetKind.Date,
      object_id: o.id,
      title: o.title,
      mention: { type: MentionTargetKind.Date, start: o.date.toISOString() },
    }));
}

export async function carehubSearchMentions(
  workspaceId: string,
  request: MentionSearchRequest
): Promise<MentionSearchResponse> {
  const include = request.include && request.include.length > 0 ? request.include : undefined;
  const wants = (kind: MentionTargetKind) => !include || include.includes(kind);
  const query = (request.query ?? '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(request.limit ?? 20, 50));
  const pageId = request.context?.view_id ?? '';
  const sections: MentionSearchSection[] = [];
  let partial = false;

  if (wants(MentionTargetKind.Person)) {
    try {
      const people = await loadPeople(workspaceId);
      const items = people
        .map((p) => ({ p, s: Math.max(score(p.name || '', query), score(p.email || '', query)) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || (a.p.name || '').localeCompare(b.p.name || ''))
        .slice(0, limit)
        .map(({ p }) => ({
          kind: MentionTargetKind.Person,
          object_id: p.person_id,
          title: p.name || p.email || 'Unknown',
          subtitle: p.email || undefined,
          icon: p.avatar_url || undefined,
          mention: {
            type: MentionTargetKind.Person as const,
            person_id: p.person_id,
            person_name: p.name || p.email || '',
            page_id: pageId,
          },
        }));

      if (items.length > 0) sections.push(section(MentionSearchSectionKind.People, 'People', items));
    } catch (err) {
      partial = true;
      console.warn('[CareHub] could not load people for @ mentions', err);
    }
  }

  if (wants(MentionTargetKind.Page) || wants(MentionTargetKind.Database)) {
    try {
      const pages = await loadPages(workspaceId);
      const items = pages
        .filter((p) => p.id !== pageId)
        .map((p) => ({ p, s: score(p.name, query) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || b.p.edited - a.p.edited)
        .slice(0, limit)
        .map(({ p }) => ({
          kind: MentionTargetKind.Page,
          object_id: p.id,
          title: p.name,
          subtitle: p.path || undefined,
          icon: p.icon,
          mention: { type: MentionTargetKind.Page as const, page_id: p.id },
        }));

      sections.push(section(MentionSearchSectionKind.Pages, 'Pages', items));
    } catch (err) {
      partial = true;
      console.warn('[CareHub] could not load pages for @ mentions', err);
    }
  }

  if (wants(MentionTargetKind.Date) && include) {
    const items = dateItems(query);

    if (items.length > 0) sections.push(section(MentionSearchSectionKind.Dates, 'Date', items));
  }

  return { sections, partial };
}

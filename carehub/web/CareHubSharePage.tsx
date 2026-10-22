// CareHub: pages in Messages. A message can carry page cards. In the text they
// are written as [[page:WORKSPACE:VIEW|Title]]; the chat shows them as cards
// that open the page. Pick pages with the page button or by typing "@".
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { View, ViewIconType, ViewLayout } from '@/application/types';
import { isSpaceView } from '@/components/ai-chat/rag-scope';
import { useAppOutline, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface PageRef {
  workspaceId: string;
  viewId: string;
  name: string;
}

export interface PageEntry extends PageRef {
  icon: string;
  trail: string;
  isPrivate: boolean;
  layout: ViewLayout;
}

const TOKEN_RE = /\[\[page:([0-9a-fA-F-]{36}):([0-9a-fA-F-]{36})(?:\|([^\]]*))?\]\]/g;

function cleanTitle(name: string) {
  return (name || 'Untitled').replace(/[[\]|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled';
}

export function pageToken(page: PageRef) {
  return `[[page:${page.workspaceId}:${page.viewId}|${cleanTitle(page.name)}]]`;
}

export function pagesInText(text: string): PageRef[] {
  const found: PageRef[] = [];

  for (const match of text.matchAll(TOKEN_RE)) {
    found.push({ workspaceId: match[1], viewId: match[2], name: match[3] || 'Untitled' });
  }

  return found;
}

/** Message text for previews and notifications: page cards become "📄 Title". */
export function plainMessageText(text: string) {
  return text.replace(TOKEN_RE, (_all, _ws, _view, title) => `📄 ${title || 'Page'}`);
}

/** Split a message into text parts and page cards. */
export function splitMessage(text: string): Array<{ text: string } | { page: PageRef }> {
  const parts: Array<{ text: string } | { page: PageRef }> = [];
  let last = 0;

  for (const match of text.matchAll(TOKEN_RE)) {
    const at = match.index ?? 0;

    if (at > last) parts.push({ text: text.slice(last, at) });
    parts.push({ page: { workspaceId: match[1], viewId: match[2], name: match[3] || 'Untitled' } });
    last = at + match[0].length;
  }

  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

function iconOf(view: View) {
  if (view.icon && view.icon.ty === ViewIconType.Emoji && view.icon.value) return view.icon.value;
  if (view.layout === ViewLayout.Grid || view.layout === ViewLayout.Board || view.layout === ViewLayout.Calendar) return '🗂️';
  return '📄';
}

/** Every page in the sidebar of the current workspace (spaces themselves excluded). */
export function useSharablePages(): PageEntry[] {
  const outline = useAppOutline();
  const workspaceId = useCurrentWorkspaceId();

  return useMemo(() => {
    const pages: PageEntry[] = [];

    if (!workspaceId || !outline) return pages;
    const walk = (views: View[], trail: string[], isPrivate: boolean) => {
      for (const view of views) {
        if (!view) continue;
        const priv = isPrivate || Boolean(view.is_private);

        if (isSpaceView(view)) {
          walk(view.children || [], [view.name || 'Space'], priv);
          continue;
        }

        pages.push({
          workspaceId,
          viewId: view.view_id,
          name: view.name || 'Untitled',
          icon: iconOf(view),
          trail: trail.join(' / '),
          isPrivate: priv,
          layout: view.layout,
        });
        if (pages.length < 3000) walk(view.children || [], [...trail, view.name || 'Untitled'], priv);
      }
    };

    walk(outline, [], false);
    return pages;
  }, [outline, workspaceId]);
}

export function filterPages(pages: PageEntry[], query: string, limit = 50) {
  const needle = query.trim().toLowerCase();

  if (!needle) return pages.slice(0, limit);
  const starts: PageEntry[] = [];
  const contains: PageEntry[] = [];

  for (const page of pages) {
    const name = page.name.toLowerCase();

    if (name.startsWith(needle)) starts.push(page);
    else if (name.includes(needle) || page.trail.toLowerCase().includes(needle)) contains.push(page);
    if (starts.length >= limit) break;
  }

  return [...starts, ...contains].slice(0, limit);
}

export function PageGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} width='16' height='16' viewBox='0 0 20 20' fill='none' stroke='currentColor' strokeWidth='1.5'>
      <path d='M5 2.75h6.5L15.25 6.5v10.75H5z' strokeLinejoin='round' />
      <path d='M11.25 2.75V6.75h4M7.5 10.5h5M7.5 13.5h5' strokeLinecap='round' />
    </svg>
  );
}

function LockGlyph() {
  return (
    <svg width='12' height='12' viewBox='0 0 20 20' fill='none' stroke='currentColor' strokeWidth='1.6'>
      <rect x='4.5' y='9' width='11' height='8' rx='1.5' />
      <path d='M7 9V6.5a3 3 0 0 1 6 0V9' />
    </svg>
  );
}

/** A page card inside a message. */
export function PageCard({ page }: { page: PageRef }) {
  const navigate = useNavigate();
  const pages = useSharablePages();
  const known = pages.find((p) => p.viewId === page.viewId);

  return (
    <button
      type='button'
      data-testid='carehub-page-card'
      onClick={() => navigate(`/app/${page.workspaceId}/${page.viewId}`)}
      className='my-1 flex w-full max-w-[360px] items-center gap-3 rounded-[10px] border border-border-primary bg-background-primary px-3 py-2 text-left hover:bg-fill-content-hover'
    >
      <span className='flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-fill-content-hover text-base'>
        {known?.icon || '📄'}
      </span>
      <span className='min-w-0 flex-1'>
        <span className='block truncate text-sm font-medium text-text-primary'>{known?.name || page.name}</span>
        <span className='block truncate text-[11px] text-text-tertiary'>
          {known ? known.trail || 'Page' : 'Page'} · Open
        </span>
      </span>
    </button>
  );
}

/** Chips for pages attached to the message being written. */
export function AttachedPages({ pages, onRemove }: { pages: PageEntry[]; onRemove: (viewId: string) => void }) {
  if (!pages.length) return null;
  return (
    <div className='flex flex-wrap gap-1.5 px-1 pb-1.5'>
      {pages.map((page) => (
        <span
          key={page.viewId}
          className='flex max-w-[260px] items-center gap-1.5 rounded-full border border-border-primary bg-fill-content-hover/60 py-0.5 pl-2 pr-1 text-xs'
          title={page.isPrivate ? 'This page is in a private space. Only you can open it.' : page.trail}
        >
          <span>{page.icon}</span>
          <span className='truncate'>{page.name}</span>
          {page.isPrivate && (
            <span className='text-text-tertiary'>
              <LockGlyph />
            </span>
          )}
          <button
            type='button'
            aria-label={`Remove ${page.name}`}
            className='flex h-4 w-4 items-center justify-center rounded-full text-text-tertiary hover:bg-fill-content-hover hover:text-text-primary'
            onClick={() => onRemove(page.viewId)}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

function PageRow({ page, active, onPick }: { page: PageEntry; active?: boolean; onPick: () => void }) {
  return (
    <button
      type='button'
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left text-sm hover:bg-fill-content-hover',
        active && 'bg-fill-content-hover'
      )}
    >
      <span className='w-5 shrink-0 text-center'>{page.icon}</span>
      <span className='min-w-0 flex-1'>
        <span className='block truncate'>{page.name}</span>
        {page.trail && <span className='block truncate text-[11px] text-text-tertiary'>{page.trail}</span>}
      </span>
      {page.isPrivate && (
        <span className='text-text-tertiary' title='Private space: only you can open it'>
          <LockGlyph />
        </span>
      )}
    </button>
  );
}

/** The "@" list above the message box. */
export function PageMentionList({
  pages,
  active,
  onPick,
}: {
  pages: PageEntry[];
  active: number;
  onPick: (page: PageEntry) => void;
}) {
  return (
    <div className='absolute bottom-full left-0 right-0 mb-2 max-h-[280px] overflow-y-auto rounded-[12px] border border-border-primary bg-background-primary p-1 shadow-lg'>
      <div className='px-2 pb-1 pt-1.5 text-[11px] font-medium text-text-tertiary'>Share a page</div>
      {pages.length === 0 ? (
        <div className='px-2 py-2 text-xs text-text-tertiary'>No pages match.</div>
      ) : (
        pages.map((page, i) => <PageRow key={page.viewId} page={page} active={i === active} onPick={() => onPick(page)} />)
      )}
    </div>
  );
}

function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div
      className='fixed inset-0 z-[1400] flex items-center justify-center bg-black/30 p-4'
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className='flex max-h-[80vh] w-full max-w-[460px] flex-col rounded-[14px] bg-background-primary p-4 shadow-xl'>
        {children}
      </div>
    </div>
  );
}

/** "Share page" window: search and pick one or more pages. */
export function PagePickerDialog({
  exclude,
  onClose,
  onPick,
}: {
  exclude: string[];
  onClose: () => void;
  onPick: (pages: PageEntry[]) => void;
}) {
  const pages = useSharablePages();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<PageEntry[]>([]);
  const shown = useMemo(
    () => filterPages(pages.filter((p) => !exclude.includes(p.viewId)), query, 80),
    [pages, exclude, query]
  );

  return (
    <Modal onClose={onClose}>
      <div className='mb-3 text-base font-semibold'>Share a page</div>
      <input
        autoFocus
        className='mb-2 w-full rounded-[8px] border border-border-primary bg-transparent px-3 py-2 text-sm outline-none focus:border-border-theme-thick'
        placeholder='Search pages'
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      />
      <div className='min-h-[120px] flex-1 overflow-y-auto'>
        {shown.length === 0 && <div className='px-2 py-3 text-sm text-text-tertiary'>No pages match.</div>}
        {shown.map((page) => {
          const on = picked.some((p) => p.viewId === page.viewId);

          return (
            <label
              key={page.viewId}
              className='flex cursor-pointer items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-sm hover:bg-fill-content-hover'
            >
              <input
                type='checkbox'
                checked={on}
                onChange={() =>
                  setPicked((prev) => (on ? prev.filter((p) => p.viewId !== page.viewId) : [...prev, page].slice(0, 10)))
                }
              />
              <span className='w-5 shrink-0 text-center'>{page.icon}</span>
              <span className='min-w-0 flex-1'>
                <span className='block truncate'>{page.name}</span>
                {page.trail && <span className='block truncate text-[11px] text-text-tertiary'>{page.trail}</span>}
              </span>
              {page.isPrivate && (
                <span className='text-text-tertiary' title='Private space: only you can open it'>
                  <LockGlyph />
                </span>
              )}
            </label>
          );
        })}
      </div>
      <div className='mt-3 flex justify-end gap-2'>
        <Button variant='ghost' onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!picked.length} onClick={() => onPick(picked)}>
          {picked.length > 1 ? `Add ${picked.length} pages` : 'Add page'}
        </Button>
      </div>
    </Modal>
  );
}

export interface ShareCheckPage {
  workspace_id: string;
  view_id: string;
  can_grant: boolean;
  missing: string[];
}

/** Asked before sending when someone in the chat cannot open a shared page yet. */
export function GrantAccessDialog({
  checks,
  pages,
  onCancel,
  onSend,
}: {
  checks: ShareCheckPage[];
  pages: PageEntry[];
  onCancel: () => void;
  onSend: (grant: boolean) => void;
}) {
  const missing = Array.from(new Set(checks.filter((c) => c.can_grant).flatMap((c) => c.missing)));
  const blocked = checks.filter((c) => !c.can_grant && c.missing.length);
  const privatePages = pages.filter((p) => p.isPrivate);
  const names = missing.length > 2 ? `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}` : missing.join(' and ');

  return (
    <Modal onClose={onCancel}>
      <div className='mb-2 text-base font-semibold'>Give access?</div>
      <div className='flex flex-col gap-2 text-sm text-text-secondary'>
        {missing.length > 0 && (
          <p>
            <b className='text-text-primary'>{names}</b> can&apos;t open {pages.length > 1 ? 'these pages' : 'this page'} yet.
            Giving access adds them to this workspace as a member, so they can see its shared pages.
          </p>
        )}
        {blocked.length > 0 && <p>Some people can&apos;t be given access because you aren&apos;t a member of that workspace.</p>}
        {privatePages.length > 0 && (
          <p>
            🔒 {privatePages.map((p) => `“${p.name}”`).join(', ')} {privatePages.length > 1 ? 'are' : 'is'} in a private space, so
            only you can open {privatePages.length > 1 ? 'them' : 'it'}. Move it to a shared space first if others need it.
          </p>
        )}
      </div>
      <div className='mt-4 flex flex-wrap justify-end gap-2'>
        <Button variant='ghost' onClick={onCancel}>
          Cancel
        </Button>
        <Button variant='outline' onClick={() => onSend(false)}>
          Send without access
        </Button>
        {missing.length > 0 && <Button onClick={() => onSend(true)}>Give access and send</Button>}
      </div>
    </Modal>
  );
}

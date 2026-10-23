// CareHub page versions: the editor saves a copy of the page now and then
// (and before the first change of each visit). "Version history" in the
// page menu lists them, shows a preview and can bring an old copy back.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';

import type { ReactNode } from 'react';

import { CollabOrigin, View } from '@/application/types';
import { executeAPIRequest, getAxios } from '@/application/services/js-services/http/core';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { chCall, chErrorText, CH_API, formatBytes, formatWhen, recordPageActivity, UUID_RE } from './CareHubCore';
import { CareHubModal, ChNote, ChPersonChip, chInputClass } from './CareHubUi';

// ---------------------------------------------------------------------------
// Live documents that are open in an editor right now
// ---------------------------------------------------------------------------

interface LiveDoc {
  doc: Y.Doc;
  workspaceId: string;
}

const liveDocs = new Map<string, LiveDoc>();

export function getLiveDoc(viewId: string) {
  return liveDocs.get(viewId);
}

type AnyY = Y.Map<unknown> | Y.Array<unknown> | Y.Text;

function same(a: unknown, b: unknown) {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function fillArray(target: Y.Array<unknown>, src: Y.Array<unknown>) {
  src.toArray().forEach((item) => {
    if (item instanceof Y.Map) {
      target.push([new Y.Map()]);
      syncMap(target.get(target.length - 1) as Y.Map<unknown>, item);
    } else if (item instanceof Y.Array) {
      target.push([new Y.Array()]);
      fillArray(target.get(target.length - 1) as Y.Array<unknown>, item);
    } else if (item instanceof Y.Text) {
      target.push([new Y.Text()]);
      (target.get(target.length - 1) as Y.Text).applyDelta(item.toDelta());
    } else {
      target.push([item]);
    }
  });
}

/** Makes `live` equal to `snap`, changing only what differs. */
function syncMap(live: Y.Map<unknown>, snap: Y.Map<unknown>) {
  Array.from(live.keys()).forEach((key) => {
    if (!snap.has(key)) live.delete(key);
  });
  snap.forEach((value, key) => {
    const cur = live.get(key);

    if (value instanceof Y.Map) {
      if (cur instanceof Y.Map) {
        syncMap(cur, value);
      } else {
        live.set(key, new Y.Map());
        syncMap(live.get(key) as Y.Map<unknown>, value);
      }
    } else if (value instanceof Y.Array) {
      if (cur instanceof Y.Array && same(cur.toJSON(), value.toJSON())) return;
      const plain = value.toArray().every((v) => !(v instanceof Y.AbstractType));

      if (cur instanceof Y.Array && plain) {
        cur.delete(0, cur.length);
        cur.insert(0, value.toArray());
      } else {
        live.set(key, new Y.Array());
        fillArray(live.get(key) as Y.Array<unknown>, value);
      }
    } else if (value instanceof Y.Text) {
      const delta = value.toDelta();

      if (cur instanceof Y.Text) {
        if (!same(cur.toDelta(), delta)) {
          cur.delete(0, cur.length);
          cur.applyDelta(delta);
        }
      } else {
        live.set(key, new Y.Text());
        (live.get(key) as Y.Text).applyDelta(delta);
      }
    } else if (!same(cur, value)) {
      live.set(key, value);
    }
  });
}

/** A compact copy of the page (no edit history), ready to upload. */
export function snapshotDoc(doc: Y.Doc): Uint8Array {
  const fresh = new Y.Doc();

  fresh.transact(() => syncMap(fresh.getMap('data'), doc.getMap('data')));
  const update = Y.encodeStateAsUpdate(fresh);

  fresh.destroy();
  return update;
}

function hasContent(doc: Y.Doc) {
  const document = doc.getMap('data').get('document');

  return document instanceof Y.Map && document.get('blocks') instanceof Y.Map;
}

export async function uploadVersion(workspaceId: string, pageId: string, bytes: Uint8Array, opts: { auto: boolean; name?: string }) {
  if (bytes.byteLength > 32 * 1024 * 1024) throw new Error('This page is too big to save a copy (over 32 MB).');
  const params = new URLSearchParams({ auto: String(opts.auto) });

  if (opts.name) params.set('name', opts.name);
  const body = new Blob([bytes], { type: 'application/octet-stream' });

  return executeAPIRequest<{ saved: boolean; id?: string; created_at?: number }>(() =>
    getAxios()?.request({
      method: 'post',
      url: `${CH_API}/${workspaceId}/pages/${pageId}/versions?${params.toString()}`,
      data: body,
      headers: { 'Content-Type': 'application/octet-stream' },
    })
  );
}

const AUTO_SAVE_MS = 5 * 60 * 1000;

/**
 * Used by the editor. Keeps a copy of the page from before this visit's first
 * change, then one every 5 minutes while editing (and when leaving the page).
 */
export function useCareHubDocTracking(
  viewId: string | undefined,
  workspaceId: string | undefined,
  editor: unknown,
  readOnly: boolean | undefined
) {
  const doc = (editor as { sharedRoot?: Y.Map<unknown> } | null)?.sharedRoot?.doc || null;

  useEffect(() => {
    if (!doc || !viewId || !workspaceId || !UUID_RE.test(viewId) || !UUID_RE.test(workspaceId)) return;
    const entry = { doc, workspaceId };

    liveDocs.set(viewId, entry);
    if (readOnly) {
      return () => {
        if (liveDocs.get(viewId) === entry) liveDocs.delete(viewId);
      };
    }

    const mountedAt = Date.now();
    let baselineTaken = false;
    let dirty = false;
    let saving = false;
    const isLocal = (origin: unknown) =>
      origin !== CollabOrigin.Remote && origin !== 'carehub-restore' && Date.now() - mountedAt > 3000;

    const save = () => {
      if (!dirty || saving || !hasContent(doc)) return;
      dirty = false;
      saving = true;
      let bytes: Uint8Array;

      try {
        bytes = snapshotDoc(doc);
      } catch {
        saving = false;
        return;
      }

      uploadVersion(workspaceId, viewId, bytes, { auto: true })
        .catch(() => {
          dirty = true;
        })
        .finally(() => {
          saving = false;
        });
    };

    const onBefore = (tr: Y.Transaction) => {
      if (baselineTaken || !isLocal(tr.origin) || !hasContent(doc)) return;
      baselineTaken = true;
      try {
        const bytes = snapshotDoc(doc);

        void uploadVersion(workspaceId, viewId, bytes, { auto: true }).catch(() => undefined);
      } catch {
        // ignore
      }
    };

    const onUpdate = (_update: Uint8Array, origin: unknown) => {
      if (!isLocal(origin)) return;
      dirty = true;
      recordPageActivity(workspaceId, viewId, 'edit', document.title.replace(/ [|·-] Care Hub$/, ''));
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') save();
    };

    doc.on('beforeTransaction', onBefore);
    doc.on('update', onUpdate);
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(save, AUTO_SAVE_MS);

    return () => {
      doc.off('beforeTransaction', onBefore);
      doc.off('update', onUpdate);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
      save();
      if (liveDocs.get(viewId) === entry) liveDocs.delete(viewId);
    };
  }, [doc, viewId, workspaceId, readOnly]);
}

// ---------------------------------------------------------------------------
// Server calls
// ---------------------------------------------------------------------------

interface VersionPerson {
  uuid: string;
  name: string;
  email?: string;
  avatar?: string | null;
}

interface PageVersion {
  id: string;
  name?: string | null;
  auto: boolean;
  size: number;
  created_at: number;
  mine: boolean;
  by?: VersionPerson | null;
}

interface VersionList {
  keep_days: number;
  can_restore: boolean;
  versions: PageVersion[];
}

function b64ToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);

  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function loadVersionDoc(workspaceId: string, id: string) {
  const res = await chCall<{ id: string; page_id: string; state_b64: string }>('get', `${CH_API}/${workspaceId}/versions/${id}`);
  const doc = new Y.Doc();

  Y.applyUpdate(doc, b64ToBytes(res.state_b64));
  return doc;
}

// ---------------------------------------------------------------------------
// Simple read-only preview of a saved copy
// ---------------------------------------------------------------------------

type Delta = { insert: unknown; attributes?: Record<string, unknown> }[];

function DeltaText({ delta }: { delta: Delta }) {
  if (!delta.length) return <span className='text-text-tertiary'>&nbsp;</span>;
  return (
    <>
      {delta.map((op, i) => {
        if (typeof op.insert !== 'string') return <span key={i}>▫️</span>;
        const a = op.attributes || {};
        let node: ReactNode = a.mention ? <span className='rounded bg-fill-content-hover px-1'>@mention</span> : op.insert;

        if (a.href) node = <span className='text-text-action underline'>{node}</span>;
        if (a.code) node = <code className='rounded bg-fill-content-hover px-1 text-[0.9em]'>{node}</code>;
        return (
          <span
            key={i}
            className={cn(a.bold && 'font-semibold', a.italic && 'italic', a.underline && 'underline', a.strikethrough && 'line-through')}
          >
            {node}
          </span>
        );
      })}
    </>
  );
}

function SnapshotPreview({ doc }: { doc: Y.Doc }) {
  const tree = useMemo(() => {
    const document = doc.getMap('data').get('document');

    if (!(document instanceof Y.Map)) return null;
    const blocks = document.get('blocks') as Y.Map<Y.Map<unknown>> | undefined;
    const meta = document.get('meta') as Y.Map<unknown> | undefined;
    const childrenMap = meta?.get('children_map') as Y.Map<Y.Array<string>> | undefined;
    const textMap = meta?.get('text_map') as Y.Map<Y.Text> | undefined;
    const pageId = document.get('page_id') as string | undefined;

    if (!blocks || !pageId) return null;
    const childrenOf = (id: string) => {
      const b = blocks.get(id);
      const key = (b?.get('children') as string) || id;

      return (childrenMap?.get(key)?.toArray() || []) as string[];
    };

    const render = (ids: string[], depth: number): ReactNode[] => {
      let number = 0;

      return ids.map((id) => {
        const b = blocks.get(id);

        if (!b) return null;
        const ty = String(b.get('ty') || 'paragraph');
        let data: Record<string, unknown> = {};

        try {
          data = JSON.parse(String(b.get('data') || '{}'));
        } catch {
          data = {};
        }

        const textId = (b.get('external_id') as string) || id;
        const delta = ((textMap?.get(textId) as Y.Text | undefined)?.toDelta() || []) as Delta;
        const kids = childrenOf(id);
        const inner = kids.length ? <div className='pl-5'>{render(kids, depth + 1)}</div> : null;
        const text = <DeltaText delta={delta} />;

        number = ty === 'numbered_list' ? number + 1 : 0;
        let el: ReactNode;

        switch (ty) {
          case 'heading': {
            const level = Number(data.level || 1);

            el = <div className={cn('font-semibold', level === 1 ? 'mt-3 text-2xl' : level === 2 ? 'mt-2 text-xl' : 'mt-1 text-lg')}>{text}</div>;
            break;
          }

          case 'todo_list':
            el = (
              <div className='flex gap-2'>
                <span>{data.checked ? '☑' : '☐'}</span>
                <span className={cn(Boolean(data.checked) && 'text-text-tertiary line-through')}>{text}</span>
              </div>
            );
            break;
          case 'bulleted_list':
            el = (
              <div className='flex gap-2'>
                <span>•</span>
                <span>{text}</span>
              </div>
            );
            break;
          case 'numbered_list':
            el = (
              <div className='flex gap-2'>
                <span>{number}.</span>
                <span>{text}</span>
              </div>
            );
            break;
          case 'quote':
            el = <div className='border-l-2 border-text-primary pl-3'>{text}</div>;
            break;
          case 'callout':
            el = (
              <div className='flex gap-2 rounded-[8px] bg-fill-content-hover p-2'>
                <span>{String(data.icon || '💡')}</span>
                <span>{text}</span>
              </div>
            );
            break;
          case 'divider':
            el = <hr className='my-2 border-border-primary' />;
            break;
          case 'toggle_list':
            el = (
              <div className='flex gap-2'>
                <span>▸</span>
                <span>{text}</span>
              </div>
            );
            break;
          case 'code':
            el = <pre className='whitespace-pre-wrap rounded-[8px] bg-fill-content-hover p-2 text-xs'>{text}</pre>;
            break;
          case 'image':
            el = <div className='text-text-tertiary'>🖼️ Image</div>;
            break;
          case 'file':
            el = <div className='text-text-tertiary'>📎 {String(data.name || 'File')}</div>;
            break;
          case 'grid':
          case 'board':
          case 'calendar':
            el = <div className='text-text-tertiary'>📊 Database view</div>;
            break;
          default:
            el = <div>{text}</div>;
        }

        return (
          <div key={id} className='py-[2px]'>
            {el}
            {inner}
          </div>
        );
      });
    };

    return render(childrenOf(pageId), 0);
  }, [doc]);

  if (!tree) return <div className='text-sm text-text-tertiary'>This copy has no text to show.</div>;
  return <div className='text-sm leading-relaxed text-text-primary'>{tree}</div>;
}

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

export default function CareHubHistoryModal({
  open,
  onOpenChange,
  viewId,
  view,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewId: string;
  view?: View | null;
}) {
  const live = getLiveDoc(viewId);
  const workspaceId = live?.workspaceId || window.location.pathname.split('/')[2] || '';
  const [list, setList] = useState<VersionList | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<Y.Doc | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [editingName, setEditingName] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const previewRef = useRef<Y.Doc | null>(null);
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  const refresh = useCallback(async () => {
    if (!UUID_RE.test(workspaceId)) return;
    try {
      const res = await chCall<VersionList>('get', `${CH_API}/${workspaceId}/pages/${viewId}/versions`);

      setList(res);
      setSelected((cur) => cur ?? res.versions[0]?.id ?? null);
    } catch (e) {
      setError(chErrorText(e));
    }
  }, [workspaceId, viewId]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!selected) {
      setPreview(null);
      return;
    }

    let cancelled = false;

    setPreviewLoading(true);
    loadVersionDoc(workspaceId, selected)
      .then((doc) => {
        if (cancelled) return doc.destroy();
        previewRef.current?.destroy();
        previewRef.current = doc;
        setPreview(doc);
      })
      .catch((e) => !cancelled && setError(chErrorText(e)))
      .finally(() => !cancelled && setPreviewLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selected, workspaceId]);

  useEffect(() => () => previewRef.current?.destroy(), []);

  const saveNow = async () => {
    setError('');
    setNote('');
    if (!live) return setError('Open the page first, then save a version.');
    const name = window.prompt('Name this version (named versions are kept forever):', `Saved ${new Date().toLocaleString()}`);

    if (name === null) return;
    setBusy('save');
    try {
      const res = await uploadVersion(workspaceId, viewId, snapshotDoc(live.doc), { auto: false, name: name.trim() || 'Saved version' });

      setNote(res.saved ? 'Version saved.' : 'Nothing changed since the last copy.');
      await refresh();
      if (res.id) setSelected(res.id);
    } catch (e) {
      setError(chErrorText(e));
    } finally {
      setBusy('');
    }
  };

  const restore = async (version: PageVersion) => {
    setError('');
    if (!live) return setError('Open the page first, then restore.');
    if (!window.confirm(`Bring back the copy from ${formatWhen(version.created_at)}? The page as it is now will be saved as a version first, so you can undo this.`)) return;
    setBusy('restore');
    try {
      await uploadVersion(workspaceId, viewId, snapshotDoc(live.doc), {
        auto: false,
        name: `Before restore (${new Date().toLocaleString()})`,
      });
      const snap = await loadVersionDoc(workspaceId, version.id);

      live.doc.transact(() => syncMap(live.doc.getMap('data'), snap.getMap('data')), CollabOrigin.LocalManual);
      snap.destroy();
      setNote('Restored. Reloading the page…');
      window.setTimeout(() => window.location.reload(), 2000);
    } catch (e) {
      setError(chErrorText(e));
      setBusy('');
    }
  };

  const rename = async (version: PageVersion, name: string) => {
    try {
      await chCall('put', `${CH_API}/${workspaceId}/versions/${version.id}`, { name });
      setEditingName(null);
      await refresh();
    } catch (e) {
      setError(chErrorText(e));
    }
  };

  const remove = async (version: PageVersion) => {
    if (!window.confirm('Delete this saved copy?')) return;
    try {
      await chCall('delete', `${CH_API}/${workspaceId}/versions/${version.id}`);
      if (selected === version.id) setSelected(null);
      await refresh();
    } catch (e) {
      setError(chErrorText(e));
    }
  };

  if (!open) return null;
  const versions = list?.versions || [];
  const current = versions.find((v) => v.id === selected) || null;

  return (
    <CareHubModal
      wide='xl'
      testId='carehub-version-history'
      title={`Version history${view?.name ? ` · ${view.name}` : ''}`}
      onClose={close}
      footer={
        <>
          <span className='mr-auto self-center text-xs text-text-tertiary'>
            {list ? `Automatic copies are kept ${list.keep_days} days. Named versions are kept forever.` : ''}
          </span>
          <Button variant='outline' onClick={() => void saveNow()} loading={busy === 'save'} disabled={!!busy}>
            Save version now
          </Button>
          {current && list?.can_restore && (
            <Button onClick={() => void restore(current)} loading={busy === 'restore'} disabled={!!busy}>
              Restore this version
            </Button>
          )}
        </>
      }
    >
      {error && (
        <div className='mb-3'>
          <ChNote tone='error'>{error}</ChNote>
        </div>
      )}
      {note && (
        <div className='mb-3'>
          <ChNote tone='ok'>{note}</ChNote>
        </div>
      )}
      <div className='flex min-h-[50vh] flex-col gap-4 md:flex-row'>
        <div className='order-2 min-w-0 flex-1 rounded-[12px] border border-border-primary p-4 md:order-1'>
          {!current ? (
            <div className='text-sm text-text-tertiary'>
              {list && !versions.length
                ? 'No saved copies yet. Copies are saved automatically while people edit (every 5 minutes), or click “Save version now”.'
                : 'Pick a version on the right to see it.'}
            </div>
          ) : previewLoading || !preview ? (
            <div className='text-sm text-text-tertiary'>Loading…</div>
          ) : (
            <SnapshotPreview doc={preview} />
          )}
        </div>
        <div className='order-1 w-full shrink-0 md:order-2 md:w-[300px]'>
          {!list ? (
            <div className='text-sm text-text-tertiary'>Loading…</div>
          ) : (
            <div className='flex max-h-[60vh] flex-col gap-1 overflow-y-auto'>
              {versions.map((v) => (
                <div
                  key={v.id}
                  role='button'
                  tabIndex={0}
                  onClick={() => setSelected(v.id)}
                  onKeyDown={(e) => e.key === 'Enter' && setSelected(v.id)}
                  className={cn(
                    'cursor-pointer rounded-[10px] border px-3 py-2 text-sm',
                    selected === v.id ? 'border-border-theme-thick bg-fill-content-hover' : 'border-transparent hover:bg-fill-content-hover'
                  )}
                >
                  <div className='flex items-center gap-2'>
                    <span className='min-w-0 flex-1 truncate font-medium'>{formatWhen(v.created_at)}</span>
                    {!v.auto && <span className='shrink-0 rounded-full bg-fill-theme-thick px-1.5 text-[10px] text-white'>Kept</span>}
                  </div>
                  {editingName === v.id ? (
                    <div className='mt-1 flex gap-1' onClick={(e) => e.stopPropagation()}>
                      <input
                        autoFocus
                        className={`${chInputClass} min-w-0 flex-1 py-1 text-xs`}
                        value={nameDraft}
                        maxLength={120}
                        placeholder='Name (empty = automatic copy)'
                        onChange={(e) => setNameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void rename(v, nameDraft.trim());
                          if (e.key === 'Escape') setEditingName(null);
                        }}
                      />
                      <Button size='sm' onClick={() => void rename(v, nameDraft.trim())}>
                        Save
                      </Button>
                    </div>
                  ) : (
                    v.name && <div className='truncate text-xs text-text-secondary'>{v.name}</div>
                  )}
                  <div className='mt-1 flex items-center gap-1.5 text-[11px] text-text-tertiary'>
                    {v.by && <ChPersonChip name={v.by.name} avatar={v.by.avatar} size={16} />}
                    <span className='min-w-0 flex-1 truncate'>{v.by?.name || 'Someone'} · {formatBytes(v.size)}</span>
                    {selected === v.id && editingName !== v.id && (
                      <>
                        <button
                          type='button'
                          className='rounded px-1 hover:bg-fill-content-hover hover:text-text-primary'
                          onClick={(e) => {
                            e.stopPropagation();
                            setNameDraft(v.name || '');
                            setEditingName(v.id);
                          }}
                        >
                          {v.auto ? 'Keep' : 'Rename'}
                        </button>
                        {(v.mine || list.can_restore) && (
                          <button
                            type='button'
                            className='rounded px-1 hover:bg-fill-content-hover hover:text-text-primary'
                            onClick={(e) => {
                              e.stopPropagation();
                              void remove(v);
                            }}
                          >
                            Delete
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </CareHubModal>
  );
}

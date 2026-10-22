// CareHub page templates: start a new page from a ready-made layout, or save
// any page as a template for everyone in the workspace.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Y from 'yjs';

import { View } from '@/application/types';
import { isSpaceView } from '@/components/ai-chat/rag-scope';
import { useAppOutline } from '@/components/app/app.hooks';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import {
  B,
  CareHubTemplate,
  chErrorText,
  createPageWithBlocks,
  loadCareHubSettings,
  saveCareHubSetting,
  SerdeBlock,
  useCareHubCan,
} from './CareHubCore';
import { getLiveDoc } from './CareHubHistory';
import { CareHubModal, ChNote, ChSelect, chInputClass } from './CareHubUi';

function today() {
  return new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export function builtinTemplates(): CareHubTemplate[] {
  return [
    {
      id: 'builtin-meeting-agenda',
      builtin: true,
      name: 'Meeting agenda',
      icon: '🗓️',
      description: 'Goals, topics with owners, and next steps',
      blocks: [
        B.bold('Date: ', today()),
        B.bold('Attendees: '),
        B.h2('🎯 Goal'),
        B.p('What should we have decided by the end?'),
        B.h2('📋 Topics'),
        B.number('Topic 1 – who leads, how many minutes'),
        B.number('Topic 2'),
        B.number('Topic 3'),
        B.h2('✅ Next steps'),
        B.todo(''),
      ],
    },
    {
      id: 'builtin-meeting-notes',
      builtin: true,
      name: 'Meeting notes',
      icon: '📝',
      description: 'Notes, decisions and action items',
      blocks: [
        B.bold('Date: ', today()),
        B.bold('Attendees: '),
        B.h2('Agenda'),
        B.bullet(''),
        B.h2('Notes'),
        B.p(''),
        B.h2('Action items'),
        B.todo('Who – what – by when'),
        B.h2('Decisions'),
        B.bullet(''),
      ],
    },
    {
      id: 'builtin-project-brief',
      builtin: true,
      name: 'Project brief',
      icon: '🚀',
      description: 'Problem, goal, scope, timeline and risks',
      blocks: [
        B.callout('One sentence: what is this project and why does it matter?', '💡'),
        B.h2('Problem'),
        B.p(''),
        B.h2('Goal & how we measure it'),
        B.bullet('Goal: '),
        B.bullet('Success looks like: '),
        B.h2('Scope'),
        B.bold('In: '),
        B.bold('Out: '),
        B.h2('Timeline'),
        B.todo('Kick-off'),
        B.todo('First version'),
        B.todo('Launch'),
        B.h2('People'),
        B.bullet('Owner: '),
        B.bullet('Helpers: '),
        B.h2('Risks & questions'),
        B.bullet(''),
      ],
    },
    {
      id: 'builtin-weekly-checkin',
      builtin: true,
      name: 'Weekly check-in',
      icon: '📆',
      description: 'Wins, challenges and focus for next week',
      blocks: [
        B.bold('Week of: ', today()),
        B.h2('🏆 Wins'),
        B.bullet(''),
        B.h2('🧱 Challenges'),
        B.bullet(''),
        B.h2('🎯 Focus next week'),
        B.todo(''),
        B.h2('🙋 Need help with'),
        B.bullet(''),
      ],
    },
    {
      id: 'builtin-daily-log',
      builtin: true,
      name: 'Daily log',
      icon: '📓',
      description: 'Top 3, schedule and notes for one day',
      blocks: [
        B.h2(today()),
        B.h3('Top 3 today'),
        B.todo(''),
        B.todo(''),
        B.todo(''),
        B.h3('Notes'),
        B.p(''),
        B.h3('Tomorrow'),
        B.bullet(''),
      ],
    },
    {
      id: 'builtin-todo',
      builtin: true,
      name: 'To-do list',
      icon: '☑️',
      description: 'Today, this week and someday',
      blocks: [B.h2('Today'), B.todo(''), B.todo(''), B.h2('This week'), B.todo(''), B.h2('Someday'), B.todo('')],
    },
  ];
}

// ---------------------------------------------------------------------------
// Page -> template blocks
// ---------------------------------------------------------------------------

const SKIP_TYPES = new Set(['grid', 'board', 'calendar', 'chart', 'ai_meeting', 'subpage', 'link_to_page']);

/** Reads an open page into the block format the server understands. */
export function docToBlocks(doc: Y.Doc): SerdeBlock[] {
  const document = doc.getMap('data').get('document');

  if (!(document instanceof Y.Map)) return [];
  const blocks = document.get('blocks') as Y.Map<Y.Map<unknown>> | undefined;
  const meta = document.get('meta') as Y.Map<unknown> | undefined;
  const childrenMap = meta?.get('children_map') as Y.Map<Y.Array<string>> | undefined;
  const textMap = meta?.get('text_map') as Y.Map<Y.Text> | undefined;
  const pageId = document.get('page_id') as string | undefined;

  if (!blocks || !pageId) return [];
  let count = 0;
  const childrenOf = (id: string) => {
    const b = blocks.get(id);
    const key = (b?.get('children') as string) || id;

    return (childrenMap?.get(key)?.toArray() || []) as string[];
  };

  const walk = (ids: string[], depth: number): SerdeBlock[] => {
    const out: SerdeBlock[] = [];

    for (const id of ids) {
      if (count > 2000) break;
      const b = blocks.get(id);

      if (!b) continue;
      const type = String(b.get('ty') || 'paragraph');

      if (SKIP_TYPES.has(type)) continue;
      let data: Record<string, unknown> = {};

      try {
        data = JSON.parse(String(b.get('data') || '{}'));
      } catch {
        data = {};
      }

      const text = textMap?.get((b.get('external_id') as string) || id) as Y.Text | undefined;
      const delta = (text?.toDelta() || []) as { insert: unknown; attributes?: Record<string, unknown> }[];

      // Mentions point to people and dates of this page; keep their text only.
      data.delta = delta
        .filter((op) => typeof op.insert === 'string')
        .map((op) => {
          const attrs = { ...(op.attributes || {}) };

          delete attrs.mention;
          return Object.keys(attrs).length ? { insert: op.insert, attributes: attrs } : { insert: op.insert };
        });
      count++;
      out.push({ type, data, children: depth < 8 ? walk(childrenOf(id), depth + 1) : [] });
    }

    return out;
  };

  return walk(childrenOf(pageId), 0);
}

export async function loadTemplates(workspaceId: string) {
  const settings = await loadCareHubSettings(workspaceId);

  return (settings.templates || []) as CareHubTemplate[];
}

function spacesOf(outline: View[] | undefined) {
  return (outline || []).filter((v) => v && isSpaceView(v));
}

// ---------------------------------------------------------------------------
// "Templates" window
// ---------------------------------------------------------------------------

export function TemplatesDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const outline = useAppOutline();
  const navigate = useNavigate();
  const canManage = useCareHubCan(workspaceId, 'templates');
  const canCreate = useCareHubCan(workspaceId, 'create');
  const builtins = useMemo(() => builtinTemplates(), []);
  const [custom, setCustom] = useState<CareHubTemplate[] | null>(null);
  const [selected, setSelected] = useState<CareHubTemplate>(builtins[0]);
  const spaces = useMemo(() => spacesOf(outline), [outline]);
  const [spaceId, setSpaceId] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadTemplates(workspaceId)
      .then(setCustom)
      .catch(() => setCustom([]));
  }, [workspaceId]);

  useEffect(() => {
    if (!spaceId && spaces.length) {
      const shared = spaces.find((s) => !s.is_private) || spaces[0];

      setSpaceId(shared.view_id);
    }
  }, [spaces, spaceId]);

  useEffect(() => {
    setName(selected.name);
  }, [selected]);

  const create = async () => {
    setError('');
    const parent = spaceId || spaces[0]?.view_id;

    if (!parent) return setError('No space to put the page in.');
    setBusy(true);
    try {
      const viewId = await createPageWithBlocks(workspaceId, parent, name.trim() || selected.name, selected.blocks);

      onClose();
      navigate(`/app/${workspaceId}/${viewId}`);
    } catch (e) {
      setError(chErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (t: CareHubTemplate) => {
    if (!custom || !window.confirm(`Remove the template “${t.name}”?`)) return;
    const items = custom.filter((c) => c.id !== t.id);

    try {
      await saveCareHubSetting(workspaceId, 'templates', { items });
      setCustom(items);
      if (selected.id === t.id) setSelected(builtins[0]);
    } catch (e) {
      setError(chErrorText(e));
    }
  };

  const row = (t: CareHubTemplate) => (
    <div
      key={t.id}
      role='button'
      tabIndex={0}
      onClick={() => setSelected(t)}
      onKeyDown={(e) => e.key === 'Enter' && setSelected(t)}
      className={cn(
        'group flex cursor-pointer items-start gap-2.5 rounded-[10px] border px-3 py-2',
        selected.id === t.id ? 'border-border-theme-thick bg-fill-content-hover' : 'border-transparent hover:bg-fill-content-hover'
      )}
    >
      <span className='text-xl leading-6'>{t.icon || '📄'}</span>
      <span className='min-w-0 flex-1'>
        <span className='block truncate text-sm font-medium'>{t.name}</span>
        {t.description && <span className='block truncate text-xs text-text-tertiary'>{t.description}</span>}
      </span>
      {!t.builtin && canManage && (
        <button
          type='button'
          className='hidden rounded px-1 text-xs text-text-tertiary hover:text-text-primary group-hover:block'
          onClick={(e) => {
            e.stopPropagation();
            void remove(t);
          }}
        >
          Remove
        </button>
      )}
    </div>
  );

  return (
    <CareHubModal
      wide
      title='📄 New page from a template'
      onClose={onClose}
      testId='carehub-templates'
      footer={
        <>
          <Button variant='ghost' onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void create()} loading={busy} disabled={busy || !canCreate}>
            Create page
          </Button>
        </>
      }
    >
      {!canCreate && (
        <div className='mb-3'>
          <ChNote tone='warn'>Your role can’t create pages. Ask an admin if you need to.</ChNote>
        </div>
      )}
      <div className='flex flex-col gap-4 md:flex-row'>
        <div className='flex w-full flex-col gap-1 md:w-[280px] md:shrink-0'>
          <div className='px-1 text-xs font-medium text-text-tertiary'>Ready-made</div>
          {builtins.map(row)}
          <div className='mt-2 px-1 text-xs font-medium text-text-tertiary'>Saved by your team</div>
          {custom === null ? (
            <div className='px-1 text-xs text-text-tertiary'>Loading…</div>
          ) : custom.length === 0 ? (
            <div className='px-1 text-xs text-text-tertiary'>None yet. Open a page, click ••• → “Save as template”.</div>
          ) : (
            custom.map(row)
          )}
        </div>
        <div className='min-w-0 flex-1'>
          <label className='mb-1 block text-xs font-medium text-text-secondary'>Page name</label>
          <input className={`${chInputClass} mb-3 w-full`} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
          {spaces.length > 1 && (
            <>
              <label className='mb-1 block text-xs font-medium text-text-secondary'>Put it in</label>
              <ChSelect
                className='mb-3 w-full'
                value={spaceId}
                onChange={setSpaceId}
                options={spaces.map((s) => ({ value: s.view_id, label: `${s.name || 'Space'}${s.is_private ? ' (private)' : ''}` }))}
              />
            </>
          )}
          <div className='mb-1 text-xs font-medium text-text-secondary'>Preview</div>
          <div className='max-h-[46vh] overflow-y-auto rounded-[12px] border border-border-primary p-4 text-sm'>
            <BlocksPreview blocks={selected.blocks} />
          </div>
          {error && (
            <div className='mt-3'>
              <ChNote tone='error'>{error}</ChNote>
            </div>
          )}
        </div>
      </div>
    </CareHubModal>
  );
}

function textOf(b: SerdeBlock) {
  const delta = (b.data?.delta as { insert: unknown; attributes?: { bold?: boolean } }[]) || [];

  return delta.map((d, i) =>
    typeof d.insert === 'string' ? (
      <span key={i} className={d.attributes?.bold ? 'font-semibold' : undefined}>
        {d.insert}
      </span>
    ) : null
  );
}

function BlocksPreview({ blocks }: { blocks: SerdeBlock[] }) {
  let n = 0;

  return (
    <>
      {blocks.map((b, i) => {
        n = b.type === 'numbered_list' ? n + 1 : 0;
        const t = textOf(b);
        const empty = !t.some(Boolean);
        const placeholder = empty ? <span className='text-text-tertiary'>…</span> : t;
        let el;

        if (b.type === 'heading') {
          const level = Number(b.data?.level || 1);

          el = <div className={cn('font-semibold', level === 1 ? 'mt-2 text-xl' : level === 2 ? 'mt-2 text-lg' : 'mt-1')}>{t}</div>;
        } else if (b.type === 'todo_list') el = <div>☐ {placeholder}</div>;
        else if (b.type === 'bulleted_list') el = <div>• {placeholder}</div>;
        else if (b.type === 'numbered_list') el = <div>{n}. {placeholder}</div>;
        else if (b.type === 'callout')
          el = (
            <div className='rounded-[8px] bg-fill-content-hover p-2'>
              {String(b.data?.icon || '💡')} {t}
            </div>
          );
        else if (b.type === 'quote') el = <div className='border-l-2 border-text-primary pl-2'>{t}</div>;
        else if (b.type === 'divider') el = <hr className='my-2 border-border-primary' />;
        else el = <div className='min-h-[1.2em]'>{t}</div>;
        return (
          <div key={i} className='py-[1px]'>
            {el}
            {b.children && b.children.length > 0 && (
              <div className='pl-4'>
                <BlocksPreview blocks={b.children} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// "Save as template" window
// ---------------------------------------------------------------------------

const ICONS = ['📄', '📝', '🗓️', '🚀', '📆', '📓', '☑️', '📋', '💡', '🎯', '🧾', '📞', '🤝', '🩺', '❤️', '⭐'];

export function SaveTemplateDialog({
  workspaceId,
  pageId,
  title,
  onClose,
}: {
  workspaceId: string;
  pageId: string;
  title?: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(title || 'My template');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('📄');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const live = getLiveDoc(pageId);
  const blocks = useMemo(() => (live ? docToBlocks(live.doc) : []), [live]);

  const save = async () => {
    setError('');
    if (!blocks.length) return setError('This page is empty (or not open), so there is nothing to save.');
    setBusy(true);
    try {
      const current = await loadTemplates(workspaceId);
      const item: CareHubTemplate = {
        id: `t-${Date.now().toString(36)}`,
        name: name.trim() || 'Template',
        icon,
        description: description.trim(),
        blocks,
      };

      await saveCareHubSetting(workspaceId, 'templates', { items: [...current, item] });
      setDone(true);
    } catch (e) {
      setError(chErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CareHubModal
      title='Save page as template'
      onClose={onClose}
      testId='carehub-save-template'
      footer={
        done ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant='ghost' onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void save()} loading={busy} disabled={busy}>
              Save template
            </Button>
          </>
        )
      }
    >
      {done ? (
        <ChNote tone='ok'>Saved! Everyone can now pick “{name}” under Templates in the sidebar.</ChNote>
      ) : (
        <>
          <label className='mb-1 block text-xs font-medium text-text-secondary'>Name</label>
          <input className={`${chInputClass} mb-3 w-full`} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          <label className='mb-1 block text-xs font-medium text-text-secondary'>Short description (optional)</label>
          <input
            className={`${chInputClass} mb-3 w-full`}
            value={description}
            maxLength={200}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className='mb-1 text-xs font-medium text-text-secondary'>Icon</div>
          <div className='mb-3 flex flex-wrap gap-1'>
            {ICONS.map((i) => (
              <button
                key={i}
                type='button'
                onClick={() => setIcon(i)}
                className={cn('h-9 w-9 rounded-[8px] text-lg', icon === i ? 'bg-fill-content-hover ring-1 ring-border-theme-thick' : 'hover:bg-fill-content-hover')}
              >
                {i}
              </button>
            ))}
          </div>
          <div className='text-xs text-text-tertiary'>
            {blocks.length} blocks will be copied. Databases and embedded views are left out.
          </div>
          {error && (
            <div className='mt-3'>
              <ChNote tone='error'>{error}</ChNote>
            </div>
          )}
        </>
      )}
    </CareHubModal>
  );
}

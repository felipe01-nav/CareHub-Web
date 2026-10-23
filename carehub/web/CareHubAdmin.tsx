// CareHub settings panels: Roles & permissions, Automations, Data & backups.
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { ReactNode } from 'react';

import { useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import {
  CAREHUB_PERMS,
  CareHubPerm,
  CareHubRetention,
  CareHubRole,
  CareHubRule,
  CareHubSettings,
  chCall,
  chErrorText,
  CH_API,
  formatWhen,
  loadCareHubSettings,
  refreshCareHubMe,
  saveCareHubSetting,
  tzMinutesEast,
  useCareHubCan,
} from './CareHubCore';
import { PageEntry, PagePickerDialog } from './CareHubSharePage';
import { CareHubStatusView } from './CareHubStatus';
import { ChNote, ChPersonChip, ChSection, ChSelect, chInputClass } from './CareHubUi';

export const CAREHUB_ROLES_ITEM = 'carehub_roles';
export const CAREHUB_AUTOMATIONS_ITEM = 'carehub_automations';
export const CAREHUB_DATA_ITEM = 'carehub_data';

export function CareHubRolesIcon() {
  return (
    <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.7' strokeLinejoin='round' aria-hidden='true'>
      <path d='M12 3 4.5 6v5.5c0 4.4 3.1 8.2 7.5 9.5 4.4-1.3 7.5-5.1 7.5-9.5V6Z' />
      <path d='m9 12 2 2 4-4' strokeLinecap='round' />
    </svg>
  );
}

export function CareHubAutomationsIcon() {
  return (
    <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.7' strokeLinejoin='round' aria-hidden='true'>
      <path d='M13 2.5 5 13.5h6l-1 8 8-11h-6Z' />
    </svg>
  );
}

export function CareHubDataIcon() {
  return (
    <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.7' aria-hidden='true'>
      <ellipse cx='12' cy='6' rx='7.5' ry='3' />
      <path d='M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6' />
    </svg>
  );
}

/** Which of the CareHub settings pages this person may open. */
export function useCareHubSettingsAccess() {
  const workspaceId = useCurrentWorkspaceId();

  return {
    roles: useCareHubCan(workspaceId, 'admin'),
    automations: useCareHubCan(workspaceId, 'automations'),
    data: useCareHubCan(workspaceId, 'admin'),
  };
}

function Panel({ title, intro, children, testId }: { title: string; intro: ReactNode; children: ReactNode; testId: string }) {
  return (
    <div className='flex h-full min-h-0 flex-col overflow-y-auto' data-testid={testId}>
      <div className='mx-auto flex w-full max-w-[760px] flex-col px-4 py-8 sm:px-8'>
        <h2 className='mb-1 text-xl font-semibold text-text-primary'>{title}</h2>
        <p className='mb-6 text-sm text-text-caption'>{intro}</p>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Roles & permissions
// ---------------------------------------------------------------------------

interface Member {
  uuid: string;
  name: string;
  email: string;
  avatar?: string | null;
  workspace_role: 'owner' | 'member' | 'guest';
  role: { id: string; name: string };
  assigned: boolean;
  env_admin: boolean;
}

function slug(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || `role-${Date.now().toString(36)}`
  );
}

export function CareHubRolesPanel() {
  const workspaceId = useCurrentWorkspaceId() || '';
  const [members, setMembers] = useState<Member[] | null>(null);
  const [roles, setRoles] = useState<CareHubRole[]>([]);
  const [defaultRole, setDefaultRole] = useState('editor');
  const [assign, setAssign] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<CareHubRole[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const [m, s] = await Promise.all([
        chCall<{ members: Member[]; roles: CareHubRole[] }>('get', `${CH_API}/${workspaceId}/members`),
        loadCareHubSettings(workspaceId),
      ]);

      setMembers(m.members);
      setRoles(s.roles.list || m.roles || []);
      setDefaultRole(s.roles.default);
      setAssign(s.roles.assign || {});
      setCustom(s.roles.custom || []);
      setDirty(false);
    } catch (e) {
      setError(chErrorText(e));
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const allRoles = useMemo(() => [...roles.filter((r) => r.builtin), ...custom], [roles, custom]);
  const roleName = (id: string) => allRoles.find((r) => r.id === id)?.name || id;
  const change = () => {
    setDirty(true);
    setNote('');
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const cleanCustom = custom
        .filter((r) => r.name.trim())
        .map((r) => ({ id: r.id, name: r.name.trim(), perms: r.perms, description: r.description || '' }));

      await saveCareHubSetting(workspaceId, 'roles', { default: defaultRole, assign, custom: cleanCustom });
      refreshCareHubMe(workspaceId);
      setNote('Saved. People see their new permissions within a few minutes (or right away after reloading).');
      await load();
    } catch (e) {
      setError(chErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const togglePerm = (role: CareHubRole, perm: CareHubPerm) => {
    setCustom((list) =>
      list.map((r) => (r.id === role.id ? { ...r, perms: r.perms.includes(perm) ? r.perms.filter((p) => p !== perm) : [...r.perms, perm] } : r))
    );
    change();
  };

  return (
    <Panel
      title='Roles & permissions'
      testId='carehub-roles-panel'
      intro='Choose what each person can do. Owners and admins can always do everything.'
    >
      {error && (
        <div className='mb-4'>
          <ChNote tone='error'>{error}</ChNote>
        </div>
      )}
      {note && (
        <div className='mb-4'>
          <ChNote tone='ok'>{note}</ChNote>
        </div>
      )}
      {!members ? (
        !error && <div className='text-sm text-text-tertiary'>Loading…</div>
      ) : (
        <>
          <ChSection title='People'>
            <div className='flex flex-col'>
              {members.map((m) => {
                const key = m.email.toLowerCase();
                const fixed = m.workspace_role === 'owner' || m.env_admin;

                return (
                  <div key={m.uuid} className='flex flex-wrap items-center gap-3 border-t border-border-primary py-2'>
                    <ChPersonChip name={m.name || m.email} avatar={m.avatar} size={32} />
                    <div className='min-w-0 flex-1'>
                      <div className='truncate text-sm font-medium'>{m.name || m.email}</div>
                      <div className='truncate text-xs text-text-tertiary'>
                        {m.email}
                        {m.workspace_role === 'guest' ? ' · guest' : ''}
                      </div>
                    </div>
                    {fixed ? (
                      <span className='text-xs text-text-tertiary'>
                        Admin ({m.workspace_role === 'owner' ? 'workspace owner' : 'server setting'})
                      </span>
                    ) : (
                      <ChSelect
                        ariaLabel={`Role for ${m.email}`}
                        value={assign[key] || ''}
                        onChange={(v) => {
                          setAssign((a) => {
                            const next = { ...a };

                            if (v) next[key] = v;
                            else delete next[key];
                            return next;
                          });
                          change();
                        }}
                        options={[
                          { value: '', label: `Default (${roleName(defaultRole)})` },
                          ...allRoles.map((r) => ({ value: r.id, label: r.name })),
                        ]}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </ChSection>

          <ChSection title='Default role' hint='For everyone without a role above, including people added later.'>
            <ChSelect
              value={defaultRole}
              onChange={(v) => {
                setDefaultRole(v);
                change();
              }}
              options={allRoles.filter((r) => r.id !== 'admin').map((r) => ({ value: r.id, label: r.name }))}
            />
          </ChSection>

          <ChSection
            title='Roles'
            hint='Built-in roles can’t be changed. Add your own role to pick exactly what it allows.'
            right={
              <Button
                size='sm'
                variant='outline'
                onClick={() => {
                  const name = `Custom role ${custom.length + 1}`;

                  setCustom((c) => [...c, { id: slug(`${name}-${Date.now().toString(36)}`), name, perms: ['comment'], description: '' }]);
                  change();
                }}
              >
                + Add role
              </Button>
            }
          >
            <div className='flex flex-col gap-3'>
              {allRoles.map((r) => (
                <div key={r.id} className='rounded-[12px] border border-border-primary p-3'>
                  <div className='mb-2 flex items-center gap-2'>
                    {r.builtin ? (
                      <div className='flex-1 text-sm font-semibold'>{r.name}</div>
                    ) : (
                      <input
                        className={`${chInputClass} flex-1 font-semibold`}
                        value={r.name}
                        maxLength={60}
                        onChange={(e) => {
                          const name = e.target.value;

                          setCustom((list) => list.map((x) => (x.id === r.id ? { ...x, name } : x)));
                          change();
                        }}
                      />
                    )}
                    {r.builtin ? (
                      <span className='text-[11px] text-text-tertiary'>built-in</span>
                    ) : (
                      <button
                        type='button'
                        className='rounded px-1.5 text-xs text-text-tertiary hover:bg-fill-content-hover hover:text-text-primary'
                        onClick={() => {
                          if (!window.confirm(`Remove the role “${r.name}”? People with it get the default role.`)) return;
                          setCustom((list) => list.filter((x) => x.id !== r.id));
                          setAssign((a) => Object.fromEntries(Object.entries(a).filter(([, v]) => v !== r.id)));
                          change();
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  {r.description && r.builtin && <div className='mb-2 text-xs text-text-tertiary'>{r.description}</div>}
                  <div className='grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2'>
                    {CAREHUB_PERMS.map((p) => {
                      const on = r.perms.includes('admin') || r.perms.includes(p.id);

                      return (
                        <label
                          key={p.id}
                          title={p.hint}
                          className={cn('flex items-center gap-2 text-xs', r.builtin ? 'text-text-secondary' : 'cursor-pointer text-text-primary')}
                        >
                          <input type='checkbox' checked={on} disabled={r.builtin} onChange={() => togglePerm(r, p.id)} />
                          <span>{p.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </ChSection>

          <ChNote>
            Roles change what Care Hub shows and allows (editing, new pages, sharing, Claude, templates, analytics,
            automations). Private pages stay private no matter the role.
          </ChNote>
          <div className='sticky bottom-0 mt-4 flex justify-end gap-2 bg-background-primary py-3'>
            <Button variant='ghost' disabled={!dirty || busy} onClick={() => void load()}>
              Undo changes
            </Button>
            <Button disabled={!dirty || busy} loading={busy} onClick={() => void save()}>
              Save
            </Button>
          </div>
        </>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Automations
// ---------------------------------------------------------------------------

interface RuleStatus {
  rule_id: string;
  last_run?: number | null;
  runs: number;
  last_error?: string | null;
}

interface MsgPerson {
  uuid: string;
  name: string;
  email: string;
  avatar?: string;
}

interface MsgChat {
  id: string;
  name: string;
  is_group: boolean;
  members: MsgPerson[];
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function newRule(): CareHubRule {
  return {
    id: `rule-${Date.now().toString(36)}`,
    name: 'New automation',
    enabled: true,
    tz: tzMinutesEast(),
    trigger: { type: 'schedule', every: 'weekday', time: '09:00', weekday: 1, day: 1 },
    action: { type: 'message', to: 'people', people: [], text: 'Good morning! 👋 Here is today’s reminder: {date}' },
  };
}

function describe(rule: CareHubRule) {
  const t = rule.trigger;
  let when = '';

  if (t.type === 'schedule') {
    const time = t.time;

    if (t.every === 'day') when = `Every day at ${time}`;
    else if (t.every === 'weekday') when = `Every weekday (Mon–Fri) at ${time}`;
    else if (t.every === 'week') when = `Every ${WEEKDAY_NAMES[t.weekday ?? 1]} at ${time}`;
    else when = `Every month on day ${t.day ?? 1} at ${time}`;
  } else if (t.type === 'form_submitted') when = `When ${t.page_title ? `“${t.page_title}”` : 'any form'} gets an answer`;
  else when = 'When someone creates a page';
  const to = rule.action.to === 'chat' ? 'a chat' : `${rule.action.people?.length || 0} people`;

  return `${when} → message to ${to}`;
}

function RuleEditor({
  rule,
  people,
  chats,
  onChange,
}: {
  rule: CareHubRule;
  people: MsgPerson[];
  chats: MsgChat[];
  onChange: (rule: CareHubRule) => void;
}) {
  const [picker, setPicker] = useState<'form' | 'link' | null>(null);
  const t = rule.trigger;
  const a = rule.action;
  const setTrigger = (trigger: CareHubRule['trigger']) => onChange({ ...rule, trigger });
  const setAction = (patch: Partial<CareHubRule['action']>) => onChange({ ...rule, action: { ...a, ...patch } });

  const vars =
    t.type === 'schedule' ? ['{date}'] : t.type === 'form_submitted' ? ['{date}', '{title}', '{page}'] : ['{date}', '{title}', '{page}', '{person}'];

  return (
    <div className='flex flex-col gap-3'>
      <div>
        <label className='mb-1 block text-xs font-medium text-text-secondary'>Name</label>
        <input className={`${chInputClass} w-full`} value={rule.name} maxLength={80} onChange={(e) => onChange({ ...rule, name: e.target.value })} />
      </div>
      <div>
        <label className='mb-1 block text-xs font-medium text-text-secondary'>When</label>
        <div className='flex flex-wrap items-center gap-2'>
          <ChSelect
            value={t.type}
            onChange={(type) => {
              if (type === 'schedule') setTrigger({ type, every: 'weekday', time: '09:00', weekday: 1, day: 1 });
              else if (type === 'form_submitted') setTrigger({ type, page_id: null });
              else setTrigger({ type: 'page_created', include_own: false });
            }}
            options={[
              { value: 'schedule', label: 'On a schedule' },
              { value: 'form_submitted', label: 'A form gets an answer' },
              { value: 'page_created', label: 'Someone creates a page' },
            ]}
          />
          {t.type === 'schedule' && (
            <>
              <ChSelect
                value={t.every}
                onChange={(every) => setTrigger({ ...t, every })}
                options={[
                  { value: 'day', label: 'every day' },
                  { value: 'weekday', label: 'every weekday' },
                  { value: 'week', label: 'every week' },
                  { value: 'month', label: 'every month' },
                ]}
              />
              {t.every === 'week' && (
                <ChSelect
                  value={t.weekday ?? 1}
                  onChange={(weekday) => setTrigger({ ...t, weekday })}
                  options={WEEKDAY_NAMES.map((n, i) => ({ value: i, label: `on ${n}` }))}
                />
              )}
              {t.every === 'month' && (
                <ChSelect
                  value={t.day ?? 1}
                  onChange={(day) => setTrigger({ ...t, day })}
                  options={Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: `on day ${i + 1}` }))}
                />
              )}
              <span className='text-xs text-text-tertiary'>at</span>
              <input
                type='time'
                className={chInputClass}
                value={t.time}
                onChange={(e) => setTrigger({ ...t, time: e.target.value || '09:00' })}
              />
            </>
          )}
          {t.type === 'form_submitted' && (
            <>
              <span className='text-sm'>{t.page_title ? `“${t.page_title}”` : 'Any form'}</span>
              <Button size='sm' variant='outline' onClick={() => setPicker('form')}>
                Pick form
              </Button>
              {t.page_id && (
                <Button size='sm' variant='ghost' onClick={() => setTrigger({ type: 'form_submitted', page_id: null })}>
                  Any form
                </Button>
              )}
            </>
          )}
          {t.type === 'page_created' && (
            <label className='flex items-center gap-2 text-xs'>
              <input type='checkbox' checked={!!t.include_own} onChange={(e) => setTrigger({ ...t, include_own: e.target.checked })} />
              Also when I create one
            </label>
          )}
        </div>
        {t.type === 'schedule' && t.every === 'month' && (t.day ?? 1) > 28 && (
          <div className='mt-1 text-[11px] text-text-tertiary'>In shorter months it runs on the last day.</div>
        )}
      </div>
      <div>
        <label className='mb-1 block text-xs font-medium text-text-secondary'>Send a message to</label>
        <div className='mb-2 flex gap-2'>
          <ChSelect
            value={a.to}
            onChange={(to) => setAction({ to })}
            options={[
              { value: 'people', label: 'These people' },
              { value: 'chat', label: 'An existing chat' },
            ]}
          />
          {a.to === 'chat' && (
            <ChSelect
              className='min-w-0 flex-1'
              value={a.chat_id || ''}
              onChange={(chat_id) => setAction({ chat_id: chat_id || null })}
              options={[
                { value: '', label: 'Pick a chat…' },
                ...chats.map((c) => ({
                  value: c.id,
                  label: c.name?.trim() || c.members.map((m) => m.name || m.email).join(', ') || 'Chat',
                })),
              ]}
            />
          )}
        </div>
        {a.to === 'people' && (
          <div className='max-h-[160px] overflow-y-auto rounded-[10px] border border-border-primary p-1'>
            {people.length === 0 && <div className='p-2 text-xs text-text-tertiary'>Loading people…</div>}
            {people.map((p) => {
              const on = (a.people || []).includes(p.uuid);

              return (
                <label key={p.uuid} className='flex cursor-pointer items-center gap-2 rounded-[8px] px-2 py-1 text-sm hover:bg-fill-content-hover'>
                  <input
                    type='checkbox'
                    checked={on}
                    onChange={() =>
                      setAction({ people: on ? (a.people || []).filter((x) => x !== p.uuid) : [...(a.people || []), p.uuid] })
                    }
                  />
                  <ChPersonChip name={p.name || p.email} avatar={p.avatar} size={20} />
                  <span className='truncate'>{p.name || p.email}</span>
                </label>
              );
            })}
          </div>
        )}
        {a.to === 'people' && (
          <div className='mt-1 text-[11px] text-text-tertiary'>
            They get the message in a group chat called “⚡ {rule.name}” (you’re in it too).
          </div>
        )}
      </div>
      <div>
        <label className='mb-1 block text-xs font-medium text-text-secondary'>Message</label>
        <textarea
          className={`${chInputClass} min-h-[80px] w-full`}
          value={a.text}
          maxLength={4000}
          onChange={(e) => setAction({ text: e.target.value })}
        />
        <div className='mt-1 flex flex-wrap gap-1 text-[11px] text-text-tertiary'>
          Fill-ins:
          {vars.map((v) => (
            <button
              key={v}
              type='button'
              className='rounded bg-fill-content-hover px-1 hover:text-text-primary'
              onClick={() => setAction({ text: `${a.text}${a.text.endsWith(' ') || !a.text ? '' : ' '}${v}` })}
            >
              {v}
            </button>
          ))}
          <span>
            ({'{date}'} = today, {'{title}'} = page name, {'{page}'} = link, {'{person}'} = who did it)
          </span>
        </div>
      </div>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-xs font-medium text-text-secondary'>Attach a page link:</span>
        <span className='text-sm'>{a.page_title || 'none'}</span>
        <Button size='sm' variant='outline' onClick={() => setPicker('link')}>
          Pick page
        </Button>
        {a.page_id && (
          <Button size='sm' variant='ghost' onClick={() => setAction({ page_id: null, page_title: '' })}>
            Remove
          </Button>
        )}
      </div>
      {picker && (
        <PagePickerDialog
          exclude={[]}
          onClose={() => setPicker(null)}
          onPick={(pages: PageEntry[]) => {
            const p = pages[0];

            if (p && picker === 'form') setTrigger({ type: 'form_submitted', page_id: p.viewId, page_title: p.name });
            if (p && picker === 'link') setAction({ page_id: p.viewId, page_title: p.name });
            setPicker(null);
          }}
        />
      )}
    </div>
  );
}

export function CareHubAutomationsPanel() {
  const workspaceId = useCurrentWorkspaceId() || '';
  const [rules, setRules] = useState<CareHubRule[] | null>(null);
  const [status, setStatus] = useState<RuleStatus[]>([]);
  const [people, setPeople] = useState<MsgPerson[]>([]);
  const [chats, setChats] = useState<MsgChat[]>([]);
  const [editing, setEditing] = useState<CareHubRule | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const [s, st] = await Promise.all([
        loadCareHubSettings(workspaceId),
        chCall<RuleStatus[]>('get', `${CH_API}/${workspaceId}/automations/status`).catch(() => [] as RuleStatus[]),
      ]);

      setRules(s.automations || []);
      setStatus(st || []);
    } catch (e) {
      setError(chErrorText(e));
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
    chCall<{ people: MsgPerson[] }>('get', '/api/carehub/messages/people')
      .then((r) => setPeople(r.people || []))
      .catch(() => undefined);
    chCall<{ chats: MsgChat[] }>('get', '/api/carehub/messages/chats')
      .then((r) => setChats(r.chats || []))
      .catch(() => undefined);
  }, [load]);

  const persist = async (next: CareHubRule[]) => {
    setBusy('save');
    setError('');
    try {
      const saved = await saveCareHubSetting<{ rules: CareHubRule[] } | CareHubRule[]>(workspaceId, 'automations', { rules: next });

      setRules(Array.isArray(saved) ? saved : saved?.rules || next);
      return true;
    } catch (e) {
      setError(chErrorText(e));
      return false;
    } finally {
      setBusy('');
    }
  };

  const saveEditing = async () => {
    if (!editing || !rules) return;
    const rule = { ...editing, name: editing.name.trim() || 'Automation', tz: tzMinutesEast() };

    if (rule.action.to === 'people' && !(rule.action.people || []).length) return setError('Pick at least one person.');
    if (rule.action.to === 'chat' && !rule.action.chat_id) return setError('Pick a chat.');
    if (!rule.action.text.trim()) return setError('Write a message.');
    const exists = rules.some((r) => r.id === rule.id);
    const ok = await persist(exists ? rules.map((r) => (r.id === rule.id ? rule : r)) : [...rules, rule]);

    if (ok) {
      setEditing(null);
      setNote('Saved.');
    }
  };

  const runNow = async (rule: CareHubRule) => {
    setBusy(`run:${rule.id}`);
    setError('');
    setNote('');
    try {
      await chCall('post', `${CH_API}/${workspaceId}/automations/${rule.id}/run`);
      setNote(`“${rule.name}” ran. Check Messages.`);
      void load();
    } catch (e) {
      setError(chErrorText(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <Panel
      title='Automations'
      testId='carehub-automations-panel'
      intro='Send messages automatically: on a schedule, when a form gets an answer, or when someone creates a page.'
    >
      {error && (
        <div className='mb-4'>
          <ChNote tone='error'>{error}</ChNote>
        </div>
      )}
      {note && (
        <div className='mb-4'>
          <ChNote tone='ok'>{note}</ChNote>
        </div>
      )}
      {editing ? (
        <div className='rounded-[14px] border border-border-primary p-4'>
          <RuleEditor rule={editing} people={people} chats={chats} onChange={setEditing} />
          <div className='mt-4 flex justify-end gap-2'>
            <Button variant='ghost' onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={() => void saveEditing()} loading={busy === 'save'} disabled={!!busy}>
              Save automation
            </Button>
          </div>
        </div>
      ) : !rules ? (
        !error && <div className='text-sm text-text-tertiary'>Loading…</div>
      ) : (
        <>
          <div className='mb-4 flex justify-end'>
            <Button onClick={() => setEditing(newRule())}>+ New automation</Button>
          </div>
          {rules.length === 0 ? (
            <ChNote>No automations yet. Example: “Every weekday at 9:00, message the team: Daily check-in time!”.</ChNote>
          ) : (
            <div className='flex flex-col gap-2'>
              {rules.map((rule) => {
                const st = status.find((s) => s.rule_id === rule.id);

                return (
                  <div key={rule.id} className='rounded-[12px] border border-border-primary p-3'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <label className='flex items-center' title={rule.enabled ? 'On' : 'Off'}>
                        <input
                          type='checkbox'
                          checked={rule.enabled}
                          onChange={(e) => void persist(rules.map((r) => (r.id === rule.id ? { ...r, enabled: e.target.checked } : r)))}
                        />
                      </label>
                      <div className='min-w-0 flex-1'>
                        <div className={cn('truncate text-sm font-medium', !rule.enabled && 'text-text-tertiary')}>⚡ {rule.name}</div>
                        <div className='truncate text-xs text-text-tertiary'>{describe(rule)}</div>
                      </div>
                      <Button size='sm' variant='ghost' onClick={() => void runNow(rule)} loading={busy === `run:${rule.id}`} disabled={!!busy}>
                        Test
                      </Button>
                      <Button size='sm' variant='outline' onClick={() => setEditing(rule)}>
                        Edit
                      </Button>
                      <Button
                        size='sm'
                        variant='ghost'
                        onClick={() => {
                          if (window.confirm(`Delete “${rule.name}”?`)) void persist(rules.filter((r) => r.id !== rule.id));
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                    {st && (
                      <div className='mt-1 text-[11px] text-text-tertiary'>
                        Ran {st.runs} time{st.runs === 1 ? '' : 's'}
                        {st.last_run ? ` · last ${formatWhen(st.last_run)}` : ''}
                        {st.last_error ? <span className='text-[#dc2626]'> · problem: {st.last_error}</span> : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className='mt-4'>
            <ChNote>Automations run on the Care Hub server, so they work even when nobody has Care Hub open (as long as the server computer is on).</ChNote>
          </div>
        </>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Data & backups
// ---------------------------------------------------------------------------

export function CareHubDataPanel() {
  const workspaceId = useCurrentWorkspaceId() || '';
  const [retention, setRetention] = useState<CareHubRetention | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!workspaceId) return;
    loadCareHubSettings(workspaceId)
      .then((s: CareHubSettings) => setRetention(s.retention))
      .catch((e) => setError(chErrorText(e)));
  }, [workspaceId]);

  const update = async (patch: Partial<CareHubRetention>) => {
    if (!retention) return;
    const next = { ...retention, ...patch };

    setRetention(next);
    setBusy(true);
    setError('');
    setNote('');
    try {
      await saveCareHubSetting(workspaceId, 'retention', next);
      setNote('Saved.');
    } catch (e) {
      setError(chErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title='Data & backups'
      testId='carehub-data-panel'
      intro='How long Care Hub keeps old copies and activity, plus the health of the server and its nightly backups.'
    >
      {error && (
        <div className='mb-4'>
          <ChNote tone='error'>{error}</ChNote>
        </div>
      )}
      {note && (
        <div className='mb-4'>
          <ChNote tone='ok'>{note}</ChNote>
        </div>
      )}
      <ChSection title='Keep data for'>
        {!retention ? (
          <div className='text-sm text-text-tertiary'>Loading…</div>
        ) : (
          <div className='flex flex-col gap-3'>
            <div className='flex flex-wrap items-center gap-3'>
              <div className='min-w-[200px] flex-1'>
                <div className='text-sm'>Automatic page versions</div>
                <div className='text-xs text-text-tertiary'>Named versions are always kept.</div>
              </div>
              <ChSelect
                disabled={busy}
                value={retention.versions_days}
                onChange={(versions_days) => void update({ versions_days })}
                options={[7, 14, 30, 60, 90, 180, 365].map((d) => ({ value: d, label: `${d} days` }))}
              />
            </div>
            <div className='flex flex-wrap items-center gap-3'>
              <div className='min-w-[200px] flex-1'>
                <div className='text-sm'>Analytics (page visits)</div>
                <div className='text-xs text-text-tertiary'>Older visits are removed.</div>
              </div>
              <ChSelect
                disabled={busy}
                value={retention.analytics_days}
                onChange={(analytics_days) => void update({ analytics_days })}
                options={[30, 90, 180, 365, 730].map((d) => ({ value: d, label: d >= 365 ? `${d / 365} year${d > 365 ? 's' : ''}` : `${d} days` }))}
              />
            </div>
            <div className='flex flex-wrap items-center gap-3'>
              <div className='min-w-[200px] flex-1'>
                <div className='text-sm'>Empty the trash automatically</div>
                <div className='text-xs text-text-tertiary'>Pages in the trash longer than this are deleted for good. Checked once a day when an admin is using Care Hub.</div>
              </div>
              <ChSelect
                disabled={busy}
                value={retention.trash_days}
                onChange={(trash_days) => void update({ trash_days })}
                options={[
                  { value: 0, label: 'Never' },
                  ...[7, 14, 30, 60, 90].map((d) => ({ value: d, label: `After ${d} days` })),
                ]}
              />
            </div>
          </div>
        )}
      </ChSection>

      <ChSection
        title='Server status'
        right={
          <a href='/app/status' target='_blank' rel='noreferrer' className='text-xs text-text-action hover:underline'>
            Open status page ↗
          </a>
        }
      >
        <CareHubStatusView compact />
      </ChSection>

      <ChSection title='About backups'>
        <div className='flex flex-col gap-2 text-sm text-text-secondary'>
          <p>
            Once a day the backup service saves the whole database and uploaded files into the <code>backups</code> folder next to
            docker-compose.yml (on the server computer). Old backups are removed after the number of days set by
            <code> BACKUP_KEEP_DAYS</code> in the <code>.env</code> file (14 if not set).
          </p>
          <p>
            For extra safety, copy that folder to a USB drive or cloud folder now and then. If the server computer stops
            for more than a day and a half, admins get a message in “🔔 Care Hub”.
          </p>
        </div>
      </ChSection>
    </Panel>
  );
}

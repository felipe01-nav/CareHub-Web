// CareHub: Settings > "User accounts" (only for the CareHub administrator).
// Add sign-in accounts with a password, set a new password, or remove an
// account. Nothing here sends email.
import { useCallback, useEffect, useState } from 'react';

import { executeAPIRequest, getAxios } from '@/application/services/js-services/http/core';
import { useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export const CAREHUB_ACCOUNTS_ITEM = 'carehub_accounts';

export interface CareHubAccount {
  id: string;
  email: string;
  created_at?: string | null;
  last_sign_in_at?: string | null;
  has_signed_in?: boolean;
  in_workspace?: boolean;
  joins_workspace?: boolean;
  /** Name and picture from the person's own profile settings. */
  name?: string;
  avatar?: string;
}

function AccountAvatar({ account }: { account: CareHubAccount }) {
  const [broken, setBroken] = useState(false);
  const avatar = (account.avatar || '').trim();
  const label = (account.name || account.email || '?').trim();
  const isImage = /^(https?:|data:image|\/)/i.test(avatar);
  const base = 'flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-fill-content-hover text-sm font-medium text-text-primary';

  if (avatar && isImage && !broken) {
    return (
      <div className={base}>
        <img src={avatar} alt='' className='h-full w-full object-cover' onError={() => setBroken(true)} />
      </div>
    );
  }

  if (avatar && !isImage && avatar.length <= 16) {
    return <div className={`${base} text-lg`}>{avatar}</div>;
  }

  return <div className={base}>{label.charAt(0).toUpperCase()}</div>;
}

const BASE = '/api/carehub/admin';

function call<T>(method: 'get' | 'post' | 'put' | 'delete', url: string, data?: unknown) {
  return executeAPIRequest<T>(() => getAxios()?.request({ method, url, data }));
}

function errorText(err: unknown) {
  const msg = (err as { message?: string })?.message;

  return msg && msg.trim() ? msg : 'Something went wrong. Please try again.';
}

let adminCache: boolean | null = null;

/** True when the signed-in person may manage accounts. */
export function useCarehubIsAdmin() {
  const [isAdmin, setIsAdmin] = useState<boolean>(adminCache ?? false);

  useEffect(() => {
    let alive = true;

    call<{ is_admin: boolean }>('get', `${BASE}/me`)
      .then((res) => {
        adminCache = Boolean(res?.is_admin);
        if (alive) setIsAdmin(adminCache);
      })
      .catch(() => {
        if (alive) setIsAdmin(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return isAdmin;
}

function formatDate(value?: string | null) {
  if (!value) return 'Never';
  const date = new Date(value);

  if (Number.isNaN(date.getTime()) || date.getFullYear() < 2000) return 'Never';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function LockIcon() {
  return (
    <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.75'
      strokeLinecap='round' strokeLinejoin='round' className='h-5 w-5' aria-hidden='true'>
      <rect x='3' y='11' width='18' height='10' rx='2' />
      <path d='M7 11V7a5 5 0 0 1 10 0v4' />
    </svg>
  );
}

export const CareHubAccountsIcon = LockIcon;

type RowMode = 'idle' | 'password' | 'remove';

function AccountRow({ account, workspaceId, isMe, onChanged, onError }: {
  account: CareHubAccount;
  workspaceId?: string;
  isMe: boolean;
  onChanged: (notice: string) => void;
  onError: (msg: string) => void;
}) {
  const [mode, setMode] = useState<RowMode>('idle');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const savePassword = async () => {
    const problem = carehubPasswordProblem(password);

    if (problem) {
      onError(problem);
      return;
    }

    setBusy(true);
    try {
      await call('put', `${BASE}/users/${account.id}/password`, { password });
      setMode('idle');
      setPassword('');
      onChanged(`New password saved for ${account.email}.`);
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const setMembership = async (join: boolean) => {
    if (!workspaceId) return;
    setBusy(true);
    try {
      if (join) {
        const res = await call<{ joined: boolean }>('post', `${BASE}/users/${account.id}/workspace`, {
          workspace_id: workspaceId,
        });

        onChanged(
          res?.joined
            ? `${account.email} is now in this workspace.`
            : `${account.email} will join this workspace when they first sign in.`
        );
      } else {
        await call('delete', `${BASE}/users/${account.id}/workspace?workspace_id=${workspaceId}`);
        onChanged(`${account.email} was taken out of this workspace. Their account still works.`);
      }
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await call('delete', `${BASE}/users/${account.id}`);
      setMode('idle');
      onChanged(`${account.email} can no longer sign in.`);
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const name = (account.name || '').trim();
  const displayName = name && name.toLowerCase() !== (account.email || '').toLowerCase() ? name : '';

  return (
    <div className='border-b border-border-primary px-4 py-3 last:border-b-0' data-testid='carehub-account-row'>
      <div className='flex items-center gap-4'>
        <AccountAvatar account={account} />
        <div className='min-w-0 flex-1'>
          <div className='flex min-w-0 flex-wrap items-center gap-2'>
            <span className='truncate text-sm font-medium text-text-primary'>{displayName || account.email}</span>
            {displayName && <span className='truncate text-xs text-text-caption'>{account.email}</span>}
            {isMe ? (
              <span className='shrink-0 rounded-full bg-fill-content-hover px-2 py-0.5 text-xs text-text-caption'>You</span>
            ) : account.in_workspace ? (
              <span className='shrink-0 rounded-full bg-fill-content-hover px-2 py-0.5 text-xs text-text-caption'>In this workspace</span>
            ) : account.joins_workspace ? (
              <span className='shrink-0 rounded-full bg-fill-content-hover px-2 py-0.5 text-xs text-text-caption'>Joins at first sign-in</span>
            ) : null}
          </div>
          <div className='text-xs text-text-tertiary'>
            Added {formatDate(account.created_at)} · Last sign-in {formatDate(account.last_sign_in_at)}
          </div>
        </div>
      </div>
      {mode === 'idle' && !isMe && (
          <div className='mt-2 flex flex-wrap gap-2 pl-12'>
            {workspaceId && !account.in_workspace && !account.joins_workspace && (
              <Button variant='outline' size='sm' loading={busy} onClick={() => void setMembership(true)}>
                Add to workspace
              </Button>
            )}
            {workspaceId && (account.in_workspace || account.joins_workspace) && (
              <Button variant='ghost' size='sm' loading={busy} onClick={() => void setMembership(false)}>
                Take out
              </Button>
            )}
            <Button variant='outline' size='sm' onClick={() => setMode('password')}>
              Set password
            </Button>
            <Button variant='ghost' size='sm' danger onClick={() => setMode('remove')}>
              Remove
            </Button>
          </div>
        )}
      {mode === 'password' && (
        <form
          className='mt-3 flex items-center gap-2 pl-12'
          onSubmit={(e) => {
            e.preventDefault();
            void savePassword();
          }}
        >
          <Input
            autoFocus
            type='password'
            placeholder='New password'
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className='w-72'
          />
          <Button type='submit' size='sm' loading={busy}>Save</Button>
          <Button type='button' variant='ghost' size='sm' onClick={() => { setMode('idle'); setPassword(''); }}>
            Cancel
          </Button>
        </form>
      )}
      {mode === 'remove' && (
        <div className='mt-3 flex items-center gap-2 pl-12'>
          <span className='flex-1 text-sm text-text-caption'>
            Remove this account? They won't be able to sign in. Their pages stay.
          </span>
          <Button variant='destructive' size='sm' loading={busy} onClick={() => void remove()}>
            Remove
          </Button>
          <Button variant='ghost' size='sm' onClick={() => setMode('idle')}>Cancel</Button>
        </div>
      )}
    </div>
  );
}

export const CAREHUB_PASSWORD_RULES =
  'At least 8 characters, with an uppercase letter, a lowercase letter and a symbol.';

export function carehubPasswordProblem(password: string): string {
  if (password.length < 8) return 'The password needs at least 8 characters.';
  if (!/[A-Z]/.test(password)) return 'The password needs an uppercase letter.';
  if (!/[a-z]/.test(password)) return 'The password needs a lowercase letter.';
  if (!/[^A-Za-z0-9\s]/.test(password)) return 'The password needs a symbol (for example ! ? # or -).';
  return '';
}

export function CareHubAccountsPanel({ myEmail }: { myEmail?: string }) {
  const workspaceId = useCurrentWorkspaceId();
  const [accounts, setAccounts] = useState<CareHubAccount[] | null>(null);
  const [addToWorkspace, setAddToWorkspace] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const query = workspaceId ? `?workspace_id=${workspaceId}` : '';
      const res = await call<{ users: CareHubAccount[] }>('get', `${BASE}/users${query}`);

      setAccounts(res?.users ?? []);
    } catch (e) {
      setError(errorText(e));
      setAccounts([]);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const showNotice = (msg: string) => {
    setError('');
    setNotice(msg);
    void load();
  };

  const showError = (msg: string) => {
    setNotice('');
    setError(msg);
  };

  const add = async () => {
    const trimmed = email.trim();

    if (!trimmed.includes('@')) {
      showError('Please enter a valid email address.');
      return;
    }

    const problem = carehubPasswordProblem(password);

    if (problem) {
      showError(problem);
      return;
    }

    setAdding(true);
    try {
      const joining = addToWorkspace && Boolean(workspaceId);

      await call('post', `${BASE}/users`, {
        email: trimmed,
        password,
        ...(joining ? { workspace_id: workspaceId } : {}),
      });
      setEmail('');
      setPassword('');
      showNotice(
        joining
          ? `${trimmed} can now sign in with the password you chose, and will join this workspace at first sign-in.`
          : `${trimmed} can now sign in with the password you chose.`
      );
    } catch (e) {
      showError(errorText(e));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className='flex h-full min-h-0 flex-col overflow-y-auto' data-testid='carehub-accounts-panel'>
      <div className='mx-auto flex w-full max-w-[720px] flex-col gap-6 px-8 py-8'>
        <div className='flex flex-col gap-1'>
          <h2 className='text-xl font-semibold text-text-primary'>User accounts</h2>
          <p className='text-sm text-text-caption'>
            Add people who can sign in to Care Hub, put them in this workspace, set a new password, or remove
            access. No emails are sent — share the password with the person yourself.
          </p>
        </div>

        <form
          className='flex flex-col gap-3 rounded-[8px] border border-border-primary p-4'
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <div className='text-sm font-medium text-text-primary'>Add an account</div>
          <div className='text-xs text-text-tertiary'>Password: {CAREHUB_PASSWORD_RULES}</div>
          <div className='flex flex-wrap items-center gap-2'>
            <Input
              type='email'
              placeholder='Email'
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className='min-w-[220px] flex-1'
              data-testid='carehub-account-email'
            />
            <Input
              type='password'
              placeholder='Password'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className='min-w-[220px] flex-1'
              data-testid='carehub-account-password'
            />
            <Button type='submit' loading={adding} data-testid='carehub-account-add'>
              Add account
            </Button>
          </div>
          {workspaceId && (
            <label className='flex cursor-pointer items-center gap-2 text-sm text-text-caption'>
              <input
                type='checkbox'
                checked={addToWorkspace}
                onChange={(e) => setAddToWorkspace(e.target.checked)}
                className='h-4 w-4'
                style={{ accentColor: 'currentColor' }}
                data-testid='carehub-account-join'
              />
              Also add them to this workspace
            </label>
          )}
        </form>

        {error && (
          <div role='alert' className='rounded-[8px] border border-border-error-thick px-3 py-2 text-sm text-text-error'>
            {error}
          </div>
        )}
        {notice && (
          <div role='status' className='rounded-[8px] bg-fill-content-hover px-3 py-2 text-sm text-text-primary'>
            {notice}
          </div>
        )}

        <div className='flex flex-col gap-2'>
          <div className='text-sm font-medium text-text-primary'>
            Accounts{accounts ? ` (${accounts.length})` : ''}
          </div>
          <div className='rounded-[8px] border border-border-primary'>
            {accounts === null && <div className='px-4 py-6 text-sm text-text-tertiary'>Loading…</div>}
            {accounts?.length === 0 && <div className='px-4 py-6 text-sm text-text-tertiary'>No accounts found.</div>}
            {accounts?.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                workspaceId={workspaceId}
                isMe={Boolean(myEmail) && account.email?.toLowerCase() === myEmail?.toLowerCase()}
                onChanged={showNotice}
                onError={showError}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default CareHubAccountsPanel;

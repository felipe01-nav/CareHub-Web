// CareHub: Settings > "User accounts" (only for the CareHub administrator).
// Add sign-in accounts with a password, set a new password, or remove an
// account. Nothing here sends email.
import { useCallback, useEffect, useState } from 'react';

import { executeAPIRequest, getAxios } from '@/application/services/js-services/http/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export const CAREHUB_ACCOUNTS_ITEM = 'carehub_accounts';

export interface CareHubAccount {
  id: string;
  email: string;
  created_at?: string | null;
  last_sign_in_at?: string | null;
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

function AccountRow({ account, onChanged, onError }: {
  account: CareHubAccount;
  onChanged: (notice: string) => void;
  onError: (msg: string) => void;
}) {
  const [mode, setMode] = useState<RowMode>('idle');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const savePassword = async () => {
    if (password.length < 6) {
      onError('The password needs at least 6 characters.');
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

  return (
    <div className='border-b border-border-primary px-4 py-3 last:border-b-0' data-testid='carehub-account-row'>
      <div className='flex items-center gap-4'>
        <div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-fill-content-hover text-sm font-medium text-text-primary'>
          {(account.email || '?').charAt(0).toUpperCase()}
        </div>
        <div className='min-w-0 flex-1'>
          <div className='truncate text-sm font-medium text-text-primary'>{account.email}</div>
          <div className='text-xs text-text-tertiary'>
            Added {formatDate(account.created_at)} · Last sign-in {formatDate(account.last_sign_in_at)}
          </div>
        </div>
        {mode === 'idle' && (
          <div className='flex shrink-0 gap-2'>
            <Button variant='outline' size='sm' onClick={() => setMode('password')}>
              Set password
            </Button>
            <Button variant='ghost' size='sm' danger onClick={() => setMode('remove')}>
              Remove
            </Button>
          </div>
        )}
      </div>
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
            placeholder='New password (at least 6 characters)'
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

export function CareHubAccountsPanel() {
  const [accounts, setAccounts] = useState<CareHubAccount[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await call<{ users: CareHubAccount[] }>('get', `${BASE}/users`);

      setAccounts(res?.users ?? []);
    } catch (e) {
      setError(errorText(e));
      setAccounts([]);
    }
  }, []);

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

    if (password.length < 6) {
      showError('The password needs at least 6 characters.');
      return;
    }

    setAdding(true);
    try {
      await call('post', `${BASE}/users`, { email: trimmed, password });
      setEmail('');
      setPassword('');
      showNotice(`${trimmed} can now sign in with the password you chose.`);
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
            Add people who can sign in to Care Hub, set a new password, or remove access. No emails are sent —
            share the password with the person yourself.
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
              placeholder='Password (at least 6 characters)'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className='min-w-[220px] flex-1'
              data-testid='carehub-account-password'
            />
            <Button type='submit' loading={adding} data-testid='carehub-account-add'>
              Add account
            </Button>
          </div>
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
              <AccountRow key={account.id} account={account} onChanged={showNotice} onError={showError} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default CareHubAccountsPanel;

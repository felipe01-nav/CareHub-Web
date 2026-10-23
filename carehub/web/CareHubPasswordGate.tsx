// CareHub: "Choose your own password" at first sign-in.
// New accounts (and accounts whose password the administrator set) must pick
// their own password before they can use Care Hub. Nothing here sends email.
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { getTokenParsed } from '@/application/session/token';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { CAREHUB_PASSWORD_RULES, carehubPasswordProblem } from './CareHubAccounts';
import { chCall, chErrorText } from './CareHubCore';

const API = '/api/carehub/account';

function signedInUserId(): string {
  try {
    const token = getTokenParsed() as { user?: { id?: string }; access_token?: string } | null;

    return token?.access_token ? token.user?.id || 'me' : '';
  } catch {
    return '';
  }
}

function logOut() {
  try {
    localStorage.removeItem('token');
  } catch {
    // ignore
  }

  window.location.href = '/login';
}

export default function CareHubPasswordGate() {
  const location = useLocation();
  const [checkedFor, setCheckedFor] = useState('');
  const [mustChange, setMustChange] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const userId = signedInUserId();

    if (!userId || userId === checkedFor) return;
    let cancelled = false;

    chCall<{ must_change?: boolean }>('get', `${API}/password-status`)
      .then((res) => {
        if (cancelled) return;
        setCheckedFor(userId);
        setMustChange(!!res?.must_change);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [location.pathname, checkedFor]);

  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => setDone(false), 4000);

    return () => window.clearTimeout(timer);
  }, [done]);

  const save = async () => {
    const problem = carehubPasswordProblem(password);

    if (problem) {
      setError(problem);
      return;
    }

    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }

    setBusy(true);
    setError('');
    try {
      await chCall('post', `${API}/password`, { password });
      setMustChange(false);
      setPassword('');
      setConfirm('');
      setDone(true);
    } catch (err) {
      setError(chErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className='fixed bottom-6 left-1/2 z-[3000] -translate-x-1/2 rounded-[10px] bg-[#dcfce7] px-4 py-2 text-sm text-[#166534] shadow'>
        Your new password is saved. Use it next time you sign in.
      </div>
    );
  }

  if (!mustChange) return null;

  return (
    <div
      className='fixed inset-0 z-[3000] flex items-center justify-center bg-black/50 p-4'
      data-testid='carehub-password-gate'
    >
      <form
        className='w-full max-w-[420px] rounded-[14px] bg-background-primary p-6 shadow-xl'
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className='text-lg font-semibold text-text-primary'>Choose your own password</div>
        <div className='mt-1 text-sm text-text-secondary'>
          Welcome to Care Hub! Your account was set up with a temporary password. Please choose a new password that
          only you know before you continue.
        </div>
        <div className='mt-4 flex flex-col gap-2'>
          <Input
            autoFocus
            type='password'
            autoComplete='new-password'
            placeholder='New password'
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid='carehub-gate-password'
          />
          <Input
            type='password'
            autoComplete='new-password'
            placeholder='Type it again'
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            data-testid='carehub-gate-confirm'
          />
          <div className='text-xs text-text-tertiary'>{CAREHUB_PASSWORD_RULES}</div>
          {error && <div className='rounded-[8px] bg-[#fee2e2] px-3 py-2 text-xs text-[#991b1b]'>{error}</div>}
        </div>
        <div className='mt-5 flex items-center justify-between gap-2'>
          <Button type='button' variant='ghost' size='sm' onClick={logOut}>
            Log out
          </Button>
          <Button type='submit' loading={busy}>
            Save new password
          </Button>
        </div>
      </form>
    </div>
  );
}

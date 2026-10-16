// CareHub: per-page "Full width" setting (like Notion's page menu toggle).
// Stored on this device (localStorage) so it applies instantly.
import { useEffect, useState } from 'react';

const KEY_PREFIX = 'carehub_full_width:';
const CHANGE_EVENT = 'carehub-full-width-change';

export function getCarehubFullWidth(viewId?: string): boolean {
  if (!viewId) return false;
  try {
    return window.localStorage.getItem(KEY_PREFIX + viewId) === '1';
  } catch {
    return false;
  }
}

export function setCarehubFullWidth(viewId: string, value: boolean) {
  try {
    if (value) window.localStorage.setItem(KEY_PREFIX + viewId, '1');
    else window.localStorage.removeItem(KEY_PREFIX + viewId);
  } catch {
    // ignore (private mode etc.)
  }

  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { viewId, value } }));
}

export function useCarehubFullWidth(viewId?: string): boolean {
  const [value, setValue] = useState(() => getCarehubFullWidth(viewId));

  useEffect(() => {
    setValue(getCarehubFullWidth(viewId));
    if (!viewId) return;
    const update = () => setValue(getCarehubFullWidth(viewId));

    window.addEventListener(CHANGE_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(CHANGE_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, [viewId]);

  return value;
}

export function CareHubFullWidthIcon() {
  return (
    <svg width='16' height='16' viewBox='0 0 16 16' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' strokeLinejoin='round' aria-hidden>
      <path d='M1.5 8h13' />
      <path d='M4 5.5 1.5 8 4 10.5' />
      <path d='M12 5.5 14.5 8 12 10.5' />
    </svg>
  );
}

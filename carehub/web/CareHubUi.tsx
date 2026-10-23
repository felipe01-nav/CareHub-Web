// CareHub: small shared pieces for the new windows and settings panels.
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function CareHubModal({
  children,
  onClose,
  title,
  wide,
  footer,
  testId,
}: {
  children: ReactNode;
  onClose: () => void;
  title?: ReactNode;
  wide?: boolean | 'xl';
  footer?: ReactNode;
  testId?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className='carehub-modal-backdrop fixed inset-0 z-[1400] flex items-center justify-center bg-black/30 p-4'
      data-testid={testId}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          'carehub-modal flex max-h-[88vh] w-full flex-col overflow-hidden rounded-[14px] bg-background-primary shadow-xl',
          wide === 'xl' ? 'max-w-[1100px]' : wide ? 'max-w-[720px]' : 'max-w-[480px]'
        )}
        role='dialog'
        aria-modal='true'
      >
        {title !== undefined && (
          <div className='flex items-center gap-2 border-b border-border-primary px-4 py-3'>
            <div className='min-w-0 flex-1 truncate text-base font-semibold'>{title}</div>
            <button
              type='button'
              aria-label='Close'
              className='flex h-8 w-8 items-center justify-center rounded-[8px] text-lg text-text-secondary hover:bg-fill-content-hover'
              onClick={onClose}
            >
              ×
            </button>
          </div>
        )}
        <div className='min-h-0 flex-1 overflow-y-auto p-4'>{children}</div>
        {footer && <div className='flex flex-wrap justify-end gap-2 border-t border-border-primary px-4 py-3'>{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

export function ChSection({ title, hint, children, right }: { title: ReactNode; hint?: ReactNode; children?: ReactNode; right?: ReactNode }) {
  return (
    <section className='mb-6'>
      <div className='mb-2 flex items-end gap-2'>
        <div className='min-w-0 flex-1'>
          <div className='text-sm font-semibold text-text-primary'>{title}</div>
          {hint && <div className='mt-0.5 text-xs text-text-tertiary'>{hint}</div>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export const chInputClass =
  'carehub-input rounded-[8px] border border-border-primary bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-border-theme-thick disabled:opacity-60';

export function ChSelect<T extends string | number>({
  value,
  options,
  onChange,
  className,
  disabled,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      disabled={disabled}
      className={cn(chInputClass, 'pr-7', className)}
      value={String(value)}
      onChange={(e) => {
        const found = options.find((o) => String(o.value) === e.target.value);

        if (found) onChange(found.value);
      }}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function ChCard({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className='min-w-[120px] flex-1 rounded-[12px] border border-border-primary p-3'>
      <div className='text-xs text-text-tertiary'>{label}</div>
      <div className='mt-1 text-xl font-semibold text-text-primary'>{value}</div>
      {hint && <div className='mt-0.5 text-[11px] text-text-tertiary'>{hint}</div>}
    </div>
  );
}

export function ChNote({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' | 'error' | 'ok' }) {
  return (
    <div
      className={cn(
        'rounded-[10px] px-3 py-2 text-xs',
        tone === 'info' && 'bg-fill-content-hover text-text-secondary',
        tone === 'warn' && 'bg-[#fef3c7] text-[#92400e]',
        tone === 'error' && 'bg-[#fee2e2] text-[#991b1b]',
        tone === 'ok' && 'bg-[#dcfce7] text-[#166534]'
      )}
    >
      {children}
    </div>
  );
}

/** A simple bar chart (no chart library needed). */
export function ChBars({
  data,
  height = 120,
  color = 'var(--fill-theme-thick, #6366f1)',
  second,
}: {
  data: { label: string; value: number; value2?: number; title?: string }[];
  height?: number;
  color?: string;
  second?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value + (d.value2 || 0)));

  return (
    <div className='flex w-full items-end gap-[2px]' style={{ height }}>
      {data.map((d, i) => (
        <div
          key={i}
          className='group relative flex h-full min-w-0 flex-1 flex-col justify-end'
          title={d.title || `${d.label}: ${d.value}${d.value2 !== undefined ? ` / ${d.value2}` : ''}`}
        >
          {second && d.value2 ? (
            <div style={{ height: `${(d.value2 / max) * 100}%`, background: second }} className='w-full rounded-t-[2px]' />
          ) : null}
          <div
            style={{ height: `${(d.value / max) * 100}%`, background: color, minHeight: d.value ? 2 : 0 }}
            className={cn('w-full', second && d.value2 ? '' : 'rounded-t-[2px]')}
          />
        </div>
      ))}
    </div>
  );
}

export function ChPersonChip({ name, avatar, size = 24 }: { name: string; avatar?: string | null; size?: number }) {
  const initials = (name || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return avatar && /^https?:|^data:|^\//.test(avatar) ? (
    <img src={avatar} alt='' className='shrink-0 rounded-full object-cover' style={{ width: size, height: size }} />
  ) : (
    <span
      className='flex shrink-0 items-center justify-center rounded-full bg-fill-theme-thick text-[10px] font-semibold text-white'
      style={{ width: size, height: size, fontSize: size < 28 ? 10 : 12 }}
    >
      {avatar && !/^https?:/.test(avatar) && avatar.length <= 4 ? avatar : initials}
    </span>
  );
}

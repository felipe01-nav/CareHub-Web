// CareHub: small shared pieces for the new windows and settings panels.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';

import { cn } from '@/lib/utils';

// Open dialogs, newest last. Only the top one keeps Tab inside (e.g. a confirm opened over another dialog).
const openModals: HTMLElement[] = [];
const TABBABLE =
  'a[href], area[href], button, input:not([type="hidden"]), select, textarea, iframe, audio[controls], video[controls], summary, [tabindex], [contenteditable]';

/** A radio group is one Tab stop. */
function stopGroup(el: HTMLElement): HTMLElement | string {
  return el instanceof HTMLInputElement && el.type === 'radio' && el.name ? `radio:${el.name}` : el;
}

/** What Tab can reach in a dialog, in page order: one per radio group (its checked radio, else the first). */
function tabStops(box: HTMLElement) {
  const all = Array.from(box.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (el) =>
      (el.tabIndex >= 0 || (el.isContentEditable && !el.hasAttribute('tabindex'))) &&
      !el.matches(':disabled') &&
      el.getClientRects().length > 0 &&
      getComputedStyle(el).visibility !== 'hidden'
  );

  return all.filter((el) => {
    const group = stopGroup(el);

    if (typeof group !== 'string') return true;
    const radios = all.filter((o) => stopGroup(o) === group) as HTMLInputElement[];

    return el === (radios.find((r) => r.checked) || radios[0]);
  });
}

// Safari doesn't focus a button when it's clicked, so a dialog opened from one finds focus on the page body and
// can't give it back on close. The last button pressed (noted on pointerdown, before its click opens anything) stands
// in for it then — only when nothing else has focus.
let lastPressed: { el: Element; at: number } | null = null;

if (typeof document !== 'undefined') {
  document.addEventListener(
    'pointerdown',
    (e) => {
      const el = e.target instanceof Element ? e.target.closest('button, [role="button"], a[href], summary') : null;

      lastPressed = el ? { el, at: Date.now() } : null;
    },
    { capture: true, passive: true }
  );
}

function openerNow(): Element | null {
  const now = document.activeElement;
  const pressed = lastPressed;

  if (now && now !== document.body) return now;
  return pressed && pressed.el.isConnected && Date.now() - pressed.at < 10_000 ? pressed.el : now;
}

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
  const boxRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Where focus was when the dialog opened (read while rendering, before anything inside takes focus).
  const [opener] = useState(openerNow);
  const back = useRef(opener);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useLayoutEffect(() => {
    const box = boxRef.current;

    if (!box) return undefined;
    // Opened in place of another dialog (that one has closed and given focus back), or focus was nowhere when it
    // opened (e.g. the button pressed went busy): remember where focus is now instead.
    const was = back.current;

    if ((!was?.isConnected || was === document.body) && !box.contains(document.activeElement)) back.current = document.activeElement;
    openModals.push(box);
    return () => {
      const i = openModals.indexOf(box);

      if (i >= 0) openModals.splice(i, 1);
      // Give focus back to where the dialog was opened from — only if it would otherwise be lost (on the page body
      // or still in this dialog, which is about to go) and that place is still on the page. Runs before the dialog
      // leaves the page, so focus the app moves on purpose afterwards (e.g. to a new block) still wins.
      const now = document.activeElement;
      const to = back.current;

      if ((!now || now === document.body || box.contains(now)) && to instanceof HTMLElement && to !== document.body && to.isConnected) {
        to.focus({ preventScroll: true });
      }
    };
  }, []);

  // Move focus into the dialog, unless something inside already took it (autoFocus, or an effect: this one runs
  // after the children's). The dialog box itself gets it, so screen readers read the title first.
  useEffect(() => {
    const box = boxRef.current;

    if (box && !box.contains(document.activeElement)) box.focus({ preventScroll: true });
  }, []);

  // Tab and Shift+Tab wrap round inside the top dialog. Keys from menus that a dialog opens in a portal (outside
  // this box) arrive here through React too: those are left alone, and focus is never pulled back from outside.
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const box = boxRef.current;
    const at = e.target as HTMLElement;

    if (e.key !== 'Tab' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || !box || !box.contains(at)) return;
    if (openModals[openModals.length - 1] !== box) return;
    const stops = tabStops(box);
    const others = stops.filter((el) => stopGroup(el) !== stopGroup(at));
    const ahead = e.shiftKey
      ? others.some((el) => el.compareDocumentPosition(at) & Node.DOCUMENT_POSITION_FOLLOWING)
      : others.some((el) => at.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);

    if (ahead) return;
    e.preventDefault();
    (e.shiftKey ? stops[stops.length - 1] : stops[0])?.focus();
  };

  return createPortal(
    <div
      className='carehub-modal-backdrop fixed inset-0 z-[1400] flex items-center justify-center bg-black/30 p-4'
      data-testid={testId}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={boxRef}
        className={cn(
          'carehub-modal flex max-h-[88vh] w-full flex-col overflow-hidden rounded-[14px] bg-background-primary shadow-xl outline-none',
          wide === 'xl' ? 'max-w-[1100px]' : wide ? 'max-w-[720px]' : 'max-w-[480px]'
        )}
        role='dialog'
        aria-modal='true'
        aria-labelledby={title !== undefined ? titleId : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {title !== undefined && (
          <div className='flex items-center gap-2 border-b border-border-primary px-4 py-3'>
            <div id={titleId} className='min-w-0 flex-1 truncate text-base font-semibold'>
              {title}
            </div>
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
          <h2 className='m-0 text-sm font-semibold text-text-primary'>{title}</h2>
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
      role={tone === 'error' ? 'alert' : undefined}
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

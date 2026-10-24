// CareHub Learning: small keyboard and screen reader helpers (WCAG 2.1 AA) shared by the Learning screens.
import { useEffect } from 'react';

import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]';

/**
 * Moves focus to an element without scrolling (the caller scrolls if it wants to). Elements that can't take
 * focus get tabindex="-1" until focus leaves them, like the player's jump links do.
 */
export function focusQuietly(el: HTMLElement) {
  if (!el.matches(FOCUSABLE)) {
    el.setAttribute('tabindex', '-1');
    el.addEventListener('blur', () => el.removeAttribute('tabindex'), { once: true });
  }

  el.focus({ preventScroll: true });
}

/**
 * For a button that replaces itself (Check answer → the feedback, a reply → Continue): once React has drawn
 * the new content, move focus there, so keyboard and screen reader users don't drop back to the top of the page.
 */
export function focusSoon(find: () => Element | null | undefined) {
  let tries = 0;
  const step = () => {
    const el = find();

    if (el instanceof HTMLElement) focusQuietly(el);
    else if (++tries < 10) window.requestAnimationFrame(step);
  };

  window.requestAnimationFrame(step);
}

/** The first control people can use in a box (e.g. the first answer of a question), or null. */
export function firstControl(root: Element | null | undefined): HTMLElement | null {
  if (!root) return null;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))) {
    if (el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length > 0) return el;
  }

  return null;
}

/** "Studio · Learning · Care Hub" */
export function learningTitle(...parts: string[]) {
  return [...parts.map((p) => p.trim()).filter(Boolean), 'Learning', 'Care Hub'].join(' · ');
}

/** Sets the browser tab title for the screen that's open (WCAG 2.4.2). null leaves the title alone. */
export function usePageTitle(title: string | null) {
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
}

/**
 * Arrow keys in a row of tabs (WAI-ARIA tabs pattern): ←/→ go to the previous/next tab (wrapping round),
 * Home/End to the first/last. Returns the tab to show, or null for other keys.
 */
export function tabKey(e: ReactKeyboardEvent, index: number, count: number): number | null {
  if (count < 1 || e.altKey || e.ctrlKey || e.metaKey) return null;
  const to = e.key === 'ArrowRight' ? index + 1 : e.key === 'ArrowLeft' ? index - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? count - 1 : null;

  if (to === null) return null;
  e.preventDefault();
  return (to + count) % count;
}

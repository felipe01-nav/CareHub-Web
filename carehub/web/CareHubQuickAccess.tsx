// CareHub: "Favorites" and "Recent" sections at the top of the sidebar.
// They use the same saved favorites and recent pages as the phone layout.
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { UIVariant, View, ViewLayout } from '@/application/types';
import OutlineItem from '@/components/_shared/outline/OutlineItem';
import {
  useAIEnabled,
  useAppFavorites,
  useAppRecent,
  useSidebarSelectedViewId,
  useToView,
} from '@/components/app/app.hooks';
import { useFavoriteNavigation } from '@/components/app/favorite/useFavoriteNavigation';

const RECENT_SHORT = 5;
const RECENT_LONG = 15;

function useExpanded(key: string): [boolean, () => void] {
  const [open, setOpen] = useState(() => localStorage.getItem(key) !== 'false');

  return [
    open,
    () =>
      setOpen((prev) => {
        localStorage.setItem(key, String(!prev));
        return !prev;
      }),
  ];
}

function time(value?: string | null) {
  if (!value) return 0;
  const t = Date.parse(value);

  return Number.isNaN(t) ? 0 : t;
}

function StarIcon() {
  return (
    <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.6'
      strokeLinecap='round' strokeLinejoin='round' className='h-5 w-5 shrink-0 p-[2px]'>
      <path d='M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z' />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.6'
      strokeLinecap='round' strokeLinejoin='round' className='h-5 w-5 shrink-0 p-[2px]'>
      <circle cx='12' cy='12' r='8.5' />
      <path d='M12 7.5V12l3 2' />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'
      strokeLinecap='round' strokeLinejoin='round'
      className={'h-3.5 w-3.5 text-text-secondary opacity-0 transition-all group-hover:opacity-100'}
      style={{ transform: open ? 'rotate(90deg)' : undefined }}>
      <path d='M9 6l6 6-6 6' />
    </svg>
  );
}

function SectionHeader({
  icon,
  label,
  open,
  onToggle,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  open: boolean;
  onToggle: () => void;
  testId: string;
}) {
  return (
    <div
      role='button'
      tabIndex={0}
      data-testid={testId}
      aria-expanded={open}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      className={
        'group my-0.5 flex w-full cursor-pointer items-center gap-2 rounded-[8px] p-1 text-sm text-text-secondary hover:bg-fill-content-hover focus:outline-none'
      }
    >
      {icon}
      <div className={'flex-1 truncate'}>{label}</div>
      <Chevron open={open} />
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <div className={'px-2 pb-1 pt-0.5 text-xs leading-5 text-text-secondary opacity-80'}>{children}</div>;
}

function withoutChildren(view: View): View {
  return { ...view, children: [] };
}

export function CareHubFavorites() {
  const { favoriteViews, loadFavoriteViews } = useAppFavorites();
  const navigateToView = useFavoriteNavigation(favoriteViews);
  const selectedViewId = useSidebarSelectedViewId();
  const aiEnabled = useAIEnabled();
  const [open, toggle] = useExpanded('carehub_favorites_expanded');

  useEffect(() => {
    void loadFavoriteViews?.();
  }, [loadFavoriteViews]);

  const views = useMemo(() => {
    const list = (favoriteViews || []).filter((v) => aiEnabled || v.layout !== ViewLayout.AIChat);

    return [...list].sort((a, b) => time(b.favorited_at) - time(a.favorited_at));
  }, [aiEnabled, favoriteViews]);

  return (
    <div className={'mb-2 flex w-full flex-col'} data-testid='carehub-favorites'>
      <SectionHeader icon={<StarIcon />} label='Favorites' open={open} onToggle={toggle} testId='carehub-favorites-header' />
      {open &&
        (views.length === 0 ? (
          <EmptyHint>Open a page and click the star at the top to add it here.</EmptyHint>
        ) : (
          <div className={'flex flex-col px-1'}>
            {views.map((view) => (
              <OutlineItem
                key={view.view_id}
                variant={UIVariant.Favorite}
                view={withoutChildren(view)}
                selectedViewId={selectedViewId}
                navigateToView={navigateToView}
              />
            ))}
          </div>
        ))}
    </div>
  );
}

export function CareHubRecent() {
  const { recentViews, loadRecentViews } = useAppRecent();
  const toView = useToView();
  const selectedViewId = useSidebarSelectedViewId();
  const aiEnabled = useAIEnabled();
  const [open, toggle] = useExpanded('carehub_recent_expanded');
  const [showMore, setShowMore] = useState(false);
  const timer = useRef<number>();

  // Refresh the list shortly after the person opens another page.
  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void loadRecentViews?.();
    }, selectedViewId ? 1500 : 0);
    return () => window.clearTimeout(timer.current);
  }, [loadRecentViews, selectedViewId]);

  const navigateToView = useMemo(() => (viewId: string) => toView(viewId), [toView]);

  const views = useMemo(() => {
    const seen = new Set<string>();
    const list = (recentViews || []).filter((v) => {
      if (!aiEnabled && v.layout === ViewLayout.AIChat) return false;
      if (seen.has(v.view_id)) return false;
      seen.add(v.view_id);
      return true;
    });

    return [...list].sort((a, b) => time(b.last_viewed_at) - time(a.last_viewed_at));
  }, [aiEnabled, recentViews]);

  const visible = views.slice(0, showMore ? RECENT_LONG : RECENT_SHORT);

  return (
    <div className={'mb-2 flex w-full flex-col'} data-testid='carehub-recent'>
      <SectionHeader icon={<ClockIcon />} label='Recent' open={open} onToggle={toggle} testId='carehub-recent-header' />
      {open &&
        (views.length === 0 ? (
          <EmptyHint>Pages you open will show up here.</EmptyHint>
        ) : (
          <div className={'flex flex-col px-1'}>
            {visible.map((view) => (
              <OutlineItem
                key={view.view_id}
                variant={UIVariant.Recent}
                view={withoutChildren(view)}
                selectedViewId={selectedViewId}
                navigateToView={navigateToView}
              />
            ))}
            {views.length > RECENT_SHORT && (
              <div
                role='button'
                tabIndex={0}
                onClick={() => setShowMore((v) => !v)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setShowMore((v) => !v);
                }}
                className={
                  'my-0.5 flex min-h-[28px] cursor-pointer items-center rounded-[8px] px-2 text-xs text-text-secondary hover:bg-fill-content-hover'
                }
              >
                {showMore ? 'Show less' : 'Show more'}
              </div>
            )}
          </div>
        ))}
    </div>
  );
}

export function CareHubQuickAccess() {
  return (
    <>
      <CareHubFavorites />
      <CareHubRecent />
    </>
  );
}

export default CareHubQuickAccess;

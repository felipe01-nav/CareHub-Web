// CareHub sidebar: Templates and Analytics buttons, a "Spaces" heading with
// a "+" to add a space, and hiding "New page" for view-only roles.
import { lazy, Suspense, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import type { ReactNode } from 'react';

import { useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { cn } from '@/lib/utils';

import { CAREHUB_ANALYTICS_PATH } from './CareHubAnalytics';
import { useCareHubCan, useCareHubMe } from './CareHubCore';
import { TemplatesDialog } from './CareHubTemplates';

const CreateSpaceModal = lazy(() => import('@/components/app/view-actions/CreateSpaceModal'));
const CAREHUB_LEARNING_PATH = '/app/learning';

function TemplateIcon() {
  return (
    <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinejoin='round' aria-hidden='true'>
      <rect x='4' y='3.5' width='16' height='17' rx='2.5' />
      <path d='M8 8h8M8 12h8M8 16h5' strokeLinecap='round' />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' aria-hidden='true'>
      <path d='M4 20h16' />
      <path d='M7 16v-5M12 16V6M17 16v-8' strokeWidth='2.4' />
    </svg>
  );
}

function Row({ icon, label, onClick, active, testId }: { icon: ReactNode; label: string; onClick: () => void; active?: boolean; testId?: string }) {
  return (
    <button
      type='button'
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'flex h-8 flex-1 items-center gap-2 rounded-[8px] px-2 text-sm',
        active ? 'bg-fill-content-hover font-medium text-text-primary' : 'text-text-secondary hover:bg-fill-content-hover hover:text-text-primary'
      )}
    >
      {icon}
      <span className='truncate'>{label}</span>
    </button>
  );
}

export function CareHubSidebarExtras({ onNavigate }: { onNavigate?: () => void }) {
  const workspaceId = useCurrentWorkspaceId();
  const navigate = useNavigate();
  const location = useLocation();
  const canCreate = useCareHubCan(workspaceId, 'create');
  const canAnalytics = useCareHubCan(workspaceId, 'analytics');
  const me = useCareHubMe(workspaceId);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  if (!workspaceId) return null;
  return (
    <>
      <div className='flex w-full items-center gap-1 pb-1' data-testid='carehub-sidebar-extras'>
        {canCreate && <Row icon={<TemplateIcon />} label='Templates' onClick={() => setTemplatesOpen(true)} testId='carehub-templates-button' />}
        {canAnalytics && (
          <Row
            icon={<ChartIcon />}
            label='Analytics'
            active={location.pathname.startsWith(CAREHUB_ANALYTICS_PATH)}
            onClick={() => {
              navigate(CAREHUB_ANALYTICS_PATH);
              onNavigate?.();
            }}
            testId='carehub-analytics-button'
          />
        )}
      </div>
      {me && !me.is_guest && (
        <div className='flex w-full items-center pb-1'>
          <Row
            icon={
              <span aria-hidden='true' className='flex w-4 justify-center text-[14px] leading-none'>
                🎓
              </span>
            }
            label='Learning'
            active={location.pathname.startsWith(CAREHUB_LEARNING_PATH)}
            onClick={() => {
              navigate(CAREHUB_LEARNING_PATH);
              onNavigate?.();
            }}
            testId='carehub-learning-button'
          />
        </div>
      )}
      {templatesOpen && (
        <TemplatesDialog
          workspaceId={workspaceId}
          onClose={() => {
            setTemplatesOpen(false);
            onNavigate?.();
          }}
        />
      )}
    </>
  );
}

/** "Spaces" heading above the spaces in the sidebar. */
export function CareHubSpacesHeader() {
  const workspaceId = useCurrentWorkspaceId();
  const canCreate = useCareHubCan(workspaceId, 'create');
  const [open, setOpen] = useState(false);

  return (
    <div className='group mt-2 flex h-7 items-center px-2 text-xs font-medium text-text-tertiary' data-testid='carehub-spaces-header'>
      <span className='flex-1'>Spaces</span>
      {canCreate && (
        <button
          type='button'
          title='Add a space'
          aria-label='Add a space'
          className='flex h-6 w-6 items-center justify-center rounded-[6px] text-base text-text-secondary hover:bg-fill-content-hover hover:text-text-primary'
          onClick={() => setOpen(true)}
        >
          +
        </button>
      )}
      {open && (
        <Suspense fallback={null}>
          <CreateSpaceModal open={open} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}

/** Shows "New page" only for roles that may create pages. */
export function CareHubCanCreate({ children }: { children: ReactNode }) {
  const workspaceId = useCurrentWorkspaceId();
  const me = useCareHubMe(workspaceId);
  const canCreate = useCareHubCan(workspaceId, 'create');

  if (canCreate) return <>{children}</>;
  return (
    <div className='flex h-9 w-full items-center px-2 text-xs text-text-tertiary' title='Ask an admin to change your role'>
      👀 {me?.role.name || 'View only'} · view only
    </div>
  );
}

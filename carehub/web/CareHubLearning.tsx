// CareHub Learning: the /app/learning page. "My learning" (continue, finished, catalog), the course player,
// Studio for people who build courses, and Reports for people who can see course reports.
import { Component, useEffect, useMemo, useState } from 'react';

import type { ErrorInfo, ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';

import { useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { carehubCan, formatWhen, lastWorkspaceId, UUID_RE, useCareHubMe } from './CareHubCore';
import { formatMinutes, isFinished, lapi, LEARNING_PATH, learningNotLive, lErrorText, plural, statusInfo } from './CareHubLearningApi';
import { Chip, CourseCover, LearningStyle, ProgressBar } from './CareHubLearningBlocks';
import { CareHubLearningPlayer } from './CareHubLearningPlayer';
import { LearningReportCourse, LearningReportPerson, LearningReportsCourses, LearningReportsPeople, REPORTS_PATH } from './CareHubLearningReports';
import { LearningStudioEditor, LearningStudioHome } from './CareHubLearningStudio';
import { chInputClass, ChNote, ChSection } from './CareHubUi';

import type { CourseCard } from './CareHubLearningApi';

// ---------------------------------------------------------------------------
// Safety net: a broken course must never take the whole app down
// ---------------------------------------------------------------------------

class LearningErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[CareHub Learning]', error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <div className='mx-auto flex w-full max-w-[720px] flex-col items-start gap-3 px-4 py-8'>
          <ChNote tone='error'>Something went wrong on this page. Your progress so far is safe.</ChNote>
          <Button type='button' variant='outline' onClick={() => this.setState({ failed: false })}>
            Try again
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// My learning
// ---------------------------------------------------------------------------

function courseMeta(c: CourseCard) {
  const bits = [plural(c.lessons, 'lesson')];

  if (c.est_minutes > 0) bits.push(`About ${formatMinutes(c.est_minutes)}`);
  if (c.quiz) bits.push('Quiz');
  return bits.join(' · ');
}

function ContinueCard({ course, onOpen }: { course: CourseCard; onOpen: () => void }) {
  const p = course.my;
  const percent = p ? p.percent : 0;

  return (
    <button
      type='button'
      onClick={onOpen}
      className='flex w-full min-w-0 items-stretch gap-3 overflow-hidden rounded-[14px] border border-border-primary p-2.5 text-left hover:bg-fill-content-hover'
      data-testid='carehub-learning-continue'
    >
      <div className='h-[72px] w-[96px] shrink-0 overflow-hidden rounded-[10px]'>
        <CourseCover cover={course.cover} preset={course.preset} seed={course.id} />
      </div>
      <div className='flex min-w-0 flex-1 flex-col justify-between gap-1.5 py-0.5'>
        <div className='min-w-0'>
          <div className='truncate text-[15px] font-medium'>{course.title.trim() || 'Untitled course'}</div>
          <div className='truncate text-xs text-text-tertiary'>
            {p?.awaiting_ack ? 'Almost done — confirm to finish' : p?.last_ms ? `Last opened ${formatWhen(p.last_ms)}` : courseMeta(course)}
          </div>
        </div>
        <div className='flex items-center gap-2'>
          <ProgressBar percent={percent} className='flex-1' label={`${course.title} progress`} />
          <span className='shrink-0 text-xs text-text-secondary'>{percent}%</span>
          <span className='shrink-0 text-sm font-medium text-text-action'>Continue →</span>
        </div>
      </div>
    </button>
  );
}

function CourseTile({ course, onOpen }: { course: CourseCard; onOpen: () => void }) {
  const p = course.my;
  const chip = p ? statusInfo(p) : null;
  const action = !p ? 'Start' : isFinished(p) ? 'Review' : 'Continue';

  return (
    <button
      type='button'
      onClick={onOpen}
      className='flex w-full min-w-0 flex-col overflow-hidden rounded-[14px] border border-border-primary text-left hover:bg-fill-content-hover'
      data-testid='carehub-learning-course'
    >
      <div className='h-28 w-full'>
        <CourseCover cover={course.cover} preset={course.preset} seed={course.id} />
      </div>
      <div className='flex min-w-0 flex-1 flex-col gap-1.5 p-3'>
        <div className='flex min-w-0 items-start gap-2'>
          <div className='min-w-0 flex-1 break-words text-[15px] font-medium leading-snug'>{course.title.trim() || 'Untitled course'}</div>
          {chip && <Chip tone={chip.tone}>{chip.label}</Chip>}
        </div>
        {course.summary.trim() && <div className='chl-clamp2 text-sm text-text-secondary'>{course.summary}</div>}
        <div className='mt-auto flex items-center gap-2 pt-1'>
          <span className='min-w-0 flex-1 truncate text-xs text-text-tertiary'>{courseMeta(course)}</span>
          <span className='shrink-0 text-sm font-medium text-text-action'>{action} →</span>
        </div>
      </div>
    </button>
  );
}

function FinishedRow({ course, onOpen }: { course: CourseCard; onOpen: () => void }) {
  const p = course.my;
  const chip = statusInfo(p);
  const gone = course.archived;
  const body = (
    <>
      <span className='min-w-0 flex-1'>
        <span className='block truncate text-sm font-medium'>{course.title.trim() || 'Untitled course'}</span>
        <span className='block truncate text-xs text-text-tertiary'>
          {p?.completed_ms ? `Finished ${formatWhen(p.completed_ms)}` : 'Finished'}
          {gone ? ' · No longer available' : ''}
        </span>
      </span>
      {p && p.score !== null && course.quiz && <span className='shrink-0 text-xs text-text-secondary'>{p.score}%</span>}
      <Chip tone={chip.tone}>{chip.label}</Chip>
    </>
  );

  if (gone) return <div className='flex items-center gap-3 rounded-[10px] px-3 py-2.5 opacity-80'>{body}</div>;

  return (
    <button type='button' onClick={onOpen} className='flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left hover:bg-fill-content-hover'>
      {body}
    </button>
  );
}

function LearningHome({ workspaceId, canBuild }: { workspaceId: string; canBuild: boolean }) {
  const navigate = useNavigate();
  const [my, setMy] = useState<CourseCard[] | null>(null);
  const [catalog, setCatalog] = useState<CourseCard[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [query, setQuery] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!workspaceId) return undefined;
    let alive = true;

    setError(null);
    Promise.all([lapi.my(workspaceId), lapi.catalog(workspaceId)]).then(
      ([m, c]) => {
        if (!alive) return;
        setMy(m);
        setCatalog(c);
      },
      (e: unknown) => {
        if (alive) setError(e || new Error('Something went wrong. Please try again.'));
      }
    );
    return () => {
      alive = false;
    };
  }, [workspaceId, reload]);

  const open = (c: CourseCard) => navigate(`${LEARNING_PATH}/course/${c.id}`);
  const inProgress = useMemo(() => (my || []).filter((c) => c.my && !isFinished(c.my) && !c.archived), [my]);
  const finished = useMemo(() => (my || []).filter((c) => c.my && isFinished(c.my)), [my]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (catalog || []).filter((c) => !c.archived);

    return q ? list.filter((c) => `${c.title} ${c.summary}`.toLowerCase().includes(q)) : list;
  }, [catalog, query]);

  if (error) {
    return (
      <div className='flex flex-col items-start gap-3'>
        <ChNote tone={learningNotLive(error) ? 'info' : 'error'}>{lErrorText(error)}</ChNote>
        <Button type='button' variant='outline' onClick={() => setReload((n) => n + 1)}>
          Try again
        </Button>
      </div>
    );
  }

  if (!my || !catalog) return <div className='text-sm text-text-tertiary'>Loading…</div>;

  const nothing = !catalog.some((c) => !c.archived) && !my.length;

  if (nothing) {
    return (
      <div className='rounded-[16px] border border-dashed border-border-primary px-5 py-10 text-center'>
        <div className='text-4xl' aria-hidden='true'>
          📚
        </div>
        <div className='mt-3 text-lg font-semibold'>No courses yet</div>
        <p className='mx-auto mt-1 max-w-[420px] text-sm text-text-secondary'>
          {canBuild
            ? 'Create the first one in Studio — start from a preset or from the example course.'
            : 'When someone publishes a course, it will show up here.'}
        </p>
        {canBuild && (
          <div className='mt-4'>
            <Button type='button' onClick={() => navigate(`${LEARNING_PATH}/studio`)}>
              Create one in Studio
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {inProgress.length > 0 && (
        <ChSection title='Continue learning'>
          <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
            {inProgress.map((c) => (
              <ContinueCard key={c.id} course={c} onOpen={() => open(c)} />
            ))}
          </div>
        </ChSection>
      )}

      <ChSection
        title='Catalog'
        hint={catalog.length > 0 ? plural(catalog.filter((c) => !c.archived).length, 'course') : undefined}
        right={
          <input
            type='search'
            value={query}
            placeholder='Search courses'
            aria-label='Search courses'
            className={cn(chInputClass, 'w-[180px] max-w-full sm:w-[240px]')}
            onChange={(e) => setQuery(e.target.value)}
          />
        }
      >
        {visible.length ? (
          <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
            {visible.map((c) => (
              <CourseTile key={c.id} course={c} onOpen={() => open(c)} />
            ))}
          </div>
        ) : (
          <div className='rounded-[12px] border border-dashed border-border-primary px-4 py-6 text-center text-sm text-text-tertiary'>
            {query.trim() ? `No courses match “${query.trim()}”.` : 'No courses in the catalog right now.'}
          </div>
        )}
      </ChSection>

      {finished.length > 0 && (
        <ChSection title='Finished' hint={plural(finished.length, 'course')}>
          <div className='flex flex-col rounded-[12px] border border-border-primary p-1'>
            {finished.map((c) => (
              <FinishedRow key={c.id} course={c} onOpen={() => open(c)} />
            ))}
          </div>
        </ChSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function PlayerRoute({ workspaceId }: { workspaceId: string }) {
  const { courseId = '' } = useParams();
  const navigate = useNavigate();

  if (!UUID_RE.test(courseId)) return <Navigate to={LEARNING_PATH} replace />;
  return <CareHubLearningPlayer key={courseId} workspaceId={workspaceId} courseId={courseId} onExit={() => navigate(LEARNING_PATH)} />;
}

const STUDIO_ONLY = 'Studio is for people with the “Build courses” permission. Ask an admin if you need it.';
const REPORTS_ONLY = 'Reports are for people with the “See course reports” or “Build courses” permission. Ask an admin if you need it.';

function OnlyFor({ known, allowed, message, children }: { known: boolean; allowed: boolean; message: string; children: ReactNode }) {
  if (!known) return <div className='text-sm text-text-tertiary'>Loading…</div>;
  if (!allowed) return <ChNote>{message}</ChNote>;

  return <>{children}</>;
}

type TabId = 'home' | 'studio' | 'reports';

function Tabs({ active, canBuild, canReports }: { active: TabId; canBuild: boolean; canReports: boolean }) {
  const navigate = useNavigate();
  const tabs: { id: TabId; label: string; to: string }[] = [
    { id: 'home', label: 'My learning', to: LEARNING_PATH },
    ...(canBuild ? [{ id: 'studio' as const, label: 'Studio', to: `${LEARNING_PATH}/studio` }] : []),
    ...(canReports ? [{ id: 'reports' as const, label: 'Reports', to: REPORTS_PATH }] : []),
  ];

  if (tabs.length < 2) return null;

  return (
    <nav aria-label='Learning' className='mb-5 flex gap-1 border-b border-border-primary'>
      {tabs.map((t) => (
        <button
          key={t.id}
          type='button'
          aria-current={active === t.id ? 'page' : undefined}
          onClick={() => navigate(t.to)}
          className={cn(
            '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
            active === t.id ? 'border-border-theme-thick text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'
          )}
          data-testid={`carehub-learning-tab-${t.id}`}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}

function LearningRoutes() {
  const ctxWorkspace = useCurrentWorkspaceId();
  const workspaceId = ctxWorkspace || lastWorkspaceId() || '';
  const me = useCareHubMe(workspaceId);
  const location = useLocation();
  const known = Boolean(me);
  const canBuild = Boolean(me && !me.is_guest && carehubCan(me, 'learning_build'));
  // Builders can always see reports for the courses they make.
  const canReports = Boolean(me && !me.is_guest && (carehubCan(me, 'learning_build') || carehubCan(me, 'learning_analytics')));
  const rest = location.pathname.startsWith(LEARNING_PATH) ? location.pathname.slice(LEARNING_PATH.length) : '';
  const inStudio = /^\/studio(\/|$)/.test(rest);
  const inEditor = /^\/studio\/[^/]+/.test(rest);
  const inPlayer = /^\/course\//.test(rest);
  const inReports = /^\/reports(\/|$)/.test(rest);

  useEffect(() => {
    document.title = 'Learning · Care Hub';
  }, []);

  if (me?.is_guest) {
    return (
      <div className='mx-auto w-full max-w-[720px] px-4 py-8'>
        <ChNote>Courses aren’t available for guest accounts yet.</ChNote>
      </div>
    );
  }

  return (
    <div
      className={cn('carehub-learning mx-auto w-full px-4 py-6 sm:px-8', inEditor || inReports ? 'max-w-[1240px]' : 'max-w-[1000px]')}
      data-testid='carehub-learning'
    >
      {!inPlayer && !inEditor && (
        <>
          <div className='mb-3 flex flex-wrap items-center gap-3'>
            <h1 className='flex-1 text-2xl font-semibold'>🎓 Learning</h1>
          </div>
          <Tabs active={inStudio ? 'studio' : inReports ? 'reports' : 'home'} canBuild={canBuild} canReports={canReports} />
        </>
      )}
      {!workspaceId ? (
        <div className='text-sm text-text-tertiary'>Loading…</div>
      ) : (
        <Routes>
          <Route index element={<LearningHome workspaceId={workspaceId} canBuild={canBuild} />} />
          <Route path='course/:courseId' element={<PlayerRoute workspaceId={workspaceId} />} />
          <Route
            path='studio'
            element={
              <OnlyFor known={known} allowed={canBuild} message={STUDIO_ONLY}>
                <LearningStudioHome workspaceId={workspaceId} />
              </OnlyFor>
            }
          />
          <Route
            path='studio/:courseId'
            element={
              <OnlyFor known={known} allowed={canBuild} message={STUDIO_ONLY}>
                <LearningStudioEditor workspaceId={workspaceId} />
              </OnlyFor>
            }
          />
          <Route
            path='reports'
            element={
              <OnlyFor known={known} allowed={canReports} message={REPORTS_ONLY}>
                <LearningReportsCourses workspaceId={workspaceId} canBuild={canBuild} />
              </OnlyFor>
            }
          />
          <Route
            path='reports/course/:courseId'
            element={
              <OnlyFor known={known} allowed={canReports} message={REPORTS_ONLY}>
                <LearningReportCourse workspaceId={workspaceId} canBuild={canBuild} />
              </OnlyFor>
            }
          />
          <Route
            path='reports/people'
            element={
              <OnlyFor known={known} allowed={canReports} message={REPORTS_ONLY}>
                <LearningReportsPeople workspaceId={workspaceId} />
              </OnlyFor>
            }
          />
          <Route
            path='reports/people/:uid'
            element={
              <OnlyFor known={known} allowed={canReports} message={REPORTS_ONLY}>
                <LearningReportPerson workspaceId={workspaceId} />
              </OnlyFor>
            }
          />
          <Route path='*' element={<Navigate to={LEARNING_PATH} replace />} />
        </Routes>
      )}
    </div>
  );
}

export default function CareHubLearningPage() {
  const location = useLocation();

  return (
    <LearningErrorBoundary key={location.pathname}>
      <LearningStyle />
      <LearningRoutes />
    </LearningErrorBoundary>
  );
}

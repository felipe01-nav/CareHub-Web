// CareHub status page: is the server up, how has it been over 30 days, and
// are the nightly backups running.
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

import { formatBytes, formatWhen, tzMinutesEast } from './CareHubCore';
import { ChCard, ChNote, ChSection } from './CareHubUi';

export interface CareHubStatus {
  ok: boolean;
  database: boolean;
  now: number;
  server_started: number;
  tracking_since?: number | null;
  uptime_30d?: number | null;
  days: { day: number; uptime: number | null }[];
  incidents: { start: number; end: number }[];
  backups: {
    available: boolean;
    keep_days: number;
    count: number;
    total_bytes: number;
    latest_ms?: number | null;
    files: { name: string; size: number; modified: number }[];
  };
}

export async function loadCareHubStatus(): Promise<CareHubStatus> {
  const res = await fetch(`/api/carehub/status?tz=${tzMinutesEast()}`, { cache: 'no-store' });

  if (!res.ok) throw new Error(`Server answered ${res.status}`);
  const json = await res.json();

  return (json && json.data) || json;
}

function pct(n?: number | null) {
  if (n === null || n === undefined) return '—';
  return `${(n * 100).toFixed(n >= 0.9995 ? 1 : 2)}%`;
}

function dayColor(u: number | null) {
  if (u === null) return 'bg-fill-content-hover';
  if (u >= 0.999) return 'bg-[#22c55e]';
  if (u >= 0.97) return 'bg-[#facc15]';
  return 'bg-[#ef4444]';
}

function duration(ms: number) {
  const m = Math.round(ms / 60000);

  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);

  if (h < 48) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} days`;
}

export function CareHubStatusView({ compact }: { compact?: boolean }) {
  const [status, setStatus] = useState<CareHubStatus | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      loadCareHubStatus()
        .then((s) => {
          if (cancelled) return;
          setStatus(s);
          setError('');
        })
        .catch((e) => !cancelled && setError((e as Error).message || 'Could not reach the server'));

    void load();
    const timer = window.setInterval(load, 60000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (error && !status) {
    return <ChNote tone='error'>Care Hub is not answering right now ({error}). If this lasts, check that the computer running Care Hub is on and Docker is running.</ChNote>;
  }

  if (!status) return <div className='text-sm text-text-tertiary'>Checking…</div>;
  const up = status.ok && status.database;
  const backupAge = status.backups.latest_ms ? Date.now() - status.backups.latest_ms : null;
  const backupOk = backupAge !== null && backupAge < 36 * 3600 * 1000;

  return (
    <div>
      <div
        className={cn(
          'mb-5 flex items-center gap-3 rounded-[14px] px-4 py-3 text-white',
          up ? 'bg-[#16a34a]' : 'bg-[#dc2626]'
        )}
      >
        <span className='text-2xl'>{up ? '✓' : '!'}</span>
        <div>
          <div className='text-base font-semibold'>{up ? 'Everything is working' : 'Something is wrong'}</div>
          <div className='text-xs opacity-90'>
            {up ? `Up since ${formatWhen(status.server_started)}` : status.database ? 'Server problem' : 'The database is not answering'}
            {' · checked '}
            {formatWhen(status.now)}
          </div>
        </div>
      </div>

      <div className='mb-5 flex flex-wrap gap-3'>
        <ChCard label='Uptime (30 days)' value={pct(status.uptime_30d)} />
        <ChCard
          label='Last backup'
          value={status.backups.latest_ms ? formatWhen(status.backups.latest_ms) : status.backups.available ? 'None yet' : 'Not set up'}
          hint={status.backups.available ? `${status.backups.count} kept · ${formatBytes(status.backups.total_bytes)}` : undefined}
        />
        <ChCard label='Backups kept for' value={`${status.backups.keep_days} days`} />
      </div>

      <ChSection title='Last 30 days' hint='Each bar is a day. Green = up all day, yellow = short outage, red = longer outage, grey = no data yet.'>
        <div className='flex h-10 gap-[3px]'>
          {status.days.map((d) => (
            <div
              key={d.day}
              className={cn('flex-1 rounded-[3px]', dayColor(d.uptime))}
              title={`${new Date(d.day * 86400000).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: 'UTC' })}: ${
                d.uptime === null ? 'no data' : pct(d.uptime)
              }`}
            />
          ))}
        </div>
        <div className='mt-1 flex justify-between text-[10px] text-text-tertiary'>
          <span>30 days ago</span>
          <span>Today</span>
        </div>
      </ChSection>

      {!compact && (
        <ChSection title='Outages'>
          {status.incidents.length === 0 ? (
            <div className='text-sm text-text-tertiary'>No outages recorded. 🎉</div>
          ) : (
            <div className='flex flex-col'>
              {status.incidents
                .slice()
                .reverse()
                .slice(0, 20)
                .map((i) => (
                  <div key={i.start} className='flex justify-between border-t border-border-primary py-1.5 text-sm'>
                    <span>{formatWhen(i.start)}</span>
                    <span className='text-text-tertiary'>down {duration(i.end - i.start)}</span>
                  </div>
                ))}
            </div>
          )}
        </ChSection>
      )}

      <ChSection title='Nightly backups'>
        {!status.backups.available ? (
          <ChNote tone='warn'>Backups are not visible to the server yet. Update docker-compose.yml (see Settings → Data &amp; backups) and restart.</ChNote>
        ) : (
          <>
            {!backupOk && (
              <div className='mb-2'>
                <ChNote tone='warn'>The newest backup is more than a day and a half old. Is the computer on at night?</ChNote>
              </div>
            )}
            <div className='flex flex-col'>
              {status.backups.files.slice(0, compact ? 5 : 30).map((f) => (
                <div key={f.name} className='flex gap-2 border-t border-border-primary py-1.5 text-sm'>
                  <span className='min-w-0 flex-1 truncate'>{f.name}</span>
                  <span className='shrink-0 text-xs text-text-tertiary'>{formatBytes(f.size)}</span>
                  <span className='w-[130px] shrink-0 text-right text-xs text-text-tertiary'>{formatWhen(f.modified)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </ChSection>
    </div>
  );
}

export default function CareHubStatusPage() {
  useEffect(() => {
    document.title = 'Status · Care Hub';
  }, []);

  return (
    <div className='min-h-screen w-full overflow-y-auto bg-background-primary text-text-primary'>
      <div className='mx-auto w-full max-w-[760px] px-4 py-8 sm:px-8'>
        <div className='mb-6 flex items-center gap-3'>
          <h1 className='flex-1 text-2xl font-semibold'>Care Hub status</h1>
          <a href='/app' className='text-sm text-text-action hover:underline'>
            Open Care Hub
          </a>
        </div>
        <CareHubStatusView />
      </div>
    </div>
  );
}

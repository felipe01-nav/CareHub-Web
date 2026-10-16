// CareHub Calendar: reads calendar links (.ics) from iCloud, Google or Outlook
// and turns them into events, including repeating events.

export interface IcsTime {
  ms: number;
  allDay: boolean;
  parts: [number, number, number, number, number, number];
  tz?: string;
  utc?: boolean;
}

export interface IcsEvent {
  uid: string;
  title: string;
  location: string;
  description: string;
  url: string;
  start: IcsTime;
  endMs: number;
  rrule?: Record<string, string>;
  exdates: number[];
  recurrenceId?: number;
  cancelled: boolean;
}

export interface IcsOccurrence {
  key: string;
  uid: string;
  title: string;
  location: string;
  description: string;
  url: string;
  start: number;
  end: number;
  allDay: boolean;
}

const DAY = 86400000;

const WINDOWS_TZ: Record<string, string> = {
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  UTC: 'UTC',
};

const dtfCache = new Map<string, Intl.DateTimeFormat | null>();

function getDtf(tz: string): Intl.DateTimeFormat | null {
  if (!dtfCache.has(tz)) {
    try {
      dtfCache.set(
        tz,
        new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          hourCycle: 'h23',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
    } catch {
      dtfCache.set(tz, null);
    }
  }

  return dtfCache.get(tz) ?? null;
}

function tzOffset(utc: number, dtf: Intl.DateTimeFormat): number {
  const p: Record<string, number> = {};

  for (const part of dtf.formatToParts(new Date(utc))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }

  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);

  return asUtc - (utc - (((utc % 1000) + 1000) % 1000));
}

function cleanTz(raw: string): string | undefined {
  let tz = raw.replace(/^"|"$/g, '').trim();

  if (WINDOWS_TZ[tz]) tz = WINDOWS_TZ[tz];
  if (getDtf(tz)) return tz;
  // e.g. "/mozilla.org/20050126_1/Europe/Oslo"
  const tail = tz.split('/').slice(-2).join('/');

  if (getDtf(tail)) return tail;
  return undefined;
}

/** Wall-clock time in a time zone -> milliseconds. */
export function wallToMs(y: number, mo: number, d: number, h: number, mi: number, s: number, tz?: string): number {
  if (tz) {
    const dtf = getDtf(tz);

    if (dtf) {
      const guess = Date.UTC(y, mo - 1, d, h, mi, s);
      const o1 = tzOffset(guess, dtf);
      let t = guess - o1;
      const o2 = tzOffset(t, dtf);

      if (o2 !== o1) t = guess - o2;
      return t;
    }
  }

  return new Date(y, mo - 1, d, h, mi, s).getTime();
}

export function parseIcsTime(value: string, params: Record<string, string>): IcsTime | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());

  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);

  if (!m[4] || (params.VALUE || '').toUpperCase() === 'DATE') {
    return { ms: new Date(y, mo - 1, d).getTime(), allDay: true, parts: [y, mo, d, 0, 0, 0] };
  }

  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = Number(m[6] || 0);

  if (m[7]) return { ms: Date.UTC(y, mo - 1, d, h, mi, s), allDay: false, parts: [y, mo, d, h, mi, s], utc: true };
  const tz = params.TZID ? cleanTz(params.TZID) : undefined;

  return { ms: wallToMs(y, mo, d, h, mi, s, tz), allDay: false, parts: [y, mo, d, h, mi, s], tz };
}

function parseDuration(value: string): number {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());

  if (!m) return 0;
  const ms =
    (Number(m[2] || 0) * 7 + Number(m[3] || 0)) * DAY +
    Number(m[4] || 0) * 3600000 +
    Number(m[5] || 0) * 60000 +
    Number(m[6] || 0) * 1000;

  return m[1] === '-' ? -ms : ms;
}

function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_all, ch: string) => (ch === 'n' || ch === 'N' ? '\n' : ch));
}

function splitOutsideQuotes(text: string, sep: string): string[] {
  const out: string[] = [];
  let quoted = false;
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === '"') quoted = !quoted;
    else if (ch === sep && !quoted) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }

  out.push(text.slice(start));
  return out;
}

function findColon(line: string): number {
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ':' && !quoted) return i;
  }

  return -1;
}

interface Draft {
  uid?: string;
  title?: string;
  location?: string;
  description?: string;
  url?: string;
  conference?: string;
  start?: IcsTime | null;
  end?: IcsTime | null;
  durationMs?: number;
  rrule?: Record<string, string>;
  exdates: number[];
  recurrenceId?: number;
  cancelled?: boolean;
}

export function parseIcs(text: string): IcsEvent[] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events: IcsEvent[] = [];
  let cur: Draft | null = null;
  let nested = 0;

  const finish = (e: Draft) => {
    if (!e.start) return;
    let endMs: number;

    if (e.end && e.end.ms >= e.start.ms) endMs = e.end.ms;
    else if (e.durationMs && e.durationMs > 0) endMs = e.start.ms + e.durationMs;
    else if (e.start.allDay) endMs = e.start.ms + DAY;
    else endMs = e.start.ms;

    events.push({
      uid: e.uid || `${e.start.ms}-${events.length}`,
      title: e.title || '(No title)',
      location: e.location || '',
      description: e.description || '',
      url: e.url || e.conference || '',
      start: e.start,
      endMs,
      rrule: e.rrule,
      exdates: e.exdates,
      recurrenceId: e.recurrenceId,
      cancelled: Boolean(e.cancelled),
    });
  };

  for (const raw of lines) {
    if (!raw) continue;
    const colon = findColon(raw);

    if (colon < 0) continue;
    const head = raw.slice(0, colon);
    const value = raw.slice(colon + 1);
    const [nameRaw, ...paramParts] = splitOutsideQuotes(head, ';');
    const name = nameRaw.trim().toUpperCase();
    const params: Record<string, string> = {};

    for (const p of paramParts) {
      const i = p.indexOf('=');

      if (i > 0) params[p.slice(0, i).trim().toUpperCase()] = p.slice(i + 1).replace(/^"|"$/g, '');
    }

    if (name === 'BEGIN') {
      if (!cur && value.trim().toUpperCase() === 'VEVENT') {
        cur = { exdates: [] };
        nested = 0;
      } else if (cur) {
        nested++;
      }

      continue;
    }

    if (name === 'END') {
      if (cur) {
        if (nested > 0) nested--;
        else if (value.trim().toUpperCase() === 'VEVENT') {
          finish(cur);
          cur = null;
        }
      }

      continue;
    }

    if (!cur || nested > 0) continue;

    switch (name) {
      case 'UID':
        cur.uid = value.trim();
        break;
      case 'SUMMARY':
        cur.title = unescapeText(value);
        break;
      case 'LOCATION':
        cur.location = unescapeText(value);
        break;
      case 'DESCRIPTION':
        cur.description = unescapeText(value);
        break;
      case 'URL':
        cur.url = value.trim();
        break;
      case 'X-GOOGLE-CONFERENCE':
        cur.conference = value.trim();
        break;
      case 'DTSTART':
        cur.start = parseIcsTime(value, params);
        break;
      case 'DTEND':
        cur.end = parseIcsTime(value, params);
        break;
      case 'DURATION':
        cur.durationMs = parseDuration(value);
        break;
      case 'RRULE': {
        const rule: Record<string, string> = {};

        for (const part of value.split(';')) {
          const i = part.indexOf('=');

          if (i > 0) rule[part.slice(0, i).trim().toUpperCase()] = part.slice(i + 1).trim();
        }

        cur.rrule = rule;
        break;
      }

      case 'EXDATE':
        for (const v of value.split(',')) {
          const t = parseIcsTime(v, params);

          if (t) cur.exdates.push(t.ms);
        }

        break;
      case 'RECURRENCE-ID': {
        const t = parseIcsTime(value, params);

        if (t) cur.recurrenceId = t.ms;
        break;
      }

      case 'STATUS':
        cur.cancelled = value.trim().toUpperCase() === 'CANCELLED';
        break;
      default:
        break;
    }
  }

  return events;
}

const WEEKDAYS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function dayNum(y: number, m: number, d: number) {
  return Math.round(Date.UTC(y, m - 1, d) / DAY);
}

function fromDayNum(n: number): [number, number, number] {
  const dt = new Date(n * DAY);

  return [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
}

function weekdayOf(n: number) {
  return new Date(n * DAY).getUTCDay();
}

function daysInMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Start times (ms) of a repeating event between from and to. */
function occurrences(e: IcsEvent, from: number, to: number): number[] {
  const r = e.rrule || {};
  const freq = (r.FREQ || '').toUpperCase();
  const interval = Math.max(1, parseInt(r.INTERVAL || '1', 10) || 1);
  const count = r.COUNT ? Math.max(0, parseInt(r.COUNT, 10) || 0) : Infinity;
  const untilTime = r.UNTIL ? parseIcsTime(r.UNTIL, {}) : null;
  const untilMs = untilTime ? (untilTime.allDay ? untilTime.ms + DAY - 1 : untilTime.ms) : Infinity;
  const [y0, m0, d0, h, mi, s] = e.start.parts;
  const make = (y: number, m: number, d: number) =>
    e.start.allDay
      ? new Date(y, m - 1, d).getTime()
      : e.start.utc
        ? Date.UTC(y, m - 1, d, h, mi, s)
        : wallToMs(y, m, d, h, mi, s, e.start.tz);
  const byday = (r.BYDAY ? r.BYDAY.split(',') : [])
    .map((x) => {
      const mm = /^([+-]?\d+)?(MO|TU|WE|TH|FR|SA|SU)$/.exec(x.trim().toUpperCase());

      return mm ? { n: mm[1] ? parseInt(mm[1], 10) : 0, wd: WEEKDAYS[mm[2]] } : null;
    })
    .filter((x): x is { n: number; wd: number } => x !== null);
  const bymonthday = (r.BYMONTHDAY ? r.BYMONTHDAY.split(',') : []).map((x) => parseInt(x, 10)).filter((x) => x);
  const bymonth = (r.BYMONTH ? r.BYMONTH.split(',') : []).map((x) => parseInt(x, 10)).filter((x) => x);

  const out: number[] = [];
  let emitted = 0;
  let done = false;
  const startMs = e.start.ms;

  const emit = (n: number) => {
    const [y, m, d] = fromDayNum(n);
    const t = make(y, m, d);

    if (t < startMs) return;
    if (t > untilMs || emitted >= count || t > to) {
      done = true;
      return;
    }

    emitted++;
    if (t >= from) out.push(t);
  };

  const dn0 = dayNum(y0, m0, d0);
  let guard = 0;

  if (freq === 'DAILY') {
    for (let k = 0; !done && guard < 200000; k += interval, guard++) {
      const n = dn0 + k;
      const [, m] = fromDayNum(n);

      if (bymonth.length && !bymonth.includes(m)) continue;
      if (byday.length && !byday.some((b) => b.wd === weekdayOf(n))) continue;
      emit(n);
    }
  } else if (freq === 'WEEKLY') {
    const wkst = WEEKDAYS[(r.WKST || 'MO').toUpperCase()] ?? 1;
    const week0 = dn0 - ((weekdayOf(dn0) - wkst + 7) % 7);
    const days = (byday.length ? byday.map((b) => b.wd) : [weekdayOf(dn0)])
      .map((wd) => (wd - wkst + 7) % 7)
      .sort((a, b) => a - b);

    for (let w = 0; !done && guard < 50000; w += interval, guard++) {
      for (const off of days) {
        if (done) break;
        emit(week0 + w * 7 + off);
      }
    }
  } else if (freq === 'MONTHLY') {
    for (let k = 0; !done && guard < 20000; k += interval, guard++) {
      const total = (y0 * 12 + (m0 - 1)) + k;
      const y = Math.floor(total / 12);
      const m = (total % 12) + 1;
      const dim = daysInMonth(y, m);
      let cands: number[] = [];

      if (byday.length) {
        for (const b of byday) {
          const firstWd = weekdayOf(dayNum(y, m, 1));
          const firstMatch = 1 + ((b.wd - firstWd + 7) % 7);
          const all: number[] = [];

          for (let d = firstMatch; d <= dim; d += 7) all.push(d);
          if (b.n > 0 && all[b.n - 1]) cands.push(all[b.n - 1]);
          else if (b.n < 0 && all[all.length + b.n]) cands.push(all[all.length + b.n]);
          else if (b.n === 0) cands.push(...all);
        }
      } else if (bymonthday.length) {
        cands = bymonthday.map((md) => (md > 0 ? md : dim + md + 1));
      } else {
        cands = [d0];
      }

      cands = Array.from(new Set(cands.filter((d) => d >= 1 && d <= dim))).sort((a, b) => a - b);
      for (const d of cands) {
        if (done) break;
        emit(dayNum(y, m, d));
      }
    }
  } else if (freq === 'YEARLY') {
    for (let k = 0; !done && guard < 2000; k += interval, guard++) {
      const y = y0 + k;
      const months = bymonth.length ? [...bymonth].sort((a, b) => a - b) : [m0];

      for (const m of months) {
        const dim = daysInMonth(y, m);
        const days = (bymonthday.length ? bymonthday.map((md) => (md > 0 ? md : dim + md + 1)) : [d0])
          .filter((d) => d >= 1 && d <= dim)
          .sort((a, b) => a - b);

        for (const d of days) {
          if (done) break;
          emit(dayNum(y, m, d));
        }
      }
    }
  } else if (startMs <= to && startMs >= from) {
    out.push(startMs);
  }

  return out;
}

/** All events (repeats included) that overlap [from, to). */
export function expandIcs(events: IcsEvent[], from: number, to: number, keyPrefix: string): IcsOccurrence[] {
  const overrides = new Map<string, Set<number>>();

  for (const e of events) {
    if (e.recurrenceId !== undefined) {
      if (!overrides.has(e.uid)) overrides.set(e.uid, new Set());
      overrides.get(e.uid)?.add(e.recurrenceId);
    }
  }

  const out: IcsOccurrence[] = [];
  const push = (e: IcsEvent, start: number, dur: number) => {
    out.push({
      key: `${keyPrefix}:${e.uid}:${start}`,
      uid: e.uid,
      title: e.title,
      location: e.location,
      description: e.description,
      url: e.url,
      start,
      end: start + dur,
      allDay: e.start.allDay,
    });
  };

  for (const e of events) {
    const dur = Math.max(0, e.endMs - e.start.ms);

    if (!e.rrule || e.recurrenceId !== undefined) {
      if (e.cancelled) continue;
      if (e.start.ms < to && e.start.ms + Math.max(dur, 1) > from) push(e, e.start.ms, dur);
      continue;
    }

    if (e.cancelled) continue;
    const skip = new Set<number>([...e.exdates, ...(overrides.get(e.uid) ?? [])]);

    for (const t of occurrences(e, from - dur - DAY, to)) {
      if (skip.has(t)) continue;
      if (t < to && t + Math.max(dur, 1) > from) push(e, t, dur);
    }
  }

  return out;
}

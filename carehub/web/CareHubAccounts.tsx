// CareHub: Settings > "User accounts" (only for the CareHub administrator).
// Add sign-in accounts with a password, set a new password, or remove an
// account. "Add many people" adds up to 200 accounts at once from a CSV file
// or a pasted list. Nothing here sends email.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { executeAPIRequest, getAxios } from '@/application/services/js-services/http/core';
import { useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { chErrorText } from './CareHubCore';

export const CAREHUB_ACCOUNTS_ITEM = 'carehub_accounts';

export interface CareHubAccount {
  id: string;
  email: string;
  created_at?: string | null;
  last_sign_in_at?: string | null;
  has_signed_in?: boolean;
  in_workspace?: boolean;
  joins_workspace?: boolean;
  /** Name and picture from the person's own profile settings. */
  name?: string;
  avatar?: string;
}

function AccountAvatar({ account }: { account: CareHubAccount }) {
  const [broken, setBroken] = useState(false);
  const avatar = (account.avatar || '').trim();
  const label = (account.name || account.email || '?').trim();
  const isImage = /^(https?:|data:image|\/)/i.test(avatar);
  const base = 'flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-fill-content-hover text-sm font-medium text-text-primary';

  if (avatar && isImage && !broken) {
    return (
      <div className={base}>
        <img src={avatar} alt='' className='h-full w-full object-cover' onError={() => setBroken(true)} />
      </div>
    );
  }

  if (avatar && !isImage && avatar.length <= 16) {
    return <div className={`${base} text-lg`}>{avatar}</div>;
  }

  return <div className={base}>{label.charAt(0).toUpperCase()}</div>;
}

const BASE = '/api/carehub/admin';

function call<T>(method: 'get' | 'post' | 'put' | 'delete', url: string, data?: unknown) {
  return executeAPIRequest<T>(() => getAxios()?.request({ method, url, data }));
}

function errorText(err: unknown) {
  return chErrorText(err);
}

let adminCache: boolean | null = null;

/** True when the signed-in person may manage accounts. */
export function useCarehubIsAdmin() {
  const [isAdmin, setIsAdmin] = useState<boolean>(adminCache ?? false);

  useEffect(() => {
    let alive = true;

    call<{ is_admin: boolean }>('get', `${BASE}/me`)
      .then((res) => {
        adminCache = Boolean(res?.is_admin);
        if (alive) setIsAdmin(adminCache);
      })
      .catch(() => {
        if (alive) setIsAdmin(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return isAdmin;
}

function formatDate(value?: string | null) {
  if (!value) return 'Never';
  const date = new Date(value);

  if (Number.isNaN(date.getTime()) || date.getFullYear() < 2000) return 'Never';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function LockIcon() {
  return (
    <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.75'
      strokeLinecap='round' strokeLinejoin='round' className='h-5 w-5' aria-hidden='true'>
      <rect x='3' y='11' width='18' height='10' rx='2' />
      <path d='M7 11V7a5 5 0 0 1 10 0v4' />
    </svg>
  );
}

export const CareHubAccountsIcon = LockIcon;

type RowMode = 'idle' | 'password' | 'remove';

function AccountRow({ account, workspaceId, isMe, onChanged, onError }: {
  account: CareHubAccount;
  workspaceId?: string;
  isMe: boolean;
  onChanged: (notice: string) => void;
  onError: (msg: string) => void;
}) {
  const [mode, setMode] = useState<RowMode>('idle');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const savePassword = async () => {
    const problem = carehubPasswordProblem(password);

    if (problem) {
      onError(problem);
      return;
    }

    setBusy(true);
    try {
      await call('put', `${BASE}/users/${account.id}/password`, { password });
      setMode('idle');
      setPassword('');
      onChanged(`New password saved for ${account.email}.`);
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const setMembership = async (join: boolean) => {
    if (!workspaceId) return;
    setBusy(true);
    try {
      if (join) {
        const res = await call<{ joined: boolean }>('post', `${BASE}/users/${account.id}/workspace`, {
          workspace_id: workspaceId,
        });

        onChanged(
          res?.joined
            ? `${account.email} is now in this workspace.`
            : `${account.email} will join this workspace when they first sign in.`
        );
      } else {
        await call('delete', `${BASE}/users/${account.id}/workspace?workspace_id=${workspaceId}`);
        onChanged(`${account.email} was taken out of this workspace. Their account still works.`);
      }
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await call('delete', `${BASE}/users/${account.id}`);
      setMode('idle');
      onChanged(`${account.email} can no longer sign in.`);
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const name = (account.name || '').trim();
  const displayName = name && name.toLowerCase() !== (account.email || '').toLowerCase() ? name : '';

  return (
    <div className='border-b border-border-primary px-4 py-3 last:border-b-0' data-testid='carehub-account-row'>
      <div className='flex items-center gap-4'>
        <AccountAvatar account={account} />
        <div className='min-w-0 flex-1'>
          <div className='flex min-w-0 flex-wrap items-center gap-2'>
            <span className='truncate text-sm font-medium text-text-primary'>{displayName || account.email}</span>
            {displayName && <span className='truncate text-xs text-text-caption'>{account.email}</span>}
            {isMe ? (
              <span className='shrink-0 rounded-full bg-fill-content-hover px-2 py-0.5 text-xs text-text-caption'>You</span>
            ) : account.in_workspace ? (
              <span className='shrink-0 rounded-full bg-fill-content-hover px-2 py-0.5 text-xs text-text-caption'>In this workspace</span>
            ) : account.joins_workspace ? (
              <span className='shrink-0 rounded-full bg-fill-content-hover px-2 py-0.5 text-xs text-text-caption'>Joins at first sign-in</span>
            ) : null}
          </div>
          <div className='text-xs text-text-tertiary'>
            Added {formatDate(account.created_at)} · Last sign-in {formatDate(account.last_sign_in_at)}
          </div>
        </div>
      </div>
      {mode === 'idle' && (
          <div className='mt-2 flex flex-wrap gap-2 pl-12'>
            {!isMe && workspaceId && !account.in_workspace && !account.joins_workspace && (
              <Button variant='outline' size='sm' loading={busy} onClick={() => void setMembership(true)}>
                Add to workspace
              </Button>
            )}
            {!isMe && workspaceId && (account.in_workspace || account.joins_workspace) && (
              <Button variant='ghost' size='sm' loading={busy} onClick={() => void setMembership(false)}>
                Take out
              </Button>
            )}
            <Button variant='outline' size='sm' onClick={() => setMode('password')}>
              {isMe ? 'Change my password' : 'Set password'}
            </Button>
            {!isMe && (
              <Button variant='ghost' size='sm' danger onClick={() => setMode('remove')}>
                Remove
              </Button>
            )}
          </div>
        )}
      {mode === 'password' && (
        <form
          className='mt-3 flex items-center gap-2 pl-12'
          onSubmit={(e) => {
            e.preventDefault();
            void savePassword();
          }}
        >
          <Input
            autoFocus
            type='password'
            placeholder='New password'
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className='w-72'
          />
          <Button type='submit' size='sm' loading={busy}>Save</Button>
          <Button type='button' variant='ghost' size='sm' onClick={() => { setMode('idle'); setPassword(''); }}>
            Cancel
          </Button>
        </form>
      )}
      {mode === 'remove' && (
        <div className='mt-3 flex items-center gap-2 pl-12'>
          <span className='flex-1 text-sm text-text-caption'>
            Remove this account? They won't be able to sign in. Their pages stay.
          </span>
          <Button variant='destructive' size='sm' loading={busy} onClick={() => void remove()}>
            Remove
          </Button>
          <Button variant='ghost' size='sm' onClick={() => setMode('idle')}>Cancel</Button>
        </div>
      )}
    </div>
  );
}

export const CAREHUB_PASSWORD_RULES =
  'At least 8 characters, with an uppercase letter, a lowercase letter and a symbol.';

export function carehubPasswordProblem(password: string): string {
  if (password.length < 8) return 'The password needs at least 8 characters.';
  if (!/[A-Z]/.test(password)) return 'The password needs an uppercase letter.';
  if (!/[a-z]/.test(password)) return 'The password needs a lowercase letter.';
  if (!/[^A-Za-z0-9\s]/.test(password)) return 'The password needs a symbol (for example ! ? # or -).';
  return '';
}

// ---------------------------------------------------------------------------
// "Add many people": up to 200 accounts from a CSV file or a pasted list.
// Steps: upload or paste -> check (nothing is created yet) -> starting
// passwords -> create -> done (results CSV). Running the same list again is
// safe: existing accounts are never duplicated or changed (no password resets).
// Starting passwords live only in this panel's memory and in the results file
// the administrator downloads - never stored, logged or sent anywhere else.
// ---------------------------------------------------------------------------

export const CAREHUB_BULK_MAX = 200;
const BULK_NAME_MAX = 100;
const BULK_FILE_MAX_BYTES = 2 * 1024 * 1024;
/** Accounts made at the same time. */
const BULK_PARALLEL = 2;
/** Stop by itself after this many problems in a row (for example the sign-in expired). */
const BULK_STOP_AFTER_PROBLEMS = 5;

/** True while "Add many people" is making accounts or has starting passwords that haven't been downloaded. */
let bulkPasswordsAtRisk = false;

/**
 * The Settings window asks this before it closes or changes page (see rebrand.py).
 * True when it may go ahead: nothing would be lost, or the administrator chose to go anyway.
 */
export function carehubAccountsMayLeave(kind: 'close' | 'page' = 'close'): boolean {
  if (!bulkPasswordsAtRisk) return true;
  return window.confirm(
    kind === 'close'
      ? "The new passwords haven't been downloaded. If you close now, they're lost. Close anyway?"
      : "The new passwords haven't been downloaded. If you leave this page now, they're lost. Leave anyway?"
  );
}

const EMAIL_HEADERS = ['email', 'emailaddress', 'emailvalue', 'mail'];
const NAME_HEADERS = ['name', 'fullname', 'displayname'];
const FIRST_NAME_HEADERS = ['firstname', 'givenname'];
const LAST_NAME_HEADERS = ['lastname', 'surname', 'familyname'];
const KNOWN_HEADERS = [...EMAIL_HEADERS, ...NAME_HEADERS, ...FIRST_NAME_HEADERS, ...LAST_NAME_HEADERS];
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,}$/;

const SPREADSHEET_HELP =
  'That looks like a spreadsheet file, not a CSV. In Excel or Google Sheets, choose File → Save as (or Download) → CSV, then upload that.';

const EXAMPLE_PEOPLE = [
  ['Jordan Lee', 'jordan.lee@brightside.example'],
  ['Sam Rivera', 'sam.rivera@brightside.example'],
  ['Priya Shah', 'priya.shah@brightside.example'],
];

export interface CareHubBulkPerson {
  /** Row in the file (1 = first line), so people can find it. */
  rowNo: number;
  name: string;
  email: string;
}

export interface CareHubPeopleRead {
  people: CareHubBulkPerson[];
  /** Plain-English problem with the whole list ('' = fine). */
  error: string;
}

export type CareHubBulkAction = 'create' | 'join' | 'skip';

export interface CareHubBulkRow extends CareHubBulkPerson {
  key: number;
  action: CareHubBulkAction;
  /** What will happen, in plain words. */
  note: string;
  /** The existing account (action "join"). */
  accountId: string;
}

/** The text of an uploaded file. null = a spreadsheet file (.xlsx, .xls), not text. */
export function carehubDecodeCsv(buffer: ArrayBuffer): string | null {
  const bytes = new Uint8Array(buffer);
  const startsWith = (...signature: number[]) => signature.every((b, i) => bytes[i] === b);

  if (startsWith(0x50, 0x4b, 0x03, 0x04) || startsWith(0xd0, 0xcf, 0x11, 0xe0)) return null;
  if (startsWith(0xff, 0xfe)) return new TextDecoder('utf-16le').decode(bytes);
  if (startsWith(0xfe, 0xff)) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Excel on Windows often saves CSV files in the older Windows-1252 text format.
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Comma, semicolon (Excel in some countries) or tab (pasted from a spreadsheet), from the first line. */
function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (ch === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (ch === '\n' || ch === '\r') {
      if (counts[','] + counts[';'] + counts['\t'] > 0) break;
    } else if (ch in counts) counts[ch] += 1;
  }

  if (counts['\t'] > 0) return '\t';
  if (counts[';'] > 0 && counts[';'] >= counts[',']) return ';';
  return ',';
}

/** CSV rows: quotes, "" inside quotes, delimiters and line breaks inside quotes, \r\n or \n or \r. */
export function parseCsv(text: string, delimiter: string): { rows: string[][]; openQuoteRow: number } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let quoteRow = 0;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else quoted = false;
      continue;
    }

    if (ch === '"' && cell.trim() === '') {
      cell = '';
      quoted = true;
      quoteRow = rows.length + 1;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' || ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
    } else {
      cell += ch;
    }
  }

  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return { rows, openQuoteRow: quoted ? quoteRow : 0 };
}

function headerKey(cell: string) {
  return cell.toLowerCase().replace(/[^a-z]/g, '');
}

function cleanName(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

/** "Jordan Lee <jordan.lee@brightside.example>" -> name + email. Plain cells pass through. */
function splitAddress(cell: string): { name: string; email: string } {
  const match = /^(.*?)<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/.exec(cell);

  if (!match) return { name: '', email: cell.trim() };
  return { name: cleanName(match[1].replace(/^\s*"|"\s*$/g, '')), email: match[2] };
}

function looksLikeEmail(email: string) {
  return email.length <= 254 && EMAIL_RE.test(email);
}

/**
 * People from CSV text. Columns: name + email in any order when there's a header row
 * ("name", "full name", "first name" + "last name", "email", "e-mail"); without one, name then email.
 */
export function carehubReadPeople(input: string): CareHubPeopleRead {
  let text = input.replace(/^\uFEFF/, '');
  const sep = /^sep=(.)[^\S\r\n]*(\r\n|\n|\r|$)/i.exec(text);
  const rowOffset = sep ? 1 : 0;

  if (sep) text = text.slice(sep[0].length);

  const { rows, openQuoteRow } = parseCsv(text, sep ? sep[1] : detectDelimiter(text));

  if (openQuoteRow) {
    return {
      people: [],
      error: `Row ${openQuoteRow + rowOffset} has a quote mark (") that's never closed. Please check that row.`,
    };
  }

  const cells = rows.map((row) => row.map((cell) => cell.trim()));
  const firstIndex = cells.findIndex((row) => row.some(Boolean));

  if (firstIndex < 0) return { people: [], error: 'The list is empty. Add one person per line: name, then email.' };

  const keys = cells[firstIndex].map(headerKey);
  const isHeader = !cells[firstIndex].some((cell) => cell.includes('@')) && keys.some((key) => KNOWN_HEADERS.includes(key));
  const column = (names: string[]) => (isHeader ? keys.findIndex((key) => names.includes(key)) : -1);
  const emailCol = column(EMAIL_HEADERS);
  const nameCol = column(NAME_HEADERS);
  const firstCol = column(FIRST_NAME_HEADERS);
  const lastCol = column(LAST_NAME_HEADERS);

  if (isHeader && emailCol < 0) {
    return { people: [], error: 'The first row looks like a header, but there\'s no email column. Name one of the columns "email".' };
  }

  const people: CareHubBulkPerson[] = [];
  const add = (rowNo: number, name: string, email: string) => {
    const address = splitAddress(email);

    people.push({ rowNo, name: cleanName(name || address.name), email: address.email });
  };

  for (let i = isHeader ? firstIndex + 1 : firstIndex; i < cells.length; i += 1) {
    const row = cells[i];
    const rowNo = i + 1 + rowOffset;
    const filled = row.filter(Boolean);

    if (!filled.length) continue;

    if (isHeader) {
      const parts = [firstCol >= 0 ? row[firstCol] || '' : '', lastCol >= 0 ? row[lastCol] || '' : ''];

      add(rowNo, (nameCol >= 0 ? row[nameCol] || '' : '') || parts.filter(Boolean).join(' '), row[emailCol] || '');
      continue;
    }

    const at = filled.findIndex((cell) => cell.includes('@'));

    if (filled.length > 1 && filled.every((cell) => cell.includes('@'))) {
      // Several addresses on one line, like "jordan@brightside.example; sam@brightside.example".
      filled.forEach((cell) => add(rowNo, '', cell));
    } else if (at < 0) {
      add(rowNo, filled[0], filled[1] || '');
    } else {
      // Usually name, then email - but the email may come first.
      add(rowNo, filled.slice(0, at).join(' ') || filled[at + 1] || '', filled[at]);
    }
  }

  if (!people.length) {
    return {
      people,
      error: isHeader ? 'The list only has a header row. Add one person per line under it.' : 'The list is empty. Add one person per line: name, then email.',
    };
  }

  if (people.length > CAREHUB_BULK_MAX) {
    return {
      people: [],
      error: `That's ${people.length} people. Please split the file into parts of ${CAREHUB_BULK_MAX} or fewer.`,
    };
  }

  return { people, error: '' };
}

/** What will happen to each person: a new account, added to this workspace, or skipped (and why). */
export function carehubPlanBulk(people: CareHubBulkPerson[], accounts: CareHubAccount[], join: boolean): CareHubBulkRow[] {
  const byEmail = new Map<string, CareHubAccount>();
  const seen = new Map<string, number>();

  accounts.forEach((account) => {
    const email = (account.email || '').trim().toLowerCase();

    if (email) byEmail.set(email, account);
  });

  return people.map((person, key): CareHubBulkRow => {
    const email = person.email.trim().replace(/^mailto:/i, '').toLowerCase();
    const row = { ...person, key, email, name: cleanName(person.name), accountId: '' };
    const skip = (note: string): CareHubBulkRow => ({ ...row, action: 'skip', note });

    if (!email) return skip('Skipped — no email');
    if (!looksLikeEmail(email)) return skip("Skipped — the email doesn't look right");

    const firstRow = seen.get(email);

    if (firstRow !== undefined) return skip(`Skipped — listed twice in the file (first on row ${firstRow})`);
    seen.set(email, person.rowNo);
    if (row.name.length > BULK_NAME_MAX) return skip(`Skipped — name too long (over ${BULK_NAME_MAX} characters)`);

    const existing = byEmail.get(email);

    if (!existing) return { ...row, action: 'create', note: 'New account' };
    if (existing.in_workspace) return skip('Already in this workspace — skipped');
    if (existing.joins_workspace) return skip('Already set to join this workspace — skipped');
    if (!join) return skip('Already has an account — skipped');
    return { ...row, action: 'join', note: 'Already has an account — will be added to this workspace', accountId: existing.id };
  });
}

const PW_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const PW_LOWER = 'abcdefghijkmnpqrstuvwxyz';
const PW_DIGITS = '23456789';
const PW_SYMBOLS = '!#%*?-+=';

function canMakePasswords() {
  return typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function';
}

/** A fair random number from 0 to n - 1. */
function randomBelow(n: number) {
  const buffer = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / n) * n;

  for (;;) {
    globalThis.crypto.getRandomValues(buffer);
    if (buffer[0] < limit) return buffer[0] % n;
  }
}

function randomChar(chars: string) {
  return chars[randomBelow(chars.length)];
}

/**
 * A random 12-character starting password (made in the browser) that passes carehubPasswordProblem.
 * Look-alike characters (0/O, 1/l/I) are left out, and it starts with a letter so spreadsheet apps
 * never read it as a formula.
 */
export function carehubStartingPassword(): string {
  const all = PW_UPPER + PW_LOWER + PW_DIGITS + PW_SYMBOLS;
  const rest = [randomChar(PW_UPPER), randomChar(PW_LOWER), randomChar(PW_DIGITS), randomChar(PW_SYMBOLS)];

  while (rest.length < 11) rest.push(randomChar(all));
  for (let i = rest.length - 1; i > 0; i -= 1) {
    const j = randomBelow(i + 1);

    [rest[i], rest[j]] = [rest[j], rest[i]];
  }

  return randomChar(PW_UPPER + PW_LOWER) + rest.join('');
}

/** carehubPasswordProblem, plus what keeps a shared password safe in the results file. */
function sharedPasswordProblem(password: string): string {
  if (/^\s|\s$/.test(password)) return 'Please remove the spaces at the start or end of the password.';

  const problem = carehubPasswordProblem(password);

  if (problem) return problem;
  if (/^[=+\-@]/.test(password)) {
    return "Please don't start the password with = + - or @ (spreadsheet apps can change it when they open the results file).";
  }

  return '';
}

function csvCell(value: string) {
  // A leading = + - @ would make spreadsheet apps run the cell as a formula.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;

  return /[",;\r\n]|^\s|\s$/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV text that Excel, Numbers and Google Sheets open correctly (UTF-8 with a BOM, \r\n line ends). */
export function carehubCsv(rows: string[][]): string {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function downloadCsv(fileName: string, rows: string[][]) {
  const url = URL.createObjectURL(new Blob([carehubCsv(rows)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');

  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function todayStamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

type BulkStatus = 'working' | 'created' | 'added' | 'failed' | 'not_done';

interface BulkResult {
  status: BulkStatus;
  /** What happened, in plain words (also the "result" column of the results file). */
  text: string;
  /** Starting password - only for accounts made in this run. */
  password: string;
  /** Created, but couldn't be put in this workspace. */
  warn?: boolean;
}

function bulkFinished(result?: BulkResult) {
  return result?.status === 'created' || result?.status === 'added' || result?.status === 'failed';
}

async function runBulkRow(
  row: CareHubBulkRow,
  workspaceId: string | undefined,
  join: boolean,
  makePassword: () => string
): Promise<BulkResult> {
  if (row.action === 'join') {
    try {
      const res = await call<{ joined?: boolean }>('post', `${BASE}/users/${row.accountId}/workspace`, {
        workspace_id: workspaceId,
      });

      return { status: 'added', text: res?.joined ? 'Added to workspace' : 'Added to workspace (joins at first sign-in)', password: '' };
    } catch (e) {
      return { status: 'failed', text: `Failed: ${errorText(e)}`, password: '' };
    }
  }

  const password = makePassword();
  let created: { id?: string } | undefined;

  try {
    // The account is made first and then put in the workspace, so a workspace problem never hides a new account.
    created = await call<{ id?: string }>('post', `${BASE}/users`, {
      email: row.email,
      password,
      ...(row.name ? { name: row.name } : {}),
    });
  } catch (e) {
    return { status: 'failed', text: `Failed: ${errorText(e)}`, password: '' };
  }

  if (!join || !workspaceId) return { status: 'created', text: 'Created', password };

  const id = typeof created?.id === 'string' ? created.id : '';

  if (!id) {
    return { status: 'created', text: 'Created, but not added to this workspace. Use "Add to workspace" on their account.', password, warn: true };
  }

  try {
    await call('post', `${BASE}/users/${id}/workspace`, { workspace_id: workspaceId });
    return { status: 'created', text: 'Created', password };
  } catch (e) {
    return { status: 'created', text: `Created, but not added to this workspace: ${errorText(e)}`, password, warn: true };
  }
}

type BulkStep = 'source' | 'check' | 'passwords' | 'create' | 'done';

const BULK_STEPS: { id: BulkStep; label: string }[] = [
  { id: 'source', label: 'Upload or paste' },
  { id: 'check', label: 'Check' },
  { id: 'passwords', label: 'Starting passwords' },
  { id: 'create', label: 'Create' },
  { id: 'done', label: 'Done' },
];

type BulkTone = 'green' | 'blue' | 'gray' | 'red' | 'amber';

// Mid-tone dots read well in light and dark mode.
const TONE_COLORS: Record<BulkTone, string> = {
  green: '#16a34a',
  blue: '#3b82f6',
  gray: '#9ca3af',
  red: '#ef4444',
  amber: '#f59e0b',
};

const BULK_FIELD =
  'carehub-input w-full rounded-[8px] border border-border-primary bg-transparent px-2.5 py-1.5 text-sm text-text-primary outline-none focus:border-border-theme-thick';

function resultTone(row: CareHubBulkRow, result?: BulkResult): BulkTone {
  if (row.action === 'skip' || !result) return 'gray';
  if (result.status === 'created') return result.warn ? 'amber' : 'green';
  if (result.status === 'added') return 'blue';
  if (result.status === 'failed') return 'red';
  return 'gray';
}

function resultText(row: CareHubBulkRow, result?: BulkResult) {
  if (row.action === 'skip') return row.note;
  if (!result || result.status === 'working') return 'Not done';
  return result.text;
}

function BulkSteps({ step }: { step: BulkStep }) {
  const index = BULK_STEPS.findIndex((s) => s.id === step);

  return (
    <ol className='flex flex-wrap gap-x-3 gap-y-1 text-xs' aria-label='Steps'>
      {BULK_STEPS.map((s, i) => (
        <li
          key={s.id}
          aria-current={i === index ? 'step' : undefined}
          className={i === index ? 'font-semibold text-text-primary' : i < index ? 'text-text-caption' : 'text-text-tertiary'}
        >
          {i + 1}. {s.label}
        </li>
      ))}
    </ol>
  );
}

function StatusLine({ tone, children }: { tone: BulkTone; children: ReactNode }) {
  return (
    <div className='flex min-w-0 items-start gap-1.5 text-xs text-text-caption'>
      <span aria-hidden='true' className='mt-[4px] h-2 w-2 shrink-0 rounded-full' style={{ background: TONE_COLORS[tone] }} />
      <span className='min-w-0 break-words'>{children}</span>
    </div>
  );
}

function BulkList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role='region'
      aria-label={label}
      tabIndex={0}
      className='max-h-[50vh] overflow-y-auto rounded-[8px] border border-border-primary outline-none focus-visible:border-border-theme-thick'
    >
      <ul>{children}</ul>
    </div>
  );
}

function BulkPersonRow({ row, showRow, children }: { row: CareHubBulkRow; showRow?: boolean; children: ReactNode }) {
  return (
    <li
      className='flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-border-primary px-3 py-2 last:border-b-0'
      data-testid='carehub-bulk-row'
    >
      <div className='min-w-[200px] flex-1'>
        <div className='break-words text-sm text-text-primary'>
          {row.name || <span className='text-text-tertiary'>No name</span>}
        </div>
        <div className='break-words text-xs text-text-caption'>
          {row.email || 'No email'}
          {showRow ? ` · row ${row.rowNo}` : ''}
        </div>
      </div>
      <div className='min-w-[200px] flex-1'>{children}</div>
    </li>
  );
}

function CareHubBulkAdd({ workspaceId, onClose, onChanged }: {
  workspaceId?: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const canGenerate = canMakePasswords();
  const [step, setStep] = useState<BulkStep>('source');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [sourceError, setSourceError] = useState('');
  const [checking, setChecking] = useState(false);
  const [people, setPeople] = useState<CareHubBulkPerson[]>([]);
  const [accounts, setAccounts] = useState<CareHubAccount[]>([]);
  const [joinWorkspace, setJoinWorkspace] = useState(true);
  const [onlySkipped, setOnlySkipped] = useState(false);
  const [passwordMode, setPasswordMode] = useState<'each' | 'same'>(canGenerate ? 'each' : 'same');
  const [sharedPassword, setSharedPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [results, setResults] = useState<Record<number, BulkResult>>({});
  const [running, setRunning] = useState<'idle' | 'running' | 'stopping'>('idle');
  const [stopNote, setStopNote] = useState('');
  const [downloaded, setDownloaded] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);
  const [leaving, setLeaving] = useState<'' | 'close' | 'again'>('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const leaveRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const runRef = useRef({ alive: true, stop: false });

  const join = Boolean(workspaceId) && joinWorkspace;
  const rows = useMemo(() => carehubPlanBulk(people, accounts, join), [people, accounts, join]);
  const todo = useMemo(() => rows.filter((row) => row.action !== 'skip'), [rows]);
  const plan = useMemo(() => {
    const counts: Record<CareHubBulkAction, number> = { create: 0, join: 0, skip: 0 };

    rows.forEach((row) => {
      counts[row.action] += 1;
    });
    return counts;
  }, [rows]);
  const tally = useMemo(() => {
    const t = { created: 0, added: 0, failed: 0, warned: 0, open: 0, passwords: 0 };

    todo.forEach((row) => {
      const result = results[row.key];

      if (result?.password) t.passwords += 1;
      if (!bulkFinished(result)) t.open += 1;
      else if (result?.status === 'created') {
        t.created += 1;
        if (result.warn) t.warned += 1;
      } else if (result?.status === 'added') t.added += 1;
      else t.failed += 1;
    });
    return t;
  }, [todo, results]);
  const busy = running !== 'idle';
  const guard = busy || (tally.passwords > 0 && !downloaded);

  useEffect(() => {
    const ref = runRef.current;

    ref.alive = true;
    return () => {
      // Closing the panel stops a run: nothing keeps creating accounts out of sight.
      ref.alive = false;
      ref.stop = true;
    };
  }, []);

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (leaving) leaveRef.current?.focus();
  }, [leaving]);

  useEffect(() => {
    if (!guard) return undefined;
    bulkPasswordsAtRisk = true;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    // Escape would close the whole Settings window (and lose the starting passwords): ask first instead.
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (!busy) setLeaving((now) => (now ? '' : 'close'));
    };

    window.addEventListener('beforeunload', warn);
    window.addEventListener('keydown', escape, true);
    return () => {
      bulkPasswordsAtRisk = false;
      window.removeEventListener('beforeunload', warn);
      window.removeEventListener('keydown', escape, true);
    };
  }, [guard, busy]);

  const readFile = async (file?: File) => {
    if (!file) return;
    setSourceError('');
    if (/\.(xlsx|xlsm|xlsb|xls|numbers|ods)$/i.test(file.name)) {
      setSourceError(SPREADSHEET_HELP);
      return;
    }

    if (file.size > BULK_FILE_MAX_BYTES) {
      setSourceError('That file is too big for a list of names and emails. Please use a CSV file with just those columns.');
      return;
    }

    try {
      const decoded = carehubDecodeCsv(await file.arrayBuffer());

      if (decoded === null) {
        setSourceError(SPREADSHEET_HELP);
        return;
      }

      setText(decoded.replace(/^\uFEFF/, ''));
      setFileName(file.name);
    } catch {
      setSourceError("We couldn't read that file. Please try again, or paste the list instead.");
    }
  };

  const check = async () => {
    const read = carehubReadPeople(text);

    setSourceError('');
    setLeaving('');
    if (read.error) {
      setSourceError(read.error);
      setStep('source');
      return;
    }

    setChecking(true);
    try {
      const query = workspaceId ? `?workspace_id=${workspaceId}` : '';
      const res = await call<{ users: CareHubAccount[] }>('get', `${BASE}/users${query}`);

      if (!runRef.current.alive) return;
      setAccounts(res?.users ?? []);
      setPeople(read.people);
      setResults({});
      setStopNote('');
      setDownloaded(false);
      setShowPasswords(false);
      setOnlySkipped(false);
      setStep('check');
    } catch (e) {
      setSourceError(`We couldn't load the current accounts, so nothing was checked. ${errorText(e)}`);
      setStep('source');
    } finally {
      setChecking(false);
    }
  };

  const toCreate = () => {
    const problem = passwordMode === 'same' ? sharedPasswordProblem(sharedPassword) : '';

    setPasswordError(problem);
    if (!problem) setStep('create');
  };

  const run = async (queue: CareHubBulkRow[]) => {
    const ref = runRef.current;
    const shared = passwordMode === 'same' ? sharedPassword : '';
    let next = 0;
    let problems = 0;

    ref.stop = false;
    setRunning('running');
    setStopNote('');
    setLeaving('');
    setStep('create');

    const worker = async () => {
      while (ref.alive && !ref.stop && next < queue.length) {
        const row = queue[next];
        const working: BulkResult = {
          status: 'working',
          text: row.action === 'create' ? 'Creating…' : 'Adding to this workspace…',
          password: '',
        };

        next += 1;
        setResults((prev) => ({ ...prev, [row.key]: working }));
        const result = await runBulkRow(row, workspaceId, join, () => shared || carehubStartingPassword());

        if (!ref.alive) return;
        setResults((prev) => ({ ...prev, [row.key]: result }));
        if (result.status === 'failed' || result.warn) {
          problems += 1;
          if (problems >= BULK_STOP_AFTER_PROBLEMS && !ref.stop) {
            ref.stop = true;
            setStopNote(`Stopped after ${BULK_STOP_AFTER_PROBLEMS} problems in a row. The last one: ${result.text}`);
          }
        } else {
          problems = 0;
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(BULK_PARALLEL, queue.length) }, () => worker()));
    if (!ref.alive) return;
    setResults((prev) => {
      const out = { ...prev };

      queue.forEach((row) => {
        if (!bulkFinished(out[row.key])) out[row.key] = { status: 'not_done', text: 'Not done (stopped)', password: '' };
      });
      return out;
    });
    setRunning('idle');
    setStep('done');
    onChanged();
  };

  const stop = () => {
    runRef.current.stop = true;
    setRunning('stopping');
    setStopNote((note) => note || 'You stopped it.');
  };

  const download = () => {
    const lines = [['name', 'email', 'result', 'starting password']];

    rows.forEach((row) => {
      const result = results[row.key];

      lines.push([row.name, row.email, resultText(row, result), result?.password || '']);
    });
    downloadCsv(`care-hub-accounts-${todayStamp()}.csv`, lines);
    setDownloaded(true);
  };

  const leave = (kind: 'close' | 'again') => {
    setLeaving('');
    if (kind === 'close') onClose();
    else void check();
  };

  const requestLeave = (kind: 'close' | 'again') => {
    if (tally.passwords > 0 && !downloaded) setLeaving(kind);
    else leave(kind);
  };

  const leavingKind = leaving === 'again' ? 'again' : 'close';
  const finished = todo.length - tally.open;
  const current = Math.min(finished + 1, todo.length);
  const stopped = Boolean(stopNote) && tally.open > 0;
  const shown = onlySkipped ? rows.filter((row) => row.action === 'skip') : rows;
  const totals = [`${plan.create} new`, ...(join ? [`${plan.join} added to this workspace`] : []), `${plan.skip} skipped`].join(' · ');
  const readyText =
    plan.create === 0
      ? `Ready to add ${plural(plan.join, 'person', 'people')} who already have an account to this workspace.`
      : plan.join > 0
        ? `Ready to create ${plural(plan.create, 'account')} and add ${plural(plan.join, 'person', 'people')} who already have an account to this workspace.`
        : `Ready to create ${plural(plan.create, 'account')}${join ? ' and put them in this workspace' : ''}.`;
  const startLabel =
    plan.create > 0 ? `Create ${plural(plan.create, 'account')}` : `Add ${plural(plan.join, 'person', 'people')} to this workspace`;
  const progressText =
    running === 'stopping'
      ? 'Finishing the current ones, then stopping…'
      : plan.join === 0
        ? `Creating ${current} of ${todo.length}…`
        : plan.create === 0
          ? `Adding ${current} of ${todo.length} to this workspace…`
          : `Working on ${current} of ${todo.length}…`;
  const summary = [
    ...(plan.create > 0 ? [`${tally.created} created`] : []),
    ...(plan.join > 0 ? [`${tally.added} added to this workspace`] : []),
    ...(tally.warned > 0 ? [`${tally.warned} not added to this workspace`] : []),
    ...(plan.skip > 0 ? [`${plan.skip} skipped`] : []),
    ...(tally.failed > 0 ? [`${tally.failed} failed`] : []),
    ...(tally.open > 0 ? [`${tally.open} not done`] : []),
  ].join(' · ');
  const heading =
    step === 'source'
      ? 'Upload or paste'
      : step === 'check'
        ? 'Check — nothing is created yet'
        : step === 'passwords'
          ? 'Starting passwords'
          : step === 'create'
            ? 'Create'
            : stopped
              ? 'Stopped'
              : 'Done';

  return (
    <div className='flex flex-col gap-4' data-testid='carehub-bulk-panel'>
      <div className='flex flex-col gap-1'>
        <div className='flex items-center justify-between gap-2'>
          <h2 className='min-w-0 text-xl font-semibold text-text-primary'>Add many people</h2>
          <Button variant='outline' size='sm' disabled={busy} onClick={() => requestLeave('close')} data-testid='carehub-bulk-close'>
            Close
          </Button>
        </div>
        <BulkSteps step={step} />
      </div>

      <h3 ref={headingRef} tabIndex={-1} className='text-base font-medium text-text-primary outline-none'>
        {heading}
      </h3>

      {leaving && (
        <div
          ref={leaveRef}
          tabIndex={-1}
          role='alert'
          className='flex flex-col gap-2 rounded-[8px] border border-border-error-thick px-3 py-2 outline-none'
        >
          <span className='text-sm text-text-primary'>
            You haven&apos;t downloaded the results yet. Once you leave, the starting passwords are gone for good.
          </span>
          <div className='flex flex-wrap gap-2'>
            <Button
              size='sm'
              onClick={() => {
                download();
                leave(leavingKind);
              }}
            >
              {leavingKind === 'close' ? 'Download and close' : 'Download and check again'}
            </Button>
            <Button size='sm' variant='ghost' danger onClick={() => leave(leavingKind)}>
              Leave without them
            </Button>
            <Button size='sm' variant='ghost' onClick={() => setLeaving('')}>
              Stay
            </Button>
          </div>
        </div>
      )}

      {step === 'source' && (
        <div className='flex flex-col gap-3'>
          <p className='text-sm text-text-caption'>
            Add up to {CAREHUB_BULK_MAX} people at once from a CSV file or a pasted list. You&apos;ll see exactly what will
            happen before anything is created.
          </p>
          <div className='flex flex-wrap items-center gap-2'>
            <input
              ref={fileRef}
              type='file'
              accept='.csv,.tsv,.txt,text/csv,text/plain'
              className='sr-only'
              tabIndex={-1}
              aria-hidden='true'
              data-testid='carehub-bulk-file'
              onChange={(e) => {
                void readFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <Button type='button' variant='outline' size='sm' onClick={() => fileRef.current?.click()}>
              Upload a CSV file
            </Button>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={() => downloadCsv('care-hub-people-example.csv', [['name', 'email'], ...EXAMPLE_PEOPLE])}
            >
              Download an example file
            </Button>
          </div>
          {fileName && (
            <div role='status' className='break-words text-xs text-text-caption'>
              Loaded “{fileName}”. You can check it below, or change it before you continue.
            </div>
          )}
          <label htmlFor='carehub-bulk-paste' className='text-sm text-text-primary'>
            Or paste names and emails, one person per line
          </label>
          <textarea
            id='carehub-bulk-paste'
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'Jordan Lee, jordan.lee@brightside.example\nSam Rivera, sam.rivera@brightside.example'}
            spellCheck={false}
            className={`${BULK_FIELD} min-h-[140px] resize-y`}
            aria-describedby='carehub-bulk-paste-hint'
            data-testid='carehub-bulk-paste'
          />
          <div id='carehub-bulk-paste-hint' className='text-xs text-text-tertiary'>
            Two columns: name and email. A header row is optional. You can paste straight from a spreadsheet.
          </div>
          {sourceError && (
            <div role='alert' className='rounded-[8px] border border-border-error-thick px-3 py-2 text-sm text-text-error'>
              {sourceError}
            </div>
          )}
          <div className='flex flex-wrap gap-2'>
            <Button loading={checking} disabled={!text.trim()} onClick={() => void check()} data-testid='carehub-bulk-check'>
              Check the list
            </Button>
            <Button variant='ghost' onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {step === 'check' && (
        <div className='flex flex-col gap-3'>
          <div className='text-sm font-medium text-text-primary' data-testid='carehub-bulk-totals'>
            {totals}
          </div>
          {workspaceId && (
            <label className='flex cursor-pointer items-center gap-2 text-sm text-text-caption'>
              <input
                type='checkbox'
                checked={joinWorkspace}
                onChange={(e) => setJoinWorkspace(e.target.checked)}
                className='h-4 w-4'
                style={{ accentColor: 'currentColor' }}
                data-testid='carehub-bulk-join'
              />
              Put new people in this workspace
            </label>
          )}
          {workspaceId && !joinWorkspace && (
            <div className='text-xs text-text-tertiary'>
              Nobody will be added to this workspace, and people who already have an account are skipped.
            </div>
          )}
          {plan.skip > 0 && rows.length > 10 && (
            <label className='flex cursor-pointer items-center gap-2 text-sm text-text-caption'>
              <input
                type='checkbox'
                checked={onlySkipped}
                onChange={(e) => setOnlySkipped(e.target.checked)}
                className='h-4 w-4'
                style={{ accentColor: 'currentColor' }}
              />
              Show only the {plural(plan.skip, 'skipped row')}
            </label>
          )}
          <BulkList label='What will happen to each person'>
            {shown.map((row) => (
              <BulkPersonRow key={row.key} row={row} showRow={row.action === 'skip'}>
                <StatusLine tone={row.action === 'create' ? 'green' : row.action === 'join' ? 'blue' : 'gray'}>{row.note}</StatusLine>
              </BulkPersonRow>
            ))}
          </BulkList>
          <div className='text-xs text-text-tertiary'>
            New accounts get the names in this list. People can change their name in their profile after they sign
            in. Existing accounts keep the name they have.
          </div>
          {todo.length === 0 && (
            <div role='status' className='rounded-[8px] bg-fill-content-hover px-3 py-2 text-sm text-text-primary'>
              There&apos;s nothing to do: everyone in this list already has an account here or was skipped.
            </div>
          )}
          <div className='flex flex-wrap gap-2'>
            <Button
              disabled={todo.length === 0}
              onClick={() => setStep(plan.create > 0 ? 'passwords' : 'create')}
              data-testid='carehub-bulk-next'
            >
              Next
            </Button>
            <Button variant='ghost' onClick={() => setStep('source')}>
              Back
            </Button>
          </div>
        </div>
      )}

      {step === 'passwords' && (
        <div className='flex flex-col gap-3'>
          <fieldset className='flex flex-col gap-3'>
            <legend className='sr-only'>Starting passwords</legend>
            <label className={`flex items-start gap-2 ${canGenerate ? 'cursor-pointer' : 'opacity-60'}`}>
              <input
                type='radio'
                name='carehub-bulk-passwords'
                checked={passwordMode === 'each'}
                disabled={!canGenerate}
                onChange={() => setPasswordMode('each')}
                className='mt-0.5 h-4 w-4 shrink-0'
                style={{ accentColor: 'currentColor' }}
                data-testid='carehub-bulk-pw-each'
              />
              <span className='flex min-w-0 flex-col gap-0.5'>
                <span className='text-sm text-text-primary'>A different starting password for each person</span>
                <span className='text-xs text-text-tertiary'>
                  {canGenerate
                    ? 'Care Hub makes a strong random password for each person, here in your browser. You\'ll see them at the end.'
                    : "This browser can't make random passwords. Choose one starting password for everyone instead."}
                </span>
              </span>
            </label>
            <label className='flex cursor-pointer items-start gap-2'>
              <input
                type='radio'
                name='carehub-bulk-passwords'
                checked={passwordMode === 'same'}
                onChange={() => setPasswordMode('same')}
                className='mt-0.5 h-4 w-4 shrink-0'
                style={{ accentColor: 'currentColor' }}
                data-testid='carehub-bulk-pw-same'
              />
              <span className='flex min-w-0 flex-col gap-0.5'>
                <span className='text-sm text-text-primary'>One starting password for everyone</span>
                <span className='text-xs text-text-tertiary'>{CAREHUB_PASSWORD_RULES}</span>
              </span>
            </label>
          </fieldset>
          {passwordMode === 'same' && (
            <div className='flex flex-col gap-1 pl-6'>
              <label htmlFor='carehub-bulk-shared-password' className='text-xs text-text-caption'>
                Starting password for everyone
              </label>
              <Input
                id='carehub-bulk-shared-password'
                type='text'
                value={sharedPassword}
                onChange={(e) => {
                  setSharedPassword(e.target.value);
                  setPasswordError('');
                }}
                className='w-full max-w-[320px] font-mono'
                data-testid='carehub-bulk-shared-password'
              />
            </div>
          )}
          <div className='rounded-[8px] bg-fill-content-hover px-3 py-2 text-sm text-text-primary'>
            Everyone chooses their own password the first time they sign in. No emails are sent — share the starting
            passwords yourself.
          </div>
          {passwordError && (
            <div role='alert' className='rounded-[8px] border border-border-error-thick px-3 py-2 text-sm text-text-error'>
              {passwordError}
            </div>
          )}
          <div className='flex flex-wrap gap-2'>
            <Button onClick={toCreate} data-testid='carehub-bulk-next'>
              Next
            </Button>
            <Button variant='ghost' onClick={() => setStep('check')}>
              Back
            </Button>
          </div>
        </div>
      )}

      {step === 'create' && (
        <div className='flex flex-col gap-3'>
          {!busy ? (
            <>
              <div className='text-sm text-text-primary'>{readyText}</div>
              <div className='text-xs text-text-tertiary'>
                Keep this window open until it&apos;s finished. You can stop at any time; what&apos;s done stays done.
              </div>
              <div className='flex flex-wrap gap-2'>
                <Button onClick={() => void run(todo)} data-testid='carehub-bulk-start'>
                  {startLabel}
                </Button>
                <Button variant='ghost' onClick={() => setStep(plan.create > 0 ? 'passwords' : 'check')}>
                  Back
                </Button>
              </div>
            </>
          ) : (
            <>
              <div role='status' aria-live='polite' className='text-sm font-medium text-text-primary' data-testid='carehub-bulk-progress'>
                {progressText}
              </div>
              <div
                role='progressbar'
                aria-label='Progress'
                aria-valuemin={0}
                aria-valuemax={todo.length}
                aria-valuenow={finished}
                className='h-1.5 w-full overflow-hidden rounded-full bg-fill-content-hover'
              >
                <div
                  className='h-full rounded-full bg-fill-theme-thick'
                  style={{ width: `${todo.length ? Math.round((finished / todo.length) * 100) : 0}%` }}
                />
              </div>
              <div>
                <Button variant='outline' size='sm' disabled={running === 'stopping'} onClick={stop} data-testid='carehub-bulk-stop'>
                  {running === 'stopping' ? 'Stopping…' : 'Stop'}
                </Button>
              </div>
            </>
          )}
          {busy && (
            <BulkList label='Progress for each person'>
              {todo.map((row) => {
                const result = results[row.key];

                return (
                  <BulkPersonRow key={row.key} row={row}>
                    <StatusLine tone={resultTone(row, result)}>{result ? result.text : 'Waiting'}</StatusLine>
                  </BulkPersonRow>
                );
              })}
            </BulkList>
          )}
        </div>
      )}

      {step === 'done' && (
        <div className='flex flex-col gap-3'>
          <div className='text-sm font-medium text-text-primary' data-testid='carehub-bulk-summary'>
            {summary}
          </div>
          {stopped && (
            <div className='flex flex-col items-start gap-2'>
              <div className='text-sm text-text-caption'>
                {/[.!?]$/.test(stopNote) ? stopNote : `${stopNote}.`} {plural(tally.open, 'person', 'people')} not done yet.
              </div>
              <Button
                variant='outline'
                size='sm'
                onClick={() => void run(todo.filter((row) => !bulkFinished(results[row.key])))}
                data-testid='carehub-bulk-continue'
              >
                Continue with the remaining {tally.open}
              </Button>
            </div>
          )}
          <div className='flex flex-wrap gap-2'>
            <Button onClick={download} data-testid='carehub-bulk-download'>
              Download the results (CSV)
            </Button>
            {tally.passwords > 0 && (
              <Button variant='outline' aria-pressed={showPasswords} onClick={() => setShowPasswords((v) => !v)}>
                {showPasswords ? 'Hide passwords' : 'Show passwords'}
              </Button>
            )}
          </div>
          {tally.passwords > 0 && (
            <div
              role='note'
              className='rounded-[8px] border border-border-primary bg-fill-content-hover px-3 py-2 text-sm text-text-primary'
              style={{ borderLeft: '3px solid #f59e0b' }}
            >
              This file has passwords in it. Keep it safe and delete it once you&apos;ve shared them.
              <div className='mt-1 text-xs text-text-caption'>
                Care Hub doesn&apos;t keep the starting passwords: they&apos;re only here until you close this panel.
              </div>
            </div>
          )}
          <BulkList label='Results for each person'>
            {rows.map((row) => {
              const result = results[row.key];

              return (
                <BulkPersonRow key={row.key} row={row} showRow={row.action === 'skip'}>
                  <StatusLine tone={resultTone(row, result)}>{resultText(row, result)}</StatusLine>
                  {result?.password && (
                    <div className='mt-1 break-all pl-3.5 text-xs text-text-caption'>
                      Starting password:{' '}
                      <span className='font-mono text-text-primary' data-testid='carehub-bulk-password'>
                        {showPasswords ? result.password : '••••••••••••'}
                      </span>
                    </div>
                  )}
                </BulkPersonRow>
              );
            })}
          </BulkList>
          <div className='flex flex-wrap gap-2'>
            <Button variant='outline' onClick={() => requestLeave('close')}>
              Close
            </Button>
            {tally.failed + tally.warned > 0 && (
              <Button variant='ghost' loading={checking} onClick={() => requestLeave('again')} data-testid='carehub-bulk-again'>
                Check the list again
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function CareHubAccountsPanel({ myEmail }: { myEmail?: string }) {
  const workspaceId = useCurrentWorkspaceId();
  const isAdmin = useCarehubIsAdmin();
  const [accounts, setAccounts] = useState<CareHubAccount[] | null>(null);
  const [addToWorkspace, setAddToWorkspace] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [adding, setAdding] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const bulkWasOpen = useRef(false);

  const load = useCallback(async () => {
    try {
      const query = workspaceId ? `?workspace_id=${workspaceId}` : '';
      const res = await call<{ users: CareHubAccount[] }>('get', `${BASE}/users${query}`);

      setAccounts(res?.users ?? []);
    } catch (e) {
      setError(errorText(e));
      setAccounts([]);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const root = rootRef.current;

    if (!root) return;
    if (bulkOpen) {
      bulkWasOpen.current = true;
      root.scrollTop = 0;
    } else if (bulkWasOpen.current) {
      // Back from "Add many people": focus returns to the button that opened it.
      bulkWasOpen.current = false;
      root.querySelector<HTMLButtonElement>('[data-testid="carehub-accounts-bulk-open"]')?.focus();
    }
  }, [bulkOpen]);

  const closeBulk = () => {
    setBulkOpen(false);
    setError('');
    setNotice('');
    void load();
  };

  const showNotice = (msg: string) => {
    setError('');
    setNotice(msg);
    void load();
  };

  const showError = (msg: string) => {
    setNotice('');
    setError(msg);
  };

  const add = async () => {
    const trimmed = email.trim();

    if (!trimmed.includes('@')) {
      showError('Please enter a valid email address.');
      return;
    }

    const problem = carehubPasswordProblem(password);

    if (problem) {
      showError(problem);
      return;
    }

    setAdding(true);
    try {
      const joining = addToWorkspace && Boolean(workspaceId);

      await call('post', `${BASE}/users`, {
        email: trimmed,
        password,
        ...(joining ? { workspace_id: workspaceId } : {}),
      });
      setEmail('');
      setPassword('');
      showNotice(
        joining
          ? `${trimmed} can now sign in with the password you chose, and will join this workspace at first sign-in.`
          : `${trimmed} can now sign in with the password you chose.`
      );
    } catch (e) {
      showError(errorText(e));
    } finally {
      setAdding(false);
    }
  };

  if (bulkOpen) {
    return (
      <div ref={rootRef} className='flex h-full min-h-0 flex-col overflow-y-auto' data-testid='carehub-accounts-panel'>
        <div className='mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 py-6 sm:px-8 sm:py-8'>
          <CareHubBulkAdd workspaceId={workspaceId} onChanged={() => void load()} onClose={closeBulk} />
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className='flex h-full min-h-0 flex-col overflow-y-auto' data-testid='carehub-accounts-panel'>
      <div className='mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 py-6 sm:px-8 sm:py-8'>
        <div className='flex flex-col gap-1'>
          <h2 className='text-xl font-semibold text-text-primary'>User accounts</h2>
          <p className='text-sm text-text-caption'>
            Add people who can sign in to Care Hub, put them in this workspace, set a new password, or remove
            access. No emails are sent — share the password with the person yourself.
          </p>
        </div>

        <form
          className='flex flex-col gap-3 rounded-[8px] border border-border-primary p-4'
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <div className='text-sm font-medium text-text-primary'>Add an account</div>
            {isAdmin && (
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => setBulkOpen(true)}
                data-testid='carehub-accounts-bulk-open'
              >
                Add many people
              </Button>
            )}
          </div>
          <div className='text-xs text-text-tertiary'>Password: {CAREHUB_PASSWORD_RULES}</div>
          <div className='flex flex-wrap items-center gap-2'>
            <Input
              type='email'
              placeholder='Email'
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className='min-w-[220px] flex-1'
              data-testid='carehub-account-email'
            />
            <Input
              type='password'
              placeholder='Password'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className='min-w-[220px] flex-1'
              data-testid='carehub-account-password'
            />
            <Button type='submit' loading={adding} data-testid='carehub-account-add'>
              Add account
            </Button>
          </div>
          {workspaceId && (
            <label className='flex cursor-pointer items-center gap-2 text-sm text-text-caption'>
              <input
                type='checkbox'
                checked={addToWorkspace}
                onChange={(e) => setAddToWorkspace(e.target.checked)}
                className='h-4 w-4'
                style={{ accentColor: 'currentColor' }}
                data-testid='carehub-account-join'
              />
              Also add them to this workspace
            </label>
          )}
        </form>

        {error && (
          <div role='alert' className='rounded-[8px] border border-border-error-thick px-3 py-2 text-sm text-text-error'>
            {error}
          </div>
        )}
        {notice && (
          <div role='status' className='rounded-[8px] bg-fill-content-hover px-3 py-2 text-sm text-text-primary'>
            {notice}
          </div>
        )}

        <div className='flex flex-col gap-2'>
          <div className='text-sm font-medium text-text-primary'>
            Accounts{accounts ? ` (${accounts.length})` : ''}
          </div>
          <div className='rounded-[8px] border border-border-primary'>
            {accounts === null && <div className='px-4 py-6 text-sm text-text-tertiary'>Loading…</div>}
            {accounts?.length === 0 && <div className='px-4 py-6 text-sm text-text-tertiary'>No accounts found.</div>}
            {accounts?.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                workspaceId={workspaceId}
                isMe={Boolean(myEmail) && account.email?.toLowerCase() === myEmail?.toLowerCase()}
                onChanged={showNotice}
                onError={showError}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default CareHubAccountsPanel;

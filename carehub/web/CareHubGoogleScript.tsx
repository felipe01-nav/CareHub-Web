// CareHub: connect Google Calendar through a small Google Apps Script that the
// person deploys in their own Google account. For company Google accounts
// where the Google Cloud console (and so a Google sign-in app) isn't available.
import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { executeAPIRequest, getAxios } from '@/application/services/js-services/http/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { CareHubModal } from './CareHubUi';

const KEY_STORE = 'carehub-google-script-key';

const SCRIPT_TEMPLATE = `// Care Hub <-> Google Calendar bridge.
// Lets your own Care Hub read and change your Google Calendar events.
// Runs as you, inside your Google account. Keep the Web app link private.

// Care Hub made this password for you. Don't share it or the Web app link.
const CAREHUB_KEY = '__CAREHUB_KEY__';

function doGet() {
  return out_({ ok: true, app: 'carehub-google-bridge' });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return out_({ error: 'Bad request', status: 400 });
  }
  if (CAREHUB_KEY.indexOf('REPLACE-WITH') === 0 || CAREHUB_KEY.length < 16) {
    return out_({ error: 'Set CAREHUB_KEY in the script first', status: 401 });
  }
  if (req.key !== CAREHUB_KEY) return out_({ error: 'Wrong key', status: 401 });
  try {
    return out_({ ok: true, data: run_(req) });
  } catch (err) {
    return out_({ error: msg_(err), status: status_(err) });
  }
}

function run_(req) {
  switch (req.op) {
    case 'ping':
      Calendar.CalendarList.list({ maxResults: 1 });
      return { email: Session.getEffectiveUser().getEmail() };
    case 'calendars': {
      const res = Calendar.CalendarList.list({ maxResults: 100 });
      return { items: (res.items || []).map(function (c) {
        return { id: c.id, summary: c.summary, summaryOverride: c.summaryOverride, backgroundColor: c.backgroundColor,
          accessRole: c.accessRole, primary: c.primary, deleted: c.deleted };
      }) };
    }
    case 'events_all':
      return eventsAll_(req);
    case 'insert':
      return slim_(Calendar.Events.insert(req.event, req.calendar));
    case 'patch':
      return slim_(Calendar.Events.patch(req.event, req.calendar, req.id));
    case 'remove':
      try {
        Calendar.Events.remove(req.calendar, req.id);
      } catch (err) {
        const s = status_(err);
        if (s !== 404 && s !== 410) throw err;
      }
      return { deleted: true };
  }
  throw new Error('Unknown request');
}

function eventsAll_(req) {
  const results = [];
  (req.calendars || []).slice(0, 30).forEach(function (id) {
    const one = { calendar: id, items: [] };
    try {
      let token = null;
      for (let page = 0; page < 5; page++) {
        const params = Object.assign({}, req.params || {});
        if (token) params.pageToken = token;
        const res = Calendar.Events.list(id, params);
        (res.items || []).forEach(function (ev) { one.items.push(slim_(ev)); });
        token = res.nextPageToken;
        if (!token) break;
      }
    } catch (err) {
      one.error = msg_(err);
    }
    results.push(one);
  });
  return { results: results };
}

function slim_(ev) {
  return {
    id: ev.id, etag: ev.etag, status: ev.status, summary: ev.summary, description: ev.description,
    location: ev.location, start: ev.start, end: ev.end, hangoutLink: ev.hangoutLink, htmlLink: ev.htmlLink,
    attendees: (ev.attendees || []).filter(function (a) { return a.self; })
      .map(function (a) { return { self: true, responseStatus: a.responseStatus }; }),
  };
}

function msg_(err) {
  return String((err && err.message) || err);
}

function status_(err) {
  const m = msg_(err);
  if (/Not Found/i.test(m)) return 404;
  if (/Gone|deleted/i.test(m)) return 410;
  if (/Precondition/i.test(m)) return 412;
  if (/Rate Limit|quota/i.test(m)) return 429;
  if (/Forbidden|insufficient|permission/i.test(m)) return 403;
  return 400;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
`;

function call<T>(method: 'get' | 'post', url: string, data?: unknown) {
  return executeAPIRequest<T>(() => getAxios()?.request({ method, url, data }));
}

function errorText(err: unknown) {
  const msg = (err as { message?: string })?.message;

  return msg && msg.trim() ? msg : 'Something went wrong. Please try again.';
}

function newKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(32);

  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

const QUOTES = `'"\`\u2018\u2019\u201c\u201d`;

/** Accepts the password itself, the password in quotes, or the whole `const CAREHUB_KEY = '…';` line. */
export function cleanScriptKey(raw: string) {
  const s = (raw || '').trim();
  const line = s.match(new RegExp(`CAREHUB_KEY\\s*=\\s*[${QUOTES}]([^${QUOTES}]*)[${QUOTES}]`));

  if (line) return line[1].trim();
  return s.replace(new RegExp(`^[\\s${QUOTES}]+|[\\s${QUOTES};]+$`, 'g'), '').trim();
}

function savedKey() {
  try {
    return sessionStorage.getItem(KEY_STORE) || '';
  } catch {
    return '';
  }
}

export function carehubGoogleScriptText(key: string) {
  return SCRIPT_TEMPLATE.replace('__CAREHUB_KEY__', key);
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className='flex gap-2'>
      <span className='mt-[1px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-fill-content-hover text-[11px] font-semibold'>
        {n}
      </span>
      <div className='min-w-0 flex-1'>{children}</div>
    </li>
  );
}

export function GoogleScriptConnect({
  apiBase,
  onConnected,
  label,
}: {
  apiBase: string;
  onConnected: () => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(savedKey);
  const [autoKey, setAutoKey] = useState(() => !!savedKey());
  const [showKey, setShowKey] = useState(false);
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [showScript, setShowScript] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const ensureKey = () => {
    let k = cleanScriptKey(key);

    if (k.length < 16) {
      k = newKey();
      setKey(k);
      setAutoKey(true);
      try {
        sessionStorage.setItem(KEY_STORE, k);
      } catch {
        // ignore
      }
    }

    return k;
  };

  const copy = async () => {
    const text = carehubGoogleScriptText(ensureKey());

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 3000);
    } catch {
      setShowScript(true);
    }
  };

  const connect = async () => {
    if (!url.trim()) {
      setError('Paste the Web app link from Apps Script first (step 7).');
      return;
    }

    const k = cleanScriptKey(key);

    if (k.length < 16) {
      setError(
        k
          ? `The script password is only ${k.length} characters, so part of it is missing. In Apps Script, click three times on the line const CAREHUB_KEY = '…' to select the whole line, copy it (⌘C) and paste it in the Script password box above (⌘V).`
          : "Care Hub doesn't know your script's password. In Apps Script, click three times on the line const CAREHUB_KEY = '…' to select the whole line, copy it (⌘C) and paste it in the Script password box above (⌘V)."
      );
      return;
    }

    setBusy(true);
    setError('');
    try {
      await call('post', `${apiBase}/google/script`, { url: url.trim(), key: k });
      try {
        sessionStorage.removeItem(KEY_STORE);
      } catch {
        // ignore
      }

      setOpen(false);
      onConnected();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type='button'
        onClick={() => setOpen(true)}
        className='mt-1 w-full rounded-[8px] px-2 py-1.5 text-left text-sm text-text-secondary hover:bg-fill-content-hover hover:text-text-primary'
        data-testid='carehub-google-script-open'
      >
        {label || '+ Connect Google Calendar (with a Google script)'}
      </button>
      {open && (
        <CareHubModal
          title='Connect Google Calendar with a Google script'
          wide
          onClose={() => setOpen(false)}
          testId='carehub-google-script'
          footer={
            <>
              <Button variant='ghost' onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button loading={busy} disabled={busy} onClick={() => void connect()}>
                Connect
              </Button>
            </>
          }
        >
          <div className='flex flex-col gap-3 text-sm'>
            <div className='text-text-secondary'>
              This works without the Google Cloud console. You put a small script in your own Google account, Google asks
              you to allow it, and Care Hub talks to your calendar through it. Care Hub can then show, add and change
              your Google events. Keep this window open while you follow the steps.
            </div>
            <ol className='flex flex-col gap-2.5'>
              <Step n={1}>
                <div className='flex flex-wrap items-center gap-2'>
                  <Button size='sm' onClick={() => void copy()} data-testid='carehub-google-script-copy'>
                    {copied ? 'Copied!' : 'Copy the script'}
                  </Button>
                  <button type='button' className='text-xs text-text-secondary underline' onClick={() => { ensureKey(); setShowScript(!showScript); }}>
                    {showScript ? 'Hide script' : 'Show script'}
                  </button>
                </div>
                <div className='mt-1 text-xs text-text-tertiary'>
                  It already contains a new private password that Care Hub made for you.
                </div>
                {showScript && cleanScriptKey(key).length >= 16 && (
                  <textarea
                    readOnly
                    className='mt-2 h-40 w-full rounded-[8px] border border-border-primary bg-transparent p-2 font-mono text-[11px]'
                    value={carehubGoogleScriptText(cleanScriptKey(key))}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                )}
              </Step>
              <Step n={2}>
                Open{' '}
                <a className='text-text-action underline' href='https://script.google.com/home/projects/create' target='_blank' rel='noreferrer'>
                  script.google.com → New project
                </a>{' '}
                (signed in with the Google account whose calendar you want). Click the title &quot;Untitled project&quot;
                and name it <b>Care Hub Calendar</b>.
              </Step>
              <Step n={3}>
                In the code box, select everything that&apos;s there, delete it and paste the script. Click the 💾 Save
                icon.
              </Step>
              <Step n={4}>
                On the left, next to <b>Services</b>, click <b>+</b> → choose <b>Google Calendar API</b> → <b>Add</b>.
              </Step>
              <Step n={5}>
                Top right: <b>Deploy → New deployment</b>. Click the ⚙ next to &quot;Select type&quot; → <b>Web app</b>.
                Set <b>Execute as: Me</b> and <b>Who has access: Anyone</b>. Click <b>Deploy</b>.
              </Step>
              <Step n={6}>
                Click <b>Authorize access</b>, pick your account and click <b>Allow</b>. If you see &quot;Google hasn&apos;t
                verified this app&quot;, click <b>Advanced</b> → <b>Go to Care Hub Calendar</b> — it&apos;s your own
                script.
              </Step>
              <Step n={7}>
                Copy the <b>Web app URL</b> (it ends with <code>/exec</code>) and paste it here:
                <Input
                  className='mt-1.5'
                  placeholder='https://script.google.com/…/exec'
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  data-testid='carehub-google-script-url'
                />
              </Step>
            </ol>
            <div className='flex flex-col gap-1 text-xs text-text-secondary'>
              <div className='font-medium text-text-primary'>Script password</div>
              <div>
                {autoKey ? (
                  <>Filled in for you when you copied the script. Only change it if you changed CAREHUB_KEY in the script.</>
                ) : (
                  <>
                    Set the script up earlier? In Apps Script, click three times on the line{' '}
                    <code>const CAREHUB_KEY = &apos;…&apos;</code> to select the whole line, copy it (⌘C) and paste it
                    here (⌘V). Pasting the whole line is fine. New here? Click Copy the script above and this fills in by
                    itself.
                  </>
                )}
              </div>
              <div className='flex items-center gap-2'>
                <Input
                  className='flex-1 font-mono'
                  type='text'
                  name='carehub-script-key'
                  autoComplete='off'
                  spellCheck={false}
                  data-1p-ignore='true'
                  data-lpignore='true'
                  style={showKey ? undefined : ({ WebkitTextSecurity: 'disc' } as CSSProperties)}
                  value={key}
                  onChange={(e) => {
                    setKey(e.target.value);
                    setError('');
                  }}
                  placeholder='Paste the CAREHUB_KEY line here'
                  data-testid='carehub-google-script-key'
                />
                <button type='button' className='shrink-0 underline' onClick={() => setShowKey(!showKey)}>
                  {showKey ? 'Hide' : 'Show'}
                </button>
              </div>
              {key.trim() &&
                (cleanScriptKey(key).length >= 16 ? (
                  <div style={{ color: '#16a34a' }}>✓ Looks right ({cleanScriptKey(key).length} characters)</div>
                ) : (
                  <div style={{ color: '#d97706' }}>
                    Only {cleanScriptKey(key).length} characters. The password in the script is 32 characters, so copy the
                    whole line.
                  </div>
                ))}
            </div>
            <div className='text-xs text-text-tertiary'>
              If &quot;Anyone&quot; isn&apos;t offered under &quot;Who has access&quot;, your company has turned this
              off and it won&apos;t work with this account.
            </div>
            {error && <div className='rounded-[8px] bg-[#fee2e2] px-3 py-2 text-xs text-[#991b1b]'>{error}</div>}
          </div>
        </CareHubModal>
      )}
    </>
  );
}

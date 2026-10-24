// CareHub Learning: certificates. "My certificates", the printable certificate (Print → the browser's print dialog,
// where "Save as PDF" makes a file), "Verify a certificate" (check a code), and the links at the top of My learning.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { FormEvent, RefObject } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { LEARNING_PATH, learningNotLive, lErrorText, plural } from './CareHubLearningApi';
import { AssignStyle, BackLink, EmptyBox, LoadError, Loading, useLoad } from './CareHubLearningAssign';
import { aapi, CERT_NOT_FOUND, certificatePath, CERTIFICATES_PATH, cleanCode, longDate, looksLikeCode, VERIFY_PATH } from './CareHubLearningAssignApi';
import { chInputClass, ChNote, ChSection } from './CareHubUi';

import type { Certificate } from './CareHubLearningAssignApi';

// ---------------------------------------------------------------------------
// Styles: the certificate looks like paper (also in dark mode) and prints alone on one A4 landscape page
// ---------------------------------------------------------------------------

const CERT_CSS = `
.chl-cert{position:relative;margin:0 auto;width:100%;max-width:920px;aspect-ratio:297/210;background:#fffdf8;color:#1f2937;border:1px solid #e7e2d3;border-radius:6px;box-shadow:0 1px 2px rgba(0,0,0,.06),0 10px 30px rgba(0,0,0,.08);padding:18px;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif}
:root[data-dark-mode='true'] .chl-cert{border-color:#52525b;box-shadow:0 10px 30px rgba(0,0,0,.5)}
:root[data-dark-mode='true'] .chl-cert-frame{border-color:#b9a46a}
:root[data-dark-mode='true'] .chl-cert-name{border-bottom-color:#d6cfb8}
.chl-cert-frame{height:100%;border:4px double #b9a46a;border-radius:3px;padding:3% 7%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.chl-cert-brand{font-size:12px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:#6b7280}
.chl-cert-seal{margin-top:10px;font-size:34px;line-height:1}
.chl-cert-title{margin-top:8px;font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:1.15;color:#312e81}
.chl-cert-small{margin-top:16px;font-size:14px;color:#4b5563}
.chl-cert-name{margin-top:6px;max-width:100%;padding:0 20px 6px;border-bottom:1px solid #d6cfb8;font-family:Georgia,'Times New Roman',serif;font-size:32px;line-height:1.2;font-weight:600;color:#111827;overflow-wrap:anywhere}
.chl-cert-course{margin-top:6px;max-width:100%;font-size:21px;line-height:1.3;font-weight:600;color:#1f2937;overflow-wrap:anywhere}
.chl-cert-facts{margin:22px 0 0;padding:0;display:flex;flex-wrap:wrap;justify-content:center;gap:10px 40px}
.chl-cert-fact{display:flex;flex-direction:column;gap:2px;min-width:0}
.chl-cert-fact dt{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280}
.chl-cert-fact dd{margin:0;font-size:15px;font-weight:600;color:#111827}
.chl-cert-code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.06em}
.chl-cert-foot{margin-top:20px;font-size:12px;color:#6b7280}
.chl-cert-fact dd.chl-cert-expired{color:#b45309}
.chl-cert-expired{color:#b45309}
:root[data-dark-mode='true'] .chl-cert-expired{color:#fbbf24}
:root[data-dark-mode='true'] .chl-cert .chl-cert-expired{color:#b45309}
@media (max-width:640px){
.chl-cert{aspect-ratio:auto;padding:8px}
.chl-cert-frame{padding:24px 14px}
.chl-cert-seal{font-size:28px}
.chl-cert-title{font-size:24px}
.chl-cert-name{font-size:24px;padding:0 6px 4px}
.chl-cert-course{font-size:17px}
.chl-cert-facts{gap:10px 22px}
}
@media print{
@page{size:A4 landscape;margin:10mm}
html,body{background:#fff !important;height:auto !important;min-height:0 !important;overflow:visible !important}
.chl-print-hide,.chl-noprint{display:none !important}
.chl-print-path{display:block !important;position:static !important;width:auto !important;max-width:none !important;height:auto !important;min-height:0 !important;max-height:none !important;margin:0 !important;padding:0 !important;border:0 !important;overflow:visible !important;transform:none !important;box-shadow:none !important;background:transparent !important}
.chl-cert{max-width:none;width:100%;height:186mm;aspect-ratio:auto;margin:0;padding:4mm;background:#fff !important;border-color:#e7e2d3 !important;border-radius:0;box-shadow:none !important;break-inside:avoid;page-break-inside:avoid;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.chl-cert-frame{padding:8mm 18mm}
.chl-cert-brand{font-size:9pt}
.chl-cert-seal{font-size:26pt}
.chl-cert-title{font-size:30pt}
.chl-cert-small{font-size:11pt}
.chl-cert-name{font-size:28pt}
.chl-cert-course{font-size:17pt}
.chl-cert-fact dt{font-size:8pt}
.chl-cert-fact dd{font-size:12pt}
.chl-cert-foot{font-size:9pt}
}
`;

function CertStyle() {
  return <style data-carehub-learning-certificate=''>{CERT_CSS}</style>;
}

function finishedLine(c: Certificate) {
  return `Finished ${longDate(c.issued_ms)}${c.score !== null ? ` · Score ${c.score}%` : ''}`;
}

/** "Valid until 30 October 2027" / "Expired on 30 October 2027"; empty when it never runs out. */
function validityLine(c: Certificate) {
  if (c.expires_ms === null) return '';
  return `${c.expired ? 'Expired on' : 'Valid until'} ${longDate(c.expires_ms)}`;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers / no permission: the hidden-textarea way.
    const area = document.createElement('textarea');

    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;

    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }

    area.remove();
    return ok;
  }
}

// ---------------------------------------------------------------------------
// Links at the top of My learning (only when the certificates part of the server answers)
// ---------------------------------------------------------------------------

export function LearningHeaderLinks({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;

    setCount(null);
    aapi.myCertificates(workspaceId).then(
      (list) => {
        if (alive) setCount(list.length);
      },
      () => {
        if (alive) setCount(null);
      }
    );
    return () => {
      alive = false;
    };
  }, [workspaceId]);

  if (count === null) return null;

  return (
    <div className='flex flex-wrap items-center gap-2' data-testid='carehub-learning-header-links'>
      {count > 0 && (
        <Button type='button' size='sm' variant='outline' onClick={() => navigate(CERTIFICATES_PATH)} data-testid='carehub-learning-my-certificates'>
          🏅 My certificates{count > 1 ? ` (${count})` : ''}
        </Button>
      )}
      <Button type='button' size='sm' variant='ghost' onClick={() => navigate(VERIFY_PATH)} data-testid='carehub-learning-verify-link'>
        Verify a certificate
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// My certificates
// ---------------------------------------------------------------------------

function CertificateCard({ c, onOpen }: { c: Certificate; onOpen: () => void }) {
  const [copied, setCopied] = useState<'' | 'yes' | 'no'>('');

  useEffect(() => {
    if (!copied) return undefined;
    const t = window.setTimeout(() => setCopied(''), 2500);

    return () => window.clearTimeout(t);
  }, [copied]);

  return (
    <li className='flex min-w-0 flex-col gap-3 rounded-[14px] border border-border-primary p-4' data-testid='carehub-learning-certificate-card'>
      <div className='flex min-w-0 items-start gap-3'>
        <div className='text-3xl leading-none' aria-hidden='true'>
          🏅
        </div>
        <div className='min-w-0 flex-1'>
          <div className='break-words text-[15px] font-medium'>{c.title.trim() || 'Untitled course'}</div>
          <div className='mt-0.5 text-xs text-text-tertiary'>{finishedLine(c)}</div>
          {c.expires_ms !== null && (
            <div
              className={cn('mt-0.5 text-xs', c.expired ? 'chl-cert-expired font-medium' : 'text-text-tertiary')}
              data-testid='carehub-learning-certificate-validity'
            >
              {validityLine(c)}
            </div>
          )}
        </div>
      </div>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-xs text-text-tertiary'>Code</span>
        <span className='chl-cert-code text-sm font-medium'>{c.code}</span>
        <Button
          type='button'
          size='sm'
          variant='ghost'
          onClick={() => {
            copyText(c.code).then((ok) => setCopied(ok ? 'yes' : 'no'));
          }}
          aria-label={`Copy the code ${c.code}`}
        >
          {copied === 'yes' ? 'Copied ✓' : copied === 'no' ? 'Couldn’t copy' : 'Copy'}
        </Button>
        <span className='flex-1' />
        <Button type='button' size='sm' variant='outline' onClick={onOpen} data-testid='carehub-learning-certificate-open'>
          View and print
        </Button>
      </div>
      <span className='sr-only' aria-live='polite'>
        {copied === 'yes' ? 'Code copied.' : ''}
      </span>
    </li>
  );
}

export function LearningMyCertificates({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate();
  const load = useCallback(() => aapi.myCertificates(workspaceId), [workspaceId]);
  const { data, error, reload } = useLoad(load);

  return (
    <div data-testid='carehub-learning-certificates'>
      <CertStyle />
      <BackLink label='My learning' to={LEARNING_PATH} testId='carehub-learning-certificate-back' />
      <div className='mb-4 flex flex-wrap items-center gap-2'>
        <h2 className='m-0 min-w-0 flex-1 text-xl font-semibold'>My certificates</h2>
        <Button type='button' size='sm' variant='ghost' onClick={() => navigate(VERIFY_PATH)}>
          Verify a certificate
        </Button>
      </div>
      {error && !data ? (
        <LoadError error={error} onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : data.length ? (
        <ChSection title={plural(data.length, 'certificate')} hint='Open one to print it or save it as a PDF. Anyone in Care Hub can check a code under Learning → Verify.'>
          <ul className='m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2'>
            {data.map((c) => (
              <CertificateCard key={c.code} c={c} onOpen={() => navigate(certificatePath(c.code))} />
            ))}
          </ul>
        </ChSection>
      ) : (
        <EmptyBox>No certificates yet. When you finish a course that comes with a certificate, it shows up here.</EmptyBox>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The printable certificate
// ---------------------------------------------------------------------------

/** While printing, hide everything except the certificate (the path from <body> down to it stays, the rest is hidden). */
function markForPrint(sheet: HTMLElement) {
  const marked: Array<[HTMLElement, string]> = [];
  const mark = (el: Element, cls: string) => {
    if (el instanceof HTMLElement && !el.classList.contains(cls)) {
      el.classList.add(cls);
      marked.push([el, cls]);
    }
  };
  let node: HTMLElement = sheet;

  while (node !== document.body && node.parentElement) {
    const parent: HTMLElement = node.parentElement;

    Array.from(parent.children).forEach((sibling) => {
      if (sibling !== node) mark(sibling, 'chl-print-hide');
    });
    if (parent !== document.body) mark(parent, 'chl-print-path');
    node = parent;
  }

  return () => marked.forEach(([el, cls]) => el.classList.remove(cls));
}

/** Prints only the certificate — from the Print button and from the browser's own Print (Ctrl/Cmd + P). */
function usePrintOnly(ref: RefObject<HTMLElement | null>, title: string) {
  const undo = useRef<(() => void) | null>(null);
  const oldTitle = useRef('');

  const before = useCallback(() => {
    const el = ref.current;

    if (!el || undo.current) return;
    undo.current = markForPrint(el);
    oldTitle.current = document.title;
    // The title is the suggested file name in "Save as PDF".
    if (title) document.title = title;
  }, [ref, title]);

  const after = useCallback(() => {
    if (!undo.current) return;
    undo.current();
    undo.current = null;
    document.title = oldTitle.current;
  }, []);

  useEffect(() => {
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
      after();
    };
  }, [before, after]);

  return useCallback(() => {
    before();
    window.print();
  }, [before]);
}

function CertificateSheet({ c, sheetRef }: { c: Certificate; sheetRef: RefObject<HTMLDivElement | null> }) {
  const name = c.person_name.trim() || '—';
  const course = c.title.trim() || 'Untitled course';

  return (
    <div ref={sheetRef} className='chl-cert' role='group' aria-label={`Certificate for ${name}: ${course}`} data-testid='carehub-learning-certificate-sheet'>
      <div className='chl-cert-frame'>
        <div className='chl-cert-brand'>Care Hub Learning</div>
        <div className='chl-cert-seal' aria-hidden='true'>
          🏅
        </div>
        <div className='chl-cert-title'>Certificate of completion</div>
        <div className='chl-cert-small'>This certifies that</div>
        <div className='chl-cert-name'>{name}</div>
        <div className='chl-cert-small'>has completed</div>
        <div className='chl-cert-course'>{course}</div>
        <dl className='chl-cert-facts'>
          <div className='chl-cert-fact'>
            <dt>Date</dt>
            <dd>{longDate(c.issued_ms)}</dd>
          </div>
          {c.score !== null && (
            <div className='chl-cert-fact'>
              <dt>Score</dt>
              <dd>{c.score}%</dd>
            </div>
          )}
          {c.expires_ms !== null && (
            <div className='chl-cert-fact'>
              <dt>{c.expired ? 'Expired on' : 'Valid until'}</dt>
              <dd className={c.expired ? 'chl-cert-expired' : undefined}>{longDate(c.expires_ms)}</dd>
            </div>
          )}
          <div className='chl-cert-fact'>
            <dt>Certificate code</dt>
            <dd className='chl-cert-code'>{c.code}</dd>
          </div>
        </dl>
        <div className='chl-cert-foot'>Check this code in Care Hub → Learning → Verify</div>
      </div>
    </div>
  );
}

export function LearningCertificate({ workspaceId }: { workspaceId: string }) {
  const { code = '' } = useParams();
  const location = useLocation();
  const fromVerify = (location.state as { from?: unknown } | null)?.from === 'verify';
  // `false` = not a code at all (no need to ask the server).
  const load = useCallback(
    (): Promise<Certificate | false> => (looksLikeCode(code) ? aapi.certificate(workspaceId, code) : Promise.resolve(false)),
    [workspaceId, code]
  );
  const { data, error, reload } = useLoad(load);
  const sheet = useRef<HTMLDivElement>(null);
  const fileName = data ? `Certificate - ${data.title.trim() || 'Course'} - ${data.person_name.trim() || 'Care Hub'}` : '';
  const print = usePrintOnly(sheet, fileName);
  const back = fromVerify ? (
    <BackLink label='Verify a certificate' to={`${VERIFY_PATH}?code=${encodeURIComponent(cleanCode(code))}`} testId='carehub-learning-certificate-back' />
  ) : (
    <BackLink label='My certificates' to={CERTIFICATES_PATH} testId='carehub-learning-certificate-back' />
  );

  if (error && !data) {
    return (
      <div data-testid='carehub-learning-certificate'>
        {back}
        <LoadError error={error} onRetry={reload} />
      </div>
    );
  }

  if (data === false) {
    return (
      <div data-testid='carehub-learning-certificate'>
        {back}
        <ChNote tone='error'>{CERT_NOT_FOUND}</ChNote>
      </div>
    );
  }

  if (!data) return <Loading />;

  return (
    <div data-testid='carehub-learning-certificate'>
      <CertStyle />
      <div className='chl-noprint mb-4 flex flex-wrap items-center gap-2'>
        <div className='min-w-0 flex-1'>{back}</div>
        <Button type='button' onClick={print} data-testid='carehub-learning-certificate-print'>
          🖨️ Print or save as PDF
        </Button>
      </div>
      <CertificateSheet c={data} sheetRef={sheet} />
      <p className='chl-noprint mt-3 text-center text-xs text-text-tertiary'>
        In the print window, pick your printer, or “Save as PDF” to keep a copy. It fits on one landscape page.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Verify a certificate
// ---------------------------------------------------------------------------

const BAD_CODE = 'Enter the code exactly as it’s printed on the certificate, for example ABCD-EFGH-JKMN.';
const INPUT_ID = 'chl-verify-code';

function codeFromSearch(search: string) {
  try {
    return (new URLSearchParams(search).get('code') || '').trim().slice(0, 40);
  } catch {
    return '';
  }
}

function VerifiedBox({ c, onOpen }: { c: Certificate; onOpen: () => void }) {
  return (
    <div className={cn(c.expired ? 'chl-box-warning' : 'chl-box-success', 'rounded-[12px] p-4')} data-testid='carehub-learning-verify-ok'>
      <div className='flex items-center gap-2 text-[15px] font-semibold'>
        <span className={c.expired ? undefined : 'chl-mark-right'} aria-hidden='true'>
          {c.expired ? '⚠' : '✓'}
        </span>
        {c.expired ? 'This certificate is real, but it has expired' : 'This certificate is valid'}
      </div>
      <dl className='m-0 mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm'>
        <dt className='text-text-tertiary'>Name</dt>
        <dd className='m-0 break-words font-medium'>{c.person_name.trim() || '—'}</dd>
        <dt className='text-text-tertiary'>Course</dt>
        <dd className='m-0 break-words font-medium'>{c.title.trim() || 'Untitled course'}</dd>
        <dt className='text-text-tertiary'>Finished</dt>
        <dd className='m-0'>{longDate(c.issued_ms)}</dd>
        {c.expires_ms !== null && (
          <>
            <dt className='text-text-tertiary'>{c.expired ? 'Expired on' : 'Valid until'}</dt>
            <dd className={cn('m-0', c.expired && 'font-medium')}>{longDate(c.expires_ms)}</dd>
          </>
        )}
        {c.score !== null && (
          <>
            <dt className='text-text-tertiary'>Score</dt>
            <dd className='m-0'>{c.score}%</dd>
          </>
        )}
        <dt className='text-text-tertiary'>Code</dt>
        <dd className='chl-cert-code m-0'>{c.code}</dd>
      </dl>
      <div className='mt-3'>
        <Button type='button' size='sm' variant='outline' onClick={onOpen}>
          View certificate
        </Button>
      </div>
    </div>
  );
}

export function LearningVerify({ workspaceId }: { workspaceId: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const search = location.search || (typeof window !== 'undefined' ? window.location.search : '');
  const initial = useMemo(() => codeFromSearch(search), [search]);
  const [value, setValue] = useState(initial);
  const [problem, setProblem] = useState('');
  const [result, setResult] = useState<{ code: string; cert: Certificate | null; error: unknown; busy: boolean } | null>(null);
  const seq = useRef(0);

  const check = useCallback(
    (raw: string) => {
      if (!looksLikeCode(raw)) {
        seq.current += 1;
        setResult(null);
        setProblem(BAD_CODE);
        return;
      }

      const code = cleanCode(raw);
      const n = ++seq.current;

      setProblem('');
      setResult({ code, cert: null, error: null, busy: true });
      aapi.certificate(workspaceId, code).then(
        (cert) => {
          if (seq.current === n) setResult({ code, cert, error: null, busy: false });
        },
        (e: unknown) => {
          if (seq.current === n) setResult({ code, cert: null, error: e || new Error(CERT_NOT_FOUND), busy: false });
        }
      );
    },
    [workspaceId]
  );

  // A link with ?code=… checks straight away.
  useEffect(() => {
    if (initial) {
      setValue(initial);
      check(initial);
    }
  }, [initial, check]);

  useEffect(
    () => () => {
      // Ignore answers that arrive after leaving the page.
      seq.current += 1;
    },
    []
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    check(value);
  };
  const busy = Boolean(result?.busy);

  return (
    <div className='max-w-[640px]' data-testid='carehub-learning-verify'>
      <AssignStyle />
      <CertStyle />
      <BackLink label='My learning' to={LEARNING_PATH} testId='carehub-learning-verify-back' />
      <h2 className='m-0 text-xl font-semibold'>Verify a certificate</h2>
      <p className='mb-4 mt-1 text-sm text-text-secondary'>Type the code from a Care Hub certificate to check that it’s real and who it belongs to.</p>
      <form onSubmit={submit} className='flex flex-col gap-2 sm:flex-row sm:items-end' noValidate>
        <div className='min-w-0 flex-1'>
          <label htmlFor={INPUT_ID} className='mb-1 block text-sm font-medium'>
            Certificate code
          </label>
          <input
            id={INPUT_ID}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setProblem('');
            }}
            placeholder='ABCD-EFGH-JKMN'
            autoComplete='off'
            autoCapitalize='characters'
            spellCheck={false}
            maxLength={40}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${INPUT_ID}-problem` : undefined}
            className={cn(chInputClass, 'chl-cert-code w-full uppercase')}
            data-testid='carehub-learning-verify-input'
          />
        </div>
        <Button type='submit' disabled={busy} data-testid='carehub-learning-verify-check'>
          {busy ? 'Checking…' : 'Check code'}
        </Button>
      </form>
      {problem && (
        <div id={`${INPUT_ID}-problem`} className='chl-alert mt-2 text-xs'>
          {problem}
        </div>
      )}
      <div className='mt-4' aria-live='polite' data-testid='carehub-learning-verify-result'>
        {result && !result.busy && result.cert && (
          <VerifiedBox c={result.cert} onOpen={() => navigate(certificatePath(result.code), { state: { from: 'verify' } })} />
        )}
        {result && !result.busy && !result.cert && (
          <ChNote tone={learningNotLive(result.error) ? 'info' : 'error'}>{lErrorText(result.error)}</ChNote>
        )}
      </div>
    </div>
  );
}

// CareHub Learning Studio: "Import from a spreadsheet" — quiz questions from a CSV file or rows pasted from Excel or
// Google Sheets (tab-separated). The first row names the columns (any order, any case): Question, Type, Answer 1 …
// Answer 6, Correct, Explanation, Points. Every row is checked first and shows as ready or with a plain reason; only
// the ready rows are added, as normal questions with new ids. The file is read in the browser with the people-import
// CSV reader from CareHubAccounts (no new reader, nothing sent anywhere until the course or bank saves).
import { useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { carehubDecodeCsv, parseCsv } from './CareHubAccounts';
import { blankQuestion, newId, plural, questionChecks } from './CareHubLearningApi';
import { Chip } from './CareHubLearningBlocks';
import { INTERACT_KIND_OPTIONS } from './CareHubLearningInteract';
import { downloadCsv } from './CareHubLearningReports';
import { CareHubModal, chInputClass, ChNote } from './CareHubUi';

import type { Question } from './CareHubLearningApi';

export const IMPORT_ROWS_MAX = 200;
const IMPORT_FILE_MAX = 1024 * 1024;
/** The question editor allows up to 10 answers. */
const ANSWERS_MAX = 10;
const POINTS_MAX = 100;

type ImportKind = 'single' | 'multiple' | 'true_false';

const KIND_LABEL: Record<ImportKind, string> = { single: 'One answer', multiple: 'Several answers', true_false: 'True or false' };

/** What people may write in the Type column (lower case, letters and digits only). Blank = One answer. */
const KIND_WORDS = new Map<string, ImportKind>([
  ...['', 'oneanswer', 'onerightanswer', 'one', 'single', 'singleanswer', 'singlechoice', 'multiplechoice'].map((w) => [w, 'single'] as const),
  ...['severalanswers', 'severalrightanswers', 'several', 'multiple', 'multipleanswers', 'multipleresponse', 'multipleselect', 'checkboxes'].map(
    (w) => [w, 'multiple'] as const
  ),
  ...['trueorfalse', 'truefalse', 'tf'].map((w) => [w, 'true_false'] as const),
]);

/** Question types the Studio has but this import doesn't make yet (matching, fill in the blank …), by any of their names. */
const NOT_YET = new Map<string, string>([
  ['match', 'Matching'],
  ...[{ value: 'matching', label: 'Matching' }, ...INTERACT_KIND_OPTIONS].flatMap((o) => [
    [wordKey(o.value), o.label] as const,
    [wordKey(o.label), o.label] as const,
  ]),
]);

const SPREADSHEET_HELP =
  'That looks like a spreadsheet file, not a CSV. In Excel or Google Sheets, choose File → Save as (or Download) → CSV and pick that file — or copy the rows and paste them below.';

const EXAMPLE_HEADER = ['Question', 'Type', 'Answer 1', 'Answer 2', 'Answer 3', 'Answer 4', 'Correct', 'Explanation', 'Points'];
const EXAMPLE_ROWS = [
  [
    'A customer asks for a refund. What do you ask for first?',
    'One answer',
    'The receipt',
    'Their home address',
    'A manager’s signature',
    '',
    '1',
    'The receipt shows what they paid and how they paid.',
    '1',
  ],
  ['Which of these go in the till before opening?', 'Several answers', 'The float', 'The staff rota', 'Receipt paper', 'A spare apron', '1, 3', '', '2'],
  ['Sourdough loaves are baked fresh every morning.', 'True or false', '', '', '', '', 'True', 'Baking starts at 5am.', ''],
  ['Where do you write down a broken oven?', '', 'In the repairs book', 'On a sticky note', 'Nowhere', '', 'In the repairs book', 'Leave Type blank for One answer.', ''],
];

export interface ImportRow {
  /** Row in the spreadsheet (1 = the column names), so people can find it. */
  row: number;
  prompt: string;
  /** The question to add (new ids), or null with `problem`. */
  question: Question | null;
  /** "Row 4: say which answer is right." ('' = ready). */
  problem: string;
}

export interface ImportRead {
  rows: ImportRow[];
  ready: Question[];
  /** A problem with the whole text ('' = fine). */
  error: string;
  /** Column names that aren't used. */
  unused: string[];
  /** Rows after the first IMPORT_ROWS_MAX, left out. */
  cut: number;
}

function wordKey(cell: string) {
  return cell.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Our own CSV downloads put an apostrophe before text a spreadsheet could take for a formula: take it off again. */
function cellText(cell: string) {
  const t = cell.trim();

  return /^'[=+\-@]/.test(t) ? t.slice(1) : t;
}

/** Comma, semicolon (Excel in some countries) or tab (rows pasted from a spreadsheet), from the first line. */
function delimiterOf(text: string) {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;

  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (ch === '\n' || ch === '\r') {
      if (counts[','] + counts[';'] + counts['\t'] > 0) break;
    } else if (ch in counts) counts[ch] += 1;
  }

  if (counts['\t'] > 0) return '\t';
  return counts[';'] > 0 && counts[';'] >= counts[','] ? ';' : ',';
}

function columnOf(key: string): string {
  if (['question', 'questions', 'prompt', 'questiontext'].includes(key)) return 'question';
  if (['type', 'kind', 'questiontype'].includes(key)) return 'type';
  if (['correct', 'correctanswer', 'correctanswers', 'rightanswer', 'rightanswers', 'answerkey'].includes(key)) return 'correct';
  if (['explanation', 'explain'].includes(key)) return 'explanation';
  if (['points', 'point', 'score', 'marks'].includes(key)) return 'points';
  const m = /^(?:answer|option|choice)(\d{1,2})$/.exec(key);

  return m && Number(m[1]) >= 1 && Number(m[1]) <= ANSWERS_MAX ? `answer${Number(m[1])}` : '';
}

const sameText = (a: string, b: string) => a.toLowerCase().replace(/\s+/g, ' ') === b.toLowerCase().replace(/\s+/g, ' ');

/** The Correct column for One answer / Several answers: answer numbers ("2", "1, 3"), letters ("B") or the answer's words. */
function rightAnswers(said: string, answers: { n: number; text: string }[]): Set<number> | string {
  const parts = said
    .replace(/\b(?:answers?|options?|choices?|and)\b|[#.,;&+/]/gi, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const pick = (numbers: number[]) => {
    const missing = numbers.find((n) => !answers.some((a) => a.n === n));

    if (missing === undefined) return new Set(numbers);
    return missing >= 1 && missing <= ANSWERS_MAX ? `answer ${missing} is empty.` : `there’s no answer ${missing}.`;
  };

  if (parts.length && parts.every((p) => /^\d{1,3}$/.test(p))) return pick(parts.map(Number));
  const whole = answers.find((a) => sameText(a.text, said));

  if (whole) return new Set([whole.n]);
  if (parts.length && parts.every((p) => /^[a-j]$/i.test(p))) return pick(parts.map((p) => p.toLowerCase().charCodeAt(0) - 96));
  const pieces = said.split(/\s*[;,]\s*/).filter(Boolean);
  const found = pieces.map((p) => answers.find((a) => sameText(a.text, p)));

  if (pieces.length > 1 && found.every(Boolean)) return new Set(found.map((a) => (a as { n: number }).n));
  return `the Correct column says “${said}”. Write the number of the right answer, like 2 (or 1, 3 for several).`;
}

/** True or false: "True" / "False" (also T/F, Yes/No), or the number of the answer column that says it. */
function truthOf(said: string, answerAt: (n: number) => string): boolean | null {
  const k = wordKey(said);

  if (['true', 't', 'yes', 'y'].includes(k)) return true;
  if (['false', 'f', 'no', 'n'].includes(k)) return false;
  if (k === '1' || k === '2') {
    const named = truthOf(answerAt(Number(k)), () => '');

    return named === null ? k === '1' : named;
  }

  return null;
}

function readRow(cells: string[], row: number, col: Map<string, number>): ImportRow {
  const get = (name: string) => {
    const i = col.get(name);

    return i === undefined ? '' : cells[i] || '';
  };
  const prompt = get('question');
  const fail = (why: string): ImportRow => ({ row, prompt, question: null, problem: `Row ${row}: ${why}` });

  if (!prompt) return fail('the question is empty.');
  const typeText = get('type');
  const kind = KIND_WORDS.get(wordKey(typeText));

  if (!kind) {
    const later = NOT_YET.get(wordKey(typeText));

    return fail(later ? `${later} questions can’t be imported yet.` : `the type “${typeText}” isn’t one we know. Use One answer, Several answers or True or false.`);
  }

  const answers: { n: number; text: string }[] = [];

  for (let n = 1; n <= ANSWERS_MAX; n += 1) {
    const text = get(`answer${n}`);

    if (text) answers.push({ n, text });
  }

  if (kind !== 'true_false' && answers.length < 2) return fail('add at least two answers.');
  const said = get('correct');

  if (!said) return fail('say which answer is right.');
  let q: Question;

  if (kind === 'true_false') {
    const truth = truthOf(said, (n) => get(`answer${n}`));

    if (truth === null) return fail('write True or False in the Correct column.');
    const base = blankQuestion('true_false');

    q = { ...base, options: base.options.map((o, i) => ({ ...o, correct: i === 0 ? truth : !truth })) };
  } else {
    const right = rightAnswers(said, answers);

    if (typeof right === 'string') return fail(right);
    if (kind === 'single' && right.size > 1) return fail('a One answer question has one right answer. For more, write Several answers in the Type column.');
    q = { ...blankQuestion(kind), options: answers.map((a) => ({ id: newId('o'), text: a.text, correct: right.has(a.n) })) };
  }

  const pointsText = get('points');
  const points = pointsText ? Number(pointsText) : 1;

  if (!/^\d+$/.test(pointsText || '1') || points < 1 || points > POINTS_MAX) return fail('points must be a whole number from 1 to 100.');
  q = { ...q, prompt, explanation: get('explanation'), points };
  // Anything the publish checks would still find (nothing should be left by now).
  const left = questionChecks(q, `Row ${row}`);

  return left.length ? { row, prompt, question: null, problem: left[0] } : { row, prompt, question: q, problem: '' };
}

/** Reads CSV text or rows pasted from a spreadsheet. Blank rows are skipped; row numbers match the spreadsheet. */
export function readQuestionRows(input: string): ImportRead {
  const none: ImportRead = { rows: [], ready: [], error: '', unused: [], cut: 0 };
  let text = input.replace(/^\uFEFF/, '');
  // Excel's "sep=;" first line names the separator.
  const sep = /^sep=(.)[^\S\r\n]*(\r\n|\n|\r|$)/i.exec(text);
  const offset = sep ? 1 : 0;

  if (sep) text = text.slice(sep[0].length);
  if (!text.trim()) return none;
  const { rows, openQuoteRow } = parseCsv(text, sep ? sep[1] : delimiterOf(text));

  if (openQuoteRow) return { ...none, error: `Row ${openQuoteRow + offset} has a quote mark (") that’s never closed. Please check that row.` };
  const cells = rows.map((r) => r.map(cellText));
  const head = cells.findIndex((r) => r.some(Boolean));

  if (head < 0) return none;
  const col = new Map<string, number>();
  const unused: string[] = [];

  cells[head].forEach((name, i) => {
    const c = name ? columnOf(wordKey(name)) : '';

    if (!c) {
      if (name) unused.push(name);
    } else if (!col.has(c)) col.set(c, i);
  });
  if (!col.has('question')) {
    return {
      ...none,
      error: 'The first row needs the column names: at least Question, Answer 1, Answer 2 and Correct. Download the example file to see how.',
    };
  }

  const out: ImportRow[] = [];
  let cut = 0;

  for (let i = head + 1; i < cells.length; i += 1) {
    if (!cells[i].some(Boolean)) continue;
    if (out.length >= IMPORT_ROWS_MAX) cut += 1;
    else out.push(readRow(cells[i], i + 1 + offset, col));
  }

  return { rows: out, ready: out.flatMap((r) => (r.question ? [r.question] : [])), error: '', unused, cut };
}

function rowSummary(q: Question) {
  const right = q.options.filter((o) => o.correct).map((o) => o.text);
  const kind = KIND_LABEL[q.kind as ImportKind] || '';

  return [kind, `${right.length > 1 ? 'Right answers' : 'Right answer'}: ${right.join(', ')}`, q.points !== 1 ? plural(q.points, 'point') : '']
    .filter(Boolean)
    .join(' · ');
}

/**
 * The import window. `room`: how many questions still fit (a question bank holds 200); only that many ready rows are
 * added. `onAdd` gets the ready questions; the caller adds them as one change and closes the window.
 */
export function ImportQuestionsDialog({ room = IMPORT_ROWS_MAX, onAdd, onClose }: { room?: number; onAdd: (qs: Question[]) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const read = useMemo(() => readQuestionRows(text), [text]);
  const fit = Math.max(0, room);
  const adding = read.ready.slice(0, fit);
  const toFix = read.rows.length - read.ready.length;
  const status = !text.trim() || read.error ? '' : !read.rows.length ? 'No questions found yet.' : [`${plural(read.ready.length, 'question')} ready`, toFix ? `${plural(toFix, 'row')} to fix` : ''].filter(Boolean).join(' · ');

  const readFile = async (file?: File) => {
    if (!file) return;
    setFileError('');
    if (/\.(xlsx|xlsm|xlsb|xls|numbers|ods)$/i.test(file.name)) {
      setFileError(SPREADSHEET_HELP);
      return;
    }

    if (file.size > IMPORT_FILE_MAX) {
      setFileError('That file is too big. Import up to 200 questions at a time, in a CSV file under 1 MB.');
      return;
    }

    try {
      const decoded = carehubDecodeCsv(await file.arrayBuffer());

      if (decoded === null) {
        setFileError(SPREADSHEET_HELP);
        return;
      }

      setText(decoded.replace(/^\uFEFF/, ''));
      setFileName(file.name);
    } catch {
      setFileError('That file couldn’t be read. Please try again.');
    }
  };

  return (
    <CareHubModal
      title='Import questions'
      wide
      testId='chl-import-dialog'
      onClose={onClose}
      footer={
        <>
          <Button type='button' variant='ghost' onClick={onClose}>
            Cancel
          </Button>
          <Button type='button' disabled={!adding.length} onClick={() => adding.length && onAdd(adding)}>
            {adding.length ? `Add ${plural(adding.length, 'question')}` : 'Add questions'}
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-3'>
        <div id='chl-import-hint' className='flex flex-col gap-1.5 text-sm text-text-secondary'>
          <p>
            Put one question on each row. The first row names the columns, in any order: Question, Type, Answer 1, Answer 2 and so on (up to 10),
            Correct, Explanation and Points.
          </p>
          <ul className='flex list-disc flex-col gap-0.5 pl-5 text-xs'>
            <li>Type: One answer (or leave it blank), Several answers, or True or false.</li>
            <li>Correct: the number of the right answer, like 2 — or 1, 3 for several. For True or false, write True or False.</li>
            <li>Points: leave blank for 1 point.</li>
          </ul>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <input
            ref={fileRef}
            type='file'
            accept='.csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values'
            className='sr-only'
            tabIndex={-1}
            aria-hidden='true'
            data-testid='chl-import-file'
            onChange={(e) => {
              void readFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <Button type='button' variant='outline' size='sm' onClick={() => fileRef.current?.click()}>
            Choose a CSV file
          </Button>
          <Button type='button' variant='ghost' size='sm' onClick={() => downloadCsv('quiz-questions-example', EXAMPLE_HEADER, EXAMPLE_ROWS)}>
            Download an example file
          </Button>
          {fileName && <span className='min-w-0 truncate text-xs text-text-tertiary'>From {fileName}</span>}
        </div>
        {fileError && <ChNote tone='error'>{fileError}</ChNote>}
        <div className='flex flex-col gap-1'>
          <label htmlFor='chl-import-text' className='text-sm font-medium'>
            Or paste rows copied from Excel or Google Sheets
          </label>
          <textarea
            id='chl-import-text'
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setFileName('');
            }}
            aria-describedby='chl-import-hint'
            placeholder='Copy the column names and the rows below them, then paste here.'
            spellCheck={false}
            wrap='off'
            className={cn(chInputClass, 'h-[140px] w-full resize-y font-mono text-xs leading-relaxed')}
          />
        </div>
        <div className='flex flex-wrap items-baseline justify-between gap-2'>
          <div id='chl-import-preview' className='text-sm font-medium'>
            Preview
          </div>
          <div role='status' aria-live='polite' className='text-xs text-text-secondary'>
            {status}
          </div>
        </div>
        {read.error && <ChNote tone='error'>{read.error}</ChNote>}
        {read.cut > 0 && <ChNote tone='warn'>Only the first 200 rows are read. Import the other {plural(read.cut, 'row')} in another go.</ChNote>}
        {read.ready.length > fit && (
          <ChNote tone='warn'>
            {fit
              ? `There’s room for ${plural(fit, 'more question')}, so only the first ${fit} ready rows will be added.`
              : 'There’s no room for more questions.'}
          </ChNote>
        )}
        {read.unused.length > 0 && <ChNote>{read.unused.length === 1 ? 'This column isn’t used' : 'These columns aren’t used'}: {read.unused.join(', ')}.</ChNote>}
        <div
          role='region'
          aria-labelledby='chl-import-preview'
          tabIndex={0}
          className='max-h-[40vh] min-h-[80px] overflow-y-auto rounded-[10px] border border-border-primary px-3 py-1'
        >
          {!read.rows.length ? (
            <p className='py-2 text-sm text-text-tertiary'>Each row will show here, ready to add or with what to fix.</p>
          ) : (
            <ul className='flex flex-col divide-y divide-border-primary' data-testid='chl-import-rows'>
              {read.rows.map((r) => (
                <li key={r.row} className='flex items-start gap-2 py-2'>
                  <span className='mt-0.5 shrink-0'>
                    <Chip tone={r.question ? 'green' : 'red'}>{r.question ? 'Ready' : 'To fix'}</Chip>
                  </span>
                  <div className='min-w-0 flex-1'>
                    {r.question ? (
                      <>
                        <div className='break-words text-sm text-text-primary'>{r.prompt}</div>
                        <div className='break-words text-xs text-text-tertiary'>
                          Row {r.row} · {rowSummary(r.question)}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className='break-words text-sm text-text-error'>{r.problem}</div>
                        {r.prompt && <div className='truncate text-xs text-text-tertiary'>{r.prompt}</div>}
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </CareHubModal>
  );
}

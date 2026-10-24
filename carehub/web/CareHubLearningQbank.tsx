// CareHub Learning: surveys (a lesson block), feedback for each answer, shared question banks (with the quiz's
// "take questions from a bank" rows) and drag-and-drop matching. Everything for them lives here; the other Learning
// files only call in. Shapes and words follow P4-QBANK and the server (CareHub-Cloud `carehub_learning_bank.rs`).
//
// Only types come from the other Learning files: they import this file, so runtime imports would make a cycle.
// The Studio's question editor, rich text and error helpers are passed in as props instead.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { ComponentType, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { chCall, CH_API, chErrorText, formatWhen, UUID_RE } from './CareHubCore';
import { CareHubModal, chInputClass, ChNote, ChSection, ChSelect } from './CareHubUi';

import type { Content, Question, QuestionKind } from './CareHubLearningApi';

// ---------------------------------------------------------------------------
// Types and limits
// ---------------------------------------------------------------------------

export type SurveyKind = 'rating' | 'choice' | 'text';

export interface SurveyOption {
  id: string;
  text: string;
}

export interface SurveyQuestion {
  id: string;
  kind: SurveyKind;
  prompt: string;
  /** choice: one pick from 2–10. */
  options: SurveyOption[];
  /** rating: 5 = stars, 10 = 1–10. */
  scale: 5 | 10;
}

export interface SurveyBlock {
  id: string;
  type: 'survey';
  title: string;
  anonymous: boolean;
  questions: SurveyQuestion[];
}

/** question id → 1..scale (rating), option id (choice) or text. */
export type SurveyAnswers = Record<string, number | string>;

export interface SavedSurvey {
  answers: SurveyAnswers;
  updated_ms: number;
}

/** A quiz row "take {count} questions from this bank" (the title is kept for messages). */
export interface QuizDraw {
  bank_id: string;
  count: number;
  title?: string;
}

/** POST /quiz results: the picked answers' feedback (only when right answers are shown). */
export interface OptionFeedback {
  option_id: string;
  text: string;
}

export const SURVEY_INFO = { emoji: '📊', label: 'Survey', hint: 'Ratings, choices or comments — never graded' };

export const OPTION_FEEDBACK_MAX = 300;
const SURVEY_TITLE_MAX = 120;
const SURVEY_QUESTIONS_MAX = 10;
const SURVEY_PROMPT_MAX = 300;
const SURVEY_CHOICE_MAX = 200;
const SURVEY_CHOICES_MAX = 10;
const SURVEY_TEXT_MAX = 1000;
const BANK_TITLE_MAX = 80;
const BANK_DESCRIPTION_MAX = 500;
const BANK_QUESTIONS_MAX = 200;
const BANK_BYTES_MAX = 1024 * 1024;
const DRAWS_MAX = 10;
const DRAW_COUNT_MAX = 200;
const FEEDBACK_KINDS = ['single', 'multiple', 'true_false'];

const BANK_GONE_TEXT = 'The quiz uses a question bank that has been deleted. Remove it in the quiz settings.';
const DRAWS_MANY_TEXT = 'The quiz can take questions from up to 10 question banks.';
const BANK_BIG_TEXT = 'This question bank is too big to save (over 1 MB). Use links for big pictures.';
const BANK_NAME_TEXT = 'Give the question bank a name.';
const BANK_LINK_TEXT = 'That question bank link doesn’t look right.';
const STALE_RE = /someone else saved this question bank/i;

// ---------------------------------------------------------------------------
// Small helpers (defensive parsing, like the Api file's)
// ---------------------------------------------------------------------------

function str(v: unknown, d = '') {
  return typeof v === 'string' ? v : d;
}

function num(v: unknown, d = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function chars(s: string) {
  return [...s].length;
}

function count(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Same form as the Api file's newId: `{prefix}_` + 8 letters or digits. */
function qid(prefix: string) {
  const bytes = new Uint8Array(8);

  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }

  let s = '';

  for (let i = 0; i < bytes.length; i++) s += ID_CHARS[bytes[i] % ID_CHARS.length];
  return `${prefix}_${s}`;
}

/** Text for live regions and labels: the tiny markdown taken out. */
function plain(s: string) {
  return s
    .replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, '$1')
    .replace(/\*\*([^*\n]+?)\*\*/g, '$1')
    .replace(/\*([^*\n]+?)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function badIds(ids: string[]) {
  const seen = new Set<string>();

  for (const raw of ids) {
    const id = raw.trim();

    if (!id || seen.has(id)) return true;
    seen.add(id);
  }

  return false;
}

/** Shows text (the Learning files pass their rich text). */
export type TextView = ComponentType<{ text: string }>;

const PlainText: TextView = ({ text }) => <span className='whitespace-pre-wrap break-words'>{text}</span>;

// ---------------------------------------------------------------------------
// Surveys: content
// ---------------------------------------------------------------------------

function surveyKind(v: unknown): SurveyKind {
  return v === 'rating' || v === 'choice' || v === 'text' ? v : 'text';
}

export function normalizeSurveyBlock(raw: unknown, id: string): SurveyBlock {
  const o = obj(raw);

  return {
    id,
    type: 'survey',
    title: str(o.title),
    anonymous: o.anonymous === true,
    questions: arr(o.questions).map((x) => {
      const q = obj(x);

      return {
        id: str(q.id) || qid('sq'),
        kind: surveyKind(q.kind),
        prompt: str(q.prompt),
        options: arr(q.options).map((y) => {
          const p = obj(y);

          return { id: str(p.id) || qid('so'), text: str(p.text) };
        }),
        scale: q.scale === 10 ? 10 : 5,
      };
    }),
  };
}

function blankSurveyQuestion(kind: SurveyKind): SurveyQuestion {
  return {
    id: qid('sq'),
    kind,
    prompt: '',
    options: kind === 'choice' ? [{ id: qid('so'), text: '' }, { id: qid('so'), text: '' }] : [],
    scale: 5,
  };
}

export function blankSurveyBlock(id: string): SurveyBlock {
  return { id, type: 'survey', title: '', anonymous: false, questions: [blankSurveyQuestion('rating')] };
}

/** New ids for the questions and choices of a copied survey (the block id is set by the caller). */
export function cloneSurvey(b: SurveyBlock): SurveyBlock {
  return {
    ...b,
    questions: b.questions.map((q) => ({ ...q, id: qid('sq'), options: q.options.map((o) => ({ ...o, id: qid('so') })) })),
  };
}

/** The server's publish checks for a survey; `at` = `block 2 of Lesson 1 ("Welcome")`. */
export function surveyProblems(b: SurveyBlock, at: string, out: string[]) {
  const who = `The survey in ${at}`;
  const once = (s: string) => {
    if (!out.includes(s)) out.push(s);
  };

  if (chars(b.title) > SURVEY_TITLE_MAX) out.push(`${who} has a title that is too long (120 characters at most).`);
  if (!b.questions.length) out.push(`${who} needs at least one question.`);
  else if (b.questions.length > SURVEY_QUESTIONS_MAX) out.push(`${who} can have at most 10 questions.`);
  let broken = badIds(b.questions.map((q) => q.id));

  for (const q of b.questions) {
    if (!q.prompt.trim()) once(`${who} has an empty question.`);
    else if (chars(q.prompt) > SURVEY_PROMPT_MAX) once(`${who} has a question that is too long (300 characters at most).`);
    if (q.kind !== 'choice') continue;
    if (q.options.length < 2 || q.options.length > SURVEY_CHOICES_MAX) once(`${who} has a choice question that needs two to ten choices.`);
    if (q.options.some((o) => !o.text.trim())) once(`${who} has an empty choice.`);
    if (q.options.some((o) => chars(o.text) > SURVEY_CHOICE_MAX)) once(`${who} has a choice that is too long (200 characters at most).`);
    if (badIds(q.options.map((o) => o.id))) broken = true;
  }

  if (broken) out.push(`${who} has questions or choices with missing or repeated ids. Try deleting and re-adding them.`);
}

/** Rough time to answer, in seconds (for the course estimate). */
export function surveySeconds(b: SurveyBlock) {
  return 10 + b.questions.reduce((n, q) => n + (q.kind === 'text' ? 45 : 10), 0);
}

/** GET /play `surveys`: the caller's own saved answers per survey block. */
export function savedSurveys(raw: unknown): Record<string, SavedSurvey> {
  const out: Record<string, SavedSurvey> = {};

  for (const [blockId, v] of Object.entries(obj(raw))) {
    const o = obj(v);
    const answers: SurveyAnswers = {};

    for (const [k, a] of Object.entries(obj(o.answers))) {
      if (typeof a === 'string' || (typeof a === 'number' && Number.isFinite(a))) answers[k] = a;
    }

    out[blockId] = { answers, updated_ms: num(o.updated_ms) };
  }

  return out;
}

/** Only answers that fit the survey as it is now (questions or choices may have changed). */
function validAnswers(b: SurveyBlock, raw: SurveyAnswers | undefined, trim: boolean): SurveyAnswers {
  const out: SurveyAnswers = {};

  if (!raw) return out;
  for (const q of b.questions) {
    const a = raw[q.id];

    if (q.kind === 'rating') {
      if (typeof a === 'number' && Number.isInteger(a) && a >= 1 && a <= q.scale) out[q.id] = a;
    } else if (q.kind === 'choice') {
      if (typeof a === 'string' && q.options.some((o) => o.id === a)) out[q.id] = a;
    } else if (typeof a === 'string' && a.trim()) {
      out[q.id] = trim ? a.trim() : a;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Feedback for each answer
// ---------------------------------------------------------------------------

type FeedbackQuestion = { kind: string; options: { id: string; feedback?: string }[] };

function pickedIds(answer: unknown): string[] {
  if (Array.isArray(answer)) return answer.filter((x): x is string => typeof x === 'string');
  return typeof answer === 'string' ? [answer] : [];
}

/** The picked answers' feedback in option order ([] if none); undefined for kinds without it. */
export function pickedFeedbackList(q: FeedbackQuestion, answer: unknown): OptionFeedback[] | undefined {
  if (!FEEDBACK_KINDS.includes(q.kind)) return undefined;
  const picked = pickedIds(answer);

  return q.options
    .filter((o) => picked.includes(o.id) && (o.feedback || '').trim())
    .map((o) => ({ option_id: o.id, text: o.feedback || '' }));
}

/** option id → feedback, for QuestionView (undefined when there is none to show). */
export function feedbackMap(list: OptionFeedback[] | undefined): Record<string, string> | undefined {
  if (!list || !list.length) return undefined;
  const out: Record<string, string> = {};

  list.forEach((f) => {
    if (f.option_id && f.text.trim()) out[f.option_id] = f.text;
  });
  return Object.keys(out).length ? out : undefined;
}

export function pickedFeedback(q: FeedbackQuestion, answer: unknown) {
  return feedbackMap(pickedFeedbackList(q, answer));
}

/** POST /quiz `option_feedback` (only valid rows). */
export function normalizeOptionFeedback(raw: unknown): OptionFeedback[] {
  return arr(raw)
    .map((x) => ({ option_id: str(obj(x).option_id), text: str(obj(x).text) }))
    .filter((f) => f.option_id && f.text.trim());
}

/** Publish check for one question's answer feedback (the server's words). */
export function optionFeedbackProblems(q: FeedbackQuestion, label: string, out: string[]) {
  if (FEEDBACK_KINDS.includes(q.kind) && q.options.some((o) => chars(o.feedback || '') > OPTION_FEEDBACK_MAX)) {
    out.push(`${label} has answer feedback that is too long (300 characters at most).`);
  }
}

// ---------------------------------------------------------------------------
// Quiz rows that take questions from banks
// ---------------------------------------------------------------------------

export function normalizeDraws(raw: unknown): QuizDraw[] {
  return arr(raw)
    .map((x): QuizDraw => {
      const d = obj(x);
      const title = str(d.title).trim();
      const n = Math.round(num(d.count));

      return { bank_id: str(d.bank_id).trim(), count: Math.min(DRAW_COUNT_MAX, Math.max(0, n)), ...(title ? { title } : {}) };
    })
    .filter((d) => d.bank_id);
}

/** The quiz with these rows (no `draws` key when there are none, so old content stays the same). */
export function withDraws<Q extends { draws?: QuizDraw[] }>(quiz: Q, draws: QuizDraw[]): Q {
  const next = { ...quiz };

  if (draws.length) next.draws = draws;
  else delete next.draws;
  return next;
}

/** How many questions the bank rows add to each attempt. */
export function drawnCount(draws: QuizDraw[] | undefined) {
  return (draws || []).reduce((n, d) => n + Math.max(0, d.count), 0);
}

/** Own questions (not copies from a bank) — what the pool and "Questions per attempt" count. */
export function ownQuestions<Q extends { bank_id?: string }>(questions: Q[]) {
  return questions.filter((q) => !q.bank_id);
}

/** Questions in one attempt: own ones (pool) plus the bank rows' counts. */
export function quizQuestionCount(quiz: { questions: { bank_id?: string }[]; pool_size: number; draws?: QuizDraw[] }) {
  const own = ownQuestions(quiz.questions).length;

  return (quiz.pool_size > 0 ? Math.min(quiz.pool_size, own) : own) + drawnCount(quiz.draws);
}

/**
 * The server's publish words for the bank rows. Without the bank list (null) only what the rows themselves show is
 * checked; with it, deleted banks and banks with too few questions too.
 */
export function drawProblems(draws: QuizDraw[] | undefined, banks: BankSummary[] | null, out: string[]) {
  const rows = draws || [];

  if (rows.length > DRAWS_MAX) out.push(DRAWS_MANY_TEXT);
  const seen = new Set<string>();
  let gone = false;

  for (const d of rows.slice(0, DRAWS_MAX)) {
    const bank = banks ? banks.find((b) => b.id === d.bank_id) : undefined;

    if (!UUID_RE.test(d.bank_id) || (banks && !bank)) {
      if (!gone) out.push(BANK_GONE_TEXT);
      gone = true;
      continue;
    }

    const title = bank?.title || d.title || 'a question bank';

    if (seen.has(d.bank_id)) {
      out.push(`The quiz takes questions from “${title}” twice. Use one row for it.`);
      continue;
    }

    seen.add(d.bank_id);
    if (d.count < 1) out.push(`Choose how many questions the quiz takes from “${title}” (at least 1).`);
    else if (bank && d.count > bank.question_count) {
      out.push(`The quiz wants ${d.count} questions from “${title}”, but it only has ${bank.question_count}.`);
    }
  }
}

/**
 * Studio preview of one attempt's bank questions: per row, `count` of that bank's copies (tagged `bank_id`), picked
 * with a seeded shuffle and kept in bank order — like the server. Ids already used are left out.
 */
export function previewDrawn<Q extends { id: string; bank_id?: string }>(
  questions: Q[],
  draws: QuizDraw[] | undefined,
  round: number,
  shuffle: <T>(items: T[], seed: string) => T[]
): Q[] {
  const out: Q[] = [];
  const seen = new Set<string>();

  for (const d of draws || []) {
    if (seen.has(d.bank_id)) continue;
    seen.add(d.bank_id);
    const all = questions.map((q, i) => ({ q, i })).filter((x) => x.q.bank_id === d.bank_id);
    const n = Math.max(0, d.count);
    const picked = n < all.length ? shuffle(all, `draw-${round}-${d.bank_id}`).slice(0, n).sort((a, b) => a.i - b.i) : all;

    picked.forEach((x) => out.push(x.q));
  }

  return out;
}

/** Keeps the first question with each id (a bank may repeat an id the quiz already has; publishing flags that). */
export function uniqueQuestions<Q extends { id: string }>(questions: Q[]): Q[] {
  const seen = new Set<string>();

  return questions.filter((q) => {
    if (seen.has(q.id)) return false;
    seen.add(q.id);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Server calls: question banks and survey results
// ---------------------------------------------------------------------------

export interface BankUse {
  course_id: string;
  title: string;
}

export interface BankSummary {
  id: string;
  title: string;
  description: string;
  question_count: number;
  updated_ms: number;
  updated_by_name: string;
  used_by: BankUse[];
}

export interface BankDetail extends Omit<BankSummary, 'question_count'> {
  /** As stored; the page normalizes them with the Api file's normalizeQuestion. */
  questions: unknown[];
  created_ms: number;
}

const enc = encodeURIComponent;
const bankBase = (ws: string) => `${CH_API}/${ws}/learning/banks`;

function normalizeUses(raw: unknown): BankUse[] {
  return arr(raw)
    .map((x) => ({ course_id: str(obj(x).course_id), title: str(obj(x).title) || 'Untitled course' }))
    .filter((u) => u.course_id);
}

function normalizeBankSummary(raw: unknown): BankSummary {
  const o = obj(raw);

  return {
    id: str(o.id),
    title: str(o.title) || 'Untitled question bank',
    description: str(o.description),
    question_count: Math.max(0, Math.round(num(o.question_count))),
    updated_ms: num(o.updated_ms),
    updated_by_name: str(o.updated_by_name),
    used_by: normalizeUses(o.used_by),
  };
}

function normalizeBankDetail(raw: unknown, id: string): BankDetail {
  const o = obj(raw);

  return {
    id: str(o.id) || id,
    title: str(o.title),
    description: str(o.description),
    questions: arr(o.questions),
    created_ms: num(o.created_ms),
    updated_ms: num(o.updated_ms),
    updated_by_name: str(o.updated_by_name),
    used_by: normalizeUses(o.used_by),
  };
}

export const bankApi = {
  list: (ws: string) =>
    chCall<unknown>('get', bankBase(ws)).then((d) => arr(obj(d).banks).map(normalizeBankSummary).filter((b) => b.id)),
  get: (ws: string, id: string) =>
    chCall<unknown>('get', `${bankBase(ws)}/${enc(id)}`).then((d) => normalizeBankDetail(obj(d).bank, id)),
  create: (ws: string, body: { title: string; description?: string; questions?: unknown[] }) =>
    chCall<unknown>('post', bankBase(ws), body).then((d) => ({ id: str(obj(d).id), updated_ms: num(obj(d).updated_ms) })),
  save: (ws: string, id: string, body: { title?: string; description?: string; questions?: unknown[]; base_updated_ms?: number }) =>
    chCall<unknown>('put', `${bankBase(ws)}/${enc(id)}`, body).then((d) => num(obj(d).updated_ms, Date.now())),
  remove: (ws: string, id: string) => chCall<unknown>('delete', `${bankBase(ws)}/${enc(id)}`),
};

export interface RatingResult {
  id: string;
  kind: 'rating';
  prompt: string;
  answered: number;
  scale: 5 | 10;
  average: number | null;
  counts: number[];
}

export interface ChoiceResult {
  id: string;
  kind: 'choice';
  prompt: string;
  answered: number;
  options: { id: string; text: string; picked: number }[];
}

export interface TextResult {
  id: string;
  kind: 'text';
  prompt: string;
  answered: number;
  answers: { text: string; name?: string; ms?: number }[];
}

export type SurveyQuestionResult = RatingResult | ChoiceResult | TextResult;

export interface SurveyResult {
  block_id: string;
  lesson_id: string;
  lesson_title: string;
  title: string;
  anonymous: boolean;
  answered: number;
  questions: SurveyQuestionResult[];
}

function normalizeQuestionResult(raw: unknown): SurveyQuestionResult {
  const o = obj(raw);
  const base = { id: str(o.id), prompt: str(o.prompt), answered: Math.max(0, num(o.answered)) };

  if (o.kind === 'rating') {
    const scale = o.scale === 10 ? 10 : 5;
    const counts = Array.from({ length: scale }, (_, i) => Math.max(0, num(arr(o.counts)[i])));

    return { ...base, kind: 'rating', scale, average: typeof o.average === 'number' && Number.isFinite(o.average) ? o.average : null, counts };
  }

  if (o.kind === 'choice') {
    return {
      ...base,
      kind: 'choice',
      options: arr(o.options).map((x) => ({ id: str(obj(x).id), text: str(obj(x).text), picked: Math.max(0, num(obj(x).picked)) })),
    };
  }

  return {
    ...base,
    kind: 'text',
    answers: arr(o.answers)
      .map((x) => {
        const a = obj(x);
        const name = str(a.name).trim();
        const ms = num(a.ms);

        return { text: str(a.text), ...(name ? { name } : {}), ...(ms > 0 ? { ms } : {}) };
      })
      .filter((a) => a.text.trim()),
  };
}

export const surveyApi = {
  results: (ws: string, courseId: string) =>
    chCall<unknown>('get', `${CH_API}/${ws}/learning/reports/courses/${enc(courseId)}/surveys`).then((d) =>
      arr(obj(d).surveys).map((x): SurveyResult => {
        const s = obj(x);

        return {
          block_id: str(s.block_id),
          lesson_id: str(s.lesson_id),
          lesson_title: str(s.lesson_title),
          title: str(s.title),
          anonymous: s.anonymous === true,
          answered: Math.max(0, num(s.answered)),
          questions: arr(s.questions).map(normalizeQuestionResult),
        };
      })
    ),
};

// ---------------------------------------------------------------------------
// Styles (dark mode follows the app's data-dark-mode, like the other Learning styles)
// ---------------------------------------------------------------------------

const QBANK_CSS = `
.chq-sr{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.chq-rate{position:relative;display:inline-flex;align-items:center;justify-content:center;min-width:40px;height:40px;padding:0 6px;border:1px solid rgba(127,127,127,.35);border-radius:10px;cursor:pointer;font-size:15px;line-height:1;-webkit-user-select:none;user-select:none}
.chq-rate:hover{background:rgba(127,127,127,.12)}
.chq-rate:focus-within{outline:2px solid #2563eb;outline-offset:2px}
.chq-star{min-width:38px;border-color:transparent;font-size:28px;color:#cbd5e1}
.chq-star.chq-on{color:#f59e0b}
.chq-num.chq-on{background:#2563eb;border-color:#2563eb;color:#fff}
.chq-off{opacity:.6;cursor:default}
.chq-card{display:inline-flex;align-items:center;gap:6px;max-width:100%;min-height:36px;padding:6px 10px;border:1px solid rgba(37,99,235,.45);border-radius:8px;background:rgba(37,99,235,.08);font-size:13px;line-height:1.35;cursor:grab;touch-action:none;-webkit-user-select:none;user-select:none}
.chq-card.chq-used{opacity:.5}
.chq-card.chq-lifted{opacity:.25}
.chq-ghost{position:fixed;z-index:3000;pointer-events:none;box-shadow:0 10px 24px rgba(0,0,0,.25);opacity:.96}
.chq-dragging,.chq-dragging *{cursor:grabbing!important;-webkit-user-select:none!important;user-select:none!important}
.chq-bar{height:8px;min-width:40px;border-radius:999px;background:rgba(127,127,127,.2);overflow:hidden}
.chq-bar>span{display:block;height:100%;border-radius:999px;background:#2563eb}
:root[data-dark-mode='true'] .chq-star{color:#475569}
:root[data-dark-mode='true'] .chq-star.chq-on{color:#fbbf24}
:root[data-dark-mode='true'] .chq-num.chq-on{background:#3b82f6;border-color:#3b82f6}
:root[data-dark-mode='true'] .chq-rate:focus-within{outline-color:#93c5fd}
:root[data-dark-mode='true'] .chq-card{border-color:rgba(147,197,253,.5);background:rgba(59,130,246,.18)}
:root[data-dark-mode='true'] .chq-ghost{box-shadow:0 10px 24px rgba(0,0,0,.6)}
:root[data-dark-mode='true'] .chq-bar>span{background:#60a5fa}
`;

const CSS_ID = 'carehub-learning-qbank-css';

function useQbankCss() {
  useLayoutEffect(() => {
    if (document.getElementById(CSS_ID)) return;
    const el = document.createElement('style');

    el.id = CSS_ID;
    el.textContent = QBANK_CSS;
    document.head.appendChild(el);
  }, []);
}

// Small Studio-style controls (the Studio's own ones live in a file that imports this one).

function SmallIcon({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type='button'
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-sm text-text-secondary hover:bg-fill-content-hover disabled:cursor-not-allowed disabled:opacity-30',
        danger && 'hover:text-text-error'
      )}
    >
      {children}
    </button>
  );
}

function AddLink({ onClick, children, disabled }: { onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type='button'
      disabled={disabled}
      onClick={onClick}
      className='self-start rounded-[8px] px-2 py-1 text-sm font-medium text-text-action hover:bg-fill-content-hover disabled:opacity-40'
    >
      + {children}
    </button>
  );
}

function FieldLabel({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className='text-xs font-medium text-text-secondary'>{label}</span>
      {children}
      {hint && <span className='text-xs text-text-tertiary'>{hint}</span>}
    </label>
  );
}

/** A whole-number box that can be cleared while typing (the value only changes for real numbers). */
function CountField({ value, min, max, onChange, ariaLabel }: { value: number; min: number; max: number; onChange: (v: number) => void; ariaLabel: string }) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      type='number'
      inputMode='numeric'
      min={min}
      max={max}
      aria-label={ariaLabel}
      className={cn(chInputClass, 'w-20')}
      value={draft ?? String(value)}
      onChange={(e) => {
        const raw = e.target.value;
        const n = Number(raw);

        setDraft(raw);
        if (raw.trim() !== '' && Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.round(n))));
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

// ---------------------------------------------------------------------------
// Surveys: what learners see (player and preview)
// ---------------------------------------------------------------------------

export function SurveyView({
  block,
  saved,
  preview,
  onSend,
  Text = PlainText,
}: {
  block: SurveyBlock;
  /** The person's answers from GET /play (or sent from this page). */
  saved?: SavedSurvey;
  preview: boolean;
  /** Sends the answers; resolves to '' when saved, or the reason they weren't. */
  onSend?: (answers: SurveyAnswers) => Promise<string>;
  Text?: TextView;
}) {
  useQbankCss();
  const start = useMemo(() => validAnswers(block, saved?.answers, false), [block, saved]);
  const [answers, setAnswers] = useState<SurveyAnswers>(start);
  const [sent, setSent] = useState(() => Object.keys(start).length > 0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const clean = validAnswers(block, answers, true);
  const ready = Object.keys(clean).length > 0;
  const title = block.title.trim();
  const name = `chq-sv-${block.id}`;
  const set = (id: string, v: number | string | undefined) =>
    setAnswers((m) => {
      const next = { ...m };

      if (v === undefined) delete next[id];
      else next[id] = v;
      return next;
    });

  const send = async () => {
    if (!ready || sending) return;
    setError('');
    if (!onSend) {
      setSent(true);
      return;
    }

    setSending(true);
    let reason = '';

    try {
      reason = await onSend(clean);
    } catch (e) {
      reason = chErrorText(e);
    }

    if (!mounted.current) return;
    setSending(false);
    if (reason) setError(reason);
    else setSent(true);
  };

  return (
    <section className='rounded-[12px] border border-border-primary p-4' aria-labelledby={`${name}-t`} data-testid='chq-survey'>
      <div className='mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary'>Survey</div>
      <h3 id={`${name}-t`} className={cn('text-base font-semibold leading-snug', !title && 'chq-sr')}>
        {title || 'Survey'}
      </h3>
      {block.anonymous && (
        <div className='mt-1 text-xs text-text-secondary'>
          <span aria-hidden='true'>🔒 </span>Your name isn’t shown with your answers.
        </div>
      )}
      {preview && <div className='mt-1 text-xs text-text-tertiary'>Preview — answers aren’t saved.</div>}
      {sent ? (
        <>
          <div role='status' className='chl-good mt-3 rounded-[10px] px-3 py-2.5 text-sm'>
            <span aria-hidden='true'>✅ </span>Thanks — your answers were sent.
          </div>
          <div className='mt-3'>
            <Button
              type='button'
              size='sm'
              variant='outline'
              onClick={() => {
                setError('');
                setSent(false);
              }}
            >
              Change my answers
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className='mt-3 flex flex-col gap-5'>
            {block.questions.map((q, i) => {
              const a = answers[q.id];
              const legend = `${name}-${q.id}`;
              const answered = q.id in clean;

              return (
                <fieldset key={q.id} className='min-w-0' disabled={sending}>
                  <legend id={legend} className='mb-1.5 text-[15px] font-medium leading-snug text-text-primary'>
                    <span className='mr-1 text-text-tertiary'>{i + 1}.</span>
                    <Text text={q.prompt || 'Untitled question'} />
                  </legend>
                  {q.kind === 'rating' && (
                    <>
                      <div className='flex flex-wrap items-center gap-1'>
                        {Array.from({ length: q.scale }, (_, k) => k + 1).map((v) => {
                          const value = typeof a === 'number' ? a : 0;
                          const on = q.scale === 5 ? value >= v : value === v;

                          return (
                            <label key={v} className={cn('chq-rate', q.scale === 5 ? 'chq-star' : 'chq-num', on && 'chq-on', sending && 'chq-off')}>
                              <input type='radio' className='chq-sr' name={legend} checked={value === v} onChange={() => set(q.id, v)} />
                              <span aria-hidden='true'>{q.scale === 5 ? '★' : v}</span>
                              <span className='chq-sr'>{q.scale === 5 ? count(v, 'star') : `${v} out of 10`}</span>
                            </label>
                          );
                        })}
                      </div>
                      {q.scale === 10 && <div className='mt-1 text-xs text-text-tertiary'>1 = lowest · 10 = highest</div>}
                    </>
                  )}
                  {q.kind === 'choice' && (
                    <div className='flex flex-col gap-2'>
                      {q.options.map((o) => {
                        const picked = a === o.id;

                        return (
                          <label
                            key={o.id}
                            className={cn(
                              'flex items-start gap-2.5 rounded-[10px] border px-3 py-2.5 text-sm',
                              sending ? 'cursor-default' : 'cursor-pointer hover:bg-fill-content-hover',
                              picked ? 'border-border-theme-thick bg-fill-content-hover' : 'border-border-primary'
                            )}
                          >
                            <input type='radio' className='mt-0.5 shrink-0' name={legend} checked={picked} onChange={() => set(q.id, o.id)} />
                            <span className='min-w-0 flex-1'>
                              <Text text={o.text || '…'} />
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  {q.kind === 'text' && (
                    <>
                      <textarea
                        aria-labelledby={legend}
                        rows={3}
                        maxLength={SURVEY_TEXT_MAX}
                        placeholder='Type your answer'
                        className={cn(chInputClass, 'w-full min-w-0 resize-y leading-relaxed')}
                        value={typeof a === 'string' ? a : ''}
                        onChange={(e) => set(q.id, e.target.value)}
                      />
                      <div className='mt-0.5 text-right text-[11px] text-text-tertiary'>
                        {chars(typeof a === 'string' ? a : '').toLocaleString()} / 1,000
                      </div>
                    </>
                  )}
                  {answered && (
                    <button
                      type='button'
                      className='mt-1 rounded-[6px] px-1 text-xs text-text-tertiary hover:text-text-primary hover:underline'
                      aria-label={`Clear the answer to question ${i + 1}`}
                      onClick={() => set(q.id, undefined)}
                    >
                      Clear
                    </button>
                  )}
                </fieldset>
              );
            })}
          </div>
          {error && (
            <div className='mt-3' role='alert'>
              <ChNote tone='error'>{error}</ChNote>
            </div>
          )}
          <div className='mt-4 flex flex-wrap items-center gap-2'>
            <Button type='button' size='sm' disabled={!ready || sending} onClick={() => void send()}>
              {sending ? 'Sending…' : 'Send answers'}
            </Button>
            {!ready && <span className='text-xs text-text-tertiary'>Answer at least one question to send. You can skip any of them.</span>}
          </div>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Surveys: the Studio editor
// ---------------------------------------------------------------------------

const SURVEY_KINDS: { value: SurveyKind; label: string }[] = [
  { value: 'rating', label: 'Rating' },
  { value: 'choice', label: 'Pick one' },
  { value: 'text', label: 'Written answer' },
];

const SCALES: { value: 5 | 10; label: string }[] = [
  { value: 5, label: '1 to 5 stars' },
  { value: 10, label: '1 to 10' },
];

export function SurveyEditor({ block, onChange }: { block: SurveyBlock; onChange: (b: SurveyBlock) => void }) {
  const qs = block.questions;
  const setQuestions = (questions: SurveyQuestion[]) => onChange({ ...block, questions });
  const setQ = (i: number, patch: Partial<SurveyQuestion>) => setQuestions(qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= qs.length) return;
    const next = qs.slice();
    const [q] = next.splice(from, 1);

    next.splice(to, 0, q);
    setQuestions(next);
  };
  const setKind = (i: number, kind: SurveyKind) => {
    const q = qs[i];
    const options = kind === 'choice' && q.options.length < 2 ? [...q.options, ...Array.from({ length: 2 - q.options.length }, () => ({ id: qid('so'), text: '' }))] : q.options;

    setQ(i, { kind, options });
  };

  return (
    <div className='flex flex-col gap-3' data-testid='chq-survey-editor'>
      <FieldLabel label='Title (optional)' className='max-w-[420px]'>
        <input
          className={cn(chInputClass, 'w-full min-w-0')}
          value={block.title}
          maxLength={SURVEY_TITLE_MAX}
          placeholder='Survey'
          onChange={(e) => onChange({ ...block, title: e.target.value })}
        />
      </FieldLabel>
      <label className='flex cursor-pointer items-start gap-2 text-sm'>
        <input type='checkbox' className='mt-[3px] shrink-0' checked={block.anonymous} onChange={(e) => onChange({ ...block, anonymous: e.target.checked })} />
        <span className='min-w-0 flex-1'>
          Anonymous
          <span className='block text-xs text-text-tertiary'>
            Learners see “Your name isn’t shown with your answers.” Survey results show these answers without names or dates.
          </span>
        </span>
      </label>
      {qs.map((q, i) => (
        <div key={q.id} className='rounded-[10px] border border-border-primary'>
          <div className='flex items-center gap-0.5 border-b border-border-primary py-1 pl-3 pr-1'>
            <span className='min-w-0 flex-1 truncate text-xs font-semibold text-text-secondary'>Question {i + 1}</span>
            <SmallIcon label='Move up' disabled={i === 0} onClick={() => move(i, i - 1)}>
              ↑
            </SmallIcon>
            <SmallIcon label='Move down' disabled={i >= qs.length - 1} onClick={() => move(i, i + 1)}>
              ↓
            </SmallIcon>
            <SmallIcon label='Delete question' danger disabled={qs.length <= 1} onClick={() => setQuestions(qs.filter((_, j) => j !== i))}>
              🗑
            </SmallIcon>
          </div>
          <div className='flex flex-col gap-2.5 p-3'>
            <div className='flex flex-wrap items-end gap-3'>
              <FieldLabel label='Type of answer' className='min-w-[150px]'>
                <ChSelect value={q.kind} options={SURVEY_KINDS} onChange={(k) => setKind(i, k)} ariaLabel={`Question ${i + 1}: type of answer`} />
              </FieldLabel>
              {q.kind === 'rating' && (
                <FieldLabel label='Scale' className='min-w-[130px]'>
                  <ChSelect value={q.scale} options={SCALES} onChange={(v) => setQ(i, { scale: v === 10 ? 10 : 5 })} ariaLabel={`Question ${i + 1}: scale`} />
                </FieldLabel>
              )}
            </div>
            <FieldLabel label='Question'>
              <textarea
                rows={2}
                maxLength={SURVEY_PROMPT_MAX}
                value={q.prompt}
                placeholder={q.kind === 'rating' ? 'e.g. How useful was this lesson?' : q.kind === 'choice' ? 'e.g. Which part helped most?' : 'e.g. What should we add?'}
                className={cn(chInputClass, 'w-full min-w-0 resize-y leading-relaxed')}
                onChange={(e) => setQ(i, { prompt: e.target.value })}
              />
            </FieldLabel>
            {q.kind === 'choice' && (
              <div className='flex flex-col gap-1.5'>
                <div className='text-xs font-medium text-text-secondary'>Choices</div>
                {q.options.map((o, k) => (
                  <div key={o.id} className='flex items-center gap-2'>
                    <input
                      className={cn(chInputClass, 'w-full min-w-0')}
                      value={o.text}
                      maxLength={SURVEY_CHOICE_MAX}
                      placeholder={`Choice ${k + 1}`}
                      aria-label={`Question ${i + 1}, choice ${k + 1}`}
                      onChange={(e) => setQ(i, { options: q.options.map((x, j) => (j === k ? { ...x, text: e.target.value } : x)) })}
                    />
                    <SmallIcon label='Remove choice' danger disabled={q.options.length <= 2} onClick={() => setQ(i, { options: q.options.filter((_, j) => j !== k) })}>
                      ×
                    </SmallIcon>
                  </div>
                ))}
                <AddLink disabled={q.options.length >= SURVEY_CHOICES_MAX} onClick={() => setQ(i, { options: [...q.options, { id: qid('so'), text: '' }] })}>
                  Add a choice
                </AddLink>
              </div>
            )}
          </div>
        </div>
      ))}
      <div className='flex flex-wrap items-center gap-1'>
        <span className='mr-1 text-xs text-text-tertiary'>Add a question:</span>
        {SURVEY_KINDS.map((k) => (
          <AddLink key={k.value} disabled={qs.length >= SURVEY_QUESTIONS_MAX} onClick={() => setQuestions([...qs, blankSurveyQuestion(k.value)])}>
            {k.label}
          </AddLink>
        ))}
      </div>
      <div className='text-xs text-text-tertiary'>
        Up to 10 questions. People can skip any of them, and answers are never graded — find them in the course report under “Survey results”.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feedback for each answer: the Studio fields (single, multiple and true/false questions)
// ---------------------------------------------------------------------------

function withFeedback<O extends { feedback?: string }>(o: O, text: string): O {
  const next = { ...o };

  if (text) next.feedback = text;
  else delete next.feedback;
  return next;
}

export function OptionFeedbackEditor<O extends { id: string; text: string; feedback?: string }>({
  options,
  onChange,
}: {
  options: O[];
  onChange: (options: O[]) => void;
}) {
  const has = options.some((o) => Boolean(o.feedback));
  const [open, setOpen] = useState(has);
  const shown = open || has;

  return (
    <div className='flex flex-col gap-1.5'>
      <label className='flex cursor-pointer items-start gap-2 text-sm'>
        <input
          type='checkbox'
          className='mt-[3px] shrink-0'
          checked={shown}
          onChange={(e) => {
            setOpen(e.target.checked);
            if (!e.target.checked && has) onChange(options.map((o) => withFeedback(o, '')));
          }}
        />
        <span className='min-w-0 flex-1'>
          Feedback for each answer
          <span className='block text-xs text-text-tertiary'>Shown under the answer someone picks, once they’ve answered.</span>
        </span>
      </label>
      {shown && (
        <div className='ml-6 flex flex-col gap-2'>
          {options.map((o, i) => (
            <FieldLabel key={o.id} label={`When someone picks “${plain(o.text) || `Answer ${i + 1}`}”`}>
              <input
                className={cn(chInputClass, 'w-full min-w-0')}
                value={o.feedback || ''}
                maxLength={OPTION_FEEDBACK_MAX}
                placeholder='Why this answer is right, or what to think about instead'
                onChange={(e) => onChange(options.map((x, j) => (j === i ? withFeedback(x, e.target.value) : x)))}
              />
            </FieldLabel>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drag-and-drop matching (mouse, touch and pen; the pick-from-list stays for keyboards and screen readers)
// ---------------------------------------------------------------------------

function scrollBox(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;

    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }

  return null;
}

/** Drop a card on a left item: it takes that card; if the card was on another item, that item gets this one's old card. */
export function placeMatch(value: Record<string, string>, token: string, pairId: string): Record<string, string> {
  const next = { ...value };
  const from = Object.keys(next).find((k) => k !== pairId && next[k] === token);
  const old = next[pairId];

  next[pairId] = token;
  if (from) {
    if (old) next[from] = old;
    else delete next[from];
  }

  return next;
}

/**
 * The right-hand cards of a matching question, to drag onto the left items. The items are the question's elements
 * with `data-chq-drop="{pair id}"` and `data-chq-q="{question id}"`.
 */
export function MatchCards({
  questionId,
  lefts,
  rights,
  value,
  onChange,
  Text = PlainText,
}: {
  questionId: string;
  lefts: { id: string; text: string }[];
  rights: { token: string; text: string }[];
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  Text?: TextView;
}) {
  useQbankCss();
  const [drag, setDrag] = useState<{ token: string; text: string; x: number; y: number; w: number } | null>(null);
  const [said, setSaid] = useState('');
  const stop = useRef<(() => void) | null>(null);
  const latest = useRef({ value, onChange, lefts, rights });

  latest.current = { value, onChange, lefts, rights };
  useEffect(() => () => stop.current?.(), []);
  const placed = new Set(Object.values(value));

  const place = (token: string, pairId: string) => {
    const l = latest.current;

    l.onChange(placeMatch(l.value, token, pairId));
    const left = plain(l.lefts.find((p) => p.id === pairId)?.text || '') || 'this item';
    const right = plain(l.rights.find((r) => r.token === token)?.text || '') || 'this card';

    setSaid(`Matched “${left}” with “${right}”.`);
  };

  const grab = (token: string, text: string) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || stop.current) return;
    e.preventDefault();
    const card = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - card.left;
    const dy = e.clientY - card.top;
    const pointer = e.pointerId;
    const box = scrollBox(e.currentTarget);
    let x = e.clientX;
    let y = e.clientY;
    let over: HTMLElement | null = null;
    let frame = 0;
    const find = () => {
      const hit = document.elementFromPoint(x, y);
      const row = hit ? hit.closest<HTMLElement>('[data-chq-drop]') : null;
      const ok = row && row.getAttribute('data-chq-q') === questionId ? row : null;

      if (ok === over) return;
      over?.classList.remove('chl-drop-target');
      ok?.classList.add('chl-drop-target');
      over = ok;
    };
    const show = () => setDrag({ token, text, x: x - dx, y: y - dy, w: card.width });
    const tick = () => {
      const view = box ? box.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      const step = y < view.top + 48 ? -12 : y > view.bottom - 48 ? 12 : 0;

      if (step) {
        if (box) box.scrollTop += step;
        else window.scrollBy(0, step);
        find();
      }

      frame = requestAnimationFrame(tick);
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      ev.preventDefault();
      x = ev.clientX;
      y = ev.clientY;
      show();
      find();
    };
    const finish = (commit: boolean) => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('keydown', key);
      document.documentElement.classList.remove('chq-dragging');
      const target = over ? over.getAttribute('data-chq-drop') || '' : '';

      over?.classList.remove('chl-drop-target');
      over = null;
      stop.current = null;
      setDrag(null);
      if (commit && target) place(token, target);
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId === pointer) finish(ev.type === 'pointerup');
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') finish(false);
    };

    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('keydown', key);
    document.documentElement.classList.add('chq-dragging');
    frame = requestAnimationFrame(tick);
    stop.current = () => finish(false);
    show();
  };

  if (!rights.length) return null;
  return (
    <div className='mb-2' data-testid='chq-match-cards'>
      <div aria-hidden='true'>
        <div className='mb-1.5 text-xs text-text-tertiary'>Drag each card onto its match, or choose from the lists.</div>
        <div className='flex flex-wrap gap-2'>
          {rights.map((r) => (
            <div
              key={r.token}
              data-chq-card={r.token}
              className={cn('chq-card', placed.has(r.token) && 'chq-used', drag?.token === r.token && 'chq-lifted')}
              onPointerDown={grab(r.token, r.text)}
            >
              {placed.has(r.token) && <span className='text-xs'>✓</span>}
              <span className='min-w-0'>
                <Text text={r.text || '…'} />
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className='chq-sr' aria-live='polite'>
        {said}
      </div>
      {drag &&
        createPortal(
          <div className='chq-card chq-ghost bg-background-primary text-text-primary' style={{ left: drag.x, top: drag.y, maxWidth: Math.max(120, drag.w) }} aria-hidden='true'>
            <span className='min-w-0'>
              <Text text={drag.text || '…'} />
            </span>
          </div>,
          document.body
        )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Studio: the quiz's "take questions from a bank" rows
// ---------------------------------------------------------------------------

function useBankList(workspaceId: string, errorText: (err: unknown) => string) {
  const [banks, setBanks] = useState<BankSummary[] | null>(null);
  const [error, setError] = useState('');
  const [round, setRound] = useState(0);

  useEffect(() => {
    let alive = true;

    setError('');
    bankApi.list(workspaceId).then(
      (list) => {
        if (alive) setBanks(list);
      },
      (e: unknown) => {
        if (alive) setError(errorText(e));
      }
    );
    return () => {
      alive = false;
    };
    // errorText is a plain helper; reloading only follows the workspace and "Try again".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, round]);

  return { banks, error, reload: () => setRound((n) => n + 1) };
}

export function QuizDrawsEditor({
  workspaceId,
  draws,
  ownPerAttempt,
  onChange,
  onOpenBanks,
  errorText,
}: {
  workspaceId: string;
  draws: QuizDraw[];
  /** The quiz's own questions in each attempt (after "Questions per attempt"). */
  ownPerAttempt: number;
  onChange: (draws: QuizDraw[]) => void;
  onOpenBanks: () => void;
  errorText: (err: unknown) => string;
}) {
  const { banks, error, reload } = useBankList(workspaceId, errorText);
  const problems: string[] = [];

  if (banks) drawProblems(draws, banks, problems);
  const drawn = drawnCount(draws);
  const total = ownPerAttempt + drawn;
  const setRow = (i: number, patch: Partial<QuizDraw>) => onChange(draws.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const unused = (banks || []).filter((b) => !draws.some((d) => d.bank_id === b.id));
  const addRow = () => {
    const b = unused[0] || (banks || [])[0];

    if (!b) return;
    onChange([...draws, { bank_id: b.id, count: Math.max(1, Math.min(5, b.question_count)), title: b.title }]);
  };

  return (
    <ChSection
      title='Questions from question banks'
      hint='Each attempt also takes random questions from these banks. Publishing copies the banks’ questions into the course, so later changes to a bank need a new publish.'
    >
      <div className='flex flex-col gap-2' data-testid='chq-draws'>
        {error && (
          <div className='flex flex-wrap items-center gap-2'>
            <ChNote tone='error'>{error}</ChNote>
            <Button type='button' size='sm' variant='outline' onClick={reload}>
              Try again
            </Button>
          </div>
        )}
        {!banks && !error && <div className='text-xs text-text-tertiary'>Loading question banks…</div>}
        {draws.map((d, i) => {
          const bank = banks ? banks.find((b) => b.id === d.bank_id) : undefined;

          return (
            <div key={`${d.bank_id}-${i}`} className='flex flex-wrap items-center gap-2 rounded-[10px] border border-border-primary px-3 py-2' data-testid='chq-draw-row'>
              <span className='text-sm'>Take</span>
              <CountField value={d.count} min={1} max={DRAW_COUNT_MAX} onChange={(v) => setRow(i, { count: v })} ariaLabel={`How many questions from row ${i + 1}`} />
              <span className='text-sm'>from</span>
              <select
                aria-label={`Question bank for row ${i + 1}`}
                className={cn(chInputClass, 'min-w-[160px] flex-1 pr-7')}
                value={d.bank_id}
                disabled={!banks}
                onChange={(e) => {
                  const b = (banks || []).find((x) => x.id === e.target.value);

                  if (b) setRow(i, { bank_id: b.id, title: b.title });
                }}
              >
                {(!banks || !bank) && <option value={d.bank_id}>{banks ? `${d.title || 'A question bank'} (deleted)` : d.title || 'Question bank'}</option>}
                {(banks || []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
              </select>
              <SmallIcon label={`Remove row ${i + 1}`} danger onClick={() => onChange(draws.filter((_, j) => j !== i))}>
                ×
              </SmallIcon>
              {bank && (
                <div className='basis-full text-xs text-text-tertiary'>
                  Takes {d.count.toLocaleString()} of its {count(bank.question_count, 'question')}.
                </div>
              )}
            </div>
          );
        })}
        {banks && !banks.length && !draws.length && (
          <div className='text-sm text-text-secondary'>
            No question banks yet.{' '}
            <button type='button' className='font-medium text-text-action hover:underline' onClick={onOpenBanks}>
              Make one on the Question banks page
            </button>{' '}
            to share questions between quizzes.
          </div>
        )}
        <div className='flex flex-wrap items-center gap-2'>
          {banks && banks.length > 0 && (
            <AddLink disabled={draws.length >= DRAWS_MAX} onClick={addRow}>
              Add questions from a bank
            </AddLink>
          )}
          <button type='button' className='rounded-[8px] px-2 py-1 text-sm text-text-secondary hover:bg-fill-content-hover hover:text-text-primary' onClick={onOpenBanks}>
            Manage question banks →
          </button>
        </div>
        {draws.length > 0 && (
          <div className='text-xs text-text-secondary'>
            Each attempt: {count(total, 'question')} ({ownPerAttempt.toLocaleString()} of the quiz’s own + {drawn.toLocaleString()} from banks).
          </div>
        )}
        {problems.length > 0 && (
          <ChNote tone='warn'>
            <ul className='flex list-disc flex-col gap-0.5 pl-4'>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </ChNote>
        )}
      </div>
    </ChSection>
  );
}

// ---------------------------------------------------------------------------
// Studio preview: the draft with its banks' questions (so the preview quiz can draw from them)
// ---------------------------------------------------------------------------

export function useBankCopies(
  workspaceId: string,
  content: Content,
  normalize: (raw: unknown) => Question
): { content: Content; loading: boolean; /** Titles of the banks that couldn't be loaded ('' when unknown). */ failed: string[] } {
  const quiz = content.quiz;
  const need = useMemo(() => {
    if (!quiz.enabled) return [];
    const ids = (quiz.draws || []).map((d) => d.bank_id).filter((id) => UUID_RE.test(id) && !quiz.questions.some((q) => q.bank_id === id));

    return Array.from(new Set(ids));
  }, [quiz]);
  const key = need.join(',');
  const [got, setGot] = useState<{ key: string; copies: Question[]; failed: string[] } | null>(null);
  const normalizeRef = useRef(normalize);

  normalizeRef.current = normalize;
  useEffect(() => {
    if (!key) return;
    let alive = true;

    Promise.all(
      key.split(',').map((id) =>
        bankApi.get(workspaceId, id).then(
          (b) => ({ id, b }),
          () => ({ id, b: null as BankDetail | null })
        )
      )
    ).then((list) => {
      if (!alive) return;
      const copies: Question[] = [];
      const failed: string[] = [];

      list.forEach(({ id, b }) => {
        if (!b) {
          failed.push((quiz.draws || []).find((d) => d.bank_id === id)?.title || '');
          return;
        }

        b.questions.forEach((raw) => copies.push({ ...normalizeRef.current(raw), bank_id: id }));
      });
      setGot({ key, copies, failed });
    });
    return () => {
      alive = false;
    };
    // The rows' titles only name failures; the list of banks to load is the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, key]);

  const ready = !key || (got !== null && got.key === key);
  const copies = ready && got && key ? got.copies : null;
  const merged = useMemo(
    () => (copies && copies.length ? { ...content, quiz: { ...content.quiz, questions: [...content.quiz.questions, ...copies] } } : content),
    [content, copies]
  );

  return { content: merged, loading: !ready, failed: ready && got && key ? got.failed : [] };
}

// ---------------------------------------------------------------------------
// Studio: the Question banks page (list, new, delete, editor with autosave)
// ---------------------------------------------------------------------------

/** What the page needs from the Learning files (passed in, see the note at the top). */
export interface BankKit {
  QuestionEditor: ComponentType<{ q: Question; onChange: (q: Question) => void; inQuiz?: boolean }>;
  normalizeQuestion: (raw: unknown) => Question;
  blankQuestion: (kind: QuestionKind) => Question;
  cloneQuestion: (q: Question) => Question;
  /** The publish checks for one question. */
  problems: (q: Question, label: string) => string[];
  kinds: { value: QuestionKind; label: string }[];
  errorText: (err: unknown) => string;
  notLive: (err: unknown) => boolean;
  transient: (err: unknown) => boolean;
}

export function QuestionBanksPage({ workspaceId, bankId, studioPath, kit }: { workspaceId: string; bankId: string; studioPath: string; kit: BankKit }) {
  const navigate = useNavigate();
  const listPath = `${studioPath}?view=banks`;
  const open = (id: string) => navigate(`${listPath}&bank=${enc(id)}`);

  useQbankCss();
  if (bankId) {
    if (!UUID_RE.test(bankId)) {
      return (
        <div className='flex flex-col items-start gap-3'>
          <ChNote tone='error'>{BANK_LINK_TEXT}</ChNote>
          <Button type='button' variant='outline' onClick={() => navigate(listPath)}>
            Back to question banks
          </Button>
        </div>
      );
    }

    return (
      <BankEditor
        key={bankId}
        workspaceId={workspaceId}
        bankId={bankId}
        kit={kit}
        onBack={() => navigate(listPath)}
        onOpenCourse={(id) => navigate(`${studioPath}/${enc(id)}`)}
      />
    );
  }

  return <BankList workspaceId={workspaceId} kit={kit} onOpen={open} onCourses={() => navigate(studioPath)} />;
}

function BackLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type='button' className='mb-2 rounded-[8px] px-1 text-sm text-text-secondary hover:text-text-primary hover:underline' onClick={onClick}>
      ← {children}
    </button>
  );
}

function usedByText(uses: BankUse[]) {
  const names = uses.map((u) => `“${u.title}”`);

  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}

function BankList({ workspaceId, kit, onOpen, onCourses }: { workspaceId: string; kit: BankKit; onOpen: (id: string) => void; onCourses: () => void }) {
  const [banks, setBanks] = useState<BankSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [round, setRound] = useState(0);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<BankSummary | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let alive = true;

    setError(null);
    bankApi.list(workspaceId).then(
      (list) => {
        if (alive) setBanks(list);
      },
      (e: unknown) => {
        if (alive) setError(e || new Error('Something went wrong. Please try again.'));
      }
    );
    return () => {
      alive = false;
    };
  }, [workspaceId, round]);

  return (
    <div data-testid='chq-banks'>
      <BackLink onClick={onCourses}>Courses</BackLink>
      <div className='mb-4 flex flex-wrap items-center gap-2'>
        <div className='min-w-0 flex-1'>
          <h2 className='text-lg font-semibold'>Question banks</h2>
          <div className='text-sm text-text-secondary'>Questions to share between quizzes. A quiz can take a few random ones from a bank each attempt.</div>
        </div>
        <Button type='button' onClick={() => setCreating(true)} data-testid='chq-bank-new'>
          + New question bank
        </Button>
      </div>
      {notice && (
        <div className='mb-3'>
          <ChNote tone='ok'>{notice}</ChNote>
        </div>
      )}
      {error ? (
        <div className='flex flex-col items-start gap-3'>
          <ChNote tone={kit.notLive(error) ? 'info' : 'error'}>{kit.errorText(error)}</ChNote>
          <Button type='button' variant='outline' onClick={() => setRound((n) => n + 1)}>
            Try again
          </Button>
        </div>
      ) : !banks ? (
        <div className='py-6 text-sm text-text-tertiary'>Loading question banks…</div>
      ) : !banks.length ? (
        <div className='rounded-[12px] border border-dashed border-border-primary px-4 py-8 text-center text-sm text-text-secondary'>
          No question banks yet. Make one to share questions between courses — for example “Billing basics”.
        </div>
      ) : (
        <ul className='flex flex-col gap-2' style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {banks.map((b) => (
            <li key={b.id} className='flex items-start gap-2 rounded-[12px] border border-border-primary p-3 hover:bg-fill-content-hover'>
              <button type='button' className='min-w-0 flex-1 text-left' onClick={() => onOpen(b.id)}>
                <span className='block truncate text-sm font-semibold text-text-primary'>{b.title}</span>
                <span className='block text-xs text-text-tertiary'>
                  {count(b.question_count, 'question')}
                  {b.updated_ms > 0 && ` · Updated ${formatWhen(b.updated_ms)}${b.updated_by_name ? ` by ${b.updated_by_name}` : ''}`}
                </span>
                {b.description.trim() && <span className='mt-0.5 block truncate text-xs text-text-secondary'>{b.description}</span>}
                {b.used_by.length > 0 && <span className='mt-0.5 block text-xs text-text-secondary'>Used by {usedByText(b.used_by)}</span>}
              </button>
              <SmallIcon label={`Delete ${b.title}`} danger onClick={() => setToDelete(b)}>
                🗑
              </SmallIcon>
            </li>
          ))}
        </ul>
      )}
      {creating && <NewBankModal workspaceId={workspaceId} kit={kit} onClose={() => setCreating(false)} onCreated={onOpen} />}
      {toDelete && (
        <DeleteBankModal
          workspaceId={workspaceId}
          bank={toDelete}
          kit={kit}
          onClose={() => setToDelete(null)}
          onDeleted={() => {
            setNotice(`Deleted “${toDelete.title}”.`);
            setToDelete(null);
            setRound((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}

function NewBankModal({ workspaceId, kit, onClose, onCreated }: { workspaceId: string; kit: BankKit; onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const create = async () => {
    if (busy) return;
    if (!title.trim()) {
      setError(BANK_NAME_TEXT);
      return;
    }

    setBusy(true);
    setError('');
    try {
      const r = await bankApi.create(workspaceId, { title: title.trim(), description: description.trim() });

      if (!r.id) throw new Error('Couldn’t make the question bank. Please try again.');
      onCreated(r.id);
    } catch (e) {
      setError(kit.errorText(e));
      setBusy(false);
    }
  };

  return (
    <CareHubModal
      title='New question bank'
      onClose={onClose}
      testId='chq-bank-new-modal'
      footer={
        <>
          <Button type='button' variant='outline' onClick={onClose}>
            Cancel
          </Button>
          <Button type='button' disabled={busy} onClick={() => void create()}>
            {busy ? 'Making…' : 'Make question bank'}
          </Button>
        </>
      }
    >
      <form
        className='flex flex-col gap-3'
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <FieldLabel label='Name'>
          <input
            autoFocus
            className={cn(chInputClass, 'w-full min-w-0')}
            value={title}
            maxLength={BANK_TITLE_MAX}
            placeholder='e.g. Billing basics'
            onChange={(e) => setTitle(e.target.value)}
          />
        </FieldLabel>
        <FieldLabel label='Description (optional)'>
          <textarea
            rows={3}
            maxLength={BANK_DESCRIPTION_MAX}
            className={cn(chInputClass, 'w-full min-w-0 resize-y leading-relaxed')}
            value={description}
            placeholder='What these questions cover'
            onChange={(e) => setDescription(e.target.value)}
          />
        </FieldLabel>
        {error && <ChNote tone='error'>{error}</ChNote>}
      </form>
    </CareHubModal>
  );
}

function DeleteBankModal({
  workspaceId,
  bank,
  kit,
  onClose,
  onDeleted,
}: {
  workspaceId: string;
  bank: BankSummary;
  kit: BankKit;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      await bankApi.remove(workspaceId, bank.id);
      onDeleted();
    } catch (e) {
      setError(kit.errorText(e));
      setBusy(false);
    }
  };

  return (
    <CareHubModal
      title={`Delete “${bank.title}”?`}
      onClose={onClose}
      testId='chq-bank-delete-modal'
      footer={
        <>
          <Button type='button' variant='outline' onClick={onClose}>
            Cancel
          </Button>
          <Button type='button' variant='destructive' disabled={busy} onClick={() => void remove()}>
            {busy ? 'Deleting…' : 'Delete question bank'}
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-3 text-sm'>
        {bank.used_by.length > 0 ? (
          <ChNote tone='warn'>
            The quiz in {usedByText(bank.used_by)} takes questions from this bank. Those courses can’t be published again until it’s
            removed from their quiz settings.
          </ChNote>
        ) : null}
        <div className='text-text-secondary'>Published courses keep their copy of its questions. This can’t be undone.</div>
        {error && <ChNote tone='error'>{error}</ChNote>}
      </div>
    </CareHubModal>
  );
}

type SaveState = '' | 'pending' | 'saving' | 'saved' | 'retrying' | 'error' | 'stale';

interface BankDraft {
  title: string;
  description: string;
  questions: Question[];
}

function bankBytes(questions: Question[]) {
  try {
    return new TextEncoder().encode(JSON.stringify(questions)).length;
  } catch {
    return JSON.stringify(questions).length;
  }
}

function BankEditor({
  workspaceId,
  bankId,
  kit,
  onBack,
  onOpenCourse,
}: {
  workspaceId: string;
  bankId: string;
  kit: BankKit;
  onBack: () => void;
  onOpenCourse: (id: string) => void;
}) {
  const [loaded, setLoaded] = useState<BankDetail | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [round, setRound] = useState(0);
  const [draft, setDraftState] = useState<BankDraft>({ title: '', description: '', questions: [] });
  const [save, setSave] = useState<SaveState>('');
  const [saveError, setSaveError] = useState('');
  const [undo, setUndo] = useState<{ q: Question; index: number } | null>(null);
  const draftRef = useRef(draft);
  const baseRef = useRef(0);
  const dirtyRef = useRef(false);
  const busyRef = useRef(false);
  const blockedRef = useRef(false);
  const timerRef = useRef(0);
  const backoffRef = useRef(0);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;

    setLoadError(null);
    bankApi.get(workspaceId, bankId).then(
      (b) => {
        if (!alive) return;
        const next = { title: b.title, description: b.description, questions: b.questions.map((q) => kit.normalizeQuestion(q)) };

        draftRef.current = next;
        baseRef.current = b.updated_ms;
        dirtyRef.current = false;
        blockedRef.current = false;
        setDraftState(next);
        setLoaded(b);
        setSave('');
        setSaveError('');
      },
      (e: unknown) => {
        if (alive) setLoadError(e || new Error('Something went wrong. Please try again.'));
      }
    );
    return () => {
      alive = false;
    };
    // kit is a constant from the Studio file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, bankId, round]);

  const saveNow = useCallback(async () => {
    window.clearTimeout(timerRef.current);
    if (busyRef.current || blockedRef.current || !dirtyRef.current) return;
    const d = draftRef.current;
    const title = d.title.trim();

    if (!title) {
      setSave('error');
      setSaveError(BANK_NAME_TEXT);
      return;
    }

    if (bankBytes(d.questions) > BANK_BYTES_MAX) {
      setSave('error');
      setSaveError(BANK_BIG_TEXT);
      return;
    }

    busyRef.current = true;
    dirtyRef.current = false;
    setSave('saving');
    let again = 0;

    try {
      const ms = await bankApi.save(workspaceId, bankId, { title, description: d.description, questions: d.questions, base_updated_ms: baseRef.current });

      baseRef.current = ms;
      backoffRef.current = 0;
      if (aliveRef.current) {
        setSave(dirtyRef.current ? 'pending' : 'saved');
        setSaveError('');
      }

      if (dirtyRef.current) again = 1500;
    } catch (e) {
      dirtyRef.current = true;
      const text = kit.errorText(e);

      if (STALE_RE.test(text)) {
        blockedRef.current = true;
        if (aliveRef.current) {
          setSave('stale');
          setSaveError(text);
        }
      } else if (kit.transient(e)) {
        backoffRef.current = Math.min(60_000, backoffRef.current ? backoffRef.current * 2 : 2000);
        again = backoffRef.current;
        if (aliveRef.current) setSave('retrying');
      } else if (aliveRef.current) {
        setSave('error');
        setSaveError(text);
      }
    } finally {
      busyRef.current = false;
    }

    if (again && aliveRef.current) timerRef.current = window.setTimeout(() => void saveRef.current(), again);
  }, [workspaceId, bankId, kit]);

  const saveRef = useRef(saveNow);

  saveRef.current = saveNow;

  // Warn before closing the tab with unsaved changes; save on the way out of the editor.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current && !busyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.clearTimeout(timerRef.current);
      if (dirtyRef.current && !blockedRef.current && !busyRef.current) void saveRef.current();
    };
  }, []);

  const update = (fn: (d: BankDraft) => BankDraft) => {
    const next = fn(draftRef.current);

    if (next === draftRef.current) return;
    draftRef.current = next;
    dirtyRef.current = true;
    setDraftState(next);
    if (blockedRef.current) return;
    setSave('pending');
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void saveRef.current(), 1500);
  };
  const setQuestions = (fn: (qs: Question[]) => Question[]) => update((d) => ({ ...d, questions: fn(d.questions) }));
  const moveQ = (from: number, to: number) =>
    setQuestions((qs) => {
      if (to < 0 || to >= qs.length) return qs;
      const next = qs.slice();
      const [q] = next.splice(from, 1);

      next.splice(to, 0, q);
      return next;
    });

  if (loadError) {
    return (
      <div className='flex flex-col items-start gap-3'>
        <BackLink onClick={onBack}>Question banks</BackLink>
        <ChNote tone={kit.notLive(loadError) ? 'info' : 'error'}>{kit.errorText(loadError)}</ChNote>
        <Button type='button' variant='outline' onClick={() => setRound((n) => n + 1)}>
          Try again
        </Button>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div>
        <BackLink onClick={onBack}>Question banks</BackLink>
        <div className='py-6 text-sm text-text-tertiary'>Loading the question bank…</div>
      </div>
    );
  }

  const qs = draft.questions;
  const problems = Array.from(new Set(qs.flatMap((q, i) => kit.problems(q, `Question ${i + 1}`))));
  const status =
    save === 'pending' || save === 'saving' ? 'Saving…' : save === 'saved' ? 'Saved' : save === 'retrying' ? 'Couldn’t save — retrying' : '';

  return (
    <div data-testid='chq-bank-editor'>
      <BackLink onClick={onBack}>Question banks</BackLink>
      <div className='mb-4 flex flex-col gap-3'>
        <div className='flex flex-wrap items-end gap-3'>
          <FieldLabel label='Name' className='min-w-[220px] flex-1'>
            <input
              className={cn(chInputClass, 'w-full min-w-0 text-base font-semibold')}
              value={draft.title}
              maxLength={BANK_TITLE_MAX}
              placeholder='e.g. Billing basics'
              onChange={(e) => {
                const v = e.target.value;

                update((d) => ({ ...d, title: v }));
              }}
            />
          </FieldLabel>
          <span className='pb-2 text-xs text-text-tertiary' role='status' aria-live='polite' data-testid='chq-bank-save'>
            {status}
          </span>
        </div>
        <FieldLabel label='Description (optional)'>
          <textarea
            rows={2}
            maxLength={BANK_DESCRIPTION_MAX}
            className={cn(chInputClass, 'w-full min-w-0 resize-y leading-relaxed')}
            value={draft.description}
            placeholder='What these questions cover'
            onChange={(e) => {
              const v = e.target.value;

              update((d) => ({ ...d, description: v }));
            }}
          />
        </FieldLabel>
        {loaded.used_by.length > 0 && (
          <div className='flex flex-wrap items-center gap-1 text-xs text-text-secondary'>
            <span>Used by the quiz in</span>
            {loaded.used_by.map((u) => (
              <button key={u.course_id} type='button' className='rounded-[6px] px-1 font-medium text-text-action hover:underline' onClick={() => onOpenCourse(u.course_id)}>
                {u.title}
              </button>
            ))}
            <span>· Courses get changes here the next time they’re published.</span>
          </div>
        )}
        {save === 'stale' && (
          <div className='flex flex-wrap items-center gap-2'>
            <ChNote tone='warn'>{saveError}</ChNote>
            <Button type='button' size='sm' variant='outline' onClick={() => setRound((n) => n + 1)}>
              Reload
            </Button>
          </div>
        )}
        {save === 'error' && saveError && <ChNote tone='error'>{saveError}</ChNote>}
      </div>
      <ChSection title={`Questions (${qs.length})`} hint='Points and feedback work the same as in a final quiz.'>
        <div className='flex flex-col gap-3'>
          {!qs.length && <div className='text-sm text-text-tertiary'>No questions yet — add the first one below.</div>}
          {qs.map((q, i) => (
            <div key={q.id} className='rounded-[12px] border border-border-primary' data-testid='chq-bank-question'>
              <div className='flex items-center gap-0.5 border-b border-border-primary py-1 pl-3 pr-1'>
                <span className='min-w-0 flex-1 truncate text-xs font-semibold text-text-secondary'>Question {i + 1}</span>
                <SmallIcon label='Move up' disabled={i === 0} onClick={() => moveQ(i, i - 1)}>
                  ↑
                </SmallIcon>
                <SmallIcon label='Move down' disabled={i >= qs.length - 1} onClick={() => moveQ(i, i + 1)}>
                  ↓
                </SmallIcon>
                <SmallIcon
                  label='Duplicate'
                  disabled={qs.length >= BANK_QUESTIONS_MAX}
                  onClick={() => setQuestions((list) => [...list.slice(0, i + 1), kit.cloneQuestion(q), ...list.slice(i + 1)])}
                >
                  ⧉
                </SmallIcon>
                <SmallIcon
                  label='Delete question'
                  danger
                  onClick={() => {
                    setUndo({ q, index: i });
                    setQuestions((list) => list.filter((x) => x.id !== q.id));
                  }}
                >
                  🗑
                </SmallIcon>
              </div>
              <div className='p-3'>
                <kit.QuestionEditor q={q} inQuiz onChange={(nq) => setQuestions((list) => list.map((x) => (x.id === q.id ? nq : x)))} />
              </div>
            </div>
          ))}
          {undo && (
            <div className='flex flex-wrap items-center gap-2 rounded-[10px] bg-fill-content-hover px-3 py-2 text-sm'>
              <span className='min-w-0 flex-1'>Question deleted.</span>
              <Button
                type='button'
                size='sm'
                variant='outline'
                onClick={() => {
                  const u = undo;

                  setUndo(null);
                  setQuestions((list) => (list.some((x) => x.id === u.q.id) ? list : [...list.slice(0, u.index), u.q, ...list.slice(u.index)]));
                }}
              >
                Undo
              </Button>
            </div>
          )}
          <div className='flex flex-wrap items-center gap-1'>
            <span className='mr-1 text-xs text-text-tertiary'>Add a question:</span>
            {kit.kinds.map((k) => (
              <AddLink key={k.value} disabled={qs.length >= BANK_QUESTIONS_MAX} onClick={() => setQuestions((list) => [...list, kit.blankQuestion(k.value)])}>
                {k.label}
              </AddLink>
            ))}
          </div>
          {qs.length >= BANK_QUESTIONS_MAX && <div className='text-xs text-text-tertiary'>A question bank can hold up to 200 questions.</div>}
        </div>
      </ChSection>
      {problems.length > 0 && (
        <ChSection title='To fix before a course using this bank is published'>
          <ChNote tone='warn'>
            <ul className='flex list-disc flex-col gap-0.5 pl-4'>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </ChNote>
        </ChSection>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Course report: "Survey results"
// ---------------------------------------------------------------------------

function Bar({ pct }: { pct: number }) {
  return (
    <div className='chq-bar flex-1' aria-hidden='true'>
      <span style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

function pctOf(n: number, of: number) {
  return of > 0 ? Math.round((100 * n) / of) : 0;
}

function TextAnswers({ q }: { q: TextResult }) {
  const [all, setAll] = useState(false);
  const shown = all ? q.answers : q.answers.slice(0, 5);

  if (!q.answers.length) return <div className='mt-1 text-xs text-text-tertiary'>No written answers yet.</div>;
  return (
    <>
      <ul className='mt-1.5 flex flex-col gap-1.5' style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {shown.map((a, i) => (
          <li key={i} className='rounded-[8px] bg-fill-content-hover px-3 py-2 text-sm'>
            <div className='whitespace-pre-wrap break-words'>{a.text}</div>
            <div className='mt-0.5 text-[11px] text-text-tertiary'>{a.name ? `${a.name}${a.ms ? ` · ${formatWhen(a.ms)}` : ''}` : 'Anonymous'}</div>
          </li>
        ))}
      </ul>
      {q.answers.length > 5 && (
        <button type='button' className='mt-1 rounded-[6px] px-1 text-xs font-medium text-text-action hover:underline' onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${q.answers.length.toLocaleString()}`}
        </button>
      )}
    </>
  );
}

function QuestionResult({ q, n, Text }: { q: SurveyQuestionResult; n: number; Text: TextView }) {
  return (
    <div className='border-t border-border-primary pt-3' data-testid='chq-survey-result-q'>
      <div className='text-sm font-medium'>
        <span className='mr-1 text-text-tertiary'>{n}.</span>
        <Text text={q.prompt || 'Untitled question'} />
      </div>
      <div className='text-xs text-text-tertiary'>{count(q.answered, 'answer')}</div>
      {q.kind === 'rating' && (
        <div className='mt-1.5 flex flex-col gap-1'>
          <div className='text-sm'>
            {q.average === null ? (
              'No ratings yet.'
            ) : (
              <>
                Average <span className='font-semibold'>{q.scale === 5 ? `★ ${q.average.toFixed(1)}` : q.average.toFixed(1)}</span> out of {q.scale}
              </>
            )}
          </div>
          {q.counts.map((c, i) => (
            <div key={i} className='flex items-center gap-2 text-xs'>
              <span className='w-10 shrink-0 text-right text-text-secondary'>{q.scale === 5 ? `${i + 1} ★` : i + 1}</span>
              <Bar pct={pctOf(c, q.answered)} />
              <span className='w-16 shrink-0 text-text-secondary'>
                {c.toLocaleString()} · {pctOf(c, q.answered)}%
              </span>
            </div>
          ))}
        </div>
      )}
      {q.kind === 'choice' && (
        <div className='mt-1.5 flex flex-col gap-1.5'>
          {q.options.map((o) => (
            <div key={o.id} className='flex flex-col gap-0.5 text-xs'>
              <div className='text-sm'>
                <Text text={o.text || '…'} />
              </div>
              <div className='flex items-center gap-2'>
                <Bar pct={pctOf(o.picked, q.answered)} />
                <span className='w-16 shrink-0 text-text-secondary'>
                  {o.picked.toLocaleString()} · {pctOf(o.picked, q.answered)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      {q.kind === 'text' && <TextAnswers q={q} />}
    </div>
  );
}

/** The course report's "Survey results" (nothing when the course has no surveys or they can't be loaded). */
export function SurveyResults({ workspaceId, courseId, Text = PlainText }: { workspaceId: string; courseId: string; Text?: TextView }) {
  useQbankCss();
  const [list, setList] = useState<SurveyResult[] | null>(null);

  useEffect(() => {
    let alive = true;

    setList(null);
    surveyApi.results(workspaceId, courseId).then(
      (r) => {
        if (alive) setList(r);
      },
      () => {
        if (alive) setList([]);
      }
    );
    return () => {
      alive = false;
    };
  }, [workspaceId, courseId]);

  if (!list || !list.length) return null;
  return (
    <ChSection title='Survey results' hint='What people answered in this course’s surveys. Surveys are never graded.'>
      <div className='flex flex-col gap-3' data-testid='chq-survey-results'>
        {list.map((s) => (
          <div key={s.block_id} className='flex flex-col gap-3 rounded-[12px] border border-border-primary p-4'>
            <div>
              <div className='flex flex-wrap items-baseline gap-x-2'>
                <span className='text-sm font-semibold'>{s.title.trim() || 'Survey'}</span>
                <span className='text-xs text-text-tertiary'>
                  {s.lesson_title.trim() || 'Lesson'}
                  {s.anonymous ? ' · Anonymous' : ''}
                </span>
              </div>
              <div className='text-xs text-text-secondary'>{count(s.answered, 'person', 'people')} answered</div>
            </div>
            {s.questions.map((q, i) => (
              <QuestionResult key={q.id || i} q={q} n={i + 1} Text={Text} />
            ))}
          </div>
        ))}
      </div>
    </ChSection>
  );
}

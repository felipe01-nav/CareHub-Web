// CareHub Learning: types, server calls and small helpers shared by the Learning screens
// (My learning, the course player, Studio). The server lives in CareHub-Cloud `carehub_learning.rs`.
import { getTokenParsed } from '@/application/session/token';

import { chCall, chErrorText, CH_API } from './CareHubCore';
import { audioExtras, blankAudioExtras, blankVideoExtras, mediaExtrasProblems, videoExtras } from './CareHubLearningPlayer3';
import {
  blankBlocks3,
  blocks3LinkProblems,
  blocks3Problems,
  blocks3Seconds,
  cloneBlocks3,
  normalizeBlocks3,
} from './CareHubLearningBlocks3';
import {
  blankLabeledGraphic,
  gradeInteract,
  INTERACT_KINDS,
  interactAnswered,
  interactAnswerText,
  interactCorrectAnswer,
  interactFields,
  interactQuestionProblems,
  isInteractKind,
  labeledGraphicProblems,
  labeledGraphicSeconds,
  normalizeLabeledGraphic,
  toInteractKind,
  withoutInteractFields,
} from './CareHubLearningInteract';

import type { Blocks3Block } from './CareHubLearningBlocks3';
import type { InteractKind, InteractQuestionFields, LabeledGraphicBlock } from './CareHubLearningInteract';

export const LEARNING_PATH = '/app/learning';
export const DEFAULT_ACK = 'I have read and understood this course.';
export const NOT_LIVE_TEXT = 'Learning is being switched on — try again in a few minutes.';

// ---------------------------------------------------------------------------
// Course content (drafts and published versions share this shape)
// ---------------------------------------------------------------------------

export type Preset = 'standard' | 'scenario_lab' | 'required_read' | 'certification' | 'microlearning';
export type Completion = 'all_lessons' | 'pass_quiz' | 'all_lessons_and_quiz';
export type ShowAnswers = 'never' | 'after_submit' | 'after_pass';
export type Tone = 'info' | 'tip' | 'warning' | 'success';
export type QuestionKind = 'single' | 'multiple' | 'true_false' | 'matching' | InteractKind;
export type ImageWidth = 'small' | 'medium' | 'full';
export type ListStyle = 'bullet' | 'number' | 'check';

export const PRESET_IDS: Preset[] = ['standard', 'scenario_lab', 'required_read', 'certification', 'microlearning'];
export const QUESTION_KINDS: QuestionKind[] = ['single', 'multiple', 'true_false', 'matching', ...INTERACT_KINDS];

export interface QOption {
  id: string;
  text: string;
  correct: boolean;
}

export interface QPair {
  id: string;
  left: string;
  right: string;
}

/** Right-hand choices of a matching question as the server sends them (shuffled, with opaque tokens). */
export interface QRight {
  token: string;
  text: string;
}

export interface Question extends InteractQuestionFields {
  id: string;
  kind: QuestionKind;
  prompt: string;
  options: QOption[];
  pairs: QPair[];
  /** Only on final-quiz questions from the server (sanitized: no correct flags, no right sides). */
  rights?: QRight[];
  feedback_correct: string;
  feedback_incorrect: string;
  explanation: string;
  points: number;
}

/** single / true_false → option id; multiple → option ids; matching → { pair_id: right token }. */
export type Answer = string | string[] | Record<string, string>;

export interface TextItem {
  id: string;
  title: string;
  text: string;
}

export interface FlashCard {
  id: string;
  front: string;
  back: string;
}

export interface ScenarioChoice {
  id: string;
  text: string;
  feedback: string;
  good: boolean;
  /** Step to go to next; "" ends the scenario. */
  next: string;
}

export interface ScenarioStep {
  id: string;
  text: string;
  choices: ScenarioChoice[];
}

export type Block =
  | { id: string; type: 'heading'; text: string; level: 1 | 2 | 3 }
  | { id: string; type: 'paragraph'; text: string }
  | { id: string; type: 'statement'; text: string }
  | { id: string; type: 'quote'; text: string; cite: string }
  | { id: string; type: 'callout'; title: string; text: string; tone: Tone }
  | { id: string; type: 'list'; style: ListStyle; items: string[] }
  | { id: string; type: 'divider' }
  | { id: string; type: 'image'; url: string; alt: string; caption: string; width: ImageWidth }
  | { id: string; type: 'video'; url: string; caption: string; captions_url: string; captions_label: string; transcript: string }
  | { id: string; type: 'audio'; url: string; caption: string; transcript: string }
  | { id: string; type: 'file'; url: string; name: string }
  | { id: string; type: 'embed'; url: string; height: number }
  | { id: string; type: 'accordion'; items: TextItem[] }
  | { id: string; type: 'tabs'; items: TextItem[] }
  | { id: string; type: 'process'; items: TextItem[] }
  | { id: string; type: 'flashcards'; cards: FlashCard[] }
  | { id: string; type: 'continue'; label: string; require_complete: boolean }
  | { id: string; type: 'knowledge_check'; question: Question }
  | { id: string; type: 'scenario'; title: string; intro: string; start: string; steps: ScenarioStep[] }
  | { id: string; type: 'page_link'; view_id: string; title: string }
  | LabeledGraphicBlock
  | Blocks3Block;

export type BlockType = Block['type'];
export type BlockOf<T extends BlockType> = Extract<Block, { type: T }>;

export const BLOCK_TYPES: BlockType[] = [
  'heading',
  'paragraph',
  'statement',
  'quote',
  'callout',
  'list',
  'divider',
  'image',
  'video',
  'audio',
  'file',
  'embed',
  'accordion',
  'tabs',
  'process',
  'flashcards',
  'continue',
  'knowledge_check',
  'scenario',
  'labeled_graphic',
  'page_link',
  'sorting',
  'timeline',
  'gallery',
  'table',
  'buttons',
];

export interface CourseSettings {
  sequential: boolean;
  min_seconds_per_lesson: number;
  pass_mark: number;
  max_attempts: number;
  show_answers: ShowAnswers;
  require_ack: boolean;
  ack_text: string;
  completion: Completion;
  catalog: boolean;
  /** People who finish get a certificate (the Certificates page lists them). */
  certificate: boolean;
}

export interface Lesson {
  id: string;
  title: string;
  min_seconds: number;
  blocks: Block[];
}

export interface Quiz {
  enabled: boolean;
  title: string;
  questions: Question[];
  pool_size: number;
  shuffle: boolean;
}

export interface Content {
  title: string;
  summary: string;
  cover: string;
  preset: Preset;
  est_minutes: number;
  settings: CourseSettings;
  lessons: Lesson[];
  quiz: Quiz;
}

export interface PlayQuiz extends Quiz {
  attempts_used: number;
  attempts_left: number | null;
  locked_reason: string | null;
}

export interface PlayCourse extends Content {
  id: string;
  version: number;
  quiz: PlayQuiz;
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export type LearnStatus = 'in_progress' | 'completed' | 'passed' | 'failed';

export interface MyProgress {
  status: LearnStatus;
  percent: number;
  score: number | null;
  attempts: number;
  time_ms: number;
  started_ms: number;
  last_ms: number;
  completed_ms: number | null;
  ack_ms: number | null;
  awaiting_ack: boolean;
  version: number;
}

export interface LessonProgress {
  done: boolean;
  active_ms: number;
  blocks_done: string[];
  done_ms: number | null;
}

export interface KcRecord {
  answer: unknown;
  correct: boolean;
  ms?: number;
}

export interface Enrollment extends MyProgress {
  progress: {
    lessons: Record<string, LessonProgress>;
    kc: Record<string, KcRecord>;
    position: { lesson_id: string; block_id: string } | null;
    quiz_active_ms: number;
  };
}

export interface CourseCard {
  id: string;
  title: string;
  summary: string;
  cover: string;
  preset: Preset;
  version: number;
  lessons: number;
  est_minutes: number;
  quiz: boolean;
  archived: boolean;
  updated_ms: number;
  my: MyProgress | null;
}

export type EventKind = 'lesson_open' | 'heartbeat' | 'block_complete' | 'kc_answer' | 'lesson_complete';

export interface LearnEvent {
  kind: EventKind;
  lesson_id: string;
  block_id?: string;
  active_ms?: number;
  data?: unknown;
  ts_ms: number;
}

export interface Rejected {
  i: number;
  reason: string;
}

export interface QuizResult {
  question_id: string;
  correct: boolean;
  earned: number;
  points: number;
  feedback: string;
  correct_answer?: Answer;
  explanation?: string;
}

export interface QuizResponse {
  score: number;
  passed: boolean;
  attempts_used: number;
  attempts_left: number | null;
  results: QuizResult[];
  enrollment: Enrollment | null;
}

// ---------------------------------------------------------------------------
// Studio
// ---------------------------------------------------------------------------

export type CourseStatus = 'draft' | 'published' | 'archived';

export interface StudioRow {
  id: string;
  title: string;
  status: CourseStatus;
  has_unpublished_changes: boolean;
  published_version: number | null;
  updated_ms: number;
  updated_by_name: string;
  created_by_name: string;
  started: number;
  finished: number;
}

export interface VersionRow {
  version: number;
  published_ms: number;
  published_by_name: string;
  note: string;
}

export interface StudioCourse {
  id: string;
  status: CourseStatus;
  draft: Content;
  updated_ms: number;
  published_version: number | null;
  has_unpublished_changes: boolean;
  versions: VersionRow[];
}

export interface VersionDetail {
  version: number;
  content: Content;
  published_ms: number;
  published_by_name: string;
  note: string;
}

// ---------------------------------------------------------------------------
// Server calls
// ---------------------------------------------------------------------------

const base = (ws: string) => `${CH_API}/${ws}/learning`;
const enc = encodeURIComponent;

export const lapi = {
  catalog: (ws: string) =>
    chCall<{ courses: unknown[] }>('get', `${base(ws)}/catalog`).then((d) => arr(obj(d).courses).map(normalizeCard)),
  my: (ws: string) => {
    // Learning is starting: delete any progress someone else left waiting on this computer.
    clearOtherQueues(signedInPerson());

    return chCall<{ courses: unknown[] }>('get', `${base(ws)}/my`).then((d) => arr(obj(d).courses).map(normalizeCard));
  },
  play: (ws: string, id: string) =>
    chCall<unknown>('get', `${base(ws)}/courses/${enc(id)}/play`).then((d) => ({
      course: normalizePlay(obj(d).course, id),
      enrollment: normalizeEnrollment(obj(d).enrollment),
    })),
  start: (ws: string, id: string) =>
    chCall<unknown>('post', `${base(ws)}/courses/${enc(id)}/start`, {}).then((d) => normalizeEnrollment(obj(d).enrollment)),
  progress: (ws: string, id: string, events: LearnEvent[], position?: { lesson_id: string; block_id: string } | null) =>
    chCall<unknown>('post', `${base(ws)}/courses/${enc(id)}/progress`, position ? { events, position } : { events }).then((d) => ({
      enrollment: normalizeEnrollment(obj(d).enrollment),
      rejected: arr(obj(d).rejected).map((r) => ({ i: num(obj(r).i, -1), reason: str(obj(r).reason) })),
    })),
  quiz: (ws: string, id: string, answers: Record<string, Answer>) =>
    chCall<unknown>('post', `${base(ws)}/courses/${enc(id)}/quiz`, { answers }).then((d) => normalizeQuizResponse(d)),
  ack: (ws: string, id: string) =>
    chCall<unknown>('post', `${base(ws)}/courses/${enc(id)}/ack`, {}).then((d) => normalizeEnrollment(obj(d).enrollment)),

  studioList: (ws: string) =>
    chCall<unknown>('get', `${base(ws)}/studio`).then((d) => arr(obj(d).courses).map(normalizeStudioRow)),
  studioCreate: (ws: string, body: { title: string; preset?: Preset; content?: Content }) =>
    chCall<unknown>('post', `${base(ws)}/studio`, body).then((d) => str(obj(d).id)),
  studioGet: (ws: string, id: string) => chCall<unknown>('get', `${base(ws)}/studio/${enc(id)}`).then(normalizeStudioCourse),
  studioSave: (ws: string, id: string, draft: Content, baseUpdatedMs: number) =>
    chCall<unknown>('put', `${base(ws)}/studio/${enc(id)}`, { draft, base_updated_ms: baseUpdatedMs }).then((d) =>
      num(obj(d).updated_ms, Date.now())
    ),
  publish: (ws: string, id: string, note: string) =>
    chCall<unknown>('post', `${base(ws)}/studio/${enc(id)}/publish`, note.trim() ? { note: note.trim() } : {}).then((d) =>
      num(obj(d).version, 0)
    ),
  duplicate: (ws: string, id: string) =>
    chCall<unknown>('post', `${base(ws)}/studio/${enc(id)}/duplicate`, {}).then((d) => str(obj(d).id)),
  archive: (ws: string, id: string, archived: boolean) =>
    chCall<unknown>('post', `${base(ws)}/studio/${enc(id)}/archive`, { archived }),
  rollback: (ws: string, id: string, version: number) =>
    chCall<unknown>('post', `${base(ws)}/studio/${enc(id)}/rollback`, { version }).then((d) => num(obj(d).updated_ms, 0)),
  version: (ws: string, id: string, version: number) =>
    chCall<unknown>('get', `${base(ws)}/studio/${enc(id)}/versions/${version}`).then((d): VersionDetail => {
      const o = obj(d);

      return {
        version: num(o.version, version),
        content: normalizeContent(o.content),
        published_ms: num(o.published_ms),
        published_by_name: str(o.published_by_name),
        note: str(o.note),
      };
    }),
  remove: (ws: string, id: string) => chCall<unknown>('delete', `${base(ws)}/studio/${enc(id)}`),
};

/**
 * True only when the Learning routes aren't deployed yet: a real HTTP 404 with no Care Hub error code.
 * The server's own "not found" answers ("This course isn't available.") arrive as HTTP 200 with an
 * error code and a message, so they show their message instead.
 */
export function learningNotLive(err: unknown) {
  const e = (err || {}) as { httpStatus?: number; sourceDomain?: string; code?: number };
  const status = e.httpStatus ?? (e.sourceDomain === 'http' ? e.code : undefined);

  return status === 404 && e.sourceDomain !== 'appflowy.server';
}

export function lErrorText(err: unknown) {
  return learningNotLive(err) ? NOT_LIVE_TEXT : chErrorText(err);
}

/** Network trouble (worth retrying later) rather than a message from the server. */
export function isTransientError(err: unknown) {
  const e = (err || {}) as { httpStatus?: number; sourceDomain?: string };

  // A Care Hub message (refusal, "not available", validation) won't change by retrying.
  if (e.sourceDomain === 'appflowy.server') return false;
  // Routes not deployed yet: keep progress and try again later.
  if (learningNotLive(err)) return true;
  const status = e.httpStatus ?? 0;

  return status === 0 || status >= 500 || status === 408 || status === 429 || e.sourceDomain === 'transport';
}

// ---------------------------------------------------------------------------
// Defensive parsing (never trust shapes blindly — a bad course must not crash the page)
// ---------------------------------------------------------------------------

export function str(v: unknown, d = '') {
  return typeof v === 'string' ? v : d;
}

export function num(v: unknown, d = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

function bool(v: unknown, d = false) {
  return typeof v === 'boolean' ? v : d;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function oneOf<T extends string>(v: unknown, list: readonly T[], d: T): T {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : d;
}

export function clampInt(v: number, lo: number, hi: number) {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

function textItems(v: unknown, prefix: string): TextItem[] {
  return arr(v).map((x) => {
    const o = obj(x);

    return { id: str(o.id) || newId(prefix), title: str(o.title), text: str(o.text) };
  });
}

export function normalizeQuestion(raw: unknown): Question {
  const o = obj(raw);
  const q: Question = {
    id: str(o.id) || newId('q'),
    kind: oneOf(o.kind, QUESTION_KINDS, 'single'),
    prompt: str(o.prompt),
    options: arr(o.options).map((x) => {
      const p = obj(x);

      return { id: str(p.id) || newId('o'), text: str(p.text), correct: bool(p.correct) };
    }),
    pairs: arr(o.pairs).map((x) => {
      const p = obj(x);

      return { id: str(p.id) || newId('p'), left: str(p.left), right: str(p.right) };
    }),
    feedback_correct: str(o.feedback_correct),
    feedback_incorrect: str(o.feedback_incorrect),
    explanation: str(o.explanation),
    points: Math.max(1, clampInt(num(o.points, 1), 1, 1000)),
  };

  if (Array.isArray(o.rights)) {
    q.rights = arr(o.rights).map((x) => ({ token: str(obj(x).token), text: str(obj(x).text) }));
  }

  Object.assign(q, interactFields(o, q.kind));
  return q;
}

export function normalizeBlock(raw: unknown): Block | null {
  const o = obj(raw);
  const id = str(o.id);

  if (!id) return null;
  switch (o.type) {
    case 'heading':
      return { id, type: 'heading', text: str(o.text), level: o.level === 1 || o.level === 3 ? o.level : 2 };
    case 'paragraph':
      return { id, type: 'paragraph', text: str(o.text) };
    case 'statement':
      return { id, type: 'statement', text: str(o.text) };
    case 'quote':
      return { id, type: 'quote', text: str(o.text), cite: str(o.cite) };
    case 'callout':
      return { id, type: 'callout', title: str(o.title), text: str(o.text), tone: oneOf(o.tone, ['info', 'tip', 'warning', 'success'], 'info') };
    case 'list':
      return {
        id,
        type: 'list',
        style: oneOf(o.style, ['bullet', 'number', 'check'], 'bullet'),
        items: arr(o.items).map((x) => str(x)),
      };
    case 'divider':
      return { id, type: 'divider' };
    case 'image':
      return {
        id,
        type: 'image',
        url: str(o.url),
        alt: str(o.alt),
        caption: str(o.caption),
        width: oneOf(o.width, ['small', 'medium', 'full'], 'full'),
      };
    case 'video':
      return { id, type: 'video', url: str(o.url), caption: str(o.caption), ...videoExtras(o) };
    case 'audio':
      return { id, type: 'audio', url: str(o.url), caption: str(o.caption), ...audioExtras(o) };
    case 'file':
      return { id, type: 'file', url: str(o.url), name: str(o.name) };
    case 'embed':
      return { id, type: 'embed', url: str(o.url), height: clampInt(num(o.height, 480), 120, 2000) };
    case 'accordion':
      return { id, type: 'accordion', items: textItems(o.items, 'i') };
    case 'tabs':
      return { id, type: 'tabs', items: textItems(o.items, 'i') };
    case 'process':
      return { id, type: 'process', items: textItems(o.items, 'i') };
    case 'flashcards':
      return {
        id,
        type: 'flashcards',
        cards: arr(o.cards).map((x) => {
          const c = obj(x);

          return { id: str(c.id) || newId('c'), front: str(c.front), back: str(c.back) };
        }),
      };
    case 'continue':
      return { id, type: 'continue', label: str(o.label), require_complete: bool(o.require_complete) };
    case 'knowledge_check':
      return { id, type: 'knowledge_check', question: normalizeQuestion(o.question) };
    case 'scenario':
      return {
        id,
        type: 'scenario',
        title: str(o.title),
        intro: str(o.intro),
        start: str(o.start),
        steps: arr(o.steps).map((x) => {
          const s = obj(x);

          return {
            id: str(s.id) || newId('s'),
            text: str(s.text),
            choices: arr(s.choices).map((y) => {
              const c = obj(y);

              return { id: str(c.id) || newId('ch'), text: str(c.text), feedback: str(c.feedback), good: bool(c.good), next: str(c.next) };
            }),
          };
        }),
      };
    case 'labeled_graphic':
      return normalizeLabeledGraphic(o, id);
    case 'sorting':
    case 'timeline':
    case 'gallery':
    case 'table':
    case 'buttons':
      return normalizeBlocks3(o, id);
    case 'page_link':
      return { id, type: 'page_link', view_id: str(o.view_id), title: str(o.title) };
    default:
      return null;
  }
}

export function normalizeLesson(raw: unknown, index = 0): Lesson {
  const o = obj(raw);

  return {
    id: str(o.id) || `l_lesson${index + 1}`,
    title: str(o.title),
    min_seconds: clampInt(num(o.min_seconds), 0, 86400),
    blocks: arr(o.blocks)
      .map(normalizeBlock)
      .filter((b): b is Block => b !== null),
  };
}

export function normalizeContent(raw: unknown): Content {
  const o = obj(raw);
  const s = obj(o.settings);
  const q = obj(o.quiz);

  return {
    title: str(o.title),
    summary: str(o.summary),
    cover: str(o.cover),
    preset: oneOf(o.preset, PRESET_IDS, 'standard'),
    est_minutes: clampInt(num(o.est_minutes), 0, 100000),
    settings: {
      sequential: bool(s.sequential),
      min_seconds_per_lesson: clampInt(num(s.min_seconds_per_lesson), 0, 86400),
      pass_mark: clampInt(num(s.pass_mark, 80), 0, 100),
      max_attempts: clampInt(num(s.max_attempts), 0, 20),
      show_answers: oneOf(s.show_answers, ['never', 'after_submit', 'after_pass'], 'after_pass'),
      require_ack: bool(s.require_ack),
      ack_text: typeof s.ack_text === 'string' ? s.ack_text : DEFAULT_ACK,
      completion: oneOf(s.completion, ['all_lessons', 'pass_quiz', 'all_lessons_and_quiz'], 'all_lessons'),
      catalog: bool(s.catalog, true),
      certificate: bool(s.certificate),
    },
    lessons: arr(o.lessons).map(normalizeLesson),
    quiz: {
      enabled: bool(q.enabled),
      title: str(q.title) || 'Final quiz',
      questions: arr(q.questions).map(normalizeQuestion),
      pool_size: clampInt(num(q.pool_size), 0, 10000),
      shuffle: bool(q.shuffle, true),
    },
  };
}

export function normalizePlay(raw: unknown, id: string): PlayCourse {
  const o = obj(raw);
  const q = obj(o.quiz);
  const content = normalizeContent(raw);

  return {
    ...content,
    id: str(o.id) || id,
    version: num(o.version, 1),
    quiz: {
      ...content.quiz,
      attempts_used: num(q.attempts_used),
      attempts_left: typeof q.attempts_left === 'number' ? q.attempts_left : null,
      locked_reason: typeof q.locked_reason === 'string' && q.locked_reason ? q.locked_reason : null,
    },
  };
}

function normalizeMy(raw: unknown): MyProgress | null {
  const o = obj(raw);

  if (!raw || typeof raw !== 'object') return null;
  return {
    status: oneOf(o.status, ['in_progress', 'completed', 'passed', 'failed'], 'in_progress'),
    percent: clampInt(num(o.percent), 0, 100),
    score: typeof o.score === 'number' ? o.score : null,
    attempts: num(o.attempts),
    time_ms: num(o.time_ms),
    started_ms: num(o.started_ms),
    last_ms: num(o.last_ms),
    completed_ms: typeof o.completed_ms === 'number' ? o.completed_ms : null,
    ack_ms: typeof o.ack_ms === 'number' ? o.ack_ms : null,
    awaiting_ack: bool(o.awaiting_ack),
    version: num(o.version, 1),
  };
}

export function normalizeEnrollment(raw: unknown): Enrollment | null {
  const my = normalizeMy(raw);

  if (!my) return null;
  const p = obj(obj(raw).progress);
  const lessons: Record<string, LessonProgress> = {};

  for (const [k, v] of Object.entries(obj(p.lessons))) {
    const l = obj(v);

    lessons[k] = {
      done: bool(l.done),
      active_ms: num(l.active_ms),
      blocks_done: arr(l.blocks_done).filter((x): x is string => typeof x === 'string'),
      done_ms: typeof l.done_ms === 'number' ? l.done_ms : null,
    };
  }

  const kc: Record<string, KcRecord> = {};

  for (const [k, v] of Object.entries(obj(p.kc))) {
    const r = obj(v);

    kc[k] = { answer: r.answer, correct: bool(r.correct), ms: num(r.ms) };
  }

  const pos = obj(p.position);

  return {
    ...my,
    progress: {
      lessons,
      kc,
      position: typeof pos.lesson_id === 'string' ? { lesson_id: pos.lesson_id, block_id: str(pos.block_id) } : null,
      quiz_active_ms: num(p.quiz_active_ms),
    },
  };
}

function normalizeCard(raw: unknown): CourseCard {
  const o = obj(raw);

  return {
    id: str(o.id),
    title: str(o.title) || 'Untitled course',
    summary: str(o.summary),
    cover: str(o.cover),
    preset: oneOf(o.preset, PRESET_IDS, 'standard'),
    version: num(o.version, 1),
    lessons: num(o.lessons),
    est_minutes: num(o.est_minutes),
    quiz: bool(o.quiz),
    archived: bool(o.archived),
    updated_ms: num(o.updated_ms),
    my: normalizeMy(o.my),
  };
}

function normalizeStudioRow(raw: unknown): StudioRow {
  const o = obj(raw);

  return {
    id: str(o.id),
    title: str(o.title) || 'Untitled course',
    status: oneOf(o.status, ['draft', 'published', 'archived'], 'draft'),
    has_unpublished_changes: bool(o.has_unpublished_changes),
    published_version: typeof o.published_version === 'number' ? o.published_version : null,
    updated_ms: num(o.updated_ms),
    updated_by_name: str(o.updated_by_name),
    created_by_name: str(o.created_by_name),
    started: num(o.started),
    finished: num(o.finished),
  };
}

function normalizeStudioCourse(raw: unknown): StudioCourse {
  const o = obj(raw);

  return {
    id: str(o.id),
    status: oneOf(o.status, ['draft', 'published', 'archived'], 'draft'),
    draft: normalizeContent(o.draft),
    updated_ms: num(o.updated_ms),
    published_version: typeof o.published_version === 'number' ? o.published_version : null,
    has_unpublished_changes: bool(o.has_unpublished_changes),
    versions: arr(o.versions)
      .map((x) => {
        const v = obj(x);

        return { version: num(v.version), published_ms: num(v.published_ms), published_by_name: str(v.published_by_name), note: str(v.note) };
      })
      .sort((a, b) => b.version - a.version),
  };
}

function normalizeQuizResponse(raw: unknown): QuizResponse {
  const o = obj(raw);

  return {
    score: num(o.score),
    passed: bool(o.passed),
    attempts_used: num(o.attempts_used),
    attempts_left: typeof o.attempts_left === 'number' ? o.attempts_left : null,
    results: arr(o.results).map((x) => {
      const r = obj(x);
      const out: QuizResult = {
        question_id: str(r.question_id),
        correct: bool(r.correct),
        earned: num(r.earned),
        points: num(r.points, 1),
        feedback: str(r.feedback),
      };

      if (r.correct_answer !== undefined && r.correct_answer !== null) out.correct_answer = r.correct_answer as Answer;
      if (typeof r.explanation === 'string' && r.explanation) out.explanation = r.explanation;
      return out;
    }),
    enrollment: normalizeEnrollment(o.enrollment),
  };
}

// ---------------------------------------------------------------------------
// Ids, hashing, shuffles
// ---------------------------------------------------------------------------

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function newId(prefix: string) {
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

export function hashString(s: string) {
  let h = 0x811c9dc5;

  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }

  return h >>> 0;
}

export function seededShuffle<T>(items: T[], seed: string): T[] {
  const out = items.slice();
  let a = hashString(seed) || 1;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i];

    out[i] = out[j];
    out[j] = tmp;
  }

  return out;
}

/** New ids for a copied block (and everything inside it), keeping scenario links intact. */
export function cloneBlock(b: Block): Block {
  const copy = JSON.parse(JSON.stringify(b)) as Block;

  copy.id = newId('b');
  switch (copy.type) {
    case 'accordion':
    case 'tabs':
    case 'process':
      copy.items = copy.items.map((it) => ({ ...it, id: newId('i') }));
      break;
    case 'flashcards':
      copy.cards = copy.cards.map((c) => ({ ...c, id: newId('c') }));
      break;
    case 'knowledge_check':
      copy.question = cloneQuestion(copy.question);
      break;
    case 'labeled_graphic':
      copy.markers = copy.markers.map((m) => ({ ...m, id: newId('m') }));
      break;
    case 'sorting':
    case 'timeline':
    case 'gallery':
    case 'table':
    case 'buttons':
      return cloneBlocks3(copy);
    case 'scenario': {
      const map = new Map<string, string>();

      copy.steps.forEach((s) => map.set(s.id, newId('s')));
      copy.start = map.get(copy.start) || copy.start;
      copy.steps = copy.steps.map((s) => ({
        id: map.get(s.id) || newId('s'),
        text: s.text,
        choices: s.choices.map((c) => ({ ...c, id: newId('ch'), next: c.next ? map.get(c.next) || c.next : '' })),
      }));
      break;
    }

    default:
      break;
  }

  return copy;
}

export function cloneQuestion(q: Question): Question {
  const copy = JSON.parse(JSON.stringify(q)) as Question;

  copy.id = newId('q');
  copy.options = copy.options.map((o) => ({ ...o, id: newId('o') }));
  copy.pairs = copy.pairs.map((p) => ({ ...p, id: newId('p') }));
  if (copy.items) copy.items = copy.items.map((it) => ({ ...it, id: newId('i') }));
  if (copy.spots) copy.spots = copy.spots.map((sp) => ({ ...sp, id: newId('s') }));
  delete copy.rights;
  return copy;
}

export function cloneLesson(l: Lesson): Lesson {
  return { ...l, id: newId('l'), title: l.title ? `${l.title} (copy)` : '', blocks: l.blocks.map(cloneBlock) };
}

// ---------------------------------------------------------------------------
// Questions: answering and grading in the browser (knowledge checks and Studio preview)
// ---------------------------------------------------------------------------

/** The right-hand choices for a matching question: the server's tokens, or (practice/preview) pair ids. */
export function matchingRights(q: Question): QRight[] {
  if (q.rights && q.rights.length) return q.rights;
  const seen = new Set<string>();
  const list: QRight[] = [];

  for (const p of q.pairs) {
    const text = p.right.trim();

    if (!text || seen.has(text)) continue;
    seen.add(text);
    list.push({ token: p.id, text: p.right });
  }

  return seededShuffle(list, q.id);
}

export function isAnswered(q: Question, a: Answer | undefined): boolean {
  if (isInteractKind(q.kind)) return interactAnswered(q, a);
  if (q.kind === 'multiple') return Array.isArray(a) && a.length > 0;
  if (q.kind === 'matching') {
    if (!a || typeof a !== 'object' || Array.isArray(a)) return false;
    const m = a as Record<string, string>;

    return q.pairs.length > 0 && q.pairs.every((p) => typeof m[p.id] === 'string' && m[p.id] !== '');
  }

  return typeof a === 'string' && a !== '';
}

/** Grades a full (not sanitized) question. All-or-nothing. */
export function gradeQuestion(q: Question, a: Answer | undefined): boolean {
  if (!isAnswered(q, a)) return false;
  if (isInteractKind(q.kind)) return gradeInteract(q, a);
  if (q.kind === 'multiple') {
    const want = q.options
      .filter((o) => o.correct)
      .map((o) => o.id)
      .sort();
    const got = Array.from(new Set(a as string[])).sort();

    return want.length > 0 && want.join('|') === got.join('|');
  }

  if (q.kind === 'matching') {
    const m = a as Record<string, string>;

    return q.pairs.every((p) => {
      const picked = q.pairs.find((x) => x.id === m[p.id]);

      return Boolean(picked) && (picked as QPair).right.trim() === p.right.trim();
    });
  }

  const correct = q.options.filter((o) => o.correct);

  return correct.length === 1 && correct[0].id === a;
}

/** The correct answer of a full question, in Answer form (for showing after a check). */
export function correctAnswerOf(q: Question): Answer {
  if (isInteractKind(q.kind)) return interactCorrectAnswer(q);
  if (q.kind === 'multiple') return q.options.filter((o) => o.correct).map((o) => o.id);
  if (q.kind === 'matching') {
    const rights = matchingRights(q);
    const m: Record<string, string> = {};

    for (const p of q.pairs) {
      const r = rights.find((x) => x.text.trim() === p.right.trim());

      m[p.id] = r ? r.token : p.id;
    }

    return m;
  }

  return q.options.find((o) => o.correct)?.id || '';
}

/** Words for a correct answer, e.g. "B and D" or "Refund → Billing team". */
export function answerText(q: Question, a: Answer | undefined): string {
  if (a === undefined || a === null) return '';
  if (isInteractKind(q.kind)) return interactAnswerText(q, a);
  if (q.kind === 'matching') {
    if (typeof a !== 'object' || Array.isArray(a)) return '';
    const rights = matchingRights(q);
    const m = a as Record<string, string>;

    return q.pairs
      .map((p) => {
        const r = rights.find((x) => x.token === m[p.id]);

        return `${p.left || '…'} → ${r ? r.text : '…'}`;
      })
      .join('; ');
  }

  const ids = Array.isArray(a) ? a : [a];
  const texts = ids
    .map((id) => q.options.find((o) => o.id === id)?.text || '')
    .filter(Boolean);

  if (texts.length <= 1) return texts[0] || '';
  return `${texts.slice(0, -1).join(', ')} and ${texts[texts.length - 1]}`;
}

export function blankQuestion(kind: QuestionKind): Question {
  const q: Question = {
    id: newId('q'),
    kind,
    prompt: '',
    options: [],
    pairs: [],
    feedback_correct: '',
    feedback_incorrect: '',
    explanation: '',
    points: 1,
  };

  return setQuestionKind(q, kind);
}

/** Switches a question's kind, keeping what still makes sense. */
export function setQuestionKind(q: Question, kind: QuestionKind): Question {
  if (isInteractKind(kind)) return toInteractKind(q, kind);
  const next: Question = { ...withoutInteractFields(q), kind };

  if (kind === 'true_false') {
    const wasTrue = q.kind === 'true_false' ? q.options[0]?.correct !== false : true;

    next.options = [
      { id: q.kind === 'true_false' && q.options[0] ? q.options[0].id : newId('o'), text: 'True', correct: wasTrue },
      { id: q.kind === 'true_false' && q.options[1] ? q.options[1].id : newId('o'), text: 'False', correct: !wasTrue },
    ];
    next.pairs = [];
  } else if (kind === 'matching') {
    next.options = [];
    next.pairs = q.pairs.length
      ? q.pairs
      : [
          { id: newId('p'), left: '', right: '' },
          { id: newId('p'), left: '', right: '' },
        ];
  } else {
    let options = q.kind === 'true_false' || !q.options.length ? [] : q.options;

    if (!options.length) {
      options = [
        { id: newId('o'), text: '', correct: true },
        { id: newId('o'), text: '', correct: false },
      ];
    }

    if (kind === 'single') {
      const first = options.findIndex((o) => o.correct);

      options = options.map((o, i) => ({ ...o, correct: i === (first < 0 ? 0 : first) }));
    }

    next.options = options;
    next.pairs = [];
  }

  return next;
}

// ---------------------------------------------------------------------------
// Presets, starter content, estimates, checks before publishing
// ---------------------------------------------------------------------------

export const PRESETS: { id: Preset; emoji: string; label: string; hint: string }[] = [
  { id: 'standard', emoji: '📘', label: 'Standard course', hint: 'Lessons in any order. Done when every lesson is finished.' },
  { id: 'scenario_lab', emoji: '💬', label: 'Scenario lab', hint: 'Practice conversations and quick checks, in order.' },
  { id: 'required_read', emoji: '📜', label: 'Required read', hint: 'A policy or update people read in order and confirm.' },
  { id: 'certification', emoji: '🏅', label: 'Certification', hint: 'Lessons in order, a final quiz to pass (80%), then a certificate.' },
  { id: 'microlearning', emoji: '⚡', label: 'Microlearning', hint: 'One short lesson — a few minutes, any time.' },
];

export function presetInfo(id: Preset) {
  return PRESETS.find((p) => p.id === id) || PRESETS[0];
}

export function defaultSettings(): CourseSettings {
  return {
    sequential: false,
    min_seconds_per_lesson: 0,
    pass_mark: 80,
    max_attempts: 0,
    show_answers: 'after_pass',
    require_ack: false,
    ack_text: DEFAULT_ACK,
    completion: 'all_lessons',
    catalog: true,
    certificate: false,
  };
}

/** Applies a preset's settings (the content stays; the quiz is switched on/off where the preset says so). */
export function applyPreset(c: Content, preset: Preset): Content {
  const s: CourseSettings = { ...c.settings };
  const quiz: Quiz = { ...c.quiz };

  switch (preset) {
    case 'standard':
      s.sequential = false;
      s.require_ack = false;
      s.min_seconds_per_lesson = 0;
      s.completion = quiz.enabled ? 'all_lessons_and_quiz' : 'all_lessons';
      break;
    case 'scenario_lab':
      s.sequential = true;
      s.require_ack = false;
      s.min_seconds_per_lesson = 0;
      s.completion = quiz.enabled ? 'all_lessons_and_quiz' : 'all_lessons';
      break;
    case 'required_read':
      s.sequential = true;
      s.require_ack = true;
      s.ack_text = s.ack_text.trim() ? s.ack_text : DEFAULT_ACK;
      s.min_seconds_per_lesson = 30;
      s.completion = 'all_lessons';
      quiz.enabled = false;
      break;
    case 'certification':
      s.sequential = true;
      s.require_ack = false;
      s.pass_mark = 80;
      s.max_attempts = 3;
      s.completion = 'all_lessons_and_quiz';
      s.show_answers = 'after_pass';
      s.certificate = true;
      quiz.enabled = true;
      break;
    case 'microlearning':
      s.sequential = false;
      s.require_ack = false;
      s.min_seconds_per_lesson = 0;
      s.completion = quiz.enabled ? 'all_lessons_and_quiz' : 'all_lessons';
      break;
    default:
      break;
  }

  return { ...c, preset, settings: s, quiz };
}

export function blankBlock(type: BlockType): Block {
  const id = newId('b');

  switch (type) {
    case 'heading':
      return { id, type, text: '', level: 2 };
    case 'paragraph':
      return { id, type, text: '' };
    case 'statement':
      return { id, type, text: '' };
    case 'quote':
      return { id, type, text: '', cite: '' };
    case 'callout':
      return { id, type, title: '', text: '', tone: 'tip' };
    case 'list':
      return { id, type, style: 'bullet', items: ['', ''] };
    case 'divider':
      return { id, type };
    case 'image':
      return { id, type, url: '', alt: '', caption: '', width: 'full' };
    case 'video':
      return { id, type, url: '', caption: '', ...blankVideoExtras() };
    case 'audio':
      return { id, type, url: '', caption: '', ...blankAudioExtras() };
    case 'file':
      return { id, type, url: '', name: '' };
    case 'embed':
      return { id, type, url: '', height: 480 };
    case 'accordion':
      return {
        id,
        type,
        items: [
          { id: newId('i'), title: '', text: '' },
          { id: newId('i'), title: '', text: '' },
        ],
      };
    case 'tabs':
      return {
        id,
        type,
        items: [
          { id: newId('i'), title: 'First', text: '' },
          { id: newId('i'), title: 'Second', text: '' },
        ],
      };
    case 'process':
      return {
        id,
        type,
        items: [
          { id: newId('i'), title: '', text: '' },
          { id: newId('i'), title: '', text: '' },
          { id: newId('i'), title: '', text: '' },
        ],
      };
    case 'flashcards':
      return {
        id,
        type,
        cards: [
          { id: newId('c'), front: '', back: '' },
          { id: newId('c'), front: '', back: '' },
        ],
      };
    case 'continue':
      return { id, type, label: 'Continue', require_complete: false };
    case 'knowledge_check':
      return { id, type, question: blankQuestion('single') };
    case 'scenario': {
      const s1 = newId('s');
      const s2 = newId('s');

      return {
        id,
        type,
        title: '',
        intro: '',
        start: s1,
        steps: [
          {
            id: s1,
            text: '',
            choices: [
              { id: newId('ch'), text: '', feedback: '', good: true, next: s2 },
              { id: newId('ch'), text: '', feedback: '', good: false, next: s2 },
            ],
          },
          { id: s2, text: '', choices: [{ id: newId('ch'), text: '', feedback: '', good: true, next: '' }] },
        ],
      };
    }

    case 'labeled_graphic':
      return blankLabeledGraphic(id);
    case 'sorting':
    case 'timeline':
    case 'gallery':
    case 'table':
    case 'buttons':
      return blankBlocks3(type, id);
    case 'page_link':
    default:
      return { id, type: 'page_link', view_id: '', title: '' };
  }
}

export function blankLesson(title = ''): Lesson {
  return { id: newId('l'), title, min_seconds: 0, blocks: [] };
}

/** A new course for a preset, with a few starter blocks so the editor isn't empty. */
export function starterContent(preset: Preset, title: string): Content {
  const p = (text: string): Block => ({ id: newId('b'), type: 'paragraph', text });
  const h = (text: string): Block => ({ id: newId('b'), type: 'heading', text, level: 2 });
  const lesson = (name: string, blocks: Block[]): Lesson => ({ id: newId('l'), title: name, min_seconds: 0, blocks });
  let lessons: Lesson[] = [];
  const quiz: Quiz = { enabled: false, title: 'Final quiz', questions: [], pool_size: 0, shuffle: true };

  if (preset === 'scenario_lab') {
    const kc = blankBlock('knowledge_check');
    const scenario = blankBlock('scenario');

    lessons = [
      lesson('The situation', [h('What you will practice'), p('Describe the situation the learner is about to handle.')]),
      lesson('Practice', [scenario, { id: newId('b'), type: 'continue', label: 'Continue', require_complete: true }, kc]),
    ];
  } else if (preset === 'required_read') {
    lessons = [
      lesson('What changed', [
        { id: newId('b'), type: 'callout', title: 'Why this matters', text: 'Say in one or two sentences why everyone needs to read this.', tone: 'info' },
        p('Write the policy or update here.'),
      ]),
    ];
  } else if (preset === 'certification') {
    quiz.enabled = true;
    quiz.questions = [blankQuestion('single')];
    lessons = [lesson('Lesson 1', [h('Welcome'), p('Explain what this lesson covers.')])];
  } else if (preset === 'microlearning') {
    lessons = [lesson('Quick lesson', [p('One idea, explained in a few sentences.'), blankBlock('knowledge_check')])];
  } else {
    lessons = [lesson('Welcome', [h('Welcome'), p('Explain what this course covers and why it matters.')])];
  }

  const content: Content = {
    title,
    summary: '',
    cover: '',
    preset: 'standard',
    est_minutes: 0,
    settings: defaultSettings(),
    lessons,
    quiz,
  };
  const withPreset = applyPreset(content, preset);

  return { ...withPreset, est_minutes: estimateMinutes(withPreset) };
}

function words(s: string) {
  const t = s.trim();

  return t ? t.split(/\s+/).length : 0;
}

/** Rough time to finish, in whole minutes (reading at ~200 words a minute plus time for media and practice). */
export function estimateMinutes(c: Content) {
  let seconds = 0;

  for (const l of c.lessons) {
    let lesson = 0;

    for (const b of l.blocks) {
      switch (b.type) {
        case 'heading':
        case 'paragraph':
        case 'statement':
        case 'quote':
          lesson += words(b.text) * 0.3;
          break;
        case 'callout':
          lesson += words(`${b.title} ${b.text}`) * 0.3;
          break;
        case 'list':
          lesson += words(b.items.join(' ')) * 0.3;
          break;
        case 'accordion':
        case 'tabs':
        case 'process':
          lesson += b.items.reduce((n, it) => n + words(`${it.title} ${it.text}`), 0) * 0.3 + 5 * b.items.length;
          break;
        case 'flashcards':
          lesson += b.cards.length * 10;
          break;
        case 'image':
          lesson += 10;
          break;
        case 'video':
          lesson += 180;
          break;
        case 'audio':
          lesson += 120;
          break;
        case 'embed':
          lesson += 120;
          break;
        case 'file':
        case 'page_link':
          lesson += 30;
          break;
        case 'labeled_graphic':
          lesson += labeledGraphicSeconds(b);
          break;
        case 'sorting':
        case 'timeline':
        case 'gallery':
        case 'table':
        case 'buttons':
          lesson += blocks3Seconds(b);
          break;
        case 'knowledge_check':
          lesson += 30;
          break;
        case 'scenario':
          lesson += 30 + b.steps.length * 30;
          break;
        default:
          break;
      }
    }

    seconds += Math.max(lesson, requiredSeconds(c, l));
  }

  if (c.quiz.enabled) {
    const n = c.quiz.pool_size > 0 ? Math.min(c.quiz.pool_size, c.quiz.questions.length) : c.quiz.questions.length;

    seconds += n * 40;
  }

  return Math.max(1, Math.ceil(seconds / 60));
}

/** Minimum active seconds for a lesson (the lesson's own value wins over the course default). */
export function requiredSeconds(c: Pick<Content, 'settings'>, l: Pick<Lesson, 'min_seconds'>) {
  return l.min_seconds > 0 ? l.min_seconds : c.settings.min_seconds_per_lesson;
}

/** quiz off → only lessons count. */
export function effectiveCompletion(c: Pick<Content, 'settings' | 'quiz'>): Completion {
  return c.quiz.enabled ? c.settings.completion : 'all_lessons';
}

// ---------------------------------------------------------------------------
// Embeds: the websites a lesson may show inside it (the server checks the same list when publishing)
// ---------------------------------------------------------------------------

export const EMBED_HOSTS = {
  /** Shown inside the lesson, in a sandboxed frame. */
  frame: ['docs.google.com', 'forms.gle', 'forms.office.com', 'forms.microsoft.com', 'www.canva.com', 'view.genial.ly', 'miro.com', 'www.figma.com', 'scribehow.com', 'app.tango.us'],
  /** Played in the course's video player, like a video block. */
  video: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com', 'vimeo.com', 'www.vimeo.com', 'player.vimeo.com', 'loom.com', 'www.loom.com'],
} as const;

/** The websites in words (the server's message uses the same words). */
export const EMBED_SITES = 'Google Docs or Forms, Microsoft Forms, Canva, Genially, Miro, Figma, Scribe, Tango, YouTube, Vimeo or Loom';

/** The server's message for an embed of any other website. `at` is like `block 2 of Lesson 1 ("Welcome")`. */
export function embedNotAllowed(at: string) {
  return `The embed in ${at} can only show ${EMBED_SITES}. For other websites, add a link instead.`;
}

/** A control character (U+0000-U+001F or U+007F) anywhere, as the server checks. Browsers drop tabs and line breaks. */
export function hasControlChar(s: string) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);

    if (c < 0x20 || c === 0x7f) return true;
  }

  return false;
}

/**
 * How an embed link may be shown: 'frame' (a site in the list), 'video' (YouTube, Vimeo or Loom) or null for anything
 * else — then learners get an "Open ↗" link instead. Only plain https:// links to a listed site count: no port, no
 * "@" or control character anywhere (like the server), never Care Hub itself or a relative link.
 */
export function embedKind(url: string): 'frame' | 'video' | null {
  const u = url.trim();
  const m = /^https:\/\/([^/?#]*)/i.exec(u);

  if (!m || url.includes('@') || hasControlChar(url) || /\s/.test(u)) return null;
  const host = m[1].toLowerCase();
  const kind = (EMBED_HOSTS.frame as readonly string[]).includes(host) ? 'frame' : (EMBED_HOSTS.video as readonly string[]).includes(host) ? 'video' : null;

  if (!kind) return null;
  try {
    const parsed = new URL(u);

    if (parsed.protocol !== 'https:' || parsed.hostname !== host || parsed.port || parsed.username || parsed.password) return null;
    if (typeof window !== 'undefined' && host === window.location.hostname.toLowerCase()) return null;
  } catch {
    return null;
  }

  return kind;
}

/** Lesson 2 ("Using the CRM"), the way the server names a lesson in its messages. */
function serverLessonName(index: number, title: string) {
  const chars = [...title.trim()];

  if (!chars.length) return `Lesson ${index + 1}`;
  return `Lesson ${index + 1} ("${chars.slice(0, 40).join('')}${chars.length > 40 ? '…' : ''}")`;
}

export function urlAllowed(url: string) {
  const u = url.trim();

  // Like the server: no control characters anywhere ("/<tab>/host" would open another website), and "//host" or
  // "/\host" is another website to a browser, not a Care Hub link.
  if (!u || hasControlChar(url)) return false;
  if (/^https:\/\/\S+$/i.test(u)) return true;
  if (/^http:\/\/localhost(:\d+)?(\/\S*)?$/i.test(u)) return true;
  return u.startsWith('/') && !u.startsWith('//') && !u.startsWith('/\\');
}

function questionProblems(q: Question, label: string, out: string[]) {
  if (!q.prompt.trim()) out.push(`${label} needs a question.`);
  if (isInteractKind(q.kind)) {
    interactQuestionProblems(q, label, out);
    return;
  }

  if (q.kind === 'matching') {
    if (q.pairs.length < 2) out.push(`${label} needs at least two pairs to match.`);
    if (q.pairs.some((p) => !p.left.trim() || !p.right.trim())) out.push(`${label} has a pair with an empty side.`);
    return;
  }

  if (q.options.length < 2) out.push(`${label} needs at least two answers.`);
  if (q.options.some((o) => !o.text.trim())) out.push(`${label} has an empty answer.`);
  const correct = q.options.filter((o) => o.correct).length;

  if (q.kind === 'multiple' && correct < 1) out.push(`${label} needs at least one correct answer.`);
  if (q.kind !== 'multiple' && correct !== 1) out.push(`${label} needs exactly one correct answer.`);
}

const MEDIA_WORDS: Partial<Record<BlockType, string>> = {
  image: 'An image',
  video: 'A video',
  audio: 'An audio clip',
  file: 'A file',
  embed: 'An embed',
};

/** Problems the server will refuse when publishing (checked here first so they can be fixed early). */
export function validateContent(c: Content): string[] {
  const out: string[] = [];
  const title = c.title.trim();

  if (!title) out.push('Give the course a title.');
  if (title.length > 200) out.push('Keep the course title under 200 characters.');
  if (c.cover.trim() && !urlAllowed(c.cover)) out.push('The cover image link must start with https://.');
  if (!c.lessons.length) out.push('Add at least one lesson.');
  const ids = new Set<string>();
  let repeated = false;
  const see = (id: string) => {
    if (ids.has(id)) repeated = true;
    ids.add(id);
  };

  c.lessons.forEach((l, i) => {
    const name = l.title.trim() ? `"${l.title.trim()}"` : `Lesson ${i + 1}`;

    see(l.id);
    if (!l.title.trim()) out.push(`Lesson ${i + 1} needs a title.`);
    if (!l.blocks.length) out.push(`${name} needs at least one block.`);
    l.blocks.forEach((b, bi) => {
      see(b.id);
      const media = MEDIA_WORDS[b.type];

      if (media && 'url' in b) {
        if (!b.url.trim()) out.push(`${media} in ${name} needs a link.`);
        else if (b.type === 'embed') {
          if (!embedKind(b.url)) out.push(embedNotAllowed(`block ${bi + 1} of ${serverLessonName(i, l.title)}`));
        } else if (!urlAllowed(b.url)) out.push(`${media} in ${name} needs a link that starts with https://.`);
      }

      mediaExtrasProblems(b, `block ${bi + 1} of ${serverLessonName(i, l.title)}`, urlAllowed, out);
      if (b.type === 'knowledge_check') questionProblems(b.question, `A knowledge check in ${name}`, out);
      if (b.type === 'labeled_graphic') labeledGraphicProblems(b, name, out);
      blocks3Problems(b, `block ${bi + 1} of ${serverLessonName(i, l.title)}`, out, urlAllowed);
      if (b.type === 'scenario') {
        if (!b.steps.length) out.push(`A scenario in ${name} needs at least one step.`);
        else if (!b.steps.some((s) => s.id === b.start)) out.push(`A scenario in ${name} needs a first step.`);
        if (b.steps.some((s) => !s.choices.length)) out.push(`Every step of the scenario in ${name} needs at least one choice.`);
      }

      if (b.type === 'page_link' && !b.view_id) out.push(`A page link in ${name} needs a page.`);
      if (b.type === 'process' && b.items.filter((it) => it.title.trim() || it.text.trim()).length < 2) {
        out.push(`A process in ${name} needs at least two steps.`);
      }
    });
  });

  if (c.quiz.enabled) {
    if (!c.quiz.questions.length) out.push('The final quiz needs at least one question (or switch the quiz off).');
    if (c.quiz.pool_size > c.quiz.questions.length) out.push('“Questions per attempt” is more than the number of questions.');
    c.quiz.questions.forEach((q, i) => {
      see(q.id);
      questionProblems(q, `Quiz question ${i + 1}`, out);
    });
  }

  blocks3LinkProblems(c, out, serverLessonName);
  if (repeated) out.push('Two parts of this course share the same id. Delete the copy and add it again.');
  return Array.from(new Set(out));
}

// ---------------------------------------------------------------------------
// Words and numbers
// ---------------------------------------------------------------------------

export function formatClock(seconds: number) {
  const s = Math.max(0, Math.ceil(seconds));

  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatMinutes(min: number) {
  if (min <= 0) return '';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;

  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatDuration(ms: number) {
  if (ms < 60000) return ms >= 1000 ? 'Under a minute' : '0 min';
  return formatMinutes(Math.round(ms / 60000));
}

export type ChipTone = 'gray' | 'blue' | 'green' | 'red' | 'amber' | 'purple';

export function statusInfo(p: Pick<MyProgress, 'status' | 'awaiting_ack'> | null | undefined): { label: string; tone: ChipTone } {
  if (!p) return { label: 'Not started', tone: 'gray' };
  if (p.status === 'passed') return { label: 'Passed', tone: 'green' };
  if (p.status === 'completed') return { label: 'Completed', tone: 'green' };
  if (p.status === 'failed') return { label: 'Didn’t pass', tone: 'red' };
  if (p.awaiting_ack) return { label: 'Almost done', tone: 'amber' };
  return { label: 'In progress', tone: 'blue' };
}

export function isFinished(p: Pick<MyProgress, 'status'> | null | undefined) {
  return Boolean(p && (p.status === 'completed' || p.status === 'passed' || p.status === 'failed'));
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// Progress event queue (kept in localStorage so nothing is lost if the tab closes or the network drops). Each
// person has their own queue, so on a shared computer nobody's progress is ever sent as someone else's.
// ---------------------------------------------------------------------------

const QUEUE_PREFIX = 'carehub-learning-queue:';
const memoryQueues = new Map<string, LearnEvent[]>();
let tidiedFor = '';

/** Who is signed in on this browser (the person id in the sign-in token), or '' when nobody is or it isn't known. */
export function signedInPerson(): string {
  try {
    const t = getTokenParsed() as { access_token?: unknown; user?: { id?: unknown } } | null;
    const id = t && typeof t.access_token === 'string' && t.access_token && typeof t.user?.id === 'string' ? t.user.id.trim() : '';

    return /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : '';
  } catch {
    return '';
  }
}

/**
 * This person's queue for a course: `carehub-learning-queue:<person>:<workspace>:<course>`. When the person isn't known
 * it's kept in memory only: still sent while the tab is open, never saved on the computer.
 */
function queueFor(ws: string, courseId: string) {
  const who = signedInPerson();

  clearOtherQueues(who);

  return { key: `${QUEUE_PREFIX}${who}:${ws}:${courseId}`, saved: Boolean(who) };
}

function isEvent(v: unknown): v is LearnEvent {
  const o = obj(v);

  return typeof o.kind === 'string' && typeof o.lesson_id === 'string' && typeof o.ts_ms === 'number';
}

export function readQueue(ws: string, courseId: string): LearnEvent[] {
  const { key, saved } = queueFor(ws, courseId);

  if (saved) {
    try {
      const raw = window.localStorage.getItem(key);

      if (raw) {
        const parsed: unknown = JSON.parse(raw);

        if (Array.isArray(parsed)) return parsed.filter(isEvent);
      }
    } catch {
      // Storage blocked: fall back to memory.
    }
  }

  return (memoryQueues.get(key) || []).slice();
}

export function writeQueue(ws: string, courseId: string, events: LearnEvent[]) {
  const { key, saved } = queueFor(ws, courseId);
  const kept = events.length > 3000 ? events.slice(events.length - 3000) : events;

  memoryQueues.set(key, kept.slice());
  if (!saved) return;
  try {
    if (kept.length) window.localStorage.setItem(key, JSON.stringify(kept));
    else window.localStorage.removeItem(key);
  } catch {
    // Storage full or blocked: the memory copy still gets sent while the tab is open.
  }
}

/**
 * Deletes every queue that isn't the signed-in person's (someone else's, or the old kind without a person), so it's
 * never sent. Runs once per person per page: when My learning opens or a course first uses its queue. Does nothing
 * while the person isn't known.
 */
function clearOtherQueues(who: string) {
  if (!who || who === tidiedFor) return;
  tidiedFor = who;
  const mine = `${QUEUE_PREFIX}${who}:`;

  [...memoryQueues.keys()].filter((key) => !key.startsWith(mine)).forEach((key) => memoryQueues.delete(key));
  try {
    const stale: string[] = [];

    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);

      if (key?.startsWith(QUEUE_PREFIX) && !(key.startsWith(mine) && key.split(':').length === 4)) stale.push(key);
    }

    stale.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Storage blocked: nothing was stored.
  }
}

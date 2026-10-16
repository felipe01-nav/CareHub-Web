/**
 * CareHub: conditional logic for forms ("show this question only when ...").
 *
 * Builder side: each question can carry a rule, saved in the form view's
 * per-question settings under `carehub_show_if` as a JSON string:
 *   {"match":"all"|"any","conditions":[{"field_id":"...","op":"is","value":"..."}]}
 * Respondent side: the form receives `show_if` on each question (with
 * question ids instead of field ids) and only shows / checks / sends the
 * questions whose rule is met. The server applies the same rule again.
 */
import { ChevronDown, GitBranch, Plus, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import * as Y from 'yjs';

import { useDatabaseView } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import { runDatabaseAction } from '@/application/database-yjs/history';
import { YjsDatabaseKey } from '@/application/types';
import type { YDatabaseField } from '@/application/types';
import type { FormAnswerValue, PublicFormSchema, PublicQuestion } from '@/application/types/form';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export const CAREHUB_SHOW_IF = 'carehub_show_if';

export type CareHubLogicOp =
  | 'is'
  | 'is_not'
  | 'contains'
  | 'not_contains'
  | 'empty'
  | 'not_empty'
  | 'gt'
  | 'lt'
  | 'checked'
  | 'unchecked';

export type CareHubLogicKind = 'text' | 'number' | 'checkbox' | 'single_select' | 'multi_select' | 'date' | 'files';

export interface CareHubStoredCondition {
  field_id: string;
  op: CareHubLogicOp;
  value?: string;
}

export interface CareHubStoredRule {
  match: 'all' | 'any';
  conditions: CareHubStoredCondition[];
}

export interface CareHubShowIf {
  match: 'all' | 'any';
  conditions: { question_id: string; op: CareHubLogicOp; value?: string }[];
}

type QuestionWithLogic = PublicQuestion & { show_if?: CareHubShowIf };

const OPS_BY_KIND: Record<CareHubLogicKind, { op: CareHubLogicOp; label: string }[]> = {
  text: [
    { op: 'is', label: 'is' },
    { op: 'is_not', label: 'is not' },
    { op: 'contains', label: 'contains' },
    { op: 'not_contains', label: 'does not contain' },
    { op: 'not_empty', label: 'is answered' },
    { op: 'empty', label: 'is not answered' },
  ],
  number: [
    { op: 'is', label: '=' },
    { op: 'is_not', label: '≠' },
    { op: 'gt', label: 'is greater than' },
    { op: 'lt', label: 'is less than' },
    { op: 'not_empty', label: 'is answered' },
    { op: 'empty', label: 'is not answered' },
  ],
  checkbox: [
    { op: 'checked', label: 'is ticked' },
    { op: 'unchecked', label: 'is not ticked' },
  ],
  single_select: [
    { op: 'is', label: 'is' },
    { op: 'is_not', label: 'is not' },
    { op: 'not_empty', label: 'is answered' },
    { op: 'empty', label: 'is not answered' },
  ],
  multi_select: [
    { op: 'contains', label: 'includes' },
    { op: 'not_contains', label: 'does not include' },
    { op: 'not_empty', label: 'is answered' },
    { op: 'empty', label: 'is not answered' },
  ],
  date: [
    { op: 'is', label: 'is on' },
    { op: 'gt', label: 'is after' },
    { op: 'lt', label: 'is before' },
    { op: 'not_empty', label: 'is answered' },
    { op: 'empty', label: 'is not answered' },
  ],
  files: [
    { op: 'not_empty', label: 'has files' },
    { op: 'empty', label: 'has no files' },
  ],
};

const NO_VALUE_OPS: CareHubLogicOp[] = ['empty', 'not_empty', 'checked', 'unchecked'];

export function carehubOpNeedsValue(op: CareHubLogicOp) {
  return !NO_VALUE_OPS.includes(op);
}

export function carehubKindFromFieldType(type: FieldType): CareHubLogicKind | null {
  switch (type) {
    case FieldType.RichText:
    case FieldType.URL:
      return 'text';
    case FieldType.Number:
      return 'number';
    case FieldType.Checkbox:
      return 'checkbox';
    case FieldType.SingleSelect:
      return 'single_select';
    case FieldType.MultiSelect:
      return 'multi_select';
    case FieldType.DateTime:
      return 'date';
    case FieldType.Media:
      return 'files';
    default:
      return null;
  }
}

function kindFromPublic(kind: PublicQuestion['kind']): CareHubLogicKind {
  switch (kind) {
    case 'number':
    case 'checkbox':
    case 'single_select':
    case 'multi_select':
    case 'date':
    case 'files':
      return kind;
    default:
      return 'text';
  }
}

export function carehubParseRule(raw: unknown): CareHubStoredRule | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CareHubStoredRule>;
    const conditions = Array.isArray(parsed.conditions)
      ? parsed.conditions.filter(
          (c): c is CareHubStoredCondition => !!c && typeof c.field_id === 'string' && typeof c.op === 'string'
        )
      : [];

    return { match: parsed.match === 'any' ? 'any' : 'all', conditions };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Respondent side
// ---------------------------------------------------------------------------

function answerIsEmpty(v: FormAnswerValue | undefined) {
  if (!v) return true;
  switch (v.kind) {
    case 'text':
      return v.value.trim().length === 0;
    case 'number':
      return v.value === null || Number.isNaN(v.value);
    case 'checkbox':
      return !v.value;
    case 'single_select':
      return !v.option_id;
    case 'multi_select':
      return v.option_ids.length === 0;
    case 'date':
      return !v.iso;
    case 'files':
      return v.files.length === 0;
    default:
      return true;
  }
}

function answerNumber(v: FormAnswerValue | undefined): number | null {
  if (!v) return null;
  if (v.kind === 'number') return v.value === null || Number.isNaN(v.value) ? null : v.value;
  if (v.kind === 'text' && v.value.trim() !== '') {
    const n = Number(v.value.trim());

    return Number.isFinite(n) ? n : null;
  }

  return null;
}

/** Returns true / false, or null when the condition is incomplete (ignored). */
function testCondition(
  kind: CareHubLogicKind,
  op: CareHubLogicOp,
  rawValue: string | undefined,
  answer: FormAnswerValue | undefined
): boolean | null {
  const value = (rawValue ?? '').trim();

  if (!OPS_BY_KIND[kind].some((o) => o.op === op)) return null;
  if (carehubOpNeedsValue(op) && value === '') return null;
  if (op === 'empty') return answerIsEmpty(answer);
  if (op === 'not_empty') return !answerIsEmpty(answer);
  if (op === 'checked') return answer?.kind === 'checkbox' && answer.value === true;
  if (op === 'unchecked') return !(answer?.kind === 'checkbox' && answer.value === true);

  switch (kind) {
    case 'number': {
      const n = answerNumber(answer);
      const target = Number(value);

      if (!Number.isFinite(target)) return null;
      if (op === 'is_not') return n === null || n !== target;
      if (n === null) return false;
      if (op === 'is') return n === target;
      if (op === 'gt') return n > target;
      if (op === 'lt') return n < target;
      return null;
    }

    case 'single_select': {
      const id = answer?.kind === 'single_select' ? answer.option_id : null;

      return op === 'is' ? id === value : id !== value;
    }

    case 'multi_select': {
      const ids = answer?.kind === 'multi_select' ? answer.option_ids : [];

      return op === 'contains' ? ids.includes(value) : !ids.includes(value);
    }

    case 'date': {
      const day = answer?.kind === 'date' && answer.iso ? answer.iso.slice(0, 10) : '';
      const target = value.slice(0, 10);

      if (!day) return false;
      if (op === 'is') return day === target;
      if (op === 'gt') return day > target;
      if (op === 'lt') return day < target;
      return null;
    }

    default: {
      const text = (answer?.kind === 'text' ? answer.value : '').trim().toLowerCase();
      const target = value.toLowerCase();

      if (op === 'is') return text === target;
      if (op === 'is_not') return text !== target;
      if (op === 'contains') return text.includes(target);
      if (op === 'not_contains') return !text.includes(target);
      return null;
    }
  }
}

/** Ids of the questions that should be shown for the current answers. */
export function carehubVisibleQuestions(
  questions: PublicQuestion[],
  answers: Record<string, FormAnswerValue>
): Set<string> {
  const byId = new Map(questions.map((q) => [q.id, q]));
  let visible = new Set(questions.map((q) => q.id));

  // Repeat so a question hidden by its own rule also hides the ones that depend on it.
  for (let pass = 0; pass <= questions.length; pass++) {
    const next = new Set<string>();

    for (const q of questions as QuestionWithLogic[]) {
      const rule = q.show_if;
      const results = (rule?.conditions ?? [])
        .map((c) => {
          const source = byId.get(c.question_id);

          if (!source || source.id === q.id) return null;
          const answer = visible.has(source.id) ? answers[source.id] : undefined;

          return testCondition(kindFromPublic(source.kind), c.op, c.value, answer);
        })
        .filter((r): r is boolean => r !== null);
      const shown = results.length === 0 || (rule?.match === 'any' ? results.some(Boolean) : results.every(Boolean));

      if (shown) next.add(q.id);
    }

    const same = next.size === visible.size && [...next].every((id) => visible.has(id));

    visible = next;
    if (same) break;
  }

  return visible;
}

/** Only the answers of questions that are shown. */
export function carehubPickAnswers(
  answers: Record<string, FormAnswerValue>,
  visible: Set<string>
): Record<string, FormAnswerValue> {
  const out: Record<string, FormAnswerValue> = {};

  Object.entries(answers).forEach(([id, value]) => {
    if (visible.has(id)) out[id] = value;
  });
  return out;
}

/** Preview: copy each question's rule from the form view (preview ids are field ids). */
export function carehubAttachShowIf(schema: PublicFormSchema, view: Y.Map<unknown> | undefined): PublicFormSchema {
  const settings = view?.get(YjsDatabaseKey.form_field_settings) as Y.Map<Y.Map<unknown>> | undefined;

  if (!settings) return schema;
  return {
    ...schema,
    questions: schema.questions.map((q) => {
      const rule = carehubParseRule(settings.get(q.id)?.get(CAREHUB_SHOW_IF));

      if (!rule || rule.conditions.length === 0) return q;
      return {
        ...q,
        show_if: {
          match: rule.match,
          conditions: rule.conditions.map((c) => ({ question_id: c.field_id, op: c.op, value: c.value })),
        },
      } as QuestionWithLogic;
    }),
  };
}

// ---------------------------------------------------------------------------
// Builder side
// ---------------------------------------------------------------------------

export interface CareHubLogicQuestion {
  questionId: string;
  name: string;
  fieldType: FieldType;
  selectField?: YDatabaseField;
}

const LogicQuestionsContext = createContext<CareHubLogicQuestion[]>([]);

export function CareHubFormLogicProvider({
  questions,
  children,
}: {
  questions: CareHubLogicQuestion[];
  children: ReactNode;
}) {
  return <LogicQuestionsContext.Provider value={questions}>{children}</LogicQuestionsContext.Provider>;
}

export function CareHubLogicMenuItemContent() {
  return (
    <>
      <GitBranch size={14} />
      Conditional logic
    </>
  );
}

function selectOptions(field: YDatabaseField | undefined): { id: string; name: string }[] {
  if (!field) return [];
  try {
    const type = Number(field.get(YjsDatabaseKey.type));
    const content = field.get(YjsDatabaseKey.type_option)?.get(String(type))?.get(YjsDatabaseKey.content);

    if (typeof content !== 'string') return [];
    const parsed = JSON.parse(content) as { options?: { id: string; name: string }[] };

    return (parsed.options ?? []).filter((o) => o && typeof o.id === 'string');
  } catch {
    return [];
  }
}

function useStoredRule(questionId: string) {
  const view = useDatabaseView() as Y.Map<unknown> | undefined;
  const read = useCallback(() => {
    const settings = view?.get(YjsDatabaseKey.form_field_settings) as Y.Map<Y.Map<unknown>> | undefined;
    const raw = settings?.get(questionId)?.get(CAREHUB_SHOW_IF);

    return typeof raw === 'string' ? raw : '';
  }, [questionId, view]);
  const [raw, setRaw] = useState(read);

  useEffect(() => {
    setRaw(read());
    if (!view) return;
    const onChange = () => setRaw(read());

    view.observeDeep(onChange);
    return () => view.unobserveDeep(onChange);
  }, [read, view]);

  const write = useCallback(
    (rule: CareHubStoredRule | null) => {
      if (!view || !view.doc) return;
      const next = rule && rule.conditions.length > 0 ? JSON.stringify(rule) : '';

      if (next === read()) return;
      runDatabaseAction(view.doc, { type: 'database.form.carehub-logic' }, () => {
        let settings = view.get(YjsDatabaseKey.form_field_settings) as Y.Map<Y.Map<unknown>> | undefined;

        if (!settings) {
          if (!next) return;
          view.set(YjsDatabaseKey.form_field_settings, new Y.Map());
          settings = view.get(YjsDatabaseKey.form_field_settings) as Y.Map<Y.Map<unknown>>;
        }

        let entry = settings.get(questionId);

        if (!entry) {
          if (!next) return;
          const created = new Y.Map<unknown>();

          created.set('included', true);
          settings.set(questionId, created);
          entry = settings.get(questionId)!;
        }

        if (next) entry.set(CAREHUB_SHOW_IF, next);
        else entry.delete(CAREHUB_SHOW_IF);
      });
    },
    [questionId, read, view]
  );

  return { raw, write };
}

function Picker<T extends string>({
  value,
  options,
  placeholder,
  onChange,
  className,
  testId,
}: {
  value: T | '';
  options: { value: T; label: string }[];
  placeholder: string;
  onChange: (value: T) => void;
  className?: string;
  testId?: string;
}) {
  const current = options.find((o) => o.value === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid={testId}
        className={cn(
          'flex h-8 min-w-0 items-center justify-between gap-1 rounded-md border border-line-divider px-2 text-left text-sm hover:bg-fill-content',
          className
        )}
      >
        <span className={cn('truncate', !current && 'text-text-caption')}>{current?.label ?? placeholder}</span>
        <ChevronDown size={14} className='shrink-0 text-text-caption' />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='max-h-72 min-w-[10rem] overflow-y-auto'>
        {options.length === 0 ? (
          <div className='px-2 py-1.5 text-sm text-text-caption'>Nothing to choose yet</div>
        ) : (
          options.map((o) => (
            <DropdownMenuItem key={o.value} onSelect={() => onChange(o.value)}>
              <span className='truncate'>{o.label}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function describeRule(rule: CareHubStoredRule, questions: CareHubLogicQuestion[]) {
  const parts = rule.conditions
    .map((c) => {
      const source = questions.find((q) => q.questionId === c.field_id);

      if (!source) return null;
      const kind = carehubKindFromFieldType(source.fieldType);
      const opLabel = kind ? OPS_BY_KIND[kind].find((o) => o.op === c.op)?.label : undefined;

      if (!kind || !opLabel) return null;
      let value = c.value ?? '';

      if (kind === 'single_select' || kind === 'multi_select') {
        value = selectOptions(source.selectField).find((o) => o.id === value)?.name ?? '';
      }

      if (carehubOpNeedsValue(c.op) && !value) return null;
      return `“${source.name}” ${opLabel}${carehubOpNeedsValue(c.op) ? ` ${value}` : ''}`;
    })
    .filter((p): p is string => !!p);

  return parts.join(rule.match === 'any' ? ' or ' : ' and ');
}

const TEXT_INPUT_CLASS =
  'h-8 min-w-0 flex-1 rounded-md border border-line-divider bg-transparent px-2 text-sm outline-none placeholder:text-text-caption focus:border-text-caption';

/**
 * The "Show this question when ..." box inside a form question card.
 * Hidden until the question has a rule or "Conditional logic" is chosen.
 */
export function CareHubFormLogic({
  questionId,
  open,
  onOpenChange,
}: {
  questionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const questions = useContext(LogicQuestionsContext);
  const { raw, write } = useStoredRule(questionId);
  const stored = useMemo(() => carehubParseRule(raw), [raw]);
  const [draft, setDraft] = useState<CareHubStoredRule | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef<CareHubStoredRule | null>(null);
  const writeRef = useRef(write);

  writeRef.current = write;

  const myIndex = questions.findIndex((q) => q.questionId === questionId);
  const sources = useMemo(
    () =>
      questions.filter(
        (q, i) => q.questionId !== questionId && (myIndex === -1 || i < myIndex) && carehubKindFromFieldType(q.fieldType)
      ),
    [myIndex, questionId, questions]
  );

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }

    if (draftRef.current) writeRef.current(draftRef.current);
  }, []);

  useEffect(() => () => flush(), [flush]);

  // Opening the editor starts from what is saved (or one empty condition).
  useEffect(() => {
    if (!open) {
      draftRef.current = null;
      setDraft(null);
      return;
    }

    const start: CareHubStoredRule =
      stored && stored.conditions.length > 0
        ? stored
        : {
            match: 'all',
            conditions: [
              {
                field_id: sources[sources.length - 1]?.questionId ?? '',
                op: defaultOp(sources[sources.length - 1]),
                value: '',
              },
            ],
          };

    draftRef.current = start;
    setDraft(start);
    // Only when the editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const update = (next: CareHubStoredRule, immediate = false) => {
    draftRef.current = next;
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () => {
        timer.current = null;
        if (draftRef.current) writeRef.current(draftRef.current);
      },
      immediate ? 0 : 400
    );
  };

  const close = () => {
    flush();
    onOpenChange(false);
  };

  const summary = stored ? describeRule(stored, questions) : '';

  if (!open) {
    if (!summary) return null;
    return (
      <button
        type='button'
        data-testid='carehub-logic-summary'
        onMouseDownCapture={(e) => e.stopPropagation()}
        onClick={() => onOpenChange(true)}
        className='mt-2 flex max-w-full items-start gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-text-caption hover:bg-fill-content'
      >
        <GitBranch size={13} className='mt-[1px] shrink-0' />
        <span className='min-w-0 break-words'>Shown only when {summary}</span>
      </button>
    );
  }

  const rule = draft ?? { match: 'all' as const, conditions: [] };

  const setCondition = (index: number, patch: Partial<CareHubStoredCondition>, immediate = true) => {
    update(
      { ...rule, conditions: rule.conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)) },
      immediate
    );
  };

  return (
    <div
      data-testid='carehub-logic-editor'
      onMouseDownCapture={(e) => e.stopPropagation()}
      onKeyDownCapture={(e) => e.stopPropagation()}
      className='mt-3 flex cursor-default flex-col gap-2 rounded-md border border-line-divider p-3'
    >
      <div className='flex items-center gap-2 text-sm'>
        <GitBranch size={14} className='shrink-0 text-text-caption' />
        <span className='font-medium'>Show this question when</span>
        {rule.conditions.length > 1 && (
          <Picker
            testId='carehub-logic-match'
            value={rule.match}
            options={[
              { value: 'all', label: 'all are true' },
              { value: 'any', label: 'any is true' },
            ]}
            placeholder='all are true'
            onChange={(match) => update({ ...rule, match }, true)}
            className='h-7'
          />
        )}
        <div className='flex-1' />
        <button
          type='button'
          onClick={close}
          className='rounded-md px-2 py-1 text-sm font-medium hover:bg-fill-content'
          data-testid='carehub-logic-done'
        >
          Done
        </button>
      </div>

      {sources.length === 0 ? (
        <p className='text-sm text-text-caption'>
          Add a question above this one first — the rule looks at earlier answers.
        </p>
      ) : (
        rule.conditions.map((c, index) => {
          const source = sources.find((q) => q.questionId === c.field_id);
          const kind = source ? carehubKindFromFieldType(source.fieldType) : null;
          const ops = kind ? OPS_BY_KIND[kind] : [];
          const needsValue = kind !== null && carehubOpNeedsValue(c.op);

          return (
            <div key={index} className='flex flex-wrap items-center gap-2' data-testid='carehub-logic-condition'>
              <Picker
                testId='carehub-logic-question'
                value={c.field_id}
                options={sources.map((q) => ({ value: q.questionId, label: q.name }))}
                placeholder='Choose a question'
                onChange={(fieldId) => {
                  const next = sources.find((q) => q.questionId === fieldId);

                  setCondition(index, { field_id: fieldId, op: defaultOp(next), value: '' });
                }}
                className='w-44'
              />
              {kind && (
                <Picker
                  testId='carehub-logic-op'
                  value={c.op}
                  options={ops.map((o) => ({ value: o.op, label: o.label }))}
                  placeholder='is'
                  onChange={(op) => setCondition(index, { op })}
                  className='w-40'
                />
              )}
              {needsValue && (kind === 'single_select' || kind === 'multi_select') && (
                <Picker
                  testId='carehub-logic-value'
                  value={c.value ?? ''}
                  options={selectOptions(source?.selectField).map((o) => ({ value: o.id, label: o.name }))}
                  placeholder='Choose an option'
                  onChange={(value) => setCondition(index, { value })}
                  className='w-40'
                />
              )}
              {needsValue && kind === 'date' && (
                <input
                  type='date'
                  data-testid='carehub-logic-value'
                  value={c.value ?? ''}
                  onChange={(e) => setCondition(index, { value: e.target.value })}
                  className={cn(TEXT_INPUT_CLASS, 'max-w-[11rem]')}
                />
              )}
              {needsValue && (kind === 'text' || kind === 'number') && (
                <input
                  type={kind === 'number' ? 'number' : 'text'}
                  data-testid='carehub-logic-value'
                  value={c.value ?? ''}
                  placeholder='Value'
                  onChange={(e) => setCondition(index, { value: e.target.value }, false)}
                  onBlur={flush}
                  className={TEXT_INPUT_CLASS}
                />
              )}
              <button
                type='button'
                aria-label='Remove condition'
                data-testid='carehub-logic-remove'
                onClick={() => update({ ...rule, conditions: rule.conditions.filter((_, i) => i !== index) }, true)}
                className='ml-auto rounded-md p-1 text-text-caption hover:bg-fill-content'
              >
                <X size={14} />
              </button>
            </div>
          );
        })
      )}

      {sources.length > 0 && (
        <div className='flex items-center gap-3'>
          <button
            type='button'
            data-testid='carehub-logic-add'
            onClick={() =>
              update(
                {
                  ...rule,
                  conditions: [
                    ...rule.conditions,
                    { field_id: sources[sources.length - 1].questionId, op: defaultOp(sources[sources.length - 1]), value: '' },
                  ],
                },
                true
              )
            }
            className='flex items-center gap-1 rounded-md px-1.5 py-1 text-sm text-text-caption hover:bg-fill-content'
          >
            <Plus size={14} />
            Add condition
          </button>
          {rule.conditions.length > 0 && (
            <button
              type='button'
              data-testid='carehub-logic-clear'
              onClick={() => {
                update({ match: 'all', conditions: [] }, true);
                flush();
                onOpenChange(false);
              }}
              className='rounded-md px-1.5 py-1 text-sm text-text-caption hover:bg-fill-content'
            >
              Remove logic
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function defaultOp(question: CareHubLogicQuestion | undefined): CareHubLogicOp {
  const kind = question ? carehubKindFromFieldType(question.fieldType) : null;

  return kind ? OPS_BY_KIND[kind][0].op : 'is';
}

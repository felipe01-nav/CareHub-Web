// CareHub Learning Studio: the block library, form fields, and the editor for each kind of block and question.
import { useMemo, useState } from 'react';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { clampInt, newId, setQuestionKind, urlAllowed } from './CareHubLearningApi';
import { videoEmbedUrl } from './CareHubLearningBlocks';
import { filterPages, useSharablePages } from './CareHubSharePage';
import { CareHubModal, chInputClass, ChSelect } from './CareHubUi';

import type {
  Block,
  BlockOf,
  BlockType,
  FlashCard,
  ImageWidth,
  ListStyle,
  QOption,
  QPair,
  Question,
  QuestionKind,
  ScenarioChoice,
  ScenarioStep,
  TextItem,
  Tone,
} from './CareHubLearningApi';

// ---------------------------------------------------------------------------
// The block library
// ---------------------------------------------------------------------------

export const BLOCK_INFO: Record<BlockType, { emoji: string; label: string; hint: string }> = {
  heading: { emoji: '🔠', label: 'Heading', hint: 'A title for a section' },
  paragraph: { emoji: '📝', label: 'Text', hint: 'A paragraph of text' },
  statement: { emoji: '📣', label: 'Statement', hint: 'One big sentence that stands out' },
  quote: { emoji: '💭', label: 'Quote', hint: 'Someone’s words, with who said them' },
  callout: { emoji: '💡', label: 'Callout', hint: 'A tip, note or warning in a colored box' },
  list: { emoji: '📋', label: 'List', hint: 'Bullets, numbers or a checklist' },
  divider: { emoji: '➖', label: 'Divider', hint: 'A line between sections' },
  image: { emoji: '🖼️', label: 'Image', hint: 'A picture from a link' },
  video: { emoji: '🎬', label: 'Video', hint: 'YouTube, Vimeo, Loom or a video file link' },
  audio: { emoji: '🎧', label: 'Audio', hint: 'A sound clip from a link' },
  file: { emoji: '📎', label: 'File', hint: 'A download link' },
  embed: { emoji: '🧩', label: 'Embed', hint: 'Show another website inside the lesson' },
  accordion: { emoji: '🔽', label: 'Accordion', hint: 'Sections people open one at a time' },
  tabs: { emoji: '🗂️', label: 'Tabs', hint: 'Sections side by side' },
  flashcards: { emoji: '🃏', label: 'Flashcards', hint: 'Cards people flip to test themselves' },
  continue: { emoji: '⏬', label: 'Continue button', hint: 'Shows the rest of the lesson one step at a time' },
  knowledge_check: { emoji: '✅', label: 'Knowledge check', hint: 'A practice question with instant feedback' },
  scenario: { emoji: '💬', label: 'Scenario', hint: 'A branching conversation to practice' },
  page_link: { emoji: '🔗', label: 'Care Hub page', hint: 'A link to a page in this workspace' },
};

export const BLOCK_GROUPS: { title: string; types: BlockType[] }[] = [
  { title: 'Text', types: ['heading', 'paragraph', 'statement', 'quote', 'callout', 'list', 'divider'] },
  { title: 'Media', types: ['image', 'video', 'audio', 'file', 'embed'] },
  { title: 'Interactive', types: ['knowledge_check', 'scenario', 'flashcards', 'accordion', 'tabs', 'continue'] },
  { title: 'Links', types: ['page_link'] },
];

export function BlockLibrary({ onPick, onClose }: { onPick: (type: BlockType) => void; onClose: () => void }) {
  return (
    <CareHubModal title='Add a block' wide onClose={onClose} testId='carehub-learning-block-library'>
      <div className='flex flex-col gap-4'>
        {BLOCK_GROUPS.map((g) => (
          <div key={g.title}>
            <div className='mb-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary'>{g.title}</div>
            <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
              {g.types.map((t) => (
                <button
                  key={t}
                  type='button'
                  onClick={() => onPick(t)}
                  className='flex items-start gap-2.5 rounded-[10px] border border-border-primary px-3 py-2.5 text-left hover:bg-fill-content-hover'
                  data-testid={`carehub-learning-add-${t}`}
                >
                  <span className='text-lg leading-6' aria-hidden='true'>
                    {BLOCK_INFO[t].emoji}
                  </span>
                  <span className='min-w-0 flex-1'>
                    <span className='block text-sm font-medium'>{BLOCK_INFO[t].label}</span>
                    <span className='block text-xs text-text-tertiary'>{BLOCK_INFO[t].hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </CareHubModal>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

export const FORMAT_HINT = 'Tip: **bold**, *italic*, [link text](https://…)';
export const MEDIA_NOTE =
  'Paste a link (https://…). Uploading files here isn’t available yet — upload to a Care Hub page or a video site and paste the link.';
export const SAMPLE_PICTURES = [1, 2, 3, 4, 5, 6].map((n) => `/covers/m_cover_image_${n}.png`);

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className='text-xs font-medium text-text-secondary'>{label}</span>
      {children}
      {hint && <span className='text-xs text-text-tertiary'>{hint}</span>}
    </label>
  );
}

export function TextLine({
  value,
  onChange,
  placeholder,
  ariaLabel,
  maxLength = 500,
  className,
  type = 'text',
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  maxLength?: number;
  className?: string;
  type?: 'text' | 'url' | 'search';
  autoFocus?: boolean;
}) {
  return (
    <input
      type={type}
      autoFocus={autoFocus}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      maxLength={maxLength}
      className={cn(chInputClass, 'w-full min-w-0', className)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function TextBox({
  value,
  onChange,
  placeholder,
  ariaLabel,
  rows = 3,
  maxLength = 20000,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  rows?: number;
  maxLength?: number;
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      placeholder={placeholder}
      aria-label={ariaLabel}
      maxLength={maxLength}
      className={cn(chInputClass, 'w-full min-w-0 resize-y leading-relaxed')}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={cn('flex items-start gap-2 text-sm', disabled ? 'opacity-60' : 'cursor-pointer')}>
      <input type='checkbox' className='mt-[3px] shrink-0' checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className='min-w-0 flex-1'>
        {label}
        {hint && <span className='block text-xs text-text-tertiary'>{hint}</span>}
      </span>
    </label>
  );
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  ariaLabel,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  ariaLabel?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      type='number'
      inputMode='numeric'
      min={min}
      max={max}
      aria-label={ariaLabel}
      className={cn(chInputClass, 'w-24', className)}
      value={draft ?? String(value)}
      onChange={(e) => {
        const raw = e.target.value;
        const n = Number(raw);

        setDraft(raw);
        if (raw.trim() !== '' && Number.isFinite(n)) onChange(clampInt(n, min, max));
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

export function CopyIcon() {
  return (
    <svg width='14' height='14' viewBox='0 0 16 16' fill='none' aria-hidden='true' focusable='false'>
      <rect x='5.5' y='5.5' width='8' height='8' rx='1.5' stroke='currentColor' strokeWidth='1.5' />
      <path d='M10.5 3.5V3A1.5 1.5 0 0 0 9 1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h.5' stroke='currentColor' strokeWidth='1.5' />
    </svg>
  );
}

export function IconButton({
  label,
  onClick,
  disabled,
  children,
  danger,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  danger?: boolean;
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

export function AddButton({ onClick, children, disabled }: { onClick: () => void; children: ReactNode; disabled?: boolean }) {
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

function linkProblem(url: string, httpsOnly = false) {
  const u = url.trim();

  if (!u) return '';
  if (!urlAllowed(u) || (httpsOnly && !/^https:\/\//i.test(u))) return 'This link needs to start with https://';
  return '';
}

export function UrlField({
  label,
  value,
  onChange,
  placeholder,
  httpsOnly,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  httpsOnly?: boolean;
  hint?: ReactNode;
}) {
  const problem = linkProblem(value, httpsOnly);

  return (
    <Field label={label} hint={problem ? <span className='text-text-error'>{problem}</span> : hint}>
      <TextLine type='url' value={value} onChange={onChange} placeholder={placeholder || 'https://…'} maxLength={2000} />
    </Field>
  );
}

export function PicturePicker({ value, onPick, label = 'Or pick a sample picture' }: { value: string; onPick: (url: string) => void; label?: string }) {
  return (
    <div>
      <div className='mb-1 text-xs text-text-tertiary'>{label}</div>
      <div className='flex flex-wrap gap-1.5'>
        {SAMPLE_PICTURES.map((url, i) => (
          <button
            key={url}
            type='button'
            aria-label={`Sample picture ${i + 1}`}
            aria-pressed={value === url}
            onClick={() => onPick(url)}
            className={cn(
              'h-10 w-14 overflow-hidden rounded-[6px] border-2',
              value === url ? 'border-border-theme-thick' : 'border-transparent hover:border-border-primary'
            )}
          >
            <img src={url} alt='' className='h-full w-full object-cover' />
          </button>
        ))}
      </div>
    </div>
  );
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);

  next.splice(to, 0, item);
  return next;
}

// ---------------------------------------------------------------------------
// Questions (knowledge checks and the final quiz)
// ---------------------------------------------------------------------------

const KIND_OPTIONS: { value: QuestionKind; label: string }[] = [
  { value: 'single', label: 'One right answer' },
  { value: 'multiple', label: 'Several right answers' },
  { value: 'true_false', label: 'True or false' },
  { value: 'matching', label: 'Match the pairs' },
];

export function QuestionEditor({ q, onChange, inQuiz }: { q: Question; onChange: (q: Question) => void; inQuiz?: boolean }) {
  const set = (patch: Partial<Question>) => onChange({ ...q, ...patch });
  const setOption = (i: number, patch: Partial<QOption>) => set({ options: q.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  const markCorrect = (i: number, on: boolean) => {
    if (q.kind === 'multiple') setOption(i, { correct: on });
    else set({ options: q.options.map((o, j) => ({ ...o, correct: j === i })) });
  };
  const setPair = (i: number, patch: Partial<QPair>) => set({ pairs: q.pairs.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const group = `q-${q.id}`;

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-wrap items-end gap-3'>
        <Field label='Type of question' className='min-w-[180px] flex-1'>
          <ChSelect value={q.kind} options={KIND_OPTIONS} onChange={(k) => onChange(setQuestionKind(q, k))} ariaLabel='Type of question' />
        </Field>
        {inQuiz && (
          <Field label='Points'>
            <NumberField value={q.points} min={1} max={100} onChange={(v) => set({ points: v })} ariaLabel='Points' className='w-20' />
          </Field>
        )}
      </div>
      <Field label='Question'>
        <TextBox value={q.prompt} rows={2} onChange={(v) => set({ prompt: v })} placeholder='What should the learner answer?' />
      </Field>

      {(q.kind === 'single' || q.kind === 'multiple') && (
        <div className='flex flex-col gap-1.5'>
          <div className='text-xs font-medium text-text-secondary'>
            Answers <span className='font-normal text-text-tertiary'>— tick the {q.kind === 'multiple' ? 'right ones' : 'right one'}</span>
          </div>
          {q.options.map((o, i) => (
            <div key={o.id} className='flex items-center gap-2'>
              <input
                type={q.kind === 'multiple' ? 'checkbox' : 'radio'}
                name={group}
                checked={o.correct}
                aria-label={`Answer ${i + 1} is right`}
                onChange={(e) => markCorrect(i, e.target.checked)}
              />
              <TextLine value={o.text} onChange={(v) => setOption(i, { text: v })} placeholder={`Answer ${i + 1}`} ariaLabel={`Answer ${i + 1}`} />
              <IconButton label='Remove answer' danger disabled={q.options.length <= 2} onClick={() => set({ options: q.options.filter((_, j) => j !== i) })}>
                ×
              </IconButton>
            </div>
          ))}
          <AddButton
            disabled={q.options.length >= 10}
            onClick={() => set({ options: [...q.options, { id: newId('o'), text: '', correct: false }] })}
          >
            Add an answer
          </AddButton>
        </div>
      )}

      {q.kind === 'true_false' && (
        <div className='flex flex-col gap-1.5'>
          <div className='text-xs font-medium text-text-secondary'>The right answer is</div>
          <div className='flex gap-4'>
            {q.options.map((o, i) => (
              <label key={o.id} className='flex cursor-pointer items-center gap-2 text-sm'>
                <input type='radio' name={group} checked={o.correct} onChange={() => markCorrect(i, true)} />
                {o.text}
              </label>
            ))}
          </div>
        </div>
      )}

      {q.kind === 'matching' && (
        <div className='flex flex-col gap-1.5'>
          <div className='text-xs font-medium text-text-secondary'>
            Pairs <span className='font-normal text-text-tertiary'>— learners see the right side shuffled</span>
          </div>
          {q.pairs.map((p, i) => (
            <div key={p.id} className='flex flex-wrap items-center gap-2 sm:flex-nowrap'>
              <TextLine value={p.left} onChange={(v) => setPair(i, { left: v })} placeholder='This…' ariaLabel={`Pair ${i + 1}, left`} className='flex-1' />
              <span className='text-text-tertiary' aria-hidden='true'>
                →
              </span>
              <TextLine value={p.right} onChange={(v) => setPair(i, { right: v })} placeholder='…goes with this' ariaLabel={`Pair ${i + 1}, right`} className='flex-1' />
              <IconButton label='Remove pair' danger disabled={q.pairs.length <= 2} onClick={() => set({ pairs: q.pairs.filter((_, j) => j !== i) })}>
                ×
              </IconButton>
            </div>
          ))}
          <AddButton disabled={q.pairs.length >= 10} onClick={() => set({ pairs: [...q.pairs, { id: newId('p'), left: '', right: '' }] })}>
            Add a pair
          </AddButton>
        </div>
      )}

      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
        <Field label='Feedback when right'>
          <TextLine value={q.feedback_correct} onChange={(v) => set({ feedback_correct: v })} placeholder='That’s right!' />
        </Field>
        <Field label='Feedback when wrong'>
          <TextLine value={q.feedback_incorrect} onChange={(v) => set({ feedback_incorrect: v })} placeholder='Not quite.' />
        </Field>
      </div>
      <Field label='Explanation (optional)' hint={inQuiz ? 'Shown with the right answer, depending on the quiz settings.' : 'Shown after answering.'}>
        <TextBox value={q.explanation} rows={2} onChange={(v) => set({ explanation: v })} placeholder='Why this is the right answer' />
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lists of items (lists, accordions, tabs, flashcards)
// ---------------------------------------------------------------------------

function ItemsEditor({ items, onChange, noun }: { items: TextItem[]; onChange: (items: TextItem[]) => void; noun: string }) {
  const set = (i: number, patch: Partial<TextItem>) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));

  return (
    <div className='flex flex-col gap-2'>
      {items.map((it, i) => (
        <div key={it.id} className='flex flex-col gap-1.5 rounded-[10px] border border-border-primary p-2.5'>
          <div className='flex items-center gap-1'>
            <TextLine value={it.title} onChange={(v) => set(i, { title: v })} placeholder={`${noun} ${i + 1} title`} ariaLabel={`${noun} ${i + 1} title`} />
            <IconButton label='Move up' disabled={i === 0} onClick={() => onChange(move(items, i, i - 1))}>
              ↑
            </IconButton>
            <IconButton label='Move down' disabled={i === items.length - 1} onClick={() => onChange(move(items, i, i + 1))}>
              ↓
            </IconButton>
            <IconButton label={`Remove ${noun.toLowerCase()}`} danger disabled={items.length <= 1} onClick={() => onChange(items.filter((_, j) => j !== i))}>
              ×
            </IconButton>
          </div>
          <TextBox value={it.text} rows={3} onChange={(v) => set(i, { text: v })} placeholder='What people see when they open it' ariaLabel={`${noun} ${i + 1} text`} />
        </div>
      ))}
      <AddButton disabled={items.length >= 20} onClick={() => onChange([...items, { id: newId('i'), title: '', text: '' }])}>
        Add a {noun.toLowerCase()}
      </AddButton>
    </div>
  );
}

function CardsEditor({ cards, onChange }: { cards: FlashCard[]; onChange: (cards: FlashCard[]) => void }) {
  const set = (i: number, patch: Partial<FlashCard>) => onChange(cards.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <div className='flex flex-col gap-2'>
      {cards.map((c, i) => (
        <div key={c.id} className='flex flex-col gap-1.5 rounded-[10px] border border-border-primary p-2.5'>
          <div className='flex items-center gap-1'>
            <span className='flex-1 text-xs font-medium text-text-secondary'>Card {i + 1}</span>
            <IconButton label='Move up' disabled={i === 0} onClick={() => onChange(move(cards, i, i - 1))}>
              ↑
            </IconButton>
            <IconButton label='Move down' disabled={i === cards.length - 1} onClick={() => onChange(move(cards, i, i + 1))}>
              ↓
            </IconButton>
            <IconButton label='Remove card' danger disabled={cards.length <= 1} onClick={() => onChange(cards.filter((_, j) => j !== i))}>
              ×
            </IconButton>
          </div>
          <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
            <TextBox value={c.front} rows={2} onChange={(v) => set(i, { front: v })} placeholder='Front (question or word)' ariaLabel={`Card ${i + 1} front`} />
            <TextBox value={c.back} rows={2} onChange={(v) => set(i, { back: v })} placeholder='Back (answer)' ariaLabel={`Card ${i + 1} back`} />
          </div>
        </div>
      ))}
      <AddButton disabled={cards.length >= 30} onClick={() => onChange([...cards, { id: newId('c'), front: '', back: '' }])}>
        Add a card
      </AddButton>
    </div>
  );
}

function ListItemsEditor({ items, onChange }: { items: string[]; onChange: (items: string[]) => void }) {
  return (
    <div className='flex flex-col gap-1.5'>
      {items.map((it, i) => (
        <div key={i} className='flex items-center gap-1'>
          <TextLine value={it} onChange={(v) => onChange(items.map((x, j) => (j === i ? v : x)))} placeholder={`Item ${i + 1}`} ariaLabel={`Item ${i + 1}`} />
          <IconButton label='Move up' disabled={i === 0} onClick={() => onChange(move(items, i, i - 1))}>
            ↑
          </IconButton>
          <IconButton label='Remove item' danger disabled={items.length <= 1} onClick={() => onChange(items.filter((_, j) => j !== i))}>
            ×
          </IconButton>
        </div>
      ))}
      <AddButton disabled={items.length >= 50} onClick={() => onChange([...items, ''])}>
        Add an item
      </AddButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

function stepName(steps: ScenarioStep[], id: string) {
  const i = steps.findIndex((s) => s.id === id);

  if (i < 0) return '';
  const text = steps[i].text.trim();

  return `Step ${i + 1}${text ? ` — ${text.length > 32 ? `${text.slice(0, 32)}…` : text}` : ''}`;
}

function ScenarioEditor({ block, onChange }: { block: BlockOf<'scenario'>; onChange: (b: Block) => void }) {
  const set = (patch: Partial<BlockOf<'scenario'>>) => onChange({ ...block, ...patch });
  const setStep = (i: number, patch: Partial<ScenarioStep>) => set({ steps: block.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const setChoice = (si: number, ci: number, patch: Partial<ScenarioChoice>) =>
    setStep(si, { choices: block.steps[si].choices.map((c, j) => (j === ci ? { ...c, ...patch } : c)) });
  const nextOptions = [{ value: '', label: 'End the scenario' }, ...block.steps.map((s) => ({ value: s.id, label: stepName(block.steps, s.id) }))];
  const removeStep = (i: number) => {
    const id = block.steps[i].id;
    const steps = block.steps
      .filter((_, j) => j !== i)
      .map((s) => ({ ...s, choices: s.choices.map((c) => (c.next === id ? { ...c, next: '' } : c)) }));

    set({ steps, start: block.start === id ? steps[0]?.id || '' : block.start });
  };
  const addStep = () => {
    const step: ScenarioStep = { id: newId('s'), text: '', choices: [{ id: newId('ch'), text: '', feedback: '', good: true, next: '' }] };

    set({ steps: [...block.steps, step], start: block.start || step.id });
  };

  return (
    <div className='flex flex-col gap-3'>
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
        <Field label='Title'>
          <TextLine value={block.title} onChange={(v) => set({ title: v })} placeholder='e.g. A customer calls about a late order' />
        </Field>
        <Field label='Starts at'>
          <ChSelect
            value={block.start}
            options={block.steps.map((s) => ({ value: s.id, label: stepName(block.steps, s.id) }))}
            onChange={(v) => set({ start: v })}
            ariaLabel='First step'
          />
        </Field>
      </div>
      <Field label='Set the scene (optional)'>
        <TextBox value={block.intro} rows={2} onChange={(v) => set({ intro: v })} placeholder='Who is the learner talking to, and what is going on?' />
      </Field>
      {block.steps.map((s, si) => (
        <div key={s.id} className='flex flex-col gap-2 rounded-[10px] border border-border-primary p-2.5'>
          <div className='flex items-center gap-1'>
            <span className='flex-1 text-xs font-semibold text-text-secondary'>
              Step {si + 1}
              {block.start === s.id ? ' · first' : ''}
            </span>
            <IconButton label='Remove step' danger disabled={block.steps.length <= 1} onClick={() => removeStep(si)}>
              ×
            </IconButton>
          </div>
          <TextBox value={s.text} rows={2} onChange={(v) => setStep(si, { text: v })} placeholder='What the other person says or what happens' ariaLabel={`Step ${si + 1} text`} />
          <div className='text-xs font-medium text-text-secondary'>Choices for the learner</div>
          {s.choices.map((c, ci) => (
            <div key={c.id} className='flex flex-col gap-1.5 rounded-[8px] bg-fill-content p-2'>
              <div className='flex items-center gap-1'>
                <TextLine value={c.text} onChange={(v) => setChoice(si, ci, { text: v })} placeholder={`Choice ${ci + 1}: what the learner says or does`} ariaLabel={`Step ${si + 1} choice ${ci + 1}`} />
                <IconButton
                  label='Remove choice'
                  danger
                  disabled={s.choices.length <= 1}
                  onClick={() => setStep(si, { choices: s.choices.filter((_, j) => j !== ci) })}
                >
                  ×
                </IconButton>
              </div>
              <TextLine value={c.feedback} onChange={(v) => setChoice(si, ci, { feedback: v })} placeholder='Feedback after this choice (optional)' ariaLabel='Feedback' />
              <div className='flex flex-wrap items-center gap-x-4 gap-y-1.5'>
                <Toggle checked={c.good} onChange={(v) => setChoice(si, ci, { good: v })} label='Good choice' />
                <label className='flex min-w-0 items-center gap-2 text-sm'>
                  <span className='shrink-0 text-xs text-text-secondary'>Then</span>
                  <ChSelect value={c.next} options={nextOptions} onChange={(v) => setChoice(si, ci, { next: v })} ariaLabel='What happens next' className='max-w-[220px]' />
                </label>
              </div>
            </div>
          ))}
          <AddButton
            disabled={s.choices.length >= 6}
            onClick={() => setStep(si, { choices: [...s.choices, { id: newId('ch'), text: '', feedback: '', good: false, next: '' }] })}
          >
            Add a choice
          </AddButton>
        </div>
      ))}
      <AddButton disabled={block.steps.length >= 20} onClick={addStep}>
        Add a step
      </AddButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Care Hub page link
// ---------------------------------------------------------------------------

function PageLinkEditor({ block, onChange }: { block: BlockOf<'page_link'>; onChange: (b: Block) => void }) {
  const pages = useSharablePages();
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState(!block.view_id);
  const found = useMemo(() => filterPages(pages, query, 8), [pages, query]);
  const current = pages.find((p) => p.viewId === block.view_id);

  return (
    <div className='flex flex-col gap-3'>
      {block.view_id && !picking ? (
        <div className='flex items-center gap-2 rounded-[10px] border border-border-primary px-3 py-2'>
          <span aria-hidden='true'>{current?.icon || '📄'}</span>
          <span className='min-w-0 flex-1'>
            <span className='block truncate text-sm font-medium'>{current?.name || block.title || 'Linked page'}</span>
            {current?.trail && <span className='block truncate text-xs text-text-tertiary'>{current.trail}</span>}
            {!current && <span className='block text-xs text-text-tertiary'>This page isn’t in your sidebar (it may be private to someone else).</span>}
          </span>
          <button type='button' className='text-sm font-medium text-text-action' onClick={() => setPicking(true)}>
            Change
          </button>
        </div>
      ) : (
        <div className='flex flex-col gap-1.5'>
          <TextLine type='search' value={query} onChange={setQuery} placeholder='Search for a page' ariaLabel='Search for a page' />
          <div className='flex max-h-[220px] flex-col overflow-y-auto rounded-[10px] border border-border-primary p-1'>
            {found.length ? (
              found.map((p) => (
                <button
                  key={p.viewId}
                  type='button'
                  className='flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-sm hover:bg-fill-content-hover'
                  onClick={() => {
                    onChange({ ...block, view_id: p.viewId, title: block.title.trim() ? block.title : p.name });
                    setPicking(false);
                    setQuery('');
                  }}
                >
                  <span aria-hidden='true'>{p.icon || '📄'}</span>
                  <span className='min-w-0 flex-1'>
                    <span className='block truncate'>{p.name}</span>
                    {p.trail && <span className='block truncate text-xs text-text-tertiary'>{p.trail}</span>}
                  </span>
                  {p.isPrivate && <span className='text-xs text-text-tertiary'>Private</span>}
                </button>
              ))
            ) : (
              <div className='px-2 py-3 text-center text-sm text-text-tertiary'>{pages.length ? 'No pages match.' : 'No pages found.'}</div>
            )}
          </div>
          {block.view_id && (
            <button type='button' className='self-start text-sm text-text-secondary underline' onClick={() => setPicking(false)}>
              Keep the current page
            </button>
          )}
        </div>
      )}
      <Field label='Link text' hint='Learners need access to the page to open it.'>
        <TextLine value={block.title} onChange={(v) => onChange({ ...block, title: v })} placeholder='e.g. Read the refund policy' />
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One block's fields
// ---------------------------------------------------------------------------

const TONES: { value: Tone; label: string }[] = [
  { value: 'info', label: 'ℹ️ Note' },
  { value: 'tip', label: '💡 Tip' },
  { value: 'warning', label: '⚠️ Warning' },
  { value: 'success', label: '✅ Good to know' },
];
const LIST_STYLES: { value: ListStyle; label: string }[] = [
  { value: 'bullet', label: 'Bullets' },
  { value: 'number', label: 'Numbers' },
  { value: 'check', label: 'Checklist' },
];
const WIDTHS: { value: ImageWidth; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'full', label: 'Full width' },
];
const LEVELS: { value: string; label: string }[] = [
  { value: '1', label: 'Large' },
  { value: '2', label: 'Medium' },
  { value: '3', label: 'Small' },
];

export function BlockEditor({ block, onChange }: { block: Block; onChange: (b: Block) => void }) {
  switch (block.type) {
    case 'heading':
      return (
        <div className='flex flex-wrap items-end gap-3'>
          <Field label='Heading' className='min-w-[200px] flex-1'>
            <TextLine value={block.text} onChange={(v) => onChange({ ...block, text: v })} placeholder='Section title' />
          </Field>
          <Field label='Size'>
            <ChSelect
              value={String(block.level)}
              options={LEVELS}
              onChange={(v) => onChange({ ...block, level: v === '1' ? 1 : v === '3' ? 3 : 2 })}
              ariaLabel='Heading size'
            />
          </Field>
        </div>
      );
    case 'paragraph':
      return (
        <Field label='Text' hint={FORMAT_HINT}>
          <TextBox value={block.text} rows={4} onChange={(v) => onChange({ ...block, text: v })} placeholder='Write something…' />
        </Field>
      );
    case 'statement':
      return (
        <Field label='Statement' hint='Keep it short — it shows in large type.'>
          <TextBox value={block.text} rows={2} onChange={(v) => onChange({ ...block, text: v })} placeholder='The one thing to remember' />
        </Field>
      );
    case 'quote':
      return (
        <div className='flex flex-col gap-3'>
          <Field label='Quote'>
            <TextBox value={block.text} rows={2} onChange={(v) => onChange({ ...block, text: v })} placeholder='What they said' />
          </Field>
          <Field label='Who said it (optional)'>
            <TextLine value={block.cite} onChange={(v) => onChange({ ...block, cite: v })} placeholder='Name, role' />
          </Field>
        </div>
      );
    case 'callout':
      return (
        <div className='flex flex-col gap-3'>
          <div className='flex flex-wrap items-end gap-3'>
            <Field label='Style'>
              <ChSelect value={block.tone} options={TONES} onChange={(v) => onChange({ ...block, tone: v })} ariaLabel='Callout style' />
            </Field>
            <Field label='Title (optional)' className='min-w-[180px] flex-1'>
              <TextLine value={block.title} onChange={(v) => onChange({ ...block, title: v })} placeholder='e.g. Remember' />
            </Field>
          </div>
          <Field label='Text' hint={FORMAT_HINT}>
            <TextBox value={block.text} rows={3} onChange={(v) => onChange({ ...block, text: v })} />
          </Field>
        </div>
      );
    case 'list':
      return (
        <div className='flex flex-col gap-3'>
          <Field label='Style' className='self-start'>
            <ChSelect value={block.style} options={LIST_STYLES} onChange={(v) => onChange({ ...block, style: v })} ariaLabel='List style' />
          </Field>
          <ListItemsEditor items={block.items} onChange={(items) => onChange({ ...block, items })} />
        </div>
      );
    case 'divider':
      return <div className='text-sm text-text-tertiary'>A line between sections. Nothing to fill in.</div>;
    case 'image':
      return (
        <div className='flex flex-col gap-3'>
          <UrlField label='Picture link' value={block.url} onChange={(v) => onChange({ ...block, url: v })} hint={MEDIA_NOTE} />
          <PicturePicker value={block.url} onPick={(url) => onChange({ ...block, url })} />
          <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
            <Field label='Describe the picture' hint='Read aloud for people who can’t see it.'>
              <TextLine value={block.alt} onChange={(v) => onChange({ ...block, alt: v })} placeholder='e.g. A baker boxing an order' />
            </Field>
            <Field label='Caption (optional)'>
              <TextLine value={block.caption} onChange={(v) => onChange({ ...block, caption: v })} />
            </Field>
          </div>
          <Field label='Size' className='self-start'>
            <ChSelect value={block.width} options={WIDTHS} onChange={(v) => onChange({ ...block, width: v })} ariaLabel='Picture size' />
          </Field>
        </div>
      );
    case 'video': {
      const u = block.url.trim();
      const known = !u || Boolean(videoEmbedUrl(u)) || /\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/i.test(u);

      return (
        <div className='flex flex-col gap-3'>
          <UrlField
            label='Video link'
            value={block.url}
            onChange={(v) => onChange({ ...block, url: v })}
            hint={known ? `YouTube, Vimeo and Loom links play right in the lesson. ${MEDIA_NOTE}` : 'We’ll show this as a link to open the video.'}
          />
          <Field label='Caption (optional)'>
            <TextLine value={block.caption} onChange={(v) => onChange({ ...block, caption: v })} />
          </Field>
        </div>
      );
    }

    case 'audio':
      return (
        <div className='flex flex-col gap-3'>
          <UrlField label='Audio link' value={block.url} onChange={(v) => onChange({ ...block, url: v })} hint={MEDIA_NOTE} />
          <Field label='Caption (optional)'>
            <TextLine value={block.caption} onChange={(v) => onChange({ ...block, caption: v })} />
          </Field>
        </div>
      );
    case 'file':
      return (
        <div className='flex flex-col gap-3'>
          <UrlField label='File link' value={block.url} onChange={(v) => onChange({ ...block, url: v })} hint={MEDIA_NOTE} />
          <Field label='File name shown to learners (optional)'>
            <TextLine value={block.name} onChange={(v) => onChange({ ...block, name: v })} placeholder='e.g. Refund checklist (PDF)' />
          </Field>
        </div>
      );
    case 'embed':
      return (
        <div className='flex flex-wrap items-end gap-3'>
          <div className='min-w-[220px] flex-1'>
            <UrlField
              label='Website link'
              httpsOnly
              value={block.url}
              onChange={(v) => onChange({ ...block, url: v })}
              hint='Some websites don’t allow being shown inside other pages.'
            />
          </div>
          <Field label='Height (px)'>
            <NumberField value={block.height} min={200} max={1200} onChange={(v) => onChange({ ...block, height: v })} ariaLabel='Height in pixels' />
          </Field>
        </div>
      );
    case 'accordion':
      return <ItemsEditor noun='Section' items={block.items} onChange={(items) => onChange({ ...block, items })} />;
    case 'tabs':
      return <ItemsEditor noun='Tab' items={block.items} onChange={(items) => onChange({ ...block, items })} />;
    case 'flashcards':
      return <CardsEditor cards={block.cards} onChange={(cards) => onChange({ ...block, cards })} />;
    case 'continue':
      return (
        <div className='flex flex-col gap-3'>
          <Field label='Button text' className='max-w-[320px]'>
            <TextLine value={block.label} onChange={(v) => onChange({ ...block, label: v })} placeholder='Continue' maxLength={60} />
          </Field>
          <Toggle
            checked={block.require_complete}
            onChange={(v) => onChange({ ...block, require_complete: v })}
            label='Wait until the questions and scenarios above are done'
            hint='Everything below this button stays hidden until the learner presses it.'
          />
        </div>
      );
    case 'knowledge_check':
      return <QuestionEditor q={block.question} onChange={(question) => onChange({ ...block, question })} />;
    case 'scenario':
      return <ScenarioEditor block={block} onChange={onChange} />;
    case 'page_link':
      return <PageLinkEditor block={block} onChange={onChange} />;
    default:
      return null;
  }
}

/** One block in the lesson editor: its name, move/duplicate/delete controls, and its fields. */
export function BlockCard({
  block,
  index,
  count,
  onChange,
  onMove,
  onDuplicate,
  onDelete,
  onAddBelow,
}: {
  block: Block;
  index: number;
  count: number;
  onChange: (b: Block) => void;
  onMove: (delta: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAddBelow: () => void;
}) {
  const info = BLOCK_INFO[block.type];

  return (
    <div id={`chs-b-${block.id}`} className='scroll-mt-4 rounded-[12px] border border-border-primary' data-testid='carehub-learning-block'>
      <div className='flex items-center gap-0.5 border-b border-border-primary py-1 pl-3 pr-1'>
        <span className='mr-1.5' aria-hidden='true'>
          {info.emoji}
        </span>
        <span className='min-w-0 flex-1 truncate text-xs font-semibold text-text-secondary'>{info.label}</span>
        <IconButton label='Move up' disabled={index === 0} onClick={() => onMove(-1)}>
          ↑
        </IconButton>
        <IconButton label='Move down' disabled={index >= count - 1} onClick={() => onMove(1)}>
          ↓
        </IconButton>
        <IconButton label='Duplicate' onClick={onDuplicate}>
          <CopyIcon />
        </IconButton>
        <IconButton label='Add a block below' onClick={onAddBelow}>
          ＋
        </IconButton>
        <IconButton label='Delete block' danger onClick={onDelete}>
          🗑
        </IconButton>
      </div>
      <div className='p-3'>
        <BlockEditor block={block} onChange={onChange} />
      </div>
    </div>
  );
}

// CareHub: simple formatting for form descriptions.
//
// Descriptions stay plain text, with a few readable markers:
//   **bold**   *italic*   __underline__   {red}coloured text{/red}   [label](https://link)
// The respondent page turns the markers into formatting. No HTML is ever
// inserted, so a description can't inject code into the public form.
import { Fragment, ReactNode, useLayoutEffect, useRef, useState } from 'react';

export const CAREHUB_TEXT_COLORS: Record<string, string> = {
  gray: '#8a8a8a',
  brown: '#a27763',
  orange: '#d9730d',
  yellow: '#c29343',
  green: '#4f9768',
  blue: '#3d89c4',
  purple: '#9a6dd7',
  pink: '#c94f93',
  red: '#d9534f',
};

const COLOR_NAMES = Object.keys(CAREHUB_TEXT_COLORS).join('|');

const RULES: { re: RegExp; render: (m: RegExpExecArray, key: string) => ReactNode }[] = [
  {
    re: /^\*\*([\s\S]+?)\*\*/,
    render: (m, key) => <strong key={key}>{renderCareHubRichText(m[1], key)}</strong>,
  },
  {
    re: /^__([\s\S]+?)__/,
    render: (m, key) => <u key={key}>{renderCareHubRichText(m[1], key)}</u>,
  },
  {
    re: /^\*([^*\s][\s\S]*?)\*/,
    render: (m, key) => <em key={key}>{renderCareHubRichText(m[1], key)}</em>,
  },
  {
    re: new RegExp('^\\{(' + COLOR_NAMES + ')\\}([\\s\\S]*?)\\{/\\1\\}'),
    render: (m, key) => (
      <span key={key} style={{ color: CAREHUB_TEXT_COLORS[m[1]] }}>
        {renderCareHubRichText(m[2], key)}
      </span>
    ),
  },
  {
    re: /^\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/,
    render: (m, key) => (
      <a key={key} href={m[2]} target='_blank' rel='noreferrer noopener' className='underline'>
        {m[1]}
      </a>
    ),
  },
];

/** Turns a description with CareHub markers into formatted text. */
export function renderCareHubRichText(text: string, keyPrefix = 'r'): ReactNode[] {
  const out: ReactNode[] = [];
  let plain = '';
  let i = 0;

  const flush = () => {
    if (plain) {
      out.push(<Fragment key={`${keyPrefix}-t${out.length}`}>{plain}</Fragment>);
      plain = '';
    }
  };

  while (i < text.length) {
    const ch = text[i];

    if (ch === '*' || ch === '_' || ch === '{' || ch === '[') {
      const rest = text.slice(i);
      let matched = false;

      for (const rule of RULES) {
        const m = rule.re.exec(rest);

        if (m) {
          flush();
          out.push(rule.render(m, `${keyPrefix}-${out.length}`));
          i += m[0].length;
          matched = true;
          break;
        }
      }

      if (matched) continue;
    }

    plain += ch;
    i += 1;
  }

  flush();
  return out;
}

const HAS_MARKERS = /\*|__|\{[a-z]+\}|\[[^\]]+\]\(/;

function ToolButton({
  label,
  title,
  onPress,
  className,
}: {
  label: ReactNode;
  title: string;
  onPress: () => void;
  className?: string;
}) {
  return (
    <button
      type='button'
      title={title}
      aria-label={title}
      // Keep the cursor/selection in the text box.
      onMouseDown={(e) => {
        e.preventDefault();
        onPress();
      }}
      className={
        'flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-sm text-text-secondary hover:bg-fill-content hover:text-text-primary ' +
        (className ?? '')
      }
    >
      {label}
    </button>
  );
}

/**
 * Multi-line description editor with a small formatting bar
 * (bold, italic, underline, colour, link). It grows with the text.
 */
export function CareHubDescriptionEditor({
  value,
  onChange,
  onFocus,
  onBlur,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingSelection = useRef<[number, number] | null>(null);
  const [showColors, setShowColors] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;

    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 64)}px`;
    if (pendingSelection.current) {
      const [start, end] = pendingSelection.current;

      pendingSelection.current = null;
      el.focus();
      el.setSelectionRange(start, end);
    }
  }, [value]);

  const wrap = (open: string, close: string, fallback = 'text') => {
    const el = ref.current;

    if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const selected = value.slice(start, end) || fallback;
    const next = value.slice(0, start) + open + selected + close + value.slice(end);

    pendingSelection.current = [start + open.length, start + open.length + selected.length];
    onChange(next);
  };

  const addLink = () => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const url = window.prompt('Link address (https://...)', 'https://');

    if (!url || !/^(https?:\/\/|mailto:)\S+$/.test(url.trim())) return;
    const label = value.slice(start, end) || 'link';
    const insert = `[${label}](${url.trim()})`;

    pendingSelection.current = [start + insert.length, start + insert.length];
    onChange(value.slice(0, start) + insert + value.slice(end));
  };

  return (
    <div className='mt-2 flex flex-col gap-1' onMouseDownCapture={(e) => e.stopPropagation()}>
      <div className='flex flex-wrap items-center gap-0.5'>
        <ToolButton label={<b>B</b>} title='Bold (⌘B)' onPress={() => wrap('**', '**')} />
        <ToolButton label={<i>I</i>} title='Italic (⌘I)' onPress={() => wrap('*', '*')} />
        <ToolButton label={<u>U</u>} title='Underline (⌘U)' onPress={() => wrap('__', '__')} />
        <ToolButton
          label={<span style={{ borderBottom: '3px solid #d9534f', lineHeight: 1 }}>A</span>}
          title='Text colour'
          onPress={() => setShowColors((v) => !v)}
        />
        <ToolButton label='Link' title='Add link' onPress={addLink} />
        {showColors && (
          <div className='ml-1 flex items-center gap-1'>
            {Object.entries(CAREHUB_TEXT_COLORS).map(([name, color]) => (
              <button
                key={name}
                type='button'
                title={name}
                aria-label={name}
                onMouseDown={(e) => {
                  e.preventDefault();
                  wrap(`{${name}}`, `{/${name}}`);
                  setShowColors(false);
                }}
                className='h-5 w-5 rounded-full border border-line-divider'
                style={{ background: color }}
              />
            ))}
          </div>
        )}
      </div>
      <textarea
        ref={ref}
        value={value}
        rows={3}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
          const key = e.key.toLowerCase();

          if (key === 'b') {
            e.preventDefault();
            wrap('**', '**');
          } else if (key === 'i') {
            e.preventDefault();
            wrap('*', '*');
          } else if (key === 'u') {
            e.preventDefault();
            wrap('__', '__');
          }
        }}
        className='w-full resize-y overflow-hidden rounded-md border border-line-divider bg-transparent px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-text-tertiary focus:border-text-secondary'
      />
      {HAS_MARKERS.test(value) && (
        <div className='whitespace-pre-wrap break-words rounded-md bg-fill-content px-3 py-2 text-sm text-text-secondary'>
          <span className='mr-2 text-xs uppercase tracking-wide text-text-tertiary'>Preview</span>
          {renderCareHubRichText(value)}
        </div>
      )}
    </div>
  );
}

// CareHub: formatted form descriptions.
//
// The editor is "what you see is what you get": Bold, Italic, Underline,
// colour and links are applied straight to the text. Behind the scenes the
// description is saved as plain text with small tags, e.g.
//   {b}bold{/b}  {i}italic{/i}  {u}underline{/u}  {red}red{/red}  {link:https://x}label{/link}
// (older **bold** / *italic* / __underline__ text is still understood).
// The respondent page turns the tags into formatting. No HTML is ever stored
// or injected, so a description can't put code into the public form.
import { Fragment, ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

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

const COLOR_NAMES = Object.keys(CAREHUB_TEXT_COLORS);
const SAFE_URL = /^(https?:\/\/|mailto:)[^\s{}<>"]+$/i;

// ---------------------------------------------------------------------------
// Parsing (tags -> tree)
// ---------------------------------------------------------------------------
type RichNode =
  | { t: 'text'; v: string }
  | { t: 'b' | 'i' | 'u'; c: RichNode[] }
  | { t: 'color'; name: string; c: RichNode[] }
  | { t: 'link'; href: string; c: RichNode[] };

const RULES: { re: RegExp; make: (m: RegExpExecArray) => RichNode }[] = [
  { re: /^\{(b|i|u)\}([\s\S]*?)\{\/\1\}/, make: (m) => ({ t: m[1] as 'b', c: parseRich(m[2]) }) },
  {
    re: new RegExp('^\\{(' + COLOR_NAMES.join('|') + ')\\}([\\s\\S]*?)\\{/\\1\\}'),
    make: (m) => ({ t: 'color', name: m[1], c: parseRich(m[2]) }),
  },
  {
    re: /^\{link:((?:https?:\/\/|mailto:)[^\s{}<>"]+)\}([\s\S]*?)\{\/link\}/i,
    make: (m) => ({ t: 'link', href: m[1], c: parseRich(m[2]) }),
  },
  // Older formats
  { re: /^\*\*([\s\S]+?)\*\*/, make: (m) => ({ t: 'b', c: parseRich(m[1]) }) },
  { re: /^__([\s\S]+?)__/, make: (m) => ({ t: 'u', c: parseRich(m[1]) }) },
  { re: /^\*([^*\s][\s\S]*?)\*/, make: (m) => ({ t: 'i', c: parseRich(m[1]) }) },
  {
    re: /^\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/,
    make: (m) => ({ t: 'link', href: m[2], c: [{ t: 'text', v: m[1] }] }),
  },
];

export function parseRich(text: string): RichNode[] {
  const out: RichNode[] = [];
  let plain = '';
  let i = 0;
  const flush = () => {
    if (plain) out.push({ t: 'text', v: plain });
    plain = '';
  };

  while (i < text.length) {
    const ch = text[i];

    if (ch === '{' || ch === '*' || ch === '_' || ch === '[') {
      const rest = text.slice(i);
      let matched = false;

      for (const rule of RULES) {
        const m = rule.re.exec(rest);

        if (m) {
          flush();
          out.push(rule.make(m));
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

// ---------------------------------------------------------------------------
// Rendering for respondents and read-only cards
// ---------------------------------------------------------------------------
function toReact(nodes: RichNode[], prefix: string): ReactNode[] {
  return nodes.map((n, idx) => {
    const key = `${prefix}-${idx}`;

    switch (n.t) {
      case 'text':
        return <Fragment key={key}>{n.v}</Fragment>;
      case 'b':
        return <strong key={key}>{toReact(n.c, key)}</strong>;
      case 'i':
        return <em key={key}>{toReact(n.c, key)}</em>;
      case 'u':
        return <u key={key}>{toReact(n.c, key)}</u>;
      case 'color':
        return (
          <span key={key} style={{ color: CAREHUB_TEXT_COLORS[n.name] }}>
            {toReact(n.c, key)}
          </span>
        );
      case 'link':
        return (
          <a key={key} href={n.href} target='_blank' rel='noreferrer noopener' className='underline'>
            {toReact(n.c, key)}
          </a>
        );
    }
  });
}

/** Turns a saved description into formatted text. */
export function renderCareHubRichText(text: string): ReactNode[] {
  return toReact(parseRich(text), 'r');
}

// ---------------------------------------------------------------------------
// Editor helpers (tree <-> editable HTML)
// ---------------------------------------------------------------------------
function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toHtml(nodes: RichNode[]): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case 'text':
          return escapeHtml(n.v).replace(/\n/g, '<br>');
        case 'b':
          return `<b>${toHtml(n.c)}</b>`;
        case 'i':
          return `<i>${toHtml(n.c)}</i>`;
        case 'u':
          return `<u>${toHtml(n.c)}</u>`;
        case 'color':
          return `<font color="${CAREHUB_TEXT_COLORS[n.name]}">${toHtml(n.c)}</font>`;
        case 'link':
          return `<a href="${escapeHtml(n.href)}">${toHtml(n.c)}</a>`;
      }

      return '';
    })
    .join('');
}

function hexOf(color: string): string | null {
  const c = color.trim().toLowerCase();

  if (/^#[0-9a-f]{6}$/.test(c)) return c;
  if (/^#[0-9a-f]{3}$/.test(c)) return '#' + c.slice(1).split('').map((x) => x + x).join('');
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);

  if (!m) return null;
  return '#' + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('');
}

function colorName(color: string | null | undefined): string | null {
  if (!color) return null;
  const hex = hexOf(color);

  if (!hex) return null;
  let best: string | null = null;
  let bestDist = Infinity;
  const rgb = (h: string) => [1, 3, 5].map((p) => parseInt(h.slice(p, p + 2), 16));
  const [r, g, b] = rgb(hex);

  for (const [name, value] of Object.entries(CAREHUB_TEXT_COLORS)) {
    const [r2, g2, b2] = rgb(value);
    const dist = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;

    if (dist < bestDist) {
      bestDist = dist;
      best = name;
    }
  }

  return bestDist <= 40 * 40 * 3 ? best : null;
}

function wrapTag(open: string, close: string, inner: string) {
  return inner ? open + inner + close : '';
}

/** Reads the editor's contents back into the saved text format. */
function serialize(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\u00a0/g, ' ');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  const tag = el.tagName;

  if (tag === 'BR') return '\n';
  let inner = Array.from(el.childNodes).map(serialize).join('');

  if (tag === 'DIV' || tag === 'P') {
    const onlyBreak = el.childNodes.length === 1 && (el.firstChild as HTMLElement)?.tagName === 'BR';

    if (onlyBreak) inner = '';
    return (el.previousSibling ? '\n' : '') + inner;
  }

  const style = el.style;
  const weight = style?.fontWeight;

  if (tag === 'B' || tag === 'STRONG' || weight === 'bold' || Number(weight) >= 600) inner = wrapTag('{b}', '{/b}', inner);
  if (tag === 'I' || tag === 'EM' || style?.fontStyle === 'italic') inner = wrapTag('{i}', '{/i}', inner);
  if (tag === 'U' || (style?.textDecoration || style?.textDecorationLine || '').includes('underline'))
    inner = wrapTag('{u}', '{/u}', inner);
  const name = colorName(el.getAttribute('color') || style?.color);

  if (name) inner = wrapTag(`{${name}}`, `{/${name}}`, inner);
  if (tag === 'A') {
    const href = el.getAttribute('href') || '';

    if (SAFE_URL.test(href)) inner = wrapTag(`{link:${href}}`, '{/link}', inner);
  }

  return inner;
}

function serializeRoot(root: HTMLElement) {
  return Array.from(root.childNodes).map(serialize).join('').replace(/\n+$/, '');
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------
type Format = 'bold' | 'italic' | 'underline';

function ToolButton({
  children,
  title,
  active,
  onPress,
}: {
  children: ReactNode;
  title: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type='button'
      data-carehub-tool=''
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onPress}
      className={
        'flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-sm transition-colors ' +
        (active
          ? 'bg-fill-content text-text-primary'
          : 'text-text-secondary hover:bg-fill-content hover:text-text-primary')
      }
    >
      {children}
    </button>
  );
}

/**
 * Description editor with a small formatting bar shown while editing.
 * Formatting appears directly in the text (no symbols, no preview).
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
  const ref = useRef<HTMLDivElement>(null);
  const lastValue = useRef<string | null>(null);
  const savedRange = useRef<Range | null>(null);
  const [focused, setFocused] = useState(false);
  const [showColors, setShowColors] = useState(false);
  const [active, setActive] = useState<Record<Format, boolean>>({ bold: false, italic: false, underline: false });

  // Show the saved text (only when it changed from outside the editor).
  useLayoutEffect(() => {
    const el = ref.current;

    if (!el || value === lastValue.current) return;
    lastValue.current = value;
    el.innerHTML = toHtml(parseRich(value));
  }, [value]);

  const emit = useCallback(() => {
    const el = ref.current;

    if (!el) return;
    const next = serializeRoot(el);

    if (!el.textContent) el.innerHTML = '';
    if (next === lastValue.current) return;
    lastValue.current = next;
    onChange(next);
  }, [onChange]);

  const refreshActive = useCallback(() => {
    try {
      setActive({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
      });
    } catch {
      // Not supported: buttons simply don't light up.
    }
  }, []);

  useEffect(() => {
    if (!focused) return;
    const onSelection = () => {
      const sel = window.getSelection();

      if (sel && sel.rangeCount && ref.current?.contains(sel.anchorNode)) {
        savedRange.current = sel.getRangeAt(0).cloneRange();
        refreshActive();
      }
    };

    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
  }, [focused, refreshActive]);

  const restoreSelection = () => {
    const el = ref.current;

    if (!el) return;
    el.focus();
    const range = savedRange.current;
    const sel = window.getSelection();

    if (range && sel && el.contains(range.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  };

  const run = (command: string, arg?: string) => {
    restoreSelection();
    try {
      document.execCommand('styleWithCSS', false, 'false');
    } catch {
      // ignore
    }

    document.execCommand(command, false, arg);
    emit();
    refreshActive();
  };

  const addLink = () => {
    const range = savedRange.current?.cloneRange() ?? null;
    const url = window.prompt('Link address', 'https://')?.trim();

    if (!url || !SAFE_URL.test(url)) return;
    savedRange.current = range;
    if (!range || range.collapsed) {
      restoreSelection();
      document.execCommand('insertHTML', false, `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>&nbsp;`);
      emit();
      return;
    }

    run('createLink', url);
  };

  const visible = focused || showColors;

  return (
    <div
      className='mt-2'
      // The question card can be dragged; keep clicks and text selection
      // in here from starting a drag, and keep the text selection when a
      // toolbar button is pressed.
      onMouseDownCapture={(e) => {
        e.stopPropagation();
        if ((e.target as HTMLElement).closest('[data-carehub-tool]')) e.preventDefault();
      }}
    >
      <div
        className={
          'mb-1 flex flex-wrap items-center gap-0.5 overflow-hidden transition-all ' +
          (visible ? 'max-h-16 opacity-100' : 'pointer-events-none max-h-0 opacity-0')
        }
      >
        <ToolButton title='Bold (⌘B)' active={active.bold} onPress={() => run('bold')}>
          <b>B</b>
        </ToolButton>
        <ToolButton title='Italic (⌘I)' active={active.italic} onPress={() => run('italic')}>
          <i className='font-serif'>I</i>
        </ToolButton>
        <ToolButton title='Underline (⌘U)' active={active.underline} onPress={() => run('underline')}>
          <u>U</u>
        </ToolButton>
        <ToolButton title='Text colour' active={showColors} onPress={() => setShowColors((v) => !v)}>
          <span className='flex flex-col items-center leading-none'>
            <span>A</span>
            <span className='mt-0.5 h-[3px] w-3 rounded-full' style={{ background: 'linear-gradient(90deg,#d9534f,#c29343,#4f9768,#3d89c4,#9a6dd7)' }} />
          </span>
        </ToolButton>
        <ToolButton title='Add link' onPress={addLink}>
          <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden>
            <path d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' />
            <path d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' />
          </svg>
        </ToolButton>
        {showColors && (
          <div className='ml-1 flex items-center gap-1 border-l border-line-divider pl-2'>
            {Object.entries(CAREHUB_TEXT_COLORS).map(([name, color]) => (
              <button
                key={name}
                type='button'
                data-carehub-tool=''
                title={name[0].toUpperCase() + name.slice(1)}
                aria-label={name}
                onClick={() => {
                  run('foreColor', color);
                  setShowColors(false);
                }}
                className='h-[18px] w-[18px] rounded-full ring-1 ring-black/10 transition-transform hover:scale-110'
                style={{ background: color }}
              />
            ))}
          </div>
        )}
      </div>
      <div
        ref={ref}
        role='textbox'
        aria-multiline='true'
        aria-label={placeholder}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={emit}
        onFocus={() => {
          setFocused(true);
          onFocus?.();
        }}
        onBlur={() => {
          emit();
          setFocused(false);
          setShowColors(false);
          onBlur?.();
        }}
        onKeyDown={(e) => {
          if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
          const key = e.key.toLowerCase();
          const command = key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'u' ? 'underline' : null;

          if (command) {
            e.preventDefault();
            run(command);
          }
        }}
        onPaste={(e) => {
          // Paste as plain text so outside styles don't come along.
          e.preventDefault();
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
        }}
        className={
          'min-h-[64px] w-full whitespace-pre-wrap break-words rounded-md border bg-transparent px-3 py-2 text-sm leading-relaxed outline-none transition-colors ' +
          'empty:before:pointer-events-none empty:before:text-text-tertiary empty:before:content-[attr(data-placeholder)] ' +
          '[&_a]:underline ' +
          (focused ? 'border-text-tertiary' : 'border-transparent hover:border-line-divider')
        }
      />
    </div>
  );
}

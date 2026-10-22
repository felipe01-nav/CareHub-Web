// CareHub: page layout blocks — columns (2/3/4) and tabs.
import DOMPurify from 'dompurify';
import React, { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Editor, Element, Path, Transforms } from 'slate';
import { ReactEditor, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId, getBlockEntry } from '@/application/slate-yjs/utils/editor';
import {
  createBlock,
  deleteBlock,
  executeOperations,
  getBlock,
  getBlockIndex,
  getParent,
  moveNode,
  updateBlockParent,
} from '@/application/slate-yjs/utils/yjs';
import { BlockType, ViewIconType, YBlock, YjsEditorKey, YSharedRoot } from '@/application/types';
import { CustomIconPopover } from '@/components/_shared/cutsom-icon/CustomIconPopover';
import { EditorElementProps } from '@/components/editor/editor.type';
import { useEditorContext } from '@/components/editor/EditorContext';
import { renderColor } from '@/utils/color';

export const CAREHUB_TABS = 'carehub_tabs' as BlockType;
export const CAREHUB_TAB = 'carehub_tab' as BlockType;

type TabData = { name?: string; icon?: string; icon_svg?: string };

function newParagraph(sharedRoot: YSharedRoot) {
  return createBlock(sharedRoot, { ty: BlockType.Paragraph, data: {} });
}

function newTab(sharedRoot: YSharedRoot, name: string) {
  const tab = createBlock(sharedRoot, { ty: CAREHUB_TAB, data: { name } });

  updateBlockParent(sharedRoot, newParagraph(sharedRoot), tab, 0);
  return tab;
}

function selectFirstText(editor: YjsEditor, blockId: string) {
  const attempt = () => {
    try {
      const entry = findSlateEntryByBlockId(editor, blockId);

      if (!entry) return false;
      Transforms.select(editor, Editor.start(editor, entry[1]));
      ReactEditor.focus(editor);
      return true;
    } catch {
      return false;
    }
  };

  if (!attempt()) {
    requestAnimationFrame(() => {
      if (!attempt()) setTimeout(attempt, 50);
    });
  }
}

// Insert a layout block where the slash command was typed (same rules as the table command).
function insertLayoutBlock(
  editor: YjsEditor,
  build: (sharedRoot: YSharedRoot) => YBlock,
  focusId?: () => string | undefined
) {
  const entry = getBlockEntry(editor);

  if (!entry) return;

  const blockId = entry[0].blockId as string;
  const isEmpty = !CustomEditor.getBlockTextContent(entry[0], 2);
  const sharedRoot = editor.sharedRoot;
  const parentBlock = getParent(blockId, sharedRoot);

  if (!parentBlock) return;

  const parentBlockId = parentBlock.get(YjsEditorKey.block_id);
  const blockIndex = getBlockIndex(blockId, sharedRoot);

  if (isEmpty) {
    CustomEditor.deleteBlock(editor, blockId);
  }

  const insertIndex = isEmpty ? blockIndex : blockIndex + 1;
  let newId: string | undefined;

  executeOperations(
    sharedRoot,
    [
      () => {
        const parent = getBlock(parentBlockId, sharedRoot);

        if (!parent) return;
        const block = build(sharedRoot);

        newId = block.get(YjsEditorKey.block_id);
        updateBlockParent(sharedRoot, block, parent, insertIndex);
      },
    ],
    'carehubInsertLayoutBlock'
  );

  const target = focusId?.() || newId;

  if (target) selectFirstText(editor, target);
}

export function carehubInsertColumns(editor: YjsEditor, count: number) {
  insertLayoutBlock(editor, (sharedRoot) => {
    const columns = createBlock(sharedRoot, { ty: BlockType.ColumnsBlock, data: {} });

    for (let i = 0; i < count; i++) {
      const column = createBlock(sharedRoot, { ty: BlockType.ColumnBlock, data: {} });

      updateBlockParent(sharedRoot, newParagraph(sharedRoot), column, 0);
      updateBlockParent(sharedRoot, column, columns, i);
    }

    return columns;
  });
}

export function carehubInsertTabs(editor: YjsEditor) {
  insertLayoutBlock(editor, (sharedRoot) => {
    const tabs = createBlock(sharedRoot, { ty: CAREHUB_TABS, data: {} });

    updateBlockParent(sharedRoot, newTab(sharedRoot, 'Tab 1'), tabs, 0);
    updateBlockParent(sharedRoot, newTab(sharedRoot, 'Tab 2'), tabs, 1);
    return tabs;
  });
}

// Meeting notes: summary, notes and a private transcript (see CareHubTranscription.tsx).
export function carehubInsertMeeting(editor: YjsEditor) {
  let notesParagraph: string | undefined;

  insertLayoutBlock(
    editor,
    (sharedRoot) => {
      const now = new Date().toISOString();
      const meeting = createBlock(sharedRoot, {
        ty: BlockType.AIMeetingBlock,
        data: { title: '', date: now, created_at: now, recording_state: 'idle', show_notes_directly: false },
      });
      const section = (ty: BlockType, index: number) => {
        const block = createBlock(sharedRoot, { ty, data: {} });
        const paragraph = newParagraph(sharedRoot);

        updateBlockParent(sharedRoot, paragraph, block, 0);
        updateBlockParent(sharedRoot, block, meeting, index);
        return paragraph;
      };

      section(BlockType.AIMeetingSummaryBlock, 0);
      notesParagraph = section(BlockType.AIMeetingNotesBlock, 1).get(YjsEditorKey.block_id);
      section(BlockType.AIMeetingTranscriptionBlock, 2);
      return meeting;
    },
    () => notesParagraph
  );
}

export const CareHubMeetingIcon = () => (
  <svg width='1em' height='1em' viewBox='0 0 20 20' fill='none' stroke='currentColor' strokeWidth='1.4'>
    <rect x='7.5' y='2.5' width='5' height='9' rx='2.5' />
    <path d='M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5M7 17.5h6' strokeLinecap='round' />
  </svg>
);

export const CareHubColumnsIcon = ({ count = 2 }: { count?: number }) => (
  <svg width='1em' height='1em' viewBox='0 0 20 20' fill='none' stroke='currentColor' strokeWidth='1.4'>
    <rect x='2.5' y='3.5' width='15' height='13' rx='2' />
    {Array.from({ length: count - 1 }).map((_, i) => {
      const x = 2.5 + (15 / count) * (i + 1);

      return <line key={i} x1={x} y1='3.5' x2={x} y2='16.5' />;
    })}
  </svg>
);

export const CareHubTabsIcon = () => (
  <svg width='1em' height='1em' viewBox='0 0 20 20' fill='none' stroke='currentColor' strokeWidth='1.4'>
    <path d='M2.5 7.5V5a1.5 1.5 0 0 1 1.5-1.5h4A1.5 1.5 0 0 1 9.5 5v2.5' />
    <rect x='2.5' y='7.5' width='15' height='9' rx='2' />
    <path d='M9.5 7.5h3' />
  </svg>
);

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

type TabSize = 'body' | 'h3' | 'h2' | 'h1';

const TAB_SIZES: { value: TabSize; label: string }[] = [
  { value: 'body', label: 'Normal text' },
  { value: 'h3', label: 'Heading 3' },
  { value: 'h2', label: 'Heading 2' },
  { value: 'h1', label: 'Heading 1' },
];

const TAB_SIZE_STYLE: Record<TabSize, React.CSSProperties> = {
  body: { fontSize: 14, minHeight: 34 },
  h3: { fontSize: 20, fontWeight: 600, minHeight: 40 },
  h2: { fontSize: 24, fontWeight: 600, minHeight: 46 },
  h1: { fontSize: 30, fontWeight: 700, minHeight: 54 },
};

// Icons picked from the "Icons" tab are stored as a small coloured SVG.
function iconSvg(content: string, color?: string) {
  return content
    .split('black')
    .join(color ? renderColor(color) : 'currentColor')
    .replace('<svg', '<svg width="100%" height="100%"');
}

function TabIcon({ tab }: { tab: { data?: TabData } }) {
  const svg = tab.data?.icon_svg;
  const clean = useMemo(
    () => (svg ? DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } }) : ''),
    [svg]
  );

  if (clean) {
    return (
      <span
        data-carehub-tab-icon
        className={'inline-block shrink-0'}
        style={{ width: '1em', height: '1em' }}
        dangerouslySetInnerHTML={{ __html: clean }}
      />
    );
  }

  if (tab.data?.icon) {
    return (
      <span data-carehub-tab-icon className={'shrink-0 leading-none'} style={{ fontSize: '1em' }}>
        {tab.data.icon}
      </span>
    );
  }

  return null;
}

type TabMenu = { index: number; x: number; y: number };

function TabMenuItem({ onClick, children, danger }: { onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      type={'button'}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-sm hover:bg-fill-content-hover ${
        danger ? 'text-text-error' : 'text-text-primary'
      }`}
    >
      {children}
    </button>
  );
}

export const CareHubTabs = memo(
  forwardRef<HTMLDivElement, EditorElementProps>(({ node, children, className, style, ...attributes }, ref) => {
    const editor = useSlateStatic() as YjsEditor;
    const { readOnly } = useEditorContext();
    const blockId = (node as Element & { blockId?: string }).blockId as string;
    const tabsData = ((node as Element & { data?: { size?: TabSize } }).data || {}) as { size?: TabSize };
    const size: TabSize = tabsData.size && TAB_SIZE_STYLE[tabsData.size] ? tabsData.size : 'body';
    const tabs = ((node as Element).children || []).filter(
      (child) => Element.isElement(child) && (child as Element & { type?: string }).type === CAREHUB_TAB
    ) as (Element & { blockId: string; data?: TabData })[];
    const storageKey = `carehub-active-tab:${blockId}`;
    const [active, setActiveState] = useState(() => {
      try {
        return Number(window.localStorage.getItem(storageKey)) || 0;
      } catch {
        return 0;
      }
    });
    const setActive = useCallback(
      (index: number) => {
        setActiveState(index);
        try {
          window.localStorage.setItem(storageKey, String(index));
        } catch {
          // Private mode etc.: the tab just won't be remembered.
        }
      },
      [storageKey]
    );
    const [editingId, setEditingId] = useState<string | null>(null);
    const [draft, setDraft] = useState('');
    const [menu, setMenu] = useState<TabMenu | null>(null);
    const [picker, setPicker] = useState<TabMenu | null>(null);
    const [dragFrom, setDragFrom] = useState<number | null>(null);
    const [dropAt, setDropAt] = useState<number | null>(null);
    const [copied, setCopied] = useState(false);
    const activeIndex = Math.min(active, Math.max(tabs.length - 1, 0));

    const tabsPath = useCallback(() => {
      const entry = findSlateEntryByBlockId(editor, blockId);

      return entry ? entry[1] : null;
    }, [editor, blockId]);

    const switchTo = useCallback(
      (index: number) => {
        setActive(index);
        const path = tabsPath();
        const tab = tabs[index];

        if (!readOnly && tab && path && editor.selection && Path.isAncestor(path, editor.selection.anchor.path)) {
          selectFirstText(editor, tab.blockId);
        }
      },
      [editor, readOnly, tabs, tabsPath, setActive]
    );

    const addTab = useCallback(() => {
      const sharedRoot = editor.sharedRoot;
      let tabId: string | undefined;

      executeOperations(
        sharedRoot,
        [
          () => {
            const parent = getBlock(blockId, sharedRoot);

            if (!parent) return;
            const tab = newTab(sharedRoot, `Tab ${tabs.length + 1}`);

            tabId = tab.get(YjsEditorKey.block_id);
            updateBlockParent(sharedRoot, tab, parent, tabs.length);
          },
        ],
        'carehubAddTab'
      );
      setActive(tabs.length);
      if (tabId) selectFirstText(editor, tabId);
    }, [editor, blockId, tabs.length, setActive]);

    const removeTab = useCallback(
      (index: number) => {
        const tab = tabs[index];

        if (!tab || tabs.length <= 1) return;
        const name = tab.data?.name || `Tab ${index + 1}`;

        if (!window.confirm(`Delete the tab "${name}" and everything in it?`)) return;
        Transforms.deselect(editor);
        executeOperations(editor.sharedRoot, [() => deleteBlock(editor.sharedRoot, tab.blockId)], 'carehubRemoveTab');
        setActive(Math.max(0, index - 1));
      },
      [editor, tabs, setActive]
    );

    const saveName = useCallback(() => {
      if (!editingId) return;
      const name = draft.trim();

      if (name) CustomEditor.setBlockData(editor, editingId, { name });
      setEditingId(null);
    }, [draft, editingId, editor]);

    const startRename = (index: number) => {
      const tab = tabs[index];

      if (!tab || readOnly) return;
      setDraft(tab.data?.name || `Tab ${index + 1}`);
      setEditingId(tab.blockId);
    };

    const setIcon = (index: number, icon: string, svg = '') => {
      const tab = tabs[index];

      if (!tab) return;
      CustomEditor.setBlockData(editor, tab.blockId, { icon: icon.trim(), icon_svg: svg });
      setMenu(null);
      setPicker(null);
    };

    // Drag a tab to a new place. "to" is the gap index (0 = before the first tab).
    const moveTab = useCallback(
      (from: number, to: number) => {
        const tab = tabs[from];

        if (!tab || to === from || to === from + 1) return;
        const order = tabs.map((_, i) => i);

        order.splice(from, 1);
        order.splice(to > from ? to - 1 : to, 0, from);
        Transforms.deselect(editor);
        executeOperations(
          editor.sharedRoot,
          [
            () => {
              const sharedRoot = editor.sharedRoot;
              const parent = getBlock(blockId, sharedRoot);
              const source = getBlock(tab.blockId, sharedRoot);

              if (parent && source) moveNode(sharedRoot, source, parent, to);
            },
          ],
          'carehubMoveTab'
        );
        setActive(Math.max(0, order.indexOf(activeIndex)));
      },
      [editor, blockId, tabs, activeIndex, setActive]
    );

    // Drag with the mouse (the editor blocks normal browser drag and drop here).
    const dragRef = useRef<{ from: number; x: number; moved: boolean; at: number | null } | null>(null);
    const justDragged = useRef(false);
    const headerRef = useRef<HTMLDivElement | null>(null);

    const startDrag = (e: React.MouseEvent, index: number) => {
      if (readOnly || editingId !== null || e.button !== 0 || tabs.length < 2) return;
      dragRef.current = { from: index, x: e.clientX, moved: false, at: null };

      const onMove = (ev: MouseEvent) => {
        const drag = dragRef.current;

        if (!drag) return;
        if (!drag.moved && Math.abs(ev.clientX - drag.x) < 6) return;
        drag.moved = true;
        const items = Array.from(
          headerRef.current?.querySelectorAll<HTMLElement>('[data-carehub-tab-drag]') ?? []
        );
        let at = items.length;

        for (let i = 0; i < items.length; i++) {
          const rect = items[i].getBoundingClientRect();

          if (ev.clientX < rect.left + rect.width / 2) {
            at = i;
            break;
          }
        }

        drag.at = at;
        setDragFrom(drag.from);
        setDropAt(at);
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove, true);
        window.removeEventListener('mouseup', onUp, true);
        const drag = dragRef.current;

        dragRef.current = null;
        setDragFrom(null);
        setDropAt(null);
        if (drag?.moved) {
          justDragged.current = true;
          setTimeout(() => {
            justDragged.current = false;
          }, 0);
          if (drag.at !== null) moveTab(drag.from, drag.at);
        }
      };

      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('mouseup', onUp, true);
    };

    const closeMenu = useCallback(() => {
      setMenu(null);
      setCopied(false);
    }, []);

    useEffect(() => {
      if (!menu) return;
      const onDown = (e: MouseEvent) => {
        if (!(e.target as HTMLElement).closest?.('[data-carehub-tab-menu]')) closeMenu();
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') closeMenu();
      };

      window.addEventListener('mousedown', onDown, true);
      window.addEventListener('keydown', onKey, true);
      return () => {
        window.removeEventListener('mousedown', onDown, true);
        window.removeEventListener('keydown', onKey, true);
      };
    }, [menu, closeMenu]);

    const copyLink = async (index: number) => {
      const url = new URL(window.location.href);

      url.searchParams.set('blockId', blockId);
      try {
        window.localStorage.setItem(storageKey, String(index));
      } catch {
        // ignore
      }

      try {
        await navigator.clipboard.writeText(url.toString());
      } catch {
        const area = document.createElement('textarea');

        area.value = url.toString();
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
      }

      setCopied(true);
      setTimeout(closeMenu, 700);
    };

    const sizeStyle = TAB_SIZE_STYLE[size];
    const menuTab = menu ? tabs[menu.index] : undefined;

    return (
      <div ref={ref} {...attributes} style={style} className={`${className ?? ''} carehub-tabs`} data-carehub-tabs={blockId}>
        <div
          contentEditable={false}
          ref={headerRef}
          className={`flex select-none flex-wrap items-end gap-1 border-b border-border-primary ${
            dragFrom !== null ? 'cursor-grabbing' : ''
          }`}
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault();
          }}
        >
          <style>{`[data-carehub-tabs="${blockId}"] > .carehub-tabs-body > :not(:nth-child(${activeIndex + 1})) { display: none !important; }`}</style>
          {tabs.map((tab, index) => {
            const isActive = index === activeIndex;
            const name = tab.data?.name || `Tab ${index + 1}`;

            if (editingId === tab.blockId) {
              return (
                <input
                  key={tab.blockId}
                  autoFocus
                  value={draft}
                  data-carehub-tab-input
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={saveName}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') saveName();
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  onKeyUp={stop}
                  onBeforeInput={stop}
                  onPaste={stop}
                  style={{ fontSize: sizeStyle.fontSize, fontWeight: sizeStyle.fontWeight }}
                  className={
                    'mb-[3px] w-[180px] rounded-[8px] border border-border-primary bg-transparent px-2 py-0.5 text-text-primary outline-none'
                  }
                />
              );
            }

            return (
              <div
                key={tab.blockId}
                data-carehub-tab-drag={index}
                onMouseDown={(e) => startDrag(e, index)}
                className={`group relative flex items-center gap-1 px-3 ${
                  isActive ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'
                } ${isActive && size === 'body' ? 'font-medium' : ''}`}
                style={{
                  ...sizeStyle,
                  opacity: dragFrom === index ? 0.5 : undefined,
                  boxShadow:
                    [
                      isActive ? 'inset 0 -2px 0 currentColor' : '',
                      dragFrom !== null && dropAt === index ? 'inset 2px 0 0 var(--fill-theme-thick, #2563eb)' : '',
                      dragFrom !== null && dropAt === index + 1 && index === tabs.length - 1
                        ? 'inset -2px 0 0 var(--fill-theme-thick, #2563eb)'
                        : '',
                    ]
                      .filter(Boolean)
                      .join(', ') || undefined,
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setCopied(false);
                  setMenu({ index, x: e.clientX, y: e.clientY });
                }}
              >
                <button
                  type={'button'}
                  data-carehub-tab={index}
                  className={'flex max-w-[260px] items-center gap-[0.35em] truncate'}
                  title={readOnly ? name : `${name} — double-click to rename, drag to move, right-click for more`}
                  onClick={() => {
                    if (!justDragged.current) switchTo(index);
                  }}
                  onDoubleClick={() => startRename(index)}
                >
                  <TabIcon tab={tab} />
                  <span className={'truncate'}>{name}</span>
                </button>
                {!readOnly && isActive && tabs.length > 1 && (
                  <button
                    type={'button'}
                    data-carehub-tab-remove={index}
                    title={'Delete tab'}
                    className={'invisible rounded px-1 text-sm text-text-secondary hover:text-text-primary group-hover:visible'}
                    onClick={() => removeTab(index)}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
          {!readOnly && (
            <button
              type={'button'}
              data-carehub-tab-add
              title={'Add tab'}
              className={'mb-[3px] flex h-[28px] w-[28px] items-center justify-center rounded-[8px] text-text-secondary hover:bg-fill-content-hover hover:text-text-primary'}
              onClick={addTab}
            >
              +
            </button>
          )}
        </div>
        <div className={'carehub-tabs-body pt-2'}>{children}</div>
        {menu && menuTab
          ? createPortal(
              <div
                data-carehub-tab-menu
                contentEditable={false}
                onKeyDown={stop}
                onKeyUp={stop}
                onBeforeInput={stop}
                onPaste={stop}
                onMouseDown={stop}
                className={
                  'fixed z-[1400] w-[220px] rounded-[8px] border border-border-primary bg-background-primary p-1 shadow-lg'
                }
                style={{
                  left: Math.min(menu.x, window.innerWidth - 232),
                  top: Math.min(menu.y, window.innerHeight - 330),
                }}
              >
                <>
                    {!readOnly && (
                      <TabMenuItem
                        onClick={() => {
                          const index = menu.index;

                          closeMenu();
                          startRename(index);
                        }}
                      >
                        Rename
                      </TabMenuItem>
                    )}
                    {!readOnly && (
                      <TabMenuItem
                        onClick={() => {
                          setPicker(menu);
                          closeMenu();
                        }}
                      >
                        Edit icon
                      </TabMenuItem>
                    )}
                    <TabMenuItem onClick={() => void copyLink(menu.index)}>{copied ? 'Link copied' : 'Copy link'}</TabMenuItem>
                    {!readOnly && (
                      <>
                        <div className={'mx-2 my-1 border-t border-border-primary'} />
                        <div className={'px-2 pb-1 pt-0.5 text-xs text-text-secondary'}>Tab text size</div>
                        {TAB_SIZES.map((option) => (
                          <TabMenuItem
                            key={option.value}
                            onClick={() => {
                              CustomEditor.setBlockData(editor, blockId, { size: option.value });
                              closeMenu();
                            }}
                          >
                            <span className={'w-4 text-center'}>{size === option.value ? '✓' : ''}</span>
                            {option.label}
                          </TabMenuItem>
                        ))}
                      </>
                    )}
                    {!readOnly && tabs.length > 1 && (
                      <>
                        <div className={'mx-2 my-1 border-t border-border-primary'} />
                        <TabMenuItem
                          danger
                          onClick={() => {
                            const index = menu.index;

                            closeMenu();
                            removeTab(index);
                          }}
                        >
                          Delete
                        </TabMenuItem>
                      </>
                    )}
                </>
              </div>,
              document.body
            )
          : null}
        {picker && tabs[picker.index] ? (
          <span contentEditable={false} onKeyDown={stop} onKeyUp={stop} onBeforeInput={stop} onPaste={stop}>
            <CustomIconPopover
              open
              tabs={['emoji', 'icon']}
              hideRemove={!tabs[picker.index].data?.icon && !tabs[picker.index].data?.icon_svg}
              removeIcon={() => setIcon(picker.index, '')}
              onOpenChange={(open) => {
                if (!open) setPicker(null);
              }}
              onSelectIcon={(icon) => {
                if (icon.ty === ViewIconType.Emoji) setIcon(picker.index, icon.value);
                else if (icon.ty === ViewIconType.Icon && icon.content) setIcon(picker.index, '', iconSvg(icon.content, icon.color));
              }}
            >
              <span
                aria-hidden
                style={{ position: 'fixed', left: picker.x, top: picker.y, width: 1, height: 1, pointerEvents: 'none' }}
              />
            </CustomIconPopover>
          </span>
        ) : null}
      </div>
    );
  })
);

export const CareHubTab = memo(
  forwardRef<HTMLDivElement, EditorElementProps>(({ node: _node, children, className, ...attributes }, ref) => (
    <div ref={ref} {...attributes} className={`${className ?? ''} carehub-tab`}>
      {children}
    </div>
  ))
);

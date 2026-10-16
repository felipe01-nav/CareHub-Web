// CareHub: page layout blocks — columns (2/3/4) and tabs.
import React, { forwardRef, memo, useCallback, useEffect, useState } from 'react';
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
  updateBlockParent,
} from '@/application/slate-yjs/utils/yjs';
import { BlockType, YBlock, YjsEditorKey, YSharedRoot } from '@/application/types';
import { EditorElementProps } from '@/components/editor/editor.type';
import { useEditorContext } from '@/components/editor/EditorContext';

export const CAREHUB_TABS = 'carehub_tabs' as BlockType;
export const CAREHUB_TAB = 'carehub_tab' as BlockType;

type TabData = { name?: string; icon?: string };

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
function insertLayoutBlock(editor: YjsEditor, build: (sharedRoot: YSharedRoot) => YBlock) {
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

  if (newId) selectFirstText(editor, newId);
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

const TAB_ICONS = ['📄', '📋', '📝', '📌', '📅', '🗓️', '✅', '⭐', '❤️', '🏠', '👤', '👥', '💊', '🩺', '🏥', '📞', '💬', '📊', '📁', '🔒', '⚠️', '💡', '🎯', '🧾'];

type TabMenu = { index: number; x: number; y: number; view: 'main' | 'icon' };

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
    const [iconDraft, setIconDraft] = useState('');
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

    const setIcon = (index: number, icon: string) => {
      const tab = tabs[index];

      if (!tab) return;
      CustomEditor.setBlockData(editor, tab.blockId, { icon: icon.trim() });
      setMenu(null);
    };

    const focusOnce = useCallback((el: HTMLInputElement | null) => {
      el?.focus({ preventScroll: true });
    }, []);

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
          className={'flex select-none flex-wrap items-end gap-1 border-b border-border-primary'}
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault();
          }}
        >
          <style>{`[data-carehub-tabs="${blockId}"] > .carehub-tabs-body > :not(:nth-child(${activeIndex + 1})) { display: none !important; }`}</style>
          {tabs.map((tab, index) => {
            const isActive = index === activeIndex;
            const name = tab.data?.name || `Tab ${index + 1}`;
            const icon = tab.data?.icon;

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
                className={`group relative flex items-center gap-1 px-3 ${
                  isActive ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'
                } ${isActive && size === 'body' ? 'font-medium' : ''}`}
                style={{ ...sizeStyle, boxShadow: isActive ? 'inset 0 -2px 0 currentColor' : undefined }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setCopied(false);
                  setMenu({ index, x: e.clientX, y: e.clientY, view: 'main' });
                }}
              >
                <button
                  type={'button'}
                  data-carehub-tab={index}
                  className={'flex max-w-[260px] items-center gap-[0.35em] truncate'}
                  title={readOnly ? name : `${name} — double-click to rename, right-click for more`}
                  onClick={() => switchTo(index)}
                  onDoubleClick={() => startRename(index)}
                >
                  {icon ? (
                    <span data-carehub-tab-icon className={'shrink-0 leading-none'} style={{ fontSize: '1em' }}>
                      {icon}
                    </span>
                  ) : null}
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
                  top: Math.min(menu.y, window.innerHeight - (menu.view === 'icon' ? 250 : 330)),
                }}
              >
                {menu.view === 'main' ? (
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
                          setIconDraft(menuTab.data?.icon || '');
                          setMenu({ ...menu, view: 'icon' });
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
                ) : (
                  <div className={'p-1'}>
                    <div className={'grid grid-cols-6 gap-0.5'}>
                      {TAB_ICONS.map((emoji) => (
                        <button
                          key={emoji}
                          type={'button'}
                          data-carehub-icon-choice
                          onClick={() => setIcon(menu.index, emoji)}
                          className={'flex h-8 w-8 items-center justify-center rounded-[6px] text-lg hover:bg-fill-content-hover'}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                    <div className={'mt-2 flex items-center gap-1'}>
                      <input
                        ref={focusOnce}
                        value={iconDraft}
                        data-carehub-icon-input
                        placeholder={'Type or paste an emoji'}
                        onChange={(e) => setIconDraft(e.target.value)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') setIcon(menu.index, Array.from(iconDraft.trim()).slice(0, 4).join(''));
                        }}
                        className={
                          'h-8 min-w-0 flex-1 rounded-[6px] border border-border-primary bg-transparent px-2 text-sm text-text-primary outline-none'
                        }
                      />
                      <button
                        type={'button'}
                        onClick={() => setIcon(menu.index, Array.from(iconDraft.trim()).slice(0, 4).join(''))}
                        className={'h-8 rounded-[6px] px-2 text-sm hover:bg-fill-content-hover'}
                      >
                        Set
                      </button>
                    </div>
                    {menuTab.data?.icon ? (
                      <TabMenuItem onClick={() => setIcon(menu.index, '')}>Remove icon</TabMenuItem>
                    ) : null}
                  </div>
                )}
              </div>,
              document.body
            )
          : null}
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

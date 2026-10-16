// CareHub: page layout blocks — columns (2/3/4) and tabs.
import React, { forwardRef, memo, useCallback, useState } from 'react';
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

type TabData = { name?: string };

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

export const CareHubTabs = memo(
  forwardRef<HTMLDivElement, EditorElementProps>(({ node, children, className, style, ...attributes }, ref) => {
    const editor = useSlateStatic() as YjsEditor;
    const { readOnly } = useEditorContext();
    const blockId = (node as Element & { blockId?: string }).blockId as string;
    const tabs = ((node as Element).children || []).filter(
      (child) => Element.isElement(child) && (child as Element & { type?: string }).type === CAREHUB_TAB
    ) as (Element & { blockId: string; data?: TabData })[];
    const [active, setActive] = useState(0);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [draft, setDraft] = useState('');
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
      [editor, readOnly, tabs, tabsPath]
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
    }, [editor, blockId, tabs.length]);

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
      [editor, tabs]
    );

    const saveName = useCallback(() => {
      if (!editingId) return;
      const name = draft.trim();

      if (name) CustomEditor.setBlockData(editor, editingId, { name });
      setEditingId(null);
    }, [draft, editingId, editor]);

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
                  className={
                    'mb-[3px] h-[28px] w-[140px] rounded-[8px] border border-border-primary bg-transparent px-2 text-sm text-text-primary outline-none'
                  }
                />
              );
            }

            return (
              <div
                key={tab.blockId}
                className={`group relative flex h-[34px] items-center gap-1 px-3 text-sm ${
                  isActive ? 'font-medium text-text-primary' : 'text-text-secondary hover:text-text-primary'
                }`}
                style={{ boxShadow: isActive ? 'inset 0 -2px 0 currentColor' : undefined }}
              >
                <button
                  type={'button'}
                  data-carehub-tab={index}
                  className={'max-w-[220px] truncate'}
                  title={readOnly ? name : `${name} — double-click to rename`}
                  onClick={() => switchTo(index)}
                  onDoubleClick={() => {
                    if (readOnly) return;
                    setDraft(name);
                    setEditingId(tab.blockId);
                  }}
                >
                  {name}
                </button>
                {!readOnly && isActive && tabs.length > 1 && (
                  <button
                    type={'button'}
                    data-carehub-tab-remove={index}
                    title={'Delete tab'}
                    className={'invisible rounded px-1 text-text-secondary hover:text-text-primary group-hover:visible'}
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

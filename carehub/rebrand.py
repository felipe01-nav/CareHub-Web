#!/usr/bin/env python3
"""CareHub branding, applied to the pinned web source at build time.

Each replacement must match exactly once; if the upstream code changes, the
build stops with a clear message instead of silently shipping AppFlowy text.
Run from the web source folder:  python3 ../carehub/carehub/rebrand.py
"""
import pathlib
import sys

APP_NAME = "CareHub"

LOGO_MARK = (
    "<div style={{ width: 36, height: 36, borderRadius: 8, background: '#191919', "
    "color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', "
    "fontWeight: 700, fontSize: 18 }}>C</div>"
)

FAVICON = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" rx="14" fill="#191919"/>
<text x="32" y="44" text-anchor="middle" font-family="-apple-system, system-ui, sans-serif" font-size="36" font-weight="700" fill="#ffffff">C</text>
</svg>
"""

LOGIN_AGREEMENT = """        <div
          className={
            'w-[300px] overflow-hidden whitespace-pre-wrap break-words text-center text-[12px] tracking-[0.36px] text-text-secondary'
          }
        >
          <span>{t('web.signInAgreement')} </span>
          <a
            href={'https://appflowy.com/terms'}
            target={'_blank'}
            className={'text-text-secondary underline'}
            rel='noreferrer'
          >
            {t('web.termOfUse')}
          </a>{' '}
          {t('web.and')}{' '}
          <a
            href={'https://appflowy.com/privacy'}
            target={'_blank'}
            className={'text-text-secondary underline'}
            rel='noreferrer'
          >
            {t('web.privacyPolicy')}
          </a>
          .
        </div>
"""

LOGIN_FOOTER = """        <Separator className={'w-[320px] max-w-full'} />
        <div
          onClick={() => {
            window.location.href = 'https://appflowy.com';
          }}
          className={
            'flex w-full cursor-pointer items-center justify-center gap-2 text-xs font-medium text-text-secondary'
          }
        >
          <span>{t('web.visitOurWebsite')}</span>
          <ArrowRight className={'h-5 w-5'} />
        </div>
"""

DESCRIPTION = "AppFlowy is an AI collaborative workspace where you achieve more without losing control of your data"

EDITS = {
    "src/components/login/Login.tsx": [
        ("{t('welcomeTo')} AppFlowy", "{t('welcomeTo')} " + APP_NAME, 1),
        ("<Logo className={'h-9 w-9'} />", LOGO_MARK, 1),
        ("import { ReactComponent as Logo } from '@/assets/icons/logo.svg';\n", "", 1),
        ("import { ReactComponent as ArrowRight } from '@/assets/icons/arrow_right.svg';\n", "", 1),
        (LOGIN_AGREEMENT, "", 1),
        (LOGIN_FOOTER, "", 1),
    ],
    "index.html": [
        ("<title>AppFlowy</title>", "<title>" + APP_NAME + "</title>", 1),
        ('href="/appflowy.ico"', 'href="/carehub-icon.svg"', 1),
        ('content="AppFlowy"', 'content="' + APP_NAME + '"', 3),
        (DESCRIPTION, APP_NAME + " - private workspace", 3),
        # No calls to Google: the emoji font is not needed on a Mac.
        ("""    <link
            href="https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap"
            rel="stylesheet"
    >
""", "", 1),
    ],
}


# ---------------------------------------------------------------------------
# CareHub form improvements (question descriptions)
# Multi-line description box with Bold / Italic / Underline / Colour / Link,
# and formatted, wrapped descriptions for people filling in the form.
# ---------------------------------------------------------------------------
HERE = pathlib.Path(__file__).resolve().parent
RICH_TEXT_SRC = HERE / "web" / "CareHubRichText.tsx"
RICH_TEXT_DEST = "src/components/carehub/CareHubRichText.tsx"

QUESTION_DESCRIPTION_INPUT = "        <Input\n          variant='ghost'\n          value={descriptionDraft}\n          onChange={(e) => {\n            const value = e.target.value;\n\n            setDescriptionDraft(value);\n            descriptionDraftRef.current = value;\n            descriptionDirtyRef.current = true;\n            clearDescriptionTimer();\n            descriptionTimer.current = setTimeout(() => {\n              descriptionTimer.current = null;\n              commitDescription(value);\n            }, DESCRIPTION_DEBOUNCE_MS);\n          }}\n          onFocus={() => {\n            descriptionFocusedRef.current = true;\n          }}\n          onBlur={() => {\n            descriptionFocusedRef.current = false;\n            if (descriptionDirtyRef.current) {\n              commitDescription(descriptionDraftRef.current);\n              return;\n            }\n\n            const deferred = deferredExternalDescriptionRef.current;\n\n            if (deferred === null) return;\n            deferredExternalDescriptionRef.current = null;\n            descriptionDraftRef.current = deferred;\n            setDescriptionDraft(deferred);\n          }}\n          // The whole card is RBD's drag activator (see\n          // `DraggableQuestionList`). Without stopping mouse-down on\n          // the input, dragging across the description text starts\n          // a card reorder instead of selecting characters. Capture\n          // phase so the stop happens before RBD's sensor fires.\n          onMouseDownCapture={(e) => e.stopPropagation()}\n          placeholder='Add description'\n          className='mt-1 italic'\n        />\n"

QUESTION_DESCRIPTION_EDITOR = "        <CareHubDescriptionEditor\n          value={descriptionDraft}\n          onChange={(value) => {\n            setDescriptionDraft(value);\n            descriptionDraftRef.current = value;\n            descriptionDirtyRef.current = true;\n            clearDescriptionTimer();\n            descriptionTimer.current = setTimeout(() => {\n              descriptionTimer.current = null;\n              commitDescription(value);\n            }, DESCRIPTION_DEBOUNCE_MS);\n          }}\n          onFocus={() => {\n            descriptionFocusedRef.current = true;\n          }}\n          onBlur={() => {\n            descriptionFocusedRef.current = false;\n            if (descriptionDirtyRef.current) {\n              commitDescription(descriptionDraftRef.current);\n              return;\n            }\n\n            const deferred = deferredExternalDescriptionRef.current;\n\n            if (deferred === null) return;\n            deferredExternalDescriptionRef.current = null;\n            descriptionDraftRef.current = deferred;\n            setDescriptionDraft(deferred);\n          }}\n          placeholder='Add description'\n        />\n"

EDITS.update({
    "src/components/database/form/FormQuestionCard.tsx": [
        ("import { Input } from '@/components/ui/input';\n",
         "import { CareHubDescriptionEditor } from '@/components/carehub/CareHubRichText';\n", 1),
        (QUESTION_DESCRIPTION_INPUT, QUESTION_DESCRIPTION_EDITOR, 1),
    ],
    "src/components/form/FormQuestion.tsx": [
        ("import { cn } from '@/lib/utils';\n",
         "import { renderCareHubRichText } from '@/components/carehub/CareHubRichText';\nimport { cn } from '@/lib/utils';\n", 1),
        ("{question.description && <p className='text-sm text-text-caption'>{question.description}</p>}",
         "{question.description && (\n          <p className='whitespace-pre-wrap break-words text-sm leading-relaxed text-text-caption'>\n            {renderCareHubRichText(question.description)}\n          </p>\n        )}", 1),
    ],
    "src/components/database/form/FormQuestionCardReadOnly.tsx": [
        ("import { FormQuestionPlaceholder } from './FormQuestionPlaceholder';\n",
         "import { renderCareHubRichText } from '@/components/carehub/CareHubRichText';\n\nimport { FormQuestionPlaceholder } from './FormQuestionPlaceholder';\n", 1),
        ("<p className='mt-1 text-sm italic text-text-caption'>{description}</p>",
         "<p className='mt-1 whitespace-pre-wrap break-words text-sm text-text-caption'>{renderCareHubRichText(description)}</p>", 1),
    ],
})


# ---------------------------------------------------------------------------
# CareHub: refresh the sidebar right after a page or space changes.
# This server doesn't push "folder changed" messages to the browser, so
# renames, new icons, moves etc. used to show up only after a minute or so.
# After any successful change the app now reloads the sidebar itself.
# ---------------------------------------------------------------------------
FOLDER_NOTIFY = """let axiosInstance: AxiosInstance | null = null;

// CareHub: tell the sidebar to reload after a page/space change.
const CAREHUB_FOLDER_CHANGE =
  /\\/api\\/workspace\\/[^/]+\\/(page-view|space|spaces|trash|delete-all-pages-from-trash|restore-all-pages-from-trash)(\\/|$|\\?)/;
const CAREHUB_NOT_FOLDER = /\\/(page-mention|permission|members|group|add-recent-pages|favorite)(\\/|$|\\?)/;
let carehubFolderTimers: ReturnType<typeof setTimeout>[] = [];

function carehubNotifyFolderChange(config: { method?: string; url?: string } | undefined) {
  const method = config?.method?.toLowerCase();
  const url = config?.url ?? '';

  if (!method || method === 'get' || typeof window === 'undefined') return;
  if (!CAREHUB_FOLDER_CHANGE.test(url) || CAREHUB_NOT_FOLDER.test(url)) return;
  carehubFolderTimers.forEach(clearTimeout);
  // Reload twice: right away, and once more in case the server was still saving.
  carehubFolderTimers = [300, 2000].map((ms) =>
    setTimeout(() => window.dispatchEvent(new Event('carehub-folder-changed')), ms)
  );
}
"""

EDITS.update({
    "src/application/services/js-services/http/core.ts": [
        ("let axiosInstance: AxiosInstance | null = null;\n", FOLDER_NOTIFY, 1),
        ("  axiosInstance.interceptors.response.use((response) => response, handleUnauthorized);\n",
         "  axiosInstance.interceptors.response.use((response) => {\n    carehubNotifyFolderChange(response.config);\n    return response;\n  }, handleUnauthorized);\n", 1),
    ],
    "src/components/app/hooks/useWorkspaceData.ts": [
        ("      eventEmitter.on(APP_EVENTS.FOLDER_OUTLINE_CHANGED, handleFolderOutlineChanged);\n    }\n",
         "      eventEmitter.on(APP_EVENTS.FOLDER_OUTLINE_CHANGED, handleFolderOutlineChanged);\n    }\n\n"
         "    // CareHub: reload the sidebar after a local page/space change.\n"
         "    const handleCareHubFolderChanged = () => handleFolderOutlineChanged({} as notification.IFolderChanged);\n\n"
         "    window.addEventListener('carehub-folder-changed', handleCareHubFolderChanged);\n", 1),
        ("        eventEmitter.off(APP_EVENTS.FOLDER_OUTLINE_CHANGED, handleFolderOutlineChanged);\n      }\n",
         "        eventEmitter.off(APP_EVENTS.FOLDER_OUTLINE_CHANGED, handleFolderOutlineChanged);\n      }\n\n"
         "      window.removeEventListener('carehub-folder-changed', handleCareHubFolderChanged);\n", 1),
    ],
})


# CareHub: columns (2/3/4) and tabs in the page editor.
EXTRA_FILES = {
    HERE / "web" / "CareHubBlocks.tsx": "src/components/carehub/CareHubBlocks.tsx",
}

EDITS.update({
    "src/components/editor/components/element/Element.tsx": [
        ("import { renderColor } from '@/utils/color';\n",
         "import { renderColor } from '@/utils/color';\n"
         "import { CAREHUB_TAB, CAREHUB_TABS, CareHubTab, CareHubTabs } from '@/components/carehub/CareHubBlocks';\n", 1),
        ("        BlockType.SimpleTableBlock,\n      ].includes(type as BlockType)\n",
         "        BlockType.SimpleTableBlock,\n        BlockType.ColumnsBlock,\n        BlockType.ColumnBlock,\n"
         "        CAREHUB_TABS,\n        CAREHUB_TAB,\n      ].includes(type as BlockType)\n", 1),
        ("      case BlockType.PDFBlock:\n        return PDFBlock;\n",
         "      case BlockType.PDFBlock:\n        return PDFBlock;\n"
         "      case CAREHUB_TABS:\n        return CareHubTabs;\n"
         "      case CAREHUB_TAB:\n        return CareHubTab;\n", 1),
    ],
    "src/components/editor/components/toolbar/block-controls/utils.ts": [
        ("    if ([BlockType.ColumnBlock, BlockType.ColumnsBlock].includes(type)) {\n"
         "      const firstDom = element?.closest(\n"
         "        `[data-block-type]:not([data-block-type=\"${BlockType.ColumnBlock}\"]):not([data-block-type=\"${BlockType.ColumnsBlock}\"])`\n",
         "    if ([BlockType.ColumnBlock, BlockType.ColumnsBlock, 'carehub_tab' as BlockType].includes(type)) {\n"
         "      const firstDom = element?.closest(\n"
         "        `[data-block-type]:not([data-block-type=\"${BlockType.ColumnBlock}\"]):not([data-block-type=\"${BlockType.ColumnsBlock}\"]):not([data-block-type=\"carehub_tab\"])`\n", 1),
    ],
    "src/application/slate-yjs/utils/editor.ts": [
        ("    (parent && [BlockType.ColumnsBlock, BlockType.ColumnBlock, BlockType.SimpleTableCellBlock].includes(parent.get(YjsEditorKey.block_type)))\n",
         "    (parent && [BlockType.ColumnsBlock, BlockType.ColumnBlock, BlockType.SimpleTableCellBlock, 'carehub_tab' as BlockType].includes(parent.get(YjsEditorKey.block_type)))\n", 1),
        ("export function handleMergeBlockBackwardWithTxn(editor: YjsEditor, node: Element, point: Point) {\n"
         "  const operations: (() => void)[] = [];\n  const sharedRoot = getSharedRoot(editor);\n",
         "export function handleMergeBlockBackwardWithTxn(editor: YjsEditor, node: Element, point: Point) {\n"
         "  const operations: (() => void)[] = [];\n  const sharedRoot = getSharedRoot(editor);\n\n"
         "  // CareHub: never pull text across the start of a column or tab.\n"
         "  if (carehubAtLayoutEdge(sharedRoot, (node as Element & { blockId?: string }).blockId, 'start')) return;\n", 1),
        ("export function handleMergeBlockForwardWithTxn(editor: YjsEditor, node: Element, point: Point) {\n"
         "  const operations: (() => void)[] = [];\n  const sharedRoot = getSharedRoot(editor);\n",
         "export function handleMergeBlockForwardWithTxn(editor: YjsEditor, node: Element, point: Point) {\n"
         "  const operations: (() => void)[] = [];\n  const sharedRoot = getSharedRoot(editor);\n\n"
         "  // CareHub: never pull text across the end of a column or tab.\n"
         "  if (carehubAtLayoutEdge(sharedRoot, (node as Element & { blockId?: string }).blockId, 'end')) return;\n", 1),
        ("export function preventIndentNode(editor: YjsEditor, blockId: string) {\n",
         "function carehubAtLayoutEdge(sharedRoot: YSharedRoot, blockId: string | undefined, edge: 'start' | 'end') {\n"
         "  if (!blockId) return false;\n"
         "  const parent = getParent(blockId, sharedRoot);\n"
         "  const parentType = parent?.get(YjsEditorKey.block_type);\n\n"
         "  if (!parent || ![BlockType.ColumnBlock, 'carehub_tab'].includes(parentType)) return false;\n"
         "  const siblings = getChildrenArray(parent.get(YjsEditorKey.block_children), sharedRoot);\n"
         "  const index = getBlockIndex(blockId, sharedRoot);\n\n"
         "  return edge === 'start' ? index === 0 : index === (siblings?.length ?? 0) - 1;\n"
         "}\n\n"
         "export function preventIndentNode(editor: YjsEditor, blockId: string) {\n", 1),
    ],
    "src/application/slate-yjs/utils/yjs.ts": [
        ("export function deleteBlock(sharedRoot: YSharedRoot, blockId: string) {\n  const block = getBlock(blockId, sharedRoot);\n",
         "// CareHub: blocks being deleted right now (so an emptied tab can be refilled, but not while the tab itself goes).\n"
         "const carehubDeleting = new Set<string>();\n\n"
         "export function deleteBlock(sharedRoot: YSharedRoot, blockId: string) {\n"
         "  carehubDeleting.add(blockId);\n"
         "  try {\n    carehubDeleteBlock(sharedRoot, blockId);\n  } finally {\n    carehubDeleting.delete(blockId);\n  }\n}\n\n"
         "function carehubDeleteBlock(sharedRoot: YSharedRoot, blockId: string) {\n  const block = getBlock(blockId, sharedRoot);\n", 1),
        ("  // delete parent if it's empty column block\n",
         "  // CareHub: a tab always keeps at least one empty line to type in\n"
         "  if (parentType === 'carehub_tab' && afterDeletedLength === 0 && !carehubDeleting.has(parentId)) {\n"
         "    updateBlockParent(sharedRoot, createBlock(sharedRoot, { ty: BlockType.Paragraph, data: {} }), parent, 0);\n"
         "  }\n\n"
         "  // delete parent if it's empty column block\n", 1),
    ],
    "src/components/editor/components/panels/slash-panel/SlashPanel.tsx": [
        ("import { useEditorContext } from '@/components/editor/EditorContext';\n",
         "import { useEditorContext } from '@/components/editor/EditorContext';\n"
         "import {\n  CareHubColumnsIcon,\n  CareHubTabsIcon,\n  carehubInsertColumns,\n  carehubInsertTabs,\n"
         "} from '@/components/carehub/CareHubBlocks';\n", 1),
        ("      {\n        label: t('document.slashMenu.name.callout'),\n",
         "      ...[2, 3, 4].map((count) => ({\n"
         "        label: `${count} columns`,\n"
         "        key: `carehubColumns${count}`,\n"
         "        icon: <CareHubColumnsIcon count={count} />,\n"
         "        group: SlashMenuGroupKey.AdvancedBlocks,\n"
         "        keywords: ['columns', 'column', 'layout', 'side by side', `${count} columns`, `${count}col`],\n"
         "        onClick: () => {\n          carehubInsertColumns(editor, count);\n        },\n"
         "      })),\n"
         "      {\n        label: 'Tabs',\n        key: 'carehubTabs',\n        icon: <CareHubTabsIcon />,\n"
         "        group: SlashMenuGroupKey.AdvancedBlocks,\n"
         "        keywords: ['tabs', 'tab', 'layout', 'sections'],\n"
         "        onClick: () => {\n          carehubInsertTabs(editor);\n        },\n      },\n"
         "      {\n        label: t('document.slashMenu.name.callout'),\n", 1),
    ],
})


# ---------------------------------------------------------------------------
# CareHub: search, settings and the grey "Goncalves Hub" look.
# - Search finds pages by title in the browser (this server has no search
#   service, so the stock search always came back empty).
# - Settings no longer shows "Connections" (AppFlowy-cloud only).
# - A neutral grey theme is loaded after the stock colours.
# ---------------------------------------------------------------------------
CAREHUB_TITLE_SEARCH = """// CareHub: search page titles in the sidebar outline (no server search here).
function carehubTitleSearch(outline: View[], term: string, workspaceId: string): SearchDocumentPageResponse {
  const needle = term.trim().toLowerCase();
  const found: { item: SearchDocumentResponseItem; score: number }[] = [];

  const walk = (views: View[], trail: string[]) => {
    for (const view of views) {
      const name = (view.name || '').trim();
      const isSpace = isSpaceView(view);

      if (!isSpace && needle && name.toLowerCase().includes(needle)) {
        const score = name.toLowerCase().startsWith(needle) ? 2 : 1;

        found.push({
          score,
          item: {
            object_id: view.view_id,
            workspace_id: workspaceId,
            score,
            content: trail.length ? trail.join(' / ') : '',
            preview: '',
          } as unknown as SearchDocumentResponseItem,
        });
      }

      walk(view.children || [], name ? [...trail, name] : trail);
    }
  };

  walk(outline, []);
  found.sort((a, b) => b.score - a.score);

  return {
    items: found.slice(0, 50).map((entry) => entry.item),
    has_more: false,
    next_offset: null,
  } as unknown as SearchDocumentPageResponse;
}

function BestMatch({
"""

EXTRA_FILES[HERE / "web" / "carehub-theme.css"] = "src/styles/variables/carehub-theme.css"

EDITS.update({
    "src/components/app/search/BestMatch.tsx": [
        ("\nfunction BestMatch({\n", "\n" + CAREHUB_TITLE_SEARCH, 1),
        ("        const page = await SearchService.searchWorkspaceDocumentPage(\n"
         "          currentWorkspaceId,\n          searchTerm,\n          0,\n          keywordSearchStreamId\n        );\n",
         "        const page = carehubTitleSearch(outlineRef.current || [], searchTerm, currentWorkspaceId);\n", 1),
    ],
    "src/components/app/settings/SettingMenu.tsx": [
        ("import { ReactComponent as ConnectionsIcon } from '@/assets/icons/link.svg';\n", "", 1),
        ("      {\n        value: SettingMenuItem.CONNECTIONS,\n"
         "        label: t('settings.connections.menuLabel'),\n        IconComponent: ConnectionsIcon,\n      },\n", "", 1),
    ],
    "src/styles/global.css": [
        ('@import "./template.css";\n',
         '@import "./template.css";\n@import "./variables/carehub-theme.css";\n', 1),
    ],
})


# ---------------------------------------------------------------------------
# CareHub: conditional logic in forms ("show this question only when ...").
# Set it from a question's ... menu -> Conditional logic. The preview and the
# public form only show, check and send the questions whose rule is met.
# ---------------------------------------------------------------------------
EXTRA_FILES[HERE / "web" / "CareHubFormLogic.tsx"] = "src/components/carehub/CareHubFormLogic.tsx"

EDITS.update({
    "src/components/database/form/FormQuestionCard.tsx": EDITS["src/components/database/form/FormQuestionCard.tsx"] + [
        ("import { cn } from '@/lib/utils';\n",
         "import { CareHubFormLogic, CareHubLogicMenuItemContent } from '@/components/carehub/CareHubFormLogic';\n"
         "import { cn } from '@/lib/utils';\n", 1),
        ("  const [menuOpen, setMenuOpen] = useState(false);\n",
         "  const [menuOpen, setMenuOpen] = useState(false);\n"
         "  const [carehubLogicOpen, setCarehubLogicOpen] = useState(false);\n", 1),
        ("              <DropdownMenuSeparator />\n              <DropdownMenuItem\n                disabled={index === 0}\n",
         "              <DropdownMenuItem data-testid='carehub-logic-menu-item' onSelect={() => setCarehubLogicOpen(true)}>\n"
         "                <CareHubLogicMenuItemContent />\n"
         "              </DropdownMenuItem>\n"
         "              <DropdownMenuSeparator />\n              <DropdownMenuItem\n                disabled={index === 0}\n", 1),
        ("      <div className='mt-3'>\n",
         "      <CareHubFormLogic questionId={questionId} open={carehubLogicOpen} onOpenChange={setCarehubLogicOpen} />\n\n"
         "      <div className='mt-3'>\n", 1),
    ],
    "src/components/database/form/FormBuilderView.tsx": [
        ("import { FormShareProvider } from './FormShareContext';\n",
         "import { FormShareProvider } from './FormShareContext';\n"
         "import { CareHubFormLogicProvider } from '@/components/carehub/CareHubFormLogic';\n", 1),
        ("          <DraggableQuestionList\n            questions={resolved}\n",
         "          <CareHubFormLogicProvider questions={resolved}>\n"
         "          <DraggableQuestionList\n            questions={resolved}\n", 1),
        ("            canWriteRef={canWriteRef}\n          />\n        )}\n",
         "            canWriteRef={canWriteRef}\n          />\n          </CareHubFormLogicProvider>\n        )}\n", 1),
    ],
    "src/components/database/form/FormPreviewButton.tsx": [
        ("import { Button } from '@/components/ui/button';\n",
         "import { Button } from '@/components/ui/button';\n"
         "import { useDatabaseView } from '@/application/database-yjs/context';\n"
         "import { carehubAttachShowIf } from '@/components/carehub/CareHubFormLogic';\n", 1),
        ("  const [open, setOpen] = useState(false);\n",
         "  const [open, setOpen] = useState(false);\n  const carehubView = useDatabaseView();\n", 1),
        ("    return buildFormPreviewSchema(snapshot, fieldsMap);\n",
         "    return carehubAttachShowIf(buildFormPreviewSchema(snapshot, fieldsMap), carehubView);\n", 1),
        ("  }, [open, snapshot, fieldsMap, fieldsVersion]);\n",
         "  }, [open, snapshot, fieldsMap, fieldsVersion, carehubView]);\n", 1),
    ],
    "src/components/form/FormBody.tsx": [
        ("import { useCallback, useEffect, useRef, useState } from 'react';\n",
         "import { useCallback, useEffect, useMemo, useRef, useState } from 'react';\n", 1),
        ("import { Button } from '@/components/ui/button';\n",
         "import { Button } from '@/components/ui/button';\n"
         "import { carehubPickAnswers, carehubVisibleQuestions } from '@/components/carehub/CareHubFormLogic';\n", 1),
        ("  const handleSubmit = useCallback(async () => {\n",
         "  // CareHub: questions with a rule only appear (and only count) when the rule is met.\n"
         "  const carehubVisible = useMemo(() => carehubVisibleQuestions(schema.questions, answers), [schema.questions, answers]);\n"
         "  const carehubSubmitAnswers = useMemo(() => carehubPickAnswers(answers, carehubVisible), [answers, carehubVisible]);\n\n"
         "  const handleSubmit = useCallback(async () => {\n", 1),
        ("    const localErrors = collectLocalErrors(schema.questions, answers);\n",
         "    const answers = carehubSubmitAnswers;\n"
         "    const localErrors = collectLocalErrors(\n      schema.questions.filter((q) => carehubVisible.has(q.id)),\n      answers\n    );\n", 1),
        ("      setAnswers(uploadedAnswers);\n",
         "      setAnswers((prev) => ({ ...prev, ...uploadedAnswers }));\n", 1),
        ("  }, [answers, previewMode, retryBlocked, schema.questions, token]);\n",
         "  }, [carehubSubmitAnswers, carehubVisible, previewMode, retryBlocked, schema.questions, token]);\n", 1),
        ("          {schema.questions.map((q) => (\n",
         "          {schema.questions\n            .filter((q) => carehubVisible.has(q.id))\n            .map((q) => (\n", 1),
        ("        Never submit sensitive personal information, like passwords, through AppFlowy Forms.\n",
         "        Never submit passwords through this form.\n", 1),
        ("      {!previewMode && !schema.hide_branding ? (\n", "      {false ? (\n", 1),
    ],
})


def main() -> int:
    failed = False
    for name, edits in EDITS.items():
        path = pathlib.Path(name)
        text = path.read_text(encoding="utf-8")
        for old, new, count in edits:
            found = text.count(old)
            if found != count:
                print(f"CareHub rebrand: expected {count} match(es) in {name}, found {found}:\n  {old[:80]!r}")
                failed = True
                continue
            text = text.replace(old, new)
        path.write_text(text, encoding="utf-8")
    pathlib.Path("public/carehub-icon.svg").write_text(FAVICON, encoding="utf-8")
    dest = pathlib.Path(RICH_TEXT_DEST)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(RICH_TEXT_SRC.read_text(encoding="utf-8"), encoding="utf-8")
    for extra_src, extra_dest in EXTRA_FILES.items():
        target = pathlib.Path(extra_dest)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(extra_src.read_text(encoding="utf-8"), encoding="utf-8")
    if failed:
        return 1
    print("CareHub rebrand: done")
    return 0


if __name__ == "__main__":
    sys.exit(main())

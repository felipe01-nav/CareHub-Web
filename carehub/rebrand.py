#!/usr/bin/env python3
"""CareHub branding, applied to the pinned web source at build time.

Each replacement must match exactly once; if the upstream code changes, the
build stops with a clear message instead of silently shipping AppFlowy text.
Run from the web source folder:  python3 ../carehub/carehub/rebrand.py
"""
import pathlib
import sys

APP_NAME = "Care Hub"

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
    # Browser tab: "<page> | Care Hub" and our own icon instead of the AppFlowy logo.
    "src/components/_shared/helmet/ViewHelmet.tsx": [
        ("<title>{name} | AppFlowy</title>", "<title>{name} | " + APP_NAME + "</title>", 1),
        ("let url = '/appflowy.svg';", "let url = '/carehub-icon.svg';", 1),
    ],
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


# ---------------------------------------------------------------------------
# CareHub: page polish.
# - No grey box around an embedded database while you work inside it.
# - Embedded databases stay inside the page column and scroll sideways there.
# - Delete / Backspace removes a block picked with its handle (like Notion).
# ---------------------------------------------------------------------------
EDITS.update({
    "src/components/editor/components/element/Element.tsx": EDITS["src/components/editor/components/element/Element.tsx"] + [
        ("    if (\n      [\n        ...CONTAINER_BLOCK_TYPES,\n",
         "    if (\n      isDatabaseBlockType(type) ||\n      [\n        ...CONTAINER_BLOCK_TYPES,\n", 1),
    ],
    "src/components/editor/components/blocks/database/hooks/useResizePositioning.ts": [
        ("      setWidth(rect.width);\n      setPaddingStart(offsetLeft);\n      setPaddingEnd(offsetRight);\n",
         "      // CareHub: stay inside the page column (scroll sideways inside it).\n"
         "      void offsetLeft;\n      void offsetRight;\n"
         "      setWidth(blockRect.width);\n      setPaddingStart(0);\n      setPaddingEnd(0);\n", 1),
        ("    resizeObserver.observe(scrollContainer);\n",
         "    resizeObserver.observe(scrollContainer);\n    resizeObserver.observe(dom);\n", 1),
    ],
    "src/components/database/list/List.tsx": [
        ("  const effectivePaddingStart = paddingStart || LIST_DESKTOP_INLINE_PADDING;\n"
         "  const effectivePaddingEnd = paddingEnd || LIST_DESKTOP_INLINE_PADDING;\n",
         "  // CareHub: inside a page the list lines up with the page column.\n"
         "  const effectivePaddingStart = isDocumentBlock ? LIST_ROW_ACTIONS_WIDTH : paddingStart || LIST_DESKTOP_INLINE_PADDING;\n"
         "  const effectivePaddingEnd = isDocumentBlock ? 0 : paddingEnd || LIST_DESKTOP_INLINE_PADDING;\n", 1),
    ],
    "src/components/editor/components/toolbar/block-controls/ControlsMenu.tsx": [
        ("import { useCallback, useMemo } from 'react';\n",
         "import { useCallback, useEffect, useMemo } from 'react';\n", 1),
        ("  return (\n    <Popover\n      anchorEl={anchorEl}\n",
         "  // CareHub: Delete / Backspace removes the picked block(s), like Notion.\n"
         "  useEffect(() => {\n    if (!open) return;\n"
         "    const onKeyDown = (event: KeyboardEvent) => {\n"
         "      if (event.key !== 'Backspace' && event.key !== 'Delete') return;\n"
         "      const target = event.target as HTMLElement | null;\n\n"
         "      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;\n"
         "      const deleteOption = options.find((option) => option.key === 'delete');\n\n"
         "      if (!deleteOption) return;\n"
         "      event.preventDefault();\n      event.stopPropagation();\n"
         "      onClose();\n"
         "      Promise.resolve(deleteOption.onClick()).catch(() => undefined);\n"
         "    };\n\n"
         "    window.addEventListener('keydown', onKeyDown, true);\n"
         "    return () => window.removeEventListener('keydown', onKeyDown, true);\n"
         "  }, [open, options, onClose]);\n\n"
         "  return (\n    <Popover\n      anchorEl={anchorEl}\n", 1),
    ],
})


# ---------------------------------------------------------------------------
# CareHub: "Full width" toggle in the page ... menu, and readable New page errors.
# ---------------------------------------------------------------------------
EXTRA_FILES[HERE / "web" / "CareHubFullWidth.tsx"] = "src/components/carehub/CareHubFullWidth.tsx"

EDITS.update({
    "src/components/editor/Editable.tsx": [
        ("import { cn } from '@/lib/utils';\n",
         "import { cn } from '@/lib/utils';\nimport { useCarehubFullWidth } from '@/components/carehub/CareHubFullWidth';\n", 1),
        ("  const editor = useSlate();\n",
         "  const editor = useSlate();\n"
         "  const carehubFullWidth = useCarehubFullWidth(previewId ? undefined : viewId);\n"
         "\n"
         "  useEffect(() => {\n"
         "    if (previewId) return;\n"
         "    let scrollEl: HTMLElement | null = null;\n"
         "\n"
         "    try {\n"
         "      scrollEl = getScrollParent(ReactEditor.toDOMNode(editor, editor)) as HTMLElement | null;\n"
         "    } catch {\n"
         "      return;\n"
         "    }\n"
         "\n"
         "    if (!scrollEl) return;\n"
         "    const el = scrollEl;\n"
         "\n"
         "    el.classList.toggle('carehub-full-width', carehubFullWidth);\n"
         "    return () => {\n"
         "      el.classList.remove('carehub-full-width');\n"
         "    };\n"
         "  }, [editor, previewId, carehubFullWidth]);\n", 1),
        ("fullWidth ? 'w-full' : 'w-[952px]'", "fullWidth || carehubFullWidth ? 'w-full' : 'w-[952px]'", 2),
    ],
    "src/components/app/header/MoreActionsContent.tsx": [
        ("import { Switch } from '@/components/ui/switch';\n",
         "import { Switch } from '@/components/ui/switch';\n"
         "import { CareHubFullWidthIcon, setCarehubFullWidth, useCarehubFullWidth } from '@/components/carehub/CareHubFullWidth';\n", 1),
        ("  const isLocked = !!view?.is_locked;\n",
         "  const isLocked = !!view?.is_locked;\n  const carehubFullWidth = useCarehubFullWidth(viewId);\n", 1),
        ("      <div ref={containerRef} />\n",
         "      <div ref={containerRef} />\n"
         "      {isDocument && (\n"
         "        <DropdownMenuItem\n"
         "          data-testid={'more-page-full-width'}\n"
         "          onSelect={(event) => {\n"
         "            event.preventDefault();\n"
         "            setCarehubFullWidth(viewId, !carehubFullWidth);\n"
         "          }}\n"
         "        >\n"
         "          <CareHubFullWidthIcon />\n"
         "          <span className={'flex-1'}>Full width</span>\n"
         "          <Switch checked={carehubFullWidth} tabIndex={-1} aria-hidden className={'pointer-events-none'} />\n"
         "        </DropdownMenuItem>\n"
         "      )}\n", 1),
    ],
    "src/components/app/view-actions/NewPage.tsx": [
        ("        notify.error(error instanceof Error ? error.message : String(error));\n",
         "        // CareHub: server errors are plain objects; show their message instead of [object Object].\n"
         "        console.error('[CareHub] New page failed', error);\n"
         "        notify.error(\n"
         "          (error as { message?: string } | null)?.message || JSON.stringify(error) || 'Could not create the page'\n"
         "        );\n", 1),
    ],
})


# ---------------------------------------------------------------------------
# CareHub: no e-mail service, so hide everything that would send an e-mail
# (magic-link sign-in, Forgot password, 'prefer magic link').
# ---------------------------------------------------------------------------
EDITS.update({
    'src/components/login/EmailLogin.tsx': [
        ('  const handleSubmitPassword = async (e: React.MouseEvent<HTMLButtonElement>) => {\n    e.preventDefault();\n', '  const handleSubmitPassword = async (e?: React.MouseEvent<HTMLButtonElement>) => {\n    e?.preventDefault();\n', 1),
        ('              void handleSubmitEmail();\n', '              void handleSubmitPassword();\n', 1),
        ("      <Button\n        data-testid='login-magic-link-button'\n        onClick={handleSubmitEmail}\n        size={'lg'}\n        className={'w-[320px]'}\n        loading={loading}\n      >\n        {loading ? (\n          <>\n            <Progress />\n            {t('loading')}\n          </>\n        ) : (\n          t('signIn.signInWithEmail')\n        )}\n      </Button>\n", '', 1),
        ("        data-testid='login-password-button'\n        variant={'outline'}\n", "        data-testid='login-password-button'\n", 1),
    ],
    'src/components/login/EnterPassword.tsx': [
        ("        <Button\n          variant={'link'}\n          onClick={() => {\n            window.location.href = buildLoginUrl({\n              action: LOGIN_ACTION.RESET_PASSWORD,\n              email,\n              redirectTo,\n            });\n          }}\n          disabled={loading}\n          className={'w-full justify-start px-0 text-sm'}\n        >\n          {t('signIn.forgotPassword')}\n        </Button>\n", '', 1),
    ],
    'src/components/login/SignUpPassword.tsx': [
        ("        <div className={'flex items-center gap-1'}>\n          <span>{t('signUp.preferMagicLink')}</span>\n          <Button\n            variant={'link'}\n            onClick={goBackToLogin}\n            className={'px-0 text-text-secondary underline'}\n            data-testid='signup-go-back-button'\n            disabled={loading}\n          >\n            {t('signUp.goBack')}\n          </Button>\n        </div>\n", '', 1),
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
    # Any leftover place that shows the AppFlowy logo now shows ours.
    pathlib.Path("public/appflowy.svg").write_text(FAVICON, encoding="utf-8")
    # The AppFlowy logo used on the password / sign-up / reset pages becomes ours.
    pathlib.Path("src/assets/icons/logo.svg").write_text(FAVICON, encoding="utf-8")
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



# ---------------------------------------------------------------------------
# CareHub: Settings > "User accounts" for the administrator (emails listed in
# CAREHUB_ADMIN_EMAILS on the server). Add accounts with a password, set a new
# password, remove an account. No email is sent.
# ---------------------------------------------------------------------------
EXTRA_FILES[HERE / "web" / "CareHubAccounts.tsx"] = "src/components/carehub/CareHubAccounts.tsx"

EDITS["src/components/app/settings/SettingMenu.tsx"] += [
    ("import { ReactComponent as MembersIcon } from '@/assets/icons/users.svg';\n",
     "import { ReactComponent as MembersIcon } from '@/assets/icons/users.svg';\n"
     "import { CAREHUB_ACCOUNTS_ITEM, CareHubAccountsIcon, useCarehubIsAdmin } from '@/components/carehub/CareHubAccounts';\n", 1),
    ("  const { t } = useTranslation();\n\n  const options = useMemo(() => {\n",
     "  const { t } = useTranslation();\n  const carehubIsAdmin = useCarehubIsAdmin();\n\n  const options = useMemo(() => {\n", 1),
    ("        IconComponent: MembersIcon,\n      },\n",
     "        IconComponent: MembersIcon,\n      },\n"
     "      ...(carehubIsAdmin\n        ? [\n            {\n"
     "              value: CAREHUB_ACCOUNTS_ITEM as SettingMenuItem,\n"
     "              label: 'User accounts',\n"
     "              IconComponent: CareHubAccountsIcon,\n            },\n          ]\n        : []),\n", 1),
    ("  }, [showBilling, t]);\n", "  }, [showBilling, t, carehubIsAdmin]);\n", 1),
    ("    ];\n  }, [showBilling, t, carehubIsAdmin]);\n",
     "    ].filter((option) => !(carehubIsAdmin && option.value === SettingMenuItem.MEMBERS));\n"
     "  }, [showBilling, t, carehubIsAdmin]);\n", 1),
]

EDITS["src/components/app/settings/Settings.tsx"] = [
    ("import SettingMenu from '@/components/app/settings/SettingMenu';\n",
     "import SettingMenu from '@/components/app/settings/SettingMenu';\n"
     "import { CAREHUB_ACCOUNTS_ITEM, CareHubAccountsPanel, useCarehubIsAdmin } from '@/components/carehub/CareHubAccounts';\n", 1),
    ("  const currentUser = useCurrentUserOptional();\n",
     "  const currentUser = useCurrentUserOptional();\n  const carehubIsAdmin = useCarehubIsAdmin();\n", 1),
    # Administrators get one combined "User accounts" page instead of People + User accounts.
    ("        {selectedItem === SettingMenuItem.MEMBERS && <MembersPanel />}\n",
     "        {selectedItem === SettingMenuItem.MEMBERS && !carehubIsAdmin && <MembersPanel />}\n"
     "        {open && ((selectedItem as string) === CAREHUB_ACCOUNTS_ITEM || (selectedItem === SettingMenuItem.MEMBERS && carehubIsAdmin)) && (\n"
     "          <CareHubAccountsPanel myEmail={currentUser?.email} />\n"
     "        )}\n", 1),
]

# Settings asks "close anyway?" before it closes (click outside) or changes page while "Add many people"
# has new passwords that haven't been downloaded. Escape is already caught inside the panel.
EDITS["src/components/app/settings/Settings.tsx"] += [
    ("import SettingMenu from '@/components/app/settings/SettingMenu';\n",
     "import SettingMenu from '@/components/app/settings/SettingMenu';\n"
     "import { carehubAccountsMayLeave } from '@/components/carehub/CareHubAccounts';\n", 1),
    ("      onClose={onClose}\n",
     "      onClose={() => {\n        if (carehubAccountsMayLeave('close')) onClose();\n      }}\n", 1),
    ("      <SettingMenu onSelectItem={setSelectedItem} selectedItem={selectedItem} showBilling={showBilling} />\n",
     "      <SettingMenu\n        onSelectItem={(item) => {\n"
     "          if (item === selectedItem || carehubAccountsMayLeave('page')) setSelectedItem(item);\n        }}\n"
     "        selectedItem={selectedItem}\n        showBilling={showBilling}\n      />\n", 1),
]


# ---------------------------------------------------------------------------
# CareHub: "Freeze columns" in table views. Column menu > "Freeze up to this
# column" keeps the first columns on the left while scrolling sideways.
# ---------------------------------------------------------------------------
EXTRA_FILES[HERE / "web" / "CareHubFreeze.tsx"] = "src/components/carehub/CareHubFreeze.tsx"

EDITS["src/components/database/components/grid/grid-table/useGridVirtualizer.ts"] = [
    ("import { useVirtualizer } from '@tanstack/react-virtual';\n",
     "import { defaultRangeExtractor, type Range, useVirtualizer } from '@tanstack/react-virtual';\n", 1),
    ("export function useGridVirtualizer({ data, columns }: { columns: RenderColumn[]; data: RenderRow[] }) {\n",
     "export function useGridVirtualizer({\n  data,\n  columns,\n  frozenCount = 0,\n}: {\n  columns: RenderColumn[];\n  data: RenderRow[];\n  frozenCount?: number;\n}) {\n", 1),
    ("  const columnVirtualizer = useVirtualizer({\n    horizontal: true,\n",
     "  // CareHub: frozen columns are always drawn, even when scrolled out of view.\n"
     "  const carehubRangeExtractor = useCallback(\n    (range: Range) => {\n"
     "      const base = defaultRangeExtractor(range);\n\n      if (!frozenCount) return base;\n"
     "      const all = new Set(base);\n\n"
     "      for (let i = 0; i < Math.min(frozenCount, range.count); i++) all.add(i);\n"
     "      return Array.from(all).sort((a, b) => a - b);\n    },\n    [frozenCount]\n  );\n\n"
     "  const columnVirtualizer = useVirtualizer({\n    horizontal: true,\n    rangeExtractor: carehubRangeExtractor,\n", 1),
]

EDITS["src/components/database/components/grid/grid-table/GridVirtualizer.tsx"] = [
    ("import { cn } from '@/lib/utils';\n",
     "import { cn } from '@/lib/utils';\n"
     "import { CarehubFreezeContext, clampFrozenCount, useCarehubFrozenCount } from '@/components/carehub/CareHubFreeze';\n", 1),
    ("  const { parentRef, virtualizer, columnVirtualizer, scrollMarginTop, isReady } = useGridVirtualizer({\n    data,\n    columns,\n  });\n",
     "  const [carehubFrozenRaw] = useCarehubFrozenCount();\n"
     "  const carehubFrozen = clampFrozenCount(carehubFrozenRaw, columns);\n"
     "  const { parentRef, virtualizer, columnVirtualizer, scrollMarginTop, isReady } = useGridVirtualizer({\n    data,\n    columns,\n    frozenCount: carehubFrozen,\n  });\n"
     "  // CareHub: inside a page the first columns stick where the page text starts.\n"
     "  const carehubFreezeOrigin = isDocumentBlock ? 0 : Number(columnVirtualizer.options.paddingStart) || 0;\n"
     "  const carehubFreezeValue = useMemo(\n    () => ({ count: carehubFrozen, origin: carehubFreezeOrigin }),\n    [carehubFrozen, carehubFreezeOrigin]\n  );\n", 1),
    ("    <GridDragContext.Provider value={contextValue}>\n",
     "    <GridDragContext.Provider value={contextValue}>\n      <CarehubFreezeContext.Provider value={carehubFreezeValue}>\n", 1),
    ("    </GridDragContext.Provider>\n",
     "      </CarehubFreezeContext.Provider>\n    </GridDragContext.Provider>\n", 1),
]

EDITS["src/components/database/components/grid/grid-row/GridVirtualRow.tsx"] = [
    ("  const children = useMemo(() => {\n    return uniqBy(columnItems, 'key').map((column) => {\n      return (\n        <GridVirtualColumn\n",
     "  const children = useMemo(() => {\n"
     "    // CareHub: frozen columns can sit apart from the visible ones; keep the gap.\n"
     "    let carehubPrevEnd: number | undefined;\n\n"
     "    return uniqBy(columnItems, 'key').flatMap((column) => {\n"
     "      const carehubGap = carehubPrevEnd !== undefined && column.start > carehubPrevEnd + 0.5 ? column.start - carehubPrevEnd : 0;\n\n"
     "      carehubPrevEnd = column.end;\n"
     "      const cell = (\n        <GridVirtualColumn\n", 1),
    ("          onResizeColumnStart={onResizeColumnStart}\n        />\n      );\n    });\n  }, [columnItems, columns, data, row, onResizeColumnStart]);\n",
     "          onResizeColumnStart={onResizeColumnStart}\n        />\n      );\n\n"
     "      return carehubGap\n        ? [<div key={`carehub-gap-${column.key}`} aria-hidden style={{ width: carehubGap, flexShrink: 0 }} />, cell]\n        : [cell];\n"
     "    });\n  }, [columnItems, columns, data, row, onResizeColumnStart]);\n", 1),
]

EDITS["src/components/database/components/grid/grid-column/GridVirtualColumn.tsx"] = [
    ("import { cn } from '@/lib/utils';\n",
     "import { cn } from '@/lib/utils';\nimport { useCarehubFreeze } from '@/components/carehub/CareHubFreeze';\n", 1),
    ("  const showActions = Boolean(isHoverRow && columnData.isPrimary && rowData.rowId);\n",
     "  const showActions = Boolean(isHoverRow && columnData.isPrimary && rowData.rowId);\n"
     "  const carehubFreeze = useCarehubFreeze();\n"
     "  const carehubFrozen = column.index < carehubFreeze.count;\n", 1),
    ("        readOnly && rowType === RenderRowType.CalculateRow ? 'border-t border-border-primary' : ''\n      )}\n      style={{\n        width: column.size,\n      }}\n",
     "        readOnly && rowType === RenderRowType.CalculateRow ? 'border-t border-border-primary' : '',\n"
     "        carehubFrozen && 'carehub-frozen-cell',\n"
     "        carehubFrozen && column.index === carehubFreeze.count - 1 && 'carehub-frozen-last'\n      )}\n"
     "      style={{\n        width: column.size,\n"
     "        ...(carehubFrozen\n          ? { position: 'sticky' as const, left: column.start - carehubFreeze.origin, zIndex: 11 }\n          : {}),\n      }}\n", 1),
]

EDITS["src/components/database/components/grid/grid-column/GridFieldMenu.tsx"] = [
    ("import { Switch } from '@/components/ui/switch';\n",
     "import { Switch } from '@/components/ui/switch';\n"
     "import { CareHubFreezeIcon, useCarehubFieldIndex, useCarehubFrozenCount } from '@/components/carehub/CareHubFreeze';\n", 1),
    ("  const onDuplicateProperty = useDuplicatePropertyDispatch();\n",
     "  const onDuplicateProperty = useDuplicatePropertyDispatch();\n"
     "  const [carehubFrozenCount, setCarehubFrozenCount] = useCarehubFrozenCount();\n"
     "  const carehubFieldIndex = useCarehubFieldIndex(fieldId);\n", 1),
    ("      ...(canCreateFilter\n        ? [\n",
     "      ...(carehubFieldIndex >= 0\n        ? [\n            {\n"
     "              testId: 'carehub-freeze',\n"
     "              label: carehubFrozenCount === carehubFieldIndex + 1 ? 'Unfreeze columns' : 'Freeze up to this column',\n"
     "              icon: <CareHubFreezeIcon />,\n"
     "              onSelect: () => {\n"
     "                setCarehubFrozenCount(carehubFrozenCount === carehubFieldIndex + 1 ? 0 : carehubFieldIndex + 1);\n"
     "              },\n            },\n          ]\n        : []),\n"
     "      ...(canCreateFilter\n        ? [\n", 1),
    ("    handleCreateFilter,\n    type,\n  ]);\n",
     "    handleCreateFilter,\n    type,\n    carehubFieldIndex,\n    carehubFrozenCount,\n    setCarehubFrozenCount,\n  ]);\n", 1),
]



# ---------------------------------------------------------------------------
# CareHub Calendar: "Calendar" in the sidebar opens a full calendar (day, week,
# month) with your own events plus read-only iCloud / Google calendars.
# ---------------------------------------------------------------------------
EXTRA_FILES[HERE / "web" / "CareHubCalendar.tsx"] = "src/components/carehub/CareHubCalendar.tsx"
EXTRA_FILES[HERE / "web" / "CareHubIcs.ts"] = "src/components/carehub/CareHubIcs.ts"

EDITS["src/components/app/AppRouter.tsx"] = [
    ("import TrashPage from '@/pages/TrashPage';\n",
     "import TrashPage from '@/pages/TrashPage';\nimport CareHubCalendarPage from '@/components/carehub/CareHubCalendar';\n"
     "import CareHubMessagesPage from '@/components/carehub/CareHubMessages';\n", 1),
    ("        <Route path={'trash'} element={<TrashPage />} />\n",
     "        <Route path={'trash'} element={<TrashPage />} />\n        <Route path={'calendar'} element={<CareHubCalendarPage />} />\n"
     "        <Route path={'messages'} element={<CareHubMessagesPage />} />\n", 1),
]

EXTRA_FILES[HERE / "web" / "CareHubMessages.tsx"] = "src/components/carehub/CareHubMessages.tsx"
EXTRA_FILES[HERE / "web" / "CareHubSidebarHome.tsx"] = "src/components/carehub/CareHubSidebarHome.tsx"

# Sidebar: Home / Messages / Calendar buttons and "Upcoming events" (like Notion)
EDITS["src/components/app/SideBar.tsx"] = [
    ("import { NotificationBell } from '@/components/notifications';\n",
     "import { NotificationBell } from '@/components/notifications';\n"
     "import { CareHubSidebarTabs, CareHubUpcomingEvents } from '@/components/carehub/CareHubSidebarHome';\n", 1),
    ("          <Search />\n", "          <Search />\n          <CareHubSidebarTabs />\n", 1),
    ("        <Outline width={drawerWidth} />\n",
     "        <CareHubUpcomingEvents />\n        <Outline width={drawerWidth} />\n", 1),
]

# Phone menu: the same buttons and list
EDITS["src/components/_shared/mobile-topbar/MobileFolder.tsx"] = [
    ("import MobileOutline from 'src/components/_shared/mobile-outline/MobileOutline';\n",
     "import MobileOutline from 'src/components/_shared/mobile-outline/MobileOutline';\n"
     "import { CareHubSidebarTabs, CareHubUpcomingEvents } from '@/components/carehub/CareHubSidebarHome';\n", 1),
    ("          <MobileMore onClose={onClose} />\n        </div>\n",
     "          <MobileMore onClose={onClose} />\n        </div>\n"
     "        <CareHubSidebarTabs onNavigate={onClose} />\n", 1),
    ("        <div className={'transform-gpu px-2 pb-[60px]'}>\n          {outline && (\n",
     "        <div className={'transform-gpu px-2 pb-[60px]'}>\n          <CareHubUpcomingEvents onNavigate={onClose} />\n          {outline && (\n", 1),
]

EDITS["src/components/app/header/AppHeader.tsx"] = [
    ("  const isTrash = window.location.pathname === '/app/trash';\n",
     "  const isTrash = window.location.pathname === '/app/trash' || window.location.pathname === '/app/calendar' || window.location.pathname === '/app/messages';\n", 1),
]


# ---------------------------------------------------------------------------
# Sidebar: Favorites and Recent sections (always shown, like the phone layout)
# ---------------------------------------------------------------------------
EXTRA_FILES[HERE / "web" / "CareHubQuickAccess.tsx"] = "src/components/carehub/CareHubQuickAccess.tsx"

EDITS["src/components/app/outline/Outline.tsx"] = [
    ("import { Favorite } from '@/components/app/favorite';\n",
     "import { CareHubQuickAccess } from '@/components/carehub/CareHubQuickAccess';\n", 1),
    ("        <Favorite />\n", "        <CareHubQuickAccess />\n", 1),
]


# ---------------------------------------------------------------------------
# "@" mentions: people, pages and dates are searched in the browser (this
# server has no mention-search service). Mention notifications are optional,
# so a failure there no longer interrupts typing.
# ---------------------------------------------------------------------------
EXTRA_FILES[HERE / "web" / "carehub-mentions.ts"] = "src/application/services/js-services/http/carehub-mentions.ts"

EDITS["src/application/services/js-services/http/workspace-api.ts"] = [
    ("import { APIResponse, executeAPIRequest, executeAPIVoidRequest, getAxios } from './core';\n",
     "import { APIResponse, executeAPIRequest, executeAPIVoidRequest, getAxios } from './core';\n"
     "import { carehubSearchMentions } from './carehub-mentions';\n", 1),
    ("  const url = `/api/workspace/${workspaceId}/mentions/search`;\n\n"
     "  return executeAPIRequest<MentionSearchResponse>(() =>\n"
     "    getAxios()?.post<APIResponse<MentionSearchResponse>>(url, payload)\n"
     "  );\n",
     "  return carehubSearchMentions(workspaceId, payload);\n", 1),
    ("  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/page-mention`;\n\n"
     "  return executeAPIVoidRequest(() =>\n"
     "    getAxios()?.put<APIResponse>(url, data)\n"
     "  );\n",
     "  const url = `/api/workspace/${workspaceId}/page-view/${viewId}/page-mention`;\n\n"
     "  try {\n"
     "    await executeAPIVoidRequest(() =>\n"
     "      getAxios()?.put<APIResponse>(url, data)\n"
     "    );\n"
     "  } catch (err) {\n"
     "    console.warn('[CareHub] mention notification skipped', err);\n"
     "  }\n", 1),
]


# ---------------------------------------------------------------------------
# Export → PDF: uses the browser's print dialog ("Save as PDF") because this
# server has no PDF export service. The "linked pages" switch is hidden.
# ---------------------------------------------------------------------------
EXTRA_FILES[HERE / "web" / "CareHubPrint.ts"] = "src/components/carehub/CareHubPrint.ts"

EDITS["src/components/app/share/ExportPanel.tsx"] = [
    ("import { getViewPdfBlob } from '@/application/services/js-services/http/export-api';\n",
     "import { carehubPrintPage } from '@/components/carehub/CareHubPrint';\n", 1),
    ("import { downloadBlob } from '@/utils/download';\n", "", 1),
    ("""      const { blob, filename } = await getViewPdfBlob(workspaceId, viewIdResolved, {
        includeNested: isPro ? includeLinkedPages : false,
        // Mirror desktop: embedded databases are a Pro feature
        // (share_bloc.dart:447 shouldIncludeEmbeddedDatabases = isProPlan).
        // Self-host users have isPro=true via useSubscriptionPlan.
        includeDatabase: isPro,
      });

      downloadBlob(blob, filename);
      toast.success(t('shareAction.exportPdfSuccess'));
""",
     """      hideBlockingLoader();
      await carehubPrintPage(view?.name || 'Care Hub page');
""", 1),
    ("""      <div className='flex items-center justify-between gap-4'>
        <div className='flex flex-col'>
""",
     """      <div className='hidden'>
        <div className='flex flex-col'>
""", 1),
]


# ---------------------------------------------------------------------------
# Password rules: at least 8 characters, an uppercase letter, a lowercase
# letter and a symbol.
# ---------------------------------------------------------------------------
EDITS["src/components/login/password-validation.ts"] = [
    ("    minLength: password.length >= 6,\n", "    minLength: password.length >= 8,\n", 1),
    ("    hasSpecialChar: /[!@#$%^&*()_+\\-=[\\]{};':\"\\\\|,.<>/?]/.test(password),\n",
     "    hasSpecialChar: /[^A-Za-z0-9\\s]/.test(password),\n", 1),
]


# ---------------------------------------------------------------------------
# App text: every "AppFlowy" in the English texts becomes "Care Hub"
# (for example Settings > Manage data). Only texts change, never keys.
# ---------------------------------------------------------------------------
TRANSLATIONS_FILE = "src/@types/translations/en.json"


def rebrand_translations() -> bool:
    import json

    path = pathlib.Path(TRANSLATIONS_FILE)
    data = json.loads(path.read_text(encoding="utf-8"))

    def walk(value):
        if isinstance(value, dict):
            return {key: walk(item) for key, item in value.items()}
        if isinstance(value, list):
            return [walk(item) for item in value]
        if isinstance(value, str):
            return value.replace("AppFlowy", APP_NAME)
        return value

    data = walk(data)
    data["appName"] = APP_NAME
    data.setdefault("changePassword", {})["passwordError"] = "Password must be at least 8 characters long"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return True


_carehub_main_before_translations = main


def main() -> int:  # noqa: F811 - runs the steps above, then the text rebrand
    result = _carehub_main_before_translations()
    try:
        rebrand_translations()
        print("CareHub rebrand: texts done")
    except Exception as error:  # a text problem must never break the build
        print(f"CareHub rebrand: texts skipped ({error})")
    return result


# ---------------------------------------------------------------------------
# Phones: pages can be edited on a phone too (upstream made them read-only).
# Locked pages and view-only sharing still stay read-only.
# ---------------------------------------------------------------------------
EDITS["src/components/app/hooks/useViewOperations.ts"] = [
    ("  if (isMobile) return true; // Mobile has highest priority - always readonly\n",
     "  // Care Hub: phones can edit too.\n  void isMobile;\n", 1),
]


# ---------------------------------------------------------------------------
# CareHub: tables inside a page line up with the page text. The row buttons
# (+ and drag) sit in the page margin on the left, like Notion, instead of
# pushing the columns ~96px to the right.
# ---------------------------------------------------------------------------
EDITS["src/components/database/components/grid/grid-table/useGridVirtualizer.ts"] += [
    ("export const PADDING_INLINE = getPlatform().isMobile ? 21 : 96;\n",
     "export const PADDING_INLINE = getPlatform().isMobile ? 21 : 96;\n"
     "// CareHub: room for the row buttons when a table sits inside a page.\n"
     "export const CAREHUB_GRID_GUTTER = 56;\n", 1),
    ("  const effectivePaddingStart = paddingStart || PADDING_INLINE;\n  const effectivePaddingEnd = paddingEnd || PADDING_INLINE;\n",
     "  const effectivePaddingStart = isDocumentBlock ? CAREHUB_GRID_GUTTER : paddingStart || PADDING_INLINE;\n"
     "  const effectivePaddingEnd = isDocumentBlock ? 0 : paddingEnd || PADDING_INLINE;\n", 1),
]
EDITS["src/components/database/components/grid/grid-table/GridVirtualizer.tsx"] += [
    ("import { PADDING_INLINE, useGridVirtualizer } from '@/components/database/components/grid/grid-table/useGridVirtualizer';\n",
     "import {\n  CAREHUB_GRID_GUTTER,\n  PADDING_INLINE,\n  useGridVirtualizer,\n} from '@/components/database/components/grid/grid-table/useGridVirtualizer';\n", 1),
    ("          overflowX: 'auto',\n          scrollBehavior: 'auto',\n        }}\n        onScroll={handleScroll}\n",
     "          overflowX: 'auto',\n          scrollBehavior: 'auto',\n"
     "          ...(isDocumentBlock\n            ? { marginLeft: -CAREHUB_GRID_GUTTER, width: `calc(100% + ${CAREHUB_GRID_GUTTER}px)` }\n            : {}),\n"
     "        }}\n        onScroll={handleScroll}\n", 1),
]
EDITS["src/components/database/components/grid/grid-row/GridVirtualRow.tsx"] += [
    ("import { useReadOnly, useRowData, useSortsSelector } from '@/application/database-yjs';\n",
     "import { useDatabaseContext, useReadOnly, useRowData, useSortsSelector } from '@/application/database-yjs';\n", 1),
    ("  const isRegularRow = rowType === RenderRowType.Row;\n",
     "  const isRegularRow = rowType === RenderRowType.Row;\n"
     "  // CareHub: inside a page the row-button margin stays put while scrolling sideways.\n"
     "  const carehubInPage = Boolean(useDatabaseContext().isDocumentBlock);\n", 1),
    ("        <div style={{ width: `${before}px` }}>\n",
     "        <div\n          style={{\n            width: `${before}px`,\n"
     "            ...(carehubInPage && before > 0\n"
     "              ? { position: 'sticky' as const, left: 0, zIndex: 12, flexShrink: 0, background: 'var(--background-primary)' }\n"
     "              : {}),\n          }}\n        >\n", 1),
]



# ---------------------------------------------------------------------------
# CareHub: meeting notes with a PRIVATE transcript. "/Meeting notes" adds the
# meeting block (summary, notes, transcript). "Start transcribing" runs the
# Whisper speech model inside the browser on this computer, so no audio is
# sent anywhere (the stock recorder streamed audio to AssemblyAI). When the
# recording stops, Claude writes the summary.
# ---------------------------------------------------------------------------
EXTRA_FILES[HERE / "web" / "CareHubTranscription.tsx"] = "src/components/carehub/CareHubTranscription.tsx"
EDITS["src/components/editor/components/blocks/ai-meeting/AIMeetingRecording.tsx"] = [
    ("} from '@/application/integrations/meeting-transcription';\n",
     "} from '@/components/carehub/CareHubTranscription';\n"
     "import { CareHubTranscribeOptions } from '@/components/carehub/CareHubTranscription';\n", 1),
    ("          <p className='mb-3 text-text-secondary'>{t('document.aiMeeting.audioSourceHint')}</p>\n",
     "          <p className='mb-3 text-text-secondary'>{t('document.aiMeeting.audioSourceHint')}</p>\n"
     "          <CareHubTranscribeOptions />\n", 1),
]
EDITS["src/components/editor/components/panels/slash-panel/SlashPanel.tsx"] += [
    ("  carehubInsertTabs,\n} from '@/components/carehub/CareHubBlocks';\n",
     "  carehubInsertTabs,\n  CareHubMeetingIcon,\n  carehubInsertMeeting,\n} from '@/components/carehub/CareHubBlocks';\n", 1),
    ("                void continueWriting(content);\n              },\n            },\n          ]\n        : []),\n",
     "                void continueWriting(content);\n              },\n            },\n"
     "            ...(isInsideAIMeeting\n              ? []\n              : [\n                  {\n"
     "                    label: 'Meeting notes',\n"
     "                    key: 'carehubMeetingNotes',\n"
     "                    icon: <CareHubMeetingIcon />,\n"
     "                    group: SlashMenuGroupKey.AppFlowyAI,\n"
     "                    keywords: ['meeting', 'notes', 'transcribe', 'transcript', 'transcription', 'record', 'minutes', 'audio'],\n"
     "                    onClick: () => {\n                      carehubInsertMeeting(editor);\n                    },\n"
     "                  },\n                ]),\n"
     "          ]\n        : []),\n", 1),
]


# ---------------------------------------------------------------------------
# CareHub Messages: share pages in a chat (page button or "@"), shown as cards.
# ---------------------------------------------------------------------------
EXTRA_FILES[HERE / "web" / "CareHubSharePage.tsx"] = "src/components/carehub/CareHubSharePage.tsx"


# ---------------------------------------------------------------------------
# CareHub: more relative date filters (this/last/next month, this year,
# past/next 7 and 30 days). New "starts" conditions use negative numbers and
# new "ends" conditions use 100+, so the stock start/end checks keep working.
# Also: the AI chat no longer offers image output (not available here).
# ---------------------------------------------------------------------------
CAREHUB_REL_ENUM = """  DateEndsNextWeek = 27,
  // CareHub relative ranges (starts are negative, ends are 100+).
  DateStartsThisMonth = -1,
  DateStartsLastMonth = -2,
  DateStartsNextMonth = -3,
  DateStartsThisYear = -4,
  DateStartsPast7Days = -5,
  DateStartsNext7Days = -6,
  DateStartsPast30Days = -7,
  DateStartsNext30Days = -8,
  DateEndsThisMonth = 101,
  DateEndsLastMonth = 102,
  DateEndsNextMonth = 103,
  DateEndsThisYear = 104,
  DateEndsPast7Days = 105,
  DateEndsNext7Days = 106,
  DateEndsPast30Days = 107,
  DateEndsNext30Days = 108,
}
"""

CAREHUB_REL_KINDS = """  NextWeek = 'nextWeek',
  ThisMonth = 'thisMonth',
  LastMonth = 'lastMonth',
  NextMonth = 'nextMonth',
  ThisYear = 'thisYear',
  Past7Days = 'past7Days',
  Next7Days = 'next7Days',
  Past30Days = 'past30Days',
  Next30Days = 'next30Days',
}
"""

CAREHUB_REL_CASES = """      return DateFilterRelativeCondition.NextWeek;
    case DateFilterCondition.DateStartsThisMonth:
    case DateFilterCondition.DateEndsThisMonth:
      return DateFilterRelativeCondition.ThisMonth;
    case DateFilterCondition.DateStartsLastMonth:
    case DateFilterCondition.DateEndsLastMonth:
      return DateFilterRelativeCondition.LastMonth;
    case DateFilterCondition.DateStartsNextMonth:
    case DateFilterCondition.DateEndsNextMonth:
      return DateFilterRelativeCondition.NextMonth;
    case DateFilterCondition.DateStartsThisYear:
    case DateFilterCondition.DateEndsThisYear:
      return DateFilterRelativeCondition.ThisYear;
    case DateFilterCondition.DateStartsPast7Days:
    case DateFilterCondition.DateEndsPast7Days:
      return DateFilterRelativeCondition.Past7Days;
    case DateFilterCondition.DateStartsNext7Days:
    case DateFilterCondition.DateEndsNext7Days:
      return DateFilterRelativeCondition.Next7Days;
    case DateFilterCondition.DateStartsPast30Days:
    case DateFilterCondition.DateEndsPast30Days:
      return DateFilterRelativeCondition.Past30Days;
    case DateFilterCondition.DateStartsNext30Days:
    case DateFilterCondition.DateEndsNext30Days:
      return DateFilterRelativeCondition.Next30Days;
"""

CAREHUB_REL_PAIRS = """  [DateFilterCondition.DateStartsNextWeek, DateFilterCondition.DateEndsNextWeek],
  [DateFilterCondition.DateStartsThisMonth, DateFilterCondition.DateEndsThisMonth],
  [DateFilterCondition.DateStartsLastMonth, DateFilterCondition.DateEndsLastMonth],
  [DateFilterCondition.DateStartsNextMonth, DateFilterCondition.DateEndsNextMonth],
  [DateFilterCondition.DateStartsThisYear, DateFilterCondition.DateEndsThisYear],
  [DateFilterCondition.DateStartsPast7Days, DateFilterCondition.DateEndsPast7Days],
  [DateFilterCondition.DateStartsNext7Days, DateFilterCondition.DateEndsNext7Days],
  [DateFilterCondition.DateStartsPast30Days, DateFilterCondition.DateEndsPast30Days],
  [DateFilterCondition.DateStartsNext30Days, DateFilterCondition.DateEndsNext30Days],
];

// CareHub: the extra relative ranges, in menu order, with their labels.
export const CAREHUB_RELATIVE_OPTIONS: ReadonlyArray<{ value: DateFilterCondition; label: string }> = [
  { value: DateFilterCondition.DateStartsThisMonth, label: 'This month' },
  { value: DateFilterCondition.DateStartsLastMonth, label: 'Last month' },
  { value: DateFilterCondition.DateStartsNextMonth, label: 'Next month' },
  { value: DateFilterCondition.DateStartsThisYear, label: 'This year' },
  { value: DateFilterCondition.DateStartsPast7Days, label: 'Past 7 days' },
  { value: DateFilterCondition.DateStartsNext7Days, label: 'Next 7 days' },
  { value: DateFilterCondition.DateStartsPast30Days, label: 'Past 30 days' },
  { value: DateFilterCondition.DateStartsNext30Days, label: 'Next 30 days' },
];

export function carehubRelativeLabel(condition: DateFilterCondition): string {
  const start = toStartDateCondition(condition);

  return CAREHUB_RELATIVE_OPTIONS.find((option) => option.value === start)?.label ?? '';
}
"""

CAREHUB_REL_RANGES = """    case DateFilterRelativeCondition.NextWeek:
      return weekRange(startOfToday, 7);
    case DateFilterRelativeCondition.ThisMonth:
      return { start: startOfToday.startOf('month'), end: startOfToday.endOf('month').startOf('day') };
    case DateFilterRelativeCondition.LastMonth: {
      const month = startOfToday.subtract(1, 'month');

      return { start: month.startOf('month'), end: month.endOf('month').startOf('day') };
    }

    case DateFilterRelativeCondition.NextMonth: {
      const month = startOfToday.add(1, 'month');

      return { start: month.startOf('month'), end: month.endOf('month').startOf('day') };
    }

    case DateFilterRelativeCondition.ThisYear:
      return { start: startOfToday.startOf('year'), end: startOfToday.endOf('year').startOf('day') };
    case DateFilterRelativeCondition.Past7Days:
      return { start: startOfToday.subtract(6, 'day'), end: startOfToday };
    case DateFilterRelativeCondition.Next7Days:
      return { start: startOfToday, end: startOfToday.add(6, 'day') };
    case DateFilterRelativeCondition.Past30Days:
      return { start: startOfToday.subtract(29, 'day'), end: startOfToday };
    case DateFilterRelativeCondition.Next30Days:
      return { start: startOfToday, end: startOfToday.add(29, 'day') };
"""

EDITS.update({
    "src/application/database-yjs/fields/date/date.type.ts": [
        ("  DateEndsNextWeek = 27,\n}\n", CAREHUB_REL_ENUM, 1),
        ("  NextWeek = 'nextWeek',\n}\n", CAREHUB_REL_KINDS, 1),
    ],
    "src/application/database-yjs/fields/date/relativeDate.ts": [
        ("      return DateFilterRelativeCondition.NextWeek;\n", CAREHUB_REL_CASES, 1),
        ("  [DateFilterCondition.DateStartsNextWeek, DateFilterCondition.DateEndsNextWeek],\n];\n", CAREHUB_REL_PAIRS, 1),
        ("    case DateFilterRelativeCondition.NextWeek:\n      return weekRange(startOfToday, 7);\n", CAREHUB_REL_RANGES, 1),
    ],
    "src/components/database/components/filters/filter-menu/DateTimeFilterMenu.tsx": [
        ("import { useUpdateFilter } from '@/application/database-yjs/dispatch';\n",
         "import { useUpdateFilter } from '@/application/database-yjs/dispatch';\n"
         "import { CAREHUB_RELATIVE_OPTIONS } from '@/application/database-yjs/fields/date/relativeDate';\n", 1),
        ("      { value: pick(DateFilterCondition.DateStartsNextWeek), text: t('relativeDates.nextWeek') },\n",
         "      { value: pick(DateFilterCondition.DateStartsNextWeek), text: t('relativeDates.nextWeek') },\n"
         "      ...CAREHUB_RELATIVE_OPTIONS.map((option) => ({ value: pick(option.value), text: option.label })),\n", 1),
    ],
    "src/components/database/components/filters/advanced/FilterControls.tsx": [
        ("import { isRelativeDateCondition } from '@/application/database-yjs/fields/date/relativeDate';\n",
         "import {\n  CAREHUB_RELATIVE_OPTIONS,\n  isRelativeDateCondition,\n  toEndDateCondition,\n"
         "} from '@/application/database-yjs/fields/date/relativeDate';\n", 1),
        ("    ? baseConditions.map((item) => ({ ...item, value: item.value >= 16 ? item.value + 6 : item.value + 8 }))\n",
         "    ? baseConditions.map((item) => ({ ...item, value: toEndDateCondition(item.value) }))\n", 1),
        ("        { value: DateFilterCondition.DateStartsNextWeek, text: t('relativeDates.nextWeek') },\n",
         "        { value: DateFilterCondition.DateStartsNextWeek, text: t('relativeDates.nextWeek') },\n"
         "        ...CAREHUB_RELATIVE_OPTIONS.map((option) => ({ value: option.value as number, text: option.label })),\n", 1),
    ],
    "src/components/database/components/filters/overview/useFilterChipLabel.ts": [
        ("import { toStartDateCondition } from '@/application/database-yjs/fields/date/relativeDate';\n",
         "import { carehubRelativeLabel, toStartDateCondition } from '@/application/database-yjs/fields/date/relativeDate';\n", 1),
        ("  const format = (unix: number) => dayjs.unix(unix).format(dateFormat);\n",
         "  const format = (unix: number) => dayjs.unix(unix).format(dateFormat);\n"
         "  const carehubLabel = carehubRelativeLabel(filter.condition);\n\n"
         "  if (carehubLabel) return { description: carehubLabel, hasContent: true };\n", 1),
    ],
    "src/components/chat/components/ui/format-group.tsx": [
        ("        {renderGroup(actions, false)}\n",
         "        {/* CareHub: image output is not available, so only Text is offered. */}\n"
         "        {renderGroup(actions.filter((action) => action.key === OutputContent.TEXT), false)}\n", 1),
    ],
})


# ---------------------------------------------------------------------------
# CareHub extras: roles & permissions, automations, meeting notes from the
# calendar, speaker labels, a "Spaces" heading, nightly backups / status page,
# page templates, reminders, phone tweaks, analytics and page versions.
# ---------------------------------------------------------------------------
for _name in [
    "CareHubCore.ts", "CareHubUi.tsx", "CareHubHistory.tsx", "CareHubAnalytics.tsx", "CareHubAdmin.tsx",
    "CareHubStatus.tsx", "CareHubTemplates.tsx", "CareHubMeetingNotes.tsx", "CareHubReminders.tsx",
    "CareHubBackground.tsx", "CareHubSidebarExtras.tsx",
]:
    EXTRA_FILES[HERE / "web" / _name] = "src/components/carehub/" + _name

EDITS.setdefault("src/components/app/AppRouter.tsx", []).extend([
    ("import CareHubMessagesPage from '@/components/carehub/CareHubMessages';\n",
     "import CareHubMessagesPage from '@/components/carehub/CareHubMessages';\n"
     "import CareHubAnalyticsPage from '@/components/carehub/CareHubAnalytics';\n"
     "import CareHubBackground from '@/components/carehub/CareHubBackground';\n"
     "import CareHubStatusPage from '@/components/carehub/CareHubStatus';\n", 1),
    ("        <Route path={'messages'} element={<CareHubMessagesPage />} />\n",
     "        <Route path={'messages'} element={<CareHubMessagesPage />} />\n"
     "        <Route path={'analytics'} element={<CareHubAnalyticsPage />} />\n", 1),
    ("      <Route path={'invited/:code'} element={<InviteCode />} />\n",
     "      <Route path={'status'} element={<CareHubStatusPage />} />\n"
     "      <Route path={'invited/:code'} element={<InviteCode />} />\n", 1),
    ("  return (\n    <Routes>\n", "  return (\n    <>\n    <CareHubBackground />\n    <Routes>\n", 1),
    ("    </Routes>\n  );\n", "    </Routes>\n    </>\n  );\n", 1),
])

EDITS.setdefault("src/components/app/header/AppHeader.tsx", []).extend([
    ("|| window.location.pathname === '/app/messages';\n",
     "|| window.location.pathname === '/app/messages' || window.location.pathname === '/app/analytics';\n", 1),
])

# Page menu: our own Version history (works without the paid history service).
EDITS.setdefault("src/components/app/header/MoreActions.tsx", []).extend([
    ("import('@/components/document/history/DocumentHistoryModal')", "import('@/components/carehub/CareHubHistory')", 1),
    ("  const pageHistoryEnabled = usePageHistoryEnabled();\n",
     "  void usePageHistoryEnabled();\n  const pageHistoryEnabled = true;\n", 1),
    ("        canUsePageHistory={canUsePageHistory}\n", "        canUsePageHistory={canUsePageHistory || true}\n", 1),
])

EDITS.setdefault("src/components/app/header/MoreActionsContent.tsx", []).extend([
    ("import { CareHubFullWidthIcon, setCarehubFullWidth, useCarehubFullWidth } from '@/components/carehub/CareHubFullWidth';\n",
     "import { CareHubFullWidthIcon, setCarehubFullWidth, useCarehubFullWidth } from '@/components/carehub/CareHubFullWidth';\n"
     "import { openCareHubDialog, useCareHubCan } from '@/components/carehub/CareHubCore';\n", 1),
    ("  const carehubFullWidth = useCarehubFullWidth(viewId);\n",
     "  const carehubFullWidth = useCarehubFullWidth(viewId);\n"
     "  const carehubCanTemplates = useCareHubCan(workspaceId, 'templates');\n"
     "  const carehubCanAnalytics = useCareHubCan(workspaceId, 'analytics');\n", 1),
    ("          <Switch checked={carehubFullWidth} tabIndex={-1} aria-hidden className={'pointer-events-none'} />\n"
     "        </DropdownMenuItem>\n"
     "      )}\n",
     "          <Switch checked={carehubFullWidth} tabIndex={-1} aria-hidden className={'pointer-events-none'} />\n"
     "        </DropdownMenuItem>\n"
     "      )}\n"
     "      {workspaceId && (\n"
     "        <DropdownMenuItem\n"
     "          data-testid={'more-page-remind-me'}\n"
     "          onSelect={() => {\n"
     "            itemClicked?.();\n"
     "            openCareHubDialog({ kind: 'reminder', workspaceId, pageId: viewId, title: view?.name || 'Page' });\n"
     "          }}\n"
     "        >\n"
     "          <span className={'flex h-5 w-5 items-center justify-center text-base'}>⏰</span>\n"
     "          <span className={'flex-1'}>Remind me…</span>\n"
     "        </DropdownMenuItem>\n"
     "      )}\n"
     "      {workspaceId && isDocument && carehubCanTemplates && (\n"
     "        <DropdownMenuItem\n"
     "          data-testid={'more-page-save-template'}\n"
     "          onSelect={() => {\n"
     "            itemClicked?.();\n"
     "            openCareHubDialog({ kind: 'save-template', workspaceId, pageId: viewId, title: view?.name || '' });\n"
     "          }}\n"
     "        >\n"
     "          <span className={'flex h-5 w-5 items-center justify-center text-base'}>📄</span>\n"
     "          <span className={'flex-1'}>Save as template</span>\n"
     "        </DropdownMenuItem>\n"
     "      )}\n"
     "      {workspaceId && carehubCanAnalytics && (\n"
     "        <DropdownMenuItem\n"
     "          data-testid={'more-page-analytics'}\n"
     "          onSelect={() => {\n"
     "            itemClicked?.();\n"
     "            openCareHubDialog({ kind: 'page-analytics', workspaceId, pageId: viewId, title: view?.name || '' });\n"
     "          }}\n"
     "        >\n"
     "          <span className={'flex h-5 w-5 items-center justify-center text-base'}>📈</span>\n"
     "          <span className={'flex-1'}>Page analytics</span>\n"
     "        </DropdownMenuItem>\n"
     "      )}\n", 1),
])

# Editor: count edits for analytics and keep automatic page versions.
EDITS.setdefault("src/components/editor/Editable.tsx", []).extend([
    ("import { cn } from '@/lib/utils';\n",
     "import { cn } from '@/lib/utils';\nimport { useCareHubDocTracking } from '@/components/carehub/CareHubHistory';\n", 1),
    ("  const editor = useSlate();\n",
     "  const editor = useSlate();\n\n  useCareHubDocTracking(previewId ? undefined : viewId, workspaceId, editor, readOnly);\n", 1),
])

# Sidebar: Templates / Analytics buttons, "Spaces" heading, New page only for roles that may create.
EDITS.setdefault("src/components/app/SideBar.tsx", []).extend([
    ("import { CareHubSidebarTabs, CareHubUpcomingEvents } from '@/components/carehub/CareHubSidebarHome';\n",
     "import { CareHubSidebarTabs, CareHubUpcomingEvents } from '@/components/carehub/CareHubSidebarHome';\n"
     "import { CareHubCanCreate, CareHubSidebarExtras } from '@/components/carehub/CareHubSidebarExtras';\n", 1),
    ("          <CareHubSidebarTabs />\n", "          <CareHubSidebarTabs />\n          <CareHubSidebarExtras />\n", 1),
    ("              <NewPage />\n", "              <CareHubCanCreate>\n                <NewPage />\n              </CareHubCanCreate>\n", 1),
])

EDITS.setdefault("src/components/app/outline/Outline.tsx", []).extend([
    ("import { CareHubQuickAccess } from '@/components/carehub/CareHubQuickAccess';\n",
     "import { CareHubQuickAccess } from '@/components/carehub/CareHubQuickAccess';\n"
     "import { CareHubSpacesHeader } from '@/components/carehub/CareHubSidebarExtras';\n", 1),
    ("        <ShareWithMe width={width - 20} />\n",
     "        <ShareWithMe width={width - 20} />\n        <CareHubSpacesHeader />\n", 1),
])

EDITS.setdefault("src/components/_shared/mobile-topbar/MobileFolder.tsx", []).extend([
    ("import { CareHubSidebarTabs, CareHubUpcomingEvents } from '@/components/carehub/CareHubSidebarHome';\n",
     "import { CareHubSidebarTabs, CareHubUpcomingEvents } from '@/components/carehub/CareHubSidebarHome';\n"
     "import { CareHubSidebarExtras } from '@/components/carehub/CareHubSidebarExtras';\n", 1),
    ("        <CareHubSidebarTabs onNavigate={onClose} />\n",
     "        <CareHubSidebarTabs onNavigate={onClose} />\n        <div className={'px-2'}>\n          <CareHubSidebarExtras onNavigate={onClose} />\n        </div>\n", 1),
])

# Settings: Roles & permissions, Automations, Data & backups.
EDITS.setdefault("src/components/app/settings/SettingMenu.tsx", []).extend([
    ("import { CAREHUB_ACCOUNTS_ITEM, CareHubAccountsIcon, useCarehubIsAdmin } from '@/components/carehub/CareHubAccounts';\n",
     "import { CAREHUB_ACCOUNTS_ITEM, CareHubAccountsIcon, useCarehubIsAdmin } from '@/components/carehub/CareHubAccounts';\n"
     "import {\n  CAREHUB_AUTOMATIONS_ITEM,\n  CAREHUB_DATA_ITEM,\n  CAREHUB_ROLES_ITEM,\n  CareHubAutomationsIcon,\n"
     "  CareHubDataIcon,\n  CareHubRolesIcon,\n  useCareHubSettingsAccess,\n} from '@/components/carehub/CareHubAdmin';\n", 1),
    ("  const carehubIsAdmin = useCarehubIsAdmin();\n\n  const options = useMemo(() => {\n",
     "  const carehubIsAdmin = useCarehubIsAdmin();\n  const carehubAccess = useCareHubSettingsAccess();\n\n  const options = useMemo(() => {\n", 1),
    ("              IconComponent: CareHubAccountsIcon,\n            },\n          ]\n        : []),\n",
     "              IconComponent: CareHubAccountsIcon,\n            },\n          ]\n        : []),\n"
     "      ...(carehubAccess.roles\n        ? [{ value: CAREHUB_ROLES_ITEM as SettingMenuItem, label: 'Roles & permissions', IconComponent: CareHubRolesIcon }]\n        : []),\n"
     "      ...(carehubAccess.automations\n        ? [{ value: CAREHUB_AUTOMATIONS_ITEM as SettingMenuItem, label: 'Automations', IconComponent: CareHubAutomationsIcon }]\n        : []),\n"
     "      ...(carehubAccess.data\n        ? [{ value: CAREHUB_DATA_ITEM as SettingMenuItem, label: 'Data & backups', IconComponent: CareHubDataIcon }]\n        : []),\n", 1),
    ("  }, [showBilling, t, carehubIsAdmin]);\n",
     "  }, [showBilling, t, carehubIsAdmin, carehubAccess.roles, carehubAccess.automations, carehubAccess.data]);\n", 1),
])

EDITS.setdefault("src/components/app/settings/Settings.tsx", []).extend([
    ("import { CAREHUB_ACCOUNTS_ITEM, CareHubAccountsPanel, useCarehubIsAdmin } from '@/components/carehub/CareHubAccounts';\n",
     "import { CAREHUB_ACCOUNTS_ITEM, CareHubAccountsPanel, useCarehubIsAdmin } from '@/components/carehub/CareHubAccounts';\n"
     "import {\n  CAREHUB_AUTOMATIONS_ITEM,\n  CAREHUB_DATA_ITEM,\n  CAREHUB_ROLES_ITEM,\n  CareHubAutomationsPanel,\n"
     "  CareHubDataPanel,\n  CareHubRolesPanel,\n} from '@/components/carehub/CareHubAdmin';\n", 1),
    ("          <CareHubAccountsPanel myEmail={currentUser?.email} />\n        )}\n",
     "          <CareHubAccountsPanel myEmail={currentUser?.email} />\n        )}\n"
     "        {open && (selectedItem as string) === CAREHUB_ROLES_ITEM && <CareHubRolesPanel />}\n"
     "        {open && (selectedItem as string) === CAREHUB_AUTOMATIONS_ITEM && <CareHubAutomationsPanel />}\n"
     "        {open && (selectedItem as string) === CAREHUB_DATA_ITEM && <CareHubDataPanel />}\n", 1),
])



# ---------------------------------------------------------------------------
# CareHub: new accounts choose their own password at first sign-in.
# ---------------------------------------------------------------------------
EXTRA_FILES[HERE / "web" / "CareHubPasswordGate.tsx"] = "src/components/carehub/CareHubPasswordGate.tsx"

EDITS.setdefault("src/components/app/AppRouter.tsx", []).extend([
    ("import CareHubBackground from '@/components/carehub/CareHubBackground';\n",
     "import CareHubBackground from '@/components/carehub/CareHubBackground';\n"
     "import CareHubPasswordGate from '@/components/carehub/CareHubPasswordGate';\n", 1),
    ("    <CareHubBackground />\n", "    <CareHubBackground />\n    <CareHubPasswordGate />\n", 1),
])

# CareHub: Google Calendar through a Google Apps Script (no Google Cloud console).
EXTRA_FILES[HERE / "web" / "CareHubGoogleScript.tsx"] = "src/components/carehub/CareHubGoogleScript.tsx"

# ---------------------------------------------------------------------------
# CareHub Learning: courses (Studio), the course player, My learning + Catalog, Reports + CSV export.
# ---------------------------------------------------------------------------
for _name in [
    "CareHubLearningApi.ts", "CareHubLearning.tsx", "CareHubLearningBlocks.tsx", "CareHubLearningPlayer.tsx",
    "CareHubLearningStudio.tsx", "CareHubLearningStudioBlocks.tsx", "CareHubLearningExample.ts",
    "CareHubLearningReports.tsx",
    "CareHubLearningInteract.tsx",
    "CareHubLearningBlocks3.tsx",
]:
    EXTRA_FILES[HERE / "web" / _name] = "src/components/carehub/" + _name
EXTRA_FILES[HERE / "web" / "CareHubLearningPaste.tsx"] = "src/components/carehub/CareHubLearningPaste.tsx"

EDITS.setdefault("src/components/app/AppRouter.tsx", []).extend([
    ("import CareHubAnalyticsPage from '@/components/carehub/CareHubAnalytics';\n",
     "import CareHubAnalyticsPage from '@/components/carehub/CareHubAnalytics';\n"
     "import CareHubLearningPage from '@/components/carehub/CareHubLearning';\n", 1),
    ("        <Route path={'analytics'} element={<CareHubAnalyticsPage />} />\n",
     "        <Route path={'analytics'} element={<CareHubAnalyticsPage />} />\n"
     "        <Route path={'learning/*'} element={<CareHubLearningPage />} />\n", 1),
])

EDITS.setdefault("src/components/app/header/AppHeader.tsx", []).extend([
    ("|| window.location.pathname === '/app/analytics';\n",
     "|| window.location.pathname === '/app/analytics' || window.location.pathname.startsWith('/app/learning');\n", 1),
])

# ---------------------------------------------------------------------------
# CareHub Learning: assign courses (people, groups, roles), due dates in My learning, certificates.
# ---------------------------------------------------------------------------
for _name in ["CareHubLearningAssignApi.ts", "CareHubLearningAssign.tsx", "CareHubLearningCertificate.tsx"]:
    EXTRA_FILES[HERE / "web" / _name] = "src/components/carehub/" + _name
EXTRA_FILES[HERE / "web" / "CareHubLearningPlayer3.tsx"] = "src/components/carehub/CareHubLearningPlayer3.tsx"
EXTRA_FILES[HERE / "web" / "CareHubLearningOverview.tsx"] = "src/components/carehub/CareHubLearningOverview.tsx"  # Reports → Overview tab
EXTRA_FILES[HERE / "web" / "CareHubLearningTemplates.tsx"] = "src/components/carehub/CareHubLearningTemplates.tsx"  # Studio → block templates
EXTRA_FILES[HERE / "web" / "CareHubLearningDrafts.tsx"] = "src/components/carehub/CareHubLearningDrafts.tsx"  # review links + draft comments
EXTRA_FILES[HERE / "web" / "CareHubLearningHistory.tsx"] = "src/components/carehub/CareHubLearningHistory.tsx"  # Studio undo / redo
EXTRA_FILES[HERE / "web" / "CareHubLearningQbank.tsx"] = "src/components/carehub/CareHubLearningQbank.tsx"  # surveys, question banks, drag matching
EXTRA_FILES[HERE / "web" / "CareHubLearningBranching.tsx"] = "src/components/carehub/CareHubLearningBranching.tsx"  # side lessons + "After this lesson"
EXTRA_FILES[HERE / "web" / "CareHubLearningBlocks4.tsx"] = "src/components/carehub/CareHubLearningBlocks4.tsx"  # two columns, code, quote carousel, divider / quote / image looks
EXTRA_FILES[HERE / "web" / "CareHubLearningPaths.tsx"] = "src/components/carehub/CareHubLearningPaths.tsx"  # learning paths (paths3)
EXTRA_FILES[HERE / "web" / "CareHubLearningA11y.tsx"] = "src/components/carehub/CareHubLearningA11y.tsx"  # keyboard + screen reader helpers

if __name__ == "__main__":
    sys.exit(main())

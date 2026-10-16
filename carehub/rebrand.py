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
    if failed:
        return 1
    print("CareHub rebrand: done")
    return 0


if __name__ == "__main__":
    sys.exit(main())

// Care Hub: "Export → PDF" without a server export service.
// Only the open page is printed (sidebar, top bar and menus are hidden while
// printing) and the browser's print dialog opens, where "Save as PDF" creates
// the file. The page keeps its normal look because nothing is copied.

const STYLE_ID = 'carehub-print-style';

const PRINT_CSS = `
@media print {
  @page { margin: 14mm; }
  .carehub-print-hide { display: none !important; }
  html, body, .carehub-print-path {
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    overflow: visible !important;
    transform: none !important;
    position: static !important;
    width: 100% !important;
    margin: 0 !important;
    left: auto !important;
  }
  html, body { background: #fff !important; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .carehub-print-path [contenteditable] { caret-color: transparent; }
  .carehub-print-path [data-testid="block-handle"], .carehub-print-path .block-handle { display: none !important; }
}
`;

function isVisible(el: HTMLElement) {
  const rect = el.getBoundingClientRect();

  return rect.width > 0 && rect.height > 0;
}

function findPageElement(): HTMLElement | null {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] .appflowy-scroll-container'));
  const all = Array.from(document.querySelectorAll<HTMLElement>('.appflowy-scroll-container'));
  // A page opened as a pop-up wins over the page behind it.
  const candidates = (dialogs.length ? dialogs : all).filter(isVisible);
  const area = (el: HTMLElement) => el.clientWidth * el.clientHeight;

  return candidates.sort((a, b) => area(b) - area(a))[0] || document.querySelector<HTMLElement>('main');
}

function isTopBar(el: HTMLElement) {
  const style = getComputedStyle(el);
  const height = el.getBoundingClientRect().height;

  return height > 0 && height <= 72 && (style.backdropFilter.includes('blur') || style.position === 'sticky');
}

export async function carehubPrintPage(title: string): Promise<void> {
  const target = findPageElement();

  if (!target) throw new Error('Open a page first, then try again.');

  const marked: Array<[HTMLElement, string]> = [];
  const mark = (el: HTMLElement, cls: string) => {
    el.classList.add(cls);
    marked.push([el, cls]);
  };

  // Keep only the path from <body> down to the page; hide everything beside it.
  let node: HTMLElement | null = target;

  while (node && node !== document.body) {
    mark(node, 'carehub-print-path');
    const parent: HTMLElement | null = node.parentElement;

    if (parent) {
      Array.from(parent.children).forEach((sibling) => {
        if (sibling !== node && sibling instanceof HTMLElement) mark(sibling, 'carehub-print-hide');
      });
    }

    node = parent;
  }

  // The page's own top bar (breadcrumbs, Share, …) is not part of the page.
  Array.from(target.children).forEach((child) => {
    if (child instanceof HTMLElement && isTopBar(child)) mark(child, 'carehub-print-hide');
  });

  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;

  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = PRINT_CSS;
    document.head.appendChild(style);
  }

  const previousTitle = document.title;

  // The title becomes the suggested file name in "Save as PDF".
  document.title = title || 'Care Hub page';

  await new Promise((r) => setTimeout(r, 200));

  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener('afterprint', finish);
      marked.forEach(([el, cls]) => el.classList.remove(cls));
      document.title = previousTitle;
      resolve();
    };

    window.addEventListener('afterprint', finish);
    window.print();
    // Some browsers do not report when the dialog closes; clean up anyway.
    setTimeout(finish, 120000);
  });
}

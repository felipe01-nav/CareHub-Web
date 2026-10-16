// Care Hub: "Export → PDF" without a server export service.
// The open page is copied into a hidden frame (with the app's styles) and the
// browser's print dialog opens, where "Save as PDF" creates the file.

function findPageElement(): HTMLElement | null {
  const containers = Array.from(document.querySelectorAll<HTMLElement>('.appflowy-scroll-container'));
  const withEditor = containers.filter((el) => el.querySelector('[data-slate-editor], [role="textbox"], .grid-table, [data-testid]'));
  const pick = (list: HTMLElement[]) =>
    list.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] || null;

  return pick(withEditor) || pick(containers) || document.querySelector<HTMLElement>('main');
}

const PRINT_CSS = `
@page { margin: 14mm; }
html, body { height: auto !important; min-height: 0 !important; overflow: visible !important; background: #fff !important; }
body { margin: 0; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.carehub-print-root, .carehub-print-root * { overflow: visible !important; max-height: none !important; }
.carehub-print-root { width: 100%; }
.carehub-print-root [contenteditable] { caret-color: transparent; outline: none !important; }
.carehub-print-root button[data-testid*="add"], .carehub-print-root .block-handle,
.carehub-print-root [data-testid="block-handle"], .carehub-print-root [data-testid="drag-block"] { display: none !important; }
`;

export async function carehubPrintPage(title: string): Promise<void> {
  const source = findPageElement();

  if (!source) throw new Error('Open a page first, then try again.');

  const frame = document.createElement('iframe');

  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1024px;height:0;border:0;visibility:hidden;';
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  const win = frame.contentWindow;

  if (!doc || !win) {
    frame.remove();
    throw new Error('Printing is not available in this browser.');
  }

  doc.open();
  doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
  doc.close();
  doc.title = title || 'Care Hub page';
  doc.documentElement.className = document.documentElement.className.replace(/\bdark\b/g, '');
  doc.documentElement.setAttribute('data-dark-mode', 'false');
  doc.body.className = document.body.className;

  const loads: Promise<void>[] = [];

  document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
    const copy = doc.importNode(node, true) as HTMLElement;

    if (copy instanceof HTMLLinkElement || copy.tagName === 'LINK') {
      const link = copy as HTMLLinkElement;

      link.href = (node as HTMLLinkElement).href;
      loads.push(
        new Promise((resolve) => {
          link.onload = () => resolve();
          link.onerror = () => resolve();
        })
      );
    }

    doc.head.appendChild(copy);
  });

  const extra = doc.createElement('style');

  extra.textContent = PRINT_CSS;
  doc.head.appendChild(extra);

  const root = doc.createElement('div');

  root.className = 'carehub-print-root';
  root.innerHTML = source.innerHTML;
  root.querySelectorAll('[contenteditable]').forEach((el) => el.setAttribute('contenteditable', 'false'));
  doc.body.appendChild(root);

  await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 3000))]);
  await new Promise((r) => setTimeout(r, 300));

  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setTimeout(() => frame.remove(), 1000);
      resolve();
    };

    win.addEventListener('afterprint', finish);
    win.focus();
    win.print();
    // Safari does not wait for the dialog; clean up later either way.
    setTimeout(finish, 60000);
  });
}

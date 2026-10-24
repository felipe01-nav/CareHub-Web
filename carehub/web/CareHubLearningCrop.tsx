// CareHub Learning Studio: crop an uploaded picture. "Crop" sits next to Replace / Remove in the Studio's picture field
// (MediaField). The dialog shows the picture with a box on it: drag the box to move it, drag a corner to resize it
// (mouse, pen or finger), or use the arrow keys (Shift + arrow keys resize). Shapes: Free, Square, 16:9 and 4:3.
// "Save crop" draws the box on a canvas and uploads it as a new file (PNG stays PNG, other pictures become JPEG; the
// longest side is at most 2400 px). The field then uses the new file; the old one stays in storage, so Undo works.
// Only Care Hub files can be cropped (the browser can't read pictures linked from other websites), and GIFs (they may
// move) and drawings (SVG) aren't cropped.
import { useEffect, useId, useRef, useState } from 'react';

import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { ProgressBar, useFileSrc } from './CareHubLearningBlocks';
import { CareHubModal, ChNote } from './CareHubUi';

/** Longest side of a saved crop, in pixels. */
export const CROP_MAX_SIDE = 2400;

/** Sends the cropped file and puts its address in the field. Throws an Error with a message people can read. */
export type CropUpload = (file: File, onProgress: (percent: number) => void, signal: AbortSignal) => Promise<void>;

export type PictureType = 'png' | 'jpeg' | 'webp' | 'avif' | 'gif' | 'other';

const CROPPABLE: PictureType[] = ['png', 'jpeg', 'webp', 'avif'];

/** What a picture file really is, from its first bytes (the stored type can be missing or wrong). */
export async function pictureType(blob: Blob): Promise<PictureType> {
  const b = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const has = (at: number, text: string) => [...text].every((ch, i) => b[at + i] === ch.charCodeAt(0));

  if (b[0] === 0x89 && has(1, 'PNG')) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (has(0, 'GIF8')) return 'gif';
  if (has(0, 'RIFF') && has(8, 'WEBP')) return 'webp';
  if (has(4, 'ftyp') && (has(8, 'avif') || has(8, 'avis'))) return 'avif';
  return 'other';
}

// ---------------------------------------------------------------------------
// The box, in the picture's own pixels
// ---------------------------------------------------------------------------

export type CropBox = { x: number; y: number; w: number; h: number };
export type CropSize = { w: number; h: number };
export type CropShape = 'free' | 'square' | 'wide' | 'standard';
type Corner = 'nw' | 'ne' | 'sw' | 'se';

const SHAPES: { id: CropShape; label: string; ratio: number }[] = [
  { id: 'free', label: 'Free', ratio: 0 },
  { id: 'square', label: 'Square', ratio: 1 },
  { id: 'wide', label: '16:9', ratio: 16 / 9 },
  { id: 'standard', label: '4:3', ratio: 4 / 3 },
];

export const shapeRatio = (shape: CropShape) => SHAPES.find((s) => s.id === shape)?.ratio || 0;

const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The smallest side a box can have, so it stays easy to grab: 5% of the picture, at least 20 px. */
export function minSide(size: CropSize) {
  return Math.min(size.w, size.h, Math.max(20, Math.round(Math.max(size.w, size.h) * 0.05)));
}

/** How wide a box of this shape can be (its height is the width ÷ ratio). */
function widthRange(size: CropSize, ratio: number, roomW = size.w, roomH = size.h) {
  const m = minSide(size);
  const max = Math.min(roomW, roomH * ratio);

  return { min: Math.min(max, Math.max(m, m * ratio)), max };
}

/** Keeps the box inside the picture (moving it, not resizing it). */
export function placeBox(size: CropSize, b: CropBox): CropBox {
  const w = Math.min(b.w, size.w);
  const h = Math.min(b.h, size.h);

  return { x: clamp(b.x, 0, size.w - w), y: clamp(b.y, 0, size.h - h), w, h };
}

/** Where the box starts (and goes back to on Reset): 80% of the picture, in the middle. */
export function startBox(size: CropSize, ratio: number): CropBox {
  let w = size.w * 0.8;
  let h = size.h * 0.8;

  if (ratio) {
    const r = widthRange(size, ratio);

    w = clamp(Math.min(w, h * ratio), r.min, r.max);
    h = w / ratio;
  }
  return placeBox(size, { x: (size.w - w) / 2, y: (size.h - h) / 2, w, h });
}

/** A new shape: about the same area, around the same middle. Free keeps the box as it is. */
export function reshapeBox(size: CropSize, ratio: number, b: CropBox): CropBox {
  if (!ratio) return b;
  const r = widthRange(size, ratio);
  const w = clamp(Math.sqrt(b.w * b.h * ratio), r.min, r.max);
  const h = w / ratio;

  return placeBox(size, { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h });
}

/** Dragging a corner to (px, py): the opposite corner stays put. With a shape, the box follows the longer pull. */
export function dragCorner(size: CropSize, ratio: number, start: CropBox, corner: Corner, px: number, py: number): CropBox {
  const sx = corner === 'ne' || corner === 'se' ? 1 : -1;
  const sy = corner === 'sw' || corner === 'se' ? 1 : -1;
  const ax = sx > 0 ? start.x : start.x + start.w;
  const ay = sy > 0 ? start.y : start.y + start.h;
  const roomW = sx > 0 ? size.w - ax : ax;
  const roomH = sy > 0 ? size.h - ay : ay;
  let w = (clamp(px, 0, size.w) - ax) * sx;
  let h = (clamp(py, 0, size.h) - ay) * sy;

  if (ratio) {
    const r = widthRange(size, ratio, roomW, roomH);

    w = clamp(Math.max(w, h * ratio), r.min, r.max);
    h = w / ratio;
  } else {
    const m = minSide(size);

    w = clamp(w, Math.min(m, roomW), roomW);
    h = clamp(h, Math.min(m, roomH), roomH);
  }
  return { x: sx > 0 ? ax : ax - w, y: sy > 0 ? ay : ay - h, w, h };
}

/** Shift + arrow keys: wider / narrower or taller / shorter, from the top-left corner (moving back at an edge). */
export function growBox(size: CropSize, ratio: number, b: CropBox, dw: number, dh: number): CropBox {
  let w = b.w + dw;
  let h = b.h + dh;

  if (ratio) {
    const r = widthRange(size, ratio);

    w = clamp(dw ? w : h * ratio, r.min, r.max);
    h = w / ratio;
  } else {
    const m = minSide(size);

    w = clamp(w, m, size.w);
    h = clamp(h, m, size.h);
  }
  return placeBox(size, { x: b.x, y: b.y, w, h });
}

/** The crop in whole pixels, inside the picture. */
export function cropPixels(size: CropSize, b: CropBox) {
  const x = clamp(Math.round(b.x), 0, size.w - 1);
  const y = clamp(Math.round(b.y), 0, size.h - 1);

  return { x, y, w: clamp(Math.round(b.w), 1, size.w - x), h: clamp(Math.round(b.h), 1, size.h - y) };
}

/** The saved picture's size: the crop, made smaller if its longest side is over 2400 px. */
export function savedSize(w: number, h: number) {
  const k = Math.min(1, CROP_MAX_SIDE / Math.max(w, h));

  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** "Till photo.jpg" → "Till photo-cropped.jpg" (cropping again doesn't add another "-cropped"). */
export function croppedName(name: string, png: boolean) {
  const base =
    name
      .trim()
      .replace(/\.[a-z0-9]{1,5}$/i, '')
      .replace(/-cropped$/i, '')
      .trim() || 'picture';

  return `${[...base].slice(0, 80).join('')}-cropped.${png ? 'png' : 'jpg'}`;
}

async function drawCrop(img: HTMLImageElement, size: CropSize, b: CropBox, png: boolean) {
  const c = cropPixels(size, b);
  const out = savedSize(c.w, c.h);
  const canvas = document.createElement('canvas');

  canvas.width = out.w;
  canvas.height = out.h;
  const ctx = canvas.getContext('2d');

  if (!ctx) throw new Error('This browser couldn’t make the cropped picture.');
  if (!png) {
    // JPEG has no see-through parts: white behind them, like on a page.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.w, out.h);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, c.x, c.y, c.w, c.h, 0, 0, out.w, out.h);
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, png ? 'image/png' : 'image/jpeg', 0.9));

  if (!blob) throw new Error('This browser couldn’t make the cropped picture.');
  return blob;
}

// ---------------------------------------------------------------------------
// Styles (plain CSS: the box and its shade sit on top of the picture, the same in light and dark mode)
// ---------------------------------------------------------------------------

const CROP_CSS = `
.chl-crop-frame{position:relative;margin:12px auto;width:fit-content;max-width:100%;user-select:none;-webkit-user-select:none}
.chl-crop-clip{position:relative;overflow:hidden;border-radius:4px;background:repeating-conic-gradient(#d4d4d4 0 25%,#f5f5f5 0 50%) 0 0/16px 16px}
.chl-crop-clip img{display:block;max-width:100%;max-height:min(55vh,560px);pointer-events:none;-webkit-user-drag:none}
.chl-crop-shade{position:absolute;box-shadow:0 0 0 9999px rgba(0,0,0,.55);pointer-events:none}
.chl-crop-box{position:absolute;cursor:move;touch-action:none;outline:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.6),inset 0 0 0 1px rgba(0,0,0,.35)}
.chl-crop-box:focus-visible{outline:3px solid #60a5fa;outline-offset:1px}
.chl-crop-box::before,.chl-crop-box::after{content:'';position:absolute;pointer-events:none;border:0 solid rgba(255,255,255,.55)}
.chl-crop-box::before{left:33.33%;right:33.33%;top:0;bottom:0;border-left-width:1px;border-right-width:1px}
.chl-crop-box::after{top:33.33%;bottom:33.33%;left:0;right:0;border-top-width:1px;border-bottom-width:1px}
.chl-crop-handle{position:absolute;width:32px;height:32px;margin:-16px 0 0 -16px;touch-action:none;z-index:1}
.chl-crop-handle::after{content:'';position:absolute;left:9px;top:9px;width:14px;height:14px;border-radius:3px;background:#fff;border:2px solid #2563eb;box-sizing:border-box}
.chl-crop-nw,.chl-crop-se{cursor:nwse-resize}
.chl-crop-ne,.chl-crop-sw{cursor:nesw-resize}
@media (pointer:coarse){.chl-crop-handle{width:44px;height:44px;margin:-22px 0 0 -22px}.chl-crop-handle::after{left:12px;top:12px;width:20px;height:20px}.chl-crop-frame{margin:20px auto}}
`;

// ---------------------------------------------------------------------------
// "Crop" button (in the picture field) and the dialog
// ---------------------------------------------------------------------------

type Got = { from: Blob | string; blob: Blob | null; type: PictureType };

/**
 * "Crop" for a picture uploaded to Care Hub. `file` is the picture itself when the field has just sent it (no need to
 * download it again). Hidden once the picture turns out to be a GIF or not a picture the browser can crop.
 */
export function CropButton({
  url,
  file,
  name,
  note,
  noun = 'picture',
  upload,
}: {
  url: string;
  file?: Blob | null;
  /** The file name, for the new file's name ("Till photo-cropped.jpg"). */
  name?: string;
  /** Shown in the dialog (e.g. that spots placed on the picture don't move). */
  note?: string;
  noun?: string;
  upload: CropUpload;
}) {
  // The same download the field's thumbnail uses (shared, so nothing is fetched twice).
  const pic = useFileSrc(file ? '' : url);
  const [got, setGot] = useState<Got | null>(null);
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState('');
  const from: Blob | string = file || (pic.state === 'ready' && pic.src.startsWith('blob:') ? pic.src : '');

  useEffect(() => {
    if (!from) return undefined;
    let live = true;

    (async () => {
      try {
        const blob = typeof from === 'string' ? await (await fetch(from)).blob() : from;
        const type = await pictureType(blob);

        if (live) setGot({ from, blob, type });
      } catch {
        if (live) setGot({ from, blob: null, type: 'other' });
      }
    })();
    return () => {
      live = false;
    };
  }, [from]);

  const mine = got && from && got.from === from ? got : null;
  // Downloading with the sign-in token didn't work (the shared download fell back to the plain address).
  const failed = Boolean(!file && pic.state === 'ready' && pic.src && !pic.src.startsWith('blob:')) || Boolean(mine && !mine.blob);

  if (mine?.blob && !CROPPABLE.includes(mine.type) && !open) return null;
  return (
    <>
      <button
        type='button'
        aria-label={`Crop the ${noun}`}
        aria-haspopup='dialog'
        onClick={() => {
          setSaid('');
          setOpen(true);
        }}
        className='shrink-0 rounded-[8px] border border-border-primary px-2.5 py-1.5 text-sm font-medium hover:bg-fill-content-hover'
        data-testid='chl-crop-button'
      >
        Crop
      </button>
      <span role='status' className='sr-only'>
        {said}
      </span>
      {open && (
        <CropDialog
          blob={mine?.blob || null}
          type={mine?.type || 'other'}
          failed={failed}
          percent={pic.percent}
          name={name || ''}
          note={note}
          upload={upload}
          onRetry={() => {
            setGot(null);
            pic.retry();
          }}
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            setSaid(`${noun[0].toUpperCase()}${noun.slice(1)} cropped.`);
          }}
        />
      )}
    </>
  );
}

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

function CropDialog({
  blob,
  type,
  failed,
  percent,
  name,
  note,
  upload,
  onRetry,
  onClose,
  onDone,
}: {
  blob: Blob | null;
  type: PictureType;
  failed: boolean;
  percent: number;
  name: string;
  note?: string;
  upload: CropUpload;
  onRetry: () => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const id = useId();
  // The picture this dialog opened with (the field gets a new one when saving; this one stays on screen).
  const [held, setHeld] = useState<{ blob: Blob; type: PictureType } | null>(blob ? { blob, type } : null);
  const [src, setSrc] = useState('');
  const [size, setSize] = useState<CropSize | null>(null);
  const [broken, setBroken] = useState(false);
  const [box, setBox] = useState<CropBox | null>(null);
  const [shape, setShape] = useState<CropShape>('free');
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [said, setSaid] = useState('');
  const imgRef = useRef<HTMLImageElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ pointer: number; corner: Corner | null; start: CropBox; px: number; py: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const sayTimer = useRef(0);
  const ratio = shapeRatio(shape);
  const can = !held || CROPPABLE.includes(held.type);

  useEffect(() => {
    if (!held && blob) setHeld({ blob, type });
  }, [held, blob, type]);

  useEffect(() => {
    if (!held || !CROPPABLE.includes(held.type)) return undefined;
    const u = URL.createObjectURL(held.blob);

    setSrc(u);
    return () => URL.revokeObjectURL(u);
  }, [held]);

  useEffect(
    () => () => {
      abort.current?.abort();
      window.clearTimeout(sayTimer.current);
    },
    []
  );

  const say = (b: CropBox) => {
    window.clearTimeout(sayTimer.current);
    sayTimer.current = window.setTimeout(() => {
      if (!size) return;
      const c = cropPixels(size, b);

      setSaid(`Crop area ${c.w} by ${c.h} pixels, ${c.x} from the left and ${c.y} from the top.`);
    }, 450);
  };

  const pointAt = (e: ReactPointerEvent) => {
    const r = imgRef.current?.getBoundingClientRect();

    if (!r || !size || !r.width || !r.height) return null;
    return { x: ((e.clientX - r.left) / r.width) * size.w, y: ((e.clientY - r.top) / r.height) * size.h };
  };

  const startDrag = (corner: Corner | null) => (e: ReactPointerEvent<HTMLElement>) => {
    if (!box || saving !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const p = pointAt(e);

    if (!p) return;
    e.preventDefault();
    e.stopPropagation();
    drag.current = { pointer: e.pointerId, corner, start: box, px: p.x, py: p.y };
    try {
      boxRef.current?.setPointerCapture?.(e.pointerId);
    } catch {
      // The pointer is already gone (a very quick tap): nothing to follow.
    }
    boxRef.current?.focus({ preventScroll: true });
  };

  const onMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;

    if (!d || d.pointer !== e.pointerId || !size) return;
    const p = pointAt(e);

    if (!p) return;
    e.preventDefault();
    const dx = p.x - d.px;
    const dy = p.y - d.py;

    if (!d.corner) {
      setBox(placeBox(size, { ...d.start, x: d.start.x + dx, y: d.start.y + dy }));
      return;
    }
    // Where the grabbed corner would be now (the grab point can be a little off the corner).
    const cx = (d.corner === 'ne' || d.corner === 'se' ? d.start.x + d.start.w : d.start.x) + dx;
    const cy = (d.corner === 'sw' || d.corner === 'se' ? d.start.y + d.start.h : d.start.y) + dy;

    setBox(dragCorner(size, ratio, d.start, d.corner, cx, cy));
  };

  const endDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.pointer !== e.pointerId) return;
    drag.current = null;
    if (boxRef.current?.hasPointerCapture?.(e.pointerId)) boxRef.current.releasePointerCapture(e.pointerId);
  };

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const dir = ARROWS[e.key];

    if (!dir || !size || !box || saving !== null || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    const step = Math.max(1, Math.round(Math.max(size.w, size.h) / 100));
    const next = e.shiftKey
      ? growBox(size, ratio, box, dir[0] * step, dir[1] * step)
      : placeBox(size, { ...box, x: box.x + dir[0] * step, y: box.y + dir[1] * step });

    setBox(next);
    say(next);
  };

  const pickShape = (s: CropShape) => {
    setShape(s);
    if (size && box) {
      const next = reshapeBox(size, shapeRatio(s), box);

      setBox(next);
      say(next);
    }
  };

  const reset = () => {
    if (!size) return;
    const next = startBox(size, ratio);

    setBox(next);
    say(next);
  };

  const save = async () => {
    const img = imgRef.current;

    if (!img || !size || !box || !held || saving !== null) return;
    const ctrl = new AbortController();

    abort.current = ctrl;
    setError('');
    setSaving(0);
    try {
      const png = held.type === 'png';
      const made = await drawCrop(img, size, box, png);
      const file = new File([made], croppedName(name, png), { type: png ? 'image/png' : 'image/jpeg' });

      if (ctrl.signal.aborted) return;
      await upload(file, (p) => setSaving((now) => (now === null || now === p ? now : p)), ctrl.signal);
      if (!ctrl.signal.aborted) onDone();
    } catch (err) {
      if (!ctrl.signal.aborted) setError(err instanceof Error && err.message ? err.message : 'Couldn’t save the crop. Please try again.');
    } finally {
      if (abort.current === ctrl) {
        abort.current = null;
        setSaving(null);
      }
    }
  };

  const ready = Boolean(src && size && box && !broken);
  const c = size && box ? cropPixels(size, box) : null;
  const out = c ? savedSize(c.w, c.h) : null;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const pos = size && box ? { left: pct(box.x, size.w), top: pct(box.y, size.h), width: pct(box.w, size.w), height: pct(box.h, size.h) } : undefined;

  let body;

  if (!can) {
    body = (
      <ChNote>
        {held?.type === 'gif'
          ? 'GIF pictures can move, so they can’t be cropped here. Crop it in another app, then use Replace to upload it.'
          : 'This file can’t be cropped here. Crop it in another app, then use Replace to upload it.'}
      </ChNote>
    );
  } else if (broken || (!held && failed)) {
    body = (
      <div className='flex flex-col items-start gap-2'>
        <ChNote tone='error'>Couldn’t open the picture. Check your connection and try again.</ChNote>
        {!held && (
          <Button type='button' size='sm' variant='outline' onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    );
  } else {
    body = (
      <div className='flex flex-col gap-3'>
        {note && <ChNote>{note}</ChNote>}
        {!src ? (
          <div role='status' className='flex flex-col items-center gap-2 rounded-[10px] bg-fill-content-hover px-4 py-8 text-sm text-text-tertiary'>
            <span>Opening the picture…{percent > 0 ? ` ${percent}%` : ''}</span>
            {percent > 0 && <ProgressBar percent={percent} className='max-w-[220px]' label='Opening the picture' />}
          </div>
        ) : (
          <div className='chl-crop-frame'>
            <div className='chl-crop-clip'>
              <img
                ref={imgRef}
                src={src}
                alt='The picture to crop'
                draggable={false}
                onLoad={(e) => {
                  const img = e.currentTarget;

                  if (!img.naturalWidth || !img.naturalHeight) {
                    setBroken(true);
                    return;
                  }
                  const s = { w: img.naturalWidth, h: img.naturalHeight };

                  setSize(s);
                  setBox((b) => b || startBox(s, ratio));
                }}
                onError={() => setBroken(true)}
              />
              {pos && <div className='chl-crop-shade' style={pos} />}
            </div>
            {pos && (
              <div
                ref={boxRef}
                role='application'
                aria-label='Crop area'
                aria-describedby={`${id}-how ${id}-size`}
                tabIndex={0}
                className='chl-crop-box'
                style={pos}
                onPointerDown={startDrag(null)}
                onPointerMove={onMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onLostPointerCapture={() => {
                  drag.current = null;
                }}
                onKeyDown={onKey}
                data-testid='chl-crop-box'
              >
                {CORNERS.map((k) => (
                  <span
                    key={k}
                    aria-hidden='true'
                    className={cn('chl-crop-handle', `chl-crop-${k}`)}
                    style={{ left: k === 'ne' || k === 'se' ? '100%' : '0%', top: k === 'sw' || k === 'se' ? '100%' : '0%' }}
                    onPointerDown={startDrag(k)}
                    data-corner={k}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        {ready && c && out && (
          <>
            <div id={`${id}-size`} className='text-center text-xs tabular-nums text-text-secondary' data-testid='chl-crop-size'>
              Crop: {c.w} × {c.h} px
              {out.w !== c.w || out.h !== c.h ? ` · saved at ${out.w} × ${out.h} px` : ''}
            </div>
            <div className='flex flex-wrap items-center gap-2'>
              <div role='group' aria-label='Shape' className='flex flex-wrap gap-1.5'>
                {SHAPES.map((s) => (
                  <button
                    key={s.id}
                    type='button'
                    aria-pressed={shape === s.id}
                    onClick={() => pickShape(s.id)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-sm',
                      shape === s.id
                        ? 'border-border-theme-thick bg-fill-content-hover font-medium text-text-primary'
                        : 'border-border-primary text-text-secondary hover:bg-fill-content-hover'
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <Button type='button' size='sm' variant='ghost' onClick={reset} className='ml-auto'>
                Reset
              </Button>
            </div>
            <p id={`${id}-how`} className='m-0 text-xs text-text-tertiary'>
              Drag the box to move it, or drag a corner to resize it. With a keyboard: arrow keys move the box, Shift + arrow keys
              resize it.
            </p>
            <span role='status' className='sr-only'>
              {said}
            </span>
          </>
        )}
        {saving !== null && (
          <div role='status' className='flex flex-col gap-1.5 text-sm'>
            <span>Saving the cropped picture… {saving}%</span>
            <ProgressBar percent={saving} label='Saving the cropped picture' />
          </div>
        )}
        {error && <ChNote tone='error'>{error}</ChNote>}
      </div>
    );
  }

  return (
    <CareHubModal
      title='Crop picture'
      wide
      onClose={onClose}
      testId='chl-crop-dialog'
      footer={
        can ? (
          <>
            <Button type='button' variant='ghost' onClick={onClose}>
              Cancel
            </Button>
            <Button type='button' disabled={!ready || saving !== null} onClick={() => void save()}>
              {saving !== null ? 'Saving…' : 'Save crop'}
            </Button>
          </>
        ) : (
          <Button type='button' variant='outline' onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      <style data-carehub-learning-crop=''>{CROP_CSS}</style>
      {body}
    </CareHubModal>
  );
}

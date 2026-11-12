/**
 * Phones that turn a little toward the cursor (round 5, 12 Nov 2026).
 *
 * Mark an element with `data-tilt` (optionally `data-tilt-radius`, in px, and
 * `data-tilt-max`, in degrees) and call initTilt(), or call attachTilt()
 * directly. When the pointer comes within `radius` of the element's box, the
 * element rotates up to `maxDeg` toward it in 3D, eased, and settles back when
 * the pointer leaves. Put it on a wrapper when the element already has a
 * transform of its own: this one owns the transform it is given.
 *
 * One pointermove listener serves every element, and one requestAnimationFrame
 * loop runs only while something is near or still settling. Only on a mouse or
 * trackpad, and never with reduced motion.
 */

export interface TiltOptions { radius?: number; maxDeg?: number; }

interface Item {
  el: HTMLElement; radius: number; max: number;
  rx: number; ry: number; tx: number; ty: number;
  rect: DOMRect | null;
}

const items: Item[] = [];
const seen = new WeakSet<HTMLElement>();
let px = -1e6, py = -1e6;
let raf = 0, last = 0, listening = false, rectsStale = true, measuredAt = 0;

const can = () =>
  typeof window !== 'undefined' &&
  matchMedia('(hover: hover) and (pointer: fine)').matches &&
  !matchMedia('(prefers-reduced-motion: reduce)').matches;

/** How far the pointer is from a box, 0 when inside it. */
const gap = (r: DOMRect, x: number, y: number) =>
  Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));

function measure() {
  // Also every half second: a section revealing on scroll moves its boxes.
  const now = performance.now();
  if (!rectsStale && now - measuredAt < 500) return;
  rectsStale = false; measuredAt = now;
  for (const it of items) it.rect = it.el.isConnected ? it.el.getBoundingClientRect() : null;
}

/** Sets each element's target from the pointer; true if any is near. */
function aim() {
  measure();
  let near = false;
  for (const it of items) {
    const r = it.rect;
    if (!r || r.width === 0 || gap(r, px, py) > it.radius) { it.tx = it.ty = 0; continue; }
    near = true;
    // Strength fades out over the last part of the radius, so the turn
    // starts gently rather than snapping on at the edge.
    const k = 1 - Math.max(0, gap(r, px, py) - it.radius * 0.35) / (it.radius * 0.65);
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const nx = Math.max(-1, Math.min(1, (px - cx) / (r.width / 2 + it.radius * 0.5)));
    const ny = Math.max(-1, Math.min(1, (py - cy) / (r.height / 2 + it.radius * 0.5)));
    // rotateY(+) turns the face to the right, rotateX(+) turns it up.
    it.ty = nx * it.max * k;
    it.tx = -ny * it.max * k;
  }
  return near;
}

function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
  // About 0.4 s to settle.
  const a = 1 - Math.exp(-dt / 0.11);
  let moving = false;
  for (const it of items) {
    it.rx += (it.tx - it.rx) * a;
    it.ry += (it.ty - it.ry) * a;
    const still = Math.abs(it.tx - it.rx) < 0.01 && Math.abs(it.ty - it.ry) < 0.01;
    if (still) { it.rx = it.tx; it.ry = it.ty; } else moving = true;
    if (it.rx === 0 && it.ry === 0) {
      if (it.el.style.transform) { it.el.style.transform = ''; it.el.style.willChange = ''; }
    } else {
      it.el.style.willChange = 'transform';
      it.el.style.transform = `perspective(900px) rotateX(${it.rx.toFixed(2)}deg) rotateY(${it.ry.toFixed(2)}deg)`;
    }
  }
  raf = moving ? requestAnimationFrame(frame) : 0;
}

function kick() {
  const near = aim();
  const resting = items.every((it) => it.rx === it.tx && it.ry === it.ty);
  if (!raf && (near || !resting)) { last = performance.now(); raf = requestAnimationFrame(frame); }
}

function listen() {
  if (listening) return;
  listening = true;
  addEventListener('pointermove', (e) => {
    if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
    px = e.clientX; py = e.clientY; kick();
  }, { passive: true });
  // Boxes move under a still pointer when the page scrolls or resizes.
  const stale = () => { rectsStale = true; if (items.some((it) => it.tx || it.ty)) kick(); };
  addEventListener('scroll', stale, { passive: true, capture: true });
  addEventListener('resize', stale, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { px = py = -1e6; kick(); });
}

export function attachTilt(el: HTMLElement, opts: TiltOptions = {}) {
  if (seen.has(el) || !can()) return;
  seen.add(el);
  items.push({ el, radius: opts.radius ?? 300, max: opts.maxDeg ?? 9, rx: 0, ry: 0, tx: 0, ty: 0, rect: null });
  rectsStale = true;
  listen();
}

/** Every [data-tilt] on the page; safe to call more than once. */
export function initTilt(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-tilt]').forEach((el) => {
    attachTilt(el, {
      radius: Number(el.dataset.tiltRadius) || undefined,
      maxDeg: Number(el.dataset.tiltMax) || undefined,
    });
  });
}

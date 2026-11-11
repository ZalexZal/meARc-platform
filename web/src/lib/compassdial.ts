/**
 * The model's facing as a compass dial (round 4, 12 Nov 2026).
 *
 * A round SVG with N/E/S/W and a needle. Drag it with a mouse, a pen or a
 * finger; it snaps to 5°, or 1° with Shift held. Arrow keys turn it when it
 * has focus (5°, Shift for 1°; Page keys 45°). 0 means the model's front faces
 * North, as the saved `heading_deg` always has.
 *
 * The dial only reports a number: the caller keeps the field that is saved.
 */

const NS = 'http://www.w3.org/2000/svg';

export type CompassDial = { set(deg: number): void; get(): number };

const norm = (d: number) => ((Math.round(d) % 360) + 360) % 360;

export function compassDial(
  host: HTMLElement,
  label: string,
  marks: { n: string; e: string; s: string; w: string },
  onChange: (deg: number) => void,
): CompassDial {
  let value = 0;

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('dial-svg');

  const el = (tag: string, attrs: Record<string, string | number>, parent: Element = svg) => {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    parent.append(node);
    return node;
  };

  el('circle', { cx: 60, cy: 60, r: 56, class: 'dial-face' });
  for (let d = 0; d < 360; d += 15) {
    const major = d % 90 === 0;
    const r1 = major ? 44 : d % 45 === 0 ? 47 : 50;
    const a = (d * Math.PI) / 180;
    el('line', {
      x1: 60 + Math.sin(a) * r1, y1: 60 - Math.cos(a) * r1,
      x2: 60 + Math.sin(a) * 54, y2: 60 - Math.cos(a) * 54,
      class: major ? 'dial-tick is-major' : 'dial-tick',
    });
  }
  ([[marks.n, 60, 27], [marks.e, 93, 60], [marks.s, 60, 93], [marks.w, 27, 60]] as const).forEach(([t, x, y], i) => {
    const text = el('text', { x, y, class: i === 0 ? 'dial-mark is-north' : 'dial-mark', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
    text.textContent = t;
  });
  const needle = el('g', { class: 'dial-needle' });
  // Short enough to leave the letters readable; the dot on the rim says where.
  el('path', { d: 'M60 34 L65 60 L55 60 Z', class: 'dial-front' }, needle);
  el('path', { d: 'M60 80 L65 60 L55 60 Z', class: 'dial-back' }, needle);
  el('circle', { cx: 60, cy: 9.5, r: 5, class: 'dial-front' }, needle);
  el('circle', { cx: 60, cy: 60, r: 5, class: 'dial-hub' });

  host.classList.add('dial');
  host.tabIndex = 0;
  host.setAttribute('role', 'slider');
  host.setAttribute('aria-label', label);
  host.setAttribute('aria-valuemin', '0');
  host.setAttribute('aria-valuemax', '359');
  host.append(svg);

  const paint = () => {
    needle.setAttribute('transform', `rotate(${value} 60 60)`);
    host.setAttribute('aria-valuenow', String(value));
    host.setAttribute('aria-valuetext', `${value}°`);
  };

  const commit = (deg: number) => {
    const v = norm(deg);
    if (v === value) return;
    value = v;
    paint();
    onChange(value);
  };

  const angleAt = (e: PointerEvent) => {
    const r = svg.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    return (Math.atan2(dx, -dy) * 180) / Math.PI;
  };
  const snap = (deg: number, fine: boolean) => (fine ? Math.round(deg) : Math.round(deg / 5) * 5);

  let dragging = false;
  host.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    host.setPointerCapture(e.pointerId);
    host.classList.add('is-dragging');
    host.focus({ preventScroll: true });
    commit(snap(angleAt(e), e.shiftKey));
    e.preventDefault();
  });
  host.addEventListener('pointermove', (e) => { if (dragging) commit(snap(angleAt(e), e.shiftKey)); });
  const stop = () => { dragging = false; host.classList.remove('is-dragging'); };
  host.addEventListener('pointerup', stop);
  host.addEventListener('pointercancel', stop);

  host.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 1 : 5;
    const by: Record<string, number> = {
      ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: 45, PageDown: -45,
    };
    if (e.key in by) { e.preventDefault(); commit(value + by[e.key]); }
    else if (e.key === 'Home') { e.preventDefault(); commit(0); }
  });

  paint();
  return {
    set(deg: number) { value = norm(Number(deg) || 0); paint(); },
    get: () => value,
  };
}

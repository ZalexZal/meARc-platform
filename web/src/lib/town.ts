/**
 * The night town: a made-up map seen at an angle, with its stops standing on
 * the street corners as pins and its walkers out on the streets.
 *
 * Three layers. The streets and everything that lies on them (links between
 * stops, pulses, walkers, light) are drawn flat on two canvases that CSS tilts
 * in 3D, so the browser does the perspective. The pins stand upright on a third
 * canvas, each placed where its corner of the tilted ground lands on screen, so
 * they keep their shape at any angle instead of lying down with the map.
 *
 * Made up on purpose: a real map would be one town and a megabyte of tiles.
 *
 * Used as the home page's hero, where scroll then walks it through Build, Walk
 * and Find (`story`), and behind the top of every other page.
 *
 * It stops drawing off screen and in a hidden tab. With reduced motion it does
 * not move: the camera holds still and everything is drawn finished.
 */

export interface TownStory {
  /** The tall element the stage is sticky inside. Scroll through it is the story. */
  scroller: HTMLElement;
  /** The hero's words, then Build, Walk and Find. */
  panels: HTMLElement[];
  strip?: HTMLElement | null;
  stripDist?: HTMLElement | null;
  /** The phone held up at the stop. */
  finder?: HTMLElement | null;
  /** "You're here", in the page's language. */
  here: string;
}

export interface TownOptions {
  host: HTMLElement;
  seed?: number;
  /** Degrees the ground leans back. 0 draws it flat. */
  tilt?: number;
  /** How many people are out walking. */
  walkers?: number;
  /** Whether the cursor (a tap on a phone) walks too. */
  pointer?: boolean;
  /** Short words that pop above a stop when somebody reaches it. */
  labels?: string[];
  story?: TownStory;
  /** Where the town's centre sits in the host, as fractions of its size. */
  anchor?: [number, number];
  anchorMobile?: [number, number];
  river?: boolean;
}

type Pt = { x: number; y: number; bx: number; by: number };
type Marker = {
  x: number; y: number; node: number; a: number; boost: number; nb: number[];
  trail: boolean; phase: number; ring: number; cool: number;
};
type Pulse = { i: number; j: number; p: number; v: number; e: number };
type Walker = { x: number; y: number; at: number; to: number; hx: number; hy: number; speed: number; tail: number[]; tick: number };
type Label = { m: number; text: string; t: number; life: number };
type Cam = { fx: number; fy: number; ax: number; ay: number; tilt: number; zoom: number };

const NIGHT = '#080d10';
const BLUE = '41,151,255';

function rng(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
/** 0 before a, 1 after b, an S-curve between. */
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
const back = (u: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mixCam = (p: Cam, q: Cam, t: number): Cam => ({
  fx: mix(p.fx, q.fx, t), fy: mix(p.fy, q.fy, t), ax: mix(p.ax, q.ax, t), ay: mix(p.ay, q.ay, t),
  tilt: mix(p.tilt, q.tilt, t), zoom: mix(p.zoom, q.zoom, t),
});

function sprite(colour: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, colour); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return c;
}

export function startTown(o: TownOptions): () => void {
  const { host, story } = o;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tilt0 = o.tilt ?? 52;
  const flat = tilt0 === 0;
  const words = o.labels ?? [];

  const base = document.createElement('canvas');
  const live = document.createElement('canvas');
  const fog = document.createElement('div');
  const over = document.createElement('canvas');
  base.className = 'town-ground town-base';
  live.className = 'town-ground town-live';
  fog.className = 'town-fog';
  over.className = 'town-over';
  for (const el of [base, live, fog, over]) el.setAttribute('aria-hidden', 'true');
  if (flat) fog.hidden = true;
  host.classList.add('town');
  host.prepend(base, live, fog, over);
  const b2 = base.getContext('2d'), l2 = live.getContext('2d'), o2 = over.getContext('2d');
  if (!b2 || !l2 || !o2) return () => {};
  const glow = sprite(`rgba(${BLUE},0.9)`);
  const glowAmber = sprite('rgba(240,168,104,0.9)');
  const glowWhite = sprite('rgba(214,236,255,0.85)');

  let W = 0, H = 0, Gw = 0, Gh = 0, gd = 1, od = 1, S = 80, mobile = false;
  let nodes: Pt[] = [], adj: number[][] = [], markers: Marker[] = [], links: [number, number][] = [];
  let trail: number[] = [], pathPts: [number, number][] = [], pathLen = 0;
  let pulses: Pulse[] = [], walkers: Walker[] = [], labels: Label[] = [];
  let F0 = { x: 0, y: 0 };
  let M = new DOMMatrix(), zoomNow = 1, camCss = '';
  const ptr = { on: false, x: 0, y: 0, tx: 0, ty: 0, last: 0, touch: false };
  let sNow = 0, raf = 0, running = true, visible = true, last = performance.now(), ambientIn = 0.2, fadeNow = -1;

  const riverOn = o.river ?? Boolean(story);
  const riverY = (x: number) => F0.y + Gh * (mobile ? 0.14 : 0.17) + 30 * Math.sin(x / 260 + 1.1) + 16 * Math.sin(x / 120 + 0.3);
  const RW = 18;
  const inRiver = (x: number, y: number) => riverOn && Math.abs(y - riverY(x)) < RW + 10;
  const warp = (x: number, y: number): [number, number] => [
    x + 22 * Math.sin(y / 170 + 1.3) + 12 * Math.sin((x + y) / 260),
    y + 18 * Math.cos(x / 210 + 0.4) + 12 * Math.cos((x - y) / 300),
  ];

  // ------------------------------------------------------------------ the town
  function build() {
    const r = host.getBoundingClientRect();
    W = Math.max(300, Math.round(r.width)); H = Math.max(200, Math.round(r.height));
    mobile = W < 760;
    Gw = flat ? W : Math.round(W * (mobile ? 2.8 : 1.9));
    Gh = flat ? H : Math.round(H * (mobile ? 1.7 : 2.1));
    const dpr = window.devicePixelRatio || 1;
    gd = Math.min(flat ? 2 : 1.5, dpr, Math.sqrt(5.5e6 / (Gw * Gh)));
    od = Math.min(2, dpr);
    for (const c of [base, live]) {
      c.width = Math.round(Gw * gd); c.height = Math.round(Gh * gd);
      c.style.width = `${Gw}px`; c.style.height = `${Gh}px`;
    }
    over.width = Math.round(W * od); over.height = Math.round(H * od);
    over.style.width = `${W}px`; over.style.height = `${H}px`;
    F0 = { x: Gw / 2, y: flat ? Gh / 2 : Gh * 0.6 };

    const R = rng(o.seed ?? 11);
    S = 80;
    const cols = Math.ceil(Gw / S) + 3, rows = Math.ceil(Gh / S) + 3;
    const id = (i: number, j: number) => j * cols + i;
    nodes = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const bx = (i - 1) * S + (R() - 0.5) * 0.26 * S, by = (j - 1) * S + (R() - 0.5) * 0.26 * S;
      const [x, y] = warp(bx, by);
      nodes.push({ x, y, bx, by });
    }
    const avRow = Math.round(rows * 0.45), avCol = Math.round(cols * (mobile ? 0.5 : 0.42));
    type E = { a: number; b: number; major: boolean; cx: number; cy: number };
    const edges: E[] = [];
    adj = nodes.map(() => []);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      if (i + 1 < cols) { const major = j === avRow; if (major || R() < 0.84) edges.push({ a: id(i, j), b: id(i + 1, j), major, cx: 0, cy: 0 }); }
      if (j + 1 < rows) { const major = i === avCol; if (major || R() < 0.84) edges.push({ a: id(i, j), b: id(i, j + 1), major, cx: 0, cy: 0 }); }
    }
    const kept: E[] = [];
    for (const e of edges) {
      const A = nodes[e.a], B = nodes[e.b];
      const m = warp((A.bx + B.bx) / 2, (A.by + B.by) / 2);
      e.cx = 2 * m[0] - (A.x + B.x) / 2; e.cy = 2 * m[1] - (A.y + B.y) / 2;
      const wet = inRiver(m[0], m[1]) || inRiver(A.x, A.y) || inRiver(B.x, B.y);
      if (wet && !e.major) continue;
      kept.push(e);
      if (!wet) { adj[e.a].push(e.b); adj[e.b].push(e.a); }
    }

    // The streets, drawn once.
    const g = b2!;
    g.setTransform(gd, 0, 0, gd, 0, 0);
    g.fillStyle = NIGHT; g.fillRect(0, 0, Gw, Gh);
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
      const q = [nodes[id(i, j)], nodes[id(i + 1, j)], nodes[id(i + 1, j + 1)], nodes[id(i, j + 1)]];
      const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
      if (inRiver(cx, cy)) continue;
      const rr = R();
      if (rr > 0.82) continue;
      const park = rr < 0.07, k = park ? 0.86 : 0.72;
      g.beginPath();
      q.forEach((p, n) => { const x = cx + (p.x - cx) * k, y = cy + (p.y - cy) * k; if (n) g.lineTo(x, y); else g.moveTo(x, y); });
      g.closePath();
      g.fillStyle = park ? 'rgba(98,201,131,0.08)' : `rgba(150,190,210,${(0.045 + R() * 0.035).toFixed(3)})`;
      g.fill();
      // A lit window or two: the town is lived in.
      if (!park && R() < 0.35) {
        g.fillStyle = 'rgba(240,190,120,0.16)';
        for (let w = 0; w < 3; w++) g.fillRect(cx + (R() - 0.5) * S * 0.5, cy + (R() - 0.5) * S * 0.5, 3, 2);
      }
    }
    if (riverOn) {
      g.beginPath();
      for (let x = -24; x <= Gw + 24; x += 8) { if (x === -24) g.moveTo(x, riverY(x) - RW); else g.lineTo(x, riverY(x) - RW); }
      for (let x = Gw + 24; x >= -24; x -= 8) g.lineTo(x, riverY(x) + RW);
      g.closePath(); g.fillStyle = `rgba(${BLUE},0.09)`; g.fill();
      g.strokeStyle = `rgba(${BLUE},0.22)`; g.lineWidth = 1;
      for (const off of [-RW, RW]) {
        g.beginPath();
        for (let x = -24; x <= Gw + 24; x += 8) { if (x === -24) g.moveTo(x, riverY(x) + off); else g.lineTo(x, riverY(x) + off); }
        g.stroke();
      }
    }
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(140,190,215,0.15)'; g.lineWidth = 1.3; g.beginPath();
    for (const e of kept) if (!e.major) { const A = nodes[e.a], B = nodes[e.b]; g.moveTo(A.x, A.y); g.quadraticCurveTo(e.cx, e.cy, B.x, B.y); }
    g.stroke();
    g.strokeStyle = 'rgba(140,190,215,0.28)'; g.lineWidth = 3; g.beginPath();
    for (const e of kept) if (e.major) { const A = nodes[e.a], B = nodes[e.b]; g.moveTo(A.x, A.y); g.quadraticCurveTo(e.cx, e.cy, B.x, B.y); }
    g.stroke();
    if (!flat) {
      // The edges of the town dissolve into the night instead of ending.
      const edge = (x0: number, y0: number, x1: number, y1: number, x: number, y: number, w: number, h: number) => {
        const gr = g.createLinearGradient(x0, y0, x1, y1);
        gr.addColorStop(0, NIGHT); gr.addColorStop(1, 'rgba(8,13,16,0)');
        g.fillStyle = gr; g.fillRect(x, y, w, h);
      };
      const ex = Gw * 0.14, ey = Gh * 0.12;
      edge(0, 0, 0, ey, 0, 0, Gw, ey);
      edge(0, Gh, 0, Gh - ey, 0, Gh - ey, Gw, ey);
      edge(0, 0, ex, 0, 0, 0, ex, Gh);
      edge(Gw, 0, Gw - ex, 0, Gw - ex, 0, ex, Gh);
    }

    // Stops stand on street corners.
    const margin = flat ? 16 : 60;
    const cand: number[] = [];
    nodes.forEach((n, k) => {
      if (n.x > margin && n.x < Gw - margin && n.y > margin && n.y < Gh - margin && !inRiver(n.x, n.y) && adj[k].length >= 2) cand.push(k);
    });
    const used = new Set<number>();
    markers = []; trail = [];
    const add = (k: number, isTrail: boolean) => {
      const n = nodes[k];
      markers.push({ x: n.x, y: n.y, node: k, a: 0, boost: 0, nb: [], trail: isTrail, phase: R() * 6.283, ring: 0, cool: 0 });
      used.add(k);
      return markers.length - 1;
    };
    if (story) {
      const at = mobile
        ? [[-150, -40], [-30, -190], [140, -100], [40, 70], [180, 150]]
        : [[-320, -40], [-90, -250], [190, -150], [60, 80], [330, 170]];
      for (const [dx, dy] of at) {
        let best = -1, bd = 1e9;
        for (const k of cand) { if (used.has(k)) continue; const d = Math.hypot(nodes[k].x - (F0.x + dx), nodes[k].y - (F0.y + dy)); if (d < bd) { bd = d; best = k; } }
        if (best >= 0) trail.push(add(best, true));
      }
    }
    const area = flat ? W * H : Gw * Gh;
    const want = Math.round(clamp(area / (flat ? 26000 : 24000), 10, flat ? 60 : 120));
    const order = cand.slice();
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    for (const k of order) {
      if (markers.length >= want + trail.length) break;
      if (used.has(k)) continue;
      const n = nodes[k];
      if (markers.some((m) => Math.hypot(m.x - n.x, m.y - n.y) < S * 1.3)) continue;
      add(k, false);
    }

    // Every stop joined to every neighbour in reach, then the shortest missing
    // joins added until no stop stands alone.
    links = [];
    const seen = new Set<string>();
    const join = (a: number, b: number) => {
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (seen.has(key)) return;
      seen.add(key); links.push([a, b]); markers[a].nb.push(b); markers[b].nb.push(a);
    };
    const pairs: [number, number, number][] = [];
    for (let a = 0; a < markers.length; a++) for (let b = a + 1; b < markers.length; b++) {
      const d = Math.hypot(markers[a].x - markers[b].x, markers[a].y - markers[b].y);
      pairs.push([d, a, b]);
      if (d < S * 2.25) join(a, b);
    }
    pairs.sort((p, q) => p[0] - q[0]);
    const root = markers.map((_, i) => i);
    const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
    for (const [a, b] of links) root[find(a)] = find(b);
    for (const [, a, b] of pairs) { const ra = find(a), rb = find(b); if (ra !== rb) { root[ra] = rb; join(a, b); } }

    pathPts = []; pathLen = 0;
    if (story && trail.length >= 2) {
      const from = markers[trail[0]].node, to = markers[trail[1]].node;
      const prev = new Map<number, number>([[from, -1]]);
      const queue = [from];
      while (queue.length) {
        const c = queue.shift()!;
        if (c === to) break;
        for (const nb of adj[c]) if (!prev.has(nb)) { prev.set(nb, c); queue.push(nb); }
      }
      if (prev.has(to)) { let c = to; while (c !== -1) { pathPts.unshift([nodes[c].x, nodes[c].y]); c = prev.get(c)!; } }
      else pathPts = [[markers[trail[0]].x, markers[trail[0]].y], [markers[trail[1]].x, markers[trail[1]].y]];
      for (let i = 1; i < pathPts.length; i++) pathLen += Math.hypot(pathPts[i][0] - pathPts[i - 1][0], pathPts[i][1] - pathPts[i - 1][1]);
    }

    // People out walking, starting near the middle of town.
    walkers = [];
    const near = cand.filter((k) => Math.hypot(nodes[k].x - F0.x, nodes[k].y - F0.y) < (mobile ? 260 : 380));
    for (let i = 0; i < (o.walkers ?? 0) && near.length; i++) {
      const k = near[Math.floor(R() * near.length)];
      const wk: Walker = { x: nodes[k].x, y: nodes[k].y, at: k, to: k, hx: R() - 0.5, hy: R() - 0.5, speed: 42 + R() * 30, tail: [], tick: 0 };
      wk.to = pickNext(wk, k, -1);
      walkers.push(wk);
    }
    pulses = []; labels = [];
    camCss = '';
  }

  // ---------------------------------------------------------------- the camera
  const P = () => (mobile ? 760 : 1000);
  function setCamera(c: Cam) {
    const per = new DOMMatrix();
    per.m34 = -1 / P();
    M = new DOMMatrix()
      .translateSelf(c.ax * W, c.ay * H)
      .multiplySelf(per)
      .rotateSelf(c.tilt, 0, 0)
      .scaleSelf(c.zoom, c.zoom)
      .translateSelf(-c.fx, -c.fy);
    zoomNow = c.zoom;
    const css = M.toString();
    if (css !== camCss) { camCss = css; base.style.transform = css; live.style.transform = css; }
  }
  /** Where a point on the ground lands on screen, and how near it is (1 = the focus). */
  function project(x: number, y: number): [number, number, number] {
    const w = M.m14 * x + M.m24 * y + M.m44;
    if (w <= 0.08) return [NaN, NaN, 0];
    return [(M.m11 * x + M.m21 * y + M.m41) / w, (M.m12 * x + M.m22 * y + M.m42) / w, zoomNow / w];
  }
  /** The point on the ground under a point on screen. */
  function unproject(sx: number, sy: number): [number, number] | null {
    const A1 = M.m11 - M.m14 * sx, B1 = M.m21 - M.m24 * sx, C1 = M.m44 * sx - M.m41;
    const A2 = M.m12 - M.m14 * sy, B2 = M.m22 - M.m24 * sy, C2 = M.m44 * sy - M.m42;
    const det = A1 * B2 - A2 * B1;
    if (Math.abs(det) < 1e-9) return null;
    return [(C1 * B2 - C2 * B1) / det, (A1 * C2 - A2 * C1) / det];
  }
  const onScreen = (x: number, y: number, pad = 40) => {
    const [sx, sy, d] = project(x, y);
    return d > 0 && sx > -pad && sx < W + pad && sy > H * 0.12 - pad && sy < H + pad;
  };

  function camAt(s: number, wx: number, wy: number): Cam {
    const anchor = mobile ? (o.anchorMobile ?? [0.5, 0.82]) : (o.anchor ?? [0.66, 0.6]);
    let c: Cam = { fx: F0.x, fy: F0.y, ax: anchor[0], ay: anchor[1], tilt: tilt0, zoom: mobile ? 0.85 : 1 };
    if (!story || trail.length < 2) return c;
    const T = trail.reduce((p, i) => ({ x: p.x + markers[i].x / trail.length, y: p.y + markers[i].y / trail.length }), { x: 0, y: 0 });
    const S2 = markers[trail[1]];
    const buildCam: Cam = { fx: T.x, fy: T.y, ax: mobile ? 0.5 : 0.66, ay: mobile ? 0.36 : 0.52, tilt: 36, zoom: mobile ? 0.95 : 1.05 };
    const walkCam: Cam = { fx: wx || T.x, fy: wy || T.y, ax: mobile ? 0.5 : 0.66, ay: mobile ? 0.36 : 0.54, tilt: 48, zoom: mobile ? 1.15 : 1.3 };
    const findCam: Cam = { fx: S2.x, fy: S2.y, ax: mobile ? 0.5 : 0.7, ay: mobile ? 0.46 : 0.64, tilt: 70, zoom: mobile ? 1.6 : 1.9 };
    const outCam: Cam = { fx: F0.x, fy: F0.y, ax: mobile ? 0.5 : 0.6, ay: mobile ? 0.62 : 0.62, tilt: 60, zoom: mobile ? 0.8 : 0.9 };
    // With reduced motion the camera never travels: each step is a cut.
    if (reduced) return s < 0.6 ? c : s < 3.05 ? buildCam : s < 4.65 ? findCam : outCam;
    c = mixCam(c, buildCam, ease(smooth(0.45, 1.05, s)));
    c = mixCam(c, walkCam, ease(smooth(1.85, 2.3, s)));
    c = mixCam(c, findCam, ease(smooth(3.0, 3.7, s)));
    c = mixCam(c, outCam, ease(smooth(4.35, 5.0, s)));
    return c;
  }

  // --------------------------------------------------------------- the people
  function pickNext(wk: Walker, at: number, from: number) {
    const opts = adj[at].filter((k) => k !== from);
    const list = opts.length ? opts : adj[at];
    if (!list.length) return at;
    const reach = mobile ? 300 : 460;
    let best = list[0], bs = -99;
    for (const k of list) {
      const dx = nodes[k].x - nodes[at].x, dy = nodes[k].y - nodes[at].y, l = Math.hypot(dx, dy) || 1;
      let sc = (dx * wk.hx + dy * wk.hy) / l + Math.random() * 1.2;
      if (Math.hypot(nodes[k].x - F0.x, nodes[k].y - F0.y) > reach) sc -= 2.5;
      if (!flat && !onScreen(nodes[k].x, nodes[k].y)) sc -= 2;
      if (sc > bs) { bs = sc; best = k; }
    }
    return best;
  }

  function stepWalkers(dt: number) {
    for (const wk of walkers) {
      const T = nodes[wk.to];
      const dx = T.x - wk.x, dy = T.y - wk.y, d = Math.hypot(dx, dy);
      if (d < wk.speed * dt) {
        wk.x = T.x; wk.y = T.y;
        if (d > 0.01) { wk.hx = dx / d; wk.hy = dy / d; }
        const prev = wk.at; wk.at = wk.to; wk.to = pickNext(wk, wk.at, prev);
      } else {
        wk.x += (dx / d) * wk.speed * dt; wk.y += (dy / d) * wk.speed * dt; wk.hx = dx / d; wk.hy = dy / d;
      }
      wk.tick += dt;
      if (wk.tick > 0.06) { wk.tick = 0; wk.tail.push(wk.x, wk.y); if (wk.tail.length > 56) wk.tail.splice(0, 2); }
    }
    if (ptr.on) {
      const k = 1 - Math.exp(-dt * 10);
      ptr.x += (ptr.tx - ptr.x) * k; ptr.y += (ptr.ty - ptr.y) * k;
      if (performance.now() - ptr.last > (ptr.touch ? 2600 : 1600)) ptr.on = false;
    }
  }

  function fire(i: number, j: number, e: number) {
    if (pulses.length > 140) return;
    const A = markers[i], B = markers[j];
    pulses.push({ i, j, p: 0, v: 170 / Math.max(30, Math.hypot(B.x - A.x, B.y - A.y)), e });
  }

  function stepNet(dt: number, dim: number, excite: number) {
    const reach = mobile ? 110 : 130;
    for (let i = 0; i < markers.length; i++) {
      const m = markers[i];
      let tgt = 0;
      if (excite > 0.05) {
        for (const wk of walkers) tgt = Math.max(tgt, 1 - Math.hypot(m.x - wk.x, m.y - wk.y) / reach);
        if (ptr.on) tgt = Math.max(tgt, 1 - Math.hypot(m.x - ptr.x, m.y - ptr.y) / (reach * 1.4));
        tgt = Math.max(0, tgt) * excite;
      }
      m.boost *= Math.exp(-dt * 1.4);
      m.ring = Math.max(0, m.ring - dt * 1.3);
      m.cool = Math.max(0, m.cool - dt);
      m.a += (Math.max(tgt, m.boost) - m.a) * (1 - Math.exp(-dt * 7));
      if (m.a > 0.5 && m.nb.length && Math.random() < dt * 1.5 * m.a * dim) fire(i, m.nb[(Math.random() * m.nb.length) | 0], 1);

      // Somebody reached this stop: it lights, sends pulses out, and says so.
      if (excite > 0.5 && m.cool === 0 && !m.trail) {
        const there = walkers.some((wk) => Math.hypot(m.x - wk.x, m.y - wk.y) < 10) || (ptr.on && Math.hypot(m.x - ptr.x, m.y - ptr.y) < 18);
        if (there) {
          m.cool = 8; m.boost = 1; m.ring = 1;
          for (const nb of m.nb.slice(0, 3)) fire(i, nb, 1);
          if (words.length && Math.random() < 0.75 && labels.length < 5) labels.push({ m: i, text: words[(Math.random() * words.length) | 0], t: 0, life: 2.8 });
        }
      }
    }
    // The network is never still: somewhere a stop is always sending one on.
    ambientIn -= dt;
    if (ambientIn <= 0 && markers.length) {
      ambientIn = 0.14 + Math.random() * 0.22;
      const i = (Math.random() * markers.length) | 0, m = markers[i];
      if (m.nb.length && dim > 0.2) fire(i, m.nb[(Math.random() * m.nb.length) | 0], 0.8);
    }
    for (let k = pulses.length - 1; k >= 0; k--) {
      const P2 = pulses[k]; P2.p += dt * P2.v;
      if (P2.p >= 1) {
        const B = markers[P2.j];
        B.boost = Math.max(B.boost, Math.min(1, 0.2 + 0.5 * P2.e));
        B.ring = Math.max(B.ring, 0.8 * P2.e);
        if (P2.e * 0.62 > 0.3 && Math.random() < 0.75) {
          const nx = B.nb.filter((n) => n !== P2.i);
          if (nx.length) fire(P2.j, nx[(Math.random() * nx.length) | 0], P2.e * 0.62);
        }
        pulses.splice(k, 1);
      }
    }
    for (let k = labels.length - 1; k >= 0; k--) { labels[k].t += dt; if (labels[k].t > labels[k].life) labels.splice(k, 1); }
  }

  // ------------------------------------------------------------------ drawing
  function pin(c: CanvasRenderingContext2D, x: number, y: number, scale: number, colour: string, label: string | null, alpha: number) {
    const r = 7 * scale, hy = y - r * 2.15;
    c.globalAlpha = alpha;
    c.beginPath();
    c.moveTo(x, y);
    c.bezierCurveTo(x - r * 0.6, y - r * 0.9, x - r, hy + r * 0.55, x - r, hy);
    c.arc(x, hy, r, Math.PI, 0);
    c.bezierCurveTo(x + r, hy + r * 0.55, x + r * 0.6, y - r * 0.9, x, y);
    c.closePath();
    c.fillStyle = colour; c.fill();
    c.lineWidth = Math.max(1, 1.4 * Math.min(scale, 1.4)); c.strokeStyle = 'rgba(8,13,16,0.85)'; c.stroke();
    if (label) {
      c.fillStyle = '#04182e'; c.font = `600 ${Math.max(8, Math.round(8.5 * scale))}px "JetBrains Mono", monospace`;
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(label, x, hy + 0.5);
    } else {
      c.beginPath(); c.arc(x, hy, r * 0.36, 0, 6.2832); c.fillStyle = '#04182e'; c.fill();
    }
    c.globalAlpha = 1;
  }

  function bubble(c: CanvasRenderingContext2D, x: number, y: number, text: string, alpha: number) {
    c.font = '600 12px Onest, system-ui, sans-serif';
    const w = c.measureText(text).width + 18, h = 24;
    const plus = /^[+−-]/.test(text);
    c.globalAlpha = alpha;
    c.beginPath();
    c.roundRect(x - w / 2, y - h, w, h, 12);
    c.fillStyle = plus ? '#f0a868' : 'rgba(16,26,31,0.88)';
    c.fill();
    if (!plus) { c.strokeStyle = 'rgba(140,190,215,0.3)'; c.lineWidth = 1; c.stroke(); }
    c.fillStyle = plus ? '#2a1604' : '#e9f2f5';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, x, y - h / 2 + 0.5);
    c.globalAlpha = 1;
  }

  function frame(now: number) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const t = reduced ? 0 : now / 1000;

    let s = 0;
    if (story) {
      const wr = story.scroller.getBoundingClientRect();
      const target = clamp(-wr.top / Math.max(1, wr.height - H), 0, 1) * 5;
      sNow += (target - sNow) * (reduced ? 1 : 1 - Math.exp(-dt * 9));
      s = sNow;
    }
    const b = story ? smooth(0.85, 1.75, s) : 0;
    const w = story ? smooth(2.05, 2.85, s) : 0;
    const f = story ? smooth(3.1, 3.8, s) : 0;
    const out = story ? smooth(4.45, 5, s) : 0;
    const free = story ? 1 - smooth(0.3, 0.75, s) : 1;
    const dim = 1 - 0.6 * b * (1 - out);

    if (!reduced) { stepWalkers(dt); stepNet(dt, dim, free); }

    // Where the walk has got to.
    let wx = 0, wy = 0;
    if (pathPts.length > 1) {
      const target = w * pathLen; let acc = 0;
      [wx, wy] = pathPts[0];
      for (let i = 1; i < pathPts.length; i++) {
        const [x0, y0] = pathPts[i - 1], [x1, y1] = pathPts[i];
        const L = Math.hypot(x1 - x0, y1 - y0);
        if (acc + L >= target) { const u = (target - acc) / L; wx = x0 + (x1 - x0) * u; wy = y0 + (y1 - y0) * u; break; }
        acc += L; wx = x1; wy = y1;
      }
    }

    setCamera(camAt(s, wx, wy));

    // ---- on the ground
    const g = l2!;
    g.setTransform(gd, 0, 0, gd, 0, 0);
    g.clearRect(0, 0, Gw, Gh);
    g.lineCap = 'round'; g.lineJoin = 'round';

    // Light around everybody walking.
    g.globalCompositeOperation = 'lighter';
    const pool = (x: number, y: number, r: number, a: number) => {
      if (a < 0.01) return;
      g.globalAlpha = a; g.drawImage(glow, x - r, y - r, r * 2, r * 2); g.globalAlpha = 1;
    };
    if (free > 0.01) {
      for (const wk of walkers) pool(wk.x, wk.y, 120, 0.16 * free);
      if (ptr.on) pool(ptr.x, ptr.y, 190, 0.26 * free);
    }
    if (w > 0 && f < 1) pool(wx, wy, 130, 0.22 * (1 - f));
    g.globalCompositeOperation = 'source-over';

    // Where they have just been.
    if (free > 0.01) for (const wk of walkers) {
      const tl = wk.tail;
      for (let i = 2; i < tl.length; i += 2) {
        g.strokeStyle = `rgba(150,205,255,${((i / tl.length) * 0.55 * free).toFixed(3)})`;
        g.lineWidth = 2.4;
        g.beginPath(); g.moveTo(tl[i - 2], tl[i - 1]); g.lineTo(tl[i], tl[i + 1]); g.stroke();
      }
    }

    // The network.
    g.lineWidth = 1.6;
    for (const [ia, ib] of links) {
      const A = markers[ia], B = markers[ib];
      const al = (0.24 + 0.5 * Math.max(A.a, B.a)) * dim;
      if (al < 0.01) continue;
      g.strokeStyle = `rgba(${BLUE},${al.toFixed(3)})`;
      g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(B.x, B.y); g.stroke();
    }

    // The trail being built, and the way walked.
    if (b > 0) {
      g.lineWidth = 2.6; g.setLineDash([8, 8]); g.lineDashOffset = reduced ? 0 : -t * 22;
      for (let k = 0; k < trail.length - 1; k++) {
        const u = clamp((b - (0.2 + k * 0.15)) / 0.15, 0, 1); if (u <= 0) continue;
        const A = markers[trail[k]], B = markers[trail[k + 1]];
        g.strokeStyle = `rgba(150,205,255,${(0.85 * (1 - 0.5 * f)).toFixed(3)})`;
        g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(A.x + (B.x - A.x) * u, A.y + (B.y - A.y) * u); g.stroke();
      }
      g.setLineDash([]);
    }
    if (w > 0 && pathPts.length > 1) {
      const target = w * pathLen; let acc = 0;
      g.strokeStyle = `rgba(${BLUE},0.95)`; g.lineWidth = 4.5;
      g.beginPath(); g.moveTo(pathPts[0][0], pathPts[0][1]);
      for (let i = 1; i < pathPts.length; i++) {
        const [x0, y0] = pathPts[i - 1], [x1, y1] = pathPts[i];
        const L = Math.hypot(x1 - x0, y1 - y0);
        if (acc + L >= target) { const u = (target - acc) / L; g.lineTo(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u); break; }
        g.lineTo(x1, y1); acc += L;
      }
      g.stroke();
    }

    // Rings on the ground where something arrived.
    for (const m of markers) {
      if (m.ring <= 0.01) continue;
      g.strokeStyle = `rgba(${BLUE},${(m.ring * 0.7 * dim).toFixed(3)})`; g.lineWidth = 1.6;
      g.beginPath(); g.arc(m.x, m.y, 6 + (1 - m.ring) * 34, 0, 6.2832); g.stroke();
    }
    if (story && w > 0.96 && f < 0.7 && trail.length > 1) {
      const S2 = markers[trail[1]], rt = (t % 1.6) / 1.6;
      g.strokeStyle = `rgba(116,217,107,${(0.8 * (1 - rt)).toFixed(3)})`; g.lineWidth = 2.5;
      g.beginPath(); g.arc(S2.x, S2.y, 10 + 40 * rt, 0, 6.2832); g.stroke();
    }

    // Pulses, each with a short tail of light behind it.
    if (!reduced) for (const P2 of pulses) {
      const A = markers[P2.i], B = markers[P2.j];
      const x = A.x + (B.x - A.x) * P2.p, y = A.y + (B.y - A.y) * P2.p;
      const p0 = Math.max(0, P2.p - 0.22);
      const tx = A.x + (B.x - A.x) * p0, ty = A.y + (B.y - A.y) * p0;
      const pa = Math.min(1, P2.e) * dim;
      const gr = g.createLinearGradient(tx, ty, x, y);
      gr.addColorStop(0, 'rgba(140,200,255,0)'); gr.addColorStop(1, `rgba(190,225,255,${(0.85 * pa).toFixed(3)})`);
      g.strokeStyle = gr; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(tx, ty); g.lineTo(x, y); g.stroke();
      g.globalAlpha = pa; g.drawImage(glowWhite, x - 12, y - 12, 24, 24); g.globalAlpha = 1;
    }

    // People, as dots on the street.
    const dot = (x: number, y: number, r: number, a: number) => {
      if (a < 0.01) return;
      const rt = reduced ? 0.5 : (t % 1.8) / 1.8;
      g.globalAlpha = a;
      g.strokeStyle = `rgba(${BLUE},${(0.6 * (1 - rt)).toFixed(3)})`; g.lineWidth = 1.6;
      g.beginPath(); g.arc(x, y, r + 22 * rt, 0, 6.2832); g.stroke();
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
      g.fillStyle = '#2997ff'; g.beginPath(); g.arc(x, y, r * 0.66, 0, 6.2832); g.fill();
      g.globalAlpha = 1;
    };
    if (free > 0.01) {
      for (const wk of walkers) dot(wk.x, wk.y, 6, free);
      if (ptr.on) dot(ptr.x, ptr.y, 8, free);
    }
    if (w > 0 && f < 1) dot(wx, wy, 8, Math.min(1, w * 4) * (1 - f));

    // ---- standing up: the pins, nearest drawn last
    const c = o2!;
    c.setTransform(od, 0, 0, od, 0, 0);
    c.clearRect(0, 0, W, H);
    const horizon = (sy: number) => (flat ? 1 : smooth(H * 0.04, H * 0.3, sy));
    // Behind the hero's words the town keeps quiet: no pins or labels under
    // the headline, so it reads at a glance.
    const quiet = (sx: number, sy: number) => {
      if (!story || free <= 0) return 1;
      const open = mobile ? smooth(H * 0.72, H * 0.86, sy) : smooth(W * 0.34, W * 0.5, sx);
      return 1 - free * (1 - open);
    };
    const drawn: [number, number, number, number][] = [];
    markers.forEach((m, i) => {
      if (m.trail && b > 0.02) return;
      const [sx, sy, d] = project(m.x, m.y);
      if (!(d > 0) || sx < -40 || sx > W + 40 || sy < -40 || sy > H + 60) return;
      drawn.push([sy, sx, d, i]);
    });
    drawn.sort((p, q) => p[0] - q[0]);
    for (const [sy, sx, d, i] of drawn) {
      const m = markers[i];
      const fade = horizon(sy) * dim * quiet(sx, sy);
      if (fade < 0.02) continue;
      const beat = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t * 1.8 + m.phase);
      const halo = Math.max(m.a, 0.14 + 0.18 * beat);
      const k = clamp(d, 0.35, 2.2);
      const gs = (14 + 30 * halo) * k;
      c.globalAlpha = Math.min(1, halo) * fade; c.drawImage(glow, sx - gs, sy - gs * 1.2, gs * 2, gs * 2); c.globalAlpha = 1;
      const scale = k * (0.62 + 0.75 * ease(clamp(m.a, 0, 1)));
      pin(c, sx, sy, scale, m.a > 0.55 ? '#8cc8ff' : '#2997ff', null, fade * (0.6 + 0.4 * Math.max(m.a, beat * 0.5)));
    }

    // The trail's own stops, numbered, dropping in as it is built.
    if (b > 0.02) {
      trail.forEach((ti, k) => {
        const m = markers[ti];
        const u = clamp((b - (0.08 + k * 0.15)) / 0.16, 0, 1); if (u <= 0) return;
        const [sx, sy, d] = project(m.x, m.y);
        if (!(d > 0)) return;
        // The stop being found grows as the camera comes down to it: in the
        // phone it is the thing standing in the street.
        const kk = clamp(d, 0.6, 3.2) * (k === 1 ? 1 + 1.3 * f : 1);
        const yo = reduced ? 0 : -40 * kk * (1 - back(u));
        const found = (k === 0 && w > 0.04) || (k === 1 && f > 0.55);
        c.globalAlpha = u * 0.85 * horizon(sy);
        c.drawImage(found ? glowAmber : glow, sx - 30 * kk, sy - 44 * kk + yo, 60 * kk, 60 * kk);
        c.globalAlpha = 1;
        pin(c, sx, sy + yo, 1.6 * kk, found ? '#f0a868' : '#2997ff', String(k + 1), u * horizon(sy));
      });
    }

    // Words above the stops somebody just reached.
    for (const lb of labels) {
      const m = markers[lb.m];
      const [sx, sy, d] = project(m.x, m.y);
      if (!(d > 0)) continue;
      const k = clamp(d, 0.35, 2.2);
      const life = lb.t / lb.life;
      const q = quiet(sx, sy);
      if (q < 0.6) continue;
      const a = smooth(0, 0.08, life) * (1 - smooth(0.75, 1, life)) * horizon(sy) * free * q;
      bubble(c, sx, sy - 7 * k * 3.6 - 10 - life * 16, lb.text, a);
    }

    // ---- the words and the phone
    if (story) {
      const [hero, b1, b2p, b3] = story.panels;
      const show = (el: HTMLElement | undefined, v: number) => {
        if (!el) return;
        el.style.opacity = v.toFixed(3);
        el.style.transform = `translateY(${((1 - v) * 16).toFixed(1)}px)`;
        el.style.visibility = v < 0.01 ? 'hidden' : 'visible';
        // Half faded is gone as far as a click or the Tab key is concerned.
        el.inert = v < 0.5;
      };
      show(hero, 1 - smooth(0.35, 0.7, s));
      show(b1, smooth(0.7, 1.0, s) * (1 - smooth(1.85, 2.05, s)));
      show(b2p, smooth(2.05, 2.3, s) * (1 - smooth(2.95, 3.15, s)));
      show(b3, smooth(3.15, 3.4, s) * (1 - smooth(4.4, 4.65, s)));
      const { strip, stripDist, finder } = story;
      if (strip) {
        const so = smooth(1.95, 2.2, s) * (1 - smooth(3.0, 3.2, s));
        strip.style.opacity = so.toFixed(3);
        strip.style.transform = `translate(-50%, ${((1 - so) * 16).toFixed(1)}px)`;
        if (stripDist) {
          const metres = Math.max(0, Math.round(((1 - w) * 240) / 5) * 5);
          const txt = w > 0.97 ? story.here : `${metres} m`;
          if (stripDist.textContent !== txt) stripDist.textContent = txt;
        }
      }
      if (finder) {
        const fv = smooth(3.35, 3.75, s) * (1 - smooth(4.4, 4.7, s));
        finder.style.opacity = fv.toFixed(3);
        finder.style.transform = `translate(-50%, -50%) scale(${(0.9 + 0.1 * fv).toFixed(3)})`;
        finder.classList.toggle('is-asked', s > 3.75 && s < 4.6);
        finder.classList.toggle('is-scored', s > 4.0 && s < 4.6);
      }
      // The scene winds down before the page moves on, so nothing is cut off.
      const fade = (1 - 0.5 * out).toFixed(3);
      if (fade !== String(fadeNow)) { fadeNow = Number(fade); base.style.opacity = live.style.opacity = over.style.opacity = fade; }
    }

    if (!reduced) kick();
  }

  function kick() {
    if (!raf && running && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }

  function pointAt(e: PointerEvent, touch: boolean) {
    if (o.pointer === false || reduced || sNow > 0.35) return;
    const r = host.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (sx < 0 || sy < 0 || sx > r.width || sy > r.height) return;
    const gp = unproject(sx, sy);
    if (!gp) return;
    if (!ptr.on) { ptr.x = gp[0]; ptr.y = gp[1]; }
    ptr.on = true; ptr.touch = touch; ptr.tx = gp[0]; ptr.ty = gp[1]; ptr.last = performance.now();
    kick();
  }
  const onMove = (e: PointerEvent) => { if (e.pointerType !== 'touch') pointAt(e, false); };
  const onDown = (e: PointerEvent) => { if (e.pointerType !== 'mouse') pointAt(e, true); };
  const onScroll = () => { if (reduced) kick(); };
  const onVisibility = () => kick();

  let resizeTimer = 0;
  const ro = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      const r = host.getBoundingClientRect();
      if (Math.round(r.width) === W && Math.round(r.height) === H) return;
      build(); kick();
      if (reduced) requestAnimationFrame(frame);
    }, 140);
  });
  ro.observe(host);
  const io = new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible) kick(); });
  io.observe(story ? story.scroller : host);
  addEventListener('pointermove', onMove, { passive: true });
  addEventListener('pointerdown', onDown, { passive: true });
  addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);

  build();
  kick();
  if (reduced) requestAnimationFrame(frame);

  return () => {
    running = false; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerdown', onDown);
    removeEventListener('scroll', onScroll);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

/**
 * A faint street tile that repeats without a seam, for backgrounds too long to
 * draw a canvas behind. Every wobble and every random choice repeats with the
 * tile, so its right edge meets its left and its bottom meets its top.
 */
export function mapTexture(tile = 960, seed = 3): string {
  const c = document.createElement('canvas');
  c.width = c.height = tile;
  const g = c.getContext('2d');
  if (!g) return '';
  const n = 12, S = tile / n, TAU = Math.PI * 2;
  const wrap = (i: number) => ((i % n) + n) % n;
  const hash = (i: number, j: number, k: number) => {
    const v = Math.sin(wrap(i) * 127.1 + wrap(j) * 311.7 + k * 74.7 + seed * 17.3) * 43758.5453;
    return v - Math.floor(v);
  };
  const warp = (x: number, y: number): [number, number] => [
    x + 16 * Math.sin((TAU * 2 * y) / tile + 1.3) + 9 * Math.sin((TAU * 3 * (x + y)) / tile),
    y + 14 * Math.cos((TAU * 2 * x) / tile + 0.4) + 9 * Math.cos((TAU * 3 * (x - y)) / tile),
  ];
  const base = (i: number, j: number): [number, number] => [i * S + (hash(i, j, 1) - 0.5) * 0.24 * S, j * S + (hash(i, j, 2) - 0.5) * 0.24 * S];
  const at = (i: number, j: number) => warp(...base(i, j));

  for (let j = -1; j <= n; j++) for (let i = -1; i <= n; i++) {
    const r = hash(i, j, 3);
    if (r > 0.8) continue;
    const q = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
    const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
    const park = r < 0.07, k = park ? 0.86 : 0.72;
    g.beginPath();
    q.forEach(([x, y], m) => { const px = cx + (x - cx) * k, py = cy + (y - cy) * k; if (m) g.lineTo(px, py); else g.moveTo(px, py); });
    g.closePath();
    g.fillStyle = park ? 'rgba(98,201,131,0.05)' : 'rgba(150,190,210,0.035)';
    g.fill();
  }
  g.strokeStyle = 'rgba(140,190,215,0.08)'; g.lineWidth = 1.1; g.lineCap = 'round';
  g.beginPath();
  for (let j = -1; j <= n; j++) for (let i = -1; i <= n; i++) {
    const [ax, ay] = at(i, j);
    if (hash(i, j, 4) < 0.84) {
      const [bx, by] = at(i + 1, j);
      const m = warp((base(i, j)[0] + base(i + 1, j)[0]) / 2, (base(i, j)[1] + base(i + 1, j)[1]) / 2);
      g.moveTo(ax, ay); g.quadraticCurveTo(2 * m[0] - (ax + bx) / 2, 2 * m[1] - (ay + by) / 2, bx, by);
    }
    if (hash(i, j, 5) < 0.84) {
      const [bx, by] = at(i, j + 1);
      const m = warp((base(i, j)[0] + base(i, j + 1)[0]) / 2, (base(i, j)[1] + base(i, j + 1)[1]) / 2);
      g.moveTo(ax, ay); g.quadraticCurveTo(2 * m[0] - (ax + bx) / 2, 2 * m[1] - (ay + by) / 2, bx, by);
    }
  }
  g.stroke();
  return c.toDataURL('image/png');
}

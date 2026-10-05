/**
 * The night map: a made-up town drawn on a canvas, with markers on its street
 * corners joined into a network that pulses.
 *
 * Made up on purpose. A real map would be one town, a megabyte of tiles and a
 * licence line; this is a few kilobytes of code, reads as "a map" at a glance,
 * and every page can have one.
 *
 * Two uses:
 * - the home page's hero, where scroll then walks it through Build, Walk and
 *   Find (`story`);
 * - the band at the top of the other pages, where it only lives and answers the
 *   pointer.
 *
 * It stops drawing when it is off screen or the tab is hidden, and with reduced
 * motion it draws the finished state and only redraws on scroll.
 */

export interface Story {
  /** The tall element the stage is sticky inside. Scroll through it drives the walk. */
  scroller: HTMLElement;
  strip?: HTMLElement | null;
  stripDist?: HTMLElement | null;
  phone?: HTMLElement | null;
  /** "You're here", in the page's language. */
  here: string;
}

export interface NightMapOptions {
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  seed?: number;
  story?: Story;
  /** Draw the you-are-here dot and let it wander the streets when nobody points. */
  walker?: boolean;
  /** Where the page's words are, so the wandering dot keeps out from under them. */
  textSide?: 'left' | 'none';
  river?: boolean;
}

type Pt = { x: number; y: number; bx: number; by: number };
type Edge = { a: number; b: number; major: boolean; cx: number; cy: number };
type Marker = {
  x: number; y: number; node: number; a: number; boost: number; nb: number[];
  trail: boolean; phase: number; ring: number;
};
type Pulse = { i: number; j: number; p: number; v: number; e: number };

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
const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
const back = (u: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };

function sprite(colour: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, colour); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return c;
}

export function startNightMap(o: NightMapOptions): () => void {
  const { host, canvas, story } = o;
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const useWalker = o.walker ?? false;
  const avoidLeft = (o.textSide ?? 'none') === 'left';
  const glow = sprite(`rgba(${BLUE},0.9)`);
  const glowAmber = sprite('rgba(240,168,104,0.9)');

  let W = 0, H = 0, DPR = 1, S = 80, mobile = false;
  let base: HTMLCanvasElement | null = null;
  let nodes: Pt[] = [], adj: number[][] = [], markers: Marker[] = [];
  let links: [number, number][] = [], trail: number[] = [];
  let pathPts: [number, number][] = [], pathLen = 0, pulses: Pulse[] = [];
  const walker = { x: 0, y: 0, tx: 0, ty: 0, mode: 'auto' as 'auto' | 'pointer' | 'off', at: -1, to: -1, hx: 1, hy: 0, lastPtr: 0, touch: false };
  let sNow = 0, raf = 0, running = true, visible = true, last = performance.now(), ambientIn = 0.4;

  const riverOn = o.river ?? Boolean(story);
  const riverY = (x: number) => H * (mobile ? 0.9 : 0.84) + 34 * Math.sin(x / 250 + 1.1) + 18 * Math.sin(x / 115 + 0.3);
  const RW = 18;
  const inRiver = (x: number, y: number) => riverOn && Math.abs(y - riverY(x)) < RW + 10;
  const warp = (x: number, y: number): [number, number] => [
    x + 22 * Math.sin(y / 170 + 1.3) + 12 * Math.sin((x + y) / 260),
    y + 18 * Math.cos(x / 210 + 0.4) + 12 * Math.cos((x - y) / 300),
  ];

  function build() {
    const r = host.getBoundingClientRect();
    W = Math.max(320, Math.round(r.width)); H = Math.max(200, Math.round(r.height));
    mobile = W < 760;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;

    const R = rng(o.seed ?? 11);
    S = clamp(W / 15, 62, 92);
    const cols = Math.ceil(W / S) + 3, rows = Math.ceil(H / S) + 3;
    const id = (i: number, j: number) => j * cols + i;

    nodes = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const bx = (i - 1) * S + (R() - 0.5) * 0.26 * S, by = (j - 1) * S + (R() - 0.5) * 0.26 * S;
      const [x, y] = warp(bx, by);
      nodes.push({ x, y, bx, by });
    }

    const avRow = Math.round(rows * 0.42), avCol = Math.round(cols * (mobile ? 0.5 : 0.33));
    const edges: Edge[] = [];
    adj = nodes.map(() => []);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      if (i + 1 < cols) { const major = j === avRow; if (major || R() < 0.84) edges.push({ a: id(i, j), b: id(i + 1, j), major, cx: 0, cy: 0 }); }
      if (j + 1 < rows) { const major = i === avCol; if (major || R() < 0.84) edges.push({ a: id(i, j), b: id(i, j + 1), major, cx: 0, cy: 0 }); }
    }
    const kept: Edge[] = [];
    for (const e of edges) {
      const A = nodes[e.a], B = nodes[e.b];
      const m = warp((A.bx + B.bx) / 2, (A.by + B.by) / 2);
      e.cx = 2 * m[0] - (A.x + B.x) / 2; e.cy = 2 * m[1] - (A.y + B.y) / 2;
      const wet = inRiver(m[0], m[1]) || inRiver(A.x, A.y) || inRiver(B.x, B.y);
      if (wet && !e.major) continue;
      kept.push(e);
      if (!wet) { adj[e.a].push(e.b); adj[e.b].push(e.a); }
    }

    // The streets, drawn once into their own canvas and copied each frame.
    base = document.createElement('canvas');
    base.width = canvas.width; base.height = canvas.height;
    const g = base.getContext('2d')!;
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.fillStyle = NIGHT; g.fillRect(0, 0, W, H);
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
      const q = [nodes[id(i, j)], nodes[id(i + 1, j)], nodes[id(i + 1, j + 1)], nodes[id(i, j + 1)]];
      const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
      if (inRiver(cx, cy)) continue;
      const rr = R();
      if (rr > 0.8) continue;
      const park = rr < 0.07, k = park ? 0.86 : 0.72;
      g.beginPath();
      q.forEach((p, n) => { const x = cx + (p.x - cx) * k, y = cy + (p.y - cy) * k; if (n) g.lineTo(x, y); else g.moveTo(x, y); });
      g.closePath();
      g.fillStyle = park ? 'rgba(98,201,131,0.07)' : 'rgba(150,190,210,0.05)';
      g.fill();
      if (!park && R() < 0.5) {
        const m1x = (q[0].x + q[1].x) / 2, m1y = (q[0].y + q[1].y) / 2, m2x = (q[3].x + q[2].x) / 2, m2y = (q[3].y + q[2].y) / 2;
        g.strokeStyle = NIGHT; g.lineWidth = 3; g.beginPath();
        g.moveTo(cx + (m1x - cx) * k, cy + (m1y - cy) * k); g.lineTo(cx + (m2x - cx) * k, cy + (m2y - cy) * k); g.stroke();
      }
    }
    if (riverOn) {
      g.beginPath();
      for (let x = -24; x <= W + 24; x += 8) { if (x === -24) g.moveTo(x, riverY(x) - RW); else g.lineTo(x, riverY(x) - RW); }
      for (let x = W + 24; x >= -24; x -= 8) g.lineTo(x, riverY(x) + RW);
      g.closePath(); g.fillStyle = `rgba(${BLUE},0.08)`; g.fill();
      g.strokeStyle = `rgba(${BLUE},0.18)`; g.lineWidth = 1;
      for (const off of [-RW, RW]) {
        g.beginPath();
        for (let x = -24; x <= W + 24; x += 8) { if (x === -24) g.moveTo(x, riverY(x) + off); else g.lineTo(x, riverY(x) + off); }
        g.stroke();
      }
    }
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(140,190,215,0.12)'; g.lineWidth = 1.1; g.beginPath();
    for (const e of kept) if (!e.major) { const A = nodes[e.a], B = nodes[e.b]; g.moveTo(A.x, A.y); g.quadraticCurveTo(e.cx, e.cy, B.x, B.y); }
    g.stroke();
    g.strokeStyle = 'rgba(140,190,215,0.22)'; g.lineWidth = 2.6; g.beginPath();
    for (const e of kept) if (e.major) { const A = nodes[e.a], B = nodes[e.b]; g.moveTo(A.x, A.y); g.quadraticCurveTo(e.cx, e.cy, B.x, B.y); }
    g.stroke();

    // Markers stand on street corners.
    const top = story ? 84 : 16;
    const cand: number[] = [];
    nodes.forEach((n, k) => {
      if (n.x > 20 && n.x < W - 20 && n.y > top && n.y < H - 20 && !inRiver(n.x, n.y) && adj[k].length >= 2) cand.push(k);
    });
    const used = new Set<number>();
    markers = []; trail = [];
    const add = (k: number, isTrail: boolean) => {
      const n = nodes[k];
      markers.push({ x: n.x, y: n.y, node: k, a: 0, boost: 0, nb: [], trail: isTrail, phase: R() * 6.283, ring: 0 });
      used.add(k);
      return markers.length - 1;
    };
    if (story) {
      const anchors = mobile
        // On a phone the words sit at the bottom, so the trail keeps to the top half.
        ? [[0.16, 0.34], [0.42, 0.2], [0.78, 0.28], [0.56, 0.42], [0.86, 0.5]]
        : [[0.56, 0.3], [0.7, 0.18], [0.86, 0.34], [0.74, 0.55], [0.9, 0.7]];
      for (const [ax, ay] of anchors) {
        let best = -1, bd = 1e9;
        for (const k of cand) { if (used.has(k)) continue; const d = Math.hypot(nodes[k].x - ax * W, nodes[k].y - ay * H); if (d < bd) { bd = d; best = k; } }
        if (best >= 0) trail.push(add(best, true));
      }
    }
    const want = Math.round(clamp((W * H) / 28000, 12, 56));
    const order = cand.slice();
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const minD = S * 1.35;
    for (const k of order) {
      if (markers.length >= want + trail.length) break;
      if (used.has(k)) continue;
      const n = nodes[k];
      if (markers.some((m) => Math.hypot(m.x - n.x, m.y - n.y) < minD)) continue;
      add(k, false);
    }

    // Every marker is joined to every neighbour within reach, the way the
    // synapse network joins its nodes, and then the shortest joins that are
    // still missing are added until no marker stands alone.
    links = [];
    const seen = new Set<string>();
    const join = (a: number, b: number) => {
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (seen.has(key)) return;
      seen.add(key); links.push([a, b]); markers[a].nb.push(b); markers[b].nb.push(a);
    };
    const reach = S * 2.25;
    const pairs: [number, number, number][] = [];
    for (let a = 0; a < markers.length; a++) for (let b = a + 1; b < markers.length; b++) {
      const d = Math.hypot(markers[a].x - markers[b].x, markers[a].y - markers[b].y);
      pairs.push([d, a, b]);
      if (d < reach) join(a, b);
    }
    pairs.sort((p, q) => p[0] - q[0]);
    const root = markers.map((_, i) => i);
    const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
    for (const [a, b] of links) root[find(a)] = find(b);
    for (const [, a, b] of pairs) { const ra = find(a), rb = find(b); if (ra !== rb) { root[ra] = rb; join(a, b); } }

    if (story && trail.length >= 2) {
      // The walk from stop 1 to stop 2 follows the streets.
      const from = markers[trail[0]].node, to = markers[trail[1]].node;
      const prev = new Map<number, number>([[from, -1]]);
      const queue = [from];
      while (queue.length) {
        const c = queue.shift()!;
        if (c === to) break;
        for (const nb of adj[c]) if (!prev.has(nb)) { prev.set(nb, c); queue.push(nb); }
      }
      pathPts = [];
      if (prev.has(to)) { let c = to; while (c !== -1) { pathPts.unshift([nodes[c].x, nodes[c].y]); c = prev.get(c)!; } }
      else pathPts = [[markers[trail[0]].x, markers[trail[0]].y], [markers[trail[1]].x, markers[trail[1]].y]];
      pathLen = 0;
      for (let i = 1; i < pathPts.length; i++) pathLen += Math.hypot(pathPts[i][0] - pathPts[i - 1][0], pathPts[i][1] - pathPts[i - 1][1]);
    }

    if (useWalker && cand.length) {
      let st = cand[0], bd = 1e9;
      for (const k of cand) {
        const d = Math.hypot(nodes[k].x - W * (mobile ? 0.5 : 0.72), nodes[k].y - H * (mobile ? 0.62 : 0.45));
        if (d < bd) { bd = d; st = k; }
      }
      walker.at = st; walker.x = nodes[st].x; walker.y = nodes[st].y; walker.mode = 'auto';
      walker.to = pickNext(st, -1);
    } else {
      walker.mode = 'off';
    }
    pulses = [];
  }

  function pickNext(at: number, from: number) {
    const opts = adj[at].filter((k) => k !== from);
    const list = opts.length ? opts : adj[at];
    if (!list.length) return at;
    let best = list[0], bs = -99;
    for (const k of list) {
      const dx = nodes[k].x - nodes[at].x, dy = nodes[k].y - nodes[at].y, l = Math.hypot(dx, dy) || 1;
      let sc = (dx * walker.hx + dy * walker.hy) / l + Math.random() * 1.1;
      const nx = nodes[k].x, ny = nodes[k].y;
      if (nx < 40 || nx > W - 40 || ny < 100 || ny > H - 40) sc -= 3;
      if (avoidLeft && !mobile && nx < W * 0.42) sc -= 1.2;
      if (sc > bs) { bs = sc; best = k; }
    }
    return best;
  }

  function stepWalker(dt: number, now: number) {
    if (walker.mode === 'pointer') {
      const k = 1 - Math.exp(-dt * 9);
      walker.x += (walker.tx - walker.x) * k; walker.y += (walker.ty - walker.y) * k;
      if (now - walker.lastPtr > (walker.touch ? 2600 : 1400)) {
        if (!useWalker) { walker.mode = 'off'; return; }
        let best = -1, bd = 1e9;
        nodes.forEach((n, k) => { if (!adj[k].length) return; const d = Math.hypot(n.x - walker.x, n.y - walker.y); if (d < bd) { bd = d; best = k; } });
        walker.mode = 'auto'; walker.at = -1; walker.to = best;
      }
      return;
    }
    if (walker.mode !== 'auto') return;
    const T = nodes[walker.to]; if (!T) return;
    const speed = 58, dx = T.x - walker.x, dy = T.y - walker.y, d = Math.hypot(dx, dy);
    if (d < speed * dt) {
      walker.x = T.x; walker.y = T.y;
      if (d > 0.01) { walker.hx = dx / d; walker.hy = dy / d; }
      const prevAt = walker.at; walker.at = walker.to; walker.to = pickNext(walker.at, prevAt);
    } else {
      walker.x += (dx / d) * speed * dt; walker.y += (dy / d) * speed * dt; walker.hx = dx / d; walker.hy = dy / d;
    }
  }

  function fire(i: number, j: number, e: number) {
    if (pulses.length > 110) return;
    const A = markers[i], B = markers[j];
    pulses.push({ i, j, p: 0, v: 150 / Math.max(30, Math.hypot(B.x - A.x, B.y - A.y)), e });
  }

  function stepNet(dt: number, dim: number, excite: number) {
    const reachPx = mobile ? 120 : 150;
    const on = walker.mode !== 'off' && excite > 0.05;
    for (let i = 0; i < markers.length; i++) {
      const m = markers[i];
      const tgt = on ? Math.max(0, 1 - Math.hypot(m.x - walker.x, m.y - walker.y) / reachPx) * excite : 0;
      m.boost *= Math.exp(-dt * 1.6);
      m.ring = Math.max(0, m.ring - dt * 1.4);
      m.a += (Math.max(tgt, m.boost) - m.a) * (1 - Math.exp(-dt * 7));
      if (m.a > 0.5 && m.nb.length && Math.random() < dt * 1.4 * m.a * dim) fire(i, m.nb[(Math.random() * m.nb.length) | 0], 1);
    }
    // The network is never still: somewhere a marker is always sending one on.
    ambientIn -= dt;
    if (ambientIn <= 0 && markers.length) {
      ambientIn = 0.22 + Math.random() * 0.3;
      const i = (Math.random() * markers.length) | 0, m = markers[i];
      if (m.nb.length && dim > 0.2) fire(i, m.nb[(Math.random() * m.nb.length) | 0], 0.75);
    }
    for (let k = pulses.length - 1; k >= 0; k--) {
      const P = pulses[k]; P.p += dt * P.v;
      if (P.p >= 1) {
        const B = markers[P.j];
        B.boost = Math.max(B.boost, Math.min(1, 0.2 + 0.55 * P.e));
        B.ring = 1;
        if (P.e * 0.62 > 0.3 && Math.random() < 0.75) {
          const nx = B.nb.filter((n) => n !== P.i);
          if (nx.length) fire(P.j, nx[(Math.random() * nx.length) | 0], P.e * 0.62);
        }
        pulses.splice(k, 1);
      }
    }
  }

  function pin(x: number, y: number, scale: number, colour: string, label: string | null, alpha: number) {
    const c = ctx!;
    const r = 7 * scale, hy = y - r * 2.1;
    c.globalAlpha = alpha;
    c.beginPath();
    c.moveTo(x, y);
    c.bezierCurveTo(x - r * 0.6, y - r * 0.9, x - r, hy + r * 0.55, x - r, hy);
    c.arc(x, hy, r, Math.PI, 0);
    c.bezierCurveTo(x + r, hy + r * 0.55, x + r * 0.6, y - r * 0.9, x, y);
    c.closePath();
    c.fillStyle = colour; c.fill();
    c.lineWidth = 1.5; c.strokeStyle = 'rgba(8,13,16,0.9)'; c.stroke();
    if (label) {
      c.fillStyle = '#04182e'; c.font = `600 ${Math.round(8.5 * scale)}px "JetBrains Mono", monospace`;
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(label, x, hy + 0.5);
    } else {
      c.beginPath(); c.arc(x, hy, r * 0.36, 0, 6.2832); c.fillStyle = '#04182e'; c.fill();
    }
    c.globalAlpha = 1;
  }

  function walkerDot(x: number, y: number, alpha: number, z: number, now: number) {
    const c = ctx!;
    const t = (now % 1800) / 1800;
    c.globalAlpha = alpha;
    c.strokeStyle = `rgba(${BLUE},${(0.55 * (1 - t)).toFixed(3)})`; c.lineWidth = 1.5 / z;
    c.beginPath(); c.arc(x, y, (8 + 26 * t) / z, 0, 6.2832); c.stroke();
    c.fillStyle = `rgba(${BLUE},0.2)`; c.beginPath(); c.arc(x, y, 15 / z, 0, 6.2832); c.fill();
    c.fillStyle = '#ffffff'; c.beginPath(); c.arc(x, y, 7 / z, 0, 6.2832); c.fill();
    c.fillStyle = '#2997ff'; c.beginPath(); c.arc(x, y, 5 / z, 0, 6.2832); c.fill();
    c.globalAlpha = 1;
  }

  function frame(now: number) {
    raf = 0;
    if (!base) return;
    const c = ctx!;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;

    let s = 0;
    if (story) {
      const wr = story.scroller.getBoundingClientRect();
      const target = clamp(-wr.top / Math.max(1, wr.height - H), 0, 1) * 3.5;
      sNow += (target - sNow) * (reduced ? 1 : 1 - Math.exp(-dt * 10));
      s = sNow;
    }
    const b = story ? ease(clamp((s - 0.25) / 0.75, 0, 1)) : 0;
    const w = story ? ease(clamp((s - 1.25) / 0.75, 0, 1)) : 0;
    const f = story ? ease(clamp((s - 2.25) / 0.75, 0, 1)) : 0;
    const free = story ? 1 - ease(clamp((s - 0.05) / 0.35, 0, 1)) : 1;
    const dim = 1 - 0.62 * b;
    if (!reduced) { if (free > 0) stepWalker(dt, now); stepNet(dt, dim, free); }

    const F = story && trail.length > 1 ? markers[trail[1]] : null;
    const z = F && !reduced ? 1 + 1.5 * f : 1;
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    c.fillStyle = NIGHT; c.fillRect(0, 0, W, H);
    if (F) {
      const px = mobile ? W * 0.5 : W * 0.7, py = mobile ? H * 0.36 : H * 0.52;
      const cx = F.x + (px - F.x) * f, cy = F.y + (py - F.y) * f;
      c.setTransform(DPR * z, 0, 0, DPR * z, DPR * (cx - F.x * z), DPR * (cy - F.y * z));
    }
    c.drawImage(base, 0, 0, W, H);

    // The network: a thin line between every pair of neighbours.
    c.lineWidth = 1 / z;
    for (const [ia, ib] of links) {
      const A = markers[ia], B = markers[ib];
      const al = (0.15 + 0.45 * Math.max(A.a, B.a)) * dim;
      if (al < 0.01) continue;
      c.strokeStyle = `rgba(${BLUE},${al.toFixed(3)})`;
      c.beginPath(); c.moveTo(A.x, A.y); c.lineTo(B.x, B.y); c.stroke();
    }

    if (b > 0) {
      c.lineWidth = 2 / z; c.setLineDash([6 / z, 6 / z]); c.lineDashOffset = reduced ? 0 : -now / 60 / z;
      for (let k = 0; k < trail.length - 1; k++) {
        const u = clamp((b - (0.2 + k * 0.15)) / 0.15, 0, 1); if (u <= 0) continue;
        const A = markers[trail[k]], B = markers[trail[k + 1]];
        c.strokeStyle = `rgba(140,200,255,${(0.8 * (1 - 0.6 * f)).toFixed(3)})`;
        c.beginPath(); c.moveTo(A.x, A.y); c.lineTo(A.x + (B.x - A.x) * u, A.y + (B.y - A.y) * u); c.stroke();
      }
      c.setLineDash([]); c.lineDashOffset = 0;
    }

    let wx = 0, wy = 0;
    if (w > 0 && pathPts.length > 1) {
      const target = w * pathLen; let acc = 0;
      [wx, wy] = pathPts[0];
      c.strokeStyle = `rgba(${BLUE},0.95)`; c.lineWidth = 3.2 / z; c.lineCap = 'round'; c.lineJoin = 'round';
      c.beginPath(); c.moveTo(wx, wy);
      for (let i = 1; i < pathPts.length; i++) {
        const [x0, y0] = pathPts[i - 1], [x1, y1] = pathPts[i];
        const L = Math.hypot(x1 - x0, y1 - y0);
        if (acc + L >= target) { const u = (target - acc) / L; wx = x0 + (x1 - x0) * u; wy = y0 + (y1 - y0) * u; c.lineTo(wx, wy); break; }
        c.lineTo(x1, y1); acc += L; wx = x1; wy = y1;
      }
      c.stroke();
    }

    const breathe = reduced ? 0 : now / 1000;
    for (const m of markers) {
      if (m.trail && b > 0.02) continue;
      const a = m.a;
      // Each marker breathes on its own beat, so the network pulses even when
      // nobody is near it.
      const beat = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(breathe * 1.7 + m.phase);
      const halo = Math.max(a, 0.12 + 0.16 * beat);
      const gs = 12 + 24 * halo;
      c.globalAlpha = Math.min(1, halo * 0.95) * dim; c.drawImage(glow, m.x - gs, m.y - gs, gs * 2, gs * 2); c.globalAlpha = 1;
      c.fillStyle = `rgba(${BLUE},${((0.6 + 0.4 * Math.max(a, beat * 0.5)) * dim).toFixed(3)})`;
      c.beginPath(); c.arc(m.x, m.y, 2.4, 0, 6.2832); c.fill();
      if (m.ring > 0) {
        c.strokeStyle = `rgba(${BLUE},${(m.ring * 0.55 * dim).toFixed(3)})`; c.lineWidth = 1;
        c.beginPath(); c.arc(m.x, m.y, 4 + (1 - m.ring) * 16, 0, 6.2832); c.stroke();
      }
      if (a > 0.3) {
        c.strokeStyle = `rgba(${BLUE},${((a - 0.3) * 0.5 * dim).toFixed(3)})`; c.lineWidth = 1;
        c.beginPath(); c.arc(m.x, m.y, 8 + 18 * a, 0, 6.2832); c.stroke();
      }
      if (a > 0.12) pin(m.x, m.y, 0.55 + 0.75 * ease(clamp((a - 0.12) / 0.6, 0, 1)), a > 0.6 ? '#8cc8ff' : '#2997ff', null, Math.min(1, (a - 0.12) * 3) * dim);
    }

    if (b > 0.02) {
      trail.forEach((ti, k) => {
        const m = markers[ti];
        const u = clamp((b - (0.08 + k * 0.15)) / 0.16, 0, 1); if (u <= 0) return;
        const yo = reduced ? 0 : -30 * (1 - back(u));
        const found = (k === 0 && w > 0.04) || (k === 1 && f > 0.55);
        c.globalAlpha = u * 0.8; c.drawImage(found ? glowAmber : glow, m.x - 26, m.y - 26 + yo, 52, 52); c.globalAlpha = 1;
        c.fillStyle = 'rgba(0,0,0,0.4)'; c.beginPath(); c.ellipse(m.x, m.y, 6 * u, 2.4 * u, 0, 0, 6.2832); c.fill();
        pin(m.x, m.y + yo, 1.7, found ? '#f0a868' : '#2997ff', String(k + 1), u);
      });
      if (F && w > 0.96 && f < 0.6) {
        const rt = (now % 1600) / 1600;
        c.strokeStyle = `rgba(116,217,107,${(0.7 * (1 - rt)).toFixed(3)})`; c.lineWidth = 2 / z;
        c.beginPath(); c.arc(F.x, F.y, (10 + 30 * rt) / z, 0, 6.2832); c.stroke();
      }
    }

    if (!reduced) for (const P of pulses) {
      const A = markers[P.i], B = markers[P.j];
      const x = A.x + (B.x - A.x) * P.p, y = A.y + (B.y - A.y) * P.p;
      const pa = Math.min(1, P.e) * dim;
      c.globalAlpha = pa; c.drawImage(glow, x - 10, y - 10, 20, 20);
      c.fillStyle = '#e6f3ff'; c.beginPath(); c.arc(x, y, 1.9, 0, 6.2832); c.fill();
      for (let q = 1; q <= 3; q++) {
        const pp = Math.max(0, P.p - q * 0.035);
        c.globalAlpha = pa * (0.5 - q * 0.13);
        c.beginPath(); c.arc(A.x + (B.x - A.x) * pp, A.y + (B.y - A.y) * pp, 1.5, 0, 6.2832); c.fill();
      }
      c.globalAlpha = 1;
    }

    if (walker.mode !== 'off' && free > 0.01 && (useWalker || walker.mode === 'pointer')) walkerDot(walker.x, walker.y, free * (useWalker ? 1 : 0.6), 1, now);
    if (w > 0 && f < 0.98) walkerDot(wx, wy, Math.min(1, w * 4) * (1 - f), z, now);

    if (story) {
      const { strip, stripDist, phone } = story;
      if (strip) {
        const so = clamp((s - 1.05) / 0.25, 0, 1) * (1 - clamp((s - 2.2) / 0.25, 0, 1));
        strip.style.opacity = so.toFixed(3);
        strip.style.transform = `translate(-50%, ${((1 - so) * 16).toFixed(1)}px)`;
        if (stripDist) {
          const metres = Math.max(0, Math.round(((1 - w) * 240) / 5) * 5);
          const txt = w > 0.97 ? story.here : `${metres} m`;
          if (stripDist.textContent !== txt) stripDist.textContent = txt;
        }
      }
      if (phone) {
        phone.style.opacity = f.toFixed(3);
        phone.style.transform = `translate(-50%, -50%) translateY(${((1 - f) * 40).toFixed(1)}px) scale(${(0.92 + 0.08 * f).toFixed(3)})`;
        phone.classList.toggle('is-asked', f > 0.75);
        phone.classList.toggle('is-scored', s > 2.95);
      }
    }

    if (!reduced) kick();
  }

  function kick() {
    if (!raf && running && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }

  function pointAt(e: PointerEvent, touch: boolean) {
    if (sNow > 0.35) return;
    const r = host.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < 0 || y < 0 || x > r.width || y > r.height) return;
    walker.mode = 'pointer'; walker.touch = touch; walker.tx = x; walker.ty = y; walker.lastPtr = performance.now();
    if (!useWalker && walker.x === 0 && walker.y === 0) { walker.x = x; walker.y = y; }
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
    }, 120);
  });
  ro.observe(host);

  const io = new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; if (visible) kick(); });
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
    const right = hash(i, j, 4) < 0.84, down = hash(i, j, 5) < 0.84;
    if (right) {
      const [bx, by] = at(i + 1, j);
      const m = warp((base(i, j)[0] + base(i + 1, j)[0]) / 2, (base(i, j)[1] + base(i + 1, j)[1]) / 2);
      g.moveTo(ax, ay); g.quadraticCurveTo(2 * m[0] - (ax + bx) / 2, 2 * m[1] - (ay + by) / 2, bx, by);
    }
    if (down) {
      const [bx, by] = at(i, j + 1);
      const m = warp((base(i, j)[0] + base(i, j + 1)[0]) / 2, (base(i, j)[1] + base(i, j + 1)[1]) / 2);
      g.moveTo(ax, ay); g.quadraticCurveTo(2 * m[0] - (ax + bx) / 2, 2 * m[1] - (ay + by) / 2, bx, by);
    }
  }
  g.stroke();
  return c.toDataURL('image/png');
}

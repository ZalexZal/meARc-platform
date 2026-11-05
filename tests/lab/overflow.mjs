// Can a reader actually scroll sideways? The site check counts anything whose
// box passes the edge, including the clipped background canvases.
import { browser, BASE, check, done } from './lib.mjs';
const b = await browser();
for (const [w, h] of [[390, 844], [1440, 900]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  for (const path of ['/', '/en/', '/trails/', '/play/', '/signin/', '/view/?id=9232aef6-ae8b-48cd-9636-e1b85a2b1f4e']) {
    await p.goto(BASE + path); await p.waitForTimeout(1500);
    await p.mouse.wheel(0, 3000); await p.waitForTimeout(800);
    const r = await p.evaluate(() => {
      window.scrollTo(500, window.scrollY);
      const tiles = [...document.querySelectorAll('article.tile')].map((t) => Math.round(t.getBoundingClientRect().right));
      return { sw: document.documentElement.scrollWidth, sx: window.scrollX, tiles };
    });
    check(`${w}px ${path}: no sideways scroll`, r.sw <= w && r.sx === 0, JSON.stringify(r));
  }
  await p.close();
}
await b.close(); done();

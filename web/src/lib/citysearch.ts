/**
 * Finding a city to move the builder's map to (round 4, 12 Nov 2026).
 *
 * OpenStreetMap Nominatim search, the same free service lib/place.ts uses for
 * the reverse lookup, and under the same rules: no key, at most one request a
 * second, `accept-language`. Bulgaria first (`countrycodes=bg`); only when
 * nothing there matches is the rest of the world asked.
 *
 * Moving the map here changes nothing that is saved: a trail's city still
 * comes from its stops.
 */

export type CityHit = {
  name: string;
  detail: string;
  lat: number;
  lng: number;
  /** [west, south, east, north], when Nominatim gave one. */
  bbox: [number, number, number, number] | null;
};

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const PLACES = new Set(['city', 'town', 'village', 'municipality', 'administrative', 'hamlet', 'suburb', 'county', 'state', 'country', 'region', 'province']);

let last = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits so that no two requests are less than 1.1 s apart. */
async function turn() {
  const wait = last + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
}

async function ask(query: string, lang: 'bg' | 'en', bgOnly: boolean, signal?: AbortSignal): Promise<CityHit[]> {
  await turn();
  if (signal?.aborted) return [];
  const url = `${ENDPOINT}?format=jsonv2&addressdetails=1&limit=8&accept-language=${lang}`
    + (bgOnly ? '&countrycodes=bg' : '') + `&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) return [];
  const rows: any[] = await res.json();
  const seen = new Set<string>();
  const out: CityHit[] = [];
  // Places first: a street called "Yambol" is not what anyone typing it means.
  rows.sort((a, b) => Number(!PLACES.has(a.addresstype ?? a.type)) - Number(!PLACES.has(b.addresstype ?? b.type)));
  for (const r of rows) {
    const name = r.name || String(r.display_name ?? '').split(',')[0];
    const a = r.address ?? {};
    const detail = [a.state ?? a.county, a.country].filter(Boolean).filter((x: string) => x !== name).join(', ');
    const key = `${name}|${detail}`;
    if (!name || seen.has(key)) continue;
    seen.add(key);
    const b = Array.isArray(r.boundingbox) ? r.boundingbox.map(Number) : null;
    out.push({
      name, detail, lat: Number(r.lat), lng: Number(r.lon),
      bbox: b && b.every(Number.isFinite) ? [b[2], b[0], b[3], b[1]] : null,
    });
    if (out.length >= 6) break;
  }
  return out;
}

/** Places matching `query`: Bulgaria first, then anywhere. Empty on any error. */
export async function searchCities(query: string, lang: 'bg' | 'en', signal?: AbortSignal): Promise<CityHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const home = await ask(q, lang, true, signal);
    if (home.length || signal?.aborted) return home;
    return await ask(q, lang, false, signal);
  } catch {
    return [];
  }
}

type Strings = { none: string; searching: string };

/**
 * Wires an input into a combobox: suggestions as you type (400 ms after the
 * last key), arrows to move, Enter to choose, Escape to close.
 */
export function cityCombobox(
  input: HTMLInputElement,
  list: HTMLUListElement,
  lang: 'bg' | 'en',
  strings: Strings,
  onPick: (hit: CityHit) => void,
) {
  let hits: CityHit[] = [];
  let active = -1;
  let timer = 0;
  let pending: AbortController | null = null;

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', list.id);
  list.setAttribute('role', 'listbox');

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };

  const note = (msg: string) => {
    const li = document.createElement('li');
    li.className = 'city-note';
    li.textContent = msg;
    list.replaceChildren(li);
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  const paint = () => {
    list.replaceChildren(...hits.map((h, i) => {
      const li = document.createElement('li');
      li.id = `${list.id}-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === active));
      li.className = 'city-opt' + (i === active ? ' is-on' : '');
      const n = document.createElement('span');
      n.className = 'city-name';
      n.textContent = h.name;
      const d = document.createElement('span');
      d.className = 'city-detail';
      d.textContent = h.detail;
      li.append(n, d);
      // mousedown, not click: the input's blur would close the list first.
      li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(i); });
      return li;
    }));
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (active >= 0) input.setAttribute('aria-activedescendant', `${list.id}-${active}`);
    else input.removeAttribute('aria-activedescendant');
  };

  const choose = (i: number) => {
    const h = hits[i];
    if (!h) return;
    input.value = h.name;
    close();
    onPick(h);
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    pending?.abort();
    const query = input.value.trim();
    if (query.length < 2) { hits = []; close(); return; }
    timer = window.setTimeout(async () => {
      pending = new AbortController();
      const signal = pending.signal;
      note(strings.searching);
      const found = await searchCities(query, lang, signal);
      if (signal.aborted) return;
      hits = found;
      active = hits.length ? 0 : -1;
      if (hits.length) paint(); else note(strings.none);
    }, 400);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (!list.hidden) { e.preventDefault(); close(); } return; }
    if (!hits.length || list.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % hits.length; paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + hits.length) % hits.length; paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(Math.max(active, 0)); }
  });

  input.addEventListener('blur', () => window.setTimeout(close, 120));
}

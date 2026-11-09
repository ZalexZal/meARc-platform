/**
 * A trail's city, from a point, via OpenStreetMap Nominatim (free, no key, 1 request/s).
 *
 * The city is `city`, else `town`, else `municipality`, else `state_district` (where Nominatim
 * puts a Bulgarian municipality). Never a village, suburb or hamlet: a plot outside a town
 * files under its municipality rather than a tiny village, so "Education · Yambol" groups
 * trails the way people think of them.
 *
 * Used by the builder (browser) and the back-fill script (Node), so it touches nothing but
 * `fetch`, which can be swapped for tests.
 */

export type City = { key: string; bg: string; en: string; lat: number; lng: number };

const ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';

/** The place name from a Nominatim `address`, or null when it is only a village or less. */
export function pickPlace(address: Record<string, string> | null | undefined): string | null {
  const a = address ?? {};
  const raw = a.city ?? a.town ?? a.municipality ?? a.state_district;
  if (!raw) return null;
  const name = raw
    .replace(/^Община\s+/i, '')
    .replace(/^Municipality of\s+/i, '')
    .replace(/\s+Municipality$/i, '')
    .trim();
  return name || null;
}

/** Great-circle distance in km (haversine). */
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

async function place(lat: number, lng: number, lang: 'bg' | 'en', fetchImpl: typeof fetch): Promise<string | null> {
  const url = `${ENDPOINT}?format=jsonv2&zoom=10&lat=${lat}&lon=${lng}&accept-language=${lang}`;
  // A browser forbids setting User-Agent; Nominatim's policy needs one from scripts.
  const init: RequestInit | undefined =
    typeof window === 'undefined' ? { headers: { 'User-Agent': 'ARTrail/1.0 (artrails.netlify.app)' } } : undefined;
  const res = await fetchImpl(url, init);
  if (!res.ok) return null;
  const body = await res.json();
  return pickPlace(body?.address);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The city at a point, in Bulgarian and English. Null on any error or when there is no city.
 * The two requests go one after the other, `wait` ms apart (1.1 s by default) in the browser
 * and in Node alike, to keep to Nominatim's 1 request/s.
 */
export async function cityAt(
  lat: number,
  lng: number,
  fetchImpl: typeof fetch = fetch,
  wait = 1100,
): Promise<City | null> {
  try {
    const bg = await place(lat, lng, 'bg', fetchImpl);
    if (!bg) return null;
    await sleep(wait);
    const en = await place(lat, lng, 'en', fetchImpl);
    if (!en) return null;
    return { key: en.toLowerCase().trim(), bg, en, lat, lng };
  } catch {
    return null;
  }
}

/** True only when every stop is more than `km` from the city's point. No stops: false. */
export function farFrom(city: City, stops: { lat: number; lng: number }[], km = 5): boolean {
  if (!stops.length) return false;
  return stops.every((s) => distanceKm(city.lat, city.lng, s.lat, s.lng) > km);
}

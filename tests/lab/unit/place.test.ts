import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cityAt, pickPlace, farFrom, distanceKm } from '../../../web/src/lib/place.ts';

const fx = (n: string) => JSON.parse(readFileSync(new URL(`../fixtures/nominatim-${n}.json`, import.meta.url), 'utf8'));

// Fake fetch: answers from fixtures by the accept-language of the request. Never touches the network.
function fakeFetch(bg: unknown, en: unknown, seen: string[] = []) {
  return (async (url: string | URL | Request) => {
    const u = String(url);
    seen.push(u);
    const body = u.includes('accept-language=bg') ? bg : en;
    return { ok: true, json: async () => body } as Response;
  }) as typeof fetch;
}

test('Yambol centre gives key yambol, bg Ямбол', async () => {
  const c = await cityAt(42.4842, 26.5035, fakeFetch(fx('yambol-bg'), fx('yambol-en')));
  assert.deepEqual(c, { key: 'yambol', bg: 'Ямбол', en: 'Yambol', lat: 42.4842, lng: 26.5035 });
});

test('a village files under its municipality, never the village', async () => {
  // Real Nominatim reply for Кабиле: village + state_district (Тунджа), no city/town/municipality.
  assert.equal(pickPlace(fx('village-bg').address), 'Тунджа');
  const c = await cityAt(42.5497, 26.492, fakeFetch(fx('village-bg'), fx('village-en')));
  assert.deepEqual(c, { key: fx('village-en').address.state_district.toLowerCase().trim(), bg: 'Тунджа', en: fx('village-en').address.state_district, lat: 42.5497, lng: 26.492 });
  assert.equal(c?.key, 'tundzha');
});

test('pickPlace order and "Община" stripping', () => {
  assert.equal(pickPlace({ city: 'Ямбол', town: 'X', municipality: 'Y' }), 'Ямбол');
  assert.equal(pickPlace({ town: 'Елхово', municipality: 'Y' }), 'Елхово');
  assert.equal(pickPlace({ municipality: 'Община Тунджа' }), 'Тунджа');
  assert.equal(pickPlace({ municipality: 'Municipality of Tundzha' }), 'Tundzha');
  assert.equal(pickPlace({ municipality: 'Tundzha Municipality' }), 'Tundzha');
  assert.equal(pickPlace({ village: 'Кабиле', suburb: 'S', hamlet: 'H' }), null);
  assert.equal(pickPlace({ village: 'Кабиле', state_district: 'Тунджа' }), 'Тунджа');
  assert.equal(pickPlace({ municipality: 'M', state_district: 'S' }), 'M');
  assert.equal(pickPlace({}), null);
});

test('empty reply gives null', async () => {
  assert.equal(await cityAt(0, -140, fakeFetch(fx('empty'), fx('empty'))), null);
});

test('a fetch that throws, or a bad status, gives null', async () => {
  const boom = (async () => { throw new Error('offline'); }) as typeof fetch;
  assert.equal(await cityAt(42.48, 26.5, boom), null);
  const bad = (async () => ({ ok: false, status: 429, json: async () => ({}) })) as unknown as typeof fetch;
  assert.equal(await cityAt(42.48, 26.5, bad), null);
});

test('requests are the documented URL, bg then en, one at a time', async () => {
  const seen: string[] = [];
  await cityAt(42.4842, 26.5035, fakeFetch(fx('yambol-bg'), fx('yambol-en'), seen));
  assert.equal(seen.length, 2);
  assert.equal(seen[0], 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&lat=42.4842&lon=26.5035&accept-language=bg');
  assert.equal(seen[1], 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&lat=42.4842&lon=26.5035&accept-language=en');
});

test('farFrom: false if any stop is near, true only if all are beyond km', () => {
  const city = { key: 'yambol', bg: 'Ямбол', en: 'Yambol', lat: 42.4842, lng: 26.5035 };
  const dLat = (km: number) => km / 111.195;
  assert.equal(farFrom(city, [{ lat: city.lat + dLat(1), lng: city.lng }, { lat: city.lat + dLat(6), lng: city.lng }]), false);
  assert.equal(farFrom(city, [{ lat: city.lat + dLat(6), lng: city.lng }, { lat: city.lat - dLat(7), lng: city.lng }]), true);
  assert.equal(farFrom(city, [{ lat: city.lat + dLat(6), lng: city.lng }], 10), false);
});

test('distanceKm is haversine', () => {
  assert.ok(Math.abs(distanceKm(0, 0, 0, 1) - 111.195) < 0.1);
  assert.equal(distanceKm(42.5, 26.5, 42.5, 26.5), 0);
});

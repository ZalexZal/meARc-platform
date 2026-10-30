/**
 * Walking a trail on the website (web lite): where you are, and when you are
 * at a stop. Design: docs/superpowers/specs/2026-10-30-web-lite-design.md.
 *
 * The rules are YambolTrails' (docs/gps.md there), field-tested in Yambol:
 * high-accuracy watchPosition, a reading worse than 50 m does not count, a
 * stop opens after two good readings in a row inside its circle, a fresh
 * reading is asked 2.5 s after the first good one (some phones report only on
 * a change), the screen is kept awake, and tracking stops while the page is
 * hidden. The server checks every visit again (record_visit, 0057); this only
 * decides when to ask it.
 */

export type Fix = { lat: number; lng: number; accuracy: number; heading: number | null; at: number };

export const MAX_ACCURACY_M = 50;
const R = 6371008.8;

/** Great-circle distance in metres, the same formula as the database's. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Compass bearing from a to b, 0-360, north = 0. */
export function bearing(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad)
          - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

/** "N", "NE" ... for a bearing; the words come from the page's strings. */
export function compass(deg: number, words: string[]): string {
  return words[Math.round(deg / 45) % 8];
}

/** 80 m, 1.2 km. */
export function metres(m: number): string {
  return m < 1000 ? `${Math.round(m / 5) * 5} m` : `${(m / 1000).toFixed(1)} km`;
}

export type LocationState = 'idle' | 'asking' | 'ok' | 'denied' | 'unavailable';

/**
 * One watchPosition, its readings, and which stop circle the last two good
 * ones agreed on. `onFix` gets every reading; `onArrive` a stop id once two
 * good readings in a row fell inside its circle.
 */
export class Tracker {
  state: LocationState = 'idle';
  last: Fix | null = null;
  private watch: number | null = null;
  private lock: { release(): Promise<void> } | null = null;
  private streak = new Map<string, number>();
  private nudge = 0;

  constructor(
    private stops: () => { id: string; lat: number; lng: number; radius: number }[],
    private onFix: (fix: Fix) => void,
    private onArrive: (id: string, fix: Fix) => void,
    private onState: (state: LocationState) => void,
  ) {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause(); else if (this.state !== 'idle') this.start();
    });
  }

  /** What the browser says about location, before asking. */
  static async permission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
    try {
      const p = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
      return p.state as 'granted' | 'denied' | 'prompt';
    } catch { return 'unknown'; }
  }

  /** One reading, for the lobby's check. Resolves with it or the reason not. */
  static once(): Promise<Fix | LocationState> {
    return new Promise((resolve) => {
      if (!('geolocation' in navigator)) return resolve('unavailable');
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy,
                         heading: p.coords.heading ?? null, at: p.timestamp }),
        (e) => resolve(e.code === e.PERMISSION_DENIED ? 'denied' : 'unavailable'),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    });
  }

  start() {
    if (!('geolocation' in navigator)) { this.set('unavailable'); return; }
    if (this.watch !== null) return;
    this.set(this.last ? 'ok' : 'asking');
    this.watch = navigator.geolocation.watchPosition(
      (p) => this.read({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy,
                         heading: p.coords.heading ?? null, at: p.timestamp }),
      (e) => {
        // A timeout or a moment without a position, within a minute of a good
        // fix, is a quiet street or a passing gap, not lost location.
        if (e.code !== e.PERMISSION_DENIED && this.last && Date.now() - this.last.at < 60000) return;
        this.set(e.code === e.PERMISSION_DENIED ? 'denied' : 'unavailable');
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
    this.wake();
  }

  pause() {
    if (this.watch !== null) navigator.geolocation.clearWatch(this.watch);
    this.watch = null;
    this.lock?.release().catch(() => {});
    this.lock = null;
  }

  /** A stop just dealt with starts counting again from nothing. */
  forget(id: string) { this.streak.delete(id); }

  private set(state: LocationState) {
    if (this.state !== state) { this.state = state; this.onState(state); }
  }

  private async wake() {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } };
      if (nav.wakeLock && !this.lock) this.lock = await nav.wakeLock.request('screen');
    } catch { /* not supported, or refused: the walk works without it */ }
  }

  private read(fix: Fix) {
    this.last = fix;
    this.set('ok');
    this.onFix(fix);
    if (fix.accuracy > MAX_ACCURACY_M) { this.streak.clear(); return; }

    const inside = new Set<string>();
    for (const s of this.stops()) {
      if (distanceM(fix, s) <= s.radius) inside.add(s.id);
    }
    for (const id of [...this.streak.keys()]) if (!inside.has(id)) this.streak.delete(id);
    for (const id of inside) {
      const n = (this.streak.get(id) ?? 0) + 1;
      this.streak.set(id, n);
      if (n >= 2) this.onArrive(id, fix);
    }

    // Some phones only report when the position changes: ask once more soon
    // after the first good reading, so somebody standing still is not stuck.
    if (inside.size && [...inside].some((id) => this.streak.get(id) === 1)) {
      clearTimeout(this.nudge);
      this.nudge = window.setTimeout(() => {
        navigator.geolocation.getCurrentPosition(
          (p) => this.read({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy,
                             heading: p.coords.heading ?? null, at: p.timestamp }),
          () => {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
      }, 2500);
    }
  }
}

/** Which browser this is, for the steps to unblock location. */
export function browserKind(): 'ios-safari' | 'ios-chrome' | 'android-chrome' | 'samsung' | 'firefox' | 'desktop' {
  const ua = navigator.userAgent;
  if (/SamsungBrowser/i.test(ua)) return 'samsung';
  if (/Firefox|FxiOS/i.test(ua)) return 'firefox';
  if (/iPhone|iPad|iPod/i.test(ua)) return /CriOS/i.test(ua) ? 'ios-chrome' : 'ios-safari';
  if (/Android/i.test(ua)) return 'android-chrome';
  return 'desktop';
}

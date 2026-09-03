/**
 * Page-level auth: who is signed in, and what to do when nobody is.
 *
 * Every signed-in page is still a static file, so the guard runs in the browser
 * after load. That means a flash of the page before a redirect, which is why
 * `guard` hides the content until it knows - not for security (there is none in
 * hiding a static file) but because a page that shows itself and then throws you
 * out reads as a bug.
 *
 * The security is in the database. Every one of these pages can only render data
 * the caller's own token is allowed to fetch.
 */
import { db, configured, isAnonymous } from './supabase';
import type { User } from '@supabase/supabase-js';

export type Who = { user: User | null; anonymous: boolean; configured: boolean };

export async function who(): Promise<Who> {
  if (!configured()) return { user: null, anonymous: false, configured: false };
  const { data } = await db()!.auth.getUser();
  const user = data.user ?? null;
  return { user, anonymous: isAnonymous(user), configured: true };
}

/**
 * Resolves with the signed-in user, or sends an anonymous/absent visitor to
 * sign in and never resolves.
 *
 * `needsReal` is for pages that a converted anonymous user still cannot use -
 * creating a trail, for instance - so they are asked to finish signing up
 * rather than being told they are not signed in, which they are.
 */
export async function requireUser(
  { needsReal = true, signInPath = '/signin' } = {}
): Promise<User> {
  const { user, anonymous, configured: ok } = await who();

  if (!ok) {
    document.body.dataset.authState = 'unconfigured';
    return new Promise(() => {});
  }

  if (!user || (needsReal && anonymous)) {
    const back = encodeURIComponent(location.pathname + location.search);
    location.replace(`${signInPath}?next=${back}`);
    return new Promise(() => {});
  }

  return user;
}

/** Reveals a page once the guard has decided. Paired with `hidden` in the markup. */
export function reveal(selector = '[data-guarded]') {
  document.querySelectorAll(selector).forEach((el) => el.removeAttribute('hidden'));
}

/** The query string value a client-rendered detail page needs. */
export const param = (name: string) =>
  new URLSearchParams(location.search).get(name);

/**
 * Text into the DOM, never markup.
 *
 * Trail names, team names and submitted answers are all written by other
 * people. This exists so that "put it on the page" is never a decision.
 */
export function text(el: Element | null, value: unknown) {
  if (el) el.textContent = value === null || value === undefined ? '' : String(value);
}

export const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** hh:mm:ss from a count of seconds, for elapsed times on a board. */
export function duration(seconds: number | null): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
    : `${m}:${String(r).padStart(2, '0')}`;
}

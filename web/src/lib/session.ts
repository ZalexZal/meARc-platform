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
import { db, configured, isAnonymous, finishPending } from './supabase';
import { TERMS_VERSION } from './terms';
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
  // In the reader's language. It was '/signin' for everybody, so an English
  // reader who opened /en/account/ signed out landed on the Bulgarian form.
  { needsReal = true, signInPath = location.pathname.startsWith('/en/') ? '/en/signin' : '/signin',
    terms = true, role = true } = {}
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

  // The terms this site runs on now. An account that accepted older ones -
  // or none, because confirmation held its sign-up back - is asked before it
  // goes further. Guests are asked by the app, which is where guests are.
  if (terms && !anonymous) {
    const read = async () => (await db()!.from('profiles')
      .select('terms_version').eq('id', user.id).maybeSingle()).data?.terms_version;

    if ((await read()) !== TERMS_VERSION) {
      await finishPending(user);

      if ((await read()) !== TERMS_VERSION) {
        const back = encodeURIComponent(location.pathname + location.search);
        const gate = location.pathname.startsWith('/en/') ? '/en/accept-terms' : '/accept-terms';
        location.replace(`${gate}/?next=${back}`);
        return new Promise(() => {});
      }
    }
  }

  // Creator or viewer, asked once of every account. After the terms, so a
  // person owed both sees the terms first. A failed read lets them through.
  if (role && !anonymous && !roleExempt(location.pathname)) {
    const { data, error } = await db()!.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (!error && data && data.role === null) {
      toChooseRole();
      return new Promise(() => {});
    }
  }

  return user;
}

/**
 * Pages a never-asked account may still open: the screen itself, the ways in
 * and out of an account, and the documents those link to. Both languages.
 */
const ROLE_EXEMPT = /^\/(en\/)?(choose-role|signin|signup|confirmed|accept-terms|terms|privacy|reset|consent|parent)(\/|$)/;
export const roleExempt = (path: string) => ROLE_EXEMPT.test(path);

function toChooseRole() {
  const back = encodeURIComponent(location.pathname + location.search);
  const gate = location.pathname.startsWith('/en/') ? '/en/choose-role' : '/choose-role';
  location.replace(`${gate}/?next=${back}`);
}

/**
 * The site-wide half of the role question, run by the base layout on every
 * page: a signed-in account (not a guest) whose role is still null is sent to
 * choose it. Guests, exempt pages, a failed read and an account still owed the
 * terms (the terms gate goes first) are all left where they are. Resolves true
 * when it redirected.
 */
export async function roleGate(): Promise<boolean> {
  try {
    if (!configured() || roleExempt(location.pathname)) return false;
    const c = db()!;
    const { data: { session } } = await c.auth.getSession();
    const user = session?.user ?? null;
    if (!user || isAnonymous(user)) return false;
    const { data, error } = await c.from('profiles')
      .select('role, terms_version').eq('id', user.id).maybeSingle();
    if (error || !data) return false;
    if (data.terms_version !== TERMS_VERSION) return false;
    if (data.role !== null) return false;
    toChooseRole();
    return true;
  } catch {
    return false;
  }
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
/**
 * A number and the noun it counts.
 *
 * Bulgarian and English both split at one, so two forms is the whole of it -
 * "1 спирка" and "2 спирки". Every count on the site went through the plural
 * form alone, which is how a trail with a single stop announced "1 спирки".
 */
export const count = (n: number, one: string, many: string) =>
  `${n} ${Number(n) === 1 ? one : many}`;

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

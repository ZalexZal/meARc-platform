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
  // This page runs its own gates; the base layout's roleGate stands aside.
  document.body.dataset.gateByPage = '1';
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

  // The terms this site runs on now, then creator or viewer. An account that
  // accepted older terms - or none, because confirmation held its sign-up back
  // - is asked those first; one owed both is sent to the terms with the role
  // question as the next stop. Guests are asked by the app, which is where
  // guests are. One profile read, shared with the base layout's roleGate.
  if ((terms || role) && !anonymous) {
    let profile = await gateProfile(user.id);

    if (terms && profile?.terms_version !== TERMS_VERSION) {
      await finishPending(user);
      profile = await gateProfile(user.id, true);
    }

    const to = gateTarget(profile, { terms, role });
    if (to) {
      location.replace(to);
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

type GateProfile = { terms_version: string | null; role: string | null };

// One read of the two answers per page, shared by requireUser and roleGate
// (both import this module, so both see the same promise). undefined = the
// read failed.
let gateRead: { id: string; p: Promise<GateProfile | null | undefined> } | null = null;
function gateProfile(id: string, fresh = false): Promise<GateProfile | null | undefined> {
  if (!gateRead || gateRead.id !== id || fresh) {
    const p = Promise.resolve(db()!.from('profiles').select('terms_version, role').eq('id', id).maybeSingle())
      .then(({ data, error }) => (error ? undefined : (data as GateProfile | null)))
      .catch(() => undefined);
    gateRead = { id, p };
  }
  return gateRead.p;
}

const en = () => location.pathname.startsWith('/en/');

/**
 * Where this account has to go first, or null to stay. Terms before role: a
 * person owed both goes to the terms, and from there to the role question,
 * and from there back here.
 *
 * A failed read is "terms owed" (as it always was: the terms page asks again)
 * but never "role owed": the role question is only asked of a known null.
 */
function gateTarget(profile: GateProfile | null | undefined,
                    { terms = true, role = true } = {}): string | null {
  const back = location.pathname + location.search + location.hash;
  const chooseRole = `${en() ? '/en' : ''}/choose-role/`;
  const acceptTerms = `${en() ? '/en' : ''}/accept-terms/`;
  const termsOwed = terms && profile?.terms_version !== TERMS_VERSION;
  const roleOwed = role && !!profile && profile.role === null && !roleExempt(location.pathname);

  if (termsOwed) {
    const after = roleOwed ? `${chooseRole}?next=${encodeURIComponent(back)}` : back;
    return `${acceptTerms}?next=${encodeURIComponent(after)}`;
  }
  return roleOwed ? `${chooseRole}?next=${encodeURIComponent(back)}` : null;
}

/**
 * The site-wide half of the role question, run by the base layout on every
 * page. A signed-in account (not a guest) whose role is still null is sent to
 * choose it - by way of the terms, when those are owed too. Guests, exempt
 * pages, pages that run requireUser (they gate themselves), a failed read and
 * an account whose role is set are all left alone. Resolves true when it
 * redirected.
 */
export async function roleGate(): Promise<boolean> {
  try {
    if (!configured() || roleExempt(location.pathname)) return false;
    const c = db()!;
    const { data: { session } } = await c.auth.getSession();
    const user = session?.user ?? null;
    if (!user || isAnonymous(user)) return false;
    if (document.body.dataset.gateByPage) return false;

    let profile = await gateProfile(user.id);
    if (document.body.dataset.gateByPage) return false;
    if (!profile || profile.role !== null) return false;

    // Owed the role. If the terms look owed as well, finish a held sign-up
    // first, the way requireUser does, before sending anyone to accept them.
    if (profile.terms_version !== TERMS_VERSION) {
      await finishPending(user);
      profile = await gateProfile(user.id, true);
      if (!profile || profile.role !== null) return false;
    }

    const to = gateTarget(profile);
    if (!to || document.body.dataset.gateByPage) return false;
    location.replace(to);
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

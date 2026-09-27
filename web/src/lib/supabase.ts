/**
 * The one Supabase client, and the account rules that go with it.
 *
 * The anon key is public by design - it is the same key that ships inside the
 * APK - and it is the only key this site ever sees. The service_role key does
 * not belong in a browser, a build variable, or this repository.
 *
 * Config comes from PUBLIC_ environment variables at build time, falling back
 * to the values on window that web/config.local.js sets for local work. Both
 * are anon-key-only, so neither is a secret; they are separated so a deploy does
 * not depend on a gitignored file existing.
 */
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

declare global {
  interface Window {
    ARTRAIL_CONFIG?: { SUPABASE_URL: string; SUPABASE_ANON_KEY: string };
  }
}

const url =
  import.meta.env.PUBLIC_SUPABASE_URL ??
  (typeof window !== 'undefined' ? window.ARTRAIL_CONFIG?.SUPABASE_URL : undefined);

const anon =
  import.meta.env.PUBLIC_SUPABASE_ANON_KEY ??
  (typeof window !== 'undefined' ? window.ARTRAIL_CONFIG?.SUPABASE_ANON_KEY : undefined);

let client: SupabaseClient | null = null;

/**
 * Null when the site was built without credentials, rather than a client that
 * throws on first use. Every caller has to handle "no backend" anyway - it is
 * the same branch as "no network" - and a null is easier to read than a stub
 * that fails somewhere else.
 */
export function db(): SupabaseClient | null {
  if (client) return client;
  if (!url || !anon) return null;

  client = createClient(url, anon, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

export const configured = () => Boolean(url && anon);

/**
 * A page of ours for an emailed link to land on, in the reader's language.
 * Absolute, because the link is opened from an inbox, maybe on another device.
 */
export const landing = (page: string) =>
  `${location.origin}${location.pathname.startsWith('/en/') ? '/en' : ''}/${page}/`;

// ---------------------------------------------------------------- accounts

export async function currentUser(): Promise<User | null> {
  const c = db();
  if (!c) return null;
  const { data } = await c.auth.getUser();
  return data.user ?? null;
}

export const isAnonymous = (user: User | null) =>
  Boolean(user && (user as unknown as { is_anonymous?: boolean }).is_anonymous);

/**
 * Signs up, converting an anonymous session in place when there is one.
 *
 * This is the single most important function on the site and the one most
 * likely to be written the wrong way round. Somebody who has already walked
 * half a trail on their phone is an anonymous row in auth.users with real
 * progress hanging off its id. Calling signUp() would mint a *second* user and
 * silently strand the first one's teams, solved stops and submissions.
 *
 * updateUser() on the live anonymous session converts that same row: same uid,
 * so nothing has to be migrated because nothing moved.
 */
export async function signUp(email: string, password: string, displayName?: string,
                             extra: Record<string, unknown> = {}) {
  const c = db();
  if (!c) return { error: 'not-configured' as const };

  const { data: sessionData } = await c.auth.getSession();
  const existing = sessionData.session?.user ?? null;
  const upgrading = isAnonymous(existing);
  const idBefore = existing?.id ?? null;

  // Where the confirmation link lands, once confirmations are switched on.
  // Ignored while they are off, because no link is sent.
  const emailRedirectTo = landing('confirmed');

  const result = upgrading
    ? await c.auth.updateUser({ email, password, data: { display_name: displayName, ...extra } },
                              { emailRedirectTo })
    : await c.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName, ...extra }, emailRedirectTo },
      });

  if (result.error) return { error: result.error.message };

  if (displayName) {
    // Best effort. A profile row that keeps its default name is a cosmetic
    // problem; a failed sign-up because a name did not save is not.
    await c.from('profiles').update({ display_name: displayName }).eq('id', result.data.user?.id ?? '');
  }

  return {
    error: null,
    upgraded: upgrading,
    idBefore,
    idAfter: result.data.user?.id ?? null,
    // With confirmations on, updateUser leaves the account anonymous until the
    // link is opened. The caller has to say so rather than claim success.
    needsConfirmation: !result.data.user?.email_confirmed_at,
  };
}

/**
 * Sends the confirmation link again. An account made from a guest is an email
 * change as far as the server is concerned; a brand-new one is a sign-up.
 */
export async function resendConfirmation(email: string, upgraded: boolean) {
  const c = db();
  if (!c) return { error: 'not-configured' as const };

  const { error } = await c.auth.resend({
    type: upgraded ? 'email_change' : 'signup',
    email,
    options: { emailRedirectTo: landing('confirmed') },
  });
  return { error: error?.message ?? null };
}

/**
 * Asks a parent to agree to an under-14's account.
 *
 * Two steps. The request goes on record first (request_parent_consent), then
 * Supabase Auth sends the parent a sign-in link to the consent page - the same
 * mailer, and the same settings, as a confirmation email. Opening it signs the
 * parent in, which is what proves the address is theirs; the consent page then
 * shows them the request made to it.
 *
 * The link is asked for with a plain request rather than through this client:
 * the child is signed in here, and the client would tie the link to this
 * browser, while the parent opens it on their own phone.
 */
export async function askParent(parentEmail: string, lang: 'bg' | 'en') {
  const c = db();
  if (!c || !url || !anon) return { error: 'not-configured' as const };

  const { error } = await c.rpc('request_parent_consent',
    { p_parent_email: parentEmail, p_language: lang });
  if (error) return { error: error.message };

  const consentPage = `${location.origin}${lang === 'en' ? '/en' : ''}/consent/`;
  const response = await fetch(`${url}/auth/v1/otp?redirect_to=${encodeURIComponent(consentPage)}`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: parentEmail.trim(), create_user: true }),
  }).catch(() => null);

  if (!response || !response.ok) {
    const said = response ? await response.json().catch(() => null) : null;
    return { error: said?.msg ?? said?.message ?? 'The email could not be sent.' };
  }

  return { error: null };
}

/** A 13-year-old's account, agreed to by a parent who made a code for it. */
export async function redeemParentCode(code: string) {
  const c = db();
  if (!c) return { error: 'not-configured' as const };
  const { error } = await c.rpc('redeem_child_invite', { p_code: code.trim() });
  return { error: error?.message ?? null };
}

/**
 * Remembered on this device once somebody answers "12 or younger", so the age
 * question cannot simply be answered again with a bigger number. This is the
 * neutral age screen the children's-privacy rules expect; it is no proof of
 * anything, and nothing else is kept.
 */
const TOO_YOUNG = 'artrail.tooYoung';
export const markTooYoung = () => { try { localStorage.setItem(TOO_YOUNG, '1'); } catch { /* private mode */ } };
export const isTooYoung = () => { try { return localStorage.getItem(TOO_YOUNG) === '1'; } catch { return false; } };

/**
 * Finishes a sign-up that email confirmation held back.
 *
 * With confirmation on, sign-up returns no session, so nothing could record
 * the terms, the age or the parent's request at the time. They ride in the
 * account's metadata instead, and this writes whatever is still missing the
 * first time a page has a session. Safe to call on every page.
 */
export async function finishPending(user: User) {
  const c = db();
  const meta = user.user_metadata ?? {};
  if (!c || !meta.terms_version) return;

  const { data: profile } = await c.from('profiles')
    .select('terms_version').eq('id', user.id).maybeSingle();

  if (profile && !profile.terms_version) {
    await acceptTerms(String(meta.terms_version), meta.age_band === 'under14');
  }

  if (meta.age_band === 'under14' && (meta.parent_email || meta.parent_code)) {
    const { data: state } = await c.rpc('consent_state');
    if (state?.state === 'needed') {
      if (meta.parent_code) await redeemParentCode(String(meta.parent_code));
      else await askParent(String(meta.parent_email), location.pathname.startsWith('/en/') ? 'en' : 'bg');
    }
  }
}

/**
 * Records that this account accepted a given version of the terms.
 *
 * The app has done this since 0002. The site never did - it did not even link
 * the terms - so every account made on the website carried terms_version null.
 * They had agreed to nothing because nothing had asked them. The first real
 * tester is one of those rows.
 *
 * Best effort on purpose. The account exists by the time this runs, and
 * refusing somebody entry because a bookkeeping call failed is worse than a
 * missing record the app fills in on its next session.
 */
export async function acceptTerms(version: string, under14?: boolean) {
  const c = db();
  if (!c) return { error: 'not-configured' as const };

  const { error } = await c.rpc('accept_terms',
    under14 === undefined ? { p_version: version } : { p_version: version, p_under14: under14 });
  return { error: error?.message ?? null };
}

export async function signIn(email: string, password: string) {
  const c = db();
  if (!c) return { error: 'not-configured' as const };

  const { data: sessionData } = await c.auth.getSession();
  const abandoning = isAnonymous(sessionData.session?.user ?? null);

  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  // Signing into a different account does not merge two histories. The caller
  // warns before this point; this only reports that it happened.
  return { error: null, abandonedAnonymous: abandoning };
}

/**
 * This browser only. supabase-js signs out everywhere by default, so the plain
 * Sign out button did the same thing as "Sign out on every device" - leaving
 * the website also signed you out of the app on your phone.
 */
export async function signOut() {
  await db()?.auth.signOut({ scope: 'local' });
}

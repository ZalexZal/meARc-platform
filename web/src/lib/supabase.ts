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
export async function signUp(email: string, password: string, displayName?: string) {
  const c = db();
  if (!c) return { error: 'not-configured' as const };

  const { data: sessionData } = await c.auth.getSession();
  const existing = sessionData.session?.user ?? null;
  const upgrading = isAnonymous(existing);
  const idBefore = existing?.id ?? null;

  const result = upgrading
    ? await c.auth.updateUser({ email, password, data: { display_name: displayName } })
    : await c.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName } },
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
export async function acceptTerms(version: string) {
  const c = db();
  if (!c) return { error: 'not-configured' as const };

  const { error } = await c.rpc('accept_terms', { p_version: version });
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

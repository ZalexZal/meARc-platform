/**
 * The version of the terms people are being asked to accept.
 *
 * Shared rather than copied, because an acceptance record is only worth
 * anything if it names text somebody could actually have read. The app keeps
 * the same string in SupabaseConfig.termsVersion; changing the wording means
 * changing the date in both, so everyone is asked again instead of an old
 * acceptance being held against new text.
 */
export const TERMS_VERSION = '2026-09-29';

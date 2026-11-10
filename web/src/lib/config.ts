/**
 * Site switches that are decided by people, not by users.
 *
 * ASK_AGE: whether sign-up asks "how old are you?" (and, for the youngest,
 * for a parent). Off for the competition. Everything behind it stays in
 * AuthForm.astro: set this to true and today's behaviour comes back unchanged.
 * While it is off, sign-up sends exactly what a "14 or older" answer sent
 * (age_band '14+', no parent fields).
 *
 * ARTRAIL_ASK_AGE=1 in the build environment turns it on for one build, which
 * is how tests/lab/age-flag.mjs checks that the "true" path still works.
 */
const ASK_AGE_DEFAULT = false;

const override = typeof process !== 'undefined' ? process.env?.ARTRAIL_ASK_AGE : undefined;

export const ASK_AGE: boolean = override === '1' ? true : ASK_AGE_DEFAULT;

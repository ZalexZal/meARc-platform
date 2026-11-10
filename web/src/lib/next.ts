/**
 * Where a ?next= may send somebody: only somewhere on this site.
 *
 * A prefix check ("starts with / but not //") is not enough. Browsers strip a
 * tab or newline inside a URL and read a backslash as a slash, so "/\t/evil.com"
 * and "/\evil.com" both pass it and both land on evil.com. Parsing the value
 * the way the browser will, and comparing origins, is.
 *
 * Returns the path (with query and hash) to go to, or null to use the default.
 */
export function sameSitePath(next: string | null | undefined, origin: string): string | null {
  if (!next) return null;
  try {
    const u = new URL(next, origin);
    return u.origin === origin ? u.pathname + u.search + u.hash : null;
  } catch {
    return null;
  }
}

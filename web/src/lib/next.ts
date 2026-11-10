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
    if (u.origin !== origin) return null;
    // Dot segments can resolve to a path that starts with two slashes
    // ("/.//evil.com" -> "//evil.com"), which a later navigation reads as
    // another host. Only a path with a single leading slash is followed.
    const path = u.pathname + u.search + u.hash;
    return /^\/(?![\/\\])/.test(path) ? path : null;
  } catch {
    return null;
  }
}

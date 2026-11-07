/**
 * The map's look follows the site's theme: OpenFreeMap's Liberty by day, its
 * Dark style by night. In dark mode the builder and the trail page used to
 * show a bright map in a dark page (website sweep, 6 Nov 2026).
 *
 * The maps here draw their pins as DOM markers and add no layers of their
 * own, so swapping the style keeps everything on them.
 */
import { isDay, watchTheme } from './town';

export const mapStyle = (): string =>
  `https://tiles.openfreemap.org/styles/${isDay() ? 'liberty' : 'dark'}`;

/** Re-styles the map whenever the theme changes. */
export function followTheme(map: { setStyle(url: string): unknown }): void {
  let current = mapStyle();
  watchTheme(() => {
    const next = mapStyle();
    if (next !== current) { current = next; map.setStyle(next); }
  });
}

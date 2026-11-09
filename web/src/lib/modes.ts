/**
 * The four modes are two yes/no questions: teams and standings (which is
 * points), and do the
 * stops go in order. The database keeps the four old keys; people see the two
 * answers, never the key's name.
 *
 *              in order     any order
 *   points     ctf          freefall
 *   no points  guide        educational
 */
import type { Category } from './work.ts';
import { categoryLabel } from './work.ts';
import type { City } from './place.ts';

export type Mode = 'guide' | 'freefall' | 'educational' | 'ctf';

export const isScored = (mode: string) => mode === 'ctf' || mode === 'freefall';
export const isOrdered = (mode: string) => mode === 'ctf' || mode === 'guide';

export function modeFrom(scored: boolean, ordered: boolean): Mode {
  if (scored) return ordered ? 'ctf' : 'freefall';
  return ordered ? 'guide' : 'educational';
}

const WORDS = {
  bg: { points: 'Отбори и класиране', noPoints: 'Без отбори', order: 'По ред', anyOrder: 'Свободен ред' },
  en: { points: 'Teams & standings', noPoints: 'No teams', order: 'In order', anyOrder: 'Any order' },
} as const;

/** "Points · In order": what the trail is, in the reader's words. */
export function modeLine(mode: string, lang: 'bg' | 'en'): string {
  const w = WORDS[lang];
  return `${isScored(mode) ? w.points : w.noPoints} · ${isOrdered(mode) ? w.order : w.anyOrder}`;
}

/**
 * One line that says what a trail is, on every page. Real estate has no teams or
 * order, so it reads "Category · City"; the rest read "Mode · Category · City".
 * Empty parts are dropped.
 */
export function trailLine(mode: string, category: Category, city: City | null, lang: 'bg' | 'en'): string {
  const parts = [
    category === 'estate' ? '' : modeLine(mode, lang),
    categoryLabel(category, lang),
    city?.[lang] ?? '',
  ];
  return parts.filter(Boolean).join(' · ');
}

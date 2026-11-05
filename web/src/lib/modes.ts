/**
 * The four modes are two yes/no questions: does it keep points, and do the
 * stops go in order. The database keeps the four old keys; people see the two
 * answers, never the key's name.
 *
 *              in order     any order
 *   points     ctf          freefall
 *   no points  guide        educational
 */
export type Mode = 'guide' | 'freefall' | 'educational' | 'ctf';

export const isScored = (mode: string) => mode === 'ctf' || mode === 'freefall';
export const isOrdered = (mode: string) => mode === 'ctf' || mode === 'guide';

export function modeFrom(scored: boolean, ordered: boolean): Mode {
  if (scored) return ordered ? 'ctf' : 'freefall';
  return ordered ? 'guide' : 'educational';
}

const WORDS = {
  bg: { points: 'С точки', noPoints: 'Без точки', order: 'По ред', anyOrder: 'Свободен ред' },
  en: { points: 'Points', noPoints: 'No points', order: 'In order', anyOrder: 'Any order' },
} as const;

/** "Points · In order": what the trail is, in the reader's words. */
export function modeLine(mode: string, lang: 'bg' | 'en'): string {
  const w = WORDS[lang];
  return `${isScored(mode) ? w.points : w.noPoints} · ${isOrdered(mode) ? w.order : w.anyOrder}`;
}

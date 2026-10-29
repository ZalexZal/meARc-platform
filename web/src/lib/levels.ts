import type { SupabaseClient } from '@supabase/supabase-js';
import type { Lang } from '../i18n/ui';

/**
 * Levels, as my_level() (migration 0056) reports them: 50 of them, from XP for
 * stops reached and creators' finish bonuses. The rules and the curve live in
 * the database; this file only names them.
 *
 * Ten titles, each held for five levels (I to V), so the names fit any city.
 * The app carries the same list (AppStrings), so a walker is called the same
 * thing on both. Proposed 30 October 2026, for Alex to review.
 */
const TITLES: Record<Lang, string[]> = {
  bg: ['Новак', 'Пешеходец', 'Изследовател', 'Следотърсач', 'Пътешественик',
       'Пътеводител', 'Разказвач', 'Пазител', 'Летописец', 'Легенда'],
  en: ['Newcomer', 'Walker', 'Explorer', 'Pathfinder', 'Wayfarer',
       'Guide', 'Storyteller', 'Keeper', 'Chronicler', 'Legend'],
};
const TIERS = ['I', 'II', 'III', 'IV', 'V'];

export type Level = { xp: number; level: number; floor: number; next: number | null; max: number };

/** "Пешеходец I" for level 6. */
export function levelName(level: number, lang: Lang): string {
  const i = Math.max(0, Math.min(49, level - 1));
  return `${TITLES[lang][Math.floor(i / 5)]} ${TIERS[i % 5]}`;
}

/** How far through this level, 0 to 1 (1 at the top level). */
export function levelProgress(l: Level): number {
  if (l.next === null) return 1;
  return Math.max(0, Math.min(1, (l.xp - l.floor) / Math.max(1, l.next - l.floor)));
}

/** The signed-in person's level, or null if it cannot be read. */
export async function myLevel(client: SupabaseClient): Promise<Level | null> {
  const { data, error } = await client.rpc('my_level');
  return error || !data ? null : (data as Level);
}

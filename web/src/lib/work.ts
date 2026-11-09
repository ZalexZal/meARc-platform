/**
 * Line of work, what each one gets to see, trail categories, and search
 * matching. Pure and dependency-free so every page can read it and the Unity
 * app can port `fold` and `matches` to C# line by line.
 *
 * Hiding a feature is a preference, not a permission: the database never
 * refuses anything because of a person's line of work.
 */
export type Work = 'broker' | 'teacher' | 'guide' | 'other';
export type Category = 'education' | 'tourism' | 'estate' | 'other';

export type Features = {
  teams: boolean;
  order: boolean;
  questions: boolean;
  results: boolean;
  teamSettings: boolean;
  oneAtATime: boolean;
  /** Start from the AI photo-to-3D flow instead of a blank trail. */
  aiFirst: boolean;
};

export const WORKS: Work[] = ['broker', 'teacher', 'guide', 'other'];
export const CATEGORIES: Category[] = ['education', 'tourism', 'estate', 'other'];

const EVERYTHING: Features = {
  teams: true, order: true, questions: true, results: true,
  teamSettings: true, oneAtATime: true, aiFirst: false,
};

const FEATURES: Record<Work, Features> = {
  broker: {
    teams: false, order: false, questions: false, results: false,
    teamSettings: false, oneAtATime: false, aiFirst: true,
  },
  teacher: EVERYTHING,
  guide: {
    teams: false, order: true, questions: true, results: false,
    teamSettings: false, oneAtATime: true, aiFirst: false,
  },
  other: EVERYTHING,
};

const CATEGORY: Record<Work, Category> = {
  broker: 'estate',
  teacher: 'education',
  guide: 'tourism',
  other: 'other',
};

/** What this line of work sees. Null (not asked yet) is treated as "other". */
export function featuresFor(work: Work | null): Features {
  return Object.freeze({ ...FEATURES[work ?? 'other'] });
}

/** The category a new trail starts with. */
export function defaultCategory(work: Work | null): Category {
  return CATEGORY[work ?? 'other'];
}

/** Bulgarian official transliteration (lower case). Soft sign is dropped. */
const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's',
  т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht',
  ъ: 'a', ь: '', ю: 'yu', я: 'ya',
};

/**
 * Makes text comparable: lower case, no accents, Cyrillic written in Latin
 * letters, single spaces. "Ямбол" and "yambol" fold to the same thing.
 */
export function fold(text: string): string {
  // Cyrillic first: stripping accents first would turn й into и.
  let latin = '';
  for (const ch of text.toLowerCase().normalize('NFC')) latin += CYRILLIC[ch] ?? ch;
  return latin
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when every word of the query appears somewhere in the trail's name or city. */
export function matches(
  query: string,
  trail: { name: string; city?: { bg?: string; en?: string } | null },
): boolean {
  const hay = fold(`${trail.name} ${trail.city?.bg ?? ''} ${trail.city?.en ?? ''}`);
  return fold(query).split(' ').filter(Boolean).every((w) => hay.includes(w));
}

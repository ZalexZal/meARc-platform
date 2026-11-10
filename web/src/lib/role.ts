/**
 * Creator or viewer: the one question every account answers once, and the
 * seal that shows the answer.
 *
 * Pure and dependency-free, like work.ts, so the node unit tests can load it
 * and every page can import it without pulling in the Supabase client.
 *
 * The role is a preference, not a permission: a viewer can still join any
 * trail with a code, and a creator can still walk trails.
 */
import type { Work } from './work.ts';
import { WORKS } from './work.ts';

export type Role = 'creator' | 'viewer';
export const ROLES: Role[] = ['creator', 'viewer'];
export const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as string[]).includes(v);

type Lang = 'bg' | 'en';

/** 24-unit stroke glyphs. The only drawing the seal ever does: no outside text goes into it. */
export const GLYPHS = {
  teacher: 'M2 9l10-5 10 5-10 5zM6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5M22 9v6',
  guide: 'M12 21V3M6 5h10l3 2.5L16 10H6zM18 13H8l-3 2.5L8 18h10z',
  broker: 'M3 11l9-7 9 7M5 10v10h14V10M10 20v-5h4v5',
  other: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
  viewer: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0.01 0z',
  pencil: 'M4 20l4-1 10-10-3-3L5 16zM14 7l3 3',
  ask: 'M9 9a3 3 0 1 1 4 2.8c-.7.3-1 .8-1 1.5V14M12 17.5v.01',
} as const;
export type Glyph = keyof typeof GLYPHS;

const ROLE_LABELS = {
  bg: { creator: 'Създател', viewer: 'Зрител' },
  en: { creator: 'Creator', viewer: 'Viewer' },
} as const;

export const roleLabel = (role: Role, lang: Lang): string => ROLE_LABELS[lang][role];

export type SealShape = 'square' | 'round' | 'ask';
export type SealState = {
  shape: SealShape;
  glyph: Glyph;
  pip: boolean;
  title: string;
  body: string;
  gets: string[];
};

type Copy = { title: string; body: string; gets: string[] };
type StateKey = 'ask' | 'viewer' | 'creator' | Work;

/** The left panel's words for every state, exactly as the approved mockup has them. */
const COPY: Record<Lang, Record<StateKey, Copy>> = {
  bg: {
    ask: {
      title: 'Как ще използвате AR Trail?',
      body: 'Изберете отдясно. Знакът тук се сменя с избора ви и после стои до името ви.',
      gets: [],
    },
    viewer: {
      title: 'Зрител',
      body: 'Разглеждате обществената библиотека и се включвате в маршрути с код.',
      gets: ['Обществени маршрути наблизо', 'Влизане с код', 'Без настройки'],
    },
    creator: {
      title: 'Създател',
      body: 'Изберете с какво се занимавате — ще ви показваме само нужното.',
      gets: [],
    },
    teacher: {
      title: 'Учител · създател',
      body: 'Уроци на открито: отбори, въпроси за точки, подсказки и класиране на живо.',
      gets: ['Отбори и класиране', 'Въпроси за точки и подсказки', 'По ред или свободно'],
    },
    guide: {
      title: 'Екскурзовод · създател',
      body: 'Разходки с истории: въпроси и подсказки без точки, по ред или свободно.',
      gets: ['Въпроси и подсказки, без точки', 'По ред или свободно', '3D, снимки, видео и звук'],
    },
    broker: {
      title: 'Брокер · създател',
      body: 'Покажете сградата на мястото ѝ: 3D модел на парцела, без отбори и въпроси.',
      gets: ['3D модел на място', 'Модел от снимка с AI', 'Само нужното — без въпроси'],
    },
    other: {
      title: 'Създател',
      body: 'Всички възможности, без ограничения.',
      gets: ['Всичко от останалите три', 'Сменяте по всяко време'],
    },
  },
  en: {
    ask: {
      title: 'How will you use AR Trail?',
      body: 'Choose on the right. This sign changes with your choice and then stays beside your name.',
      gets: [],
    },
    viewer: {
      title: 'Viewer',
      body: 'You browse the public library and join trails with a code.',
      gets: ['Public trails nearby', 'Join with a code', 'Nothing to set up'],
    },
    creator: {
      title: 'Creator',
      body: 'Choose what you do — we will show you only what you need.',
      gets: [],
    },
    teacher: {
      title: 'Teacher · creator',
      body: 'Outdoor lessons: teams, questions for points, hints and a live leaderboard.',
      gets: ['Teams and leaderboard', 'Questions for points and hints', 'In order or free'],
    },
    guide: {
      title: 'Tour guide · creator',
      body: 'Walks with stories: questions and hints without points, in order or free.',
      gets: ['Questions and hints, no points', 'In order or free', '3D, photos, video and sound'],
    },
    broker: {
      title: 'Broker · creator',
      body: 'Show the building where it will stand: a 3D model on the plot, no teams or questions.',
      gets: ['3D model on site', 'Model from a photo with AI', 'Only what you need — no questions'],
    },
    other: {
      title: 'Creator',
      body: 'Every option, no limits.',
      gets: ['Everything from the other three', 'Change any time'],
    },
  },
};

const isWork = (v: unknown): v is Work => typeof v === 'string' && (WORKS as string[]).includes(v);

/**
 * What the seal and the panel beside it show for a choice so far. A viewer's
 * work is ignored; a creator without a work yet is a plain square with a pencil.
 */
export function sealState(role: Role | null, work: Work | null, lang: Lang): SealState {
  const copy = (k: StateKey) => {
    const c = COPY[lang][k];
    return { title: c.title, body: c.body, gets: [...c.gets] };
  };
  if (role === 'viewer') return { shape: 'round', glyph: 'viewer', pip: false, ...copy('viewer') };
  if (role === 'creator') {
    return isWork(work)
      ? { shape: 'square', glyph: work, pip: true, ...copy(work) }
      : { shape: 'square', glyph: 'pencil', pip: false, ...copy('creator') };
  }
  return { shape: 'ask', glyph: 'ask', pip: false, ...copy('ask') };
}

/**
 * The seal as markup, for the server render and for nothing else: every value
 * in it is one of the constants above, never something a person typed.
 */
export function sealMarkup(state: Pick<SealState, 'shape' | 'glyph' | 'pip'>,
                           { selected = false, size }: { selected?: boolean; size?: number } = {}): string {
  const style = size ? ` style="--seal:${Number(size)}px"` : '';
  return `<span class="seal" aria-hidden="true" data-seal data-seal-shape="${state.shape}" data-seal-glyph="${state.glyph}"`
    + ` data-seal-pip="${state.pip}" data-selected="${selected}"${style}>`
    + `<svg class="seal-glyph" viewBox="0 0 24 24"><path d="${GLYPHS[state.glyph]}"/></svg>`
    + `<span class="seal-pip"><svg viewBox="0 0 24 24"><path d="${GLYPHS.pencil}"/></svg></span>`
    + `</span>`;
}

/** Repaints a seal element in place from a state. Browser only. */
export function paintSeal(el: HTMLElement, state: Pick<SealState, 'shape' | 'glyph' | 'pip'>, selected = state.shape !== 'ask') {
  el.dataset.sealShape = state.shape;
  el.dataset.sealGlyph = state.glyph;
  el.dataset.sealPip = String(state.pip);
  el.dataset.selected = String(selected);
  el.querySelector('.seal-glyph path')?.setAttribute('d', GLYPHS[state.glyph]);
}

/** Just enough of the Supabase client for the two calls below. */
export type RoleClient = {
  auth: { getSession(): Promise<{ data: { session: { user: { id: string } } | null } }> };
  from(table: 'profiles'): {
    select(columns: string): { eq(col: string, val: string): { maybeSingle(): Promise<{ data: { role?: string | null } | null; error?: unknown }> } };
    update(patch: { role: Role; work?: Work }): { eq(col: string, val: string): PromiseLike<{ error: { message: string } | null }> };
  };
};

/**
 * The signed-in person's role. null means only "never asked"; a failed read
 * (or nobody signed in) is undefined, so it is never mistaken for "never asked".
 */
export async function loadRole(client: RoleClient): Promise<Role | null | undefined> {
  const { data: { session } } = await client.auth.getSession();
  if (!session) return undefined;
  const { data, error } = await client.from('profiles').select('role').eq('id', session.user.id).maybeSingle();
  if (error || !data) return undefined;
  return isRole(data.role) ? data.role : null;
}

/**
 * Stores the choice in one update. A creator's work goes with it; a viewer's
 * work is left as it was. Returns an error message, or null.
 */
export async function saveRole(client: RoleClient, role: Role, work?: Work | null): Promise<string | null> {
  const { data: { session } } = await client.auth.getSession();
  if (!session) return 'not signed in';
  const patch: { role: Role; work?: Work } = { role };
  if (role === 'creator' && isWork(work)) patch.work = work;
  const { error } = await client.from('profiles').update(patch).eq('id', session.user.id);
  return error ? error.message : null;
}

/**
 * The small seal beside a signed-in name: square with the job glyph for a
 * creator (a pencil when no job is known), round with the eye for a viewer,
 * nothing at all before the question is answered. No pip: at 26px it would
 * be a speck, and the shape already says creator.
 */
export function badgeState(role: unknown, work: unknown): Pick<SealState, 'shape' | 'glyph' | 'pip'> | null {
  if (!isRole(role)) return null;
  const { shape, glyph } = sealState(role, isWork(work) ? work : null, 'en');
  return { shape, glyph, pip: false };
}

/** Fired on window when this page saves a new role, so every badge repaints. */
export const ROLE_EVENT = 'artrail:role';
export type RoleEventDetail = { role: Role; work: Work | null };

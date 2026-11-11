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
      title: 'Как ще използваш AR Trail?',
      body: 'Избери отдясно. Знакът тук се сменя с избора ти и после стои до името ти.',
      gets: [],
    },
    viewer: {
      title: 'Зрител',
      body: 'Разглеждаш обществената библиотека и се включваш в маршрути с код.',
      gets: ['Обществени маршрути наблизо', 'Влизане с код', 'Без настройки'],
    },
    creator: {
      title: 'Създател',
      body: 'Избери с какво се занимаваш — ще ти показваме само нужното.',
      gets: [],
    },
    teacher: {
      title: 'Образование · създател',
      body: 'Уроци на открито: отбори, въпроси за точки, подсказки и класиране на живо.',
      gets: ['Отбори и класиране', 'Въпроси за точки и подсказки', 'По ред или свободно'],
    },
    guide: {
      title: 'Туризъм · създател',
      body: 'Разходки с истории: въпроси и подсказки без точки, по ред или свободно.',
      gets: ['Въпроси и подсказки, без точки', 'По ред или свободно', '3D, снимки, видео и звук'],
    },
    broker: {
      title: 'Недвижими имоти · създател',
      body: 'Покажи сградата на мястото ѝ: 3D модел на парцела, без отбори и въпроси.',
      gets: ['3D модел на място', 'Модел от снимка с AI', 'Само нужното — без въпроси'],
    },
    other: {
      title: 'Създател',
      body: 'Всички възможности, без ограничения.',
      gets: ['Всичко от останалите три', 'Сменяш по всяко време'],
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
      title: 'Education · creator',
      body: 'Outdoor lessons: teams, questions for points, hints and a live leaderboard.',
      gets: ['Teams and leaderboard', 'Questions for points and hints', 'In order or free'],
    },
    guide: {
      title: 'Tourism · creator',
      body: 'Walks with stories: questions and hints without points, in order or free.',
      gets: ['Questions and hints, no points', 'In order or free', '3D, photos, video and sound'],
    },
    broker: {
      title: 'Real estate · creator',
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

// The job is named by its field first, the role word is the subtext (work.ts).
// So a creator's title is "Образование · създател", not "Учител · създател".

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

/** Line icons (24 viewBox, stroke) for the stage's signs and moment. Fixed paths, never typed text. */
export const ICONS = {
  book: 'M2 5h7a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H2zM22 5h-7a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h8z',
  team: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3 3-5 6-5s6 2 6 5M17 11a2.5 2.5 0 1 0 0-5M18 15c2 .5 3.5 2 3.5 5',
  chart: 'M4 20V12M10 20V8M16 20V4M2 20h20',
  route: 'M5 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM19 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6.5 17.5c3-1 2-5 5.5-6s3.5-2 5.5-3.5',
  cols: 'M3 21h18M5 21V10M9.5 21V10M14.5 21V10M19 21V10M2 10l10-6 10 6z',
  ar: 'M3 8V4h4M17 4h4v4M21 16v4h-4M7 20H3v-4M12 7l5 3v5l-5 3-5-3v-5zM7 10l5 3 5-3M12 13v5',
  house: 'M3 11l9-7 9 7M5 10v10h14V10M10 20v-5h4v5',
  camera: 'M3 8h3l2-3h8l2 3h3v11H3zM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14',
  key: 'M7 15a4 4 0 1 1 3.5-6H21v3h-2v3h-3v-3h-5.5A4 4 0 0 1 7 15z',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M14 4v4M8 10v4M16 16v4',
  swap: 'M4 8h14l-3-3M20 16H6l3 3',
  plus: 'M12 5v14M5 12h14',
  pin: 'M12 3a6 6 0 0 1 6 6c0 5-6 11-6 11S6 14 6 9a6 6 0 0 1 6-6z',
  check: 'M5 12l5 5 9-10',
  arrow: 'M12 19V5M6 11l6-6 6 6',
} as const;
export type IconName = keyof typeof ICONS;

export type StageKey = 'teacher' | 'guide' | 'broker' | 'other' | 'viewer' | 'none';
export type Stage = {
  key: StageKey;
  /** The sky colour behind the scene, light and dark theme. */
  sky: { day: string; night: string };
  /** The chip on the stage: "<field> · създател", "Зрител", or before a choice "Нов профил". */
  tag: string;
  head: string;
  sub: string;
  signs: { glyph: IconName; label: string }[];
  /** The sample trail card ("Примерен маршрут"); null before any choice. */
  card: { title: string; meta: string; stops: number } | null;
  /** The one moment the scene shows; null before any choice. */
  moment: { glyph: IconName; text: string } | null;
};

const SKIES: Record<StageKey, Stage['sky']> = {
  teacher: { day: '#d3ecd6', night: '#0f2a22' },
  guide: { day: '#f9e2bd', night: '#2b2114' },
  broker: { day: '#cfe5f8', night: '#0d2238' },
  other: { day: '#e3e8f0', night: '#1b2130' },
  viewer: { day: '#d0ece2', night: '#0f2a24' },
  none: { day: '#ecedf0', night: '#17191c' },
};

type StageCopy = Omit<Stage, 'key' | 'sky' | 'tag'> & { tag: string };
type Sign = [IconName, string];
const sc = (tag: string, head: string, sub: string, signs: Sign[],
            card: [string, string, number], moment: [IconName, string]): StageCopy => ({
  tag, head, sub,
  signs: signs.map(([glyph, label]) => ({ glyph, label })),
  card: { title: card[0], meta: card[1], stops: card[2] },
  moment: { glyph: moment[0], text: moment[1] },
});

/** The stage's words for every state: the A5 mockup's copy, in both languages. */
const STAGE: Record<Lang, Record<Exclude<StageKey, 'none'>, StageCopy> & { none: Pick<StageCopy, 'head' | 'sub'> & { tag: string; tagCreator: string } }> = {
  bg: {
    teacher: sc('Образование · създател', 'Уроците излизат навън.', 'Класът тръгва на отбори, въпросите изскачат на място, класирането се движи на живо.',
      [['book', 'Уроци на открито'], ['team', 'Отбори'], ['chart', 'Класиране на живо']],
      ['Урок в парка', '4 спирки · ~30 мин · отбори', 4], ['plus', 'Отбор Север · +10 т.']),
    guide: sc('Туризъм · създател', 'Историята — там, където се е случила.', 'Туристът насочва телефона към руината и тя си връща кулата.',
      [['route', 'Маршрути'], ['cols', 'Истории и обекти'], ['ar', 'AR гид']],
      ['Разходка из стария град', '6 спирки · 1,4 км · ~40 мин', 4], ['pin', 'Наблизо · Източната порта']),
    broker: sc('Недвижими имоти · създател', 'Сградата — на парцела, преди да е построена.', 'Клиентът застава на мястото и я вижда в истински размер.',
      [['house', 'Имоти'], ['ar', '3D на място'], ['camera', 'Модел от снимка']],
      ['Оглед на парцела', '1 спирка · 3D модел · за клиент', 1], ['check', 'Клиентът е на парцела']),
    other: sc('Друго · създател', 'Каквото поставиш, хората го виждат на място.', 'Текст, 3D, въпрос или звук — на точната спирка.',
      [['sliders', 'Всички инструменти'], ['route', 'Всякакви маршрути'], ['swap', 'Сменяш по всяко време']],
      ['Моят маршрут', '5 спирки · свободен ред', 3], ['pin', 'Спирка 2 от 5']),
    viewer: sc('Зрител', 'Тръгни. Телефонът ще ти покаже останалото.', 'Маршрут наблизо или код от учител или екскурзовод — и приложението те води.',
      [['map', 'Обществени маршрути'], ['key', 'Влизане с код'], ['camera', 'AR камера']],
      ['Ямбол през вековете', 'наблизо · 350 м до началото', 4], ['arrow', 'Следваща · 180 м']),
    none: { tag: 'Нов профил', tagCreator: 'Създател', head: 'Едно място. Една история. Твоят телефон.', sub: 'Избери вдясно как ще ползваш AR Trail — и виж какво те чака.' },
  },
  en: {
    teacher: sc('Education · creator', 'Lessons go outside.', 'The class heads out in teams, questions pop up on the spot, the leaderboard moves live.',
      [['book', 'Outdoor lessons'], ['team', 'Teams'], ['chart', 'Live leaderboard']],
      ['A lesson in the park', '4 stops · ~30 min · teams', 4], ['plus', 'Team North · +10 pts']),
    guide: sc('Tourism · creator', 'History, where it happened.', 'The visitor points the phone at the ruin and it gets its tower back.',
      [['route', 'Routes'], ['cols', 'Stories and sights'], ['ar', 'AR guide']],
      ['A walk through the old town', '6 stops · 1.4 km · ~40 min', 4], ['pin', 'Nearby · the Eastern Gate']),
    broker: sc('Real estate · creator', 'The building, on the plot, before it is built.', 'The client stands on the site and sees it at full size.',
      [['house', 'Properties'], ['ar', '3D on site'], ['camera', 'Model from a photo']],
      ['Plot viewing', '1 stop · 3D model · for a client', 1], ['check', 'The client is on the plot']),
    other: sc('Other · creator', 'Whatever you place, people see on the spot.', 'Text, 3D, a question or a sound — at the exact stop.',
      [['sliders', 'All tools'], ['route', 'Any kind of trail'], ['swap', 'Switch any time']],
      ['My trail', '5 stops · free order', 3], ['pin', 'Stop 2 of 5']),
    viewer: sc('Viewer', 'Set off. The phone will show the rest.', 'A trail nearby, or a code from a teacher or guide — and the app leads you.',
      [['map', 'Public trails'], ['key', 'Join with a code'], ['camera', 'AR camera']],
      ['Yambol through the ages', 'nearby · 350 m to the start', 4], ['arrow', 'Next · 180 m']),
    none: { tag: 'New profile', tagCreator: 'Creator', head: 'One place. One story. Your phone.', sub: 'Choose on the right how you will use AR Trail — and see what awaits you.' },
  },
};

/**
 * What the stage beside the sign-up form shows for a choice so far: sky,
 * chip, headline, signs, sample trail card and moment. A viewer's work is
 * ignored; a creator without a work yet (or nobody yet) is key "none", with
 * the welcome headline and no card or moment.
 */
export function stageFor(role: Role | null, work: Work | null, lang: Lang): Stage {
  const key: StageKey = role === 'viewer' ? 'viewer' : role === 'creator' && isWork(work) ? work : 'none';
  const sky = { ...SKIES[key] };
  if (key === 'none') {
    const n = STAGE[lang].none;
    return { key, sky, tag: role === 'creator' ? n.tagCreator : n.tag, head: n.head, sub: n.sub, signs: [], card: null, moment: null };
  }
  const c = STAGE[lang][key];
  return {
    key, sky, tag: c.tag, head: c.head, sub: c.sub,
    signs: c.signs.map((x) => ({ ...x })),
    card: c.card && { ...c.card },
    moment: c.moment && { ...c.moment },
  };
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

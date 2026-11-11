/**
 * The A5 stage's colours, day and night, as CSS custom properties.
 *
 * The site has three theme states (global.css): light by default, dark when
 * <html data-theme="dark">, and dark when the system says so and nothing has
 * been stamped. The night values are written once here and emitted under both
 * dark selectors, so the stage follows the theme switch live with no script.
 *
 * Values are the design's (A5 / Scene "colour" mode); the skies come from
 * stageFor in role.ts so there is one copy of them.
 */
import { stageFor, type StageKey } from './role.ts';

export const STAGE_KEYS: StageKey[] = ['none', 'teacher', 'guide', 'broker', 'other', 'viewer'];

type Vars = Record<string, string>;

/** Text, chips, card, cloud: A5's `t`. */
const TEXT: Record<'day' | 'night', Vars> = {
  day: {
    ink: '#1d1d1f', muted: '#45454b', 'chip-bg': 'rgba(255,255,255,0.8)', cloud: 'rgba(255,255,255,0.95)',
    card: 'rgba(255,255,255,0.94)', 'card-line': 'rgba(0,0,0,0.04)', route: '#0066cc', 'sign-ink': '#0066cc',
    dash: '#9a9aa2',
  },
  night: {
    ink: '#f5f5f7', muted: '#c2c2c8', 'chip-bg': 'rgba(255,255,255,0.10)', cloud: 'rgba(255,255,255,0.07)',
    card: 'rgba(22,24,27,0.86)', 'card-line': 'rgba(255,255,255,0.10)', route: '#2997ff', 'sign-ink': '#8fc4ff',
    dash: '#5a5d62',
  },
};

/** Scene base (the plain mode), which "colour" mode starts from. */
const BASE: Record<'day' | 'night', Vars> = {
  day: { far: '#f4f4f6', fill: '#ebebef', line: '#d4d4da', accent: '#0066cc', bg: '#ffffff' },
  night: { far: '#1b1d20', fill: '#24272b', line: '#363a40', accent: '#2997ff', bg: '#16181b' },
};

/** Scene.dc.html DAY / NIGHT, per role. */
const SCENE: Record<'day' | 'night', Record<StageKey, Vars>> = {
  day: {
    guide: { far: '#bcd69b', fill: '#e6cfa4', line: '#c2a375', grass: '#6fa04b', tree: '#8cbf6a', trunk: '#9a7650' },
    teacher: { far: '#b7dcae', fill: '#f4e7cd', line: '#d1b88c', grass: '#6fa04b', tree: '#79b85f', trunk: '#9a7650' },
    broker: { far: '#cfe1ef', fill: '#f7f9fb', line: '#b5c4d2', grass: '#6fa04b', tree: '#79b85f', trunk: '#9a7650', crane: '#f0b43c' },
    other: { far: '#cbe0c0', fill: '#ece4d4', line: '#c8b99e', grass: '#6fa04b', tree: '#79b85f', trunk: '#9a7650' },
    viewer: { far: '#b9dba3', fill: '#e6cfa4', line: '#8e7253', grass: '#5f9440', tree: '#79b85f', trunk: '#9a7650', ground: '#92c773' },
    none: {},
  },
  night: {
    guide: { far: '#26331f', fill: '#5a4b35', line: '#7a6648', grass: '#4d7a37', tree: '#3d6b31', trunk: '#5b4632' },
    teacher: { far: '#1f3a2c', fill: '#4e4a40', line: '#6d6656', grass: '#4d7a37', tree: '#2f6436', trunk: '#5b4632' },
    broker: { far: '#1b2c3d', fill: '#3a4654', line: '#566475', grass: '#4d7a37', tree: '#2f6436', trunk: '#5b4632', crane: '#d39a2a' },
    other: { far: '#22362b', fill: '#4a4538', line: '#69614f', grass: '#4d7a37', tree: '#2f6436', trunk: '#5b4632' },
    viewer: { far: '#21402c', fill: '#5a4b35', line: '#8e7253', grass: '#4d7a37', tree: '#2f6436', trunk: '#5b4632', ground: '#2e5a33' },
    none: {},
  },
};

const sceneVars = (mode: 'day' | 'night', key: StageKey): Vars => {
  const b = BASE[mode];
  return { ...b, tree: b.fill, trunk: b.fill, crane: b.fill, ground: b.fill, grass: b.line, ...SCENE[mode][key], accent: b.accent };
};

const sky = (key: StageKey) => {
  const role = key === 'viewer' ? 'viewer' : key === 'none' ? null : 'creator';
  return stageFor(role, key === 'viewer' || key === 'none' ? null : key, 'bg').sky;
};

const decl = (prefix: string, vars: Vars) => Object.entries(vars).map(([k, v]) => `--${prefix}-${k}:${v}`).join(';');

/** Every rule for one theme, each selector prefixed (for the dark wrappers). */
function rules(mode: 'day' | 'night', pre: string): string {
  const out = [`${pre}.stage{${decl('st', TEXT[mode])}}`];
  for (const k of STAGE_KEYS) {
    // The role's scene colours on the stage too, for the ground strip that
    // carries the scene to the right edge of the tablet band (stage.css).
    // Keyed on the drawings' state (data-stage-art), not the words': before a
    // choice the art previews each role in turn while the words stay on welcome.
    out.push(`${pre}.stage[data-stage-art="${k}"]{--st-sky:${sky(k)[mode]};${decl('sc', sceneVars(mode, k))}}`);
    out.push(`${pre}.stage .scene[data-scene="${k}"]{${decl('sc', sceneVars(mode, k))}}`);
  }
  return out.join('\n');
}

/** The stylesheet: day on bare selectors, night under both dark-theme selectors. */
export function stagePaletteCss(): string {
  return [
    rules('day', ''),
    `@media (prefers-color-scheme: dark){\n${rules('night', ':root:not([data-theme="light"]) ')}\n}`,
    rules('night', ':root[data-theme="dark"] '),
  ].join('\n');
}

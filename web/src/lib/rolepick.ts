/**
 * The browser half of RolePicker + RolePanel: reads the choice, shows the work
 * question only to creators, repaints the seal and the panel, and makes the
 * CTA look ready only once the choice is complete. One copy, used by sign-up,
 * choose-role and (later) Account settings.
 *
 * Everything written into the panel is from sealState's fixed copy, and goes
 * in as text, never markup.
 */
import { sealState, paintSeal, isRole, type Role } from './role.ts';
import { WORKS, type Work } from './work.ts';

export type Picked = { role: Role | null; work: Work | null };

const SVG = 'http://www.w3.org/2000/svg';
const isWork = (v: unknown): v is Work => typeof v === 'string' && (WORKS as string[]).includes(v);

function check() {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', 'M5.5 10.4l3 2.9 6-6.3');
  svg.append(path);
  return svg;
}

export function wirePicker(root: ParentNode, { cta }: { cta?: HTMLElement | null } = {}) {
  const picker = root.querySelector('[data-role-picker]') as HTMLElement;
  const panel = root.querySelector('[data-role-panel]') as HTMLElement | null;
  const lang = panel?.dataset.lang === 'en' ? 'en' : 'bg';
  const workSection = picker.querySelector('[data-work-section]') as HTMLElement;
  const note = picker.querySelector('[data-viewer-note]') as HTMLElement | null;

  const read = (): Picked => {
    const role = (picker.querySelector('input[name="role"]:checked') as HTMLInputElement | null)?.value;
    const work = (picker.querySelector('input[name="work"]:checked') as HTMLInputElement | null)?.value;
    return { role: isRole(role) ? role : null, work: isWork(work) ? work : null };
  };
  const complete = () => {
    const { role, work } = read();
    return role === 'viewer' || (role === 'creator' && work !== null);
  };

  const paint = () => {
    const { role, work } = read();
    workSection.hidden = role !== 'creator';
    if (note) note.hidden = role !== 'viewer';
    cta?.classList.toggle('is-waiting', !complete());
    if (!panel) return;
    const state = sealState(role, role === 'creator' ? work : null, lang);
    const seal = panel.querySelector('[data-seal]') as HTMLElement | null;
    if (seal) paintSeal(seal, state);
    const title = panel.querySelector('[data-role-title]');
    const body = panel.querySelector('[data-role-body]');
    if (title) title.textContent = state.title;
    if (body) body.textContent = state.body;
    const gets = panel.querySelector('[data-role-gets]') as HTMLElement | null;
    if (gets) {
      gets.replaceChildren(...state.gets.map((g) => {
        const li = document.createElement('li');
        const span = document.createElement('span');
        span.textContent = g;
        li.append(check(), span);
        return li;
      }));
      gets.hidden = state.gets.length === 0;
    }
  };

  picker.addEventListener('change', paint);

  /** Pre-selects an answer already known, then repaints. */
  const set = (role: Role | null, work: Work | null) => {
    picker.querySelectorAll<HTMLInputElement>('input[name="role"]').forEach((r) => { r.checked = r.value === role; });
    picker.querySelectorAll<HTMLInputElement>('input[name="work"]').forEach((r) => { r.checked = r.value === work; });
    paint();
  };

  /** The control to point an error at: the first role card, or the first job. */
  const firstOf = (name: 'role' | 'work') => picker.querySelector(`input[name="${name}"]`) as HTMLInputElement;

  paint();
  return { read, set, complete, firstOf };
}

/**
 * The browser half of RolePicker + RoleStage: reads the choice, shows the work
 * question only to creators, sets the stage's state and repaints its seal, and
 * makes the CTA look ready only once the choice is complete. One copy, used by
 * sign-up, choose-role and Account settings (which has no stage).
 *
 * The stage's words and drawings are all rendered on the server; this only
 * flips data-stage-role, so nothing typed or fetched is ever written into it.
 */
import { sealState, stageFor, paintSeal, isRole, type Role } from './role.ts';
import { WORKS, type Work } from './work.ts';

export type Picked = { role: Role | null; work: Work | null };

const isWork = (v: unknown): v is Work => typeof v === 'string' && (WORKS as string[]).includes(v);

export function wirePicker(root: ParentNode, { cta }: { cta?: HTMLElement | null } = {}) {
  const picker = root.querySelector('[data-role-picker]') as HTMLElement;
  const stage = root.querySelector('[data-stage]') as HTMLElement | null;
  const lang = stage?.dataset.lang === 'en' ? 'en' : 'bg';
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
    if (!stage) return;
    const w = role === 'creator' ? work : null;
    stage.dataset.stageRole = stageFor(role, w, lang).key;
    stage.dataset.stageCreator = String(role === 'creator');
    const seal = stage.querySelector('[data-seal]') as HTMLElement | null;
    if (seal) paintSeal(seal, sealState(role, w, lang));
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

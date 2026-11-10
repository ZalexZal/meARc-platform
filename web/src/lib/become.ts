/**
 * The browser half of BecomeCreator. Picking a job only marks it (arrow keys
 * move through radios, so a pick must never commit); "Continue" stores
 * role=creator with that work in one update, repaints the badges, then hands
 * the work to the page. A failed save is said inline and nothing changes.
 *
 * `before` runs first and can stop it: the builder saves an open stop there,
 * so nothing typed is lost to the reload that follows.
 */
import { saveRole, type RoleClient } from './role.ts';
import { WORKS, type Work } from './work.ts';
import { announceRole } from './badge.ts';
import { busy, formError, formClear } from './form.ts';

const isWork = (v: unknown): v is Work => typeof v === 'string' && (WORKS as string[]).includes(v);

export function wireBecome(root: HTMLFormElement, client: RoleClient, failedText: string,
                           onDone: (work: Work) => void,
                           { before }: { before?: () => Promise<boolean> } = {}) {
  const error = root.querySelector('[data-become-error]') as HTMLElement;
  const go = root.querySelector('[data-become-go]') as HTMLButtonElement;
  const picked = () => {
    const v = (root.querySelector('input[name="work"]:checked') as HTMLInputElement | null)?.value;
    return isWork(v) ? v : null;
  };
  const ready = () => { go.disabled = picked() === null; };

  root.addEventListener('change', () => { formClear(error); ready(); });
  ready();

  root.addEventListener('submit', async (e) => {
    e.preventDefault();
    const work = picked();
    if (!work) return;
    formClear(error);
    busy(go, true);
    if (before && !(await before())) { busy(go, false); ready(); return; }
    const failed = await saveRole(client, 'creator', work);
    if (failed) { formError(error, `${failedText} (${failed})`); ready(); return; }
    busy(go, false);
    announceRole('creator', work);
    onDone(work);
  });
}

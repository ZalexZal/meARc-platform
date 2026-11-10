/**
 * The browser half of BecomeCreator: picking a job stores role=creator with
 * that work in one update, repaints the badges, then hands the work to the
 * page. A failed save is said inline and nothing changes.
 */
import { saveRole, type RoleClient } from './role.ts';
import { WORKS, type Work } from './work.ts';
import { announceRole } from './badge.ts';
import { formError, formClear } from './form.ts';

const isWork = (v: unknown): v is Work => typeof v === 'string' && (WORKS as string[]).includes(v);

export function wireBecome(root: HTMLElement, client: RoleClient, failedText: string, onDone: (work: Work) => void) {
  const error = root.querySelector('[data-become-error]') as HTMLElement;
  let saving = false;
  root.addEventListener('submit', (e) => e.preventDefault());
  root.addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    if (input.name !== 'work' || !isWork(input.value) || saving) return;
    saving = true;
    formClear(error);
    root.setAttribute('aria-busy', 'true');
    const failed = await saveRole(client, 'creator', input.value);
    root.removeAttribute('aria-busy');
    saving = false;
    if (failed) {
      input.checked = false;
      formError(error, `${failedText} (${failed})`);
      return;
    }
    announceRole('creator', input.value);
    onDone(input.value);
  });
}

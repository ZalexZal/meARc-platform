/**
 * Paints every "[data-name-seal]" badge on the page (site header, account
 * header) from a role and a work, and tells the page when they change.
 * Browser only. Nothing typed by a person goes into the badge: the drawing is
 * one of the fixed glyphs, the label one of the fixed stage chips
 * ("Образование · създател", "Зрител").
 */
import { badgeState, paintSeal, stageFor, isRole, ROLE_EVENT, type Role, type RoleEventDetail } from './role.ts';
import { WORKS, type Work } from './work.ts';

const isWork = (v: unknown): v is Work => typeof v === 'string' && (WORKS as string[]).includes(v);

const lang = () => (location.pathname.startsWith('/en/') ? 'en' : 'bg');

export function paintBadges(role: unknown, work: unknown) {
  const state = badgeState(role, work);
  document.querySelectorAll<HTMLElement>('[data-name-seal]').forEach((el) => {
    if (!state || !isRole(role)) { el.hidden = true; el.removeAttribute('aria-label'); return; }
    const seal = el.querySelector<HTMLElement>('[data-seal]');
    if (seal) paintSeal(seal, state, false);
    el.setAttribute('aria-label', stageFor(role, isWork(work) ? work : null, lang()).tag);
    el.dataset.role = role;
    el.hidden = false;
  });
}

/** Repaints this page's badges and lets anything else listening know. */
export function announceRole(role: Role, work: Work | null) {
  paintBadges(role, work);
  window.dispatchEvent(new CustomEvent<RoleEventDetail>(ROLE_EVENT, { detail: { role, work } }));
}

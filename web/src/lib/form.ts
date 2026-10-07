// One way for every form to say it is working, that something is wrong, or
// that it worked. Each form used to do this its own way - a red box here, grey
// text there, a colour set by hand - so the same mistake looked different on
// every page.

const SVG = 'http://www.w3.org/2000/svg';

function icon(ok: boolean) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('form-msg-icon');
  // A tick that draws itself, or an exclamation in a circle.
  svg.innerHTML = ok
    ? '<circle cx="10" cy="10" r="8.5"/><path class="tick" d="M6 10.4l2.7 2.6L14.2 7.5"/>'
    : '<circle cx="10" cy="10" r="8.5"/><path d="M10 5.6v5.2"/><circle class="dot" cx="10" cy="14" r=".6"/>';
  return svg;
}

function say(box: HTMLElement | null, message: string, ok: boolean) {
  if (!box) return;
  const span = document.createElement('span');
  span.textContent = message;
  box.replaceChildren(icon(ok), span);
  box.classList.add('form-msg');
  box.classList.toggle('is-ok', ok);
  box.classList.toggle('is-error', !ok);
  box.classList.remove('hidden');
  box.hidden = false;
  // Restarts the arrival animation when the same box speaks twice.
  box.style.animation = 'none';
  void box.offsetWidth;
  box.style.animation = '';
  const form = box.closest('form');
  if (form) form.querySelectorAll('[aria-busy="true"]').forEach((b) => busy(b as HTMLButtonElement, false));
}

/** The button shows a spinner and keeps its width while the form works. */
export function busy(button: HTMLButtonElement | null | undefined, on: boolean) {
  if (!button) return;
  button.disabled = on;
  if (on) button.setAttribute('aria-busy', 'true');
  else button.removeAttribute('aria-busy');
}

/**
 * Something is wrong. The field at fault, if there is one, is marked and
 * focused, and the form gives one short shake.
 */
export function formError(box: HTMLElement | null, message: string, field?: Element | null) {
  say(box, message, false);
  const form = box?.closest('form') ?? null;
  form?.querySelectorAll('[aria-invalid="true"]').forEach((f) => f.removeAttribute('aria-invalid'));
  if (field instanceof HTMLElement) {
    field.setAttribute('aria-invalid', 'true');
    field.focus({ preventScroll: false });
    // Cleared as soon as it is being put right.
    const clear = () => field.removeAttribute('aria-invalid');
    field.addEventListener('input', clear, { once: true });
    field.addEventListener('change', clear, { once: true });
  }
  const shaker = form ?? box;
  shaker?.classList.remove('shake');
  void shaker?.offsetWidth;
  shaker?.classList.add('shake');
}

/** It worked. With fade, the line goes again after a few seconds (a setting saved). */
export function formOk(box: HTMLElement | null, message: string, fade = false) {
  say(box, message, true);
  box?.closest('form')?.querySelectorAll('[aria-invalid="true"]').forEach((f) => f.removeAttribute('aria-invalid'));
  if (box && fade) {
    const shown = box.lastChild;
    setTimeout(() => { if (box.lastChild === shown) formClear(box); }, 4000);
  }
}

export function formClear(box: HTMLElement | null) {
  if (!box) return;
  box.replaceChildren();
  box.classList.remove('is-ok', 'is-error');
  box.classList.add('hidden');
}

/** The tick for a card a form has folded into. */
export function tick() {
  const span = document.createElement('span');
  span.className = 'done-tick';
  span.append(icon(true));
  return span;
}

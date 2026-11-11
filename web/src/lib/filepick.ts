/**
 * Keeps the file name beside a FilePick button current.
 *
 * It listens for "change" and also wraps the input's `value` setter, because the
 * editor clears an input after an upload with `input.value = ''`, which fires no
 * event and would otherwise leave the old name on screen.
 */
export function initFilePickers(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-filepick]').forEach((box) => {
    const input = box.querySelector<HTMLInputElement>('input[type="file"]');
    const name = box.querySelector<HTMLElement>('[data-filepick-name]');
    if (!input || !name || box.dataset.ready) return;
    box.dataset.ready = '1';

    const show = () => {
      const files = Array.from(input.files ?? []);
      name.textContent = files.length === 0
        ? box.dataset.none ?? ''
        : files.length === 1
          ? files[0].name
          : (box.dataset.many ?? '{0}').replace('{0}', String(files.length));
      name.title = files.map((f) => f.name).join(', ');
    };

    input.addEventListener('change', show);
    const own = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (own?.get && own.set) {
      Object.defineProperty(input, 'value', {
        configurable: true,
        get() { return own.get!.call(this); },
        set(v: string) { own.set!.call(this, v); show(); },
      });
    }
  });
}

/**
 * Copies a string, and when the browser will not (no https, no permission), selects
 * the text on screen so it can be copied by hand. Returns true only if it was copied.
 */
export async function copyOrSelect(value: string, shown: Element | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch { /* fall through to the selection */ }
  if (shown) {
    const range = document.createRange();
    range.selectNodeContents(shown);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    try { if (document.execCommand('copy')) return true; } catch { /* selected for a hand copy */ }
  }
  return false;
}

// Before first paint, so a reader who chose light does not get one frame of
// dark. A file rather than an inline script so the Content-Security-Policy can
// allow it by origin; loaded without defer, so it still runs before paint.
// Wrapped because storage throws outright in some privacy modes, and a theme
// preference is never worth a blank page.
try {
  const saved = localStorage.getItem('artrail-theme');
  if (saved === 'light' || saved === 'dark') {
    document.documentElement.setAttribute('data-theme', saved);
  }
} catch (e) {}

// Sections that slide in as they scroll are hidden only once this says a script
// is running. If the page's own script never arrives to reveal them, they are
// shown anyway after a moment, rather than staying invisible.
document.documentElement.classList.add('js-reveal');
setTimeout(function () {
  if (!document.documentElement.classList.contains('reveal-ready')) {
    document.documentElement.classList.remove('js-reveal');
  }
}, 2500);

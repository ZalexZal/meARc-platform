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

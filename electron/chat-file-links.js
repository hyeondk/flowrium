const scheme = /^[a-z][a-z0-9+.-]*:/i;
const drive = /^[a-z]:[\\/]/i;

// Markdown parsers can encode spaces and Korean text even inside <...>.
// Keep URL decoding separate from the physical path checks in the main process.
export function chatFileLinkTarget(href) {
  if (typeof href !== 'string' || !href || href.length > 4096) return null;
  let value = href;
  if (/^file:/i.test(value)) {
    if (!/^file:\/\/(?:localhost)?\//i.test(value)) return null;
    try {
      const url = new URL(value);
      if (url.hostname || url.search || url.hash) return null;
      value = /^\/[a-z]:\//i.test(url.pathname) ? url.pathname.slice(1) : url.pathname;
    } catch { return null; }
  } else if (/[?#]/.test(value)) return null;

  try { value = decodeURIComponent(value); }
  catch { return null; }
  if (/[\u0000-\u001f\u007f]/.test(value) || /^[\\/]{2}/.test(value) || value.startsWith('\\') ||
      (scheme.test(value) && !drive.test(value))) return null;
  value = value.replaceAll('\\', '/');
  return value.startsWith('/') || drive.test(value) || /(?:^|\/)[^./][^/]*\.[^/.\s]+$/.test(value) ? value : null;
}

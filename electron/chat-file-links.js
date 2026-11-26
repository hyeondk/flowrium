const scheme = /^[a-z][a-z0-9+.-]*:/i;
const drive = /^[a-z]:[\\/]/i;
const sourceLine = /^#L[1-9]\d{0,8}(?:-L?[1-9]\d{0,8})?$/i;
const sourcePosition = /(\.[^./\\:\s]+):[1-9]\d{0,8}(?::[1-9]\d{0,8})?$/;

// Markdown parsers can encode spaces and Korean text even inside <...>.
// Keep URL decoding separate from the physical path checks in the main process.
export function chatFileLinkTarget(href) {
  if (typeof href !== 'string' || !href || href.length > 4096) return null;
  let value = href;
  if (/^file:/i.test(value)) {
    if (!/^file:\/\/(?:localhost)?\//i.test(value)) return null;
    try {
      const url = new URL(value);
      if (url.hostname || url.search || (url.hash && !sourceLine.test(url.hash))) return null;
      value = url.pathname;
    } catch { return null; }
  } else {
    if (value.includes('?')) return null;
    const fragment = value.indexOf('#');
    if (fragment >= 0) {
      if (!sourceLine.test(value.slice(fragment))) return null;
      value = value.slice(0,fragment);
    }
  }

  try { value = decodeURIComponent(value); }
  catch { return null; }
  if (/[\u0000-\u001f\u007f]/.test(value) || /^[\\/]{2}/.test(value) || value.startsWith('\\')) return null;
  value = value.replaceAll('\\', '/');
  if (/^\/[a-z]:\//i.test(value)) value = value.slice(1);
  if (scheme.test(value) && !drive.test(value)) return null;
  value = value.replace(sourcePosition,'$1');
  return value.startsWith('/') || drive.test(value) || /(?:^|\/)[^./][^/]*\.[^/.\s]+$/.test(value) ? value : null;
}

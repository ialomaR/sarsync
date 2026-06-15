// Decides how a stored, user-uploaded file may be returned to a browser.
//
// Only a small whitelist of genuinely-safe types (raster images + PDF) may be
// served inline with their declared content-type. Everything else — including
// text/html and image/svg+xml, which can carry script — is forced to download
// as an opaque application/octet-stream so it can never execute on the API
// origin. Combined with the global X-Content-Type-Options: nosniff and CSP
// headers set in buildApp, this closes the stored-XSS vector from uploads.

// Types that may be served inline with their real content-type. Raster images,
// video, audio and PDF are all safe — none can execute script in the browser,
// and the global `X-Content-Type-Options: nosniff` stops a mislabelled file
// from being sniffed as HTML. SVG is deliberately EXCLUDED (it can carry
// <script>), and so is everything else (text/html, etc.) — those download as an
// opaque octet-stream.
function isInlineSafe(mime: string): boolean {
  if (mime === 'image/svg+xml') return false; // scriptable — never inline
  if (mime === 'application/pdf') return true;
  return mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/');
}

export function safeDownloadHeaders(
  mimeType: string | null | undefined,
  filename: string | null | undefined,
): { contentType: string; contentDisposition: string } {
  const mime = (mimeType || '').toLowerCase();
  const inline = isInlineSafe(mime);
  // RFC 5987-ish: percent-encode the name so quotes/newlines can't break the
  // header (and an attacker can't inject a second header field).
  const safeName = encodeURIComponent(filename || 'file');
  return {
    // Keep the real content-type for inline media so <img>/<video> can decode
    // it; force octet-stream for everything else so it can't render/execute.
    contentType: inline ? mime : 'application/octet-stream',
    contentDisposition: `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`,
  };
}

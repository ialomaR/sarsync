// Decides how a stored, user-uploaded file may be returned to a browser.
//
// Only a small whitelist of genuinely-safe types (raster images + PDF) may be
// served inline with their declared content-type. Everything else — including
// text/html and image/svg+xml, which can carry script — is forced to download
// as an opaque application/octet-stream so it can never execute on the API
// origin. Combined with the global X-Content-Type-Options: nosniff and CSP
// headers set in buildApp, this closes the stored-XSS vector from uploads.

const INLINE_SAFE = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

export function safeDownloadHeaders(
  mimeType: string | null | undefined,
  filename: string | null | undefined,
): { contentType: string; contentDisposition: string } {
  const mime = (mimeType || '').toLowerCase();
  const inline = INLINE_SAFE.has(mime);
  // RFC 5987-ish: percent-encode the name so quotes/newlines can't break the
  // header (and an attacker can't inject a second header field).
  const safeName = encodeURIComponent(filename || 'file');
  return {
    contentType: inline ? mime : 'application/octet-stream',
    contentDisposition: `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`,
  };
}

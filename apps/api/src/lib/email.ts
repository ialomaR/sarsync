import { config, isProd } from '../config.js';

// Tiny SendGrid v3 client. Avoids the official SDK (heavy + brings deps we
// don't need). We just POST to /v3/mail/send.
//
// Behaviour:
//   - if SENDGRID_API_KEY is set → real send
//   - if not (local dev) → log the would-be email to the server log so the
//     dev/test flow still works. Production /auth endpoints also surface
//     the link in the response when NODE_ENV !== 'production'.

export interface SendEmailArgs {
  to: string;
  subject: string;
  text: string;
  html?: string;
  // Used by the caller's logger for context (which auth flow triggered this).
  reason?: string;
  log?: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };
}

const SENDGRID_URL = 'https://api.sendgrid.com/v3/mail/send';

export async function sendEmail(args: SendEmailArgs): Promise<{ ok: boolean; via: 'sendgrid' | 'log'; error?: string }> {
  const log = args.log;

  if (!config.SENDGRID_API_KEY) {
    // No key configured — log the email and continue. Critical for dev.
    log?.info(
      { to: args.to, subject: args.subject, reason: args.reason, body: args.text },
      '✉ email (no SENDGRID_API_KEY — would-be send)',
    );
    return { ok: true, via: 'log' };
  }

  try {
    const res = await fetch(SENDGRID_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: args.to }] }],
        from: {
          email: config.SENDGRID_FROM_EMAIL,
          name: config.SENDGRID_FROM_NAME,
        },
        subject: args.subject,
        content: [
          { type: 'text/plain', value: args.text },
          ...(args.html ? [{ type: 'text/html' as const, value: args.html }] : []),
        ],
      }),
    });

    if (res.status >= 200 && res.status < 300) {
      log?.info({ to: args.to, subject: args.subject, reason: args.reason }, '✉ email sent');
      return { ok: true, via: 'sendgrid' };
    }
    // Non-2xx: SendGrid returns JSON with errors[].message
    let detail = '';
    try { detail = await res.text(); } catch {}
    log?.warn({ status: res.status, detail, to: args.to, reason: args.reason }, '✉ email send failed');
    // In production we still don't crash the auth flow — better to deliver
    // the user experience even if email is briefly broken. They can request
    // a resend.
    return { ok: false, via: 'sendgrid', error: `HTTP ${res.status}: ${detail.slice(0, 200)}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.warn({ err: msg, to: args.to, reason: args.reason }, '✉ email send threw');
    return { ok: false, via: 'sendgrid', error: msg };
  }
}

// Tiny HTML wrapper used by the auth emails. Inline styles only — most
// email clients strip <style> blocks.
export function brandedHtml(opts: { heading: string; body: string; cta?: { label: string; url: string } }): string {
  const cta = opts.cta
    ? `<p style="margin:24px 0;"><a href="${opts.cta.url}" style="display:inline-block;padding:11px 22px;border-radius:8px;background:#3B82F6;color:#fff;text-decoration:none;font-weight:600;font-size:14px;">${opts.cta.label}</a></p>`
    : '';
  const altLink = opts.cta
    ? `<p style="font-size:12px;color:#6B7280;word-break:break-all;">Or paste this URL into your browser:<br/><a href="${opts.cta.url}" style="color:#3B82F6;">${opts.cta.url}</a></p>`
    : '';
  // We avoid promising it's not from prod when isProd is false — the reader
  // shouldn't see internal flags. Just keep the template plain.
  void isProd;
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F6F7F9;font-family:'Inter',system-ui,sans-serif;">
  <div style="max-width:520px;margin:32px auto;padding:32px;background:#fff;border-radius:12px;border:1px solid #E5E7EB;">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:18px;">
      <div style="width:28px;height:28px;border-radius:7px;background:#3B82F6;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;">S</div>
      <span style="font-size:15px;font-weight:700;color:#111;letter-spacing:-.01em;">SarSync</span>
    </div>
    <h2 style="font-size:18px;font-weight:700;color:#111;margin:0 0 12px;letter-spacing:-.015em;">${opts.heading}</h2>
    <div style="font-size:14px;color:#374151;line-height:1.5;">${opts.body}</div>
    ${cta}
    ${altLink}
    <hr style="border:0;border-top:1px solid #E5E7EB;margin:24px 0 14px;" />
    <p style="font-size:11px;color:#9CA3AF;">Sent by SarSync. If you didn't expect this email, you can ignore it.</p>
  </div>
</body></html>`;
}

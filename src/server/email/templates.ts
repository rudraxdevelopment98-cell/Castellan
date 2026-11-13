/**
 * Email content. Plain, calm and short — the brand is a quiet estate office.
 * Every interpolated value is HTML-escaped; links are only ever ones we built.
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="en-GB"><body style="margin:0;background:#f6f5f1;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1d2522">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #dfe3e0;border-radius:10px">
<tr><td style="padding:28px 28px 8px;font-family:Georgia,serif;font-size:24px;font-weight:600">Castellan</td></tr>
<tr><td style="padding:8px 28px 28px;font-size:15px;line-height:1.55">
<h1 style="font-size:18px;margin:0 0 12px">${escapeHtml(title)}</h1>
${bodyHtml}
</td></tr></table>
<p style="font-size:12px;color:#5b6675;margin:16px 0 0">You received this because of activity on your Castellan account.</p>
</td></tr></table></body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:20px 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:#2e5b4f;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">${escapeHtml(label)}</a></p>
<p style="font-size:13px;color:#5b6675">Or paste this link into your browser:<br><span style="word-break:break-all">${escapeHtml(href)}</span></p>`;
}

export function verifyEmail(link: string, name: string | null): RenderedEmail {
  const hi = name ? `Hello ${name},` : "Hello,";
  return {
    subject: "Confirm your email for Castellan",
    html: layout(
      "Confirm your email",
      `<p>${escapeHtml(hi)}</p><p>Confirm this address to finish creating your Castellan account. The link works once and expires in 24 hours.</p>${button(link, "Confirm email")}<p style="font-size:13px;color:#5b6675">If you didn't sign up, you can ignore this email.</p>`,
    ),
    text: `${hi}\n\nConfirm this address to finish creating your Castellan account (the link works once and expires in 24 hours):\n\n${link}\n\nIf you didn't sign up, you can ignore this email.`,
  };
}

export function accountExists(signInLink: string, resetLink: string): RenderedEmail {
  return {
    subject: "Someone tried to sign up with your email",
    html: layout(
      "You already have an account",
      `<p>Someone just tried to create a Castellan account with this email address, which already has one.</p><p>If it was you, sign in instead — or reset your password if you've forgotten it.</p>${button(signInLink, "Sign in")}<p><a href="${escapeHtml(resetLink)}">Reset your password</a></p><p style="font-size:13px;color:#5b6675">If it wasn't you, no action is needed; your account is unchanged.</p>`,
    ),
    text: `Someone just tried to create a Castellan account with this email address, which already has one.\n\nSign in: ${signInLink}\nReset your password: ${resetLink}\n\nIf it wasn't you, no action is needed; your account is unchanged.`,
  };
}

export function passwordReset(link: string): RenderedEmail {
  return {
    subject: "Reset your Castellan password",
    html: layout(
      "Reset your password",
      `<p>We received a request to reset the password for this account. The link works once and expires in 60 minutes.</p>${button(link, "Choose a new password")}<p style="font-size:13px;color:#5b6675">If you didn't ask for this, ignore this email — your password stays as it is.</p>`,
    ),
    text: `We received a request to reset the password for this account. The link works once and expires in 60 minutes:\n\n${link}\n\nIf you didn't ask for this, ignore this email — your password stays as it is.`,
  };
}

export function passwordChanged(resetLink: string): RenderedEmail {
  return {
    subject: "Your Castellan password was changed",
    html: layout(
      "Your password was changed",
      `<p>The password for this account was just changed, and every other signed-in device was signed out.</p><p>If this wasn't you, reset your password now.</p>${button(resetLink, "Reset password")}`,
    ),
    text: `The password for this account was just changed, and every other signed-in device was signed out.\n\nIf this wasn't you, reset your password now: ${resetLink}`,
  };
}

export function invite(link: string, workspaceName: string, inviterName: string | null, role: string): RenderedEmail {
  const who = inviterName ? `${inviterName} has` : "You have been";
  const lead = inviterName ? `${who} invited you` : "You have been invited";
  return {
    subject: `Invitation to ${workspaceName} on Castellan`,
    html: layout(
      `Join ${workspaceName}`,
      `<p>${escapeHtml(lead)} to join <strong>${escapeHtml(workspaceName)}</strong> on Castellan as <strong>${escapeHtml(role)}</strong>.</p><p>The invitation is for this email address only and expires in 7 days.</p>${button(link, "Accept invitation")}`,
    ),
    text: `${lead} to join ${workspaceName} on Castellan as ${role}.\nThe invitation is for this email address only and expires in 7 days.\n\n${link}`,
  };
}

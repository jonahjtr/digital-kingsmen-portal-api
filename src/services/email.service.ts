export function appBaseUrl(): string | null {
  const raw = process.env.APP_URL ?? process.env.CORS_ORIGIN?.split(',')[0]?.trim();
  if (!raw) return null;
  return raw.replace(/\/$/, '');
}

export function buildRegisterUrl(token: string): string | null {
  const base = appBaseUrl();
  if (!base) return null;
  return `${base}/register?token=${encodeURIComponent(token)}`;
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM && appBaseUrl());
}

export async function sendInviteEmail(opts: {
  to: string;
  token: string;
  role: string;
  expiresAt: Date;
}): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  const registerUrl = buildRegisterUrl(opts.token);

  if (!apiKey || !from || !registerUrl) {
    return { sent: false, reason: 'not_configured' };
  }

  const expiresLabel = opts.expiresAt.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const roleLabel =
    opts.role === 'client'
      ? 'client'
      : opts.role === 'employee'
        ? 'team member'
        : opts.role === 'salesman'
          ? 'sales'
          : opts.role;

  const html = `
    <p>You have been invited to join the Digital Kingsmen portal as a <strong>${roleLabel}</strong>.</p>
    <p><a href="${registerUrl}">Create your account</a></p>
    <p>Or open <a href="${registerUrl}">${registerUrl}</a> and use this invite token:</p>
    <p style="font-family:monospace;font-size:14px;padding:12px;background:#f4f4f5;border-radius:8px;">${opts.token}</p>
    <p style="color:#71717a;font-size:13px;">Register with <strong>${opts.to}</strong>. This invite expires ${expiresLabel}.</p>
  `.trim();

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [opts.to],
        subject: 'Your Digital Kingsmen portal invite',
        html,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error('Resend error:', res.status, body);
      return { sent: false, reason: 'provider_error' };
    }

    return { sent: true };
  } catch (err) {
    console.error('sendInviteEmail failed:', err);
    return { sent: false, reason: 'send_failed' };
  }
}

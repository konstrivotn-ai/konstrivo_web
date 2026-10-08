// Minimal email sender utility. Uses EmailJS REST API via fetch if configured.
// In `test` mode it records sent emails to an in-memory array for assertions.
import { config } from '../config';

type SentEmail = { to: string; subject: string; text: string; html?: string };

const sentEmails: SentEmail[] = [];

export function getSentEmails() { return sentEmails; }

function clearSentEmails() { sentEmails.length = 0; }

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<boolean> {
  const subject = 'Réinitialisation de votre mot de passe — KONSTRIVO';
  const text = `Bonjour,\n\nVous avez demandé à réinitialiser votre mot de passe KONSTRIVO.\n\nOuvrez le lien suivant pour choisir un nouveau mot de passe:\n${resetUrl}\n\nCe lien est valable pendant 1 heure et ne peut être utilisé qu'une seule fois.\n\nSi vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email.\n\nL'équipe KONSTRIVO`;
  const html = `<p>Bonjour,</p><p>Vous avez demandé à réinitialiser votre mot de passe KONSTRIVO.</p><p><a href="${resetUrl}">Réinitialiser mon mot de passe</a></p><p>Ce lien est valable pendant 1 heure et ne peut être utilisé qu'une seule fois.</p><p>Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email.</p><p>L'équipe KONSTRIVO</p>`;

  // Test mode: record emails in-memory for assertions, do not perform external calls.
  if (process.env.NODE_ENV === 'test') {
    sentEmails.push({ to, subject, text, html });
    return true;
  }

  const serviceId = process.env.EMAILJS_SERVICE_ID;
  const templateId = process.env.EMAILJS_TEMPLATE_ID;
  const publicKey = process.env.EMAILJS_PUBLIC_KEY;
  const privateKey = process.env.EMAILJS_PRIVATE_KEY;
  if (!serviceId || !templateId || !publicKey || !privateKey) {
    console.warn('[KONSTRIVO] Email not sent: EmailJS credentials not configured.');
    return false;
  }

  try {
    // EmailJS REST API payload — POST https://api.emailjs.com/api/v1.0/email/send
    const payload = {
      service_id: serviceId,
      template_id: templateId,
      user_id: publicKey,
      accessToken: privateKey,
      template_params: {
        email: to,
        link: resetUrl,
      },
    };

    // Use global fetch if available
    const fetchFn: any = (globalThis as any).fetch;
    if (!fetchFn) throw new Error('fetch not available');

    const res = await fetchFn('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res) {
      console.warn('[KONSTRIVO] Password reset email delivery failed: no response');
      return false;
    }
    if (res.status >= 400) {
      // Diagnostic only: log non-2xx status and EmailJS response body.
      // Never log resetUrl / token / password / credentials.
      let bodyText = '';
      try {
        bodyText = (await res.text()) || '';
      } catch {
        bodyText = '(unreadable body)';
      }
      console.warn(`[KONSTRIVO] Password reset email delivery failed: HTTP ${res.status} — ${bodyText}`);
      return false;
    }
    return true;
  } catch (err) {
    // Diagnostic only: log the network/fetch error name and message.
    // Never log resetUrl / token / password / payload / credentials.
    const errName = (err && (err as any).name) || 'Error';
    const errMsg = (err && (err as any).message) || 'unknown error';
    console.warn(`[KONSTRIVO] Password reset email delivery failed: ${errName} — ${errMsg}`);
    return false;
  }
}

export { clearSentEmails };

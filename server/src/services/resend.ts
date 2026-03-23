import { Resend } from 'resend';
import { getSetting } from '../routes/settings';

let _client: Resend | null = null;
let _cachedKey: string | null = null;

/**
 * Get or create a Resend client instance.
 * Re-creates the client if the API key has changed.
 */
export async function getResendClient(): Promise<Resend> {
    const apiKey = await getSetting('resend_api_key');
    if (!apiKey) {
        throw new Error('Resend API key not configured. Set it in Settings → Email Reports.');
    }

    if (!_client || _cachedKey !== apiKey) {
        _client = new Resend(apiKey);
        _cachedKey = apiKey;
    }

    return _client;
}

/**
 * Get the configured "from" email address.
 */
export async function getFromEmail(): Promise<string> {
    const fromEmail = await getSetting('report_from_email');
    return fromEmail || 'Sentinel <reports@sentinel.dev>';
}

/**
 * Get the configured recipient email addresses.
 */
export async function getRecipients(): Promise<string[]> {
    const recipients = await getSetting('report_recipients');
    if (!recipients) {
        throw new Error('No report recipients configured. Set them in Settings → Email Reports.');
    }
    return recipients.split(',').map(e => e.trim()).filter(Boolean);
}

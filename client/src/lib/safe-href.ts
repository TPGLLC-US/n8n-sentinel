/**
 * Sanitize a URL for use in <a href>. Returns '#' for anything
 * that isn't http:// or https:// to prevent javascript: XSS.
 */
export function safeHref(url: string | null | undefined): string {
    if (!url) return '#';
    const trimmed = url.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        return trimmed;
    }
    return '#';
}

/**
 * AB Number normalisation.
 *
 * RCM AB numbers are purely numeric identifiers (e.g. 30594292, 2609835990).
 * Excel may deliver them as numbers or text with stray whitespace. We only strip
 * whitespace and verify the result is digits — we never pad, truncate, or
 * otherwise alter the identity.
 */
export const AB_NUMBER_RE = /^\d{1,15}$/;

export function normalizeAbNumber(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) return null;
    if (!Number.isSafeInteger(value)) return null;
    return String(value);
  }
  if (typeof value === 'bigint') return value > 0n ? value.toString() : null;
  if (typeof value === 'string') {
    const s = value.replace(/\s+/g, '');
    // Accept "30594292.0" which some exports produce for numeric cells as text.
    const m = /^(\d+)(?:\.0+)?$/.exec(s);
    if (!m) return null;
    const digits = m[1]!;
    return AB_NUMBER_RE.test(digits) ? digits : null;
  }
  return null;
}

export function isValidAbNumber(value: string): boolean {
  return AB_NUMBER_RE.test(value);
}

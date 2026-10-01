const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pvFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const intFmt = new Intl.NumberFormat('en-IN');

/** Indian digit grouping: 3,15,882.5 */
export const fmtPv = (n: number | null | undefined) => pvFmt.format(n ?? 0);
export const fmtInt = (n: number | null | undefined) => intFmt.format(n ?? 0);

export function monthLabel(key: string | null | undefined, short = false) {
  if (!key) return '';
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  const name = MONTHS[m - 1]!;
  return short ? `${name.slice(0, 3)} ${String(y).slice(2)}` : `${name} ${y}`;
}

export function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: iso.length === 10 ? 'UTC' : undefined });
}

export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fyLabel(start: number) {
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function currentIstMonthKey() {
  const ist = new Date(Date.now() + 330 * 60_000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
}

export const yesNo = (v: boolean | null | undefined) => (v === null || v === undefined ? '—' : v ? 'Yes' : 'No');

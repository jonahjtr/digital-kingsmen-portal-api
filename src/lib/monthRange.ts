/** Parse YYYY-MM into UTC month bounds [start, end). */
export function parseMonthRange(month?: string): { start: Date; end: Date; monthKey: string } {
  const now = new Date();
  const monthKey =
    month ??
    `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const [yearRaw, monthRaw] = monthKey.split('-');
  const year = Number(yearRaw);
  const monthIndex = Number(monthRaw) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    throw new Error(`Invalid month: ${monthKey}`);
  }
  const start = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0, 0));
  return { start, end, monthKey };
}

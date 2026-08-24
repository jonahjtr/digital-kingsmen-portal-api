import { describe, it, expect } from 'vitest';
import { parseMonthRange } from '../src/lib/monthRange';

describe('parseMonthRange', () => {
  it('returns UTC month bounds for YYYY-MM', () => {
    const { start, end, monthKey } = parseMonthRange('2026-06');
    expect(monthKey).toBe('2026-06');
    expect(start.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('defaults to the current month when omitted', () => {
    const now = new Date();
    const expected = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const { monthKey } = parseMonthRange();
    expect(monthKey).toBe(expected);
  });
});

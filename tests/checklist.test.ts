import { describe, it, expect } from 'vitest';
import { toggleChecklistLine } from '../src/tickets/service';
describe('toggleChecklistLine', () => {
  const b = 'Intro\n- [ ] a\ntext\n- [x] b\n- [ ] c';
  it('ticks the nth item only', () => expect(toggleChecklistLine(b, 2, true)).toBe('Intro\n- [ ] a\ntext\n- [x] b\n- [x] c'));
  it('unticks', () => expect(toggleChecklistLine(b, 1, false)).toBe('Intro\n- [ ] a\ntext\n- [ ] b\n- [ ] c'));
  it('out of range is a no-op', () => expect(toggleChecklistLine(b, 9, true)).toBe(b));
});

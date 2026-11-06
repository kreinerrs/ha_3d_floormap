import { describe, expect, it } from 'vitest';
import { lockColor, lockView } from '../src/core/lock';

describe('lock helpers', () => {
  it('maps lock states', () => {
    expect(lockView('locked')).toBe('locked');
    expect(lockView('locking')).toBe('locked');
    expect(lockView('unlocked')).toBe('unlocked');
    expect(lockView('open')).toBe('unlocked');
    expect(lockView('unavailable')).toBe('unavailable');
    expect(lockView(undefined)).toBe('unavailable');
  });

  it('colours by status', () => {
    expect(lockColor('locked')).not.toBe(lockColor('unlocked'));
    expect(lockColor('unavailable')).toBe('#8a8a8a');
  });
});

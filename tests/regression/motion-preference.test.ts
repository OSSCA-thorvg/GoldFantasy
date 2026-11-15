import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
describe('the player animation setting', () => {
  it('plays by default even when the operating system reduces motion', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    const query = vi.fn(() => ({ matches: true }));
    vi.stubGlobal('matchMedia', query);
    const motion = await import('../../apps/web/src/native/motion-preference');
    expect(motion.motionPreference()).toBe('On');
    expect(motion.reducedMotionPreferred()).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
  it('remembers an explicit Off and lets the player turn animation back on', async () => {
    const save = vi.fn();
    vi.stubGlobal('localStorage', { getItem: () => 'Off', setItem: save });
    const motion = await import('../../apps/web/src/native/motion-preference');
    expect(motion.reducedMotionPreferred()).toBe(true);
    motion.setMotionPreference('On');
    expect(motion.reducedMotionPreferred()).toBe(false);
    expect(save).toHaveBeenCalledWith('midgard.motion', 'On');
  });
  it('still applies the choice when storage is blocked', async () => {
    vi.stubGlobal('localStorage', { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } });
    const motion = await import('../../apps/web/src/native/motion-preference');
    expect(motion.reducedMotionPreferred()).toBe(false);
    motion.setMotionPreference('Off');
    expect(motion.reducedMotionPreferred()).toBe(true);
  });
});

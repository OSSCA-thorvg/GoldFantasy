export const motionPreferences = ['On', 'Off'] as const;
export type MotionPreference = (typeof motionPreferences)[number];
const storageKey = 'midgard.motion';

function storedPreference(): MotionPreference {
  try {
    const value = globalThis.localStorage?.getItem(storageKey);
    return motionPreferences.find((choice) => choice === value) ?? 'On';
  } catch {
    return 'On';
  }
}

let preference = storedPreference();
export const motionPreference = (): MotionPreference => preference;
export function setMotionPreference(value: MotionPreference): void {
  preference = value;
  try {
    globalThis.localStorage?.setItem(storageKey, value);
  } catch {
    // The setting still applies for this session when storage is unavailable.
  }
}
export function reducedMotionPreferred(): boolean {
  // Only the player's explicit game setting disables the authored animation.
  return preference === 'Off';
}

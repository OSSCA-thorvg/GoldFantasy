import { Cue } from './sound-types';

export const cueClips: Partial<Record<Cue, string[]>> = {
  [Cue.Place]: ['ui/rune_'],
  [Cue.Demolish]: ['sfx/collapse_'],
  [Cue.Click]: ['ui/click_'],
  [Cue.Notice]: ['ui/notify_'],
  [Cue.Alarm]: ['sfx/horn_'],
  [Cue.Order]: ['ui/confirm_'],
  [Cue.Clash]: ['sfx/clash_', 'sfx/block_', 'sfx/swing_'],
  [Cue.Complete]: ['ui/complete_'],
  [Cue.Chop]: ['sfx/chop_'],
  [Cue.TreeFall]: ['sfx/tree_fall_'],
  [Cue.Refuse]: ['ui/error_'],
  [Cue.Open]: ['ui/click_'],
  [Cue.Growth]: ['ui/growth_'],
  [Cue.Coins]: ['sfx/coins_'],
  [Cue.Raven]: ['wildlife/raven_'],
  [Cue.ThunderCrack]: ['weather/crack_'],
  [Cue.ThunderStrike]: ['weather/strike_'],
  [Cue.ThunderClap]: ['weather/clap_'],
  [Cue.ThunderRumble]: ['weather/rumble_'],
  [Cue.Discover]: ['sfx/rune_wake_'],
  [Cue.Unseal]: ['sfx/stone_door_'],
  [Cue.Cow]: ['wildlife/cow_'],
  [Cue.Pig]: ['wildlife/pig_'],
  [Cue.Chicken]: ['wildlife/chicken_'],
  [Cue.Wolf]: ['wildlife/wolf_'],
  [Cue.Dog]: ['wildlife/dog_'],
  [Cue.Cat]: ['wildlife/cat_'],
};
/** Individual calls from the existing authored sound banks. The source files contain
 * whole sequences; an ambient cue should emit one cluck, bark or oink. */
export interface AnimalCallWindow {
  source: string;
  from: number;
  to: number;
}
export const animalCallWindows: Partial<Record<Cue, readonly AnimalCallWindow[]>> = {
  [Cue.Chicken]: [
    { source: 'wildlife/chicken_01', from: 0.04, to: 0.32 },
    { source: 'wildlife/chicken_01', from: 0.6, to: 0.92 },
    { source: 'wildlife/chicken_01', from: 1.02, to: 1.36 },
    { source: 'wildlife/chicken_01', from: 1.61, to: 1.88 },
    { source: 'wildlife/chicken_01', from: 1.88, to: 2.22 },
    { source: 'wildlife/chicken_01', from: 2.27, to: 2.65 },
  ],
  [Cue.Dog]: [
    { source: 'wildlife/dog_01', from: 0.035, to: 0.48 },
    { source: 'wildlife/dog_01', from: 0.605, to: 0.98 },
    { source: 'wildlife/dog_01', from: 1.005, to: 1.5 },
  ],
  [Cue.Pig]: [
    { source: 'wildlife/pig_01', from: 0.045, to: 0.405 },
    { source: 'wildlife/pig_01', from: 0.44, to: 0.76 },
    { source: 'wildlife/pig_01', from: 0.93, to: 1.32 },
    { source: 'wildlife/pig_01', from: 1.34, to: 1.76 },
  ],
};
/** File-backed dependencies of the opening UI and settlement. Ambient weather,
 * birds, leaves, water, fire, and mining are synthesized by SoundBoard. */
export const initialEffectPrefixes = [
  ...new Set([
    'sfx/hammer_',
    ...[
      Cue.Place,
      Cue.Click,
      Cue.Notice,
      Cue.Order,
      Cue.Complete,
      Cue.Chop,
      Cue.TreeFall,
      Cue.Refuse,
      Cue.Open,
      Cue.Growth,
      Cue.Coins,
      Cue.Raven,
    ].flatMap((cue) => cueClips[cue] ?? []),
  ]),
];

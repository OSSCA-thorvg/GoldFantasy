// Enum values and defaults from src/game/game_app.h and spoken_voice.h.
export enum Cue {
  Place,
  Demolish,
  Click,
  Notice,
  Alarm,
  Order,
  Clash,
  Bite,
  Arrow,
  Complete,
  Speech,
  SpeechStop,
  Howl,
  Chop,
  TreeFall,
  Refuse,
  Open,
  Growth,
  Coins,
  Raven,
  ThunderCrack,
  ThunderStrike,
  ThunderClap,
  ThunderRumble,
  Discover,
  Unseal,
  Mine,
  Music,
  Cow,
  Pig,
  Chicken,
  Wolf,
  Dog,
  Cat,
  Hammer,
  /** Host-only request to warm recorded speech without playing or reserving a channel. */
  PrepareSpeech,
  /** A shield turning a blow aside. */
  Parry,
  /** A heavy swing drawn back: a guardian's wind-up, a cast. */
  Swing,
  /** One heavy crash: a guardian's slam, a body falling. */
  Slam,
  /** A low stone thud for a death. */
  Fall,
  /** A sword's sweep biting into flesh or wood. */
  Cleave,
  /** A mace's heavy low thud. */
  Crush,
  /** A bowstring, a short flight and an arrow striking. */
  Pierce,
  /** A staff bolt's muffled burst. */
  Splash,
  // One cue per calling skill, so each has its own priority and interval.
  Challenge,
  Whirl,
  AimedShot,
  Volley,
  RuneBurst,
  FrostRing,
  Mend,
  Sanctuary,
  Rally,
  Dirge,
  /** One monster of a swarm falling: short and dull, made to be heard in numbers. */
  SwarmDeath,
  /** A monster scrabbling out of the wet earth of its den. */
  Spawn,
  /** A den caving in. */
  DenFall,
  /** The brood breaking: a low roll that dies away. */
  BroodBreak,
  /** A low horn as a raid wave sets out. */
  WaveHorn,
  /** A resident struck down: the same crash as `Slam`, mixed above the crowd. */
  Downed,
  /** A bard's lyre phrase; `take` names the phrase. */
  Lyre,
  Count,
}
export enum SpeechChannel {
  Selected,
  Nearby,
}
export enum VoiceLine {
  None = -1,
  Hmm,
  Ahh,
  Attack,
  Hut,
  Phew,
  Murmur,
  Mumble,
  Select,
  Ack,
  Work,
  Yawn,
  Sleep,
  Complain,
  Thanks,
  Alarm,
  Death,
  // Appended reactions retain the original native speech IDs.
  Rain,
  Snow,
  Thunder,
  Count,
}
export enum VoiceKind {
  Young,
  Berserker,
  Maiden,
  Huntress,
  Veteran,
  Count,
}
export class Sound {
  gain = 1;
  pan = 0;
  line = VoiceLine.None;
  voice = VoiceKind.Huntress;
  take = 0;
  pitch = 1;
  delay = 0;
  offset = 0;
  duration = 0;
  speaker = -2;
  speechChannel = SpeechChannel.Selected;
  track = '';
  /** Music only: the track starts over at its end instead of fading out. */
  loop = false;
  constructor(
    public cue: Cue,
    gain = 1,
    pan = 0,
  ) {
    this.gain = Math.fround(gain);
    this.pan = Math.fround(pan);
  }
}
export class Ambience {
  rain = 0;
  wind = 0;
  night = 0;
  birds = 0;
  hammering = 0;
  fire = 0;
  hammerPan = 0;
  firePan = 0;
  water = 0;
  waterPan = 0;
  woods = 0;
  chopping = 0;
  chopPan = 0;
  music = 0;
  raid = 0;
  dark = 0;
  winter = 0;
  gloom = 0;
  /** A large pack of monsters close by: 0 for none, 1 for a swarm filling the view. */
  swarm = 0;
  swarmPan = 0;
}
export function effectVolume(zoom: number): number {
  zoom = Math.fround(zoom);
  return Number.isFinite(zoom)
    ? Math.max(
        Math.fround(0.2),
        Math.min(1, Math.fround(Math.fround(0.2) + Math.fround(zoom * Math.fround(0.25)))),
      )
    : 0;
}
export function noticeCue(text: string): Cue {
  if (text.includes(' gold')) return Cue.Coins;
  if (text.includes(' grew into ') || text.includes(' merged into ') || text.includes(' reached level '))
    return Cue.Growth;
  if (text.startsWith('Discovered ')) return Cue.Discover;
  if (text.endsWith(' is open to adventurers')) return Cue.Unseal;
  return Cue.Notice;
}

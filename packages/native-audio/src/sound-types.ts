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

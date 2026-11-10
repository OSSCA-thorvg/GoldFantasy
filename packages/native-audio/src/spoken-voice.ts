// Recorded speech catalog retaining the original native voice and line IDs.
import { BodyType } from '../../engine/src/person-appearance';
import { f32 as f, hash01 } from '../../engine/src/numeric';
import { Clip, sounds } from './sound-library';
import { VoiceKind, VoiceLine } from './sound-types';
const voices = ['young', 'berserker', 'maiden', 'huntress', 'veteran'];
const lines = [
  'hum',
  'happy',
  'attack',
  'hurt',
  'sigh',
  'hum',
  'mumble',
  'select',
  'ack',
  'work',
  'yawn',
  'sleep',
  'complain',
  'thanks',
  'alarm',
  'death',
  'rain',
  'snow',
  'thunder',
];
export function voicePrefix(line: VoiceLine, voice: VoiceKind): string {
  return line < 0 || line >= VoiceLine.Count || voice < 0 || voice >= VoiceKind.Count
    ? ''
    : `voice/${voices[voice]}/${lines[line]}_`;
}
export function voiceLine(text: string): VoiceLine {
  let word = '';
  for (const value of new TextEncoder().encode(text)) {
    const c = value >= 65 && value <= 90 ? value + 32 : value;
    if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c >= 128) word += String.fromCharCode(c);
  }
  if (!word) return VoiceLine.None;
  if (word === 'hmm' || word === 'hm') return VoiceLine.Hmm;
  if (word === 'ahh' || word === 'ah') return VoiceLine.Ahh;
  if (word === 'attack') return VoiceLine.Attack;
  if (word === 'hut') return VoiceLine.Hut;
  if (word === 'phew' || word === 'hew') return VoiceLine.Phew;
  return VoiceLine.Murmur;
}
export function voiceKind(body: BodyType, look: number, id: number): VoiceKind {
  const kinds = body === BodyType.Female ? 3 : 2,
    pick = Math.min(kinds - 1, Math.trunc(f(hash01(look, id, 0, 0x70ce) * kinds)));
  return (body === BodyType.Female ? VoiceKind.Maiden : 0) + pick;
}
export function voiceTakes(line: VoiceLine, voice: VoiceKind): number {
  const key = voicePrefix(line, voice);
  return key ? sounds.count(key) : 0;
}
export function voiceSample(line: VoiceLine, voice: VoiceKind, take: number): Clip {
  const key = voicePrefix(line, voice);
  return key ? sounds.clip(key, take) : new Clip();
}
export function voiceWords(line: VoiceLine, voice: VoiceKind, take: number): string {
  const key = voicePrefix(line, voice);
  return key ? sounds.caption(sounds.name(key, take)) : '';
}
export function characterVoicePitch(look: number, id: number): number {
  return f(f(0.97) + f(hash01(look, id, 0, 0x701ce) * f(0.06)));
}
export function voiceSampleAt(
  line: VoiceLine,
  voice: VoiceKind,
  take: number,
  seconds: number,
  pitch = 1,
): number {
  return voiceSample(line, voice, take).at(seconds, pitch);
}

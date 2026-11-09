// Direct translation of game_soundscape.cpp.
import { type GameSpeechApp, speakerState } from './game-speech';
import { appearanceOf } from '../../../../packages/engine/src/person-look';
import { distance, unproject } from '../../../../packages/engine/src/geometry';
import { f32 as f, clamp, hash01 } from '../../../../packages/engine/src/numeric';
import { Weather } from '../../../../packages/engine/src/climate';
import { Thunderstorm } from '../../../../packages/engine/src/thunderstorm';
import { Town } from '../../../../packages/engine/src/town';
import { AnimalKind, type Monster } from '../../../../packages/engine/src/person';
import {
  Cue,
  Sound,
  VoiceLine,
  characterVoicePitch,
  voiceKind,
  Moment,
  MusicDirector,
} from '../../../../packages/native-audio/src';
export interface GameSoundApp extends GameSpeechApp {
  director: MusicDirector;
  storm: Thunderstorm;
  gameSpeed(): number;
  cue(cue: Cue): void;
  sayLine(id: number, line: VoiceLine): boolean;
  playMoment(moment: Moment, seconds: number): void;
}
export function sayLine(this: GameSoundApp, id: number, line: VoiceLine): boolean {
  const person = this.town.person(id);
  if (!person) return false;
  const voice = voiceKind(appearanceOf(person).bodyType, person.look, person.id);
  return speakerState(this, id).speech.say(
    line,
    Math.max(0, this.last),
    characterVoicePitch(person.look, person.id),
    voice,
  );
}
export function playMoment(this: GameSoundApp, moment: Moment, seconds: number): void {
  if (this.town.bardPlaying()) return;
  const track = this.director.moment(moment, seconds);
  if (!track) return;
  const tune = new Sound(Cue.Music);
  tune.track = track;
  this.cues.push(tune);
}
export function raiseAlarm(this: GameSoundApp, seconds: number): void {
  this.playMoment(Moment.Battle, seconds);
  let crier = this.chosen[0] ?? -1;
  if (crier < 0) {
    const middle = unproject(this.camera.x, this.camera.y);
    let best = f(1e9);
    for (const person of this.town.people()) {
      const gap = distance(person.position, middle);
      if (person.visibility() > f(0.05) && gap < best && this.renderer.visible(person.position)) {
        best = gap;
        crier = person.id;
      }
    }
  }
  if (crier >= 0) this.sayLine(crier, VoiceLine.Alarm);
}
export function grunt(this: GameSoundApp, id: number): void {
  if (this.speakers.get(id)?.speech.playing(this.last)) return;
  this.sayLine(id, VoiceLine.Hut);
}
export function soundscape(this: GameSoundApp, seconds: number): void {
  const sky = this.town.climate(),
    dark = sky.night > f(0.5),
    roll = (salt: number) => hash01(this.town.map().seed(), Math.trunc(seconds * 10), salt, 0x4a7e);
  if (this.soundscaping) {
    const fresh = this.chosen.find((id) => !this.heardChosen.includes(id));
    if (fresh !== undefined && !this.town.isTitleAutoplay()) this.sayLine(fresh, VoiceLine.Select);
    const ordered = this.cues.some((sound) => sound.cue === Cue.Order);
    if (ordered && !this.status && this.chosen.length)
      this.sayLine(
        this.chosen[Math.trunc(f(roll(1) * this.chosen.length)) % this.chosen.length],
        VoiceLine.Ack,
      );
    const shown =
        this.selected >= 0 ? this.selected : this.selectedDungeon >= 0 ? 1000000 + this.selectedDungeon : -1,
      placed = this.cues.some((sound) => sound.cue === Cue.Place);
    if (shown !== this.heardSelected && shown >= 0 && !placed) this.cues.push(new Sound(Cue.Open, 0.55));
    if (this.status !== this.heardStatus && this.status) this.cue(Cue.Refuse);
    if (dark !== this.wasDark) this.playMoment(dark ? Moment.Dusk : Moment.Dawn, seconds);
  }
  this.heardChosen = [...this.chosen];
  this.heardSelected =
    this.selected >= 0 ? this.selected : this.selectedDungeon >= 0 ? 1000000 + this.selectedDungeon : -1;
  this.heardStatus = this.status;
  this.wasDark = dark;
  const wet = sky.weather === Weather.Rain || sky.weather === Weather.Storm;
  if (seconds >= this.nextRaven) {
    const near = clamp(f(f(this.camera.zoom - f(0.3)) / f(0.9)), 0, 1),
      chance = roll(2);
    if (this.soundscaping && !dark && !wet && near > f(0.2))
      this.cues.push(
        new Sound(Cue.Raven, f(f(f(0.22) + f(f(0.2) * chance)) * near), f(f(chance * f(1.6)) - f(0.8))),
      );
    this.nextRaven = seconds + 40 + f(80 * chance);
  }
  const animalCall = (pig: boolean) => {
    let caller: Monster | null = null;
    let best = -1;
    for (const animal of this.town.wildlife())
      if (
        animal.health > 0 &&
        (animal.animal === AnimalKind.Pig) === pig &&
        this.renderer.visible(animal.position)
      ) {
        const score = hash01(this.town.map().seed(), animal.id, Math.trunc(seconds / 10), 199);
        if (score > best) {
          best = score;
          caller = animal;
        }
      }
    if (this.soundscaping && this.gameSpeed() > 0 && caller) {
      const sound = this.spatial(Cue.Cow + caller.animal!, caller.position);
      sound.gain = f(sound.gain * f(0.4));
      if (sound.gain > f(0.03)) this.cues.push(sound);
    }
  };
  if (seconds >= this.nextAnimal) {
    animalCall(false);
    this.nextAnimal = seconds + 10 + f(12 * roll(11));
  }
  // Pigs make brief individual grunts, with quiet gaps instead of a long call sequence.
  if (seconds >= this.nextPig) {
    animalCall(true);
    this.nextPig = seconds + 4 + f(4 * roll(12));
  }
  let animalHeard = 0;
  for (const call of this.town.wildlifeCalls()) {
    if (call.serial < this.heardAnimal) continue;
    this.heardAnimal = BigInt.asUintN(64, call.serial + 1n);
    if (
      !this.soundscaping ||
      animalHeard >= 2 ||
      this.town.clock() - call.at > 0.3 ||
      !this.renderer.visible(call.position)
    )
      continue;
    const sound = this.spatial(Cue.Cow + call.kind, call.position);
    sound.gain = f(sound.gain * f(0.55));
    if (sound.gain > f(0.03)) {
      this.cues.push(sound);
      ++animalHeard;
    }
  }
  if (this.gameSpeed() > 0) {
    const day = BigInt(Math.trunc(this.town.clock() / Town.secondsPerDay)),
      activity = Thunderstorm.activity(this.town.map().seed(), day),
      strike = this.storm.update(seconds, sky.weather, sky.intensity, activity);
    if (strike) {
      this.renderer.lightning(strike);
      const loudness = [f(0.9), f(0.75), f(0.55), f(0.4)],
        thunder = new Sound(
          Cue.ThunderCrack + strike.reach,
          loudness[strike.reach],
          f(clamp(f(f(strike.across * 2) - 1), -1, 1) * f(0.8)),
        );
      thunder.delay = strike.delay;
      this.cues.push(thunder);
    }
  }
  this.soundscaping = true;
}

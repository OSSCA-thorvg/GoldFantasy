// Direct translation of game_speech.cpp.
import { GameAppState } from './game-app-state';
import type { Point } from '../../../../packages/engine/src/geometry';
import { point } from '../../../../packages/engine/src/geometry';
import { f32 as f, clamp } from '../../../../packages/engine/src/numeric';
import { appearanceOf } from '../../../../packages/engine/src/person-look';
import type { Person } from '../../../../packages/engine/src/person';
import { Mood, moodOf } from '../../../../packages/native-renderer/src/person-portrait';
import { personSpeechAnchor } from '../../../../packages/native-renderer/src/world-sprites';
import {
  PersonSpeech,
  characterVoicePitch,
  voiceKind,
  Cue,
  Sound,
  VoiceLine,
  SpeechChannel,
  EffectManager,
} from '../../../../packages/native-audio/src';
import { Align, Rect } from '../../../../packages/native-ui/src';
export class SpeakerState {
  speech = new PersonSpeech();
  heard = 0n;
  heardChannel = SpeechChannel.Selected;
}
export interface GameSpeechApp extends GameAppState {
  speakers: Map<number, SpeakerState>;
  editor: unknown | null;
  toScreen(at: Point): Point;
  spatial(cue: Cue, at: Point): Sound;
  speechAudio(
    speech: PersonSpeech,
    speaker: number,
    placement: Sound,
    seconds: number,
    state: { heard: bigint },
    audible: boolean,
  ): void;
}
export function speakerState(app: GameSpeechApp, id: number): SpeakerState {
  let state = app.speakers.get(id);
  if (!state) {
    state = new SpeakerState();
    app.speakers.set(id, state);
  }
  return state;
}
export function sayPerson(this: GameSpeechApp, id: number, text: string): boolean {
  const person = this.town.person(id);
  return (
    !!person &&
    speakerState(this, id).speech.say(
      text,
      Math.max(0, this.last),
      characterVoicePitch(person.look, person.id),
      voiceKind(appearanceOf(person).bodyType, person.look, person.id),
    )
  );
}
export function personSpeech(this: GameSpeechApp, id: number): PersonSpeech | null {
  return this.speakers.get(id)?.speech ?? null;
}
export function updateSpeech(this: GameSpeechApp, seconds: number): void {
  const audible = (person: Person) => {
    const screen = this.toScreen(person.position);
    return (
      !this.editor &&
      !person.inside &&
      !person.crossingDoorway() &&
      screen.x >= -24 &&
      screen.x <= f(this.viewWidth + 24) &&
      screen.y >= 0 &&
      screen.y <= f(this.viewHeight + 24) &&
      this.renderer.visible(person.position)
    );
  };
  const talking = [0, 0];
  for (const person of this.town.people()) {
    const found = this.speakers.get(person.id);
    if (!found || !found.speech.playing(seconds) || !audible(person)) continue;
    ++talking[this.chosen.includes(person.id) ? 0 : 1];
  }
  for (const person of this.town.people()) {
    const selected = this.chosen.includes(person.id),
      heardHere = audible(person);
    if (!heardHere && !this.speakers.has(person.id)) continue;
    const state = speakerState(this, person.id),
      speech = state.speech,
      channel = selected ? SpeechChannel.Selected : SpeechChannel.Nearby;
    if (state.heard && state.heardChannel !== channel) {
      const stop = new Sound(Cue.SpeechStop);
      stop.speaker = person.id;
      this.cues.push(stop);
      state.heard = 0n;
    }
    state.heardChannel = channel;
    const group = selected ? 0 : 1,
      limit = selected ? EffectManager.maxSelectedSpeech : EffectManager.maxNearbySpeech,
      automatic = heardHere && talking[group] < limit && seconds >= this.nextSpeechAt[group],
      before = speech.sequence();
    speech.update(person, moodOf(person) as Mood, seconds, automatic);
    if (speech.sequence() !== before) {
      ++talking[group];
      this.nextSpeechAt[group] = seconds + (selected ? 0.85 : 0.35);
    }
    const placement = this.spatial(Cue.Speech, person.position);
    placement.gain = f(placement.gain * f(0.6));
    placement.speechChannel = channel;
    this.speechAudio(speech, person.id, placement, seconds, state, heardHere);
  }
}
export function speechAudio(
  this: GameSpeechApp,
  speech: PersonSpeech,
  speaker: number,
  placement: Sound,
  seconds: number,
  state: { heard: bigint },
  audible: boolean,
): void {
  const stop = () => {
    const sound = new Sound(Cue.SpeechStop);
    sound.speaker = speaker;
    this.cues.push(sound);
  };
  if (!audible) {
    if (state.heard) stop();
    state.heard = 0n;
    return;
  }
  if (state.heard === speech.sequence()) return;
  state.heard = speech.sequence();
  if (!speech.playing(seconds) || speech.voice() === VoiceLine.None) {
    stop();
    return;
  }
  const offset = Math.max(0, seconds - speech.startedAt() - 0.16);
  if (offset >= speech.voiceDuration() || placement.gain < f(0.03)) return;
  placement.cue = Cue.Speech;
  placement.line = speech.voice();
  placement.voice = speech.voiceKind();
  placement.take = speech.voiceTake();
  placement.pitch = speech.voicePitch();
  placement.speaker = speaker;
  placement.delay = f(Math.max(0, speech.startedAt() + 0.16 - seconds));
  placement.offset = f(offset);
  placement.duration = f(speech.voiceDuration());
  const count = this.cues.filter(
      (sound) => sound.cue === Cue.Speech && sound.speechChannel === placement.speechChannel,
    ).length,
    limit =
      placement.speechChannel === SpeechChannel.Selected
        ? EffectManager.maxSelectedSpeech
        : EffectManager.maxNearbySpeech;
  if (count < limit) this.cues.push(placement);
}
export function speechBubbles(this: GameSpeechApp, width: number, height: number): void {
  width = f(width);
  height = f(height);
  if (width < 96 || height < 96) return;
  const bubbles: { anchor: Point; box: Rect; text: string; alpha: number }[] = [];
  for (const person of this.town.people()) {
    const found = this.speakers.get(person.id);
    if (!found || person.visibility() <= 0 || !this.renderer.visible(person.position)) continue;
    const caption = found.speech.caption(this.context.time()),
      opacity = f(found.speech.captionOpacity(this.context.time()) * person.visibility());
    if (!caption || opacity <= 0) continue;
    const feet = this.toScreen(person.position),
      head = personSpeechAnchor(person),
      anchor = point(f(feet.x + f(head.x * this.camera.zoom)), f(feet.y + f(head.y * this.camera.zoom)));
    if (
      feet.x < -24 ||
      feet.x > f(width + 24) ||
      feet.y < 0 ||
      feet.y > f(height + 24) ||
      anchor.y < 8 ||
      anchor.y > f(height - 48)
    )
      continue;
    const w = clamp(f(this.context.textWidth(caption, 13) + 20), 54, Math.min(200, f(width - 16))),
      box = new Rect(
        clamp(f(anchor.x - f(w / 2)), 8, f(f(width - w) - 8)),
        Math.max(8, f(f(anchor.y - 38) - f(f(1 - opacity) * 4))),
        w,
        30,
      );
    for (const other of bubbles)
      if (
        box.x < f(f(other.box.x + other.box.w) + 4) &&
        f(f(box.x + box.w) + 4) > other.box.x &&
        box.y < f(f(other.box.y + other.box.h) + 5) &&
        f(f(box.y + box.h) + 5) > other.box.y
      )
        box.y = Math.max(8, f(f(other.box.y - box.h) - 7));
    bubbles.push({ anchor, box, text: caption, alpha: opacity });
  }
  for (const bubble of bubbles) {
    const surface = { ...this.theme.raised },
      border = { ...this.theme.border },
      ink = { ...this.theme.text };
    surface.a = border.a = ink.a = Math.trunc(f(255 * clamp(bubble.alpha, 0, 1)));
    const box = bubble.box,
      stem = clamp(bubble.anchor.x, f(box.x + 9), f(f(box.x + box.w) - 9));
    this.context.paint(JSON.stringify(['b', box, bubble.anchor, surface]), () =>
      new this.context.tvg.Shape()
        .moveTo(f(stem - 5), f(f(box.y + box.h) - 1))
        .lineTo(bubble.anchor.x, bubble.anchor.y)
        .lineTo(f(stem + 5), f(f(box.y + box.h) - 1))
        .close()
        .fill(surface.r, surface.g, surface.b, surface.a)
        .stroke({ width: 1, color: [border.r, border.g, border.b, border.a] }),
    );
    this.context.rect(box, surface, this.theme.radius, border);
    const text = this.context.elideText(bubble.text, f(box.w - 16), 13);
    this.context.text(
      new Rect(f(box.x + 8), f(box.y + 3), f(box.w - 16), f(box.h - 6)),
      text,
      ink,
      13,
      false,
      Align.Center,
    );
    this.context.requestAnimationFrame();
  }
}

import { describe, expect, it } from 'vitest';
import { SoundBoard } from '../../packages/native-audio/src/sound-board';
import { SoundLibrary } from '../../packages/native-audio/src/sound-library';
import { Cue, Sound } from '../../packages/native-audio/src/sound-types';
import { treeFallClipImpactSeconds } from '../../packages/native-audio/src/sound-catalog';

function render(board: SoundBoard, seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * 44100) * 2);
  for (let first = 0; first < out.length / 2; first += 128) {
    const count = Math.min(128, out.length / 2 - first);
    board.render(out.subarray(first * 2, (first + count) * 2), count);
  }
  return out;
}
const energy = (samples: Float32Array, from = 0, to = samples.length / 88200): number => {
  let sum = 0;
  for (let i = Math.round(from * 88200); i < Math.min(samples.length, Math.round(to * 88200)); ++i)
    sum += samples[i] ** 2;
  return sum;
};

describe('work sound delivery', () => {
  for (const cue of [Cue.Chop, Cue.TreeFall, Cue.Hammer])
    it(`keeps cue ${cue} audible before its PCM is installed`, () => {
      const board = new SoundBoard(new SoundLibrary());
      board.play(new Sound(cue));
      expect(energy(render(board, 1))).toBeGreaterThan(0.1);
    });

  it('honors scheduled impact time for a missing sample without pre-playing the fallback', () => {
    const board = new SoundBoard(new SoundLibrary()),
      sound = new Sound(Cue.Chop);
    sound.delay = 0.2;
    board.play(sound);
    const output = render(board, 0.6);
    expect(energy(output, 0, 0.199)).toBe(0);
    expect(energy(output, 0.2, 0.4)).toBeGreaterThan(0.1);
  });

  it('lowers the axe resonance and softens its sharp high-frequency transient', () => {
    const library = new SoundLibrary(),
      pcm = new Int16Array(11025);
    for (let i = 0; i < pcm.length; ++i) {
      const t = i / 22050;
      pcm[i] = Math.round(14000 * (Math.sin(2 * Math.PI * 180 * t) + Math.sin(2 * Math.PI * 5000 * t)));
    }
    pcm[0] = 32767;
    library.setClip('sfx/chop_01', pcm, 22050);
    const board = new SoundBoard(library);
    board.play(new Sound(Cue.Chop));
    const output = render(board, 0.5),
      power = (frequency: number): number => {
        let real = 0,
          imaginary = 0;
        for (let i = 882; i < 6174; ++i) {
          const phase = (2 * Math.PI * frequency * i) / 44100;
          real += output[i * 2] * Math.cos(phase);
          imaginary += output[i * 2] * Math.sin(phase);
        }
        return real * real + imaginary * imaginary;
      };
    const low = Array.from({ length: 171 }, (_, i) => ({ hz: i + 80, power: power(i + 80) })).sort(
      (a, b) => b.power - a.power,
    )[0];
    const high = Math.max(...Array.from({ length: 301 }, (_, i) => power(3000 + i * 10)));
    expect(output[0]).toBe(0);
    expect(low.hz).toBeGreaterThan(115);
    expect(low.hz).toBeLessThan(145);
    expect(high / low.power).toBeLessThan(0.08);
    expect(energy(output, 0.18, 0.24)).toBeGreaterThan(0.1);
    expect(energy(output, 0.3, 0.5)).toBe(0);
  });

  it('plays exactly one hammer impact from a recording containing three strikes', () => {
    const library = new SoundLibrary(),
      pcm = new Int16Array(36612);
    for (const start of [0, 0.48, 0.96])
      for (let i = 0; i < 2205; ++i) {
        const t = i / 22050;
        pcm[Math.round(start * 22050) + i] = Math.round(
          18000 * Math.sin(t * Math.PI * 380) * Math.exp(-t * 30),
        );
      }
    library.setClip('sfx/hammer_01', pcm, 22050);
    const board = new SoundBoard(library);
    board.play(new Sound(Cue.Hammer));
    const output = render(board, 1.8);
    expect(energy(output, 0, 0.2)).toBeGreaterThan(1);
    expect(energy(output, 0.37, 1.8)).toBe(0);
    expect(board.effectStatistics().effects).toBe(0);
  });

  it('aligns the tree crash peak with its declared lead-in and caller delay', () => {
    const library = new SoundLibrary(),
      pcm = new Int16Array(76776);
    pcm[41279] = 16000;
    pcm[41280] = 30000;
    pcm[41281] = 16000;
    library.setClip('sfx/tree_fall_01', pcm, 22050);
    const board = new SoundBoard(library),
      sound = new Sound(Cue.TreeFall);
    sound.delay = 0.2;
    board.play(sound);
    const output = render(board, 1.5);
    let peak = 0;
    for (let i = 2; i < output.length; i += 2) if (Math.abs(output[i]) > Math.abs(output[peak])) peak = i;
    expect(output[peak]).toBeGreaterThan(0.4);
    expect(peak / 88200).toBeCloseTo(0.2 + treeFallClipImpactSeconds, 3);
    expect(energy(output, 0, 0.2)).toBe(0);
  });

  it('uses a late-installed clip for the next cue without replaying the old cue', () => {
    const library = new SoundLibrary(),
      board = new SoundBoard(library);
    board.play(new Sound(Cue.Chop));
    expect(energy(render(board, 0.4))).toBeGreaterThan(0.1);
    library.setClip('sfx/chop_01', new Int16Array(11025).fill(8000), 22050);
    expect(energy(render(board, 0.1))).toBe(0);
    board.play(new Sound(Cue.Chop));
    expect(energy(render(board, 0.4))).toBeGreaterThan(1);
  });
});

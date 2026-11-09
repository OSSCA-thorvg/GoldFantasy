import { beforeAll, describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { TreeWorkKind, type TreeWorkEvent } from '../../packages/engine/src/person';
import { point } from '../../packages/engine/src/geometry';
import { copyNative } from '../../packages/engine/src/native-copy';
import { treeFallTiming } from '../../packages/engine/src/work-timing';
import { Cue, Sound, treeFallClipImpactSeconds } from '../../packages/native-audio/src';
import { queueWorkSounds, type WorkAudioHost } from '../../apps/web/src/native/work-audio';
let base: Town;
beforeAll(() => {
  base = new Town(5, 32, false);
  base.time = 100;
});
function fixture(kinds: TreeWorkKind[], speed = 1, title = false): WorkAudioHost {
  const town = copyNative(base);
  town.titleAutoplay = title;
  town.timberEvents = kinds.map((kind, i) => ({
    serial: BigInt(i),
    kind,
    person: i,
    cell: 20 * 32 + 20,
    index: 0,
    worker: point(20, 20),
    at: 100,
  }));
  return {
    town,
    heardTree: 0n,
    cues: [],
    renderer: { visible: () => true },
    spatial: (cue) => new Sound(cue),
    gameSpeed: () => speed,
  };
}
describe('work sounds follow visible contacts', () => {
  it('holds the crash during a pause and adapts to a speed change before landing', () => {
    const app = fixture([TreeWorkKind.Fall]);
    queueWorkSounds(app);
    expect(app.cues).toEqual([]);
    app.gameSpeed = () => 0;
    app.town.time = 100.4;
    queueWorkSounds(app);
    expect(app.cues).toEqual([]);
    app.gameSpeed = () => 2;
    app.town.time = 100 + treeFallTiming.impact - treeFallClipImpactSeconds;
    queueWorkSounds(app);
    expect(app.cues).toHaveLength(1);
    expect(app.cues[0].offset).toBeCloseTo(treeFallClipImpactSeconds / 2, 8);
  });
  it('discards pending crashes when the application switches to another world', () => {
    const app = fixture([TreeWorkKind.Fall]);
    queueWorkSounds(app);
    expect(app.cues).toEqual([]);
    app.town = copyNative(base);
    app.town.time = 101;
    app.heardTree = 0n;
    queueWorkSounds(app);
    expect(app.cues).toEqual([]);
  });
  it('keeps the falling-tree cue when four chopping events fill the frame budget', () => {
    const app = fixture([TreeWorkKind.Fall, ...Array(4).fill(TreeWorkKind.Chop)]);
    app.town.time = 100 + treeFallTiming.impact;
    for (const event of app.town.timberEvents) if (event.kind === TreeWorkKind.Chop) event.at = app.town.time;
    queueWorkSounds(app);
    expect(app.cues.some((c) => c.cue === Cue.TreeFall)).toBe(true);
    expect(app.cues).toHaveLength(4);
    expect(app.heardTree).toBe(5n);
  });
  for (const title of [false, true])
    it(`aligns the crash with ground contact in ${title ? '4× title' : 'normal play'}`, () => {
      const app = fixture([TreeWorkKind.Fall], 1, title);
      queueWorkSounds(app);
      expect(app.cues).toEqual([]);
      const speed = title ? 4 : 1;
      app.town.time = 100 + treeFallTiming.impact - (treeFallClipImpactSeconds * speed) / 2;
      queueWorkSounds(app);
      const sound = app.cues[0];
      expect(sound.cue).toBe(Cue.TreeFall);
      expect(sound.delay + treeFallClipImpactSeconds - sound.offset).toBeCloseTo(
        (100 + treeFallTiming.impact - app.town.time) / speed,
        8,
      );
    });
  it('starts in the crash decay when a delayed frame has already passed landing', () => {
    const app = fixture([TreeWorkKind.Fall]);
    app.town.time += 0.7;
    queueWorkSounds(app);
    expect(app.cues).toHaveLength(1);
    expect(app.cues[0].delay).toBe(0);
    expect(app.cues[0].offset).toBeCloseTo(0.7 - treeFallTiming.impact + treeFallClipImpactSeconds, 8);
  });
  it('plays one discrete hammer cue from the worker rather than a random ambience clock', () => {
    const app = fixture([TreeWorkKind.Hammer]);
    queueWorkSounds(app);
    expect(app.cues.map((c) => c.cue)).toEqual([Cue.Hammer]);
  });
  it('does not replay stale impacts or play work sounds while paused', () => {
    const stale = fixture([TreeWorkKind.Chop]);
    stale.town.time += 0.5;
    queueWorkSounds(stale);
    expect(stale.cues).toEqual([]);
    expect(stale.heardTree).toBe(1n);
    const paused = fixture([TreeWorkKind.Chop, TreeWorkKind.Fall], 0);
    queueWorkSounds(paused);
    expect(paused.cues).toEqual([]);
    expect(paused.heardTree).toBe(2n);
  });
});

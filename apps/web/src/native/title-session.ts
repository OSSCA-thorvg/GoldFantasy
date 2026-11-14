// One run of the world behind the title: the town plays at title pace under the ordinary rules, the title player
// decides, the director frames it, and the run asks to be replaced when the saga ends or has run long enough.
import { Town } from '../../../../packages/engine/src/town';
import type { Camera } from '../../../../packages/engine/src/geometry';
import type { Person } from '../../../../packages/engine/src/person';
import { Saga, sagaState } from '../../../../packages/engine/src/gate-seals';
import { titleAutoplayRate } from '../../../../packages/engine/src/work-timing';
import { TitlePlayer } from './title-player';
import { TitleDirector } from './title-director';
import { TitleCamera } from './title-camera';
import { living } from './title-roster';
import type { Preview, PreviewWorld } from './application-contracts';

export const titleSessionRules = {
  /** Game seconds per title second: the usual pace, slower while a fight is on, faster through a quiet night. */
  pace: titleAutoplayRate,
  fightPace: 2,
  nightPace: 6,
  /** Title seconds a run lasts before a fresh world replaces it. */
  longest: 100 * 60,
  /** Title seconds the end of a saga stays on screen before the restart. */
  lingerAtEnd: 12,
};
export interface TitlePlay {
  advance(seconds: number): void;
  camera(width: number, height: number, seconds: number, reducedMotion: boolean): Camera;
  /** The resident the camera follows, for the caption and the selection ring. */
  subject(): Person | null;
  /** True once the run has ended and a fresh preview should replace it. */
  finished(): boolean;
}
export class TitleSession implements TitlePlay {
  readonly player: TitlePlayer;
  readonly director = new TitleDirector();
  elapsed = 0;
  private endedAt = -1;
  constructor(
    readonly town: Town,
    seed: number,
    holdSky: boolean,
  ) {
    town.titleShowcase = true;
    // A save's preview keeps the daylight it was saved in, so Continue reveals the sky already on screen.
    if (holdSky) town.titleSky = { year: town.yearFraction(), day: town.dayFraction() };
    this.player = new TitlePlayer(seed >>> 0);
  }
  /** Game seconds per title second right now. */
  pace(): number {
    const town = this.town;
    if (town.realmActive() || town.raiding()) return titleSessionRules.fightPace;
    const outside = living(town).some((p) => !p.inside);
    return town.climate().night > 0.6 && !outside ? titleSessionRules.nightPace : titleSessionRules.pace;
  }
  advance(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const dt = Math.min(seconds, 0.25);
    this.elapsed += dt;
    this.town.advance(dt * this.pace());
    this.player.update(this.town);
    if (this.endedAt < 0 && sagaState(this.town) !== Saga.Playing) this.endedAt = this.elapsed;
  }
  camera(width: number, height: number, seconds: number, reducedMotion: boolean): Camera {
    return this.director.update(this.town, width, height, seconds, reducedMotion);
  }
  subject(): Person | null {
    return this.director.person(this.town);
  }
  finished(): boolean {
    return (
      this.elapsed >= titleSessionRules.longest ||
      (this.endedAt >= 0 && this.elapsed - this.endedAt >= titleSessionRules.lingerAtEnd)
    );
  }
}
/** The engine's own title autoplay, for preview worlds that are not a full town. */
class EngineTitlePlay implements TitlePlay {
  private follow = new TitleCamera();
  constructor(
    private world: PreviewWorld,
    seed: number,
    holdSky: boolean,
  ) {
    world.startTitleAutoplay(seed, holdSky);
  }
  advance(seconds: number): void {
    this.world.advanceTitleAutoplay(seconds);
  }
  camera(width: number, height: number, seconds: number, reducedMotion: boolean): Camera {
    return this.follow.update(this.world, width, height, seconds, reducedMotion);
  }
  subject(): Person | null {
    return this.world.titleAutoplaySubject();
  }
  finished(): boolean {
    return false;
  }
}
/** Starts the title's run on a freshly created (or save-loaded) preview. */
export function startTitlePlay(preview: Preview, seed: number, holdSky: boolean): TitlePlay {
  const world = preview.state();
  return world instanceof Town ? new TitleSession(world, seed, holdSky) : new EngineTitlePlay(world, seed, holdSky);
}

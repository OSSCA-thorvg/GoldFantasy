// Orders and selections for commanding a few residents in a fight: hold, the fighters at hand, every one of a
// calling on screen, and the marks where a group will stand.
import { Activity, type Calling, type Person } from '../../../../packages/engine/src/person';
import { project } from '../../../../packages/engine/src/geometry';
import { skillOfCalling } from '../../../../packages/engine/src/skill-catalog';
import { Order } from '../../../../packages/engine/src/game-tools';
import type { Town } from '../../../../packages/engine/src/town';
import { canControl, isPlayerResident } from '../../../../packages/engine/src/faction';
import { Cue, Sound } from '../../../../packages/native-audio/src';
import { controllableIds, selectionControlReason } from './game-control';
import type { GameAppState } from './game-app-state';

/** H: the selection stands where it is, strikes what comes into reach and never chases. */
export function holdPosition(app: GameAppState): boolean {
  const ids = controllableIds(app.town, app.chosen);
  if (!ids.length) {
    app.status = selectionControlReason(app.town, app.chosen);
    return false;
  }
  const held = app.town.orderHold(ids);
  // Like Stop: queued work must not pull them off the spot.
  for (const id of ids) app.stoppedWork.set(id, app.workSerial);
  app.pending = Order.None;
  app.army.aim = null;
  app.status = held ? '' : 'No one selected can hold here';
  if (held && app.cues.length < 32) app.cues.push(new Sound(Cue.Order));
  return held > 0;
}
/** True when every controllable resident in `ids` is holding position. */
export function allHolding(town: Town, ids: readonly number[]): boolean {
  const own = controllableIds(town, ids);
  return own.length > 0 && own.every((id) => town.person(id)?.holding);
}
const working = new Set([
  Activity.Building,
  Activity.Roadwork,
  Activity.Working,
  Activity.Sleeping,
  Activity.Hauling,
  Activity.Felling,
  Activity.Collecting,
  Activity.Mining,
  Activity.Treating,
  Activity.FetchingMaterials,
  Activity.DeliveringMaterials,
  Activity.WaitingMaterials,
  Activity.Training,
  Activity.Crafting,
  Activity.Tending,
]);
/** Residents with a fighting calling who stand outdoors and are not busy with work, sleep or a rescue. */
export function fightersAtHand(town: Town): Person[] {
  return town
    .people()
    .filter(
      (p) =>
        canControl(p) &&
        !!skillOfCalling(p.calling, 0) &&
        p.health > 0 &&
        p.downedAt < 0 &&
        !p.inside &&
        p.activity !== Activity.Expedition &&
        p.activity !== Activity.Leaving &&
        !working.has(p.activity),
    );
}
/** Every resident of the player whose figure is on screen and who shares `calling`. */
export function callingOnScreen(app: GameAppState, calling: Calling): number[] {
  return app.town
    .people()
    .filter((p) => {
      if (p.calling !== calling || !isPlayerResident(p) || p.inside) return false;
      const at = app.camera.toScreen(project(p.position.x, p.position.y), app.viewWidth, app.viewHeight);
      return at.x >= 0 && at.y >= 0 && at.x <= app.viewWidth && at.y <= app.viewHeight;
    })
    .map((p) => p.id);
}

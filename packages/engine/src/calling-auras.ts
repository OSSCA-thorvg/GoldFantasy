import { Calling, Role, type Person } from './person';
import { distance } from './geometry';

export const auraReach = 5;
export const songBonus = 1.15;
export const wardFactor = 0.8;
const near = (folk: readonly Person[], p: Person, calling: Calling, self: boolean): boolean =>
  folk.some(
    (ally) =>
      ally.calling === calling &&
      ally.role === Role.Resident &&
      ally.faction === p.faction &&
      ally.health > 0 &&
      !ally.inside &&
      (self || ally.id !== p.id) &&
      distance(ally.position, p.position) <= auraReach,
  );
/** A bard's song strengthens the blows of everyone else nearby; songs do not stack. */
export const songOf = (folk: readonly Person[], p: Person): number =>
  near(folk, p, Calling.Bard, false) ? songBonus : 1;
/** A cleric's ward softens monster blows on the cleric and nearby allies; wards do not stack. */
export const wardOf = (folk: readonly Person[], p: Person): number =>
  near(folk, p, Calling.Cleric, true) ? wardFactor : 1;

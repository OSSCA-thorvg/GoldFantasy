// Keeps the title settlement's people from breaking: the strained are left to rest or sent to the tavern
// before stress overwhelms them, since a second breakdown makes a resident leave the settlement.
import { Structure } from '../../../../packages/engine/src/building-catalog';
import { TownState } from '../../../../packages/engine/src/town-state';
import { isPlayerBuilding } from '../../../../packages/engine/src/faction';
import { order, take, type TitleContext } from './title-roster';

export const wellbeingRules = {
  /** Stress at which a resident gets no new work and goes to the tavern if there is one. */
  strained: 0.45,
  /** Share of a day worked after which nobody is handed more work today. */
  shift: 0.38,
};
export function keepWell(ctx: TitleContext): void {
  const { town } = ctx,
    tavern = town.buildings().find((b) => isPlayerBuilding(b) && b.kind === Structure.Tavern && b.built());
  for (const p of [...ctx.free]) {
    const strained = p.stress >= wellbeingRules.strained,
      spent = p.worked >= TownState.secondsPerDay * wellbeingRules.shift;
    if (!strained && !spent) continue;
    take(ctx, p);
    const from = p.inside ? p.entrance : p.position;
    if (strained && tavern && town.grid.path(from, tavern.door()).length)
      order(ctx, `relax:${p.id}:${tavern.id}:${town.days}`, [p], () => town.orderRelax([p.id], tavern.id));
  }
}

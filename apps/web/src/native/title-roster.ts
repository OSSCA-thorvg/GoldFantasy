// Who the title player can give an order to this step, and the shared state its behaviours decide with.
import type { Town } from '../../../../packages/engine/src/town';
import { Activity, Role, type Person } from '../../../../packages/engine/src/person';
import { isPlayerResident } from '../../../../packages/engine/src/faction';
import type { OrderLedger } from './title-orders';

export interface TitleContext {
  town: Town;
  seed: number;
  ledger: OrderLedger;
  /** Residents still without a decision this step; a behaviour that orders one takes them out. */
  free: Person[];
  /** Residents kept for the party, who settlement work must not take. */
  party: Set<number>;
  step: number;
  /** Decisions put off until a later step, by key; kept by the player across steps. */
  later: Map<string, number>;
}
/** True while `key` is put off. */
export const waiting = (ctx: TitleContext, key: string): boolean => (ctx.later.get(key) ?? -1) > ctx.step;
/** Puts `key` off for `steps` decisions. */
export function putOff(ctx: TitleContext, key: string, steps: number): void {
  ctx.later.set(key, ctx.step + steps);
  if (ctx.later.size > 200) for (const [k, until] of ctx.later) if (until <= ctx.step) ctx.later.delete(k);
}
/** Tasks a resident keeps until they are done; the planner never pulls someone out of one. */
const committed = [
  Activity.Crafting,
  Activity.Building,
  Activity.Roadwork,
  Activity.Praying,
  Activity.Training,
  Activity.Fighting,
  Activity.Expedition,
];
/** Moments the engine gives a resident for their own needs. */
const resting = [Activity.Sleeping, Activity.Eating, Activity.Drinking, Activity.Relaxing, Activity.Treating, Activity.Downed];
export const living = (town: Town): Person[] =>
  town.people().filter((p) => isPlayerResident(p) && p.role === Role.Resident && p.health > 0 && p.downedAt < 0);
export function beyond(town: Town, p: Person): boolean {
  return p.activity === Activity.Expedition || p.activity === Activity.Leaving || town.inRealm(p.position);
}
/** Can take a new order now: home, awake, fed and rested enough, and not in the middle of a committed task. */
export function available(town: Town, p: Person): boolean {
  if (beyond(town, p) || resting.includes(p.activity) || p.recoveringRest || p.recoveringHealth) return false;
  if (committed.includes(p.task)) return false;
  return p.rest > 0.2 && p.food > 0.15 && p.hydration > 0.15 && p.health > 0.3;
}
export function take(ctx: TitleContext, p: Person): void {
  const at = ctx.free.indexOf(p);
  if (at >= 0) ctx.free.splice(at, 1);
}
/** Runs an order through the ledger; on success the residents in `who` are taken for this step. */
export function order(ctx: TitleContext, key: string, who: readonly Person[], run: () => boolean): boolean {
  if (!ctx.ledger.issue(ctx.town, key, run)) return false;
  for (const p of who) take(ctx, p);
  return true;
}

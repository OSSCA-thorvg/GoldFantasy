// What the title player may call on the town: the orders a player's clicks go through, and the readings the
// panels show. A refused order is not tried again for a while, so the player never hammers a refusal.
import type { Town } from '../../../../packages/engine/src/town';

/** Town methods that change the game; each is one a player's order goes through. */
export const titleOrders = [
  'place',
  'orderBuild',
  'buildRoad',
  'orderRoadwork',
  'plantField',
  'orderChop',
  'orderMine',
  'assignJob',
  'setWorkers',
  'orderCraft',
  'orderStationUpgrade',
  'orderPrayAtAltar',
  'offerAtAltar',
  'orderTrainAtGuild',
  'orderAttack',
  'orderAttackMove',
  'orderMove',
  'orderTend',
  'orderRelax',
  'sendExpedition',
  'leaveRealm',
  'useSkill',
] as const;
/** Town methods the title player reads; none changes the game. */
export const titleReadings = [
  'people',
  'person',
  'buildings',
  'building',
  'camp',
  'stock',
  'capacity',
  'population',
  'housing',
  'map',
  'roads',
  'clock',
  'climate',
  'raiding',
  'monsters',
  'wildlife',
  'fieldAcres',
  'fit',
  'canPlace',
  'canBuildRoad',
  'canPlantField',
  'roadAccess',
  'resourceNearby',
  'craftReason',
  'craftOptions',
  'craftingAt',
  'stationUpgradeReason',
  'prayerReason',
  'altarStatus',
  'altarOfferingReason',
  'trainingReason',
  'settlementOf',
  'expeditionProblem',
  'canSendExpedition',
  'deepestOpenFloor',
  'gateFloors',
  'canLeaveRealm',
  'realmActive',
  'realmPlan',
  'realmParty',
  'realmStanding',
  'realmFoes',
  'realmDens',
  'realmLeftBehind',
  'inRealm',
  'combatEvents',
  'skillsOf',
  'skillReach',
] as const;
export type TitleOrder = (typeof titleOrders)[number];

interface Refusal {
  until: number;
  revision: bigint;
}
/** Remembers refused orders by key; one refused is held back until the time has passed and the town has changed. */
export class OrderLedger {
  private refused = new Map<string, Refusal>();
  issued = 0;
  refusals = 0;
  constructor(private holdSeconds = 90) {}
  blocked(key: string, now: number, revision: bigint): boolean {
    const r = this.refused.get(key);
    if (!r) return false;
    if (now >= r.until && revision !== r.revision) {
      this.refused.delete(key);
      return false;
    }
    return true;
  }
  /** Runs the order unless `key` was refused lately; true when the town accepted it. */
  issue(town: Town, key: string, order: () => boolean): boolean {
    const now = town.clock(),
      revision = town.changes;
    if (this.blocked(key, now, revision)) return false;
    ++this.issued;
    if (order()) {
      this.refused.delete(key);
      return true;
    }
    ++this.refusals;
    this.refused.set(key, { until: now + this.holdSeconds, revision: town.changes });
    // Old refusals are forgotten so a long session stays small.
    if (this.refused.size > 400)
      for (const [k, r] of this.refused) if (now >= r.until) this.refused.delete(k);
    return false;
  }
}

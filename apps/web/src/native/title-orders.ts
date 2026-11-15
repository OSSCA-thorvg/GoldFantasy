// What the title player may call on the town: the orders a player's clicks go through, and the readings the
// panels show. A refused order is not tried again for a while, so the player never hammers a refusal.

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
  'dayFraction',
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

/** Remembers refused orders by key (the order and its arguments); a refused order is never given again. */
export class OrderLedger {
  private refused = new Set<string>();
  issued = 0;
  refusals = 0;
  blocked(key: string): boolean {
    return this.refused.has(key);
  }
  /** Runs the order unless `key` was refused before; true when the town accepted it. */
  issue(key: string, order: () => boolean): boolean {
    if (this.refused.has(key)) return false;
    ++this.issued;
    if (order()) return true;
    ++this.refusals;
    this.refused.add(key);
    return false;
  }
}

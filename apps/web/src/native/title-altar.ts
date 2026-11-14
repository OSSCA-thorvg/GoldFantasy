// New residents for the title settlement: a prayer for a settler while hands are short, an offering at Odin's
// altar for a fighter once the settlement can spare the gifts. Always within the altar's cap and the free beds.
import { Activity, Calling, type Person } from '../../../../packages/engine/src/person';
import { Resources, Structure } from '../../../../packages/engine/src/building-catalog';
import { isPlayerBuilding } from '../../../../packages/engine/src/faction';
import { altarCap } from '../../../../packages/engine/src/altar-cap';
import { OfferingGrade, offeringGradeOf, offeringProfile } from '../../../../packages/engine/src/prayer-offering';
import { isFighter } from './title-gear';
import { hunt } from './title-workforce';
import { living, order, type TitleContext } from './title-roster';

/** Settlers the title settlement prays for, then fighters it calls with offerings. */
export const settlersWanted = 4;
/** Fighters before a first floor is cleared; each cleared floor's larger cap calls more, up to six. */
export const fightersWanted = 4;
/** Food kept back from an offering: a few days of meals and one prayer. */
const foodReserve = (population: number) => population * 5 + 8;

/** Callings a party wants, in the order the title settlement calls them. */
const partyCallings = [Calling.Warrior, Calling.Cleric, Calling.Ranger, Calling.Mage, Calling.Warrior, Calling.Ranger];
/** The calling the party lacks most. */
export function wantedCalling(folk: readonly Person[]): Calling {
  const have = folk.filter(isFighter).map((p) => p.calling);
  for (const calling of partyCallings) {
    const at = have.indexOf(calling);
    if (at < 0) return calling;
    have.splice(at, 1);
  }
  return Calling.Warrior;
}
/** The gift from what the stores can spare that best calls `calling` at a useful level, or null. */
export function offeringFor(stock: Resources, population: number, calling: Calling): Resources | null {
  const spare = (have: number, keep: number) => Math.max(0, Math.floor(have - keep)),
    room = {
      food: spare(stock.food, foodReserve(population)),
      bones: spare(stock.bones, 0),
      stone: spare(stock.stone, 14),
      water: spare(stock.water, population * 4),
      gold: spare(stock.gold, 30),
    };
  let best: Resources | null = null,
    score = -1;
  for (const food of [8, 16, 24, 32, 40, 56])
    for (const bones of [0, 8, 16, 24, 32])
      for (const stone of [0, 12, 24])
        for (const water of [0, 12])
          for (const gold of [0, 12]) {
            if (food > room.food || bones > room.bones || stone > room.stone || water > room.water || gold > room.gold) continue;
            const gift = new Resources();
            Object.assign(gift, { food, bones, stone, water, gold });
            const profile = offeringProfile(gift);
            if (offeringGradeOf(gift).grade < OfferingGrade.Bountiful || profile.levelMin < 3) continue;
            const chance = profile.classes.find((c) => c.calling === calling)?.chance ?? 0,
              worth = chance + 0.08 * (profile.levelMin + profile.levelMax) - (food + bones + stone + water + gold) / 2000;
            if (worth > score) [best, score] = [gift, worth];
          }
  return best;
}
export function callResidents(ctx: TitleContext): string {
  const { town } = ctx,
    altar = town.buildings().find((b) => isPlayerBuilding(b) && b.kind === Structure.Shrine && b.built());
  if (!altar) return '';
  const population = town.population();
  if (population >= altarCap(town)) return 'at the cap';
  const reason = town.altarStatus(altar.id).reason;
  const folk = living(town),
    fighters = folk.filter(isFighter).length,
    settlers = folk.length - fighters;
  // Settlers from prayer until there are hands for the work, then fighters from offerings.
  if (settlers >= settlersWanted && fighters < Math.min(fightersWanted + 2, altarCap(town) - settlersWanted)) {
    // Only gifts Odin rarely turns away, rich enough to favour the calling the party lacks.
    const gift = offeringFor(town.stock(), population, wantedCalling(folk));
    if (gift && !town.altarOfferingReason(altar.id, gift)) {
      const accepted = order(ctx, `offer:${altar.id}`, [], () => {
        const result = town.offerAtAltar(altar.id, gift);
        // Odin turning the gifts away is his answer, not a refused order.
        return result.born !== null || result.refused;
      });
      if (accepted) return 'offering';
    }
    if (!gift) hunt(ctx);
    return 'gathering gifts';
  }
  if (reason) {
    if (/food/.test(reason)) hunt(ctx);
    return reason;
  }
  const worshipper = ctx.free
    .filter((p: Person) => p.task === Activity.Idle || p.task === Activity.Felling || p.task === Activity.Mining)
    .filter((p) => !ctx.party.has(p.id) && !town.prayerReason(p.id, altar.id))[0];
  if (worshipper && order(ctx, `pray:${worshipper.id}:${altar.id}`, [worshipper], () => town.orderPrayAtAltar([worshipper.id], altar.id)))
    return 'praying';
  return '';
}

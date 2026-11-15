// New residents for the title settlement: a prayer for a settler while hands are short, an offering at Odin's
// altar for a fighter once the settlement can spare the gifts. Always within the altar's cap and the free beds.
import { Activity, Calling, type Person } from '../../../../packages/engine/src/person';
import { Resources, Structure } from '../../../../packages/engine/src/building-catalog';
import { isPlayerBuilding } from '../../../../packages/engine/src/faction';
import { altarCap } from '../../../../packages/engine/src/altar-cap';
import { OfferingGrade, gradeOfScore, offeringProfile, offeringScore } from '../../../../packages/engine/src/prayer-offering';
import { isFighter } from './title-gear';
import { hunt } from './title-workforce';
import { available, living, order, type TitleContext } from './title-roster';

/** Settlers the title settlement prays for, then fighters it calls with offerings. */
export const settlersWanted = 3;
/** Fighters before a first floor is cleared; each cleared floor's larger cap calls more, up to six. */
export const fightersWanted = 4;
/** Food kept back from an offering: a few days of meals and one prayer. */
const foodReserve = (population: number) => population * 2 + 6;

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
export function offeringFor(stock: Resources, population: number, calling: Calling, urgent = false): Resources | null {
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
  for (const food of [0, 4, 8, 16, 24, 32, 40, 56])
    for (const bones of [0, 8, 16, 24, 32])
      for (const stone of [0, 12, 24])
        for (const water of [0, 12])
          for (const gold of [0, 12]) {
            if (food > room.food || bones > room.bones || stone > room.stone || water > room.water || gold > room.gold) continue;
            const gift = new Resources();
            Object.assign(gift, { food, bones, stone, water, gold });
            const profile = offeringProfile(gift);
            // Odin turns a worthy gift away now and then; a first fighter is worth that risk.
            if (gradeOfScore(offeringScore(profile)) < (urgent ? OfferingGrade.Worthy : OfferingGrade.Bountiful) || profile.levelMin < (urgent ? 2 : 3)) continue;
            const chance = profile.classes.find((c) => c.calling === calling)?.chance ?? 0,
              worth = chance + 0.08 * (profile.levelMin + profile.levelMax) - (food + bones + stone + water + gold) / 2000;
            if (worth > score) [best, score] = [gift, worth];
          }
  return best;
}
/** A settler swears a fighter's oath at the guild when the party is short and the oath can be paid. */
function swearFighter(ctx: TitleContext, wanted: Calling): boolean {
  const { town } = ctx,
    guild = town.buildings().find((b) => isPlayerBuilding(b) && b.kind === Structure.Guild && b.built());
  if (!guild || town.people().some((p) => p.task === Activity.Training && p.faction === 0)) return false;
  const folk = living(town);
  if (folk.length - folk.filter(isFighter).length <= 2) return false;
  const settler = ctx.free
    .filter((p) => !isFighter(p) && !ctx.party.has(p.id) && !town.trainingReason(p.id, guild.id, wanted))
    .sort((a, b) => b.level - a.level || a.id - b.id)[0];
  return !!settler && order(ctx, `oath:${settler.id}:${wanted}`, [settler], () => town.orderTrainAtGuild(settler.id, guild.id, wanted));
}
export function callResidents(ctx: TitleContext): string {
  const { town } = ctx,
    altar = town.buildings().find((b) => isPlayerBuilding(b) && b.kind === Structure.Shrine && b.built());
  if (!altar) return '';
  const population = town.population(),
    all = living(town),
    short = all.filter(isFighter).length < Math.min(fightersWanted + 2, altarCap(town) - settlersWanted);
  if (short && swearFighter(ctx, wantedCalling(all))) return 'swearing a fighter';
  if (population >= altarCap(town)) return 'at the cap';
  const reason = town.altarStatus(altar.id).reason,
    folk = all,
    fighters = folk.filter(isFighter).length,
    settlers = folk.length - fighters;
  // Settlers from prayer until there are hands for the work, then fighters from offerings.
  if (settlers >= settlersWanted && fighters < Math.min(fightersWanted + 2, altarCap(town) - settlersWanted)) {
    // Only gifts Odin rarely turns away, rich enough to favour the calling the party lacks.
    const gift = offeringFor(town.stock(), population, wantedCalling(folk), fighters < 2);
    if (gift && !town.altarOfferingReason(altar.id, gift)) {
      const accepted = order(ctx, `offer:${altar.id}:${town.clock() | 0}`, [], () => {
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
  // Prayer eases stress, so the tired may go too.
  const worshipper = living(town)
    .filter((p) => available(town, p) && p.stress < 0.8)
    .filter((p: Person) => [Activity.Idle, Activity.Felling, Activity.Mining, Activity.Working].includes(p.task))
    .filter((p) => !ctx.party.has(p.id) && !town.prayerReason(p.id, altar.id))[0];
  if (worshipper && order(ctx, `pray:${worshipper.id}:${altar.id}`, [worshipper], () => town.orderPrayAtAltar([worshipper.id], altar.id)))
    return 'praying';
  return '';
}

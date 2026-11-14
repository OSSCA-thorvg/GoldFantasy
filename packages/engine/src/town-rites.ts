import type { Town } from './town';
import { TownState } from './town-state';
import { Check } from './town-models';
import { Resources, Structure } from './building-catalog';
import { Activity, Role, type Person } from './person';
import { CombatCue, combatRules } from './combat-events';
import { dayCycle } from './day-cycle';
import { distance } from './geometry';
import { sealable } from './gate-seals';
import { economyRules } from './economy-rules';

export interface Rite {
  id: string;
  name: string;
  description: string;
  mana: number;
}
/** Rites a staffed mage tower can perform for mana. */
export function rites(this: TownState): Rite[] {
  return [
    {
      id: 'ward',
      name: 'Ward',
      description: 'Monster blows against residents near the settlement land softer until dawn.',
      mana: economyRules.wardMana,
    },
    {
      id: 'mending',
      name: 'Mending',
      description: 'Every standing resident regains health, and lasting wounds heal sooner.',
      mana: economyRules.mendingMana,
    },
    {
      id: 'farsight',
      name: 'Farsight',
      description: 'Reveals the nearest gate not yet found.',
      mana: economyRules.farsightMana,
    },
  ];
}
function residents(town: Town, village: number): Person[] {
  const faction = town.camp(village)?.faction ?? town.controlFaction;
  return town.folk.filter(
    (p) =>
      p.role === Role.Resident &&
      p.faction === faction &&
      p.health > 0 &&
      p.downedAt < 0 &&
      p.activity !== Activity.Downed &&
      // A rite reaches the settlement, not a party in another world.
      !town.inRealm(p.position) &&
      town.settlementOf(p) === village,
  );
}
const hurt = (p: Person): boolean => p.woundDays > 0 || p.health < 1;
function nearestHiddenGate(town: Town, village: number): number {
  const seat = town.camp(village);
  let best = -1,
    gap = Infinity;
  town.world.dungeons().forEach((site, index) => {
    if (!seat || site.discovered || !sealable(site)) return;
    const far = distance(seat.center, { x: site.origin.x + 1, y: site.origin.y + 1 });
    if (far < gap) {
      gap = far;
      best = index;
    }
  });
  return best;
}
export function canPerformRite(this: Town, id: string, village: number): Check {
  const rite = this.rites().find((r) => r.id === id);
  if (!rite) return new Check(false, 'Unknown rite');
  const cost = new Resources(),
    seat = this.camp(village);
  cost.mana = rite.mana;
  if (!seat) return new Check(false, 'No settlement', cost);
  const towers = this.placed.filter(
    (b) => b.kind === Structure.MageTower && b.built() && b.faction === seat.faction && this.settlementOf(b) === village,
  );
  if (!towers.length) return new Check(false, 'Build a mage tower', cost);
  if (!towers.some((b) => b.workers > 0)) return new Check(false, 'The mage tower needs a mage', cost);
  if (this.economy(village).riteDays.get(id) === this.days) return new Check(false, 'Already performed today', cost);
  const mana = this.stock(village).mana;
  if (mana < rite.mana) return new Check(false, `Needs ${rite.mana} mana (${mana} stored)`, cost);
  if (id === 'ward' && this.time < this.wardUntil) return new Check(false, 'The ward already holds', cost);
  if (id === 'mending' && !residents(this, village).some(hurt)) return new Check(false, 'No one needs mending', cost);
  if (id === 'farsight' && nearestHiddenGate(this, village) < 0) return new Check(false, 'Every gate is already found', cost);
  return new Check(true, '', cost);
}
export function performRite(this: Town, id: string, village: number): boolean {
  const check = this.canPerformRite(id, village);
  if (!check.ok) return false;
  this.economy(village).stock.mana -= check.cost.mana;
  this.economy(village).riteDays.set(id, this.days);
  if (id === 'ward') {
    const day = TownState.secondsPerDay,
      start = Math.floor(this.time / day) * day,
      sunrise = dayCycle(this.yearFraction(), this.dayFraction()).sunrise * day;
    this.wardUntil = start + sunrise > this.time ? start + sunrise : start + day + sunrise;
    this.notify('The mage tower raises a ward over the settlement until dawn');
  } else if (id === 'mending') {
    let mended = 0;
    for (const p of residents(this, village)) {
      if (!hurt(p)) continue;
      const before = p.health;
      if (p.woundDays > 0) --p.woundDays;
      p.health = Math.min(p.woundDays > 0 ? combatRules.woundedHealth : 1, p.health + economyRules.mendingHealth);
      p.health = Math.max(before, p.health);
      ++mended;
      if (p.health > before)
        this.emit(CombatCue.Heal, p.position, { person: p.id, amount: Math.round((p.health - before) * 100) });
    }
    this.notify(`The mage tower's mending eases ${mended} ${mended === 1 ? 'resident' : 'residents'}`);
  } else {
    const site = this.world.dungeons()[nearestHiddenGate(this, village)];
    this.notify('Farsight shows a gate beyond the fog');
    this.reveal(site.origin.x + 1, site.origin.y + 1, economyRules.farsightRadius);
  }
  ++this.changes;
  return true;
}

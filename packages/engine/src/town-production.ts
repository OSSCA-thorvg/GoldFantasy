import type { Town } from './town';
import type { Building } from './town-models';
import { Activity, TreeWorkKind, type Person } from './person';
import { Product, Structure } from './building-catalog';
import { resourceAmount, resourceBundle } from './construction-materials';
import { distance } from './geometry';

export function processingRecipe(kind: Structure) {
  if (kind === Structure.Sawmill) return { input: Product.Wood, output: Product.Planks, seconds: 24 };
  if (kind === Structure.Stoneworks) return { input: Product.Stone, output: Product.CutStone, seconds: 30 };
  return null;
}

/** Production counts time physically spent at a workshop, never an unattended daily grant. */
export function processProduction(this: Town, place: Building, dt: number): void {
  const recipe = processingRecipe(place.kind);
  if (!recipe || !place.built() || dt <= 0 || !Number.isFinite(dt)) return;
  const village = this.settlementOf(place),
    stock = this.stock(village),
    room = this.capacity(village);
  const possible = () =>
    resourceAmount(stock, recipe.input) >= 2 &&
    resourceAmount(stock, recipe.output) < resourceAmount(room, recipe.output);
  if (!possible()) {
    // Waiting for deliveries cannot bank hours of free future production.
    place.productionProgress = 0;
    return;
  }
  place.productionProgress += dt;
  while (place.productionProgress + 1e-6 >= recipe.seconds && possible()) {
    stock.subtract(resourceBundle(recipe.input, 2));
    this.store(resourceBundle(recipe.output, 1), village);
    if (this.timberEvents.length < 512)
      this.timberEvents.push({
        serial: this.nextTreeEvent++,
        kind: TreeWorkKind.Produced,
        person: -1,
        cell: Math.floor(place.center.y) * this.world.width() + Math.floor(place.center.x),
        index: recipe.output,
        worker: { ...place.center },
        at: this.time,
      });
    place.productionProgress = Math.max(0, place.productionProgress - recipe.seconds);
  }
  if (!possible()) place.productionProgress = 0;
}

/** A builder may perform the missing intermediate production without losing its site. */
export function produceConstructionMaterial(this: Town, p: Person, product: Product): boolean {
  const kind =
    product === Product.Planks
      ? Structure.Sawmill
      : product === Product.CutStone
        ? Structure.Stoneworks
        : null;
  if (kind === null) return false;
  const village = this.settlementOf(p);
  const workshops = this.placed
    .filter((b) => b.built() && b.kind === kind && this.settlementOf(b) === village)
    .sort((a, b) => distance(p.position, a.door()) - distance(p.position, b.door()));
  for (const workshop of workshops) {
    const recipe = processingRecipe(workshop.kind)!;
    if (resourceAmount(this.stock(village), recipe.input) < 2) {
      if (this.startHarvest(p, workshop.center, 12, recipe.input)) return true;
      continue;
    }
    if (!this.walkTo(p, workshop.door())) continue;
    p.activity = Activity.Working;
    p.target = workshop.id;
    p.until = this.time;
    if (!p.moving()) this.arrive(p);
    return true;
  }
  return false;
}

export function acceptsCargo(kind: Structure, product: Product): boolean {
  if (kind === Structure.WoodStore) return product === Product.Wood || product === Product.Planks;
  if (kind === Structure.StoneStore) return product === Product.Stone || product === Product.CutStone;
  if (kind === Structure.Granary) return product === Product.Food;
  return false;
}

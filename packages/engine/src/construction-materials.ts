// Literal translation of construction_materials.h from the 2026-11-09 tellin snapshot.
import { Product, Resources } from './building-catalog';
import { clamp, f32 } from './numeric';
export const constructionProducts = [
  Product.Wood,
  Product.Stone,
  Product.Food,
  Product.Water,
  Product.Mana,
  Product.Planks,
  Product.CutStone,
] as const;
export function resourceAmount(resources: Resources, product: Product): number {
  switch (product) {
    case Product.Wood:
      return resources.wood;
    case Product.Stone:
      return resources.stone;
    case Product.Food:
      return resources.food;
    case Product.Water:
      return resources.water;
    case Product.Mana:
      return resources.mana;
    case Product.Planks:
      return resources.planks;
    case Product.CutStone:
      return resources.cutStone;
    case Product.Goods:
      return resources.gold;
    case Product.None:
      return 0;
  }
  return 0;
}
export function resourceBundle(product: Product, amount: number): Resources {
  const result = new Resources();
  switch (product) {
    case Product.Wood:
      result.wood = amount;
      break;
    case Product.Stone:
      result.stone = amount;
      break;
    case Product.Food:
      result.food = amount;
      break;
    case Product.Water:
      result.water = amount;
      break;
    case Product.Mana:
      result.mana = amount;
      break;
    case Product.Planks:
      result.planks = amount;
      break;
    case Product.CutStone:
      result.cutStone = amount;
      break;
    case Product.Goods:
      result.gold = amount;
      break;
    case Product.None:
      break;
  }
  return result;
}
export class ConstructionMaterials {
  constructor(
    public required = new Resources(),
    public delivered = new Resources(),
  ) {}
  missing(product: Product): number {
    return Math.max(0, resourceAmount(this.required, product) - resourceAmount(this.delivered, product));
  }
  surplus(product: Product): number {
    return Math.max(0, resourceAmount(this.delivered, product) - resourceAmount(this.required, product));
  }
  limit(): number {
    let result = 1;
    for (const product of constructionProducts) {
      const need = resourceAmount(this.required, product);
      if (need > 0) result = Math.min(result, f32(f32(resourceAmount(this.delivered, product)) / f32(need)));
    }
    return clamp(result, 0, 1);
  }
}

import { Resources } from './building-catalog';
import { point, type Point } from './geometry';

/** Persistent decisions and travelling supplies belonging to one independent village. */
export class NeutralSettlement {
  camp = -1;
  stock = new Resources();
  planAt = 0;
  builder = -1;
  foodUntil = -1;
  dice = 1;
  constructor(
    public faction = 1,
    public founder = -1,
    public destination: Point = point(),
  ) {}
}

import { Footprint, Point, Outline, point, add, rotated, area } from './geometry';
import { Faith, Resources, Stage, Structure, structureSpec } from './building-catalog';
import { f32 as f, lround } from './numeric';
import { buildingEntranceModel } from './building-appearance';
import { ConstructionMaterials } from './construction-materials';
export class Building {
  faction = 0;
  devotionDueDay = -1;
  trainingCount = 0;
  materials = new ConstructionMaterials();
  repairPending = false; repairCredit = 0; productionProgress = 0; workers = 0; wanted = -1; growth = 0; version = 0; replaced: Stage[] = []; progress = 1; workedSeconds = 0; attendance = 1; earned = 0; registered = 0; faith = Faith.Dawn; owner = -1; health = 1; village = -1;
  constructor(public id: number, public kind: Structure, public center: Point, public angle: number, public variant: number) {}
  built(): boolean { return this.progress >= 1; }
  footprint(): Footprint { return new Footprint(this.center, f(structureSpec(this.kind).size / 2), this.angle); }
  corner(): Point { const half = f(structureSpec(this.kind).size / 2); return point(f(this.center.x - half), f(this.center.y - half)); }
  private entrance(): Point {
    const half = f(structureSpec(this.kind).size / 2), model = buildingEntranceModel(this.kind, this.variant);
    let door = point(), found = false;
    for (const block of model.blocks) { if (!block.door || Math.abs(f(block.base)) > f(1e-4)) continue; const {x0, x1, y1} = block; const candidate = point(f(f(x0 + f(f(x1 - x0) * f(.28))) - half), f(y1 - half)); if (!found || candidate.y > door.y) { door = candidate; found = true; } }
    return found ? door : point(0, half);
  }
  door(): Point { const local = this.entrance(); local.y = f(Math.max(local.y, f(structureSpec(this.kind).size / 2)) + f(.25)); const walls = this.footprint(); let p = add(this.center, rotated(local, this.angle)); for (let step = 0; step < 20; ++step) { const cell = point(f(Math.floor(p.x) + f(.5)), f(Math.floor(p.y) + f(.5))); if (!walls.contains(cell, f(.05))) break; local.y = f(local.y + f(.05)); p = add(this.center, rotated(local, this.angle)); } return p; }
  threshold(): Point { return add(this.center, rotated(this.entrance(), this.angle)); }
}
export class Field { faction = 0; constructor(public id: number, public outline: Outline, public village = -1) {} acres(): number { return lround(area(this.outline)); } }
export class Placement { constructor(public center: Point = point(), public angle = 0, public snapped = false) {} }
export class Check { constructor(public ok = false, public reason = '', public cost = new Resources()) {} }
export enum Season { Spring, Summer, Autumn, Winter }
export const seasonName = (season: Season): string => ['Spring', 'Summer', 'Autumn', 'Winter'][season] ?? '';
export class Calendar { constructor(public day = 1, public month = 1, public year = 1, public season = Season.Spring) {} }
export class GrowthStatus { grows = false; ready = false; days = 0; needed = 0; next = ''; reason = ''; }
export class Forecast { wages = 0; rent = 0; guests = 0; bounty = 0; made = new Resources(); used = new Resources(); net(): number { return this.rent + this.guests + this.bounty + this.made.gold - this.wages; } }

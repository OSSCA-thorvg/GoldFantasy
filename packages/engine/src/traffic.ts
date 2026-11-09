import { Point, point, distance, lerp } from './geometry';
import { RoadGraph } from './road-graph';
import { RoadSegment } from './road-network';
import { Building } from './town-models';
import type { Town } from './town';
import { structureSpec, isMarket, isSeat } from './building-catalog';
import { f32 as f } from './numeric';
export enum AgentKind { Merchant, Monster }
export class Agent {
  travelled = 0; speed = 1;
  constructor(public id: number, public kind: AgentKind, public look = 0, public path: Point[] = []) {}
  length(): number { let total = 0; for (let i = 1; i < this.path.length; ++i) total = f(total + distance(this.path[i - 1], this.path[i])); return total; }
  arrived(): boolean { return this.travelled >= this.length(); }
  position(): Point { let left = this.travelled; for (let i = 1; i < this.path.length; ++i) { const leg = distance(this.path[i - 1], this.path[i]); if (left <= leg && leg > 0) { const t = f(left / leg); return point(f(this.path[i - 1].x + f(f(this.path[i].x - this.path[i - 1].x) * t)), f(this.path[i - 1].y + f(f(this.path[i].y - this.path[i - 1].y) * t))); } left = f(left - leg); } return this.path.length ? { ...this.path[this.path.length - 1] } : point(); }
  heading(): Point { let left = this.travelled; for (let i = 1; i < this.path.length; ++i) { const leg = distance(this.path[i - 1], this.path[i]); if ((left <= leg || i + 1 === this.path.length) && leg > 0) return point(f(f(this.path[i].x - this.path[i - 1].x) / leg), f(f(this.path[i].y - this.path[i - 1].y) / leg)); left = f(left - leg); } return point(1, 0); }
}
export class Traffic {
  roads = new RoadGraph(); builtSegments: RoadSegment[] = []; revision = 0n; list: Agent[] = []; merchantTimer = 6; nextId = 0; state: number;
  constructor(seed: number) { this.state = (Math.imul(seed, 2654435761) + 1) >>> 0; }
  agents(): readonly Agent[] { return this.list; } graph(): RoadGraph { return this.roads; }
  random(): number { this.state ^= this.state << 13; this.state ^= this.state >>> 17; this.state ^= this.state << 5; this.state >>>= 0; return f((this.state >>> 8) / 16777216); }
  pick<T>(items: T[]): T | null { return items.length ? items[Math.min(items.length - 1, Math.trunc(f(this.random() * items.length)))] : null; }
  door(town: Town, item: Building): Point { const half = f(structureSpec(item.kind).size / 2); if (town.roads().empty()) return item.center; const found = town.roads().distance(item.center); return lerp(item.center, found.onRoad!, Math.min(1, f(f(half + f(.1)) / Math.max(found.distance, f(1e-3))))); }
  travel(from: Point, to: Point, speed: number): boolean { const path = this.roads.route(from, to); if (path.length < 2 || distance(from, to) < f(.5)) return false; const agent = new Agent(this.nextId++, AgentKind.Merchant, Math.trunc(f(this.random() * f(1e6))) >>> 0, path); agent.speed = f(speed * f(f(.85) + f(this.random() * f(.3)))); this.list.push(agent); return true; }
  update(town: Town, elapsed: number): void { if (town.roadRevision() !== this.revision) { this.revision = town.roadRevision(); const segments = town.roads().builtSegments(); if (segments.length !== this.builtSegments.length || segments.some((s, i) => s.road !== this.builtSegments[i].road || s.a.x !== this.builtSegments[i].a.x || s.a.y !== this.builtSegments[i].a.y || s.b.x !== this.builtSegments[i].b.x || s.b.y !== this.builtSegments[i].b.y)) { this.roads = RoadGraph.build(segments); this.builtSegments = segments; } } for (const agent of this.list) agent.travelled = f(agent.travelled + f(agent.speed * f(elapsed))); this.list = this.list.filter(a => !a.arrived()); if (this.roads.empty()) return; if (this.list.length >= 2 + Math.trunc(town.population() / 3)) return; this.merchantTimer -= elapsed; if (this.merchantTimer <= 0) { this.merchantTimer = f(8 + f(this.random() * 6)); this.spawnMerchant(town); } }
  spawnMerchant(town: Town): void { const markets: Building[] = []; let camp: Building | null = null; for (const item of town.buildings()) { if (isMarket(item.kind) && item.built()) markets.push(item); if (isSeat(item.kind)) camp = item; } const market = this.pick(markets); if (!market || !camp) return; const origin = this.door(town, camp); let gate = origin; for (let n = 0; n < this.roads.nodes().length; ++n) if (this.roads.degree(n) === 1 && distance(this.roads.nodes()[n], origin) > distance(gate, origin)) gate = this.roads.nodes()[n]; const arriving = this.random() < f(.6), stall = this.door(town, market); this.travel(arriving ? gate : stall, arriving ? stall : gate, f(.7)); }
}

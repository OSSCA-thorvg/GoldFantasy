// Original demo.cpp settlement setup, including failed placements and their diagnostics.
import type { GameRuntime } from './game-runtime';
import { Town } from '../../../../packages/engine/src/town';
import { Resources, Structure, structureSpec } from '../../../../packages/engine/src/building-catalog';
import { Role, Calling } from '../../../../packages/engine/src/person';
import {
  point,
  add,
  sub,
  scale,
  normalized,
  rotated,
  type Point,
  type Outline,
} from '../../../../packages/engine/src/geometry';
import { sharpAnchor, type RoadPath, type RoadAnchor } from '../../../../packages/engine/src/road-network';
import { f32 as f } from '../../../../packages/engine/src/numeric';
export function buildDemo(
  game: Pick<GameRuntime, 'state' | 'selectPeople'>,
  days: number,
  diagnostic: (text: string) => void = console.warn,
): void {
  const town = game.state(),
    c = town.map().camp(),
    at = (x: number, y: number) => point(f(c.x + f(x)), f(c.y + f(y))),
    sharp = (x: number, y: number) => sharpAnchor(at(x, y));
  const smooth = (x: number, y: number, hx: number, hy: number): RoadAnchor => {
    const p = at(x, y);
    return {
      point: p,
      in: point(f(p.x - f(hx)), f(p.y - f(hy))),
      out: point(f(p.x + f(hx)), f(p.y + f(hy))),
    };
  };
  const road = (path: RoadPath) => {
    const check = town.canBuildRoad(path);
    if (!town.buildRoad(path)) diagnostic('demo: road: ' + check.reason);
  };
  const place = (kind: Structure, cursor: Point) => {
    const spot = town.fit(kind, cursor, 0),
      check = town.canPlace(kind, spot.center, spot.angle);
    if (!town.place(kind, spot.center, spot.angle))
      diagnostic('demo: ' + structureSpec(kind).name + ': ' + check.reason);
  };
  const field = (outline: Outline) => {
    const check = town.canPlantField(outline);
    if (!town.plantField(outline)) diagnostic('demo: field: ' + check.reason);
  };
  town.scout(c.x, c.y, 11);
  if (town.map().dungeons().length) {
    const d = town.map().dungeons()[0];
    town.scout(f(d.origin.x + 1), f(d.origin.y + 1), 5);
  }
  place(Structure.Camp, c);
  town.completeConstruction();
  road([sharp(1, 0), smooth(5, 0.2, 1.6, 0), sharp(9, -0.6)]);
  road([sharp(1, 0), sharp(1, -3)]);
  road([sharp(1, -3), smooth(5, -3.1, 1.6, 0), sharp(8.5, -2.2)]);
  road([
    { point: at(4.6, 0.2), in: at(4.6, 0.2), out: at(4.6, 2.4) },
    { point: at(4.2, 4.6), in: at(5.4, 3.2), out: at(3, 6) },
    sharp(3.6, 8.6),
  ]);
  for (const row of [-1, -2])
    for (let i = 0; i < 4; ++i) place(Structure.Tent, at(f(f(2.2) + f(i * f(1.15))), row));
  place(Structure.Farm, at(6.6, 1.2));
  field([at(6.2, 1.9), at(9.8, 1.2), at(10.6, 4.4), at(6.9, 4.6)]);
  place(Structure.Farm, at(4.6, 7.2));
  field([at(5.4, 5.6), at(8.6, 5.9), at(8.2, 8.6), at(5.6, 8.4)]);
  town.completeConstruction();
  town.advance(Town.secondsPerDay * 2);
  town.reward(new Resources(100, 140, 60, 0, 0));
  town.recruit(Role.Resident, Calling.Settler, 6);
  town.recruit(Role.Resident, Calling.Warrior, 2);
  place(Structure.MarketStalls, at(2.6, 1.6));
  place(Structure.Shrine, at(7, -1));
  place(Structure.Tavern, at(8.2, 0.5));
  place(Structure.Hostel, at(10, -2.4));
  place(Structure.Chapel, at(6.4, -4.2));
  const settle = (kind: Structure, around: Point) => {
    for (let ring = 0; ring < 40; ++ring) {
      const spot = town.fit(kind, add(around, rotated(point(f(ring * f(0.35)), 0), f(ring * f(2.4)))), 0);
      if (town.place(kind, spot.center, spot.angle)) return;
    }
    diagnostic('demo: no room for a ' + structureSpec(kind).name);
  };
  settle(Structure.Well, at(3, 1));
  settle(Structure.Storehouse, at(7, 1.5));
  place(Structure.Weaponsmith, at(3.4, -4.1));
  place(Structure.Apothecary, at(4.6, -4.1));
  if (town.map().dungeons().length) {
    const origin = town.map().dungeons()[0].origin,
      lair = point(f(origin.x + 1), f(origin.y + 1)),
      toward = normalized(sub(lair, c)),
      from = add(c, scale(toward, f(1.2))),
      to = sub(lair, scale(toward, f(4.5))),
      bend = add(add(c, scale(sub(lair, c), f(0.5))), scale(point(-toward.y, toward.x), f(1.5)));
    road([
      sharpAnchor(from),
      { point: bend, in: sub(bend, scale(toward, f(1.5))), out: add(bend, scale(toward, f(1.5))) },
      sharpAnchor(to),
    ]);
    const spot = town.fit(
        Structure.Guild,
        add(sub(to, scale(toward, f(1.4))), scale(point(-toward.y, toward.x), f(1.4))),
        0,
      ),
      check = town.canPlace(Structure.Guild, spot.center, spot.angle);
    if (!town.place(Structure.Guild, spot.center, spot.angle)) diagnostic('demo: guild: ' + check.reason);
  }
  let built = false;
  for (let turn = 0; turn < 36 && !built; ++turn)
    for (let reach = 4; reach < 20 && !built; reach += 1) {
      const toward = rotated(point(1, 0), f(turn * f(0.1745))),
        path = [sharpAnchor(add(c, scale(toward, f(1.3)))), sharpAnchor(add(c, scale(toward, reach)))],
        check = town.canBuildRoad(path);
      if (check.ok && check.cost.wood > 0 && (built = town.buildRoad(path))) diagnostic('demo: bridge');
    }
  town.completeConstruction();
  town.advance(Town.secondsPerDay * days);
  let shown = -1;
  for (const person of town.people())
    if (!person.inside && (shown < 0 || person.role === Role.Guest)) shown = person.id;
  if (shown >= 0) game.selectPeople([shown]);
}

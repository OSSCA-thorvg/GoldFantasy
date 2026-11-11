import { point, project, add, mul, rotated } from '../../engine/src/geometry';
import { f32, hash01 } from '../../engine/src/numeric';
import { Town } from '../../engine/src/town';
import { Traffic } from '../../engine/src/traffic';
import {
  Structure,
  structureSpec,
  isHome,
  isMarket,
  isLodging,
  isOutfitter,
  isSeat,
} from '../../engine/src/building-catalog';
import { Terrain, Layer, DungeonKind, isWater, type Dungeon } from '../../engine/src/world-types';
import type { Building } from '../../engine/src/town-models';
import type { Climate } from '../../engine/src/climate';
import { SceneNode, ShapeNode, AnimationNode, type Rgb } from './paint';
import { ellipse, glow, opaque, detach } from './vector-paint';
import { buildingAppearanceRevision, riseAnimation } from './building-assets';
import { WorldRendererState, pool, type Pool, type Landmark, type Visual } from './world-renderer-state';
import { rowOf, drawRow, giantFootprint, volcanoFootprint, registerDepth } from './world-depth';
import { lightYmir, paintYmir } from './ymir-statue';
import { lightVolcano, paintVolcano, paintSteam } from './volcano-painter';
import { Flicker } from './light-flicker';
import { dungeonSprite, dungeonBody } from './world-sprites';
import { registerPick } from './world-pick-registry';
import { paintOrnaments } from './world-ground';
import { sprout, buildTreeRow } from './world-trees';
import { Rect } from '../../native-ui/src/types';
import { damagePaint } from './building-damage';
const arcaneWisp: Rgb = [130, 240, 220],
  violetWisp: Rgb = [200, 150, 255],
  warmLight: Rgb = [232, 150, 64];
function renew(landmark: Landmark, key: bigint): boolean {
  if (landmark.paint && landmark.key === key) return false;
  landmark.paint = new SceneNode();
  landmark.key = key;
  return true;
}
export function addPool(s: WorldRendererState, p: Pool): void {
  if (p.glow) p.glowAt = p.glow.matrix;
  s.pools.push(p);
}
export function syncVisuals(s: WorldRendererState, town: Town, seconds: number): void {
  for (const [id, item] of s.visuals) {
    const b = town.building(id);
    if (
      b &&
      b.version === item.version &&
      b.center.x === item.center.x &&
      b.center.y === item.center.y &&
      b.angle === item.angle
    )
      continue;
    detach(s.objects, item.picture);
    s.visuals.delete(id);
  }
  for (const b of town.buildings()) {
    const appearances = [
        buildingAppearanceRevision(b.kind),
        ...b.replaced.map((stage) => buildingAppearanceRevision(stage.kind)),
      ],
      old = s.visuals.get(b.id);
    if (
      old &&
      appearances.length === old.appearances.length &&
      appearances.every((r, i) => r === old.appearances[i])
    )
      continue;
    const complete = !!old && old.frame >= old.layout.frames,
      fraction = old && old.layout.frames > 0 ? f32(old.frame / old.layout.frames) : 0,
      layout = riseAnimation(b.kind, b.variant, b.replaced, b.angle),
      picture = new AnimationNode(layout.json);
    // Validate the replacement before releasing an accepted native animation.
    s.adapter.sync(picture);
    if (old) detach(s.objects, old.picture);
    const frame =
        s.sceneView && b.built()
          ? layout.frames
          : !b.built()
            ? f32(f32(b.progress * layout.frames) * f32(0.92))
            : complete
              ? layout.frames
              : f32(fraction * layout.frames),
      item: Visual = {
        picture,
        layout: { ...layout, json: '' },
        version: b.version,
        center: { ...b.center },
        angle: b.angle,
        appearances,
        start: seconds,
        frame,
      };
    picture.frame(Math.min(frame, f32(layout.frames - 1)));
    const corner = b.corner(),
      anchor = project(corner.x, corner.y);
    picture.translate(f32(anchor.x - layout.originX), f32(anchor.y - layout.originY));
    s.visuals.set(b.id, item);
  }
}
export function buildObjects(s: WorldRendererState, town: Town, climate: Readonly<Climate>): void {
  s.lights.remove();
  s.effects.remove();
  s.pools = [];
  s.pulses = [];
  s.ymirGlints = [null, null];
  s.ymirRow = -1;
  s.fireRow = -1;
  s.wisps = [];
  s.wispPaints = [];
  s.flame = s.flameCore = null;
  const map = town.map(),
    count = f32(f32(map.width() + map.height()) - 1);
  if (!s.rows.length) {
    for (let row = 0; row < count; row++)
      for (const list of [s.rowBuildings, s.rowLamps, s.rowTrees, s.rows]) {
        const scene = new SceneNode();
        list.push(scene);
      }
    s.treeKeys = Array(count).fill(-1n);
    s.rowCanopies = Array.from({ length: count }, () => []);
    s.treeBounds = Array.from({ length: count }, () => new Rect());
  }
  for (const scene of s.rowBuildings) scene.remove();
  const buildingRows: Building[][] = Array.from({ length: count }, () => []),
    dungeonRows: Dungeon[][] = Array.from({ length: count }, () => []);
  for (const b of town.buildings()) buildingRows[drawRow(map, b.footprint(), count)].push(b);
  for (const site of map.dungeons())
    if (site.discovered)
      dungeonRows[Math.min(f32(count - 1), f32(f32(site.origin.x + site.origin.y) + 2))].push(site);
  const giant = map.giant(),
    giantRow = giant ? rowOf(giantFootprint(giant), count) : -1,
    volcano = map.volcano(),
    volcanoRow = volcano && map.revealed(volcano.center()) ? rowOf(volcanoFootprint(volcano), count) : -1,
    spring = map.hvergelmir(),
    springRow =
      map.revealed(spring) && isWater(map.terrainAt(spring))
        ? Math.min(f32(count - 1), f32(Math.trunc(spring.x) + Math.trunc(spring.y)))
        : -1;
  const snowy = climate.snow > f32(0.3),
    look =
      (BigInt(Math.trunc(f32(climate.autumn * 8))) << 1n) |
      (BigInt(Math.trunc(f32(climate.snow * 8))) << 5n) |
      BigInt(snowy),
    ornamentKey = look | (BigInt(springRow >= 0) << 40n);
  if (ornamentKey !== s.ornamentLook) {
    s.ornamentLook = ornamentKey;
    paintOrnaments(s, map, climate);
  }
  for (let row = 0; row < count; row++) {
    const here = s.rowBuildings[row];
    if (row === giantRow) {
      const heart = giant!.center(),
        inWater = isWater(map.terrainAt(point(f32(heart.x + f32(4.6)), f32(heart.y + f32(4.6))))),
        key =
          BigInt(snowy) |
          (BigInt(inWater) << 1n) |
          (BigInt(giant!.origin.x >>> 0) << 8n) |
          (BigInt(giant!.origin.y >>> 0) << 32n);
      if (renew(s.ymirPaint, key))
        s.ymirLight = paintYmir(s.ymirPaint.paint!, project(heart.x, heart.y), climate, inWater);
      registerDepth(s.ymirPaint.paint!, giantFootprint(giant!), 'landmark:ymir');
      registerPick(s.ymirPaint.paint!, {
        ref: { kind: 'landmark', id: 0 },
        body: [s.ymirPaint.paint!],
        foot: heart,
        groundOutline: giantFootprint(giant!).corners(),
      });
      here.add(s.ymirPaint.paint!);
      lightYmir(s.lights, project(heart.x, heart.y));
      addPool(s, pool(s.ymirLight!.dais, 190, 95));
      for (const eye of s.ymirLight!.eyes) addPool(s, pool(eye, 9, 6));
      s.ymirGlints = [s.ymirLight!.glints[0], s.ymirLight!.glints[1]];
      s.ymirRow = row;
    }
    if (row === volcanoRow) {
      const heart = volcano!.center(),
        key =
          BigInt(map.seed()) |
          (BigInt(volcano!.origin.x >>> 0) << 32n) |
          (BigInt(volcano!.origin.y >>> 0) << 48n);
      if (renew(s.volcanoPaint, key))
        s.volcanoLight = paintVolcano(s.volcanoPaint.paint!, project(heart.x, heart.y), map.seed());
      registerDepth(s.volcanoPaint.paint!, volcanoFootprint(volcano!), 'landmark:volcano');
      registerPick(s.volcanoPaint.paint!, {
        ref: { kind: 'landmark', id: 1 },
        body: [s.volcanoPaint.paint!],
        foot: heart,
        groundOutline: volcanoFootprint(volcano!).corners(),
      });
      here.add(s.volcanoPaint.paint!);
      lightVolcano(s.lights, s.volcanoLight!);
      addPool(s, pool(s.volcanoLight!.crater, 260, 130, [200, 80, 30], Flicker.Fire));
      for (const flow of s.volcanoLight!.flows) addPool(s, pool(flow, 70, 35, [170, 64, 26], Flicker.Hearth));
      s.fireRow = row;
    }
    if (row === springRow) {
      const deep = add(project(spring.x, spring.y), point(0, 30));
      s.lights.add(glow(deep, 170, 70, [90, 190, 230], 46));
      addPool(s, pool(deep, 180, 80));
    }
    for (const b of buildingRows[row]) {
      const here = new SceneNode(),
        visual = s.visuals.get(b.id)!;
      const body = visual.picture;
      s.rowBuildings[row].add(here);
      registerDepth(
        here,
        b.footprint(),
        `building:${b.id}`,
        new Rect(
          visual.picture.matrix[2],
          visual.picture.matrix[5],
          visual.layout.width,
          visual.layout.height,
        ),
      );
      here.add(body);
      here.add(damagePaint(s, b));
      registerPick(here, {
        ref: { kind: 'building', id: b.id },
        body: [body],
        foot: { ...b.center },
        groundOutline: b.footprint().corners(),
      });
      const size = structureSpec(b.kind).size,
        middle = b.center;
      if (b.kind === Structure.Torch && b.built()) {
        const p = project(middle.x, middle.y);
        p.y = f32(p.y - 20);
        const halo = glow(p, 35, 20, [242, 153, 52], 70),
          flame = ellipse(p, f32(0.65), f32(1.8), [250, 181, 67, 255]);
        s.lights.add(halo);
        here.add(flame);
        addPool(s, pool(project(middle.x, middle.y), 44, 25, [160, 94, 32], Flicker.Flame, halo, flame, p));
      }
      if (b.kind === Structure.Camp && b.built()) {
        const ox = b.corner().x,
          oy = b.corner().y;
        s.firePosition = project(f32(ox + f32(0.62)), f32(oy + f32(0.86)));
        const fireGlow = glow(s.firePosition, 80, 40, [236, 140, 56], 50);
        s.lights.add(fireGlow);
        addPool(s, pool(s.firePosition, 120, 60, [160, 96, 40], Flicker.Fire, fireGlow));
        for (let i = 0; i < 6; i++) {
          const angle = f32(i * f32(1.047));
          here.add(
            ellipse(
              point(
                f32(s.firePosition.x + f32(f32(Math.cos(angle)) * 6)),
                f32(s.firePosition.y + f32(f32(Math.sin(angle)) * 3)),
              ),
              2,
              f32(1.4),
              [70, 66, 70, 255],
            ),
          );
        }
        s.flame = new ShapeNode();
        s.flameCore = new ShapeNode();
        here.add(s.flame).add(s.flameCore);
        s.lastFlicker = -1;
      } else if (!b.built()) continue;
      else if ([Structure.MageTower, Structure.Portal].includes(b.kind)) {
        const tower = b.kind !== Structure.Shrine,
          aura = glow(project(middle.x, middle.y), 40, 20, tower ? violetWisp : arcaneWisp, 60);
        s.lights.add(aura);
        addPool(s, pool(project(middle.x, middle.y), 70, 35, [0, 0, 0], Flicker.Magic, aura));
        for (let i = 0; i < 3; i++)
          s.wisps.push({
            center: project(middle.x, middle.y),
            color: tower ? violetWisp : arcaneWisp,
            radius: f32(18 + f32(i * 6)),
          });
      } else if (
        isHome(b.kind) ||
        isMarket(b.kind) ||
        b.kind === Structure.Tavern ||
        isLodging(b.kind) ||
        [Structure.Guild, Structure.GuildHall, Structure.Chapel].includes(b.kind) ||
        isOutfitter(b.kind) ||
        isSeat(b.kind)
      ) {
        const spill = add(middle, mul(rotated(point(0, 1), b.angle), f32(f32(size / 2) + f32(0.1)))),
          windowGlow = glow(project(spill.x, spill.y), f32(28 * size), f32(14 * size), warmLight, 30);
        s.lights.add(windowGlow);
        addPool(
          s,
          pool(
            project(spill.x, spill.y),
            f32(42 * size),
            f32(22 * size),
            [100, 70, 40],
            Flicker.Hearth,
            windowGlow,
          ),
        );
      }
    }
    for (const site of dungeonRows[row]) {
      const here = new SceneNode();
      s.rowBuildings[row].add(here);
      registerDepth(
        here,
        point(site.origin.x + 1, site.origin.y + 1),
        `dungeon:${site.origin.x}:${site.origin.y}`,
      );
      const pulse = dungeonSprite(here, s.lights, site, s.measureText);
      registerPick(here, {
        ref: { kind: 'dungeon', id: map.dungeons().indexOf(site) },
        body: dungeonBody(here),
        foot: point(site.origin.x + 1, site.origin.y + 1),
        ellipse: { rx: 48, ry: 18 },
      });
      if (pulse) s.pulses.push(pulse);
      addPool(s, pool(project(f32(site.origin.x + 1), f32(site.origin.y + 1)), 90, 45));
      const tint =
        site.kind === DungeonKind.Cave
          ? arcaneWisp
          : site.kind === DungeonKind.Ruin
            ? ([170, 250, 130] as Rgb)
            : violetWisp;
      for (let i = 0; i < 3; i++)
        s.wisps.push({
          center: project(f32(site.origin.x + 1), f32(site.origin.y + 1)),
          color: tint,
          radius: f32(30 + f32(i * 10)),
        });
    }
    for (
      let x = Math.max(0, f32(f32(row - map.height()) + 1));
      x <= Math.min(row, f32(map.width() - 1));
      x++
    ) {
      const y = f32(row - x);
      if (
        map.at(x, y).terrain !== Terrain.Sea ||
        !map.at(x, y).revealed ||
        hash01(map.seed(), x, y, 851) > f32(0.5)
      )
        continue;
      const pours = (lx: number, ly: number) =>
        lx >= 0 &&
        ly >= 0 &&
        map.at(lx, ly).terrain === Terrain.Lava &&
        map.value(Layer.Heat, point(f32(lx + f32(0.5)), f32(ly + f32(0.5)))) >= f32(1.5);
      if (pours(f32(x - 1), y) || pours(x, f32(y - 1)))
        paintSteam(
          here,
          project(f32(x + f32(0.35)), f32(y + f32(0.35))),
          (map.seed() ^ Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0,
        );
    }
    for (
      let x = Math.max(0, f32(f32(row - map.height()) + 1));
      x <= Math.min(row, f32(map.width() - 1));
      x++
    ) {
      const y = f32(row - x);
      if (x % 3 || y % 3 || !map.at(x, y).revealed || map.at(x, y).terrain !== Terrain.Lava) continue;
      const at = project(f32(x + f32(0.5)), f32(y + f32(0.5))),
        heat = glow(at, 96, 48, [255, 120, 40], 42);
      s.lights.add(heat);
      addPool(s, pool(at, 120, 60, [150, 60, 24], Flicker.Hearth, heat));
    }
    let key = look;
    for (
      let x = Math.max(0, f32(f32(row - map.height()) + 1));
      x <= Math.min(row, f32(map.width() - 1));
      x++
    ) {
      const tile = map.at(x, f32(row - x));
      key = BigInt.asUintN(64, key * 1099511628211n) ^ (BigInt(tile.trees) | (BigInt(tile.quarried) << 8n));
    }
    if (key === s.treeKeys[row]) continue;
    const fresh = s.treeKeys[row] === -1n;
    s.treeKeys[row] = key;
    if (s.treeCounts.length !== f32(map.width() * map.height()))
      s.treeCounts = new Uint8Array(f32(map.width() * map.height()));
    for (
      let x = Math.max(0, f32(f32(row - map.height()) + 1));
      x <= Math.min(row, f32(map.width() - 1));
      x++
    ) {
      const cell = f32(f32(f32(row - x) * map.width()) + x),
        now = map.at(x, f32(row - x)).trees;
      if (!fresh && !s.editorView)
        for (let index = s.treeCounts[cell]; index < now; index++)
          sprout(s, map, climate, x, f32(row - x), index, row);
      s.treeCounts[cell] = now;
    }
    buildTreeRow(s, map, climate, row);
  }
  for (const wisp of s.wisps) {
    const orb = new SceneNode()
      .add(ellipse(point(), 5, 5, opaque(wisp.color, 50)))
      .add(ellipse(point(), 2, 2, opaque(wisp.color)));
    s.effects.add(orb);
    s.wispPaints.push(orb);
  }
  s.buildingPools = s.pools.length;
  s.roadLights = new SceneNode();
  s.lights.add(s.roadLights);
}
export function buildRoadLights(
  s: WorldRendererState,
  _town: Town,
  _traffic: Traffic,
  force: boolean,
): boolean {
  if (!force && !s.lamps.length) return false;
  for (const row of s.rowLamps) row.remove();
  s.roadLights.remove();
  s.lamps = [];
  s.pools.length = s.buildingPools;
  return true;
}

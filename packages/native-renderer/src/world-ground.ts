import {
  project,
  unproject,
  point,
  add,
  sub,
  mul,
  normalized,
  tileHalfWidth,
  tileHalfHeight,
} from '../../engine/src/geometry';
import { f32, hash01, clamp } from '../../engine/src/numeric';
import { WorldMap } from '../../engine/src/world-map';
import { Terrain, Layer } from '../../engine/src/world-types';
import { Preview, PreviewKind } from '../../engine/src/game-tools';
import type { Climate } from '../../engine/src/climate';
import { Rect } from '../../native-ui/src/types';
import { SceneNode, ShapeNode, TextNode, type Rgb } from './paint';
import { appendPolygon, ellipse, fill, opaque } from './vector-paint';
import { appendRoad, roadStrokes } from './road-painter';
import { paintHvergelmir } from './hvergelmir-painter';
import { registerPick } from './world-pick-registry';
import { paintGround, tintGround } from './terrain-painter';
import { WorldRendererState, isoLayer, type GroundChunk } from './world-renderer-state';
import type { TileRegion } from './render-types';
export function resize(s: WorldRendererState, width: number, height: number): void {
  if (width === s.viewWidth && height === s.viewHeight) return;
  s.viewWidth = width;
  s.viewHeight = height;
  s.background.reset().appendRect(0, 0, width, height).fill(11, 18, 27);
  s.overcast.reset().appendRect(0, 0, width, height);
  s.vignette.remove();
  const reach = f32(f32(Math.hypot(width, height)) / 2),
    frame = new ShapeNode().appendRect(0, 0, width, height).fillGradient({
      type: 'radial',
      coordinates: [f32(width / 2), f32(height / 2), reach, f32(width / 2), f32(height / 2), 0],
      stops: [
        { offset: 0, color: [5, 6, 10, 0] },
        { offset: f32(0.62), color: [5, 6, 10, 0] },
        { offset: 1, color: [5, 6, 10, 110] },
      ],
    });
  s.vignette.add(frame);
}
export function fitToView(s: WorldRendererState, force = false): void {
  if (s.viewWidth <= 0) return;
  const view = s.view,
    halfW = f32(f32(f32(f32(s.viewWidth / 2) / view.zoom) * f32(1.25)) + 64),
    halfH = f32(f32(f32(f32(s.viewHeight / 2) / view.zoom) * f32(1.25)) + 64),
    rect = [f32(view.x - halfW), f32(view.y - halfH), f32(halfW * 2), f32(halfH * 2)];
  let moved = force;
  for (let i = 0; i < 4; i++) moved ||= Math.abs(f32(rect[i] - s.fitted[i])) > f32(24 / view.zoom);
  if (!moved) return;
  s.fitted = rect;
  for (const pass of s.sunPasses) pass.reset().appendRect(rect[0], rect[1], rect[2], rect[3]);
  s.darkVeil?.reset().appendRect(rect[0], rect[1], rect[2], rect[3]);
  const lo = [1e9, 1e9],
    hi = [-1e9, -1e9];
  for (const [sx, sy] of [
    [rect[0], rect[1]],
    [f32(rect[0] + rect[2]), rect[1]],
    [rect[0], f32(rect[1] + rect[3])],
    [f32(rect[0] + rect[2]), f32(rect[1] + rect[3])],
  ]) {
    const t = unproject(sx, sy);
    lo[0] = Math.min(lo[0], t.x);
    lo[1] = Math.min(lo[1], t.y);
    hi[0] = Math.max(hi[0], t.x);
    hi[1] = Math.max(hi[1], t.y);
  }
  if (s.fogBorder) {
    const b = s.exploredVisibility.bounds(),
      [x0, y0] = lo,
      [x1, y1] = hi;
    s.fogBorder.reset();
    const rectangle = (x: number, y: number, w: number, h: number) => {
      if (w > 0 && h > 0) s.fogBorder!.appendRect(x, y, w, h);
    };
    rectangle(x0, y0, f32(Math.min(x1, b.x) - x0), f32(y1 - y0));
    rectangle(Math.max(x0, f32(b.x + b.w)), y0, f32(x1 - Math.max(x0, f32(b.x + b.w))), f32(y1 - y0));
    const left = Math.max(x0, b.x),
      right = Math.min(x1, f32(b.x + b.w));
    rectangle(left, y0, f32(right - left), f32(Math.min(y1, b.y) - y0));
    rectangle(left, Math.max(y0, f32(b.y + b.h)), f32(right - left), f32(y1 - Math.max(y0, f32(b.y + b.h))));
  }
}
export function paintMapName(s: WorldRendererState, map: WorldMap, zoom: number): void {
  s.mapName.opacity(Math.trunc(f32(clamp(f32(f32(f32(0.9) - zoom) / f32(0.5)), 0, 1) * 255)));
  if (s.nameDirty) {
    s.nameDirty = false;
    s.mapName.remove();
    s.lettering = null;
    const label = map.nameLabel();
    if (!label) return;
    const box = s.measureText('MIDGARD', 44, 'DejaVuSans-Bold');
    if (!box) return;
    const text = new TextNode(),
      shadow = new TextNode();
    for (const item of [text, shadow]) {
      item.font = 'DejaVuSans-Bold';
      item.size = 44;
      item.text = 'MIDGARD';
      item.opacity(150);
    }
    text.color = [232, 224, 206, 255];
    shadow.color = [12, 14, 18, 255];
    s.mapName.add(shadow).add(text);
    s.lettering = { text, shadow, at: project(label.x, label.y), box };
  }
  if (!s.lettering) return;
  const letter = s.lettering,
    pixels = clamp(f32(zoom * 60), 11, 20),
    scale = f32(f32(pixels / Math.max(zoom, f32(0.01))) / 44);
  for (const [text, shift] of [
    [letter.shadow, f32(f32(1.2) / Math.max(zoom, f32(0.01)))],
    [letter.text, 0],
  ] as const)
    text.transform([
      scale,
      0,
      f32(f32(letter.at.x + shift) - f32(f32(letter.box.x + f32(letter.box.w / 2)) * scale)),
      0,
      scale,
      f32(f32(letter.at.y + shift) - f32(f32(letter.box.y + f32(letter.box.h / 2)) * scale)),
      0,
      0,
      1,
    ]);
}
export function paintOrnaments(s: WorldRendererState, map: WorldMap, climate: Readonly<Climate>): void {
  s.ornaments.remove();
  const snowy = climate.snow > f32(0.3),
    blooms = Array.from({ length: 4 }, () => new ShapeNode()),
    cracks = new ShapeNode();
  for (let y = 0; y < map.height(); y++)
    for (let x = 0; x < map.width(); x++) {
      const tile = map.at(x, y);
      if (!tile.revealed) continue;
      const middle = point(f32(x + f32(0.5)), f32(y + f32(0.5)));
      if (tile.terrain === Terrain.Ice) {
        if (hash01(map.seed(), x, y, 93) < f32(0.5)) {
          let at = point(
              f32(f32(x + f32(0.15)) + f32(hash01(map.seed(), x, y, 94) * f32(0.5))),
              f32(f32(y + f32(0.15)) + f32(hash01(map.seed(), x, y, 95) * f32(0.5))),
            ),
            heading = f32(hash01(map.seed(), x, y, 96) * f32(6.2832));
          const line = [project(at.x, at.y)];
          for (let k = 1; k < 4; k++) {
            heading = f32(heading + f32(f32(hash01(map.seed(), x, y, 96 + k) - f32(0.5)) * f32(1.2)));
            at = add(at, mul(point(f32(Math.cos(heading)), f32(Math.sin(heading))), f32(0.24)));
            line[k] = project(at.x, at.y);
          }
          const across = (k: number) => {
            const along = normalized(sub(line[f32(k + 1)], line[f32(k - 1)]));
            return point(f32(-along.y * f32(0.45)), f32(along.x * f32(0.45)));
          };
          appendPolygon(cracks, [
            line[0],
            add(line[1], across(1)),
            add(line[2], across(2)),
            line[3],
            sub(line[2], across(2)),
            sub(line[1], across(1)),
          ]);
        }
        continue;
      }
      const lush =
        (tile.terrain === Terrain.Grass || tile.terrain === Terrain.Meadow) &&
        map.value(Layer.Moisture, middle) > f32(0.4) &&
        map.value(Layer.Heat, middle) < f32(0.52) &&
        map.value(Layer.Land, middle) > f32(0.1);
      if (
        !lush ||
        tile.trees ||
        snowy ||
        map.value(Layer.Shade, middle) <= f32(0.58) ||
        hash01(map.seed(), x, y, 70) >= f32(0.7)
      )
        continue;
      const color = Math.trunc(f32(hash01(map.seed(), Math.trunc(x / 3), Math.trunc(y / 3), 71) * 4)) % 4;
      let count = tile.terrain === Terrain.Meadow ? 7 : 4;
      if (climate.autumn > f32(0.5)) count = Math.trunc(f32(count / 2));
      for (let i = 0; i < count; i++) {
        const spot = point(
            f32(f32(x + f32(0.15)) + f32(hash01(map.seed(), x, y, 72 + i) * f32(0.7))),
            f32(f32(y + f32(0.15)) + f32(hash01(map.seed(), x, y, 80 + i) * f32(0.7))),
          ),
          ground = map.terrainAt(spot);
        if (ground !== Terrain.Grass && ground !== Terrain.Meadow) continue;
        const b = project(spot.x, spot.y);
        blooms[color].appendCircle(b.x, f32(b.y - 1), f32(1.6), f32(1.1));
      }
    }
  fill(cracks, [92, 120, 142, 170]);
  s.ornaments.add(cracks);
  const flowers: Rgb[] = [
    [226, 120, 150],
    [236, 206, 90],
    [236, 236, 226],
    [170, 130, 226],
  ];
  for (let i = 0; i < 4; i++) {
    fill(blooms[i], opaque(flowers[i]));
    s.ornaments.add(blooms[i]);
  }
  const spring = map.hvergelmir();
  if (
    map.inside(Math.trunc(spring.x), Math.trunc(spring.y)) &&
    map.at(Math.trunc(spring.x), Math.trunc(spring.y)).revealed
  ) {
    const springPaint = new SceneNode();
    paintHvergelmir(springPaint, map);
    if (springPaint.children.length) {
      s.ornaments.add(springPaint);
      registerPick(springPaint, {
        ref: { kind: 'landmark', id: 2 },
        body: [springPaint],
        foot: spring,
        ellipse: { rx: 64, ry: 32 },
      });
    }
  }
}
export function buildPreview(s: WorldRendererState, preview: Preview): void {
  s.overlay.remove();
  if (preview.kind === PreviewKind.None) return;
  const layer = isoLayer();
  s.overlay.add(layer);
  const tint = preview.valid ? ([120, 210, 140, 90] as const) : ([230, 84, 70, 100] as const),
    k = f32(1 / preview.zoom);
  if (preview.road.length) {
    roadStrokes(
      layer,
      [preview.road],
      preview.kind === PreviewKind.Clear ? 200 : 150,
      preview.kind === PreviewKind.Clear ? [150, 60, 50] : [88, 72, 52],
    );
    if (preview.kind === PreviewKind.Road) {
      const spine = new ShapeNode();
      appendRoad(spine, preview.road);
      spine
        .strokeWidth(f32(0.05))
        .strokeCap('round')
        .strokeJoin('round')
        .strokeFill(tint[0], tint[1], tint[2], 230);
      layer.add(spine);
    }
  }
  if (preview.outline.length) {
    const shape = new ShapeNode().moveTo(preview.outline[0].x, preview.outline[0].y);
    for (let i = 1; i < preview.outline.length; i++) shape.lineTo(preview.outline[i].x, preview.outline[i].y);
    if (preview.closed) {
      shape.close();
      fill(shape, tint);
    } else shape.lineTo(preview.cursor.x, preview.cursor.y);
    shape.strokeWidth(f32(0.06)).strokeJoin('round').strokeFill(tint[0], tint[1], tint[2], 230);
    layer.add(shape);
    if (preview.kind === PreviewKind.Field)
      for (let i = 0; i < preview.outline.length; i++) {
        const p = project(preview.outline[i].x, preview.outline[i].y),
          radius = f32((i === 0 && !preview.closed && preview.active === 0 ? f32(5.5) : f32(3.6)) * k),
          knob = ellipse(p, radius, radius, [240, 232, 214, 255])
            .strokeWidth(f32(f32(1.4) * k))
            .strokeFill(20, 16, 12);
        s.overlay.add(knob);
      }
  }
  if (preview.brush) {
    const at = project(preview.cursor.x, preview.cursor.y),
      ring = ellipse(at, f32(5 * k), f32(5 * k), [0, 0, 0, 0])
        .strokeWidth(f32(f32(1.5) * k))
        .strokeFill(tint[0], tint[1], tint[2], 230);
    s.overlay
      .add(ring)
      .add(ellipse(at, f32(f32(1.5) * k), f32(f32(1.5) * k), [tint[0], tint[1], tint[2], 230]));
  }
}
export function updateGroundChunks(
  s: WorldRendererState,
  map: WorldMap,
  climate: Readonly<Climate>,
  recolor: boolean,
): void {
  s.groundWidth = map.width();
  s.groundHeight = map.height();
  const overview = s.view.zoom < f32(0.25);
  if (!s.overviewGround) {
    s.overviewGround = new SceneNode();
    s.detailedGround = new SceneNode();
    s.ground.add(s.overviewGround).add(s.detailedGround);
  }
  s.overviewGround.opacity(overview ? 255 : 0);
  const initialize = (chunks: GroundChunk[], group: SceneNode, width: number, patches: boolean) => {
    if (chunks.length) return;
    const height = Math.trunc(f32(width / 2)),
      left = f32(Math.trunc(Math.floor(f32(f32(f32(-map.height() * tileHalfWidth) - 1024) / width))) * width),
      right = f32(Math.trunc(Math.ceil(f32(f32(f32(map.width() * tileHalfWidth) + 1024) / width))) * width),
      first = f32(Math.trunc(Math.floor(f32(-512 / height))) * height);
    for (
      let y = first;
      y < f32(f32(f32(map.width() + map.height()) * tileHalfHeight) + 512);
      y = f32(y + height)
    )
      for (let x = left; x < right; x = f32(x + width)) {
        const projected = [f32(1 / 64), f32(1 / 32), 0, f32(-1 / 64), f32(1 / 32), 0, 0, 0, 1] as const,
          scene = new SceneNode().transform(projected),
          clip = new ShapeNode().appendRect(x, y, width, height).fill(255, 255, 255).transform(projected);
        scene.clip(clip);
        if (patches) scene.add(new ShapeNode().appendRect(x, y, width, height).fill(11, 18, 27));
        const terrain = isoLayer();
        scene.add(terrain);
        group.add(scene);
        const a = unproject(x, y),
          b = unproject(f32(x + width), f32(y + height)),
          c = unproject(f32(x + width), y),
          d = unproject(x, f32(y + height));
        chunks.push({
          area: {
            left: Math.floor(a.x),
            top: Math.floor(c.y),
            right: Math.ceil(b.x),
            bottom: Math.ceil(d.y),
          },
          bounds: new Rect(x, y, width, height),
          scene,
          terrain,
          tints: [],
          dirty: true,
          edited: false,
        });
      }
  };
  initialize(s.groundChunks, s.detailedGround!, 512, true);
  if (overview && !s.overviewChunks.length) {
    const terrain = new SceneNode();
    s.overviewGround.add(terrain);
    s.overviewChunks.push({
      area: { left: 0, top: 0, right: map.width(), bottom: map.height() },
      bounds: new Rect(
        f32(f32(-map.height() * tileHalfWidth) - 1024),
        -512,
        f32(f32(f32(map.width() + map.height()) * tileHalfWidth) + 2048),
        f32(f32(f32(map.width() + map.height()) * tileHalfHeight) + 1024),
      ),
      scene: terrain,
      terrain,
      tints: [],
      dirty: true,
      edited: false,
    });
  }
  const left = f32(f32(s.view.x - f32(f32(s.viewWidth / 2) / s.view.zoom)) - 8),
    right = f32(f32(s.view.x + f32(f32(s.viewWidth / 2) / s.view.zoom)) + 8),
    top = f32(f32(s.view.y - f32(f32(s.viewHeight / 2) / s.view.zoom)) - 8),
    bottom = f32(f32(s.view.y + f32(f32(s.viewHeight / 2) / s.view.zoom)) + 8);
  const update = (chunks: GroundChunk[], patchesOnly: boolean, wholeMap = false) => {
    for (const chunk of chunks) {
      const a = chunk.area,
        b = chunk.bounds,
        visible =
          (!patchesOnly || chunk.edited) &&
          f32(b.x + b.w) >= left &&
          b.x <= right &&
          f32(b.y + b.h) >= top &&
          b.y <= bottom;
      chunk.scene.opacity(visible ? 255 : 0);
      if (visible && chunk.dirty) {
        chunk.terrain.remove();
        const padding: TileRegion = {
          left: f32(a.left - 2),
          top: f32(a.top - 2),
          right: f32(a.right + 2),
          bottom: f32(a.bottom + 2),
        };
        chunk.tints = paintGround(chunk.terrain, map, wholeMap ? undefined : padding);
        tintGround(chunk.tints, climate);
        chunk.dirty = false;
        if (wholeMap) for (const detail of s.groundChunks) detail.edited = false;
      } else if (recolor && chunk.tints.length) tintGround(chunk.tints, climate);
    }
  };
  if (overview) update(s.overviewChunks, false, true);
  else if (recolor) for (const chunk of s.overviewChunks) tintGround(chunk.tints, climate);
  update(s.groundChunks, overview);
}

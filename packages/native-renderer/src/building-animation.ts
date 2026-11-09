// Literal translation of GameFramework/building_animation.cpp. The generated
// Lottie retains the native depth tracks, hold keys, gradients, and dust timing.
import { point, type Point } from '../../engine/src/geometry';
import { f32 } from '../../engine/src/numeric';
import { BuildingProjection, orientModel, splitAngle, type Model } from './building-model';
import { validateBuildingAsset } from './building-asset';
import { buildingFaces, FaceStyle, Motion, type Face, type Polygon } from './building-faces';
import { depthBatches, faceOpacity } from './building-depth';
import type { Rgb } from './paint';
export interface RiseAnimation {
  json: string;
  width: number;
  height: number;
  originX: number;
  originY: number;
  frames: number;
  frameRate: number;
}
export interface BuildingStage {
  model: Model;
  footprint: number;
  dx: number;
  dy: number;
}
const padding = 12,
  sinkFrames = 10,
  outline: Rgb = [20, 18, 24],
  soil: Rgb = [40, 34, 28];
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const constant = (k: Json): Json => ({ a: 0, k });
// Native ostream's max_digits10 serializes float32 values with nine digits.
const serial = (value: number): number => Number(f32(value).toPrecision(9));
// std::to_chars and classic fixed streams round decimal ties to even. Keep the
// sign of zero in the text: native sampled-track de-duplication compares text.
function fixed(value: number): string {
  value = f32(value);
  const scaled = Math.abs(value) * 1000,
    floor = Math.floor(scaled),
    fraction = scaled - floor;
  const rounded = fraction === 0.5 ? floor + (floor % 2) : Math.round(scaled);
  const digits = String(rounded).padStart(4, '0');
  return (value < 0 || Object.is(value, -0) ? '-' : '') + digits.slice(0, -3) + '.' + digits.slice(-3);
}
const vector = (values: number[]): string => '[' + values.map(fixed).join(',') + ']';
const nextFloatDown = (value: number): number => {
  const buffer = new ArrayBuffer(4),
    floats = new Float32Array(buffer),
    bits = new Uint32Array(buffer);
  floats[0] = value;
  bits[0] += value > 0 ? -1 : 1;
  return floats[0];
};
function keyframes(times: number[], emit: (i: number) => Json): Json {
  return {
    a: 1,
    k: times.map((time, i) => ({
      t: serial(time),
      s: emit(i),
      o: { x: [0], y: [0] },
      i: { x: [1], y: [1] },
    })),
  };
}
function sampled(times: number[], values: string[], wrap = false, gradientSteps = false): Json {
  if (values.every((value) => value === values[0])) return constant(JSON.parse(values[0]) as Json);
  const keys: Json[] = [],
    key = (time: number, value: string) => {
      const s = JSON.parse(value) as Json;
      keys.push({ t: serial(time), s: wrap ? [s] : s, h: 1 });
      written = time;
    };
  let written = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (i && values[i] === values[i - 1]) continue;
    if (gradientSteps && i) {
      const before = nextFloatDown(times[i]);
      if (before > written) key(before, values[i - 1]);
    }
    key(times[i], values[i]);
  }
  return { a: 1, k: keys };
}
function transform(opacity: Json = constant(100)): Json {
  return {
    ty: 'tr',
    p: constant([0, 0]),
    a: constant([0, 0]),
    s: constant([100, 100]),
    r: constant(0),
    o: opacity,
  };
}
function lastDelay(model: Model): number {
  let last = 0;
  for (const b of model.blocks) last = Math.max(last, b.delay);
  for (const p of model.patches) last = Math.max(last, p.delay);
  return last;
}
function pathText(polygon: Polygon, closed: boolean, shift: Point): string {
  const zeros = polygon.map(() => '[0,0]').join(',');
  return (
    '{"c":' +
    closed +
    ',"v":[' +
    polygon.map((p) => vector([f32(p.x + shift.x), f32(p.y + shift.y)])).join(',') +
    '],"i":[' +
    zeros +
    '],"o":[' +
    zeros +
    ']}'
  );
}
function outCubic(t: number): number {
  t = f32(1 - Math.max(0, Math.min(1, t)));
  return f32(1 - f32(f32(t * t) * t));
}
function animation(
  source: Model,
  size: number,
  replaced: readonly BuildingStage[],
  angle: number,
  projection: BuildingProjection,
  still: boolean,
): RiseAnimation {
  size = f32(size);
  angle = f32(angle);
  const valid = (model: Model, footprint: number) =>
    validateBuildingAsset({ id: 'preview', name: 'Preview', footprint, variants: [model] });
  valid(source, size);
  if (
    !Number.isFinite(angle) ||
    !Number.isFinite(projection.halfWidth) ||
    !Number.isFinite(projection.halfHeight) ||
    projection.halfWidth <= 0 ||
    projection.halfWidth > 512 ||
    projection.halfHeight <= 0 ||
    projection.halfHeight > 512 ||
    replaced.length > 32
  )
    throw new Error('invalid building projection, angle or stage count');
  for (const stage of replaced) {
    valid(stage.model, stage.footprint);
    if (
      !Number.isFinite(stage.dx) ||
      !Number.isFinite(stage.dy) ||
      Math.abs(stage.dx) > 32 ||
      Math.abs(stage.dy) > 32
    )
      throw new Error('invalid replaced stage offset');
  }
  const { quarterTurns: quarter, remainder: turn } = splitAngle(angle),
    model = structuredClone(source);
  orientModel(model, quarter, size);
  const result: RiseAnimation = {
      json: '',
      width: 0,
      height: 0,
      originX: 0,
      originY: 0,
      frames: 0,
      frameRate: 30,
    },
    rising = new Motion();
  rising.start = replaced.length ? sinkFrames : 0;
  rising.turn = turn;
  rising.projection = projection;
  rising.pivot = point(f32(size / 2), f32(size / 2));
  result.frames = f32(f32(rising.start + lastDelay(model)) + 42);
  for (const block of model.blocks)
    result.frames = Math.max(
      result.frames,
      f32(f32(f32(rising.start + block.delay) + 35) + 2 * Math.max(0, block.windows - 1)),
    );
  for (const stage of replaced) result.frames = Math.max(result.frames, f32(lastDelay(stage.model) + 14));
  const faces: Face[] = [],
    inset = f32(0.04),
    fresh = !replaced.length;
  faces.push({
    shape: (frame) => {
      const s = fresh ? outCubic(f32(frame / 8)) : 1,
        c = f32(size / 2),
        r = f32(f32(f32(size / 2) - inset) * s);
      return [
        rising.place(f32(c - r), f32(c - r)),
        rising.place(f32(c + r), f32(c - r)),
        rising.place(f32(c + r), f32(c + r)),
        rising.place(f32(c - r), f32(c + r)),
      ];
    },
    color: soil,
    style: FaceStyle.Filled,
    width: f32(1.2),
    opacity: [],
  });
  for (const stage of replaced) {
    const half = f32(stage.footprint / 2);
    let center = point(f32(f32(stage.dx + half) - f32(size / 2)), f32(f32(stage.dy + half) - f32(size / 2)));
    for (let q = 0; q < quarter; q++) center = point(-center.y, center.x);
    const sinking = new Motion();
    Object.assign(sinking, rising);
    sinking.start = 0;
    sinking.sinking = true;
    sinking.offset = point(
      f32(f32(center.x + f32(size / 2)) - half),
      f32(f32(center.y + f32(size / 2)) - half),
    );
    const old = structuredClone(stage.model);
    orientModel(old, quarter, f32(half * 2));
    buildingFaces(old, sinking, faces);
  }
  buildingFaces(model, rising, faces);
  const finalPose = result.frames;
  let times: number[] = [];
  if (still) {
    times.push(finalPose);
    result.frames = 1;
  } else {
    for (let t = 0; t < result.frames; t = f32(t + 1)) times.push(t);
    times.push(f32(result.frames - 1), result.frames);
  }
  times = [...new Set(times)].sort((a, b) => a - b);
  const samples = times.map((t) => depthBatches(faces, t)),
    slots = Math.max(...samples.map((s) => s.length));
  let minX = 3.4028234663852886e38,
    minY = minX,
    maxX = -minX,
    maxY = -minX;
  for (const face of faces)
    for (const t of times)
      for (const p of face.shape(t)) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
  const center = projection.project(f32(size / 2), f32(size / 2)),
    dustRadius = f32(f32(size * projection.halfWidth) * f32(1.25));
  minX = Math.min(minX, f32(center.x - dustRadius));
  maxX = Math.max(maxX, f32(center.x + dustRadius));
  maxY = Math.max(maxY, f32(center.y + f32(dustRadius / 2)));
  const offset = point(f32(padding - minX), f32(padding - minY));
  result.width = Math.ceil(f32(f32(maxX - minX) + padding * 2));
  result.height = Math.ceil(f32(f32(maxY - minY) + padding * 2));
  result.originX = offset.x;
  result.originY = offset.y;
  const shapes: Json[] = [],
    document: Json = {
      v: '5.7.0',
      fr: result.frameRate,
      ip: 0,
      op: serial(result.frames),
      w: serial(result.width),
      h: serial(result.height),
      nm: 'rise',
      ddd: 0,
      assets: [],
      layers: [
        {
          ddd: 0,
          ind: 1,
          ty: 4,
          nm: 'structure',
          sr: 1,
          ks: {
            o: constant(100),
            r: constant(0),
            p: constant([0, 0, 0]),
            a: constant([0, 0, 0]),
            s: constant([100, 100, 100]),
          },
          ao: 0,
          ip: 0,
          op: serial(result.frames),
          st: 0,
          bm: 0,
          shapes,
        },
      ],
    };
  const finishes = faces.map((face) => {
    let top = 3.4028234663852886e38,
      bottom = -top;
    for (const p of face.shape(finalPose)) {
      top = Math.min(top, p.y);
      bottom = Math.max(bottom, p.y);
    }
    const shaded = f32(bottom - top) > 2,
      color = face.color,
      channel = (c: number, scale: number) => Math.min(1, f32(f32(c * scale) / 255));
    const gradient =
      '[0,' +
      color.map((c) => fixed(channel(c, shaded ? f32(1.18) : 1))).join(',') +
      ',1,' +
      color.map((c) => fixed(channel(c, shaded ? f32(0.78) : 1))).join(',') +
      ']';
    const stroke = face.style === FaceStyle.Outlined ? outline : color;
    return {
      gradient,
      start: vector([offset.x, f32(top + offset.y)]),
      end: vector([offset.x, f32((shaded ? bottom : f32(top + 1)) + offset.y)]),
      stroke: '[' + stroke.map((c) => fixed(f32(c / 255))).join(',') + ',1]',
      width: fixed(face.style === FaceStyle.Outlined ? f32(1.2) : face.width),
    };
  });
  const opacities = faces.map((face) => times.map((time) => fixed(faceOpacity(face, time)))),
    hiddenPath = pathText([{ x: 0, y: 0, depth: 0 }], false, offset);
  for (let n = slots - 1; n >= 0; n--) {
    const items: Json[] = [],
      pathsInSlot = Math.max(...samples.map((sample) => (n < sample.length ? sample[n].polygons.length : 0)));
    for (let path = 0; path < pathsInSlot; path++) {
      const paths = samples.map((sample) =>
        n < sample.length && path < sample[n].polygons.length
          ? pathText(sample[n].polygons[path], !sample[n].line, offset)
          : hiddenPath,
      );
      items.push({ ty: 'sh', ks: sampled(times, paths, true) });
    }
    const gradients: string[] = [],
      starts: string[] = [],
      ends: string[] = [],
      strokes: string[] = [],
      widths: string[] = [],
      fillAlpha: string[] = [],
      lineAlpha: string[] = [],
      alpha: string[] = [];
    for (let i = 0; i < times.length; i++) {
      const present = n < samples[i].length,
        batch = present ? samples[i][n] : undefined,
        source = batch?.source ?? 0,
        line = !!batch?.line,
        finish = finishes[source];
      gradients.push(finish.gradient);
      starts.push(finish.start);
      ends.push(finish.end);
      strokes.push(finish.stroke);
      widths.push(finish.width);
      fillAlpha.push(present && !line ? '100' : '0');
      lineAlpha.push(line ? '100' : '0');
      alpha.push(present ? opacities[source][i] : '0');
    }
    items.push(
      {
        ty: 'gf',
        r: 1,
        t: 1,
        g: { p: 2, k: sampled(times, gradients, false, true) },
        s: sampled(times, starts),
        e: sampled(times, ends),
        o: sampled(times, fillAlpha, true),
      },
      {
        ty: 'st',
        c: sampled(times, strokes),
        w: sampled(times, widths, true),
        o: sampled(times, lineAlpha, true),
        lc: 2,
        lj: 2,
      },
      transform(sampled(times, alpha, true)),
    );
    shapes.push({ ty: 'gr', nm: 'depth' + n, it: items });
  }
  if (!still) {
    const x = f32(center.x + offset.x),
      y = f32(center.y + offset.y),
      kick = rising.start,
      dustTimes = [0, f32(kick + 4), f32(kick + 30)];
    shapes.push({
      ty: 'gr',
      nm: 'dust',
      it: [
        {
          ty: 'el',
          p: constant([serial(x), serial(y)]),
          s: keyframes(dustTimes, (i) => {
            const r = f32(dustRadius * (i < 2 ? f32(0.45) : 1));
            return [serial(f32(r * 2)), serial(r)];
          }),
        },
        {
          ty: 'st',
          c: constant([serial(f32(150 / 255)), serial(f32(136 / 255)), serial(f32(112 / 255)), 1]),
          o: keyframes(dustTimes, (i) => [i === 1 ? 55 : 0]),
          w: constant(2.5),
          lc: 2,
          lj: 2,
        },
        transform(),
      ],
    });
  }
  result.json = JSON.stringify(document);
  return result;
}
export function buildingRiseAnimation(
  source: Model,
  footprint: number,
  replaced: readonly BuildingStage[] = [],
  angle = 0,
  projection = new BuildingProjection(),
): RiseAnimation {
  return animation(source, footprint, replaced, angle, projection, false);
}
export function buildingStillAnimation(
  source: Model,
  footprint: number,
  angle = 0,
  projection = new BuildingProjection(),
): RiseAnimation {
  return animation(source, footprint, [], angle, projection, true);
}

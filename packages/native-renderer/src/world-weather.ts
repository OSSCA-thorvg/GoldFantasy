// Native WorldRenderer weather, cloud drift and lightning, without replacement masks or artwork.
import { WorldRendererState } from './world-renderer-state';
import { SceneNode, ShapeNode } from './paint';
import { SUN_PASSES, appendStrip, ellipse, fill, glow, opaque } from './vector-paint';
import { CloudMottle } from './cloud-mottle';
import { Climate, Weather } from '../../engine/src/climate';
import { Reach } from '../../engine/src/thunderstorm';
import { point, add, lerp, distance, type Point } from '../../engine/src/geometry';
import { f32 as f, clamp, hash01 } from '../../engine/src/numeric';
const byte = (value: number) => Math.trunc(value) & 255;
export function paintStorm(s: WorldRendererState, seconds: number, night: number): void {
  s.storm.remove();
  const strike = s.strike;
  if (!strike) return;
  const t = f(seconds - strike.at);
  if (t > f(0.9)) s.strike = null;
  if (t < 0 || t > f(0.9)) return;
  const pulse =
    t < f(0.05) ? 1 : t < f(0.1) ? f(0.3) : t < f(0.16) ? f(0.9) : f(Math.exp(f(-f(t - f(0.16)) / f(0.14))));
  const strength = Math.min(1, f(f(strike.brightness * pulse) * f(f(0.55) + f(f(0.45) * night)))),
    halfWidth = f(f(s.viewWidth / 2) / s.view.zoom),
    halfHeight = f(f(s.viewHeight / 2) / s.view.zoom),
    pixel = f(1 / s.view.zoom);
  const sheet = new ShapeNode().appendRect(
    f(s.view.x - halfWidth),
    f(s.view.y - halfHeight),
    f(2 * halfWidth),
    f(2 * halfHeight),
  );
  fill(sheet, opaque([214, 224, 255], byte(f(95 * strength))));
  s.storm.add(sheet);
  s.storm.add(
    glow(s.struck, f(halfWidth * f(1.5)), f(halfHeight * f(1.3)), [236, 240, 255], byte(f(160 * strength))),
  );
  const inView = strike.across >= 0 && strike.across <= 1;
  if (strike.reach > Reach.Middle || !inView || t >= f(0.26)) return;
  const seed = strike.seed,
    top = point(
      f(s.struck.x + f(f(f(hash01(seed, 1, 0, 0xb017) - f(0.5)) * halfWidth) * f(0.4))),
      f(f(s.view.y - halfHeight) - f(60 * pixel)),
    ),
    reach = distance(top, s.struck);
  let sway = 0;
  const steps = 14,
    path: Point[] = [top];
  for (let i = 1; i < steps; ++i) {
    sway = f(f(sway * f(0.6)) + f(f(f(hash01(seed, i, 1, 0xb017) - f(0.5)) * reach) * f(0.09)));
    path.push(add(lerp(top, s.struck, f(i / steps)), point(sway, 0)));
  }
  path.push({ ...s.struck });
  const outer = new ShapeNode(),
    core = new ShapeNode();
  appendStrip(outer, path, f(5 * pixel), f(8 * pixel));
  appendStrip(core, path, f(f(1.6) * pixel), f(3 * pixel));
  for (let k = 0; k < 2; ++k) {
    const fork: Point[] = [path[Math.trunc(f(4 + f(hash01(seed, k, 2, 0xb017) * 6)))]],
      side = k ? 1 : -1;
    for (let i = 1; i <= 5; ++i)
      fork.push(
        add(
          fork[fork.length - 1],
          point(
            f(f(side * reach) * f(f(0.02) + f(f(0.03) * hash01(seed, k * 8 + i, 3, 0xb017)))),
            f(reach * f(0.045)),
          ),
        ),
      );
    appendStrip(outer, fork, f(3 * pixel), f(f(0.5) * pixel));
    appendStrip(core, fork, pixel, f(f(0.3) * pixel));
  }
  fill(outer, opaque([168, 186, 255], byte(f(220 * pulse))));
  fill(core, opaque([255, 255, 255], byte(f(255 * Math.min(1, f(pulse * f(1.2)))))));
  s.storm.add(outer).add(core);
  s.storm.add(glow(s.struck, f(70 * pixel), f(30 * pixel), [236, 242, 255], byte(f(230 * pulse))));
  s.storm.add(ellipse(s.struck, f(9 * pixel), f(4 * pixel), opaque([255, 255, 255], byte(f(255 * pulse)))));
}
export function weather(s: WorldRendererState, climate: Climate, seconds: number): void {
  let grey = 0,
    sun = 1,
    shade = 1,
    cloudy = 0;
  switch (climate.weather) {
    case Weather.Cloudy:
      sun = f(0.85);
      cloudy = 1;
      break;
    case Weather.Rain:
      grey = f(20 + f(55 * climate.intensity));
      sun = f(0.15);
      shade = 0;
      break;
    case Weather.Snow:
      grey = 34;
      sun = f(0.35);
      shade = 0;
      break;
    case Weather.Storm:
      grey = 78;
      sun = f(0.1);
      shade = 0;
      break;
    case Weather.Clear:
      break;
  }
  const step = s.weatherAt < 0 ? 1 : f(1 - f(Math.exp(f(-f(seconds - s.weatherAt) * f(0.22)))));
  s.weatherAt = seconds;
  s.shownGrey = f(s.shownGrey + f(f(grey - s.shownGrey) * step));
  s.shownSun = f(s.shownSun + f(f(sun - s.shownSun) * step));
  s.shownShade = f(s.shownShade + f(f(shade - s.shownShade) * step));
  s.shownCloudy = f(s.shownCloudy + f(f(cloudy - s.shownCloudy) * step));
  if (climate.precipitating()) {
    s.falling = climate.weather;
    s.fallingIntensity = climate.intensity;
  }
  s.shownWet = f(s.shownWet + f(f((climate.precipitating() ? 1 : 0) - s.shownWet) * step));
  s.overcast.fill(24, 28, 38, byte(s.shownGrey));
  s.precipitation.reset();
  const snow = s.falling === Weather.Snow,
    storm = s.falling === Weather.Storm,
    fade = snow
      ? clamp(f(f(s.view.zoom - f(0.15)) / f(0.25)), 0, 1)
      : clamp(f(f(s.view.zoom - f(0.35)) / f(0.3)), 0, 1);
  s.precipitation.opacity(byte(f(255 * fade)));
  if (s.shownWet < f(0.02) || s.viewWidth <= 0 || fade <= 0) return;
  if (snow) {
    const pixel = f(1 / Math.max(s.view.zoom, f(0.15))),
      area = f(f(s.viewWidth * s.viewHeight) / f(1280 * 800)),
      count = clamp(Math.trunc(f(f(f(420 * clamp(s.fallingIntensity, 0, 1)) * s.shownWet) * area)), 0, 900),
      wrap = (value: number, span: number) => f(value - Math.floor(value / span) * span);
    for (let i = 0; i < count; ++i) {
      const depth = f(f(0.7) + f(f(0.6) * hash01(9, i, 0, 3)));
      const x = wrap(
        f(hash01(9, i, 0, 1) * s.viewWidth) +
          f(f(24 + f(60 * climate.wind)) * depth) * seconds +
          Math.sin(seconds * 1.3 + i) * 6 -
          f(s.view.x * s.view.zoom),
        s.viewWidth,
      );
      const y = wrap(
        f(hash01(9, i, 0, 2) * s.viewHeight) +
          f(f(34 + f(hash01(9, i, 0, 4) * 26)) * depth) * seconds -
          f(s.view.y * s.view.zoom),
        s.viewHeight,
      );
      const r = f(f(f(f(0.9) + f(hash01(9, i, 0, 5) * f(1.3))) * depth) * pixel);
      s.precipitation.appendCircle(
        f(s.view.x + f(f(x - f(s.viewWidth / 2)) * pixel)),
        f(s.view.y + f(f(y - f(s.viewHeight / 2)) * pixel)),
        r,
        r,
      );
    }
    s.precipitation
      .fill(238, 244, 252, 225)
      .strokeWidth(f(f(0.55) * pixel))
      .strokeFill(75, 95, 130, 80);
    return;
  }
  const tile = 320,
    wanted = Math.trunc(
      f(f((storm ? 420 : 260) * f(f(0.15) + f(f(0.85) * s.fallingIntensity))) * s.shownWet),
    ),
    k = f(1 / Math.max(s.view.zoom, f(0.6))),
    halfW = f(f(s.viewWidth / 2) / s.view.zoom),
    halfH = f(f(s.viewHeight / 2) / s.view.zoom);
  const x0 = Math.floor(f(f(s.view.x - halfW) / tile)) - 1,
    x1 = Math.floor(f(f(s.view.x + halfW) / tile)) + 1,
    y0 = Math.floor(f(f(s.view.y - halfH) / tile)) - 1,
    y1 = Math.floor(f(f(s.view.y + halfH) / tile)) + 1,
    tiles = (x1 - x0 + 1) * (y1 - y0 + 1),
    each = clamp(Math.trunc(wanted / Math.max(1, tiles)), 0, 40);
  const t = f(seconds),
    wind = f(50 + f(230 * climate.wind)),
    streak = f(9 + f(9 * s.fallingIntensity));
  for (let ty = y0; ty <= y1; ++ty)
    for (let tx = x0; tx <= x1; ++tx)
      for (let i = 0; i < each; ++i) {
        const speed = f(f(620 + f(hash01(9, i, tx, 3) * 260)) * k),
          x = f(f(tx * tile) + f(f(f(hash01(9, i, tx * 131 + ty, 1) * tile) + f(f(wind * k) * t)) % tile)),
          y = f(f(ty * tile) + f(f(f(hash01(9, i, tx * 131 + ty, 2) * tile) + f(speed * t)) % tile));
        s.precipitation.moveTo(x, y).lineTo(f(x - f(f(wind * f(0.025)) * k)), f(y - f(streak * k)));
      }
  s.precipitation
    .fill(0, 0, 0, 0)
    .strokeWidth(k)
    .strokeFill(150, 170, 200, byte(f(90 + f(50 * s.fallingIntensity))));
}
const cloudTile = 1150,
  cloudCols = 6,
  cloudRows = 5;
export function drift(s: WorldRendererState, climate: Climate, seconds: number): void {
  const sun = f(s.shownSun * f(1 - climate.night));
  for (let i = 0; i < s.sunPasses.length; ++i) {
    const spec = SUN_PASSES[i];
    s.sunPasses[i].fill(spec.color[0], spec.color[1], spec.color[2], byte(f(spec.color[3] * sun)));
  }
  s.sunlight.opacity(sun > f(0.01) ? 255 : 0);
  if (!s.cloudShapes.length) {
    const cluster = (seed: number) => {
      const shadow = new SceneNode();
      let x = 0,
        y = 0;
      for (let blob = 0; blob < 12; ++blob) {
        const r = f(70 + f(hash01(31, seed, blob, 1) * 150)),
          stretch = f(f(1.3) + f(hash01(31, seed, blob, 4) * f(1.1)));
        const puff = new ShapeNode().appendCircle(0, 0, r, r).fillGradient({
          type: 'radial',
          coordinates: [0, 0, r, 0, 0, 0],
          stops: [
            { offset: 0, color: [8, 14, 24, 255] },
            { offset: f(0.6), color: [8, 14, 24, 255] },
            { offset: 1, color: [8, 14, 24, 0] },
          ],
        });
        puff.transform([stretch, 0, x, 0, 1, y, 0, 0, 1]);
        shadow.add(puff);
        x = f(x + f(f(hash01(31, seed, blob, 2) - f(0.3)) * 260));
        y = f(y + f(f(hash01(31, seed, blob, 3) - f(0.5)) * 150));
      }
      shadow.opacity(105);
      const holder = new SceneNode().add(shadow);
      s.clouds.add(holder);
      return holder;
    };
    for (let i = 0; i < cloudCols * cloudRows; ++i) s.cloudShapes.push(cluster(i));
    s.mottle = new CloudMottle();
    s.clouds.add(s.mottle.layer());
  }
  const shade = f(s.shownShade * f(1 - f(f(0.65) * climate.night)));
  s.clouds.opacity(byte(f(255 * shade)));
  const shown = shade > 0 && s.viewWidth > 0;
  const windX = f(f(seconds) * 42),
    windY = f(f(seconds) * 15);
  for (const shape of s.cloudShapes) shape.opacity(0);
  if (shown) {
    const halfW = f(f(f(s.viewWidth / 2) / s.view.zoom) + cloudTile),
      halfH = f(f(f(s.viewHeight / 2) / s.view.zoom) + cloudTile),
      x0 = Math.floor(f(f(f(s.view.x - halfW) - windX) / cloudTile)),
      y0 = Math.floor(f(f(f(s.view.y - halfH) - windY) / cloudTile));
    const x1 = Math.min(Math.floor(f(f(f(s.view.x + halfW) - windX) / cloudTile)), x0 + cloudCols - 1),
      y1 = Math.min(Math.floor(f(f(f(s.view.y + halfH) - windY) / cloudTile)), y0 + cloudRows - 1);
    for (let ty = y0; ty <= y1; ++ty)
      for (let tx = x0; tx <= x1; ++tx) {
        if (hash01(37, tx, ty, 21) >= f(0.7)) continue;
        const cloud =
          s.cloudShapes[
            (((tx % cloudCols) + cloudCols) % cloudCols) +
              (((ty % cloudRows) + cloudRows) % cloudRows) * cloudCols
          ];
        cloud.opacity(255);
        cloud.transform([
          1,
          0,
          f(f(f(tx + hash01(37, tx, ty)) * cloudTile) + windX),
          0,
          f(0.5),
          f(f(f(ty + hash01(37, tx, ty, 9)) * cloudTile) + windY),
          0,
          0,
          1,
        ]);
      }
  }
  const mottleShown = shown ? f(s.shownCloudy * clamp(f(f(s.view.zoom - f(0.2)) / f(0.1)), 0, 1)) : 0;
  s.mottle!.update(
    mottleShown,
    f(s.view.x - f(f(s.viewWidth / 2) / s.view.zoom)),
    f(s.view.y - f(f(s.viewHeight / 2) / s.view.zoom)),
    windX,
    windY,
  );
}

import {
  Rect,
  Align,
  ButtonStyle,
  Icon,
  button,
  rgba,
  setTransform,
} from '../../../../packages/native-ui/src';
import { seasonName } from '../../../../packages/engine/src/town-models';
import { weatherName } from '../../../../packages/engine/src/climate';
import { dayCycle, type DayCycle } from '../../../../packages/engine/src/day-cycle';
import type { Paint, Scene, Shape, ThorVGNamespace } from '@thorvg/webcanvas';
import { f32 as f, clamp, lround } from '../../../../packages/engine/src/numeric';
import type { GameHudApp } from './game-hud-contract';
import { skyMural as mural } from './hud-assets';
const revealDuration = f(0.18),
  controlStep = 34,
  panelWidth = 6 * controlStep + 8;
const unfold = (value: number) => f(1 - f(f(f(1 - value) * f(1 - value)) * f(1 - value)));
enum MuralPart {
  Remaining = 1,
  Bodies,
  Sun,
  Moon,
}
interface CelestialParts {
  remaining: Shape;
  sun: Scene;
  moon: Scene;
  sunX: number;
  sunY: number;
}
// WebCanvas exposes IDs but not Scene::paints()/Paint::transform() getters.
// Keep the same owned child objects and prior sun translation alongside the mural.
const celestialParts = new WeakMap<Paint, CelestialParts>();
function orbitPoint(halfTurn: number) {
  const angle = f(f(Math.PI) * f(1 - halfTurn));
  return { x: f(240 + f(74 * f(Math.cos(angle)))), y: f(27 - f(13 * f(Math.sin(angle)))) };
}
function orbitArc(shape: Shape, from: number): void {
  const first = orbitPoint(from);
  shape.reset().moveTo(first.x, first.y);
  for (let i = 1; i <= 32; ++i) {
    const at = orbitPoint(i === 32 ? 1 : Math.min(1, f(from + f(f(i / 32) * f(1 - from)))));
    shape.lineTo(at.x, at.y);
  }
}
function celestialBody(tvg: ThorVGNamespace, moon: boolean): Scene {
  const body = new tvg.Scene();
  body.id = moon ? MuralPart.Moon : MuralPart.Sun;
  const glow = new tvg.Shape().appendCircle(0, 0, 12, 12);
  if (moon) glow.fill(184, 204, 218, 18);
  else glow.fill(218, 184, 111, 22);
  body.add(glow);
  glow.dispose();
  const backing = new tvg.Shape().appendCircle(0, 0, 7.5, 7.5).fill(25, 28, 25, 235);
  body.add(backing);
  backing.dispose();
  const emblem = new tvg.Shape();
  if (moon) {
    emblem
      .moveTo(4, -7)
      .cubicTo(-7, -8, -9, 6, 4, 8)
      .cubicTo(-2, 3, -2, -3, 4, -7)
      .close()
      .fill(210, 220, 212)
      .stroke(f(0.65))
      .stroke({ color: [210, 220, 212, 255] });
  } else {
    emblem
      .appendCircle(0, 0, 5.5, 5.5)
      .fill(207, 177, 110, 70)
      .stroke(f(1.4))
      .stroke({ color: [224, 195, 128, 255] });
    const rays = new tvg.Shape()
      .fill(0, 0, 0, 0)
      .stroke(f(1.1))
      .stroke({ color: [207, 177, 110, 255] });
    for (let i = 0; i < 8; ++i) {
      const angle = f(f(i * f(Math.PI)) / 4),
        x = f(Math.cos(angle)),
        y = f(Math.sin(angle));
      rays.moveTo(f(x * 8), f(y * 8)).lineTo(f(x * f(10.5)), f(y * f(10.5)));
    }
    body.add(rays);
    rays.dispose();
  }
  body.add(emblem);
  emblem.dispose();
  return body;
}
function celestialMural(tvg: ThorVGNamespace): Scene {
  const picture = new tvg.Picture().load(mural, { type: 'svg' }),
    scene = new tvg.Scene();
  scene.add(picture);
  picture.dispose();
  const track = new tvg.Shape();
  orbitArc(track, 0);
  track
    .fill(0, 0, 0, 0)
    .stroke(f(0.85))
    .stroke({ color: [153, 132, 94, 125] });
  for (let i = 0; i <= 4; ++i) {
    const at = orbitPoint(f(i / 4));
    track.moveTo(at.x, f(at.y - 2)).lineTo(at.x, f(at.y + 2));
  }
  scene.add(track);
  track.dispose();
  const remaining = new tvg.Shape();
  remaining.id = MuralPart.Remaining;
  remaining.fill(0, 0, 0, 0).stroke(f(1.7)).stroke({ cap: tvg.StrokeCap.Round });
  scene.add(remaining);
  const bodies = new tvg.Scene();
  bodies.id = MuralPart.Bodies;
  const horizon = new tvg.Shape().appendRect(153, 2, 174, 25).fill(255, 255, 255);
  const sun = celestialBody(tvg, false),
    moon = celestialBody(tvg, true);
  bodies.clip(horizon).add(sun).add(moon);
  horizon.dispose();
  scene.add(bodies);
  bodies.dispose();
  celestialParts.set(scene, { remaining, sun, moon, sunX: 0, sunY: 0 });
  const release = scene.dispose.bind(scene);
  scene.dispose = () => {
    if (scene.isDisposed) return;
    celestialParts.delete(scene);
    remaining.dispose();
    sun.dispose();
    moon.dispose();
    release();
  };
  return scene;
}
function timeOfDay(day: number): string {
  const minutes = Math.trunc(f(f(day * 24) * 60));
  return String(Math.trunc(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
}
function timeRemaining(cycle: DayCycle): string {
  const minutes = Math.max(1, Math.ceil(f(f(cycle.remaining * 24) * 60)));
  return Math.trunc(minutes / 60) + 'h ' + String(minutes % 60).padStart(2, '0') + 'm';
}
export function skyMural(this: GameHudApp, width: number): void {
  const c = this.context,
    t = this.theme,
    now = c.time(),
    dt = this.timeUiAt < 0 ? 0 : f(clamp(now - this.timeUiAt, 0, 0.25));
  this.timeUiAt = now;
  const target = this.timeExpanded ? 1 : 0;
  if (this.reducedMotion()) this.timeReveal = target;
  else if (this.timeExpanded) this.timeReveal = Math.min(target, f(this.timeReveal + f(dt / revealDuration)));
  else this.timeReveal = Math.max(target, f(this.timeReveal - f(dt / revealDuration)));
  const opened = unfold(this.timeReveal);
  this.timeToggleBounds = new Rect(width - (this.touchMode ? 108 : 96), 12, this.touchMode ? 44 : 36, this.touchMode ? 44 : 36);
  const below = width < 900,
    right = below ? width - 16 : this.timeToggleBounds.x - 8,
    controlsWidth = this.touchMode ? 6 * 46 + 8 : panelWidth;
  this.timePanelBounds = new Rect(
    f(right - f(controlsWidth * opened)),
    below ? (this.touchMode ? 62 : 56) : 12,
    f(controlsWidth * opened),
    this.touchMode ? 52 : 36,
  );
  const leftEdge = 16,
    rightEdge = below ? this.timeToggleBounds.x - 12 : this.timePanelBounds.x - 12,
    room = f(2 * Math.min(f(f(width / 2) - leftEdge), f(rightEdge - f(width / 2)))),
    muralWidth = clamp(room, 112, 360);
  this.skyBounds = new Rect(f(f(width - muralWidth) / 2), 12, muralWidth, 36);
  const state = c.control('sky-calendar', this.skyBounds, undefined, true, false);
  this.skyHovered = state.hovered;
  this.skyArtwork ??= celestialMural(c.tvg);
  const cycle = dayCycle(this.town.yearFraction(), this.town.dayFraction()),
    parts = celestialParts.get(this.skyArtwork);
  if (!parts) throw new Error('Incomplete celestial mural');
  const orbit = f(cycle.progress + (cycle.daylight ? 0 : 1)),
    sunAt = orbitPoint(orbit),
    moonAt = orbitPoint(f(orbit + 1));
  if (parts.sunX !== sunAt.x || parts.sunY !== sunAt.y) {
    orbitArc(parts.remaining, cycle.progress);
    parts.remaining.stroke({ color: cycle.daylight ? [212, 181, 114, 215] : [176, 197, 210, 215] });
  }
  setTransform(parts.sun, {
    e11: 1,
    e12: 0,
    e13: sunAt.x,
    e21: 0,
    e22: 1,
    e23: sunAt.y,
    e31: 0,
    e32: 0,
    e33: 1,
  });
  setTransform(parts.moon, {
    e11: 1,
    e12: 0,
    e13: moonAt.x,
    e21: 0,
    e22: 1,
    e23: moonAt.y,
    e31: 0,
    e32: 0,
    e33: 1,
  });
  parts.sunX = sunAt.x;
  parts.sunY = sunAt.y;
  c.add(this.skyArtwork);
  const scale = f(this.skyBounds.w / 480),
    artY = f(this.skyBounds.y + f(f(this.skyBounds.h - f(48 * scale)) / 2));
  setTransform(this.skyArtwork, {
    e11: scale,
    e12: 0,
    e13: this.skyBounds.x,
    e21: 0,
    e22: scale,
    e23: artY,
    e31: 0,
    e32: 0,
    e33: 1,
  });
  const caption =
    (this.skyBounds.w >= 300 ? (cycle.daylight ? 'Sunset in ' : 'Sunrise in ') : '') + timeRemaining(cycle);
  c.text(
    new Rect(f(this.skyBounds.x + f(168 * scale)), f(artY + f(30 * scale)), f(144 * scale), f(14 * scale)),
    caption,
    cycle.daylight ? t.text : rgba(193, 207, 215),
    clamp(f(13 * scale), 8, 10),
    false,
    Align.Center,
  );
  if (this.skyHovered) {
    const ink = { ...t.accent, a: 140 };
    c.line(
      this.skyBounds.x + 12,
      f(f(artY + f(48 * scale)) - 2),
      f(f(this.skyBounds.x + this.skyBounds.w) - 12),
      f(f(artY + f(48 * scale)) - 2),
      ink,
      0.8,
    );
  }
  if (Math.abs(f(this.timeReveal - target)) > f(0.001)) c.requestAnimationFrame();
}
export function calendarDetails(this: GameHudApp, width: number): void {
  if (!this.skyHovered || this.touchMode) return;
  const c = this.context,
    t = this.theme,
    date = this.town.calendar(),
    sky = this.town.climate(),
    w = Math.min(288, width - 24),
    panel = new Rect(f(f(width - w) / 2), f(f(this.skyBounds.y + this.skyBounds.h) + 10), w, 154);
  c.rect(new Rect(panel.x, panel.y + 3, panel.w, panel.h), rgba(0, 0, 0, 70), t.radius);
  c.rect(panel, { ...t.raised, a: 255 }, t.radius, t.border);
  c.line(panel.x + 12, panel.y, f(f(panel.x + panel.w) - 12), panel.y, { ...t.accent, a: 150 });
  const labels = ['Day', 'Month', 'Year'],
    values = [date.day, date.month, date.year];
  for (let i = 0; i < 3; i++) {
    const x = f(f(panel.x + 16) + f(f(i * f(w - 32)) / 3));
    c.text(new Rect(x, panel.y + 8, f(f(w - 32) / 3), 14), labels[i], t.muted, 10);
    c.text(new Rect(x, panel.y + 23, f(f(w - 32) / 3), 20), String(values[i]), t.text, 15, true);
  }
  c.line(panel.x + 16, panel.y + 49, f(f(panel.x + w) - 16), panel.y + 49, t.border);
  const clock = timeOfDay(this.town.dayFraction());
  c.text(new Rect(panel.x + 16, panel.y + 56, f(f(w / 2) - 24), 14), 'Season', t.muted, 10);
  c.text(
    new Rect(panel.x + 16, panel.y + 72, f(f(w / 2) - 24), 18),
    seasonName(date.season),
    t.text,
    12,
    true,
  );
  c.text(new Rect(f(f(panel.x + f(w / 2)) + 8), panel.y + 56, f(f(w / 2) - 24), 14), 'Time', t.muted, 10);
  c.text(new Rect(f(f(panel.x + f(w / 2)) + 8), panel.y + 72, f(f(w / 2) - 24), 18), clock, t.text, 12, true);
  const weather = weatherName(sky.weather) + '  ·  ' + lround(sky.temperature) + '°C';
  c.text(new Rect(panel.x + 16, panel.y + 101, w - 32, 16), weather, t.muted, 11, false, Align.Center);
  c.line(panel.x + 16, panel.y + 124, f(f(panel.x + w) - 16), panel.y + 124, t.border);
  const cycle = dayCycle(this.town.yearFraction(), this.town.dayFraction());
  c.text(new Rect(panel.x + 16, panel.y + 132, 48, 14), 'Sunrise', t.muted, 10);
  c.text(new Rect(panel.x + 66, panel.y + 132, 48, 14), timeOfDay(cycle.sunrise), t.text, 11, true);
  c.text(new Rect(f(f(panel.x + f(w / 2)) + 8), panel.y + 132, 48, 14), 'Sunset', t.muted, 10);
  c.text(
    new Rect(f(f(panel.x + f(w / 2)) + 58), panel.y + 132, 48, 14),
    timeOfDay(cycle.sunset),
    t.text,
    11,
    true,
  );
}
export function timeControls(this: GameHudApp, width: number): void {
  const c = this.context,
    t = this.theme,
    step = this.touchMode ? 46 : controlStep,
    fullWidth = this.touchMode ? 6 * step + 8 : panelWidth;
  if (this.timeReveal > 0) {
    const below = width < 900,
      right = below ? width - 16 : this.timeToggleBounds.x - 8,
      full = new Rect(right - fullWidth, below ? 62 : 12, fullWidth, this.touchMode ? 52 : 36);
    c.clip(this.timePanelBounds, () => {
      c.control('time-controls-panel', this.timePanelBounds, undefined, true, false);
      c.rect(full, t.surface, t.radius, t.border);
      const labels = ['||', '1x', '2x', '3x', '4x', '5x'];
      for (let i = 0; i <= 5; i++)
        button(
          c,
          'speed-' + labels[i],
          new Rect(full.x + 4 + i * step, full.y + 4, this.touchMode ? 44 : controlStep - 4, this.touchMode ? 44 : 28),
          labels[i],
          () => {
            if (i) this.setSpeed(i);
            else this.togglePause();
          },
          this.gameSpeed() === i ? ButtonStyle.Primary : ButtonStyle.Default,
          this.timeExpanded,
          Icon.None,
          false,
          { fontSize: 11 },
        );
    });
  }
  const toggle = button(
      c,
      'speed-toggle',
      this.timeToggleBounds,
      '',
      () => {
        this.timeExpanded = !this.timeExpanded;
      },
      this.timeExpanded ? ButtonStyle.Primary : ButtonStyle.Default,
    ),
    ink = this.timeExpanded ? t.accentText : t.text,
    bounds = this.timeToggleBounds;
  c.paint(JSON.stringify(['time-hourglass', bounds, ink]), () => {
    const shape = new c.tvg.Shape(),
      x = bounds.x + 14,
      y = bounds.y + 8;
    shape
      .moveTo(x, y)
      .lineTo(x + 12, y)
      .lineTo(x + 12, y + 3)
      .lineTo(x + 7, y + 9)
      .lineTo(x + 7, y + 11)
      .lineTo(x + 12, y + 17)
      .lineTo(x + 12, y + 20)
      .lineTo(x, y + 20)
      .lineTo(x, y + 17)
      .lineTo(x + 5, y + 11)
      .lineTo(x + 5, y + 9)
      .lineTo(x, y + 3)
      .close()
      .moveTo(x + 3, y + 17)
      .lineTo(x + 9, y + 17)
      .fill(0, 0, 0, 0)
      .stroke(1.2)
      .stroke({ color: [ink.r, ink.g, ink.b, ink.a] });
    return shape;
  });
  const x = this.timeToggleBounds.x + 6,
    y = this.timeToggleBounds.y + 18;
  c.line(x + (this.timeExpanded ? 0 : 3), y - 3, x + (this.timeExpanded ? 3 : 0), y, ink, 1.2);
  c.line(x + (this.timeExpanded ? 3 : 0), y, x + (this.timeExpanded ? 0 : 3), y + 3, ink, 1.2);
  if (toggle.hovered && !this.timeExpanded && !this.touchMode) {
    const hint = new Rect(this.timeToggleBounds.x - 58, 56, 94, 26);
    c.rect(hint, t.raised, t.radius, t.border);
    c.text(hint, 'Time controls', t.text, 10, false, Align.Center);
  }
}

// Translated from src/game/visibility_map.h and visibility_map.cpp.
import type { Point } from './geometry';
import type { Sight } from './world-types';
import { clamp, f32 as f } from './numeric';
export interface VisibilityBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}
export class VisibilityRegion {
  constructor(
    public left = 0,
    public top = 0,
    public right = 0,
    public bottom = 0,
  ) {}
  empty(): boolean {
    return this.left >= this.right || this.top >= this.bottom;
  }
  include(other: VisibilityRegion): void {
    if (other.empty()) return;
    if (this.empty()) {
      this.left = other.left;
      this.top = other.top;
      this.right = other.right;
      this.bottom = other.bottom;
      return;
    }
    this.left = Math.min(this.left, other.left);
    this.top = Math.min(this.top, other.top);
    this.right = Math.max(this.right, other.right);
    this.bottom = Math.max(this.bottom, other.bottom);
  }
}
const sameSight = (a: Sight, b: Sight): boolean =>
  a.center.x === b.center.x && a.center.y === b.center.y && a.radius === b.radius;
export class VisibilityMap {
  private mask = new Uint8Array();
  private scratch = new Uint8Array();
  private assignedSources: Sight[] = [];
  private area: VisibilityBounds = { x: 0, y: 0, w: 0, h: 0 };
  private cols = 0;
  private lines = 0;
  private version = 0;
  private assigned = false;
  reset(width: number, height: number, padding = 16, maxDimension = 512): void {
    width = Math.trunc(width);
    height = Math.trunc(height);
    padding = f(padding);
    maxDimension >>>= 0;
    this.assigned = false;
    this.assignedSources = [];
    padding = Number.isFinite(padding) ? Math.max(0, padding) : 0;
    const spanWidth = f(width + f(padding * 2)),
      spanHeight = f(height + f(padding * 2));
    if (width <= 0 || height <= 0 || !Number.isFinite(spanWidth) || !Number.isFinite(spanHeight)) {
      this.cols = this.lines = 0;
      this.area = { x: 0, y: 0, w: 0, h: 0 };
      this.mask = new Uint8Array();
      this.scratch = new Uint8Array();
    } else {
      this.area = { x: -padding, y: -padding, w: spanWidth, h: spanHeight };
      maxDimension = clamp(maxDimension, 1, 1024);
      const longest = Math.max(this.area.w, this.area.h);
      this.cols = clamp(Math.ceil(f(maxDimension * f(this.area.w / longest))), 1, maxDimension);
      this.lines = clamp(Math.ceil(f(maxDimension * f(this.area.h / longest))), 1, maxDimension);
      this.mask = new Uint8Array(this.cols * this.lines);
      this.scratch = new Uint8Array(this.mask.length);
    }
    ++this.version;
  }
  clear(): boolean {
    this.assigned = false;
    this.assignedSources = [];
    if (!this.mask.some((alpha) => alpha !== 0)) return false;
    this.mask.fill(0);
    ++this.version;
    return true;
  }
  private extent(sight: Sight): VisibilityRegion {
    if (
      !this.cols ||
      !this.lines ||
      !Number.isFinite(sight.center.x) ||
      !Number.isFinite(sight.center.y) ||
      !Number.isFinite(sight.radius) ||
      sight.radius <= 0
    )
      return new VisibilityRegion();
    const scaleX = this.cols / this.area.w,
      scaleY = this.lines / this.area.h;
    const first = (coordinate: number, count: number) => clamp(Math.floor(coordinate), 0, count);
    const last = (coordinate: number, count: number) => clamp(Math.ceil(coordinate), -1, count - 1);
    return new VisibilityRegion(
      first((sight.center.x - sight.radius - this.area.x) * scaleX, this.cols),
      first((sight.center.y - sight.radius - this.area.y) * scaleY, this.lines),
      last((sight.center.x + sight.radius - this.area.x) * scaleX, this.cols) + 1,
      last((sight.center.y + sight.radius - this.area.y) * scaleY, this.lines) + 1,
    );
  }
  private rasterize(
    target: Uint8Array,
    sight: Sight,
    clip: VisibilityRegion,
    updates?: VisibilityRegion,
  ): boolean {
    const region = this.extent(sight);
    region.left = Math.max(region.left, clip.left);
    region.top = Math.max(region.top, clip.top);
    region.right = Math.min(region.right, clip.right);
    region.bottom = Math.min(region.bottom, clip.bottom);
    if (!target.length || region.empty()) return false;
    const stepX = f(this.area.w / this.cols),
      stepY = f(this.area.h / this.lines),
      inverseRadius = f(1 / Math.max(sight.radius, 1.1754943508222875e-38));
    let changed = false;
    for (let y = region.top; y < region.bottom; ++y) {
      const dy = f(f(f(this.area.y + f(f(y + f(0.5)) * stepY)) - sight.center.y) * inverseRadius),
        dy2 = f(dy * dy);
      if (dy2 >= 1) continue;
      const row = y * this.cols;
      for (let x = region.left; x < region.right; ++x) {
        if (target[row + x] === 255) continue;
        const dx = f(f(f(this.area.x + f(f(x + f(0.5)) * stepX)) - sight.center.x) * inverseRadius),
          distance2 = f(f(dx * dx) + dy2);
        if (distance2 >= 1) continue;
        let alpha = 255;
        if (distance2 > f(f(0.7) * f(0.7))) {
          const t = f(Math.sqrt(distance2));
          const value =
            t < f(0.86)
              ? f(255 - f(f(t - f(0.7)) * f(145 / f(0.16))))
              : f(110 - f(f(t - f(0.86)) * f(110 / f(0.14))));
          alpha = Math.trunc(clamp(f(value + f(0.5)), 0, 255));
        }
        if (alpha > target[row + x]) {
          target[row + x] = alpha;
          changed = true;
        }
      }
    }
    if (changed && updates) updates.include(region);
    return changed;
  }
  stamp(sight: Sight, updates = new VisibilityRegion()): boolean {
    this.assigned = false;
    const changed = this.rasterize(
      this.mask,
      sight,
      new VisibilityRegion(0, 0, this.cols, this.lines),
      updates,
    );
    if (changed) ++this.version;
    return changed;
  }
  append(sights: readonly Sight[]): boolean {
    this.assigned = false;
    let changed = false;
    for (const sight of sights)
      changed =
        this.rasterize(this.mask, sight, new VisibilityRegion(0, 0, this.cols, this.lines)) || changed;
    if (changed) ++this.version;
    return changed;
  }
  assign(sights: readonly Sight[], updates = new VisibilityRegion()): boolean {
    if (
      this.assigned &&
      sights.length === this.assignedSources.length &&
      sights.every((sight, i) => sameSight(sight, this.assignedSources[i]))
    )
      return false;
    const dirty = new VisibilityRegion();
    if (!this.assigned) {
      dirty.right = this.cols;
      dirty.bottom = this.lines;
    } else
      for (let i = 0; i < Math.max(sights.length, this.assignedSources.length); ++i) {
        if (
          i < sights.length &&
          i < this.assignedSources.length &&
          sameSight(sights[i], this.assignedSources[i])
        )
          continue;
        if (i < sights.length) dirty.include(this.extent(sights[i]));
        if (i < this.assignedSources.length) dirty.include(this.extent(this.assignedSources[i]));
      }
    let changed = false;
    if (!dirty.empty()) {
      for (let y = dirty.top; y < dirty.bottom; ++y)
        this.scratch.fill(0, y * this.cols + dirty.left, y * this.cols + dirty.right);
      for (const sight of sights) this.rasterize(this.scratch, sight, dirty);
      for (let y = dirty.top; y < dirty.bottom; ++y) {
        const first = y * this.cols + dirty.left,
          last = y * this.cols + dirty.right;
        let equal = true;
        for (let x = first; x < last; ++x)
          if (this.mask[x] !== this.scratch[x]) {
            equal = false;
            break;
          }
        if (equal) continue;
        this.mask.set(this.scratch.subarray(first, last), first);
        changed = true;
      }
    }
    if (changed) {
      ++this.version;
      updates.include(dirty);
    }
    this.assignedSources = sights.map((sight) => ({ center: { ...sight.center }, radius: sight.radius }));
    this.assigned = true;
    return changed;
  }
  sample(position: Point): number {
    const area = this.area;
    if (
      !this.mask.length ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y) ||
      position.x < area.x ||
      position.y < area.y ||
      position.x >= f(area.x + area.w) ||
      position.y >= f(area.y + area.h)
    )
      return 0;
    const x = clamp(f(f(f(f(position.x - area.x) / area.w) * this.cols) - f(0.5)), 0, this.cols - 1),
      y = clamp(f(f(f(f(position.y - area.y) / area.h) * this.lines) - f(0.5)), 0, this.lines - 1);
    const x0 = Math.trunc(x),
      y0 = Math.trunc(y),
      x1 = Math.min(x0 + 1, this.cols - 1),
      y1 = Math.min(y0 + 1, this.lines - 1);
    const tx = f(x - x0),
      ty = f(y - y0);
    const top = f(f(this.mask[y0 * this.cols + x0] * f(1 - tx)) + f(this.mask[y0 * this.cols + x1] * tx));
    const bottom = f(f(this.mask[y1 * this.cols + x0] * f(1 - tx)) + f(this.mask[y1 * this.cols + x1] * tx));
    return Math.trunc(f(f(f(top * f(1 - ty)) + f(bottom * ty)) + f(0.5)));
  }
  coverage(): Readonly<Uint8Array> {
    return this.mask;
  }
  columns(): number {
    return this.cols;
  }
  rows(): number {
    return this.lines;
  }
  bounds(): VisibilityBounds {
    return { ...this.area };
  }
  revision(): number {
    return this.version;
  }
}

import type { LottieAnimation, Picture } from '@thorvg/webcanvas';
import folder from '../assets/folder.json';
import check from '../assets/check.json';
import chevronRight from '../assets/chevron-right.json';
import chevronLeft from '../assets/chevron-left.json';
import type { Color, IconState, WebCanvas } from './types';
import { IconPoses } from './icon-poses';

export interface IconAsset {
  name: string;
  data: string;
  mime?: string;
  tint?: boolean;
  duration?: number;
  markers?: readonly string[];
}
interface Drawing {
  asset: IconAsset;
  picture: Picture;
  animation?: LottieAnimation;
  frames: number[];
  color: string;
  slot: number;
  seen: boolean;
  target: number;
  poses?: IconPoses;
  overshoots: number[];
  started: number;
  duration: number;
  moving: boolean;
  overshooting: boolean;
  settling: boolean;
}
const poses = ['idle', 'hover', 'pressed', 'active', 'disabled', 'focused'];
const normalizedName = (name: string) => (name === 'chevron' ? 'chevron-right' : name);
const pose = (s: IconState) =>
  !s.enabled ? 4 : s.pressed ? 2 : s.active ? 3 : s.hovered ? 1 : s.focused ? 5 : 0;
const builtinData: Record<string, unknown> = {
  folder,
  check,
  'chevron-right': chevronRight,
  'chevron-left': chevronLeft,
};

/** Native authored icon assets. Static SVGs and all Lottie marker poses are retained. */
export class Icons {
  private readonly builtins = new Map<string, IconAsset>();
  private users = new Map<string, IconAsset>();
  private readonly instances = new Map<string, Drawing>();
  error = '';
  private now = 0;
  constructor(private readonly tvg: WebCanvas) {
    for (const [name, data] of Object.entries(builtinData))
      this.builtins.set(name, {
        name,
        data: JSON.stringify(data),
        mime: 'lot',
        tint: true,
        duration: 0.16,
        markers: poses,
      });
  }
  private load(asset: IconAsset): Drawing {
    if (!asset.name || !asset.data || asset.data.includes('\0'))
      throw new Error(`Icon '${asset.name}': empty or invalid image data`);
    if (!Number.isFinite(asset.duration ?? 0.16) || (asset.duration ?? 0.16) < 0)
      throw new Error(`Icon '${asset.name}': duration must be finite and nonnegative`);
    const rawMime = asset.mime?.toLowerCase() ?? '',
      mime = !rawMime
        ? asset.data.trimStart().startsWith('<')
          ? 'svg'
          : 'lot'
        : ['svg', 'svg+xml', 'image/svg+xml'].includes(rawMime)
          ? 'svg'
          : ['lot', 'json', 'lottie', 'lottie+json', 'application/json', 'application/lottie+json'].includes(
                rawMime,
              )
            ? 'lot'
            : '';
    if (!mime) throw new Error(`Icon '${asset.name}': expected SVG or Lottie JSON`);
    let animation: LottieAnimation | undefined,
      picture: Picture | undefined,
      snapshots: IconPoses | undefined;
    try {
      if (mime === 'lot') {
        const data = JSON.parse(asset.data) as { ip?: unknown };
        if (data.ip !== undefined && (typeof data.ip !== 'number' || data.ip !== 0))
          throw new Error(`Icon '${asset.name}': Lottie root ip must be numeric zero (or omitted)`);
        snapshots = new IconPoses(asset.data);
        animation = new this.tvg.LottieAnimation().load(snapshots.data);
        picture = animation.picture ?? undefined;
      } else picture = new this.tvg.Picture().load(asset.data, { type: 'svg' });
      if (!picture) throw new Error(`Icon '${asset.name}': cannot load image data`);
      const size = picture.size();
      if (
        !Number.isFinite(size.width) ||
        !Number.isFinite(size.height) ||
        size.width <= 0 ||
        size.height <= 0
      )
        throw new Error(`Icon '${asset.name}': invalid image dimensions or content`);
      const markers = new Map<string, number>();
      if (animation) {
        const info = animation.info();
        if (!info || info.totalFrames <= 0 || info.duration <= 0)
          throw new Error(`Icon '${asset.name}': invalid animation duration`);
        for (let i = 0; i < animation.markersCnt(); i++) {
          const marker = animation.marker(i);
          if (
            !marker ||
            !Number.isFinite(marker.begin) ||
            !Number.isFinite(marker.end) ||
            marker.begin < 0 ||
            marker.begin >= info.totalFrames ||
            marker.end < marker.begin
          )
            throw new Error(`Icon '${asset.name}': invalid pose marker range`);
          if (markers.has(marker.name)) throw new Error(`Icon '${asset.name}': duplicate pose marker name`);
          markers.set(marker.name, marker.begin);
        }
      }
      const aliases = asset.markers ?? poses;
      if (aliases.length !== 6) throw new Error(`Icon '${asset.name}': expected six pose aliases`);
      aliases.forEach((alias, i) => {
        if (alias && alias !== poses[i] && !markers.has(alias))
          throw new Error(`Icon '${asset.name}': unknown pose marker '${alias}'`);
      });
      const fallback = markers.get(aliases[0]) ?? 0,
        frames = aliases.map((name) => markers.get(name) ?? fallback);
      const overshoots = aliases.map((name, i) =>
        markers.has(name) && (i === 1 || i === 3 || i === 5) && markers.has(name + '-overshoot')
          ? markers.get(name + '-overshoot')!
          : frames[i],
      );
      return {
        asset,
        picture,
        animation,
        frames,
        color: '',
        slot: 0,
        seen: false,
        target: 0,
        poses: snapshots,
        overshoots,
        started: 0,
        duration: 0,
        moving: false,
        overshooting: false,
        settling: false,
      };
    } catch (error) {
      if (animation) animation.dispose();
      else picture?.dispose();
      throw error;
    }
  }
  private release(drawing: Drawing): void {
    if (drawing.animation) {
      drawing.poses?.dispose(drawing.animation);
      if (drawing.slot) drawing.animation.del(drawing.slot);
      drawing.animation.dispose();
    } else drawing.picture.dispose();
  }
  replace(assets: readonly IconAsset[]): boolean {
    this.error = '';
    const next = new Map<string, IconAsset>();
    try {
      for (const source of assets) {
        const asset = { ...source, name: normalizedName(source.name) };
        if (next.has(asset.name)) throw new Error(`Duplicate icon name '${asset.name}'`);
        const previous = this.users.get(asset.name);
        if (previous && JSON.stringify(previous) === JSON.stringify(asset)) {
          next.set(asset.name, previous);
          continue;
        }
        const candidate = this.load(asset);
        this.release(candidate);
        next.set(asset.name, asset);
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      return false;
    }
    this.users = next;
    return true;
  }
  begin(seconds: number): void {
    if (Number.isFinite(seconds)) this.now = Math.max(this.now, seconds);
    for (const drawing of this.instances.values()) drawing.seen = false;
  }
  picture(
    instance: string,
    name: string,
    state: IconState,
    color: Color,
    prepare: (picture: Picture) => void,
  ): Picture | null {
    if (!instance) return null;
    name = normalizedName(name);
    const asset = this.users.get(name) ?? this.builtins.get(name);
    if (!asset) return null;
    let drawing = this.instances.get(instance);
    if (!drawing || drawing.asset !== asset) {
      const next = this.load(asset);
      next.target = next.frames[pose(state)];
      if (next.animation) next.poses?.frame(next.animation, next.target);
      if (drawing) this.release(drawing);
      drawing = next;
      this.instances.set(instance, drawing);
    }
    prepare(drawing.picture);
    drawing.seen = true;
    this.tick(drawing);
    this.state(drawing, state);
    const key = JSON.stringify(color);
    if (asset.tint !== false && drawing.color !== key) {
      if (drawing.animation) {
        if (drawing.slot) drawing.animation.del(drawing.slot);
        drawing.slot = drawing.animation.gen({
          'icon-ink': { p: { a: 0, k: [color.r / 255, color.g / 255, color.b / 255] } },
        });
        if (drawing.slot) drawing.animation.apply(drawing.slot);
      } else {
        const ink = `rgb(${color.r},${color.g},${color.b})`;
        // Source UI SVG icons author explicit fill/stroke attributes; retain
        // geometry, opacity, paint order and all "none" paints unchanged.
        const tinted = asset.data.replace(
          /\b(fill|stroke)\s*=\s*(["'])([^"']*)\2/g,
          (match, attribute: string, quote: string, value: string) =>
            value === 'none' ? match : `${attribute}=${quote}${ink}${quote}`,
        );
        drawing.picture.load(tinted, { type: 'svg' });
      }
      drawing.picture.opacity(color.a);
      drawing.color = key;
    }
    return drawing.picture;
  }
  end(): void {
    for (const [id, drawing] of this.instances)
      if (!drawing.seen) {
        this.release(drawing);
        this.instances.delete(id);
      }
  }
  private tick(drawing: Drawing): void {
    if (!drawing.moving || !drawing.animation || !drawing.poses) return;
    let progress = Math.max(0, Math.min(1, (this.now - drawing.started) / drawing.duration));
    if (progress === 1) {
      drawing.poses.frame(drawing.animation, drawing.target);
      drawing.moving = drawing.overshooting = drawing.settling = false;
      return;
    }
    if (drawing.overshooting && progress >= 0.55) {
      drawing.poses.tween(drawing.animation, 1);
      drawing.poses.tweenTo(drawing.target);
      drawing.overshooting = false;
      drawing.settling = true;
    }
    if (drawing.overshooting) progress /= 0.55;
    else if (drawing.settling) progress = (progress - 0.55) / 0.45;
    const eased = Math.fround(
      drawing.overshooting ? 1 - Math.pow(1 - progress, 3) : progress * progress * (3 - 2 * progress),
    );
    drawing.poses.tween(drawing.animation, eased);
  }
  private state(drawing: Drawing, state: IconState): void {
    if (!drawing.animation || !drawing.poses) return;
    const index = pose(state),
      next = drawing.frames[index];
    if (next === drawing.target) return;
    this.tick(drawing);
    drawing.target = next;
    drawing.overshooting = drawing.overshoots[index] !== drawing.target;
    drawing.settling = false;
    const seconds = drawing.overshooting
      ? index === 1
        ? 0.28
        : index === 3
          ? 0.32
          : 0.24
      : index === 2
        ? 0.12
        : index === 0
          ? 0.2
          : 0.16;
    drawing.duration = (seconds * Math.fround(drawing.asset.duration ?? 0.16)) / 0.16;
    if (drawing.duration === 0) {
      drawing.poses.frame(drawing.animation, drawing.target);
      drawing.moving = drawing.overshooting = false;
    } else {
      drawing.poses.tweenTo(drawing.overshooting ? drawing.overshoots[index] : drawing.target);
      drawing.started = this.now;
      drawing.moving = true;
      drawing.poses.tween(drawing.animation, 0);
    }
  }
  animating(): boolean {
    return [...this.instances.values()].some((drawing) => drawing.moving);
  }
  destroy(): void {
    for (const drawing of this.instances.values()) this.release(drawing);
    this.instances.clear();
  }
}

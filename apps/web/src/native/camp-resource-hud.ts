import type { Animation } from '@thorvg/webcanvas';
import { Context, Theme, Rect, Align, rgba, setTransform } from '../../../../packages/native-ui/src';
import { structureSpec } from '../../../../packages/engine/src/building-catalog';
import type { Town } from '../../../../packages/engine/src/town';
import type { Point } from '../../../../packages/engine/src/geometry';
import { f32 as f, clamp, lround } from '../../../../packages/engine/src/numeric';
import { resourceIcons, nativeFixed } from './hud-assets';
const duration = 0.75,
  names = ['Gold', 'Wood', 'Stone', 'Food', 'Water', 'Mana', 'Renown', 'Residents', 'Guests'],
  artwork = [0, 1, 2, 3, 4, 5, 8, 6, 7];
const amount = (value: number) =>
  value < 10000
    ? String(value)
    : nativeFixed(value / (value < 1000000 ? 1000 : 1000000), 1) + (value < 1000000 ? 'k' : 'm');
class Icon {
  animation: Animation | null = null;
  kind = -1;
  frame = -1;
  draw(context: Context, nextKind: number, bounds: Rect, progress = 0, opacity = 255): void {
    if (this.kind !== nextKind) {
      if (this.animation) {
        const old = this.animation;
        context.deferRelease(() => old.dispose());
      }
      this.animation = new context.tvg.Animation().load(resourceIcons[artwork[nextKind]]);
      this.kind = nextKind;
      this.frame = -1;
    }
    const total = this.animation!.info()!.totalFrames,
      next = Math.min(f(progress * total), f(total - 1));
    if (this.frame !== next) {
      this.animation!.frame(next);
      this.frame = next;
    }
    const picture = this.animation!.picture!;
    context.add(picture);
    const scale = f(bounds.w / 48);
    setTransform(picture, {
      e11: scale,
      e12: 0,
      e13: bounds.x,
      e21: 0,
      e22: scale,
      e23: bounds.y,
      e31: 0,
      e32: 0,
      e33: 1,
    });
    picture.opacity(opacity);
  }
  dispose(): void {
    this.animation?.dispose();
    this.animation = null;
  }
}
interface Pending {
  camp: number;
  kind: number;
  at: number;
}
interface Pop {
  icon: Icon;
  camp: number;
  kind: number;
  lane: number;
  started: number;
}
export interface CampMarker {
  camp: number;
  roof: Point;
}
export class CampResourceHud {
  private tipIcons = names.map(() => new Icon());
  private pops: Pop[] = Array.from({ length: 8 }, () => ({
    icon: new Icon(),
    camp: -1,
    kind: 0,
    lane: 0,
    started: -1,
  }));
  private pending: Pending[] = [];
  private nextReceipt = 0n;
  private lastTime = -1;
  private initialized = false;
  private moving = false;
  animating(): boolean {
    return this.moving;
  }
  reset(): void {
    this.initialized = this.moving = false;
    this.nextReceipt = 0n;
    this.lastTime = -1;
    this.pending = [];
    for (const pop of this.pops) {
      pop.camp = -1;
      pop.started = -1;
    }
  }
  dispose(): void {
    this.tipIcons.forEach((icon) => icon.dispose());
    this.pops.forEach((pop) => pop.icon.dispose());
  }
  draw(
    context: Context,
    theme: Theme,
    town: Town,
    markers: readonly CampMarker[],
    hovered: number,
    viewport: Rect,
    reduced: boolean,
  ): void {
    const now = context.time(),
      lifetime = reduced ? 0.5 : duration;
    if (now < this.lastTime) this.reset();
    this.lastTime = now;
    this.moving = false;
    const marker = (id: number) => markers.find((m) => m.camp === id);
    for (const pop of this.pops)
      if (pop.started >= 0 && (now >= pop.started + lifetime || !marker(pop.camp))) pop.started = -1;
    if (!this.initialized) {
      const receipts = town.receipts();
      if (receipts.length) this.nextReceipt = receipts[receipts.length - 1].serial + 1n;
      this.initialized = true;
    } else
      for (const receipt of town.receipts()) {
        if (receipt.serial < this.nextReceipt) continue;
        this.nextReceipt = receipt.serial + 1n;
        if (!marker(receipt.camp) || receipt.at + 3 < town.clock()) continue;
        const gains = [
          receipt.gain.gold,
          receipt.gain.wood,
          receipt.gain.stone,
          receipt.gain.food,
          receipt.gain.water,
          receipt.gain.mana,
          receipt.renown,
          receipt.residents,
          receipt.guests,
        ];
        for (let kind = 0; kind < gains.length; kind++) {
          if (gains[kind] <= 0) continue;
          const active = this.pops.some((p) => p.started >= 0 && p.camp === receipt.camp && p.kind === kind),
            queued = this.pending.some((p) => p.camp === receipt.camp && p.kind === kind);
          if (!active && !queued && this.pending.length < 64)
            this.pending.push({ camp: receipt.camp, kind, at: now });
        }
      }
    for (let at = 0; at < this.pending.length;) {
      const pending = this.pending[at];
      if (!marker(pending.camp) || now > pending.at + 2) {
        this.pending.splice(at, 1);
        continue;
      }
      const lanes = [false, false, false];
      let active = 0;
      for (const pop of this.pops)
        if (pop.started >= 0 && pop.camp === pending.camp) {
          lanes[pop.lane] = true;
          active++;
        }
      if (active >= 3) {
        at++;
        continue;
      }
      const free =
        this.pops.find((p) => p.started < 0 && p.icon.kind === pending.kind) ??
        this.pops.find((p) => p.started < 0);
      if (!free) break;
      free.camp = pending.camp;
      free.kind = pending.kind;
      free.lane = lanes.indexOf(false);
      free.started = now + (reduced ? 0 : active * 0.06);
      this.pending.splice(at, 1);
    }
    context.clip(viewport, () => {
      const offsets = [0, -28, 28];
      for (const pop of this.pops) {
        if (pop.started < 0) continue;
        this.moving = true;
        if (now < pop.started) continue;
        const anchor = marker(pop.camp);
        if (!anchor) continue;
        const progress = f(clamp((now - pop.started) / lifetime, 0, 1)),
          eased = f(1 - f(Math.pow(f(1 - progress), 3))),
          rise = reduced ? 0 : f(24 * eased),
          fade = reduced ? 1 : f(1 - f(Math.pow(clamp(f(f(progress - f(0.65)) / f(0.35)), 0, 1), 2))),
          x = f(anchor.roof.x + offsets[pop.lane]),
          y = f(f(anchor.roof.y - 12) - rise);
        if (context.controlAt(x, y)) continue;
        pop.icon.draw(
          context,
          pop.kind,
          new Rect(x - 14, y - 14, 28, 28),
          reduced ? 0 : progress,
          lround(f(255 * fade)),
        );
      }
    });
    this.moving = this.moving || this.pending.length > 0;
    if (this.moving) context.requestAnimationFrame();
    const anchor = marker(hovered),
      seat = town.camp(hovered);
    if (!anchor || !seat || viewport.w < 240 || viewport.h < 145) return;
    const stock = town.stock(hovered),
      capacity = town.capacity(hovered),
      values = [
        stock.gold,
        stock.wood,
        stock.stone,
        stock.food,
        stock.water,
        stock.mana,
        town.renown(hovered),
        town.population(hovered),
        town.guests(hovered),
      ],
      limits = [
        0,
        capacity.wood,
        capacity.stone,
        capacity.food,
        capacity.water,
        0,
        100,
        town.housing(hovered),
        town.guestBeds(hovered),
      ],
      w = Math.min(336, viewport.w),
      row = viewport.h < 184 ? 36 : 46,
      h = f(36 + f(row * 3));
    let x = f(anchor.roof.x + 30);
    if (f(x + w) > f(viewport.x + viewport.w)) x = f(f(anchor.roof.x - w) - 30);
    x = clamp(x, viewport.x, f(f(viewport.x + viewport.w) - w));
    const y = clamp(f(anchor.roof.y - 28), viewport.y, f(f(viewport.y + viewport.h) - h)),
      panel = new Rect(x, y, w, h),
      fill = { ...theme.raised, a: 255 };
    context.rect(new Rect(x, y + 3, w, h), rgba(0, 0, 0, 75), theme.radius);
    context.rect(panel, fill, theme.radius, theme.border);
    context.text(
      new Rect(x + 12, y + 5, f(w * f(0.55)), 24),
      structureSpec(seat.kind).name + ' #' + (hovered + 1),
      theme.text,
      13,
      true,
    );
    context.text(
      new Rect(f(x + f(w * f(0.55))), y + 5, f(f(w * f(0.45)) - 12), 24),
      'Village stores',
      theme.muted,
      10,
      false,
      Align.End,
    );
    context.line(x + 12, y + 32, f(f(x + w) - 12), y + 32, theme.border);
    for (let i = 0; i < names.length; i++) {
      const cell = f(f(w - 16) / 3),
        box = new Rect(f(f(x + 8) + f((i % 3) * cell)), f(f(y + 34) + f(Math.trunc(i / 3) * row)), cell, row),
        size = row < 40 ? 22 : 28;
      this.tipIcons[i].draw(context, i, new Rect(box.x + 2, f(box.y + f(f(row - size) / 2)), size, size));
      const textX = f(f(box.x + size) + 6),
        textWidth = f(f(f(box.x + cell) - textX) - 4);
      context.text(new Rect(textX, box.y + (row < 40 ? 1 : 5), textWidth, 14), names[i], theme.muted, 9);
      let value = amount(values[i]);
      if (limits[i] || (i > 0 && i < 5) || i >= 7) value += ' / ' + amount(limits[i]);
      context.text(
        new Rect(textX, box.y + (row < 40 ? 15 : 20), textWidth, 19),
        value,
        i === 6 ? theme.accent : theme.text,
        11,
        true,
      );
      if (i === 6) context.line(x + 12, box.y - 1, f(f(x + w) - 12), box.y - 1, theme.border);
    }
  }
}

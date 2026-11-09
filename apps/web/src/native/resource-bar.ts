import type { Animation } from '@thorvg/webcanvas';
import { Context, Theme, Rect, Align, rgba, setTransform } from '../../../../packages/native-ui/src';
import type { Resources } from '../../../../packages/engine/src/building-catalog';
import { f32 as f, clamp } from '../../../../packages/engine/src/numeric';
import { resourceIcons, nativeFixed } from './hud-assets';
const gainDuration = 0.7,
  names = ['Gold', 'Wood', 'Stone', 'Food', 'Water', 'Mana', 'Residents', 'Guests', 'Renown'];
const colors = [
  rgba(247, 198, 92),
  rgba(214, 155, 98),
  rgba(184, 199, 216),
  rgba(239, 189, 116),
  rgba(108, 200, 238),
  rgba(200, 161, 255),
  rgba(162, 215, 179),
  rgba(244, 177, 117),
  rgba(244, 198, 103),
];
const signedAmount = (value: number) => (value >= 0 ? '+' : '') + value;
export function compact(value: number): string {
  if (Math.abs(value) < 10000) return String(value);
  const unit = Math.abs(value) < 1000000 ? 'k' : 'm',
    number = value / (unit === 'k' ? 1000 : 1000000);
  return nativeFixed(number, Math.abs(number) < 100 ? 1 : 0) + unit;
}
const smoothstep = (value: number) => {
    const t = clamp(value, 0, 1);
    return f(f(t * t) * f(3 - f(2 * t)));
  },
  outCubic = (value: number) => {
    const t = f(1 - clamp(value, 0, 1));
    return f(1 - f(f(t * t) * t));
  };
interface Slot {
  animation: Animation | null;
  observed: number;
  gained: number;
  started: number;
  frame: number;
}
export interface ResourcePopulation {
  residents: number;
  housing: number;
  guests: number;
  guestBeds: number;
}
export class ResourceBar {
  private slots: Slot[] = names.map(() => ({
    animation: null,
    observed: 0,
    gained: 0,
    started: -1,
    frame: -1,
  }));
  private initialized = false;
  private moving = false;
  private lastTime = -1;
  private hovered = -1;
  private bounds = new Rect();
  private hoveredCell = new Rect();
  private description = '';
  animating(): boolean {
    return this.moving;
  }
  dispose(): void {
    for (const slot of this.slots) {
      slot.animation?.dispose();
      slot.animation = null;
    }
  }
  reset(): void {
    this.initialized = this.moving = false;
    this.hovered = -1;
    this.lastTime = -1;
    for (const slot of this.slots) {
      slot.started = -1;
      slot.gained = 0;
    }
  }
  draw(
    context: Context,
    theme: Theme,
    bounds: Rect,
    stock: Resources,
    capacity: Resources,
    population: ResourcePopulation,
    renown: number,
    goldPerDay: number,
    manaPerDay: number,
    reducedMotion: boolean,
  ): void {
    const now = context.time();
    if (now < this.lastTime) this.reset();
    const values = [
        stock.gold,
        stock.wood,
        stock.stone,
        stock.food,
        stock.water,
        stock.mana,
        population.residents,
        population.guests,
        renown,
      ],
      limits = [
        0,
        capacity.wood,
        capacity.stone,
        capacity.food,
        capacity.water,
        0,
        population.housing,
        population.guestBeds,
        100,
      ];
    this.lastTime = now;
    this.bounds = bounds;
    this.hovered = -1;
    this.moving = false;
    context.rect(bounds, theme.surface, theme.radius, theme.border);
    const rowHeight = f(f(bounds.h - 12) / this.slots.length),
      compactRows = bounds.w < 120 || rowHeight < 36;
    let stagger = 0;
    for (let row = 0; row < this.slots.length; row++) {
      const i = (row + this.slots.length - 1) % this.slots.length,
        slot = this.slots[i];
      slot.animation ??= new context.tvg.Animation().load(resourceIcons[i]);
      if (slot.started >= 0 && now >= slot.started + gainDuration) {
        slot.started = -1;
        slot.gained = 0;
      }
      const delta = values[i] - slot.observed;
      if (this.initialized && delta > 0) {
        if (slot.started < 0) slot.started = now + (reducedMotion ? 0 : 0.035 * stagger++);
        slot.gained += delta;
      } else if (delta < 0) {
        slot.started = -1;
        slot.gained = 0;
      }
      slot.observed = values[i];
      const cell = new Rect(
          f(bounds.x + 6),
          f(f(bounds.y + 6) + f(row * rowHeight)),
          f(bounds.w - 12),
          rowHeight,
        ),
        hover = context.control('resource-' + names[i], cell, undefined, true, false);
      if (hover.hovered) {
        this.hovered = i;
        this.hoveredCell = cell;
        context.rect(cell.inset(3), theme.raised, theme.radius);
        this.description = names[i] + '  ' + values[i];
        if (i > 0 && i < 5) this.description += ' / ' + limits[i] + ' capacity';
        if (i === 6) this.description += ' / ' + limits[i] + ' housing';
        if (i === 7) this.description += ' / ' + limits[i] + ' beds';
        if (i === 8) this.description += ' / 100 settlement reputation';
        if (i === 0 || i === 5)
          this.description += '  (' + signedAmount(i === 0 ? goldPerDay : manaPerDay) + '/day)';
      }
      const active = slot.started >= 0 && now >= slot.started,
        progress = active ? f(clamp((now - slot.started) / gainDuration, 0, 1)) : 0,
        total = slot.animation.info()!.totalFrames,
        frame = active && !reducedMotion ? Math.min(f(progress * total), f(total - 1)) : 0,
        picture = slot.animation.picture!;
      context.add(picture);
      if (slot.frame !== frame) {
        slot.animation.frame(frame);
        slot.frame = frame;
      }
      const iconSize = Math.min(f(cell.h - 4), compactRows ? 30 : 42),
        iconX = cell.x,
        iconY = f(cell.y + f(f(cell.h - iconSize) / 2)),
        scale = f(iconSize / 48);
      setTransform(picture, {
        e11: scale,
        e12: 0,
        e13: iconX,
        e21: 0,
        e22: scale,
        e23: iconY,
        e31: 0,
        e32: 0,
        e33: 1,
      });
      const textX = f(f(cell.x + iconSize) + (compactRows ? 4 : 6)),
        captionWidth = compactRows ? 0 : f(cell.w * f(0.36)),
        showCaption = cell.h >= 26,
        value = new Rect(
          textX,
          f(cell.y + (compactRows ? Math.max(0, f(f(cell.h - (showCaption ? 28 : 15)) / 2)) : 17)),
          f(f(f(cell.x + cell.w) - textX) - captionWidth),
          compactRows ? 15 : 19,
        );
      let color = i > 0 && i < 5 && values[i] >= limits[i] ? theme.danger : theme.text;
      if (i === 8) color = theme.accent;
      if (!compactRows)
        context.text(
          new Rect(textX, cell.y + 3, f(f(cell.x + cell.w) - textX), 14),
          names[i],
          theme.muted,
          10,
        );
      const amount = compact(values[i]);
      let valueSize = compactRows ? 11 : 15;
      valueSize = Math.max(
        9,
        Math.min(
          valueSize,
          f(f(valueSize * value.w) / Math.max(1, context.textWidth(amount, valueSize, true))),
        ),
      );
      context.text(value, amount, color, valueSize, true);
      const caption = new Rect(
        compactRows ? textX : f(f(cell.x + cell.w) - captionWidth),
        compactRows ? value.y + 13 : cell.y + 19,
        compactRows ? value.w : captionWidth,
        compactRows ? 10 : 14,
      );
      if (showCaption) {
        const flow = i === 0 ? goldPerDay : manaPerDay,
          secondary =
            i === 0 || i === 5 ? (flow >= 0 ? '+' : '') + compact(flow) + '/day' : '/ ' + compact(limits[i]),
          muted = { ...((i === 0 || i === 5) && flow < 0 ? theme.danger : theme.muted) };
        if (active)
          muted.a = Math.trunc(f(muted.a * smoothstep(clamp(f(f(progress - f(0.65)) / f(0.35)), 0, 1))));
        context.text(
          caption,
          secondary,
          muted,
          compactRows ? 8 : 10,
          false,
          compactRows ? Align.Start : Align.End,
        );
      }
      if (active && showCaption) {
        const gain = { ...colors[i] };
        if (!reducedMotion) {
          gain.a = Math.trunc(f(255 * f(1 - smoothstep(clamp(f(f(progress - f(0.55)) / f(0.4)), 0, 1)))));
          const rise = outCubic(Math.min(1, f(progress * f(2.5))));
          caption.y = f(caption.y + f(4 * f(1 - rise)));
        }
        context.text(
          caption,
          '+' + compact(slot.gained),
          gain,
          compactRows ? 8 : 11,
          true,
          compactRows ? Align.Start : Align.End,
        );
      }
      if (slot.started >= 0) {
        if (reducedMotion) context.requestFrameAt(slot.started + gainDuration);
        else {
          this.moving = true;
          context.requestAnimationFrame();
        }
      }
      if (row) context.line(cell.x + 4, cell.y, f(f(cell.x + cell.w) - 4), cell.y, theme.border);
    }
    this.initialized = true;
  }
  tooltip(context: Context, theme: Theme): void {
    if (this.hovered < 0) return;
    const width = Math.min(f(context.textWidth(this.description, 12) + 24), f(context.clip().w - 16));
    let x = f(f(this.bounds.x + this.bounds.w) + 8);
    x = clamp(
      x,
      context.clip().x + 8,
      Math.max(context.clip().x + 8, f(f(f(context.clip().x + context.clip().w) - width) - 8)),
    );
    const tooltip = new Rect(x, f(this.hoveredCell.y + f(f(this.hoveredCell.h - 30) / 2)), width, 30);
    context.rect(tooltip, theme.raised, theme.radius, theme.border);
    context.text(tooltip, this.description, theme.text, 12, false, Align.Center);
  }
}

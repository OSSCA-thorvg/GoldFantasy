import type { Paint } from '@thorvg/webcanvas';
import { Rect, button, type Context, type Color } from '../../../../packages/native-ui/src';
import { Order } from '../../../../packages/engine/src/game-tools';
import { f32 } from '../../../../packages/engine/src/numeric';
import { animalSpec } from '../../../../packages/engine/src/wildlife';
import { point } from '../../../../packages/engine/src/geometry';
import * as mining from '../../../../packages/engine/src/mining';
import { animalSprite } from '../../../../packages/native-renderer/src/wildlife-sprites';
import { treeAt, TreeKind, TreeBatch } from '../../../../packages/native-renderer/src/tree-painter';
import { appendStone, stoneLit, stoneShade } from '../../../../packages/native-renderer/src/mining-stone';
import { SceneNode, ShapeNode } from '../../../../packages/native-renderer/src/paint';
import { fill, opaque } from '../../../../packages/native-renderer/src/vector-paint';
import { hudPaint } from './hud-paint';
import type { GameHudApp } from './game-hud-contract';
import { worldTarget, landmarkDescription } from './world-targets';
import type { GameCommandApp } from './game-commands';
import { actionButton } from './hud-actions';
function fitted(context: Context, model: Paint, frame: Rect): Paint {
  const holder = new context.tvg.Scene(),
    bounds = model.bounds();
  const { x, y, width: w, height: h } = bounds;
  if (w > 0 && h > 0) {
    const scale = Math.min(f32(f32(frame.w - 14) / w), f32(f32(frame.h - 14) / h));
    model.scale(scale);
    model.translate(
      f32(f32(f32(frame.w - f32(w * scale)) / 2) - f32(x * scale)),
      f32(f32(f32(frame.h - f32(h * scale)) / 2) - f32(y * scale)),
    );
  }
  holder.add(model);
  model.dispose();
  holder.translate(frame.x, frame.y);
  return holder;
}
export function worldObjectPanel(this: GameHudApp, panel: Rect): void {
  if (this.selectedObjects?.length) {
    const targets = this.selectedObjects
      .map((ref) => worldTarget(this as unknown as GameCommandApp, ref))
      .filter((t) => t !== null);
    if (!targets.length) {
      this.selectedObjects = [];
      return;
    }
    this.objectPage = Math.max(0, Math.min(targets.length - 1, this.objectPage));
    const target = targets[this.objectPage],
      c = this.context,
      t = this.theme;
    c.text(new Rect(panel.x + 16, panel.y + 12, panel.w - 70, 26), target.name, t.text, 17, true);
    c.text(
      new Rect(panel.x + 16, panel.y + 42, panel.w - 32, 22),
      `${target.kind} · ${this.objectPage + 1} / ${targets.length} selected objects`,
      t.accent,
      11,
    );
    let detail = '';
    if (target.kind === 'animal' || target.kind === 'monster') {
      const p = this.town.creature(target.id);
      detail = p
        ? `Health ${Math.max(0, p.health).toFixed(1)} · ${target.kind === 'monster' || p.angry ? 'Hostile' : 'Neutral'} · Strength ${p.strength.toFixed(1)}`
        : '';
    }
    if (target.kind === 'road') {
      const r = this.town.roads().road(target.id);
      detail = r
        ? `Built ${Math.round(r.built * 100)}% · Length ${r.length().toFixed(1)} · Wear ${Math.round(r.wear * 100)}%`
        : '';
    }
    if (target.kind === 'landmark') detail = landmarkDescription(target.id);
    if (target.kind === 'field') {
      const f = this.town.field(target.id);
      detail = f ? `Farmland · ${f.acres()} acres` : '';
    }
    if (target.kind === 'tree')
      detail = 'A wood resource. Right-click to gather; inspect any selected object below.';
    if (target.kind === 'rock') detail = 'A stone resource. Right-click to mine.';
    if (target.kind === 'building')
      detail = 'Open the building inspector for construction, residents and services.';
    c.text(
      new Rect(panel.x + 16, panel.y + 70, panel.w - 32, 22),
      c.elideText(detail, panel.w - 32, 11),
      t.muted,
      11,
    );
    const y = panel.y + panel.h - 38;
    actionButton(
      c,
      'objects-prev',
      new Rect(panel.x + 14, y, 30, 28),
      'back',
      'Previous object',
      () => --this.objectPage,
      false,
      this.objectPage > 0,
    );
    actionButton(
      c,
      'objects-next',
      new Rect(panel.x + 50, y, 30, 28),
      'next',
      'Next object',
      () => ++this.objectPage,
      false,
      this.objectPage < targets.length - 1,
    );
    if (target.kind === 'building')
      actionButton(c, 'objects-inspect', new Rect(panel.x + 96, y, 70, 28), 'build', 'Inspect building', () =>
        this.selectBuilding(target.id),
      );
    return;
  }
  const map = this.town.map(),
    animal = this.selectedAnimal >= 0 ? this.town.creature(this.selectedAnimal) : null,
    stone = this.selectedRock >= 0,
    cell = stone ? this.selectedRock : this.selectedTree,
    c = this.context,
    t = this.theme;
  if (!animal && cell < 0) return;
  const portrait = new Rect(f32(panel.x + 12), f32(panel.y + 12), 96, 120);
  c.rect(portrait, t.raised, t.radius, t.border);
  const left = f32(panel.x + 120),
    width = f32(panel.w - 132);
  const text = (y: number, words: string, color: Color, size = 12, bold = false) =>
    c.text(
      new Rect(left, f32(panel.y + y), width, 21),
      c.elideText(words, width, size, bold),
      color,
      size,
      bold,
    );
  if (animal && animal.animal !== null) {
    const kind = animal.animal,
      spec = animalSpec(kind);
    c.paint(JSON.stringify(['animal-profile', kind, portrait]), () =>
      fitted(c, hudPaint(c, animalSprite(kind)), portrait),
    );
    text(10, spec.name, t.text, 17, true);
    text(35, animal.angry ? (spec.defends ? 'Defending itself' : 'Fleeing') : 'Neutral animal', t.accent);
    text(58, 'Food +' + spec.food + ' when hunted', t.muted);
    const health = Math.max(0, Math.min(1, f32(animal.health / spec.health)));
    text(79, 'Health ' + Math.ceil(f32(health * 100)) + '%', t.muted, 11);
    c.rect(new Rect(f32(left + 78), f32(panel.y + 87), Math.max(1, f32(width - 78)), 5), t.raised, 2);
    if (health > 0)
      c.rect(
        new Rect(f32(left + 78), f32(panel.y + 87), Math.max(1, f32(f32(width - 78) * health)), 5),
        t.success,
        2,
      );
    button(c, 'animal-hunt', new Rect(left, f32(panel.y + 104), width, 30), 'Attack  A', () =>
      this.prepare(Order.Attack),
    );
    return;
  }
  const x = cell % map.width(),
    y = Math.trunc(f32(cell / map.width()));
  if (!map.inside(x, y)) return;
  if (stone) {
    const size = mining.size(map, x, y);
    c.paint(JSON.stringify(['stone-profile', map.seed(), cell, portrait]), () => {
      const model = new SceneNode(),
        lit = new ShapeNode(),
        shade = new ShapeNode();
      appendStone(lit, shade, point(), size);
      fill(lit, opaque(stoneLit));
      fill(shade, opaque(stoneShade));
      model.add(lit).add(shade);
      return fitted(c, hudPaint(c, model), portrait);
    });
    text(10, 'Stone', t.text, 17, true);
    text(35, 'Stone deposit', t.accent);
    text(58, 'Mine, carry, store +3 stone', t.muted);
  } else {
    if (!map.at(x, y).trees) return;
    const instance =
      this.selectedTreeInstance >= 0 && this.selectedTreeInstance < map.at(x, y).trees
        ? this.selectedTreeInstance
        : map.at(x, y).trees - 1;
    const tree = treeAt(map, x, y, f32(instance));
    tree.foot = point();
    const climate = this.town.climate();
    c.paint(
      JSON.stringify([
        'tree-profile',
        instance,
        map.seed(),
        cell,
        map.at(x, y).trees,
        climate.autumn,
        climate.snow,
        portrait,
      ]),
      () => {
        const model = new SceneNode(),
          batch = new TreeBatch(climate);
        batch.add(tree);
        for (const paint of batch.finish(0)) model.add(paint);
        return fitted(c, hudPaint(c, model), portrait);
      },
    );
    text(10, 'Tree', t.text, 17, true);
    text(
      35,
      tree.kind === TreeKind.Fir ? 'Fir' : tree.kind === TreeKind.SnowySpruce ? 'Snowy spruce' : 'Dead tree',
      t.accent,
    );
    text(58, 'Chop, carry, store +3 wood', t.muted);
    text(79, 'Trees remaining: ' + map.at(x, y).trees, t.muted, 11);
  }
  button(
    c,
    'resource-work',
    new Rect(left, f32(panel.y + 104), width, 30),
    stone ? 'Mine  A' : 'Chop  A',
    () => this.prepare(Order.Attack),
  );
}

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
    const tree = treeAt(map, x, y, f32(map.at(x, y).trees - 1));
    tree.foot = point();
    const climate = this.town.climate();
    c.paint(
      JSON.stringify([
        'tree-profile',
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

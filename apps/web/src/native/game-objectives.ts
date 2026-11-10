import { Rect, Align, ButtonStyle, button } from '../../../../packages/native-ui/src';
import { lerpFloat } from '../../../../packages/native-ui/src/numeric';
import {
  settlementGoals,
  goalComplete,
  GoalKind,
} from '../../../../packages/engine/src/settlement-progression';
import { Tool, Order, toolStructure } from '../../../../packages/engine/src/game-tools';
import { compactViewport } from './mobile-layout';
import { project } from '../../../../packages/engine/src/geometry';
import { f32, clamp } from '../../../../packages/engine/src/numeric';
import { structureSpec, describe } from '../../../../packages/engine/src/building-catalog';
import {
  constructionProducts,
  resourceAmount,
  resourceBundle,
} from '../../../../packages/engine/src/construction-materials';
import type { Building } from '../../../../packages/engine/src/town-models';
import type { GameHudApp } from './game-hud-contract';
export function objectives(this: GameHudApp, width: number, height: number, top: number): void {
  const compact = this.touchMode && compactViewport(width, height);
  if (compact && (this.tool !== Tool.Select || this.pending !== Order.None)) return;
  const goals = settlementGoals();
  let completed = 0,
    current = goals.length;
  for (let i = 0; i < goals.length; i++) {
    if (goalComplete(this.town, goals[i])) ++completed;
    else if (current === goals.length) current = i;
  }
  const c = this.context,
    t = this.theme,
    now = c.time();
  if (this.questsInitialized && completed > this.questsSeen) this.questPulseAt = now;
  this.questsInitialized = true;
  this.questsSeen = completed;
  const pulse =
    this.reducedMotion() || this.questPulseAt < 0
      ? 0
      : f32(clamp(1 - (now - this.questPulseAt) / 0.45, 0, 1));
  this.questsAnimating = pulse > 0;
  if (this.questsAnimating) c.requestAnimationFrame();
  const collapsed = compact ? !this.mobileQuestsExpanded : this.objectivesCollapsed,
    header = this.touchMode ? 44 : 38,
    w = Math.min(compact && collapsed ? 164 : 292, f32(width - 24)),
    y = Math.min(top, f32(height - 60)),
    expanded = clamp(f32(f32(this.dockBounds.y - y) - 24), 38, 210),
    reveal = c.animate('quests/reveal', collapsed ? 0 : 1, 0.18),
    h = lerpFloat(header, Math.max(header, expanded), reveal),
    bounds = new Rect(compact ? 12 : f32(f32(width - 12) - w), y, w, h),
    left = f32(bounds.x + 14);
  c.control('objectives-panel', bounds, undefined, true, false);
  let border = t.border;
  if (pulse > 0) border = { ...t.accent, a: Math.trunc(f32(180 + f32(75 * pulse))) };
  c.rect(bounds, t.surface, t.radius, border);
  button(
    c,
    'objectives-toggle',
    this.touchMode
      ? new Rect(bounds.x, y, w, header)
      : new Rect(f32(f32(bounds.x + w) - 38), f32(y + 6), 26, 26),
    this.touchMode ? '' : collapsed ? '+' : '-',
    () => {
      if (compact) this.mobileQuestsExpanded = !this.mobileQuestsExpanded;
      else this.objectivesCollapsed = !this.objectivesCollapsed;
    },
    ButtonStyle.Quiet,
  );
  const ink = t.accent;
  c.paint(JSON.stringify(['Q', bounds.x, y, ink]), () => {
    const shape = new c.tvg.Shape(),
      x = f32(bounds.x + 22),
      middle = f32(y + 19);
    return shape
      .moveTo(x, f32(middle - 8))
      .lineTo(f32(x + 7), middle)
      .lineTo(x, f32(middle + 8))
      .lineTo(f32(x - 7), middle)
      .close()
      .moveTo(f32(x - 3), middle)
      .lineTo(f32(x - 1), f32(middle + 3))
      .lineTo(f32(x + 4), f32(middle - 4))
      .fill(0, 0, 0, 0)
      .stroke({ width: f32(1.2), color: [ink.r, ink.g, ink.b, ink.a] });
  });
  c.text(
    new Rect(f32(bounds.x + 38), f32(y + 7), f32(w - (compact && collapsed ? 50 : 148)), 24),
    compact && collapsed ? `Quests ${completed}/${goals.length}` : 'Quests',
    t.text,
    compact && collapsed ? 11 : 13,
    true,
  );
  if (!compact || !collapsed)
    c.text(
      new Rect(f32(f32(bounds.x + w) - 102), f32(y + 9), 58, 20),
      completed + ' / ' + goals.length,
      t.muted,
      10,
      false,
      Align.End,
    );
  if (h < 76) return;
  c.clip(bounds.inset(6), () => {
    if (current === goals.length) {
      c.text(new Rect(left, f32(y + 49), f32(w - 28), 25), 'Settlement saga complete', t.success, 14, true);
      c.text(new Rect(left, f32(y + 79), f32(w - 28), 24), 'Every quest has been fulfilled.', t.muted, 11);
      return;
    }
    const goal = goals[current];
    c.text(new Rect(left, f32(y + 42), f32(w - 28), 16), 'Current quest', t.accent, 9, true);
    c.text(new Rect(left, f32(y + 61), f32(w - 28), 23), goal.title, t.text, 14, true);
    let words = '',
      row = '',
      descriptionY = f32(y + 88);
    const flush = () => {
      const next = row ? row + ' ' + words : words;
      if (row && c.textWidth(next, 10) > f32(w - 28)) {
        if (descriptionY < f32(y + 117))
          c.text(new Rect(left, descriptionY, f32(w - 28), 16), row, t.muted, 10);
        descriptionY = f32(descriptionY + 15);
        row = words;
      } else row = next;
      words = '';
    };
    for (const character of goal.description) {
      if (character === ' ') flush();
      else words = words.concat(character);
    }
    flush();
    if (row && descriptionY < f32(y + 117))
      c.text(new Rect(left, descriptionY, f32(w - 28), 16), row, t.muted, 10);
    let progress = 0,
      status = 'Not started',
      action = '',
      site: Building | null = null;
    if (goal.kind === GoalKind.Building) {
      action = 'Place ' + structureSpec(goal.building).name;
      for (const b of this.town.buildings())
        if (b.kind === goal.building && !b.built()) {
          site = b;
          break;
        }
      if (site) {
        progress = site.progress;
        action = 'Find construction site';
        status = 'Building ' + Math.trunc(f32(progress * 100)) + '%';
        if (site.materials.limit() < 1) {
          status = 'Materials: ';
          let first = true;
          for (const product of constructionProducts)
            if (resourceAmount(site.materials.required, product)) {
              if (!first) status = status.concat(', ');
              first = false;
              status = status.concat(
                resourceAmount(site.materials.delivered, product) +
                  '/' +
                  describe(resourceBundle(product, resourceAmount(site.materials.required, product))),
              );
            }
        }
      }
    } else if (goal.kind === GoalKind.Road) {
      action = 'Draw a road';
      for (const road of this.town.roads().roads()) progress = Math.max(progress, road.built);
      if (this.town.roads().roads().length) status = 'Laying road ' + Math.trunc(f32(progress * 100)) + '%';
    } else if (goal.kind === GoalKind.Field) action = 'Plant a field';
    else {
      action = 'Build housing';
      progress = f32(this.town.population() / Math.max(1, goal.residents));
      status = this.town.population() + ' / ' + goal.residents + ' residents';
    }
    c.text(new Rect(left, f32(y + 127), f32(w - 28), 18), c.elideText(status, f32(w - 28), 10), t.text, 10);
    const displayed = c.animate('quests/progress/' + current, clamp(progress, 0, 1), 0.2);
    c.rect(new Rect(left, f32(y + 152), f32(w - 28), 3), t.border);
    c.rect(new Rect(left, f32(y + 152), f32(f32(w - 28) * displayed), 3), t.accent);
    for (let i = 0; i <= 4; i++) {
      const at = f32(left + f32(f32(f32(w - 28) * i) / 4));
      c.line(at, f32(y + 150), at, f32(y + 157), f32(i / 4) <= displayed ? t.accent : t.border, f32(0.8));
    }
    if (expanded < 200) return;
    button(
      c,
      'quest-action/' + current,
      new Rect(left, f32(y + (this.touchMode ? 160 : 171)), f32(w - 28), this.touchMode ? 44 : 29),
      action,
      () => {
        if (goal.kind === GoalKind.Building) {
          for (const b of this.town.buildings())
            if (b.kind === goal.building && !b.built()) {
              this.selectBuilding(b.id);
              const p = project(b.center.x, b.center.y);
              this.camera.x = p.x;
              this.camera.y = p.y;
              return;
            }
          for (let i = 0; i < Tool.Count; i++)
            if (toolStructure(i) === goal.building) {
              this.selectTool(i);
              return;
            }
        } else if (goal.kind === GoalKind.Road) this.selectTool(Tool.Road);
        else if (goal.kind === GoalKind.Field) this.selectTool(Tool.Field);
        else this.selectTool(Tool.Tent);
      },
      ButtonStyle.Primary,
      reveal > f32(0.98),
    );
  });
}

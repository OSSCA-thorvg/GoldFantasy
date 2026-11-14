import { translate } from '../../../../packages/localization/src/index';
import { Rect, Align, ButtonStyle, EventType, button } from '../../../../packages/native-ui/src';
import { lerpFloat } from '../../../../packages/native-ui/src/numeric';
import {
  settlementGoals,
  goalComplete,
  goalProgress,
  currentGoal,
  goalBranchName,
  GoalBranch,
  GoalKind,
  unsourcedMaterial,
} from '../../../../packages/engine/src/settlement-progression';
import { Tool, Order } from '../../../../packages/engine/src/game-tools';
import { compactViewport } from './mobile-layout';
import { f32, clamp } from '../../../../packages/engine/src/numeric';
import { describe, Product, Structure } from '../../../../packages/engine/src/building-catalog';
import {
  constructionProducts,
  resourceAmount,
  resourceBundle,
} from '../../../../packages/engine/src/construction-materials';
import type { Building } from '../../../../packages/engine/src/town-models';
import { sealProgress } from '../../../../packages/engine/src/gate-seals';
import { isPlayerBuilding } from '../../../../packages/engine/src/faction';
import type { GameHudApp } from './game-hud-contract';
import { questAction, boonTip } from './game-progress-hud';
import { craftBars } from './craft-station-hud';
export function objectives(this: GameHudApp, width: number, height: number, top: number): void {
  // Work at a crafting station shows over it in the world.
  craftBars(this, width, height);
  const compact = this.touchMode && compactViewport(width, height);
  if (compact && (this.tool !== Tool.Select || this.pending !== Order.None)) return;
  const goals = settlementGoals();
  let completed = 0;
  for (const goal of goals) if (goalComplete(this.town, goal)) ++completed;
  // The founding chain is ordered; afterwards the player picks which branch to follow.
  const branches = [GoalBranch.Trade, GoalBranch.Arms, GoalBranch.Faith, GoalBranch.Saga],
    core = currentGoal(this.town, GoalBranch.Core),
    open = branches.filter((branch) => currentGoal(this.town, branch) >= 0);
  if (core < 0 && open.length && !open.includes(this.questBranch)) this.questBranch = open[0];
  const picked = core >= 0 ? core : currentGoal(this.town, this.questBranch),
    current = picked < 0 ? goals.length : picked,
    seals = sealProgress(this.town);
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
    new Rect(f32(bounds.x + 38), f32(y + 7), f32(w - (compact && collapsed ? 50 : 196)), 24),
    compact && collapsed ? `Quests ${completed}/${goals.length}` : 'Quests',
    t.text,
    compact && collapsed ? 11 : 13,
    true,
  );
  if (!compact || !collapsed) {
    const counter = new Rect(f32(f32(bounds.x + w) - 172), f32(y + 9), 128, 20);
    c.text(
      counter,
      (seals.total ? `Gates ${seals.sealed}/${seals.total}   ` : '') + completed + ' / ' + goals.length,
      t.muted,
      10,
      false,
      Align.End,
    );
    // Sealed worlds' boons are listed on hover or focus of the counter.
    if (seals.sealed) {
      const state = c.control('quest-boons', counter, undefined, true, true);
      if (state.hovered || state.focused) boonTip(this, counter);
    }
  }
  if (h < 76) return;
  c.clip(bounds.inset(6), () => {
    if (current === goals.length) {
      c.text(new Rect(left, f32(y + 49), f32(w - 28), 25), 'Settlement saga complete', t.success, 14, true);
      c.text(new Rect(left, f32(y + 79), f32(w - 28), 24), 'Every quest has been fulfilled.', t.muted, 11);
      return;
    }
    const goal = goals[current];
    if (core >= 0) c.text(new Rect(left, f32(y + 42), f32(w - 28), 16), 'Current quest', t.accent, 9, true);
    else {
      const tab = f32(f32(w - 28) / branches.length);
      branches.forEach((branch, index) => {
        const done = !open.includes(branch),
          area = new Rect(f32(left + f32(tab * index)), f32(y + 38), tab, 20);
        c.control('quest-branch/' + branch, area, (event) => {
          if (event.type === EventType.Activate && !done) this.questBranch = branch;
        });
        c.text(
          area,
          goalBranchName(branch),
          done ? t.success : branch === this.questBranch ? t.accent : t.muted,
          10,
          branch === this.questBranch,
          Align.Center,
        );
      });
    }
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
    for (const character of translate(goal.description)) {
      if (character === ' ') flush();
      else words = words.concat(character);
    }
    flush();
    if (row && descriptionY < f32(y + 117))
      c.text(new Rect(left, descriptionY, f32(w - 28), 16), row, t.muted, 10);
    const measured = goalProgress(this.town, goal),
      action = questAction(this, goal);
    let progress = f32(measured.have / Math.max(1, measured.need)),
      status = measured.label,
      warn = false,
      site: Building | null = null;
    if (goal.kind === GoalKind.Building && !measured.have) {
      for (const b of this.town.buildings())
        if (b.kind === goal.building && !b.built() && isPlayerBuilding(b)) {
          site = b;
          break;
        }
      if (site) {
        progress = site.progress;
        status = `${measured.label} · ${Math.trunc(f32(progress * 100))}%`;
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
          // Builders give up quietly when nothing is in sight; say what is missing and how to get it.
          const lacking = unsourcedMaterial(this.town, site);
          if (lacking !== null) {
            warn = true;
            status =
              lacking === Product.Stone
                ? 'No rock in sight: send a resident out to explore'
                : 'No trees in sight: send a resident out to explore';
          }
        }
      }
    } else if (goal.kind === GoalKind.Population && measured.have < measured.need) {
      const altar = this.town.buildings().find((b) => b.kind === Structure.Shrine && b.built() && isPlayerBuilding(b));
      const reason = altar ? this.town.altarStatus(altar.id).reason : '';
      if (reason) status = `${measured.label} · ${reason}`;
    } else if (goal.kind === GoalKind.Road && !measured.have) {
      for (const road of this.town.roads().roads()) progress = Math.max(progress, f32(road.built));
      if (this.town.roads().roads().length) status = 'Laying road ' + Math.trunc(f32(progress * 100)) + '%';
    }
    c.text(
      new Rect(left, f32(y + 127), f32(w - 28), 18),
      c.elideText(status, f32(w - 28), 10),
      warn ? t.danger : t.text,
      10,
    );
    const displayed = c.animate('quests/progress/' + current, clamp(progress, 0, 1), 0.2);
    c.rect(new Rect(left, f32(y + 152), f32(w - 28), 3), t.border);
    c.rect(new Rect(left, f32(y + 152), f32(f32(w - 28) * displayed), 3), t.accent);
    for (let i = 0; i <= 4; i++) {
      const at = f32(left + f32(f32(f32(w - 28) * i) / 4));
      c.line(at, f32(y + 150), at, f32(y + 157), f32(i / 4) <= displayed ? t.accent : t.border, f32(0.8));
    }
    if (expanded < 200 || !action) return;
    button(
      c,
      'quest-action/' + current,
      new Rect(left, f32(y + (this.touchMode ? 160 : 171)), f32(w - 28), this.touchMode ? 44 : 29),
      action.label,
      action.run,
      ButtonStyle.Primary,
      reveal > f32(0.98),
    );
  });
}

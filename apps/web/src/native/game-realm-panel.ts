import { Rect, Align, ButtonStyle, button } from '../../../../packages/native-ui/src';
import { f32, clamp } from '../../../../packages/engine/src/numeric';
import { describe } from '../../../../packages/engine/src/building-catalog';
import { worldName } from '../../../../packages/engine/src/world-map';
import { Saga, sagaState, sealFloors, sealProgress } from '../../../../packages/engine/src/gate-seals';
import { compactViewport } from './mobile-layout';
import type { GameHudApp } from './game-hud-contract';
import { callingName, type Person } from '../../../../packages/engine/src/person';
import { combatRules } from '../../../../packages/engine/src/combat-events';
import { combatHints, pickPartyMember, recallParty, wrapText } from './game-combat-hud';
import { swarmCount, swarmLine } from './swarm-hud';

/** Status and the way home for the party that is beyond a gate. */
export function realmPanel(this: GameHudApp, width: number, height: number): void {
  const plan = this.town.realmPlan();
  if (!plan) return;
  const c = this.context,
    t = this.theme,
    compact = this.touchMode && compactViewport(width, height),
    site = this.town.map().dungeons()[this.town.realmGate],
    party = this.town.realmParty(),
    foes = this.town.realmFoes(),
    guardian = foes.find((foe) => foe.id === this.town.realmGuardian) ?? null,
    leave = this.town.canLeaveRealm(),
    left = this.town.realmLeftBehind(),
    loot = this.town.realmLoot,
    w = Math.min(300, f32(width - 24)),
    inner = f32(w - 24),
    header = 34,
    collapsed = this.realmCollapsed || compact,
    reason = wrapText(
      c,
      !leave.ok ? leave.reason : leave.cost.empty() ? 'The way home is open' : 'The portal can pull the party home',
      inner,
      10,
      3,
    ),
    leftLine = leave.ok && left.length ? `Go home leaves behind: ${left.map((p) => p.name).join(', ')}` : '',
    hints = this.touchMode ? [] : combatHints,
    body = collapsed
      ? 0
      : 44 + party.length * rowHeight + 18 + reason.length * 14 + (leftLine ? 14 : 0) + 10 + 40 + (hints.length ? 6 + hints.length * 13 : 0),
    top = f32(f32(this.skyBounds.y + this.skyBounds.h) + (compact ? 52 : 34)),
    bounds = new Rect(12, top, w, Math.min(header + body, f32(this.dockBounds.y - top - 8)));
  if (bounds.h < header) return;
  c.requestAnimationFrame();
  c.control('realm-panel', bounds, undefined, true, false);
  c.rect(bounds, t.surface, t.radius, this.town.realmCleared ? t.success : t.border);
  c.text(
    new Rect(f32(bounds.x + 12), f32(top + 6), f32(w - 60), 22),
    c.elideText(`${worldName(this.town.map().destination(site))}  -  floor ${this.town.realmFloor + 1}/${sealFloors}`, f32(w - 60), 12, true),
    t.text,
    12,
    true,
  );
  if (!compact)
    button(
      c,
      'realm-toggle',
      new Rect(f32(f32(bounds.x + w) - 34), f32(top + 4), 26, 26),
      collapsed ? '+' : '-',
      () => (this.realmCollapsed = !this.realmCollapsed),
      ButtonStyle.Quiet,
    );
  if (collapsed) {
    const count = swarmCount(this);
    if (count)
      c.text(
        new Rect(f32(bounds.x + 12), f32(top + 6), f32(w - (compact ? 24 : 52)), 22),
        `${count.dens}/${count.total} dens  ·  ${count.monsters}`,
        t.muted,
        10,
        false,
        Align.End,
      );
    return;
  }
  c.clip(bounds.inset(4), () => {
    const left = f32(bounds.x + 12);
    let y = f32(top + header);
    const bar = (x: number, span: number, fraction: number, color = t.success) => {
      c.rect(new Rect(x, f32(y + 6), span, 6), t.raised, 3);
      c.rect(new Rect(x, f32(y + 6), Math.max(2, f32(span * clamp(fraction, 0, 1))), 6), color, 3);
    };
    c.text(
      new Rect(left, y, 96, 18),
      this.town.realmCleared ? 'Guardian slain' : 'Guardian',
      this.town.realmCleared ? t.success : t.danger,
      11,
      true,
    );
    if (guardian) bar(f32(left + 100), f32(inner - 100), guardian.health / Math.max(0.01, this.town.guardianVigor()), t.danger);
    y = f32(y + 20);
    const count = swarmCount(this);
    c.text(new Rect(left, y, inner, 18), count ? swarmLine(count) : `Monsters left: ${foes.length}`, count?.dens ? t.text : t.success, 10, true);
    y = f32(y + 24);
    for (const p of party) {
      partyFrame(this, p, new Rect(f32(left - 4), y, f32(inner + 8), rowHeight - 2));
      y = f32(y + rowHeight);
    }
    c.text(
      new Rect(left, y, inner, 18),
      c.elideText(loot.empty() ? 'Carrying nothing yet' : 'Carrying ' + describe(loot), inner, 10),
      loot.empty() ? t.muted : t.accent,
      10,
    );
    y = f32(y + 18);
    for (const row of reason) {
      c.text(new Rect(left, y, inner, 14), row, leave.ok ? t.success : t.danger, 10);
      y = f32(y + 14);
    }
    if (leftLine) {
      c.text(new Rect(left, y, inner, 14), c.elideText(leftLine, inner, 10), t.danger, 10, true);
      y = f32(y + 14);
    }
    y = f32(y + 10);
    const half = f32(f32(inner - 8) / 2);
    button(c, 'realm-recall', new Rect(left, y, half, 28), this.touchMode ? 'Recall party' : 'Recall party (R)', () =>
      recallParty(this),
    );
    button(
      c,
      'realm-leave',
      new Rect(f32(left + half + 8), y, half, 28),
      leave.cost.empty() ? 'Go home' : `Portal (${leave.cost.mana} mana)`,
      () => this.town.leaveRealm(),
      ButtonStyle.Primary,
      leave.ok,
    );
    y = f32(y + 34);
    for (const hint of hints) {
      c.text(new Rect(left, y, inner, 13), c.elideText(hint, inner, 9), t.muted, 9);
      y = f32(y + 13);
    }
  });
}
const rowHeight = 22;
/** One party member: click selects, a quick second click also brings the view to them. */
function partyFrame(app: GameHudApp, p: Person, r: Rect): void {
  const c = app.context,
    t = app.theme,
    town = app.town,
    id = `realm-member-${p.id}`,
    downed = p.downedAt >= 0,
    skills = town.skillsOf(p),
    state = button(c, id, r, '', () => pickPartyMember(app, p.id), ButtonStyle.Quiet, true, undefined, app.chosen.includes(p.id), {
      fill: { r: 0, g: 0, b: 0, a: 0 },
    }),
    x = f32(r.x + 4),
    barX = f32(x + 100),
    barW = f32(r.w - 100 - 8 - 34),
    y = f32(r.y + f32(r.h / 2) - 3);
  const nameW = p.holding && !downed ? 84 : 96;
  c.text(new Rect(x, r.y, nameW, r.h), c.elideText(`${p.name}  ${p.level}`, nameW, 11), downed ? t.danger : t.text, 11, downed);
  if (downed) {
    const left = town.bleedOutLeft(p),
      share = left / Math.max(1, town.bleedOutTotal(p));
    c.rect(new Rect(barX, y, barW, 6), t.raised, 3);
    c.rect(new Rect(barX, y, Math.max(2, f32(barW * clamp(share, 0, 1))), 6), t.danger, 3);
    c.text(new Rect(f32(barX + barW + 4), r.y, 30, r.h), `${Math.ceil(left)} s`, t.danger, 10, true, Align.End);
    c.requestFrameAt(c.time() + 0.25);
  } else {
    c.rect(new Rect(barX, y, barW, 6), t.raised, 3);
    c.rect(new Rect(barX, y, Math.max(2, f32(barW * clamp(p.health, 0, 1))), 6), p.health < 0.3 ? t.danger : t.success, 3);
    if (p.woundDays > 0) {
      // A wound caps health: the capped part of the bar is struck out.
      const cap = f32(barX + f32(barW * combatRules.woundedHealth));
      c.rect(new Rect(cap, f32(y - 2), 2, 10), t.danger, 0);
    }
    const mx = f32(barX + barW + 8);
    if (p.woundDays > 0) {
      c.line(mx, f32(y + 3), f32(mx + 8), f32(y + 3), t.danger, 2);
      c.line(f32(mx + 4), f32(y - 1), f32(mx + 4), f32(y + 7), t.danger, 2);
    }
    // One pip per skill: filled when ready, ringed while it recovers or runs, faint while still locked.
    skills.forEach((skill, slot) => {
      const pip = new Rect(f32(mx + 12 + slot * 9), f32(y - 1), 7, 7);
      if (skill.locked) c.rect(pip, t.raised, 4);
      else if (skill.ready) c.rect(pip, t.accent, 4);
      else c.rect(pip, { r: 0, g: 0, b: 0, a: 0 }, 4, skill.active ? t.accent : t.muted, 1);
    });
    if (p.holding) {
      // A planted shield: holding position.
      const hx = f32(x + 92),
        hy = f32(r.y + 6);
      c.line(f32(hx - 3), hy, f32(hx + 3), hy, t.accent, 1.3);
      c.line(f32(hx - 3), hy, f32(hx - 3), f32(hy + 4), t.accent, 1.3);
      c.line(f32(hx + 3), hy, f32(hx + 3), f32(hy + 4), t.accent, 1.3);
      c.line(f32(hx - 3), f32(hy + 4), hx, f32(hy + 8), t.accent, 1.3);
      c.line(f32(hx + 3), f32(hy + 4), hx, f32(hy + 8), t.accent, 1.3);
    }
  }
  if (!state.hovered) return;
  const lines = [
    `${p.name}, ${callingName(p.calling)}, level ${p.level}`,
    downed
      ? `Downed: bleeds out in ${Math.ceil(town.bleedOutLeft(p))} s. Select an ally and right-click the body to revive.`
      : `Health ${Math.round(p.health * 100)}%`,
  ];
  if (p.woundDays > 0)
    lines.push(`Wounded: health stays low for ${Math.ceil(p.woundDays)} more ${Math.ceil(p.woundDays) === 1 ? 'day' : 'days'}`);
  if (!downed && p.holding) lines.push('Holding position');
  if (!downed)
    for (const skill of skills)
      lines.push(
        skill.locked
          ? `${skill.name} comes at level ${skill.level}`
          : skill.ready
            ? `${skill.name} is ready`
            : `${skill.name} in ${Math.ceil(skill.remaining)} s`,
      );
  lines.push('Click to select; click twice to look.');
  c.deferOverlay(
    (area, controls) => {
      const anchor = controls.find((control) => control.id === id)?.bounds;
      if (!anchor) return;
      const width = Math.min(280, f32(area.w - 16)),
        rows = lines.flatMap((line, i) => wrapText(c, line, width - 20, 11, 3, i === 0)),
        h = 10 + rows.length * 16,
        tip = new Rect(f32(anchor.x + anchor.w + 8), clamp(anchor.y, area.y + 4, f32(area.y + area.h - h - 4)), width, h);
      c.rect(tip, t.raised, 3, t.border);
      rows.forEach((row, i) => c.text(new Rect(f32(tip.x + 10), f32(tip.y + 5 + i * 16), f32(width - 20), 16), row, i === 0 ? t.text : t.muted, 11, i === 0));
    },
    'combat-tooltip',
    1,
  );
}

/** A fallen guardian or a sealed gate is announced until the player acknowledges it. */
export function realmRewardBanner(this: GameHudApp, width: number, height: number): void {
  const reward = this.town.realmReward;
  if (!reward) return;
  const c = this.context,
    t = this.theme,
    w = Math.min(460, f32(width - 24)),
    h = 96 + reward.lines.length * 20,
    bounds = new Rect(f32(f32(width - w) / 2), Math.max(70, f32(f32(height / 2) - f32(h / 2) - 40)), w, h);
  c.control('realm-reward', bounds, undefined, true, false);
  c.rect(bounds, t.surface, t.radius, reward.sealed ? t.accent : t.success, 2);
  c.text(new Rect(bounds.x, f32(bounds.y + 16), w, 28), reward.title, reward.sealed ? t.accent : t.success, 20, true, Align.Center);
  reward.lines.forEach((line, index) =>
    c.text(
      new Rect(f32(bounds.x + 16), f32(bounds.y + 52 + index * 20), f32(w - 32), 18),
      c.elideText(line, f32(w - 32), 12),
      t.text,
      12,
      false,
      Align.Center,
    ),
  );
  button(
    c,
    'realm-reward-close',
    new Rect(f32(bounds.x + f32(w / 2) - 70), f32(bounds.y + h - 44), 140, 32),
    'Onward',
    () => (this.town.realmReward = null),
    ButtonStyle.Primary,
  );
}

/** Victory and defeat end the saga but never lock the player out of the world. */
export function sagaBanner(this: GameHudApp, width: number, height: number): void {
  const state = sagaState(this.town);
  if (state === Saga.Playing) {
    this.sagaDismissed = false;
    return;
  }
  if (this.sagaDismissed || this.town.realmReward) return;
  const c = this.context,
    t = this.theme,
    won = state === Saga.Victory,
    w = Math.min(440, f32(width - 24)),
    bounds = new Rect(f32(f32(width - w) / 2), Math.max(70, f32(f32(height / 2) - 110)), w, 168),
    seals = sealProgress(this.town);
  c.control('saga-banner', bounds, undefined, true, false);
  c.rect(bounds, t.surface, t.radius, won ? t.success : t.danger, 2);
  c.text(
    new Rect(bounds.x, f32(bounds.y + 18), w, 28),
    won ? 'Midgard is safe' : 'The settlement has fallen',
    won ? t.success : t.danger,
    20,
    true,
    Align.Center,
  );
  const lines = won
    ? [`All ${seals.total} gates to the other worlds are sealed.`, `Day ${this.town.days + 1}. The saga is complete.`]
    : ['No resident is left alive.', `${seals.sealed} of ${seals.total} gates were sealed by day ${this.town.days + 1}.`];
  lines.forEach((line, index) =>
    c.text(new Rect(bounds.x, f32(bounds.y + 58 + index * 20), w, 18), line, t.text, 12, false, Align.Center),
  );
  button(
    c,
    'saga-continue',
    new Rect(f32(bounds.x + f32(w / 2) - 80), f32(bounds.y + 116), 160, 34),
    won ? 'Keep playing' : 'Keep watching',
    () => (this.sagaDismissed = true),
    ButtonStyle.Primary,
  );
}

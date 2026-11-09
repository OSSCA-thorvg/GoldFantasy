import { Rect, ButtonStyle, button, setTransform } from '../../../../packages/native-ui/src';
import { Tool, Order } from '../../../../packages/engine/src/game-tools';
import { f32 as f, clamp } from '../../../../packages/engine/src/numeric';
import { DockView } from './game-app-state';
import { reducedMotionPreferred } from './game-theme';
import type { GameHudApp } from './game-hud-contract';
const copy = (r: Rect) => new Rect(r.x, r.y, r.w, r.h);
const padded = (r: Rect, amount: number) =>
  r.w <= 0 || r.h <= 0
    ? new Rect()
    : new Rect(f(r.x - amount), f(r.y - amount), f(r.w + f(2 * amount)), f(r.h + f(2 * amount)));
const ease = (t: number) => f(1 - f(f(f(1 - t) * f(1 - t)) * f(1 - t)));
const lerp = (a: number, b: number, t: number) => {
  if ((a <= 0 && b >= 0) || (a >= 0 && b <= 0)) return f(f(t * b) + f(f(1 - t) * a));
  if (t === 1) return b;
  const x = f(a + f(t * f(b - a)));
  return t > 1 === b > a ? Math.max(b, x) : Math.min(b, x);
};
export function reducedMotion(): boolean {
  return reducedMotionPreferred();
}
export function dismissBuildDrawer(this: GameHudApp): void {
  this.rosterOpen = false;
  this.card = this.globalCard = -1;
  this.drawerOpen = this.drawerPinned = false;
  this.drawerSuppressed = true;
  this.drawerBridge = new Rect();
}
export function updateContextDock(this: GameHudApp, width: number, height: number): void {
  const now = this.context.time(),
    advance = () => {
      this.dockProgress =
        this.dockStarted < 0 ? 1 : f(clamp((now - this.dockStarted) / this.dockDuration, 0, 1));
      const t = ease(this.dockProgress);
      this.dockBounds.w = Math.min(lerp(this.dockFrom.w, this.dockTarget.w, t), Math.max(1, f(width - 24)));
      this.dockBounds.h = lerp(this.dockFrom.h, this.dockTarget.h, t);
      this.dockBounds.x = f(f(width - this.dockBounds.w) / 2);
      this.dockBounds.y = f(f(height - (this.dockView === DockView.Handle ? 12 : 56)) - this.dockBounds.h);
    };
  if (this.dockKey) advance();
  const handle = new Rect(f(f(width - 236) / 2), height - 48, 116, 36),
    atHandle = handle.contains(this.mouse.x, this.mouse.y);
  if (!atHandle) this.drawerSuppressed = false;
  const eligible =
    this.pending === Order.None && !this.roadPress && !this.boxFrom && !this.fieldFrom && !this.panFrom;
  if (!eligible) {
    this.card = this.globalCard = -1;
    this.drawerOpen = this.drawerPinned = false;
  }
  const menu = this.buildMenuBounds(width, height, true),
    inMenu =
      padded(this.dockBounds, 8).contains(this.mouse.x, this.mouse.y) ||
      (this.drawerOpen &&
        (padded(menu, 8).contains(this.mouse.x, this.mouse.y) ||
          padded(this.drawerBridge, 8).contains(this.mouse.x, this.mouse.y)));
  if (this.drawerOpen && this.dockProgress === 1 && menu.contains(this.mouse.x, this.mouse.y)) {
    this.drawerPinned = false;
    this.drawerBridge = new Rect();
  }
  const vacant =
      !this.chosen.length &&
      this.selected < 0 &&
      this.selectedDungeon < 0 &&
      this.selectedTree < 0 &&
      this.selectedRock < 0 &&
      this.selectedAnimal < 0,
    global =
      vacant &&
      eligible &&
      !this.drawerSuppressed &&
      (this.drawerPinned || atHandle || (this.globalCard >= 0 && inMenu));
  if (global && this.globalCard < 0) this.globalCard = 0;
  let next = DockView.Handle;
  if (eligible && this.rosterOpen) next = DockView.Roster;
  else if (eligible && ((this.chosen.length > 0 && this.card >= 0) || global)) next = DockView.Build;
  else if (this.chosen.length) next = DockView.Unit;
  else if (this.selected >= 0 || this.selectedDungeon >= 0) next = DockView.Inspector;
  else if (this.selectedTree >= 0 || this.selectedRock >= 0 || this.selectedAnimal >= 0)
    next = DockView.Resource;
  else if (this.tool !== Tool.Select) next = DockView.Placement;
  let target = new Rect(f(f(width - 236) / 2), height - 48, 236, 36),
    key = String(next);
  if (next === DockView.Build) {
    const shared = !this.chosen.length;
    target = this.buildMenuBounds(width, height, shared);
    key += ':' + (shared ? this.globalCard : this.card);
    for (const id of this.chosen) key += ':' + id;
  } else if (next === DockView.Unit) {
    target = this.personPanelBounds(width, height, this.residentSelection());
    for (const id of this.chosen) key += ':' + id;
  } else if (next === DockView.Inspector) {
    target.w = Math.min(620, f(width - 24));
    target.h = Math.min(this.inspector(new Rect(0, 0, target.w, 0), false), Math.max(120, f(height - 180)));
    key += ':' + this.selected + ':' + this.selectedDungeon + ':' + this.residentPage;
  } else if (next === DockView.Resource) {
    target.w = Math.min(420, f(width - 24));
    target.h = 148;
    key += ':' + this.selectedTree + ':' + this.selectedRock + ':' + this.selectedAnimal;
  } else if (next === DockView.Placement) {
    target = this.placementPanelBounds(width, height);
    key += ':' + this.tool;
  } else if (next === DockView.Roster) {
    target = this.rosterBounds(width, height);
    key += ':' + this.rosterTab;
  }
  target.x = f(f(width - target.w) / 2);
  target.y = f(f(height - (next === DockView.Handle ? 12 : 56)) - target.h);
  if (key !== this.dockKey || target.w !== this.dockTarget.w || target.h !== this.dockTarget.h) {
    if (this.dockKey) {
      if (this.dockGhost) {
        const old = this.dockGhost;
        this.context.deferRelease(() => old.dispose());
      }
      this.dockGhost = null;
      if (key !== this.dockKey) {
        this.dockGhost = this.dockContent?.duplicate() ?? null;
        this.dockGhostBounds = copy(this.dockBounds);
      }
      if (this.dockView === DockView.Build && next === DockView.Build)
        this.drawerBridge = copy(this.dockBounds);
      if (key !== this.dockKey) this.context.cancelPointer();
      this.dockFrom = copy(this.dockBounds);
      this.dockStarted = now;
    } else {
      this.dockFrom = copy(target);
      this.dockStarted = -1;
    }
    this.dockKey = key;
    this.dockView = next;
    this.dockTarget = target;
    this.dockDuration = next === DockView.Handle ? f(0.18) : f(0.24);
    if (this.reducedMotion()) this.dockStarted = -1;
    advance();
  }
  this.drawerOpen = this.dockView === DockView.Build;
  if (this.animatingUi()) this.context.requestAnimationFrame();
  else {
    if (this.dockGhost) {
      const old = this.dockGhost;
      this.context.deferRelease(() => old.dispose());
    }
    this.dockGhost = null;
    if (this.dockView === DockView.Handle) this.globalCard = -1;
  }
}
export function renderDockContent(this: GameHudApp, panel: Rect): void {
  const c = this.context,
    t = this.theme;
  switch (this.dockView) {
    case DockView.Handle:
      break;
    case DockView.Build:
      this.commandCard(panel, 1, !this.chosen.length, true);
      break;
    case DockView.Unit:
      this.personPanel(panel);
      break;
    case DockView.Inspector:
      this.inspector(panel);
      break;
    case DockView.Placement:
      this.placementPanel(panel);
      break;
    case DockView.Resource:
      this.worldObjectPanel(panel);
      break;
    case DockView.Roster:
      this.rosterPanel(panel);
      break;
  }
}
export function taskbar(this: GameHudApp, width: number, height: number): void {
  const c = this.context;
  c.rect(
    this.dockBounds,
    this.theme.surface,
    Math.min(this.theme.radius + 2, f(this.dockBounds.h / 2)),
    this.theme.border,
  );
  c.control('context-dock', this.dockBounds, () => {}, true, false);
  const layer = c.layer(this.dockBounds.inset(1), () => {
    if (this.dockGhost && this.dockProgress < f(0.55)) {
      c.add(this.dockGhost);
      const dx = f(
          f(f(this.dockBounds.x + f(this.dockBounds.w / 2)) - this.dockGhostBounds.x) -
            f(this.dockGhostBounds.w / 2),
        ),
        dy = f(
          f(f(f(this.dockBounds.y + this.dockBounds.h) - this.dockGhostBounds.y) - this.dockGhostBounds.h) -
            f(6 * ease(this.dockProgress)),
        );
      setTransform(this.dockGhost, {
        e11: 1,
        e12: 0,
        e13: dx,
        e21: 0,
        e22: 1,
        e23: dy,
        e31: 0,
        e32: 0,
        e33: 1,
      });
      this.dockGhost.opacity(Math.trunc(f(255 * f(1 - ease(clamp(f(this.dockProgress / f(0.55)), 0, 1))))));
    }
    const reveal = this.dockGhost ? ease(clamp(f(f(this.dockProgress - f(0.1)) / f(0.9)), 0, 1)) : 1;
    if (reveal > f(0.01) || this.dockProgress === 1) {
      const body = copy(this.dockTarget);
      body.x = f(f(width - body.w) / 2);
      body.y = f(
        f(f(height - (this.dockView === DockView.Handle ? 12 : 56)) - body.h) + f(8 * f(1 - reveal)),
      );
      c.layer(this.dockBounds.inset(1), () => this.renderDockContent(body), Math.trunc(f(255 * reveal)));
    }
  });
  // Public WebCanvas paints expose duplication, not native ref(). Keep an owned
  // previous-frame snapshot for the same transition instead of retaining a borrowed wrapper.
  this.dockContent?.dispose();
  this.dockContent = layer?.duplicate() ?? null;
  const nav = new Rect(f((width - 236) / 2), height - 48, 236, 36);
  c.rect(nav, this.theme.surface, 3, this.theme.border);
  button(
    c,
    'build-handle',
    new Rect(nav.x + 3, nav.y + 3, 112, 30),
    'Build',
    () => {
      this.selectTool(Tool.Select, true);
      this.selected = this.selectedDungeon = this.selectedTree = this.selectedRock = this.selectedAnimal = -1;
      this.card = this.chosen.length ? 0 : -1;
      this.globalCard = this.chosen.length ? -1 : 0;
      this.drawerPinned = true;
      this.drawerSuppressed = false;
    },
    this.dockView === DockView.Build ? ButtonStyle.Primary : ButtonStyle.Quiet,
  );
  button(
    c,
    'unit-roster',
    new Rect(nav.x + 121, nav.y + 3, 112, 30),
    'Unit',
    () => {
      const open = !this.rosterOpen;
      this.selectTool(Tool.Select, true);
      this.rosterOpen = open;
    },
    this.dockView === DockView.Roster ? ButtonStyle.Primary : ButtonStyle.Quiet,
  );
}

import { describe, it, expect } from 'vitest';
import { GameAppState, DockView } from '../../apps/web/src/native/game-app-state';
import { personPanelBounds } from '../../apps/web/src/native/game-unit-panel';
import { updateContextDock } from '../../apps/web/src/native/game-context-dock';
import { Person, Calling, Role, Race } from '../../packages/engine/src/person';
import { point } from '../../packages/engine/src/geometry';
import { Rect } from '../../packages/native-ui/src';
import type { GameHudApp } from '../../apps/web/src/native/game-hud-contract';

function fixture() {
  const p = new Person(0, 'Askr', Role.Resident, Calling.Settler, Race.Human, 5, point(10, 10));
  const app = new GameAppState(
    { person: () => p } as any,
    {} as any,
    { time: () => 1, cancelPointer() {}, requestAnimationFrame() {} } as any,
  ) as GameHudApp;
  app.chosen = [0];
  app.residentSelection = () => true;
  app.shelteredSelection = () => false;
  app.personPanelBounds = personPanelBounds.bind(app);
  app.buildMenuBounds = () => new Rect(0, 0, 400, 150);
  app.rosterBounds = (w, h) => new Rect((w - 700) / 2, (h - 440) / 2, 700, 440);
  app.reducedMotion = () => true;
  app.animatingUi = () => false;
  return app;
}
describe('selection and Unit management are distinct surfaces', () => {
  it.each([
    [1280, 800],
    [390, 844],
    [844, 390],
  ])('anchors ordinary selection to the bottom at %sx%s', (w, h) => {
    const app = fixture(),
      r = personPanelBounds.call(app, w, h, true);
    expect(r.y + r.h).toBe(h - 12);
    expect(r.h).toBeLessThan(240);
    updateContextDock.call(app, w, h);
    expect(app.dockView).toBe(DockView.Unit);
    expect(app.dockTarget.y + app.dockTarget.h).toBe(h - 12);
  });
  it('centers only the explicitly opened Unit window and returns to bottom selection when closed', () => {
    const app = fixture();
    app.rosterOpen = true;
    updateContextDock.call(app, 1280, 800);
    expect(app.dockView).toBe(DockView.Roster);
    expect(app.dockTarget.y + app.dockTarget.h / 2).toBe(400);
    app.rosterOpen = false;
    updateContextDock.call(app, 1280, 800);
    expect(app.dockView).toBe(DockView.Unit);
    expect(app.dockTarget.y + app.dockTarget.h).toBe(788);
  });
});

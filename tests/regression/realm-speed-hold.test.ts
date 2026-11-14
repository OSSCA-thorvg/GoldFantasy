import { describe, expect, it } from 'vitest';
import * as rendering from '../../apps/web/src/native/game-render';
import { GameAppState } from '../../apps/web/src/native/game-app-state';

// Speed lives on the app (never saved); only the town's realm gate decides the hold, so a loaded game inside a gate is held too.
function app(realmGate = -1) {
  const town = { realmGate, realmActive: () => town.realmGate >= 0 };
  const a = { town, speed: 1, paused: false, ...rendering };
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the speed functions read only town, speed and paused.
  return a as unknown as typeof a & { speed: number; paused: boolean } & typeof rendering;
}

describe('speed beyond a gate', () => {
  it('runs at 1x inside, ignores raising it, keeps pause, and restores the chosen speed on leaving', () => {
    const a = app();
    a.setSpeed(4);
    expect(a.gameSpeed()).toBe(4);
    a.town.realmGate = 2;
    expect(a.speedHeld()).toBe(true);
    expect(a.gameSpeed()).toBe(1);
    a.cycleSpeed();
    a.setSpeed(5);
    expect(a.gameSpeed()).toBe(1);
    a.togglePause();
    expect(a.gameSpeed()).toBe(0);
    a.setSpeed(1);
    expect(a.gameSpeed()).toBe(1);
    a.town.realmGate = -1;
    expect(a.gameSpeed()).toBe(4);
    a.cycleSpeed();
    expect(a.gameSpeed()).toBe(GameAppState.maxSpeed);
  });
  it('a game loaded inside a gate starts held at 1x', () => {
    const a = app(0);
    a.speed = 3;
    expect(a.gameSpeed()).toBe(1);
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { Calling, Role } from '../../packages/engine/src/person';
import { altarCap } from '../../packages/engine/src/altar-cap';
import { GoalBranch, currentGoal, settlementGoals } from '../../packages/engine/src/settlement-progression';
import { TitlePlayer } from '../../apps/web/src/native/title-player';
import { TitleDirector, watchable } from '../../apps/web/src/native/title-director';
import { titleOrders, titleReadings } from '../../apps/web/src/native/title-orders';
import { titlePace } from '../../apps/web/src/native/title-session';

// The title's own player plays real new games, through a spy that lets it read and order but never write the
// town; the director frames each moment. The world beyond the spy runs the ordinary rules: raids, Thor, hunger.
const plain = (_key: string, value: unknown) => (typeof value === 'bigint' ? String(value) : value);
interface Call {
  name: string;
  key: string;
  result: unknown;
}
/** A read-only view of `target`: methods run on the real object, every write throws, every call is recorded. */
function spyOn(town: Town, calls: Call[], deep = true): Town {
  const real = new WeakMap<object, object>(),
    views = new WeakMap<object, object>();
  const unwrap = (value: unknown): unknown => {
    if (value && typeof value === 'object') {
      const raw = real.get(value);
      if (raw) return raw;
      if (Array.isArray(value)) return value.map(unwrap);
      if (Object.getPrototypeOf(value) === Object.prototype)
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unwrap(v)]));
    }
    return value;
  };
  const view = <T>(value: T, top = false): T => {
    if (!value || typeof value !== 'object' || (!deep && !top)) return value;
    const known = views.get(value);
    if (known) return known as T;
    const proxy = new Proxy(value, {
      get(target, prop, receiver) {
        const field = Reflect.get(target, prop, receiver);
        if (typeof field !== 'function') return view(field);
        // Array methods run on the view itself, so their callbacks see read-only elements too.
        if (Array.isArray(target)) return field;
        return (...args: unknown[]) => {
          const result = field.apply(target, args.map(unwrap));
          if (top && typeof prop === 'string') calls.push({ name: prop, key: JSON.stringify(args.map(unwrap), plain), result });
          return view(result);
        };
      },
      set(_target, prop) {
        throw new Error(`The title player wrote ${String(prop)}`);
      },
      defineProperty(_target, prop) {
        throw new Error(`The title player defined ${String(prop)}`);
      },
      deleteProperty(_target, prop) {
        throw new Error(`The title player deleted ${String(prop)}`);
      },
    });
    real.set(proxy, value);
    views.set(value, proxy);
    return proxy;
  };
  return view(town, true);
}
interface Run {
  seed: number;
  world: number;
  days: number;
  coreDay: number;
  population: number;
  cap: number;
  fighters: string[];
  raids: number;
  sentDay: number;
  endedDay: number;
  cleared: number;
  withdrew: number;
  fallenAtHome: number;
  fallenBeyond: number;
  calls: Call[];
  badFrames: string[];
  refusedTwice: string[];
  digest: string;
  ms: number;
  core: string;
  /** Residents and altar cap when the first party set out. */
  peopleAtSend: number;
  capAtSend: number;
}
const playerCost = { ms: 0, steps: 0 };
function play(world: number, seed: number, days: number, stopAfterExpedition = true, deep = true): Run {
  const town = new Town(world),
    calls: Call[] = [],
    player = new TitlePlayer(seed),
    view = spyOn(town, calls, deep),
    director = new TitleDirector(),
    badFrames: string[] = [];
  town.awaiting = true;
  town.titleShowcase = true;
  const run: Run = {
    seed, world, days: 0, coreDay: -1, population: 0, cap: 0, fighters: [], raids: 0, sentDay: -1, endedDay: -1,
    cleared: 0, withdrew: 0, fallenAtHome: 0, fallenBeyond: 0, calls, badFrames, refusedTwice: [], digest: '', ms: 0, core: '', peopleAtSend: 0, capAtSend: 0,
  };
  const started = performance.now(),
    sentIds = new Set<number>();
  let frame = 0;
  while (town.clock() < days * 300) {
    // A quarter-second title frame at the session's pace.
    town.advance(0.25 * titlePace(town));
    const t0 = performance.now(),
      before = player.steps;
    player.update(view);
    if (player.steps !== before) {
      playerCost.ms += performance.now() - t0;
      ++playerCost.steps;
    }
    if (++frame % 4 === 0) {
      director.update(town, 1280, 720, 1);
      const s = director.subject();
      if (s) {
        const p = s.person;
        const at = p && director.still(town, s) ? p.position : s.at;
        if (!watchable(town, at)) badFrames.push(`${frame}: ${s.key} off revealed land`);
        if (s.key !== 'realm' && town.inRealm(at)) badFrames.push(`${frame}: ${s.key} looks beyond the gate for a home subject`);
        const followed = director.person(town);
        if (followed && (followed.health <= 0 || followed.inside || followed.downedAt >= 0))
          badFrames.push(`${frame}: ${s.key} follows the fallen or the indoors`);
      }
    }
    for (const id of player.party.members) sentIds.add(id);
    const day = town.clock() / 300;
    if (run.coreDay < 0 && currentGoal(town, GoalBranch.Core) < 0) run.coreDay = day;
    if (run.sentDay < 0 && player.party.sent) {
      run.sentDay = day;
      run.peopleAtSend = town.population();
      run.capAtSend = altarCap(town);
    }
    if (run.endedDay < 0 && player.party.cleared + player.party.withdrew > 0) run.endedDay = day;
    if (stopAfterExpedition && run.endedDay >= 0 && day > run.endedDay + 0.5) break;
  }
  const folk = town.people().filter((p) => p.role === Role.Resident && p.faction === 0 && p.health > 0);
  Object.assign(run, {
    days: town.clock() / 300,
    population: folk.length,
    cap: altarCap(town),
    fighters: folk.filter((p) => p.calling >= Calling.Warrior).map((p) => `${Calling[p.calling]} ${p.level}`),
    raids: town.raids(),
    cleared: player.party.cleared,
    withdrew: player.party.withdrew,
    fallenAtHome: town.fallen.filter((f) => !sentIds.has(f.id)).length,
    fallenBeyond: town.fallen.filter((f) => sentIds.has(f.id)).length,
    ms: performance.now() - started,
    core: settlementGoals()[currentGoal(town, GoalBranch.Core)]?.title ?? 'done',
    digest: JSON.stringify([town.clock(), town.buildings().map((b) => [b.kind, b.center.x, b.center.y]), folk.map((p) => [p.id, p.level, p.position.x])]),
  });
  // The same order refused twice with nothing accepted between.
  const last = new Map<string, unknown>();
  for (const c of calls) {
    // setWorkers answers whether the staff moved at once, not whether the count was taken.
    if (!(titleOrders as readonly string[]).includes(c.name) || c.name === 'setWorkers') continue;
    const id = c.name + c.key;
    const refused = c.result === false || c.result === 0;
    if (refused && last.get(id) === false) run.refusedTwice.push(id);
    last.set(id, refused ? false : true);
  }
  return run;
}

const runs: Run[] = [];
beforeAll(() => {
  // The first run reads through a deep read-only view; the others only record their calls, to keep the suite quick.
  for (const [world, seed, deep] of [
    [5, 101, 1],
    [5, 202, 0],
    [11, 303, 0],
  ])
    runs.push(play(world, seed, 22, true, deep === 1));
  console.log(
    runs
      .map(
        (r) =>
          `world ${r.world} seed ${r.seed}: refused twice ${r.refusedTwice.join(' ')}; founding chain day ${r.coreDay.toFixed(1)} (now ${r.core}), ${r.peopleAtSend}/${r.capAtSend} residents when the party left, ${r.population}/${r.cap} at the end, fighters [${r.fighters.join(', ')}], ${r.raids} raids, party sent day ${r.sentDay.toFixed(1)} ended day ${r.endedDay.toFixed(1)} (cleared ${r.cleared}, withdrew ${r.withdrew}), fallen ${r.fallenAtHome} at home and ${r.fallenBeyond} beyond, ${r.calls.length} calls, ${(r.ms / 1000).toFixed(1)} s`,
      )
      .join('\n') + `\nplayer decision: ${(playerCost.ms / Math.max(1, playerCost.steps)).toFixed(3)} ms a step over ${playerCost.steps} steps`,
  );
}, 600000);

describe('the title player', () => {
  it('completes the founding chain, fills the altar cap and survives the raids', () => {
    for (const r of runs) {
      expect(r.coreDay, `world ${r.world} seed ${r.seed}`).toBeGreaterThan(0);
      expect(r.coreDay).toBeLessThan(16);
      expect(r.peopleAtSend).toBeGreaterThanOrEqual(r.capAtSend - 1);
      expect(r.raids).toBeGreaterThan(0);
      // A raid may claim one resident; the settlement lives on.
      expect(r.fallenAtHome).toBeLessThanOrEqual(1);
    }
  });
  it('sends a party the forecast calls ready, which clears its floor or comes home alive', () => {
    for (const r of runs) {
      expect(r.sentDay, `world ${r.world} seed ${r.seed}`).toBeGreaterThan(0);
      expect(r.endedDay).toBeGreaterThan(r.sentDay);
      expect(r.cleared + r.withdrew).toBeGreaterThan(0);
      expect(r.fallenBeyond).toBe(0);
    }
  });
  it('only reads and gives orders, and never repeats a refused order', () => {
    const allowed = new Set<string>([...titleOrders, ...titleReadings]);
    for (const r of runs) {
      expect([...new Set(r.calls.map((c) => c.name))].filter((n) => !allowed.has(n))).toEqual([]);
      expect(r.refusedTwice).toEqual([]);
      expect(r.calls.some((c) => c.name === 'place')).toBe(true);
    }
  });
  it('keeps the camera on living, outdoor subjects over revealed land', () => {
    for (const r of runs) expect(r.badFrames.slice(0, 5)).toEqual([]);
  });
  it('plays the same game for the same seed', () => {
    const a = play(5, 404, 3, false),
      b = play(5, 404, 3, false);
    expect(a.digest).toBe(b.digest);
    expect(a.calls.map((c) => c.name + c.key)).toEqual(b.calls.map((c) => c.name + c.key));
  });
});

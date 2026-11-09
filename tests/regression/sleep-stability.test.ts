import { beforeAll, describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { Person, Role, Calling, Race, Activity, Monster, AnimalKind } from '../../packages/engine/src/person';
import { Structure, Resources } from '../../packages/engine/src/building-catalog';
import { Building } from '../../packages/engine/src/town-models';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Terrain, Layer, DungeonKind } from '../../packages/engine/src/world-types';
import { point, distance, add } from '../../packages/engine/src/geometry';
import { copyNative } from '../../packages/engine/src/native-copy';
import { enter } from '../../packages/engine/src/town-residents';
import { encodeTown, decodeTown } from '../../packages/engine/src/save-game';

let base: Town;
beforeAll(() => {
  const world = WorldMap.generate(5, 64, 64);
  world.ymir = world.fire = null;
  world.sites = [];
  world.stream = { path: [], width: [] };
  for (const layer of world.layers) layer.fill(0.4);
  world.layer(Layer.Land).fill(1);
  world.layer(Layer.Ridge).fill(-1);
  for (let y = 0; y < 64; ++y)
    for (let x = 0; x < 64; ++x)
      Object.assign(world.at(x, y), { terrain: Terrain.Grass, trees: 0, revealed: true, dungeon: -1 });
  world.reveal(32, 32, 100);
  base = new Town(world, 64, false);
  base.wildlifeDay = 0;
  const home = new Building(0, Structure.Camp, point(30, 30), 0, 0);
  base.placed.push(home);
  base.nextId = 1;
  base.migrateSettlements();
  Object.assign(base.stock(), new Resources(1000, 1000, 1000, 1000, 1000, 1000));
  const p = new Person(0, 'Resting resident', Role.Resident, Calling.Settler, Race.Human, 0, home.door());
  p.home = p.village = home.id;
  p.food = p.rest = p.health = p.hydration = 1;
  base.folk = [p];
  base.nextPerson = 1;
  base.editHour(12);
  base.tick(0);
});

function fixture() {
  return copyNative(base);
}
function trace(town: Town, seconds: number) {
  const p = town.people()[0],
    transitions: string[] = [];
  let previous = '';
  for (let i = 0; i < seconds * 10; ++i) {
    // Ambient spawning is isolated; explicit combat cases supply their own enemy.
    town.wildlifeDay = town.days;
    town.advance(0.1);
    const state = `${Activity[p.activity]}:${p.inside}:${p.moving()}`;
    if (state !== previous) {
      transitions.push(
        `${town.clock().toFixed(1)} ${state} rest=${p.rest.toFixed(3)} health=${p.health.toFixed(3)} night=${town.climate().night.toFixed(3)}`,
      );
      previous = state;
    }
  }
  return transitions;
}

describe('sleep state stability', () => {
  it.each([0.1, 0.3, 0.49])(
    'clears completed automatic recovery before doorway fatigue (schedule offset %s)',
    (offset) => {
      const town = fixture(),
        p = town.people()[0],
        home = town.camp()!;
      const building = new Building(town.nextId++, Structure.Tent, point(34, 34), 0, 0);
      building.village = 0;
      building.progress = 0;
      town.placed.push(building);
      ++town.changes;
      p.task = Activity.Building;
      p.taskSite = building.id;
      p.activity = Activity.Sleeping;
      p.target = home.id;
      p.rest = 0.9492;
      p.recoveringRest = true;
      p.path = [];
      enter(p, home.threshold());
      p.doorway = 1;
      p.position = home.threshold();
      p.scheduleAt = town.clock() + offset;
      const states = trace(town, 10);
      expect(
        states.filter((s) => s.includes('Sleeping:')),
        states.join('\n'),
      ).toEqual([]);
      expect(p.recoveringRest).toBe(false);
      expect(p.taskSite).toBe(building.id);
      expect(building.progress).toBeGreaterThan(0);
    },
  );

  it.each([true, false])('finishes direct daytime rest at the recovery boundary (Auto=%s)', (auto) => {
    const town = fixture(),
      p = town.people()[0];
    town.setAuto(p.id, auto);
    p.rest = 0.949;
    expect(town.orderRest([p.id], p.home)).toBe(true);
    const states = trace(town, 10);
    expect(p.ordered, states.join('\n')).toBe(false);
    expect(p.task, states.join('\n')).not.toBe(Activity.Sleeping);
    expect(p.autoMode).toBe(true);
    expect(
      states.filter((s) => s.includes('Sleeping:true:false')),
      states.join('\n'),
    ).toHaveLength(1);
  });

  it('keeps an explicit home rest until its outstanding health recovery completes', () => {
    const town = fixture(),
      p = town.people()[0];
    p.health = 0.8;
    expect(town.orderRest([p.id], p.home)).toBe(true);
    const states = trace(town, 20);
    expect(
      states.filter((s) => s.includes('Idle:')),
      states.join('\n'),
    ).toEqual([]);
    expect(p.activity).toBe(Activity.Sleeping);
    expect(p.inside).toBe(true);
    expect(p.health).toBeGreaterThan(0.8);
    trace(town, 420);
    expect(p.health).toBe(1);
    expect(p.ordered).toBe(false);
    expect(p.task).toBe(Activity.Idle);
  });

  it.each([0.8, 0.3])(
    'releases an impossible direct recovery without repeatedly waking automatic care (health=%s)',
    (health) => {
      const town = fixture(),
        p = town.people()[0];
      town.setAuto(p.id, false);
      p.health = health;
      p.food = 0.2;
      town.stock().food = 0;
      expect(town.orderRest([p.id], p.home)).toBe(true);
      const states = trace(town, 20);
      expect(p.ordered, states.join('\n')).toBe(false);
      expect(p.autoMode).toBe(true);
      expect(p.task).toBe(Activity.Idle);
      if (health < 0.4) {
        expect(p.recoveringHealth).toBe(true);
        expect(p.activity).toBe(Activity.Sleeping);
        expect(
          states.filter((s) => s.includes('Idle:')),
          states.join('\n'),
        ).toHaveLength(1);
      } else expect(p.activity).not.toBe(Activity.Sleeping);
    },
  );

  it.each([true, false])(
    'pauses injured direct rest for a meal when hunger prevents healing (Auto=%s)',
    (auto) => {
      const town = fixture(),
        p = town.people()[0],
        food = town.stock().food;
      town.setAuto(p.id, auto);
      p.health = 0.8;
      p.food = 0.35;
      expect(town.orderRest([p.id], p.home)).toBe(true);
      const states = trace(town, 20);
      expect(
        states.some((s) => s.includes('Eating:')),
        states.join('\n'),
      ).toBe(true);
      expect(town.stock().food).toBe(food - 1);
      expect(p.food).toBeGreaterThan(0.9);
      expect(p.health).toBeGreaterThan(0.8);
      expect(p.activity).toBe(Activity.Sleeping);
      expect(p.ordered).toBe(true);
    },
  );

  it.each([true, false])(
    'completes direct rest at night without leaving and reentering (Auto=%s)',
    (auto) => {
      const town = fixture(),
        p = town.people()[0];
      town.editHour(0);
      town.setAuto(p.id, auto);
      p.rest = 0.949;
      expect(town.orderRest([p.id], p.home)).toBe(true);
      const states = trace(town, 20);
      expect(
        states.filter((s) => s.includes('Sleeping:true:false')),
        states.join('\n'),
      ).toHaveLength(1);
      expect(
        states.filter((s) => s.includes('Idle:')),
        states.join('\n'),
      ).toEqual([]);
      expect(p.ordered).toBe(false);
      expect(p.autoMode).toBe(true);
      expect(p.task).toBe(Activity.Idle);
      town.editHour(12);
      const morning = trace(town, 10);
      expect(
        morning.some((s) => s.includes('Sleeping:')),
        morning.join('\n'),
      ).toBe(false);
      expect(p.inside).toBe(false);
    },
  );

  it('hunts, stores surplus and eats before resuming an injured direct rest with an empty pantry', () => {
    const town = fixture(),
      p = town.people()[0];
    p.health = 0.8;
    p.food = 0.35;
    town.stock().food = 0;
    const prey = new Monster(99, -1, add(p.position, point(0.7, 0)));
    prey.animal = AnimalKind.Chicken;
    prey.health = 1;
    prey.home = { ...prey.position };
    town.animals.push(prey);
    town.setAuto(p.id, false);
    expect(town.orderRest([p.id], p.home)).toBe(true);
    const states = trace(town, 30);
    expect(
      states.some((s) => s.includes('Fighting:')),
      states.join('\n'),
    ).toBe(true);
    expect(
      states.some((s) => s.includes('Hauling:')),
      states.join('\n'),
    ).toBe(true);
    expect(
      states.some((s) => s.includes('Eating:')),
      states.join('\n'),
    ).toBe(true);
    expect(town.stock().food).toBe(3);
    expect(p.carrying).toBe(0);
    expect(p.food).toBeGreaterThan(0.9);
    expect(p.health).toBeGreaterThan(0.8);
    expect(p.activity).toBe(Activity.Sleeping);
    expect(p.ordered).toBe(true);
    expect(p.taskSite).toBe(p.home);
  });

  it('recovers daytime exhaustion once and resumes its existing workplace', () => {
    const town = fixture(),
      p = town.people()[0];
    town.editHour(7);
    p.scheduleAt = town.clock();
    const workshop = new Building(town.nextId++, Structure.Sawmill, point(35, 34), 0, 0);
    workshop.village = 0;
    town.placed.push(workshop);
    ++town.changes;
    expect(town.assignJob([p.id], workshop.id)).toBe(true);
    trace(town, 10);
    expect(p.ordered).toBe(false);
    p.rest = 0.1;
    const states = trace(town, 125);
    expect(
      states.filter((s) => s.includes('Sleeping:true:false')),
      states.join('\n'),
    ).toHaveLength(1);
    expect(p.recoveringRest, states.join('\n')).toBe(false);
    expect(p.inside).toBe(false);
    expect(p.activity, states.join('\n')).toBe(Activity.Working);
    expect(p.job).toBe(workshop.id);
    expect(p.taskSite).toBe(workshop.id);
  });

  it('resumes the same direct rest after an enemy interruption without restarting the doorway loop', () => {
    const town = fixture(),
      p = town.people()[0],
      home = town.camp()!;
    p.health = 0.8;
    expect(town.orderRest([p.id], p.home)).toBe(true);
    trace(town, 3);
    town.world.sites.push({
      kind: DungeonKind.Cave,
      name: 'Test enemy lair',
      origin: { x: 50, y: 50 },
      discovered: false,
    });
    const enemy = new Monster(88, 0, add(home.door(), point(0.3, 0)));
    enemy.angry = true;
    enemy.health = 1;
    enemy.home = { ...enemy.position };
    enemy.provokedBy = p.id;
    town.beasts.push(enemy);
    const states = trace(town, 20);
    expect(
      states.some((s) => s.includes('Fighting:')),
      states.join('\n'),
    ).toBe(true);
    expect(
      states.filter((s) => s.includes('Sleeping:true:false')),
      states.join('\n'),
    ).toHaveLength(1);
    expect(p.activity).toBe(Activity.Sleeping);
    expect(p.ordered).toBe(true);
    expect(p.taskSite).toBe(home.id);
  });

  it.each([false, true])('preserves stable rest after a save/load during recovery (direct=%s)', (direct) => {
    const town = fixture(),
      p = town.people()[0];
    if (direct) {
      p.health = 0.8;
      expect(town.orderRest([p.id], p.home)).toBe(true);
    } else {
      p.rest = 0.1;
      town.scheduleAutomatic(p);
    }
    trace(town, 3);
    const loaded = decodeTown(encodeTown(town), (map) => new Town(map, 64, false, true)),
      resident = loaded.people()[0];
    const states = trace(loaded, 20);
    expect(
      states.filter((s) => s.includes('Idle:')),
      states.join('\n'),
    ).toEqual([]);
    expect(resident.activity).toBe(Activity.Sleeping);
    expect(resident.inside).toBe(true);
    expect(resident.ordered).toBe(direct);
    if (!direct) expect(resident.recoveringRest).toBe(true);
  });

  it('sleeps once per night across three ordinary days and returns to daytime work', () => {
    const town = fixture(),
      p = town.people()[0];
    const workshop = new Building(town.nextId++, Structure.Sawmill, point(35, 34), 0, 0);
    workshop.village = 0;
    town.placed.push(workshop);
    ++town.changes;
    expect(town.assignJob([p.id], workshop.id)).toBe(true);
    const states = trace(town, 900),
      sleeping = states.filter((s) => s.includes('Sleeping:'));
    expect(
      sleeping.filter((s) => s.includes('Sleeping:true:false')),
      states.join('\n'),
    ).toHaveLength(3);
    expect(
      sleeping.filter((s) => s.includes('Sleeping:false:true')),
      states.join('\n'),
    ).toHaveLength(3);
    expect(states.filter((s) => s.includes('Working:false:false'))).toHaveLength(4);
    expect(p.inside).toBe(false);
    expect(distance(p.position, workshop.door())).toBeLessThan(1);
  });
});

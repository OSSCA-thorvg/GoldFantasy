import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Layer, Terrain, DungeonKind, makeTile } from '../../packages/engine/src/world-types';
import { Activity, Person, Role, Calling, Race, Monster } from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { Resources, Structure } from '../../packages/engine/src/building-catalog';
import { point, add, distance } from '../../packages/engine/src/geometry';
import { sharpAnchor } from '../../packages/engine/src/road-network';
import { NeutralSettlement } from '../../packages/engine/src/neutral-state';
import { neutralContext } from '../../packages/engine/src/neutral-context';
import { encodeTown, decodeTown } from '../../packages/engine/src/save-game';
function fixture() {
    const map = new WorldMap();
    map.columns = map.rows = 48;
    map.mapSeed = 5;
    map.origin = { x: 12, y: 12 };
    map.tiles = Array.from({ length: 48 * 48 }, () => ({ ...makeTile(), terrain: Terrain.Grass, revealed: true }));
    map.layers = Array.from({ length: Layer.Count }, () => new Float32Array(97 * 97).fill(.4));
    map.layer(Layer.Land).fill(1);
    map.layer(Layer.Ridge).fill(-1);
    map.sites = [{ name: 'Raid source', kind: DungeonKind.Cave, origin: { x: 38, y: 38 }, discovered: true }];
    map.reveal(24, 24, 100);
    const town = new Town(map, 48, false), camp = new Building(0, Structure.Camp, point(12, 12), 0, 0);
    town.placed.push(camp);
    town.nextId = 1;
    town.migrateSettlements();
    Object.assign(town.stock(), new Resources(200, 60, 60, 60, 0, 60, 20, 20));
    const p = new Person(0, 'Defender', Role.Resident, Calling.Settler, Race.Human, 0, point(15, 15));
    p.home = p.village = 0;
    p.food = p.rest = p.health = p.hydration = 1;
    p.stress = 0;
    town.folk = [p];
    town.nextPerson = 1;
    town.editHour(12);
    town.wildlifeDay = town.days;
    town.tick(0);
    p.path = [];
    p.activity = p.task = Activity.Idle;
    p.until = town.time;
    return { town, p };
}
function step(town: Town, seconds: number) {
    for (let i = 0; i < Math.ceil(seconds * 10); ++i) {
        town.wildlifeDay = town.days;
        town.advance(.1);
    }
}
function enemy(town: Town, p: Person, offset = point(.5, 0)) {
    const foe = new Monster(town.nextMonster++, 0, add(p.position, offset));
    foe.home = { ...foe.position };
    foe.health = 1;
    foe.raider = true;
    foe.ready = town.time + 100;
    town.beasts.push(foe);
    return foe;
}
function road(town: Town) {
    expect(town.buildRoad([sharpAnchor(point(13.2, 12)), sharpAnchor(point(20, 12))])).toBe(true);
    return town.network.list.at(-1)!;
}
function state(p: Person) { return JSON.stringify({ activity: Activity[p.activity], task: Activity[p.task], ordered: p.ordered, auto: p.autoMode, approaching: p.approachingOrder, goal: p.goal, at: p.position, path: p.path, foe: p.foe }); }
describe('combat completion and interrupted orders', () => {
    for (const auto of [false, true])
        for (const approach of [false, true])
            it(`returns direct Attack to Auto after the last enemy dies (auto=${auto}, approach=${approach})`, () => {
                const { town, p } = fixture(), r = road(town), foe = enemy(town, p);
                town.setAuto(p.id, auto);
                expect(town.orderAttack([p.id], foe.id)).toBe(true);
                if (approach)
                    town.approachOrder([p.id], foe.position);
                step(town, 5);
                expect(foe.health).toBeLessThanOrEqual(0);
                expect(p.autoMode, state(p)).toBe(true);
                expect(p.ordered, state(p)).toBe(false);
                expect(p.task, state(p)).toBe(Activity.Roadwork);
                expect(p.taskSite).toBe(r.id);
                expect(p.foe).toBe(-1);
                step(town, 15);
                expect(r.built).toBeGreaterThan(0);
            });
    for (const kind of ['building', 'road', 'gather', 'move'] as const)
        for (const direct of kind === 'move' ? [true] : [false, true])
            it(`resumes the original ${kind} after a wave (direct=${direct})`, () => {
                const { town, p } = fixture();
                if (kind === 'building') {
                    const b = new Building(town.nextId++, Structure.Tent, point(19, 16), 0, 0);
                    b.village = 0;
                    b.progress = 0;
                    town.placed.push(b);
                    ++town.changes;
                    if (direct)
                        expect(town.orderBuild([p.id], b.id)).toBe(true);
                    else
                        town.scheduleAutomatic(p);
                }
                else if (kind === 'road')
                    expect(town.orderRoadwork([p.id], road(town).id)).toBe(true);
                else if (kind === 'gather') {
                    town.world.at(19, 16).trees = 2;
                    expect(town.orderChop([p.id], 16 * 48 + 19)).toBe(true);
                }
                else
                    town.orderMove([p.id], point(23, 18));
                p.ordered = direct;
                const task = p.task, site = p.taskSite, goal = { ...p.goal }, foe = enemy(town, p);
                town.advance(.1);
                expect(p.activity, state(p)).toBe(Activity.Fighting);
                step(town, .5);
                expect(foe.health).toBeLessThanOrEqual(0);
                expect(p.task, state(p)).toBe(task);
                expect(p.taskSite).toBe(site);
                expect(p.activity, state(p)).not.toBe(Activity.Idle);
                expect(p.foe).toBe(-1);
                if (kind === 'move')
                    expect(p.goal).toEqual(goal);
                if (kind === 'building') {
                    step(town, 15);
                    expect(town.building(site)!.progress, state(p)).toBeGreaterThan(0);
                }
            });
    it('does not walk to an obsolete click after another fighter kills the direct target', () => {
        const { town, p } = fixture(), foe = enemy(town, p, point(6, 0));
        town.setAuto(p.id, false);
        expect(town.orderAttack([p.id], foe.id)).toBe(true);
        town.approachOrder([p.id], foe.position);
        foe.health = 0;
        town.advance(.1);
        expect(p.autoMode, state(p)).toBe(true);
        expect(p.ordered).toBe(false);
        expect(p.approachingOrder).toBe(false);
        expect(p.foe).toBe(-1);
        expect(p.task).not.toBe(Activity.Fighting);
        expect(distance(p.position, foe.position)).toBeGreaterThan(5);
    });
    it('finishes the remaining wave before returning a completed direct Attack to Auto', () => {
        const { town, p } = fixture(), first = enemy(town, p), last = enemy(town, p, point(-.5, 0)), r = road(town);
        town.setAuto(p.id, false);
        expect(town.orderAttack([p.id], first.id)).toBe(true);
        town.advance(.1);
        expect(first.health).toBeLessThanOrEqual(0);
        expect(last.health).toBeGreaterThan(0);
        town.advance(.1);
        expect(p.activity).toBe(Activity.Fighting);
        expect(p.foe).toBe(last.id);
        step(town, 3);
        expect(last.health).toBeLessThanOrEqual(0);
        expect(p.autoMode, state(p)).toBe(true);
        expect(p.ordered).toBe(false);
        expect(p.foe).toBe(-1);
        expect(p.taskSite).toBe(r.id);
        expect(p.task).toBe(Activity.Roadwork);
    });
    it('clears a completed person Attack and returns to automatic work', () => {
        const { town, p } = fixture(), victim = new Person(1, 'Target', Role.Resident, Calling.Settler, Race.Human, 0, add(p.position, point(.5, 0))), r = road(town);
        victim.home = victim.village = 0;
        victim.health = .04;
        town.folk.push(victim);
        town.orderStop([victim.id]);
        town.setAuto(p.id, false);
        expect(town.orderAttackPerson([p.id], victim.id)).toBe(true);
        step(town, 3);
        expect(town.person(victim.id)).toBeNull();
        expect(p.attackPerson).toBe(-1);
        expect(p.foe).toBe(-1);
        expect(p.autoMode, state(p)).toBe(true);
        expect(p.ordered).toBe(false);
        expect(p.task).toBe(Activity.Roadwork);
        expect(p.taskSite).toBe(r.id);
    });
    it('resumes a saved automatic construction approach when its combat target is already gone', () => {
        const { town, p } = fixture(), site = new Building(town.nextId++, Structure.Tent, point(19, 16), 0, 0);
        site.progress = 0;
        site.village = 0;
        town.placed.push(site);
        ++town.changes;
        town.scheduleAutomatic(p);
        const foe = enemy(town, p);
        town.advance(.1);
        expect(p.activity).toBe(Activity.Fighting);
        expect(p.approachingOrder).toBe(true);
        town.beasts = [];
        const loaded = decodeTown(encodeTown(town), map => new Town(map, 48, false, true));
        step(loaded, 15);
        expect(loaded.building(site.id)!.progress, state(loaded.person(p.id)!)).toBeGreaterThan(0);
    });
    it('returns to explicit Stop after defensive combat rather than inventing a new order', () => {
        const { town, p } = fixture();
        town.orderStop([p.id]);
        const foe = enemy(town, p);
        step(town, 2);
        expect(foe.health).toBeLessThanOrEqual(0);
        expect(p.autoMode).toBe(false);
        expect(p.activity).toBe(Activity.Holding);
        expect(p.path).toHaveLength(0);
        expect(p.foe).toBe(-1);
    });
    it('resumes neutral construction through its own scoped defender context', () => {
        const { town, p } = fixture();
        p.faction = 1;
        town.placed[0].faction = 1;
        town.villages[0].faction = 1;
        const settlement = new NeutralSettlement(1, p.id, { ...p.position });
        settlement.camp = 0;
        settlement.builder = p.id;
        const site = new Building(town.nextId++, Structure.Tent, point(19, 16), 0, 0);
        site.faction = 1;
        site.village = 0;
        site.progress = 0;
        town.placed.push(site);
        ++town.changes;
        const ctx = neutralContext(town, settlement);
        ctx.scheduleAutomatic(p);
        const foe = enemy(town, p);
        step(ctx, 15);
        expect(foe.health).toBeLessThanOrEqual(0);
        expect(site.progress, state(p)).toBeGreaterThan(0);
        expect(p.faction).toBe(1);
        expect(ctx.controlFaction).toBe(1);
        expect(town.controlFaction).toBe(0);
    });
    it('does not interrupt stress recovery for combat', () => {
        const { town, p } = fixture(), foe = enemy(town, p);
        p.stressRecovery = true;
        p.stress = .7;
        p.activity = Activity.Sleeping;
        town.fight(p, .1);
        expect(foe.health).toBe(1);
        expect(p.activity).toBe(Activity.Sleeping);
    });
    for (const guard of ['stress', 'foreign'] as const)
        it(`rejects attack commands for a ${guard} resident`, () => {
            const { town, p } = fixture(), foe = enemy(town, p);
            if (guard === 'stress')
                p.stressRecovery = true;
            else
                p.faction = 1;
            expect(town.orderAttack([p.id], foe.id)).toBe(false);
            expect(p.task).toBe(Activity.Idle);
            const victim = new Person(1, 'Victim', Role.Resident, Calling.Settler, Race.Human, 0, point(16, 15));
            town.folk.push(victim);
            expect(town.orderAttackPerson([p.id], victim.id)).toBe(false);
        });
});

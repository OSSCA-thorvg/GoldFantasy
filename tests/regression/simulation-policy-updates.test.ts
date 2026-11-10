import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Layer, Terrain, makeTile } from '../../packages/engine/src/world-types';
import { Activity, Person, Role, Calling, Race } from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { Resources, Structure, Product } from '../../packages/engine/src/building-catalog';
import { point, distance } from '../../packages/engine/src/geometry';
import { sharpAnchor } from '../../packages/engine/src/road-network';
import * as mining from '../../packages/engine/src/mining';
import { automaticConstructionAllowed } from '../../packages/engine/src/automatic-work';
import { harvestDuration } from '../../packages/engine/src/work-timing';
import { copyNative } from '../../packages/engine/src/native-copy';
import { dispatchWork, queueWork, type GameCommandApp } from '../../apps/web/src/native/game-commands';
import { buildingWorkSpot } from '../../packages/engine/src/person-navigation';
import { enter } from '../../packages/engine/src/town-residents';
function fixture(size = 64) {
    const map = new WorldMap();
    map.columns = map.rows = size;
    map.mapSeed = 5;
    map.origin = { x: 12, y: 12 };
    map.tiles = Array.from({ length: size * size }, () => ({ ...makeTile(), terrain: Terrain.Grass, revealed: true }));
    map.layers = Array.from({ length: Layer.Count }, () => new Float32Array((size * 2 + 1) ** 2).fill(.4));
    map.layer(Layer.Land).fill(1);
    map.layer(Layer.Ridge).fill(-1);
    map.sites = [];
    map.reveal(size / 2, size / 2, size * 2);
    const town = new Town(map, size, false), camp = new Building(0, Structure.Camp, point(12, 12), 0, 0);
    town.placed.push(camp);
    town.nextId = 1;
    town.migrateSettlements();
    Object.assign(town.stock(), new Resources(1000, 100, 100, 100, 0, 100, 50, 50));
    const p = new Person(0, 'Worker', Role.Resident, Calling.Settler, Race.Human, 0, point(14, 12));
    p.home = p.village = 0;
    p.food = p.rest = p.hydration = p.health = 1;
    p.stress = 0;
    town.folk = [p];
    town.nextPerson = 1;
    town.animals = [];
    town.beasts = [];
    town.editHour(12);
    town.wildlifeDay = town.days;
    town.tick(0);
    p.path = [];
    p.task = p.activity = Activity.Idle;
    p.until = town.time;
    return { town, p, camp };
}
function site(town: Town, x: number, y: number) {
    const b = new Building(town.nextId++, Structure.Tent, point(x, y), 0, 0);
    b.progress = 0;
    b.village = 0;
    town.placed.push(b);
    ++town.changes;
    return b;
}
function step(town: Town, seconds: number) { for (let i = 0; i < seconds * 10; i++) {
    town.wildlifeDay = town.days;
    town.advance(.1);
} }
function road(town: Town, from = point(13.2, 12), to = point(23, 12)) {
    expect(town.buildRoad([from, to].map(sharpAnchor))).toBe(true);
    return town.network.list.at(-1)!;
}
function state(p: Person) { return JSON.stringify({ activity: Activity[p.activity], task: Activity[p.task], site: p.taskSite, target: p.target, position: p.position, path: p.path }); }
function equip(p: Person, item: string) { p.inventory[0] = { item, quantity: 1 }; p.equipment.tool1 = 1; }
function appFor(town: Town) {
    const app = { town, workQueue: [], workSerial: 0n, lastDispatch: -1, stoppedWork: new Map() } as unknown as GameCommandApp;
    app.dispatchWork = dispatchWork.bind(app);
    app.queueWork = queueWork.bind(app);
    return app;
}
describe('local persistent work and replenishment', () => {
    it('does not teleport from a road endpoint to its midpoint when construction completes', () => {
        const { town, p } = fixture(), r = road(town);
        r.materials.delivered.add(r.materials.required);
        r.built = .999;
        town.roadChanged();
        town.tick(0);
        p.position = r.workPoint();
        town.orderRoadwork([p.id], r.id);
        let last = { ...p.position };
        for (let i = 0; i < 30; i++) {
            const speed = town.walkingSpeed(p);
            town.advance(.1);
            expect(distance(last, p.position), state(p)).toBeLessThanOrEqual(Math.max(speed, town.walkingSpeed(p)) * .1 + .0001);
            last = { ...p.position };
        }
        expect(r.built).toBe(1);
    });
    it.each(['reverse', 'middle turn', 'paving'] as const)('moves continuously through %s work completion and the next assignment', kind => {
        const { town, p } = fixture();
        equip(p, 'hammer');
        if (kind === 'middle turn') {
            const parent = road(town);
            parent.built = 1;
            town.roadChanged();
        }
        const r = kind === 'reverse' ? road(town, point(23, 12), point(13.2, 12)) : kind === 'middle turn' ? road(town, point(18, 8), point(18, 18)) : road(town);
        r.materials.delivered.add(r.materials.required);
        if (kind === 'paving') {
            r.built = 1;
            r.paving = .999;
        }
        else
            r.built = kind === 'middle turn' ? 1 - r.constructionStart - .001 : .999;
        town.roadChanged();
        town.tick(0);
        p.position = r.workPoint();
        town.orderRoadwork([p.id], r.id);
        let last = { ...p.position };
        for (let i = 0; i < 700; i++) {
            const speed = town.walkingSpeed(p);
            town.advance(.1);
            expect(distance(last, p.position), state(p)).toBeLessThanOrEqual(Math.max(speed, town.walkingSpeed(p)) * .1 + .0001);
            last = { ...p.position };
        }
        expect(r.built).toBe(1);
        if (kind === 'paving')
            expect(r.paving).toBe(-1);
    });
    it('does not move the builder when a finished building changes navigation and the next job begins', () => {
        const { town, p } = fixture(), first = site(town, 18, 16), next = site(town, 20, 20);
        equip(p, 'hammer');
        first.progress = .999;
        first.materials.delivered.add(first.materials.required);
        ++town.changes;
        town.tick(0);
        p.position = buildingWorkSpot(town, p, first);
        town.orderBuild([p.id], first.id);
        let last = { ...p.position };
        for (let i = 0; i < 180; i++) {
            const speed = town.walkingSpeed(p);
            town.advance(.1);
            expect(distance(last, p.position), state(p)).toBeLessThanOrEqual(Math.max(speed, town.walkingSpeed(p)) * .1 + .0001);
            last = { ...p.position };
        }
        expect(first.built()).toBe(true);
        expect(next.progress).toBeGreaterThan(0);
    });
    it('refreshes a newly laid bridge front before walking onto it without teleporting', () => {
        const { town, p } = fixture();
        equip(p, 'hammer');
        town.world.stream = { path: [point(20.5, 6), point(20.5, 18)], width: [3, 3] };
        for (let y = 6; y <= 18; y++)
            for (let x = 19; x <= 21; x++)
                town.world.at(x, y).terrain = Terrain.Water;
        ++town.changes;
        const r = road(town, point(13.2, 12), point(25, 12));
        r.materials.delivered.add(r.materials.required);
        r.built = .49;
        town.roadChanged();
        town.tick(0);
        p.position = r.workPoint();
        expect(town.orderRoadwork([p.id], r.id)).toBe(true);
        let last = { ...p.position };
        for (let i = 0; i < 800 && r.built < 1; i++) {
            const speed = town.walkingSpeed(p);
            town.advance(.1);
            expect(distance(last, p.position), state(p)).toBeLessThanOrEqual(Math.max(speed, town.walkingSpeed(p)) * .1 + .0001);
            last = { ...p.position };
        }
        expect(r.built, JSON.stringify({ front: r.workPoint(), walkable: town.grid.walkable(r.workPoint()), worker: JSON.parse(state(p)) })).toBe(1);
    });
    it('selects a local site instead of the first unfinished site across the map', () => {
        const { town, p } = fixture(), far = site(town, 46, 12), near = site(town, 18, 16);
        town.scheduleAutomatic(p);
        expect(p.taskSite, state(p)).toBe(near.id);
        town.orderBuild([p.id], far.id);
        expect(p.taskSite).toBe(far.id);
        expect(p.ordered).toBe(true);
    });
    it('applies the local radius to real global GameApp queues while preserving far direct orders', () => {
        const { town, p } = fixture(), far = site(town, 46, 12), near = site(town, 18, 16), app = appFor(town);
        app.queueWork(Activity.Building, far.id);
        expect(p.task).toBe(Activity.Idle);
        app.queueWork(Activity.Building, near.id);
        expect(p.taskSite).toBe(near.id);
        expect(app.workQueue.map(w => w.target)).toEqual([far.id, near.id]);
        town.orderBuild([p.id], far.id);
        expect(p.taskSite).toBe(far.id);
        expect(p.ordered).toBe(true);
    });
    it('measures a queued road from its current work front instead of its remote endpoint', () => {
        const { town, p } = fixture(), r = road(town, point(13.2, 12), point(35, 12)), app = appFor(town);
        expect(distance(p.position, r.along(1))).toBeGreaterThan(20);
        app.queueWork(Activity.Roadwork, r.id);
        expect(p.taskSite).toBe(r.id);
        town.orderAutomatic([p.id]);
        p.path = [];
        p.activity = p.task = Activity.Idle;
        p.ordered = false;
        r.built = .99;
        town.roadChanged();
        app.dispatchWork(true);
        expect(p.task).toBe(Activity.Idle);
        expect(town.orderRoadwork([p.id], r.id)).toBe(true);
        expect(p.taskSite).toBe(r.id);
    });
    it('chooses other useful work when no reachable supply can advance its automatic site', () => {
        const { town, p } = fixture(), blocked = site(town, 18, 16), useful = site(town, 19, 20);
        blocked.materials.required.stone = 3;
        town.stock().stone = 0;
        town.scheduleAutomatic(p);
        expect(p.taskSite).toBe(blocked.id);
        step(town, 25);
        expect(useful.progress, state(p)).toBeGreaterThan(0);
        expect(blocked.progress).toBe(0);
    });
    it('releases an impossible direct supply order into Auto and avoids immediate reselection', () => {
        const { town, p } = fixture(), blocked = site(town, 18, 16), useful = site(town, 19, 20);
        blocked.materials.required.stone = 3;
        town.stock().stone = 0;
        p.autoMode = false;
        expect(town.orderBuild([p.id], blocked.id)).toBe(true);
        for (let i = 0; i < 150 && p.ordered; i++)
            town.advance(.1);
        expect(p.autoMode).toBe(true);
        expect(p.ordered).toBe(false);
        expect(automaticConstructionAllowed(town, p, Activity.Building, blocked.id)).toBe(false);
        step(town, 15);
        expect(useful.progress, state(p)).toBeGreaterThan(0);
        // A new explicit click retries immediately, independently of Auto's cooldown.
        expect(town.orderBuild([p.id], blocked.id)).toBe(true);
        expect(p.ordered).toBe(true);
    });
    it('chooses other work when the only required resource is beyond an impassable bank', () => {
        const { town, p } = fixture(), blocked = site(town, 18, 16), useful = site(town, 19, 20);
        blocked.materials.required = new Resources(0, 3);
        useful.materials.required = new Resources();
        town.stock().wood = 0;
        town.world.at(30, 16).trees = 1;
        for (let y = 0; y < 64; y++)
            town.world.at(25, y).terrain = Terrain.Water;
        ++town.changes;
        town.tick(0);
        town.scheduleAutomatic(p);
        step(town, 25);
        expect(town.world.at(30, 16).trees).toBe(1);
        expect(blocked.progress).toBe(0);
        expect(useful.progress, state(p)).toBeGreaterThan(0);
    });
    it('keeps a valid gather and delivery chain committed while another site is available', () => {
        const { town, p } = fixture(), target = site(town, 18, 16), other = site(town, 19, 20);
        target.materials.required = new Resources(0, 3);
        town.stock().wood = 0;
        town.world.at(21, 15).trees = town.world.at(21, 15).wild = 1;
        town.scheduleAutomatic(p);
        const activities = new Set<Activity>();
        for (let i = 0; i < 1200 && target.progress < 1; i++) {
            town.advance(.1);
            activities.add(p.activity);
            expect(p.taskSite, state(p)).toBe(target.id);
            expect(other.progress).toBe(0);
        }
        expect(activities.has(Activity.Felling)).toBe(true);
        expect(activities.has(Activity.DeliveringMaterials)).toBe(true);
        expect(target.progress).toBe(1);
    });
    it('waits for another worker carrying the missing supply rather than abandoning the site', () => {
        const { town, p } = fixture(), target = site(town, 18, 16);
        target.materials.required = new Resources(0, 3);
        town.stock().wood = 0;
        town.setOrder(p, Activity.Building, target.id);
        const other = copyNative(p);
        other.id = 1;
        other.activity = Activity.DeliveringMaterials;
        other.supplyTarget = target.id;
        other.supplyRoad = false;
        other.carriedProduct = Product.Wood;
        other.carrying = 3;
        town.folk.push(other);
        expect(town.prepareConstruction(p, Activity.Building, target.id)).toBe(true);
        expect(p.activity).toBe(Activity.WaitingMaterials);
        expect(p.taskSite).toBe(target.id);
        expect(p.ordered).toBe(true);
    });
    it('preserves collected material when a changed obstacle blocks the delivery route', () => {
        const { town, p } = fixture(), target = site(town, 24, 16);
        target.materials.required = new Resources(0, 3);
        town.setOrder(p, Activity.Building, target.id);
        p.carrying = 3;
        p.carriedProduct = Product.Wood;
        for (let y = 0; y < 64; y++)
            town.world.at(20, y).terrain = Terrain.Water;
        ++town.changes;
        town.tick(0);
        expect(town.grid.path(p.position, target.door())).toHaveLength(0);
        expect(town.prepareConstruction(p, Activity.Building, target.id)).toBe(true);
        expect(p.task).toBe(Activity.Idle);
        expect(p.autoMode).toBe(true);
        expect(p.carrying).toBe(3);
    });
    it('finishes a committed prerequisite road before switching to its child', () => {
        const { town, p } = fixture(), parent = road(town), child = road(town, point(18, 12), point(18, 20));
        equip(p, 'hammer');
        parent.materials.delivered.add(parent.materials.required);
        child.materials.delivered.add(child.materials.required);
        expect(town.orderRoadwork([p.id], child.id)).toBe(true);
        for (let i = 0; i < 1000 && parent.built < 1; i++) {
            town.advance(.1);
            if (p.activity === Activity.Roadwork)
                expect(p.target, JSON.stringify({ parent: parent.built, ...JSON.parse(state(p)) })).toBe(parent.id);
        }
        expect(parent.built).toBe(1);
        step(town, 40);
        expect(child.built).toBe(1);
    });
    it('regenerates depleted natural stone away from occupied tiles', () => {
        const { town } = fixture();
        const cells: number[] = [];
        for (let y = 28; y < 38; y++)
            for (let x = 28; x < 38; x++) {
                town.world.at(x, y).terrain = Terrain.Rock;
                if (mining.deposit(town.world, x, y)) {
                    town.world.at(x, y).quarried = true;
                    cells.push(y * 64 + x);
                }
            }
        for (let day = 1; day <= 60; day++) {
            town.days = day;
            town.regrow();
        }
        expect(cells.some(cell => !town.world.at(cell % 64, Math.floor(cell / 64)).quarried)).toBe(true);
    });
    it('keeps occupied stone depleted and reproduces regeneration from the same map and day', () => {
        const { town } = fixture();
        for (const [x, y] of [[12, 12], [31, 31]])
            Object.assign(town.world.at(x, y), { terrain: Terrain.Rock, quarried: true });
        const other = copyNative(town);
        for (let day = 1; day <= 60; day++) {
            town.days = other.days = day;
            town.regrow();
            other.regrow();
        }
        expect(town.world.at(12, 12).quarried).toBe(true);
        expect(town.world.tiles.map(t => t.quarried)).toEqual(other.world.tiles.map(t => t.quarried));
        expect(town.world.at(31, 31).quarried).toBe(false);
    });
    it('keeps default-world wildlife modest instead of spawning sixteen of every species', () => {
        const { town } = fixture(176);
        town.wildlifeDay = -1;
        town.populateWildlife();
        expect(town.animals.length).toBeLessThanOrEqual(36);
    });
    it('creates the resident at the altar as soon as the visible prayer completes', () => {
        const { town, p } = fixture(), altar = new Building(town.nextId++, Structure.Shrine, point(18, 12), 0, 0);
        altar.village = 0;
        town.placed.push(altar);
        ++town.changes;
        const day = town.days;
        expect(town.orderPrayAtAltar([p.id], altar.id)).toBe(true);
        for (let i = 0; i < 400 && town.population() < 2; i++) {
            town.advance(.1);
            if (p.activity === Activity.Praying && !p.moving())
                expect(p.inside).toBe(false);
        }
        expect(town.days).toBe(day);
        expect(town.population()).toBe(2);
        expect(altar.devotionDueDay).toBe(-1);
        const events = town.devotionEvents();
        expect(events).toHaveLength(1);
        expect(events[0].altar).toBe(altar.id);
        expect(events[0].person).toBe(town.people().at(-1)!.id);
        expect(town.grid.walkable(events[0].position)).toBe(true);
        step(town, 3.2);
        expect(town.devotionEvents()).toHaveLength(0);
    });
    it('keeps barehand harvesting possible but takes longer than an equipped matching tool', () => {
        const { p } = fixture();
        expect(harvestDuration(p)).toBe(15);
        expect(harvestDuration(p, true)).toBe(15);
        equip(p, 'axe');
        expect(harvestDuration(p)).toBe(6);
        expect(harvestDuration(p, true)).toBe(15);
        equip(p, 'pickaxe');
        expect(harvestDuration(p)).toBe(15);
        expect(harvestDuration(p, true)).toBe(6);
    });
    it('resumes an old indoor prayer outside without moving the worshipper instantly', () => {
        const { town, p } = fixture(), altar = new Building(town.nextId++, Structure.Shrine, point(18, 12), 0, 0);
        altar.village = 0;
        town.placed.push(altar);
        ++town.changes;
        town.tick(0);
        p.position = altar.door();
        expect(town.orderPrayAtAltar([p.id], altar.id)).toBe(true);
        // Represent an in-progress prayer from a save made before outdoor ceremonies.
        p.path = [];
        enter(p, altar.threshold());
        p.doorway = 1;
        p.position = altar.threshold();
        p.until = town.time;
        let last = { ...p.position };
        for (let i = 0; i < 200 && town.population() < 2; i++) {
            const speed = town.walkingSpeed(p);
            town.advance(.1);
            expect(distance(last, p.position), state(p)).toBeLessThanOrEqual(Math.max(speed, town.walkingSpeed(p)) * .1 + .0001);
            last = { ...p.position };
        }
        expect(town.population(), JSON.stringify({ ...JSON.parse(state(p)), inside: p.inside, doorway: p.doorway, until: p.until, time: town.time, door: altar.door() })).toBe(2);
        expect(p.inside).toBe(false);
        expect(p.doorway).toBe(0);
    });
});

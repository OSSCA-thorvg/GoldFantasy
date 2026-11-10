import type { Town } from './town';
import { Activity, type Person } from './person';
import { distance } from './geometry';
/** Twenty tiles are about ten ordinary two-tile buildings; direct orders have no range limit. */
export const automaticConstructionRadius = 20;
const blockedRetrySeconds = 30;
const assignments = new WeakMap<Person, string>();
const blocked = new WeakMap<Person, Map<string, number>>();
const key = (work: Activity, id: number) => `${work}:${id}`;
/** The requested road owns its clearing, supply and prerequisite-road work. */
export function hasUnfinishedRoadwork(town: Town, person: Person): boolean {
    if (person.task !== Activity.Roadwork) return false;
    const road = town.roads().road(person.taskSite);
    return !!road && road.faction === person.faction &&
        (road.built < 1 || road.paving >= 0 || road.wear > 0);
}
export function clearAutomaticConstruction(person: Person): void { assignments.delete(person); }
export function registerAutomaticConstruction(town: Town, person: Person, work: Activity, id: number): void {
    if (person.task === work && person.taskSite === id)
        assignments.set(person, key(work, id));
}
export function automaticConstructionAllowed(town: Town, person: Person, work: Activity, id: number): boolean {
    if ((blocked.get(person)?.get(key(work, id)) ?? -1) > town.time)
        return false;
    const site = work === Activity.Roadwork ? town.roads().road(id) : town.building(id);
    if (!site || site.faction !== person.faction)
        return false;
    const at = work === Activity.Roadwork ? town.roadWorkPosition(id) : town.building(id)!.door();
    return !!at && distance(person.position, at) <= automaticConstructionRadius;
}
/** Road supply failures retry the same transaction; impossible building jobs yield. */
export function deferAutomaticConstruction(town: Town, person: Person): boolean {
    if (person.task !== Activity.Building && person.task !== Activity.Roadwork)
        return false;
    if (hasUnfinishedRoadwork(town, person)) {
        // Missing stock or a temporarily blocked delivery route must not cancel
        // an accepted road. Retain its target, cargo and player-order policy;
        // WaitingMaterials retries the supply search without a new assignment.
        person.activity = Activity.WaitingMaterials;
        person.path = [];
        person.tree = -1;
        person.until = town.time + 3;
        return true;
    }
    const taskKey = assignments.get(person) ?? key(person.task, person.taskSite);
    // This is called only after every usable source, gather target and processor
    // has failed. A building job yields when its transaction cannot advance;
    // a later direct click can retry immediately.
    let retries = blocked.get(person);
    if (!retries) {
        retries = new Map();
        blocked.set(person, retries);
    }
    retries.set(taskKey, town.time + blockedRetrySeconds);
    assignments.delete(person);
    person.task = person.activity = Activity.Idle;
    person.taskSite = person.target = person.tree = person.supplyTarget = -1;
    person.supplyRoad = person.ordered = person.approachingOrder = person.aggressive = false;
    person.autoMode = true;
    person.path = [];
    person.until = person.scheduleAt = town.time;
    return true;
}

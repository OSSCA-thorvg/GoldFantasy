import type { Town } from './town';
import { Activity, type Person } from './person';
import { distance } from './geometry';
/** Twenty tiles are about ten ordinary two-tile buildings; direct orders have no range limit. */
export const automaticConstructionRadius = 20;
const blockedRetrySeconds = 30;
const assignments = new WeakMap<Person, string>();
const blocked = new WeakMap<Person, Map<string, number>>();
const key = (work: Activity, id: number) => `${work}:${id}`;
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
/** Failed supply searches yield, while a valid gather/deliver/build transaction stays committed. */
export function deferAutomaticConstruction(town: Town, person: Person): boolean {
    if (person.task !== Activity.Building && person.task !== Activity.Roadwork)
        return false;
    const taskKey = assignments.get(person) ?? key(person.task, person.taskSite);
    // This is called only after every usable source, gather target and processor
    // has failed. Even an explicit order must not hold a resident forever when
    // the transaction cannot advance; a later direct click can retry immediately.
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

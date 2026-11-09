import type { TownState } from './town-state';
import { Activity, type Person } from './person';
import { add, sub, scale, point, normalized, distance } from './geometry';

// Apply simultaneous lateral nudges after walking. They do not re-plan paths,
// reverse forward progress, push through walls, or move a worker off a work target.
export function separatePeople(town: TownState, dt: number): void {
  const people = town.folk.filter(p => p.health > 0 && !p.inside && !p.crossingDoorway() &&
    p.activity !== Activity.Expedition && p.activity !== Activity.Leaving);
  const movable = (p: Person) => p.moving() || (!p.ordered &&
    (p.activity === Activity.Idle || p.activity === Activity.Holding));
  const shifts = people.map(() => point()), limits = people.map(() => .4), spacing = .42;
  for (let i = 0; i < people.length; ++i) for (let j = i + 1; j < people.length; ++j) {
    const a = people[i], b = people[j], movesA = movable(a), movesB = movable(b);
    if (!movesA && !movesB) continue;
    const gap = distance(a.position, b.position);
    if (movesA !== movesB) {
      // Work positions are anchors. Steer the walker early enough to pass beside
      // them; never push a builder away and make it walk back on the next tick.
      const index = movesA ? i : j, mover = people[index], anchor = movesA ? b : a,
        forward = mover.path.length ? normalized(sub(mover.path[0], mover.position)) : point(1, 0),
        side = point(-forward.y, forward.x), delta = sub(mover.position, anchor.position),
        lateral = delta.x * side.x + delta.y * side.y,
        ahead = -delta.x * forward.x - delta.y * forward.y,
        approaching = mover.moving() && ahead >= 0 && ahead < 1.6 && Math.abs(lateral) < spacing;
      if (gap >= spacing && !approaching) continue;
      const sign = Math.abs(lateral) > .001 ? Math.sign(lateral) : mover.id < anchor.id ? 1 : -1,
        amount = Math.min(Math.max(0, spacing - Math.abs(lateral)), dt * .8);
      shifts[index] = add(shifts[index], scale(side, sign * amount));
      limits[index] = .8;
      continue;
    }
    if (gap >= spacing) continue;
    const delta = sub(a.position, b.position),
      forward = a.moving() ? normalized(sub(a.path[0], a.position)) :
        b.moving() ? normalized(sub(b.path[0], b.position)) : point(1, 0);
    let side = point(-forward.y, forward.x);
    const cross = delta.x * side.x + delta.y * side.y;
    side = scale(side, Math.abs(cross) > .001 ? Math.sign(cross) : a.id < b.id ? 1 : -1);
    const push = scale(side, Math.min((spacing - gap) * .5, dt * .4));
    shifts[i] = add(shifts[i], push); shifts[j] = sub(shifts[j], push);
  }
  for (let i = 0; i < people.length; ++i) {
    const p = people[i], amount = distance(point(), shifts[i]);
    if (amount < .0001) continue;
    const offset = scale(shifts[i], Math.min(1, dt * limits[i] / amount)), at = add(p.position, offset);
    if (!town.grid.walkable(at) || !town.grid.clear(p.position, at, Infinity)) continue;
    if (p.path.length && (!town.grid.clear(at, p.path[0], Infinity) ||
        distance(at, p.path[0]) > distance(p.position, p.path[0]) + .03)) continue;
    p.position = at;
  }
}

/** Cooperative road workers keep distinct positions beside the same work front. */
export function roadWorkSpot(town: TownState, person: Person, road: import('./road-network').Road) {
  const front=road.workPoint();
  const crew=town.folk.filter(p=>p.health>0 && (p===person ||
    ((p.task===Activity.Roadwork || p.task===Activity.Building) &&
      ((p.activity===Activity.Roadwork && p.target===road.id) || (p.supplyRoad && p.supplyTarget===road.id)))));
  crew.sort((a,b)=>a.id-b.id);
  if(crew.length<2) return front;
  let tangent=point(1,0), best=Infinity;
  for(let i=1;i<road.line.length;++i) {
    const a=road.line[i-1],b=road.line[i],delta=sub(b,a),len2=delta.x*delta.x+delta.y*delta.y;
    if(len2<1e-8) continue;
    const t=Math.max(0,Math.min(1,((front.x-a.x)*delta.x+(front.y-a.y)*delta.y)/len2)),
      gap=distance(front,add(a,scale(delta,t)));
    if(gap<best) {best=gap;tangent=normalized(delta);}
  }
  const offset=(crew.indexOf(person)-(crew.length-1)/2)*.4,
    spot=add(front,scale(point(-tangent.y,tangent.x),offset));
  return town.grid.walkable(spot)&&town.grid.clear(front,spot,Infinity)?spot:front;
}

/** Keep shared building work outside, on distinct reachable apron positions. */
export function buildingWorkSpot(town: TownState, person: Person, building: import('./town-models').Building) {
  const door=building.door(), outward=normalized(sub(door,building.threshold())), side=point(-outward.y,outward.x);
  const crew=town.folk.filter(p=>p.health>0 && (p===person ||
    (p.task===Activity.Building && p.taskSite===building.id) || p.job===building.id ||
    (p.activity===Activity.Working && p.target===building.id)));
  crew.sort((a,b)=>a.id-b.id);
  if(crew.length<2) return door;
  const index=crew.indexOf(person), row=Math.floor(index/5), columns=Math.min(5,crew.length-row*5),
    offset=(index%5-(columns-1)/2)*.44;
  for(let extra=0;extra<5;++extra) {
    const spot=add(add(door,scale(side,offset)),scale(outward,row*.45+extra*.15));
    if(town.grid.walkable(spot)&&town.grid.clear(door,spot,Infinity)) return spot;
  }
  return door;
}

/** Spread melee fighters inside their existing attack radius, without changing targets. */
export function spreadFighter(town: TownState, person: Person, target: {id:number;position:import('./geometry').Point}, reach: number, dt: number): void {
  if(!town.folk.some(p=>p!==person && p.health>0 && !p.inside && p.activity===Activity.Fighting && distance(p.position,person.position)<.42)) return;
  const angle=(person.id*2.399963229728653 + target.id*.17), radius=reach*.72;
  for(let i=0;i<8;++i) {
    const turn=angle+i*Math.PI/4, spot=add(target.position,point(Math.cos(turn)*radius,Math.sin(turn)*radius));
    if(!town.grid.walkable(spot)||!town.grid.clear(person.position,spot,Infinity)) continue;
    const gap=distance(person.position,spot);
    if(gap<.001) return;
    const at=add(person.position,scale(sub(spot,person.position),Math.min(1,dt*.45/gap)));
    if(distance(at,target.position)<=reach) person.position=at;
    return;
  }
}

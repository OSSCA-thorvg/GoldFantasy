import { dispatchWork, queueWork, issueOrder, type GameCommandApp } from '../../apps/web/src/native/game-commands';
import { Order } from '../../packages/engine/src/game-tools';
import { beforeAll, describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { Activity, Person, Role, Calling, Race, Monster, AnimalKind } from '../../packages/engine/src/person';
import { Structure, Resources, Product } from '../../packages/engine/src/building-catalog';
import { Building, Field } from '../../packages/engine/src/town-models';
import { MapDocument } from '../../packages/native-editors/src/map-document';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Terrain, Layer } from '../../packages/engine/src/world-types';
import { point, add, distance, segmentDistance } from '../../packages/engine/src/geometry';
import { sharpAnchor } from '../../packages/engine/src/road-network';
import { copyNative } from '../../packages/engine/src/native-copy';
import { deposit } from '../../packages/engine/src/mining';
import { separatePeople } from '../../packages/engine/src/person-navigation';
import { enter } from '../../packages/engine/src/town-residents';
let base: Town;
beforeAll(() => {
  const doc = new MapDocument(WorldMap.generate(5, 64, 64));
  doc.paint(point(32,32), 45, Terrain.Grass);
  doc.clearTrees(point(32,32),45);
  const world=doc.gameMap();
  world.ymir=null; world.fire=null; world.stream={path:[],width:[]};
  for (const layer of world.layers) layer.fill(.4);
  world.layer(Layer.Land).fill(1); world.layer(Layer.Ridge).fill(-1);
  // Policy fixtures remove unrelated map obstacles; real designed-map road tests
  // separately exercise all four directions and natural first-Camp construction.
  for (let y = 0; y < 64; ++y) for (let x = 0; x < 64; ++x)
    Object.assign(world.at(x, y), { terrain: Terrain.Grass, trees: 0, revealed: true, dungeon: -1 });
  world.reveal(32,32,100);
  base = new Town(world, 64, false);
  base.wildlifeDay = 0;
  const home = new Building(0, Structure.Camp, point(30, 30), 0, 0);
  base.placed.push(home); base.nextId = 1;
  base.migrateSettlements();
  Object.assign(base.stock(), new Resources(1000, 1000, 1000, 1000, 1000, 1000));
  const p = new Person(0, 'Policy worker', Role.Resident, Calling.Settler, Race.Human, 0, home.door());
  p.home = p.village = 0; p.food = p.rest = p.health = 1;
  base.folk = [p]; base.nextPerson = 1;
  base.editHour(12); base.tick(0);
});
function fixture() { return copyNative(base); }
function step(town: Town, seconds: number) { for (let i=0;i<Math.ceil(seconds*10);++i) town.advance(.1); }
function road(town: Town) {
  const path=[sharpAnchor(point(31.2,30)), sharpAnchor(point(36,30))];
  expect(town.canBuildRoad(path).ok,town.canBuildRoad(path).reason).toBe(true);
  expect(town.buildRoad(path)).toBe(true);
  return town.roads().roads().at(-1)!;
}
describe('resident automatic policy', () => {
  it('selects a road before an unfinished building', () => {
    const town=fixture(), p=town.people()[0], r=road(town);
    const b=new Building(town.nextId++, Structure.Tent, point(32,34),0,0);b.progress=0;town.placed.push(b);
    town.scheduleAutomatic(p);
    expect(p.task).toBe(Activity.Roadwork);expect(p.taskSite).toBe(r.id);
  });
  it('returns to Auto after a direct Move issued from Auto OFF', () => {
    const town=fixture(), p=town.people()[0]; town.setAuto(p.id,false);
    town.orderMove([p.id],add(p.position,point(2,0)));step(town,4);
    expect(p.autoMode).toBe(true);expect(p.ordered).toBe(false);expect(p.task).not.toBe(Activity.Moving);
  });
  it('keeps a rested resident in their own home for the night', () => {
    const town=fixture(),p=town.people()[0], home=town.camp()!;
    town.editHour(0);p.activity=Activity.Sleeping;p.target=home.id;p.position=home.door();
    enter(p,home.threshold());p.doorway=1;p.position=home.threshold();p.rest=1;
    town.scheduleAutomatic(p);
    expect(p.activity).toBe(Activity.Sleeping);expect(p.inside).toBe(true);
  });
  it('leaves the actual shelter when a new workplace changes the command target', () => {
    const town=fixture(),p=town.people()[0],home=town.camp()!;
    const job=new Building(1,Structure.Lumberyard,point(40,30),0,0);town.placed.push(job);
    p.position=home.door();enter(p,home.threshold());p.doorway=1;p.position=home.threshold();p.target=home.id;
    expect(town.assignJob([p.id],job.id)).toBe(true);town.resumeOrder(p);
    expect(distance(p.position,home.threshold())).toBeLessThan(.01);
    expect(distance(p.entrance,home.door())).toBeLessThan(.01);
  });
  it('does not automatically gather below two-thirds rest', () => {
    const town=fixture(),p=town.people()[0];p.rest=.5;
    town.map().at(33,32).trees=1;
    town.scheduleAutomatic(p);
    expect([Activity.Felling,Activity.Mining]).not.toContain(p.activity);
  });
  it('keeps a full meal above the hungry threshold for at least seven game days', () => {
    const town=fixture(),p=town.people()[0];town.setAuto(p.id,false);p.food=1;
    // Tick the metabolic path only; the explicit Hold makes unrelated schedules inert.
    for(let i=0;i<7*3000;++i) town.tick(.1);
    expect(p.food).toBeGreaterThanOrEqual(.25);
  });
  it('prioritizes a new road over ordinary hunger and thirst', () => {
    const town=fixture(),p=town.people()[0],r=road(town);p.food=.2;p.hydration=.2;
    town.scheduleAutomatic(p);expect(p.task).toBe(Activity.Roadwork);expect(p.taskSite).toBe(r.id);
  });
  it('keeps hydration above the thirsty threshold for at least three days', () => {
    const town=fixture(),p=town.people()[0];town.setAuto(p.id,false);p.hydration=1;
    for(let i=0;i<3*3000;++i) town.tick(.1);
    expect(p.hydration).toBeGreaterThanOrEqual(.25);
  });
  it('does not replace an explicit target with hunger or rest', () => {
    const town=fixture(),p=town.people()[0];p.food=.1;p.rest=.1;p.health=.3;
    town.orderMove([p.id],point(36,32));const goal={...p.goal};
    town.scheduleAutomatic(p);expect(p.task).toBe(Activity.Moving);expect(p.goal).toEqual(goal);
    expect(p.ordered).toBe(true);
  });
  it('separates two residents following the same route without reversing progress', () => {
    const town=fixture(),p=town.people()[0];p.position=point(31,34);
    const other=copyNative(p);other.id=1;town.folk.push(other);
    town.orderMove([p.id],point(42,34));town.orderMove([other.id],point(42,34));
    let last=p.position.x;
    for(let i=0;i<20;++i) { town.advance(.1);expect(p.position.x).toBeGreaterThanOrEqual(last-.001);last=p.position.x; }
    expect(distance(p.position,other.position)).toBeGreaterThan(.25);
  });
  it('actually damages a friendly person on an explicit Attack order', () => {
    const town=fixture(),p=town.people()[0],other=copyNative(p);other.id=1;other.position=add(p.position,point(.5,0));town.folk.push(other);
    town.orderStop([other.id]);expect(town.orderAttackPerson([p.id],other.id)).toBe(true);step(town,1.1);
    expect(other.health).toBeLessThan(.95);expect(town.hits().some(h=>h.onPerson&&h.person===other.id)).toBe(true);
  });
  it('hunts for an empty pantry, eats one portion and carries surplus to storage', () => {
    const town=fixture(),p=town.people()[0];town.stock().food=0;p.food=.2;
    const prey=new Monster(50,-1,add(p.position,point(.5,0)));prey.animal=AnimalKind.Chicken;prey.home={...prey.position};prey.health=1;town.animals.push(prey);
    town.scheduleAutomatic(p);expect(p.hunting).toBe(true);
    for(let i=0;i<200 && town.stock().food<3;++i)town.advance(.1);
    expect(p.food).toBeGreaterThan(.95);expect(town.stock().food).toBe(3);expect(p.carrying).toBe(0);
  });
  it('walks to a Well and drinks instead of remotely consuming water', () => {
    const town=fixture(),p=town.people()[0],well=new Building(1,Structure.Well,point(35,34),0,0);well.village=0;town.placed.push(well);++town.changes;
    p.hydration=.2;const before=town.stock().water;town.scheduleAutomatic(p);
    expect(p.activity).toBe(Activity.Drinking);expect(p.hydration).toBe(.2);expect(town.stock().water).toBe(before);
    for(let i=0;i<200 && p.hydration<.9;++i)town.advance(.1);
    expect(p.hydration).toBeGreaterThan(.9);expect(town.stock().water).toBe(before-1);expect(distance(p.position,well.door())).toBeLessThan(.05);
  });
  it('constructs a missing Well and then uses it', () => {
    const town=fixture(),p=town.people()[0];p.hydration=.2;
    town.scheduleAutomatic(p);expect(town.buildings().some(b=>b.kind===Structure.Well)).toBe(true);
    for(let i=0;i<1800 && p.hydration<.9;++i)town.advance(.1);
    expect(p.hydration,JSON.stringify({activity:Activity[p.activity],task:Activity[p.task],position:p.position})).toBeGreaterThan(.9);
    expect(town.buildings().find(b=>b.kind===Structure.Well)!.built()).toBe(true);
  });
  it('works at a stable outdoor field point instead of the Farm doorway', () => {
    const town=fixture(),p=town.people()[0],farm=new Building(1,Structure.Farm,point(35,34),0,0);farm.village=0;town.placed.push(farm);
    town.farmland.push(new Field(2,[point(37,34),point(40,34),point(40,37),point(37,37)],0));++town.changes;
    expect(town.assignJob([p.id],farm.id)).toBe(true);step(town,12);
    expect(p.workField).toBe(2);expect(p.activity).toBe(Activity.Working);expect(p.inside).toBe(false);
    expect(distance(p.position,p.goal)).toBeLessThan(.05);expect(distance(p.position,farm.door())).toBeGreaterThan(1);
    const goal={...p.goal};step(town,5);expect(p.goal).toEqual(goal);expect(farm.workedSeconds).toBeGreaterThan(3);
  });
  it('finishes a connected extension from an unfinished parent, including its reverse half', () => {
    const town=fixture(),p=town.people()[0];
    expect(town.buildRoad([sharpAnchor(point(31.2,30)),sharpAnchor(point(42,30))])).toBe(true);
    const parent=town.roads().roads().at(-1)!;
    expect(town.buildRoad([sharpAnchor(point(38,25)),sharpAnchor(point(38,38))])).toBe(true);
    const child=town.roads().roads().at(-1)!;expect(child.parent).toBe(parent.id);
    expect(town.orderRoadwork([p.id],child.id)).toBe(true);
    for(let i=0;i<1800 && child.built<1;++i)town.advance(.1);
    expect(parent.built).toBeGreaterThan(.6);expect(child.built,JSON.stringify({activity:Activity[p.activity],target:p.target,position:p.position,front:child.workPoint()})).toBe(1);
  });
  it('fetches distant paving materials beyond Camp reach and finishes the extension', () => {
    const town=fixture(),p=town.people()[0];
    expect(town.buildRoad([sharpAnchor(point(31.2,30)),sharpAnchor(point(45,30))])).toBe(true);
    const parent=town.roads().roads().at(-1)!;parent.built=1;
    expect(town.buildRoad([sharpAnchor(point(45,30)),sharpAnchor(point(52,30))])).toBe(true);
    const child=town.roads().roads().at(-1)!;child.built=1;town.roadChanged();
    expect(town.pave(child.id)).toBe(true);expect(town.constructionSupplyCamp(Activity.Roadwork,child.id)).toBe(-1);
    expect(town.orderRoadwork([p.id],child.id)).toBe(true);
    let fetched=false;for(let i=0;i<2200 && !child.paved;++i){town.advance(.1);fetched ||= p.activity===Activity.FetchingMaterials;}
    expect(fetched).toBe(true);expect(child.paved,JSON.stringify({activity:Activity[p.activity],position:p.position,material:child.materials})).toBe(true);
  });
  it('mines missing paving stone, returns to the distant road and completes it', () => {
    const town=fixture(),p=town.people()[0];town.stock().stone=0;
    expect(town.buildRoad([sharpAnchor(point(31.2,30)),sharpAnchor(point(45,30))])).toBe(true);
    town.roads().roads().at(-1)!.built=1;
    expect(town.buildRoad([sharpAnchor(point(45,30)),sharpAnchor(point(52,30))])).toBe(true);
    const child=town.roads().roads().at(-1)!;child.built=1;town.roadChanged();
    let rocks=0;for(let x=45;x<53&&rocks<2;++x){town.map().at(x,32).terrain=Terrain.Rock;town.map().at(x,32).quarried=false;if(deposit(town.map(),x,32))++rocks;}
    expect(rocks).toBe(2);++town.changes;
    expect(town.pave(child.id)).toBe(true);expect(town.orderRoadwork([p.id],child.id)).toBe(true);
    const activities=new Set<Activity>();
    for(let i=0;i<2400&&!child.paved;++i){town.advance(.1);activities.add(p.activity);}
    expect(activities.has(Activity.Mining)).toBe(true);expect(activities.has(Activity.DeliveringMaterials)).toBe(true);
    expect(child.paved,JSON.stringify({activity:Activity[p.activity],task:p.task,target:p.target,cargo:p.carrying,materials:child.materials})).toBe(true);
  });
  it('moves to a clicked building before collecting its missing resources', () => {
    const town=fixture(),p=town.people()[0],site=new Building(1,Structure.Tent,point(39,34),0,0);
    site.progress=0;site.materials.required.wood=3;town.placed.push(site);town.stock().wood=0;town.map().at(32,34).trees=1;
    expect(town.orderBuild([p.id],site.id)).toBe(true);
    expect(p.approachingOrder).toBe(true);expect(p.activity).toBe(Activity.Moving);expect(p.tree).toBe(-1);
    expect(distance(p.path.at(-1)!,site.door())).toBeLessThan(.05);
  });
  it('keeps a road walk moving forward through a right-angle junction', () => {
    const town=fixture(),p=town.people()[0],path=[sharpAnchor(point(31.2,30)),sharpAnchor(point(40,30)),sharpAnchor(point(40,38))];
    expect(town.buildRoad(path)).toBe(true);const lane=town.roads().roads().at(-1)!;lane.built=1;town.roadChanged();town.tick(0);
    p.position=point(31.3,30);town.orderMove([p.id],point(40,37.5));
    let previous=0;
    for(let i=0;i<200&&p.ordered;++i){
      town.advance(.1);
      const progress=p.position.x<39.7?p.position.x-31.3:8.7+Math.max(0,p.position.y-30);
      expect(progress).toBeGreaterThanOrEqual(previous-.05);previous=progress;
      expect(Math.min(segmentDistance(p.position,point(31.2,30),point(40,30)),segmentDistance(p.position,point(40,30),point(40,38)))).toBeLessThan(.35);
    }
    expect(distance(p.position,point(40,37.5))).toBeLessThan(.3);
  });
  it('lets two road workers finish without occupying one identical work position', () => {
    const town=fixture(),p=town.people()[0],other=copyNative(p);other.id=1;other.position=add(p.position,point(.5,0));town.folk.push(other);
    const r=road(town);town.orderRoadwork([p.id,other.id],r.id);
    let separated=false;
    for(let i=0;i<600&&r.built<1;++i){town.advance(.1);if(p.activity===Activity.Roadwork&&other.activity===Activity.Roadwork&&!p.moving()&&!other.moving())separated ||= distance(p.position,other.position)>.3;}
    expect(r.built).toBe(1);expect(separated).toBe(true);
  });
  it('interrupts a direct Move for an active enemy and resumes the same destination', () => {
    const town=fixture(),p=town.people()[0],destination=point(37,33);
    town.orderMove([p.id],destination);const foe=new Monster(88,-1,add(p.position,point(.5,0)));
    foe.animal=AnimalKind.Wolf;foe.angry=true;foe.health=1;foe.home={...foe.position};foe.provokedBy=p.id;town.animals.push(foe);
    town.advance(.1);expect(p.activity).toBe(Activity.Fighting);expect(p.task).toBe(Activity.Moving);expect(p.goal).toEqual(destination);
    for(let i=0;i<100&&p.ordered;++i)town.advance(.1);
    expect(p.ordered).toBe(false);expect(p.autoMode).toBe(true);expect(distance(p.position,destination)).toBeLessThan(.3);
  });
  it('recovers critical health at its own home and exits only once after dawn', () => {
    const town=fixture(),p=town.people()[0],home=town.camp()!;p.health=.3;
    town.scheduleAutomatic(p);expect(p.activity).toBe(Activity.Sleeping);expect(p.target).toBe(home.id);
    step(town,3);expect(p.inside).toBe(true);p.health=p.rest=1;town.editHour(0);
    for(let i=0;i<300;++i){town.advance(.1);expect(p.activity).toBe(Activity.Sleeping);expect(p.inside).toBe(true);}
    town.editHour(12);step(town,5);expect(p.inside).toBe(false);expect(p.doorway).toBe(0);
  });
  it('keeps two workshop workers at distinct stable outdoor apron positions', () => {
    const town=fixture(),p=town.people()[0],other=copyNative(p);other.id=1;town.folk.push(other);
    const mill=new Building(1,Structure.Sawmill,point(36,34),0,0);mill.village=0;town.placed.push(mill);++town.changes;
    expect(town.assignJob([p.id,other.id],mill.id)).toBe(true);step(town,12);
    expect(p.activity).toBe(Activity.Working);expect(other.activity).toBe(Activity.Working);
    expect(distance(p.position,other.position)).toBeGreaterThan(.35);
    const positions=town.people().map(p=>({...p.position}));step(town,3);
    expect(town.people().map(p=>p.position)).toEqual(positions);
    expect(p.inside||other.inside).toBe(false);expect(mill.workedSeconds).toBeGreaterThan(4);
  });
  it('separates stationary fighters within attack range while attacks continue', () => {
    const town=fixture(),p=town.people()[0],other=copyNative(p);other.id=1;town.folk.push(other);
    const foe=new Monster(88,-1,add(p.position,point(.5,0)));foe.animal=AnimalKind.Cow;foe.health=100;foe.home={...foe.position};town.animals.push(foe);
    town.orderAttack([p.id,other.id],foe.id);step(town,4);
    expect(distance(p.position,other.position)).toBeGreaterThan(.3);
    expect(distance(p.position,foe.position)).toBeLessThan(.91);expect(distance(other.position,foe.position)).toBeLessThan(.91);
    expect(foe.health).toBeLessThanOrEqual(92);
  });
  it('finishes a clicked gathering target and delivery, then returns to Auto', () => {
    const town=fixture(),p=town.people()[0];town.stock().wood=0;town.map().at(33,32).trees=1;town.setAuto(p.id,false);
    expect(town.orderChop([p.id],32*64+33)).toBe(true);
    for(let i=0;i<300&&(!p.autoMode||p.carrying>0);++i)town.advance(.1);
    expect(town.map().at(33,32).trees).toBe(0);expect(town.stock().wood).toBe(3);expect(p.autoMode).toBe(true);expect(p.ordered).toBe(false);
  });
  it('keeps its construction target while taking a meal during unavailable supplies', () => {
    const town=fixture(),p=town.people()[0],b=new Building(1,Structure.Tent,point(36,34),0,0);b.progress=0;b.materials.required.wood=3;town.placed.push(b);town.stock().wood=0;
    p.task=Activity.Building;p.taskSite=b.id;p.activity=Activity.WaitingMaterials;p.until=town.clock()+3;p.food=.2;
    town.scheduleAutomatic(p);expect(p.activity).toBe(Activity.Eating);expect(p.task).toBe(Activity.Building);expect(p.taskSite).toBe(b.id);
    step(town,8);expect(p.food).toBeGreaterThan(.9);expect(p.taskSite).toBe(b.id);
  });
  it('an assigned mill worker gathers raw input, delivers it and resumes production', () => {
    const town=fixture(),p=town.people()[0],mill=new Building(1,Structure.Sawmill,point(36,34),0,0);mill.village=0;
    town.placed.push(mill);town.stock().wood=0;town.stock().planks=0;town.map().at(34,35).trees=1;++town.changes;
    expect(town.assignJob([p.id],mill.id)).toBe(true);
    const seen=new Set<Activity>();for(let i=0;i<1000&&town.stock().planks<1;++i){town.advance(.1);seen.add(p.activity);}
    expect(seen.has(Activity.Felling)).toBe(true);expect(seen.has(Activity.Hauling)).toBe(true);
    expect(town.stock().planks,JSON.stringify({activity:Activity[p.activity],tree:p.tree,until:p.until,time:town.clock(),stock:town.stock()})).toBeGreaterThan(0);
    expect(p.job).toBe(mill.id);expect(p.task).toBe(Activity.Working);
  });
  it('returns to a partial bridge front after gathering the next material load', () => {
    const town=fixture(),p=town.people()[0];town.stock().wood=town.stock().stone=0;
    town.map().stream={path:[point(38.5,25),point(38.5,35)],width:[3,3]};
    for(let y=25;y<=35;++y)for(let x=37;x<=39;++x)town.map().at(x,y).terrain=Terrain.Water;
    town.map().at(34,32).trees=4;
    let rocks=0;for(let x=31;x<37;++x){town.map().at(x,34).terrain=Terrain.Rock;town.map().at(x,34).quarried=false;if(deposit(town.map(),x,34))++rocks;}
    expect(rocks).toBeGreaterThan(0);++town.changes;
    const path=[sharpAnchor(point(31.2,30)),sharpAnchor(point(43,30))];
    expect(town.canBuildRoad(path).ok,town.canBuildRoad(path).reason).toBe(true);expect(town.buildRoad(path)).toBe(true);
    const bridge=town.roads().roads().at(-1)!;expect(bridge.materials.required.wood).toBeGreaterThan(3);
    expect(town.orderRoadwork([p.id],bridge.id)).toBe(true);
    const states:unknown[]=[];let last='';
    for(let i=0;i<3000&&bridge.built<1;++i){town.advance(.1);const now=Activity[p.activity]+':'+p.target;if(now!==last){states.push({time:town.clock(),state:now,progress:bridge.built,front:bridge.workPoint(),walkable:town.grid.walkable(bridge.workPoint()),cargo:p.carrying});last=now;}}
    expect(bridge.built,JSON.stringify(states.slice(-12))).toBe(1);
  });
  it('finishes the entire chosen prerequisite road before resuming the building', () => {
    const town=fixture(),p=town.people()[0];
    expect(town.buildRoad([sharpAnchor(point(31.2,30)),sharpAnchor(point(42,30))])).toBe(true);
    const lane=town.roads().roads().at(-1)!,site=new Building(1,Structure.Tent,point(36,31.1),0,0);
    site.progress=0;town.placed.push(site);p.task=Activity.Building;p.taskSite=site.id;p.ordered=false;
    expect(town.layRoadFirst(p,site.id)).toBe(true);
    let firstBuildingAt=-1;
    for(let i=0;i<1000&&(!site.built()||lane.built<1);++i){town.advance(.1);if(site.progress>0&&firstBuildingAt<0)firstBuildingAt=lane.built;}
    expect(firstBuildingAt).toBe(1);expect(lane.built).toBe(1);expect(site.built()).toBe(true);
  });
  it('global parent and bridge requests retain their targets through gathering and delivery', () => {
    const town=fixture(),p=town.people()[0],other=copyNative(p);other.id=1;other.position=add(p.position,point(.5,0));town.folk.push(other);
    town.stock().wood=town.stock().stone=0;
    town.map().stream={path:[point(38.5,25),point(38.5,35)],width:[3,3]};
    for(let y=25;y<=35;++y)for(let x=37;x<=39;++x)town.map().at(x,y).terrain=Terrain.Water;
    town.map().at(34,32).trees=4;
    for(let x=31;x<37;++x){town.map().at(x,34).terrain=Terrain.Rock;town.map().at(x,34).quarried=false;}
    ++town.changes;
    expect(town.buildRoad([sharpAnchor(point(31.2,30)),sharpAnchor(point(36,30))])).toBe(true);
    const parent=town.roads().roads().at(-1)!;
    expect(town.buildRoad([sharpAnchor(point(36,30)),sharpAnchor(point(43,30))])).toBe(true);
    const child=town.roads().roads().at(-1)!;
    const app={town,workQueue:[],workSerial:0n,lastDispatch:-1,stoppedWork:new Map<number,bigint>()} as unknown as GameCommandApp;
    app.dispatchWork=dispatchWork.bind(app);app.queueWork=queueWork.bind(app);
    app.queueWork(Activity.Roadwork,parent.id);app.queueWork(Activity.Roadwork,child.id);
    const sites=town.people().map(p=>p.taskSite);let harvested=false;
    for(let i=0;i<2400&&child.built<1;++i){
      town.advance(.1);app.dispatchWork();
      harvested ||= town.people().some(p=>p.activity===Activity.Felling||p.activity===Activity.Mining);
      for(let j=0;j<sites.length;++j){const r=town.roads().road(sites[j]);if(r&&r.built<1)expect(town.people()[j].taskSite).toBe(sites[j]);}
    }
    expect(harvested).toBe(true);expect(parent.built).toBe(1);expect(child.built).toBe(1);expect(app.workQueue).toHaveLength(0);
  });
  it('right-clicking an animal targets it, while explicit Move remains movement', () => {
    const town=fixture(),p=town.people()[0],animal=new Monster(88,-1,add(p.position,point(.6,0)));animal.animal=AnimalKind.Pig;animal.health=3;animal.home={...animal.position};town.animals.push(animal);
    const app={town,chosen:[p.id],mouse:point(),cursor:animal.position,status:'',animalAtScreen:()=>animal.id,treeAtScreen:()=>-1,rockAtScreen:()=>-1,buildingAtScreen:()=>-1,hoveredRoad:()=>-1,personAt:()=>-1,cue(){}} as unknown as GameCommandApp;
    issueOrder.call(app,Order.Work);expect(p.task).toBe(Activity.Fighting);expect(p.taskSite).toBe(animal.id);town.advance(.1);expect(animal.health).toBeLessThan(3);
    issueOrder.call(app,Order.Move);expect(p.task).toBe(Activity.Moving);
  });
  it('briefly drinks during critical health recovery, preserving the suspended task', () => {
    const town=fixture(),p=town.people()[0],well=new Building(1,Structure.Well,point(34,34),0,0);well.village=0;town.placed.push(well);
    const r=road(town);p.task=Activity.Roadwork;p.taskSite=r.id;p.health=.3;p.hydration=.05;p.recoveringHealth=true;
    town.scheduleAutomatic(p);expect(p.activity).toBe(Activity.Drinking);expect(p.taskSite).toBe(r.id);
    for(let i=0;i<160&&p.hydration<.9;++i)town.advance(.1);
    expect(p.hydration).toBeGreaterThan(.9);step(town,8);expect(p.activity).toBe(Activity.Sleeping);expect(p.target).toBe(p.home);expect(p.recoveringHealth).toBe(true);expect(p.taskSite).toBe(r.id);
  });
  it('lets legacy guests drink at an existing Well without placing buildings themselves', () => {
    const town=fixture(),p=town.people()[0];p.role=Role.Guest;p.hydration=.2;
    const before=town.buildings().length;expect(town.drink(p)).toBe(false);expect(town.buildings().length).toBe(before);
    const well=new Building(1,Structure.Well,point(34,34),0,0);well.village=0;town.placed.push(well);
    expect(town.takeBreak(p)).toBe(true);expect(p.activity).toBe(Activity.Drinking);
  });
  it('never overwrites an undeliverable non-food cargo when hungry', () => {
    const town=fixture(),p=town.people()[0];p.food=.2;p.carrying=3;p.carriedProduct=Product.Wood;
    town.stock().wood=1000;town.stock().food=0;
    const animal=new Monster(88,-1,add(p.position,point(.5,0)));animal.animal=AnimalKind.Chicken;animal.health=1;town.animals.push(animal);
    expect(town.huntFood(p)).toBe(false);expect(p.carrying).toBe(3);expect(p.carriedProduct).toBe(Product.Wood);expect(p.hunting).toBe(false);
  });
  it('returns to Auto after a timed direct visit completes', () => {
    const town=fixture(),p=town.people()[0],tavern=new Building(1,Structure.Tavern,point(35,34),0,0);tavern.village=0;town.placed.push(tavern);
    town.setAuto(p.id,false);expect(town.orderRelax([p.id],tavern.id)).toBe(true);step(town,25);
    expect(p.autoMode,JSON.stringify({activity:Activity[p.activity],task:Activity[p.task],ordered:p.ordered,position:p.position,path:p.path,until:p.until,time:town.clock(),inside:p.inside,doorway:p.doorway})).toBe(true);expect(p.ordered).toBe(false);expect(p.activity).not.toBe(Activity.Relaxing);
  });
  it('walks around an anchored worker without moving its work position', () => {
    const town=fixture(),mover=town.people()[0],worker=copyNative(mover);worker.id=1;
    mover.position=point(32,35);mover.path=[point(39,35)];mover.activity=Activity.Moving;mover.ordered=true;
    worker.position=point(35,35);worker.path=[];worker.activity=Activity.Working;worker.task=Activity.Working;worker.ordered=true;town.folk.push(worker);
    let nearest=Infinity,last=mover.position.x;
    for(let i=0;i<80&&mover.moving();++i){town.walk(mover,.1);separatePeople(town,.1);nearest=Math.min(nearest,distance(mover.position,worker.position));expect(mover.position.x).toBeGreaterThanOrEqual(last-.001);last=mover.position.x;expect(worker.position).toEqual(point(35,35));}
    expect(nearest).toBeGreaterThan(.25);expect(distance(mover.position,point(39,35))).toBeLessThan(.01);
  });
  for (const kind of ['lay', 'pave', 'repair'] as const)
    it(`returns to Auto after a direct ${kind} road command issued from Auto OFF`, () => {
      const town=fixture(),p=town.people()[0],r=road(town);
      if(kind!=='lay'){r.built=1;town.roadChanged();}
      if(kind==='pave')expect(town.pave(r.id)).toBe(true);
      if(kind==='repair')r.wear=.5;
      town.setAuto(p.id,false);expect(town.orderRoadwork([p.id],r.id)).toBe(true);
      for(let i=0;i<1200&&!p.autoMode;++i)town.advance(.1);
      expect(r.built).toBe(1);if(kind==='pave')expect(r.paved).toBe(true);if(kind==='repair')expect(r.wear).toBe(0);
      expect(p.autoMode,JSON.stringify({activity:Activity[p.activity],task:Activity[p.task],ordered:p.ordered,site:p.taskSite})).toBe(true);
      expect(p.ordered).toBe(false);
    });
  it('returns to Auto after direct mining and its delivery complete', () => {
    const town=fixture(),p=town.people()[0];town.stock().stone=0;
    let cell=-1;for(let x=32;x<39;++x){town.map().at(x,33).terrain=Terrain.Rock;town.map().at(x,33).quarried=false;if(deposit(town.map(),x,33)){cell=33*64+x;break;}}
    expect(cell).toBeGreaterThan(0);++town.changes;town.setAuto(p.id,false);expect(town.orderMine([p.id],cell)).toBe(true);
    for(let i=0;i<500&&(!p.autoMode||p.carrying>0);++i)town.advance(.1);
    expect(town.map().at(cell%64,Math.floor(cell/64)).quarried).toBe(true);expect(town.stock().stone).toBe(3);expect(p.autoMode).toBe(true);expect(p.ordered).toBe(false);
  });
  it('returns to Auto after the explicit attack target dies', () => {
    const town=fixture(),p=town.people()[0],animal=new Monster(88,-1,add(p.position,point(.5,0)));animal.animal=AnimalKind.Chicken;animal.health=1;animal.home={...animal.position};town.animals.push(animal);
    town.setAuto(p.id,false);expect(town.orderAttack([p.id],animal.id)).toBe(true);
    for(let i=0;i<200&&!p.autoMode;++i)town.advance(.1);
    expect(animal.health).toBeLessThanOrEqual(0);expect(p.autoMode).toBe(true);expect(p.ordered).toBe(false);
  });
  it('returns to Auto after an explicit rest in its own home completes', () => {
    const town=fixture(),p=town.people()[0];p.rest=.9;town.setAuto(p.id,false);
    expect(town.orderRest([p.id],p.home)).toBe(true);for(let i=0;i<400&&!p.autoMode;++i)town.advance(.1);
    expect(p.rest).toBeGreaterThan(.94);expect(p.autoMode).toBe(true);expect(p.ordered).toBe(false);
  });
  it("lets a homeless resident eat at the Camp door without entering somebody else's home", () => {
    const town=fixture(),p=town.people()[0],camp=town.camp()!;p.home=-1;p.food=.2;p.position=point(35,34);
    const food=town.stock().food;expect(town.eat(p)).toBe(true);expect(p.activity).toBe(Activity.Eating);
    for(let i=0;i<200&&p.food<.9;++i)town.advance(.1);
    expect(p.food).toBeGreaterThan(.9);expect(town.stock().food).toBe(food-1);
    expect(distance(p.position,camp.door())).toBeLessThan(.02);expect(p.inside).toBe(false);expect(p.doorway).toBe(0);expect(p.home).toBe(-1);
  });
  it('preserves an explicit Stop until another command', () => {
    const town=fixture(),p=town.people()[0];town.orderStop([p.id]);step(town,4);
    expect(p.autoMode).toBe(false);expect(p.activity).toBe(Activity.Holding);expect(p.path).toHaveLength(0);
  });
});

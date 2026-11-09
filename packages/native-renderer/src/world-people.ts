// World agents, articulated action poses, combat feedback and footprints.
import { Town } from '../../engine/src/town';
import { Traffic, Agent, AgentKind } from '../../engine/src/traffic';
import { point, sub, add, mul, distance, normalized, project } from '../../engine/src/geometry';
import { f32 as f, clamp, lround } from '../../engine/src/numeric';
import { Activity } from '../../engine/src/person';
import { farmWorkPhase } from '../../engine/src/farm-work';
import { breedOf } from '../../engine/src/town-monsters';
import { injuryOf, Injury } from '../../engine/src/person-look';
import { Product, Structure, structureSpec } from '../../engine/src/building-catalog';
import { DungeonKind } from '../../engine/src/world-types';
import { Weather } from '../../engine/src/climate';
import { treePosition } from '../../engine/src/world-map';
import * as mining from '../../engine/src/mining';
import * as woodcutting from '../../engine/src/woodcutting';
import { SceneNode, ShapeNode, TextNode, type Rgb } from './paint';
import { WorldRendererState, type Sprite, type Figure } from './world-renderer-state';
import { standingRow, registerDepth } from './world-depth';
import { agentSprite, personSprite, PersonParts, stridePose, monsterParts } from './world-sprites';
import { animalSprite } from './wildlife-sprites';
import { moodOf } from './person-portrait';
import { canIdleGesture, idleGesture, animateGesture, IdleGesture } from './idle-gesture';
import { line, opaque } from './vector-paint';
import { updateBuildingDamage } from './building-damage';
import { clearWorkProps, animateFieldWork, animateProcessingWork } from './work-motion';
import { callingEquipment, combatEquipment, showEquipment, poseBow } from './person-equipment';
import { animateAction, animateMonsterAttack, strikePhase } from './action-motion';
const inSight = (s: WorldRendererState, p: { x: number; y: number }) => s.currentVisibility.sample(p) >= 119;
export function moveAgents(
  s: WorldRendererState,
  town: Town,
  traffic: Traffic,
  seconds: number,
  selected: readonly number[],
): void {
  for (const sprite of s.sprites.values()) sprite.seen = false;
  const count = s.rows.length;
  for (const agent of traffic.agents()) {
    let sprite = s.sprites.get(agent.id);
    if (!sprite) {
      sprite = { paint: agentSprite(agent, DungeonKind.Cave), row: -1, seen: false };
      s.sprites.set(agent.id, sprite);
    }
    sprite.seen = true;
    registerDepth(sprite.paint, agent.position(), `traveller:${agent.id}`);
    const at = agent.position(),
      row = standingRow(town, at, count);
    if (row !== sprite.row) {
      if (sprite.row >= 0) s.rows[sprite.row].remove(sprite.paint);
      s.rows[row].add(sprite.paint);
      sprite.row = row;
    }
    const screen = project(at.x, at.y),
      heading = agent.heading(),
      facing = f(heading.x - heading.y) < 0 ? -1 : 1,
      bob = f(-Math.abs(f(Math.sin(f(f(f(seconds) * 7) + agent.id)))) * f(1.2));
    sprite.paint.transform([facing, 0, screen.x, 0, 1, f(screen.y + bob), 0, 0, 1]);
    sprite.paint.opacity(town.map().revealed(at) && inSight(s, at) ? 255 : 0);
  }
  for (const [id, sprite] of s.sprites) {
    if (sprite.seen) continue;
    if (sprite.row >= 0) s.rows[sprite.row].remove(sprite.paint);
    s.sprites.delete(id);
  }
  const strikes = new Map<number, ReturnType<Town['hits']>[number]>();
  for (const hit of town.hits()) if (!hit.onPerson && hit.person >= 0) strikes.set(hit.person, hit);
  for (const figure of s.figures.values()) figure.seen = false;
  for (const person of town.people()) {
    let figure = s.figures.get(person.id);
    const key = JSON.stringify([
      person.look,
      person.race,
      person.calling,
      person.lookRevision.toString(),
      injuryOf(person) === Injury.Bandaged,
    ]);
    if (!figure) {
      const parts = new PersonParts();
      figure = {
        paint: personSprite(person, parts),
        row: -1,
        seen: false,
        lookKey: key,
        parts,
        last: point(-1, -1),
        stride: 0,
        facing: 1,
        striding: false,
      };
      s.figures.set(person.id, figure);
    }
    figure.seen = true;
    if (figure.lookKey !== key) {
      if (figure.row >= 0) s.rows[figure.row].remove(figure.paint);
      figure.parts = new PersonParts();
      figure.paint = personSprite(person, figure.parts);
      figure.row = -1;
      figure.striding = false;
      figure.lookKey = key;
    }
    const crossing = person.crossingDoorway(),
      row = standingRow(town, crossing ? person.entrance : person.position, count);
    if (row !== figure.row) {
      if (figure.row >= 0) s.rows[figure.row].remove(figure.paint);
      s.rows[row].add(figure.paint);
      figure.row = row;
    }
    registerDepth(figure.paint, crossing ? person.entrance : person.position, `person:${person.id}`);
    const screen = project(person.position.x, person.position.y),
      strike = strikes.get(person.id),
      followingThrough = !!strike && town.clock() - strike.at < 0.25,
      fighting = person.activity === Activity.Fighting || followingThrough,
      combatTravel = fighting && figure.last.x >= 0 && distance(figure.last, person.position) > 0.0001;

    let ahead = point();
    if (crossing)
      ahead = person.inside ? sub(person.threshold, person.entrance) : sub(person.entrance, person.threshold);
    else if (person.moving()) ahead = sub(person.path[0], person.position);
    else if (figure.last.x >= 0) ahead = sub(person.position, figure.last);
    const chopping =
        person.activity === Activity.Felling && !person.moving() && !crossing && person.tree >= 0,
      miningNow = person.activity === Activity.Mining && !person.moving() && !crossing && person.tree >= 0;
    if (miningNow)
      ahead = sub(
        mining.position(person.tree % town.map().width(), Math.trunc(person.tree / town.map().width())),
        person.position,
      );
    if (chopping) {
      const x = person.tree % town.map().width(),
        y = Math.trunc(person.tree / town.map().width());
      if (town.map().inside(x, y) && town.map().at(x, y).trees)
        ahead = sub(treePosition(town.map(), x, y, town.map().at(x, y).trees - 1), person.position);
    }
    if (fighting && !combatTravel && !person.moving()) {
      const foe =
        person.foe >= 0
          ? town.creatureTarget(person.foe)
          : person.attackPerson >= 0
            ? town.person(person.attackPerson)
            : null;
      if (foe) ahead = sub(foe.position, person.position);
      else if (strike) ahead = sub(strike.to, person.position);
    }
    if (Math.abs(f(ahead.x - ahead.y)) > f(0.0001)) figure.facing = f(ahead.x - ahead.y) < 0 ? -1 : 1;
    if (figure.last.x >= 0)
      figure.stride = f(figure.stride + f(Math.min(1, distance(figure.last, person.position)) * f(5.5)));
    figure.last = { ...person.position };
    const striding = !s.sceneView && (person.moving() || crossing || combatTravel),
      bob = striding ? f(-Math.abs(f(Math.sin(figure.stride))) * f(1.1)) : 0,
      collecting =
        !s.sceneView && person.activity === Activity.Collecting
          ? f(
              Math.sin(
                f(
                  f(3.14159265) *
                    f(
                      clamp(
                        1 -
                          (person.until - town.clock()) /
                            (person.carriedProduct === Product.Stone
                              ? mining.collectSeconds
                              : woodcutting.fallSeconds),
                        0,
                        1,
                      ),
                    ),
                ),
              ),
            )
          : 0;
    figure.paint.transform([figure.facing, 0, screen.x, 0, 1, screen.y, 0, 0, 1]);
    figure.parts.body?.transform([1, 0, 0, 0, f(1 - f(0.12 * collecting)), bob, 0, 0, 1]);
    figure.parts.shadow?.transform([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    stridePose(figure.parts, figure.stride, striding);
    if (!striding)
      animateGesture(
        figure.parts.arms,
        !s.sceneView && canIdleGesture(person)
          ? idleGesture((person.look ^ Math.imul(person.id, 7919)) >>> 0, moodOf(person), seconds)
          : { kind: IdleGesture.None, phase: 0, mirrored: false },
      );
    figure.striding = striding;
    figure.paint.opacity(
      !s.sceneView && !inSight(s, person.position) ? 0 : lround(f(255 * person.visibility())),
    );
    figure.parts.ring?.opacity(selected.includes(person.id) ? 255 : 0);
    figure.parts.alert?.opacity(person.stress > f(0.7) || person.food < f(0.15) ? 255 : 0);
    const hammering =
      !person.moving() &&
      !crossing &&
      (person.activity === Activity.Building || person.activity === Activity.Roadwork);
    const workplace = person.activity === Activity.Working ? town.building(person.target) : null,
      working = !s.sceneView && !striding && !person.inside && !crossing,
      farming = working && workplace?.kind === Structure.Farm && person.workField >= 0,
      watering = farming && farmWorkPhase(person, town.clock()) === 1,
      processing =
        working &&
        workplace &&
        workplace.productionProgress > 0 &&
        (workplace.kind === Structure.Sawmill || workplace.kind === Structure.Stoneworks);
    clearWorkProps(figure.parts);
    const tool = chopping
      ? 'axe'
      : miningNow
        ? 'pickaxe'
        : hammering
          ? 'hammer'
          : farming
            ? watering
              ? 'wateringCan'
              : 'hoe'
            : processing
              ? workplace.kind === Structure.Sawmill
                ? 'saw'
                : 'hammer'
              : fighting
                ? combatEquipment(person, town.building(person.job)?.kind)
                : callingEquipment(person.calling);
    showEquipment(figure.parts, tool);
    figure.parts.lute?.opacity(
      fighting || chopping || miningNow || hammering || farming || processing ? 0 : 255,
    );
    if (tool === 'bow') poseBow(figure.parts, 0);
    figure.parts.arrow?.opacity(0);
    if (!s.sceneView && tool) {
      if (farming) animateFieldWork(figure.parts, watering, town.clock() + person.id * 0.31);
      else if (processing)
        animateProcessingWork(
          figure.parts,
          workplace.kind === Structure.Sawmill,
          town.clock() + person.id * 0.31,
        );
      else if (chopping || miningNow)
        animateAction(
          figure.parts,
          tool,
          town.clock() - (person.until - woodcutting.cutSeconds),
          woodcutting.swingSeconds,
        );
      else if (hammering) animateAction(figure.parts, tool, town.clock() + person.id * 0.17, 0.85);
      else if (fighting && !striding && person.ready > town.clock())
        animateAction(figure.parts, tool, town.clock() - person.ready + 1 + strikePhase, 1);
    }
    const job =
        person.activity === Activity.Hauling && person.carrying === 0 ? town.building(person.job) : null,
      carried = job ? job.kind : Structure.Count,
      carrying = person.carrying > 0 && person.activity !== Activity.Collecting;
    figure.parts.logs?.opacity(carrying && person.carriedProduct === Product.Wood ? 255 : 0);
    figure.parts.stone?.opacity(carrying && person.carriedProduct === Product.Stone ? 255 : 0);
    figure.parts.planks?.opacity(carrying && person.carriedProduct === Product.Planks ? 255 : 0);
    figure.parts.cutStone?.opacity(carrying && person.carriedProduct === Product.CutStone ? 255 : 0);
    figure.parts.sack?.opacity(
      (job && carried !== Structure.Lumberyard && carried !== Structure.Quarry) ||
        (carrying &&
          ![Product.Wood, Product.Stone, Product.Planks, Product.CutStone].includes(person.carriedProduct))
        ? 255
        : 0,
    );
  }
  for (const [id, figure] of s.figures) {
    if (figure.seen) continue;
    if (figure.row >= 0) s.rows[figure.row].remove(figure.paint);
    s.figures.delete(id);
  }
  for (const sprite of s.beasts.values()) sprite.seen = false;
  for (const group of [town.monsters(), town.wildlife()])
    for (const beast of group) {
      if (beast.insideLair) continue;
      let sprite = s.beasts.get(beast.id);
      if (!sprite) {
        const look = new Agent(beast.id, AgentKind.Monster);
        sprite = {
          paint:
            beast.animal !== null && beast.animal !== undefined
              ? animalSprite(beast.animal)
              : agentSprite(look, town.map().dungeons()[beast.lair].kind),
          row: -1,
          seen: false,
        };
        s.beasts.set(beast.id, sprite);
      }
      sprite.seen = true;
      registerDepth(sprite.paint, beast.position, `beast:${beast.id}`);
      const row = standingRow(town, beast.position, count);
      if (row !== sprite.row) {
        if (sprite.row >= 0) s.rows[sprite.row].remove(sprite.paint);
        s.rows[row].add(sprite.paint);
        sprite.row = row;
      }
      const screen = project(beast.position.x, beast.position.y),
        rig = monsterParts(sprite.paint);
      let facing = rig?.facing ?? 1;
      const moved = rig && rig.last.x >= 0 ? sub(beast.position, rig.last) : point(),
        walking = beast.path.length > 0 || Math.hypot(moved.x, moved.y) > 0.0001;
      let ahead = beast.path.length ? sub(beast.path[0], beast.position) : moved;
      if (rig) {
        rig.body.transform([1, 0, 0, 0, 1, 0, 0, 0, 1]);
        if (!walking && !s.sceneView) {
          const period = breedOf(town.map().dungeons()[beast.lair].kind).pause,
            hitAt = beast.ready - period;
          // A ready timestamp can also schedule roaming. Require its actual damage event.
          const hit = town
            .hits()
            .find(
              (hit) =>
                hit.onPerson && Math.abs(hit.at - hitAt) < 0.002 && distance(hit.from, beast.position) < 0.03,
            );
          if (hit && town.clock() >= hit.at && town.clock() < beast.ready) {
            ahead = sub(hit.to, beast.position);
            animateMonsterAttack(rig, town.clock() - hit.at, period);
          }
        }
        rig.last = { ...beast.position };
      }
      if (Math.abs(ahead.x - ahead.y) > 0.0001) facing = ahead.x - ahead.y < 0 ? -1 : 1;
      if (rig) rig.facing = facing;
      sprite.paint.transform([facing, 0, screen.x, 0, 1, screen.y, 0, 0, 1]);
      sprite.paint.opacity(inSight(s, beast.position) ? 255 : 0);
    }
  for (const [id, sprite] of s.beasts) {
    if (sprite.seen) continue;
    if (sprite.row >= 0) s.rows[sprite.row].remove(sprite.paint);
    s.beasts.delete(id);
  }
}
export function markDamage(s: WorldRendererState, town: Town): void {
  updateBuildingDamage(s, town);
  if (!s.damageBack) {
    s.damageBack = new ShapeNode();
    s.damageLeft = new ShapeNode();
    s.combat.add(s.damageBack).add(s.damageLeft);
  }
  s.damageBack.reset();
  s.damageLeft!.reset();
  for (const item of town.buildings()) {
    if (!item.built() || item.health >= 1 || !inSight(s, item.center)) continue;
    const top = project(item.center.x, item.center.y),
      width = f(22 + f(8 * structureSpec(item.kind).size)),
      y = f(f(top.y - 34) - f(10 * structureSpec(item.kind).size));
    s.damageBack.appendRect(f(f(top.x - f(width / 2)) - 1), f(y - 1), f(width + 2), 5, f(1.5), f(1.5));
    s.damageLeft!.appendRect(f(top.x - f(width / 2)), y, f(width * Math.max(0, item.health)), 3, 1, 1);
  }
  s.damageBack.fill(14, 12, 16, 210);
  s.damageLeft!.fill(222, 82, 64);
}
export function sparkle(s: WorldRendererState, town: Town, seconds: number): void {
  for (const hit of town.hits()) {
    if (hit.serial < s.nextSpark) continue;
    s.nextSpark = BigInt.asUintN(64, hit.serial + 1n);
    if (!inSight(s, hit.to)) continue;
    const from = project(hit.from.x, hit.from.y),
      to = project(hit.to.x, hit.to.y);
    to.y = f(to.y - 9);
    from.y = f(from.y - 10);
    const paint = new SceneNode(),
      tint: Rgb = hit.onPerson ? [240, 70, 60] : hit.ranged ? [200, 160, 255] : [255, 230, 160];
    if (hit.ranged) paint.add(line(from, to, f(1.4), opaque(tint, 220)));
    const burst = new ShapeNode();
    for (let i = 0; i < 6; ++i) {
      const angle = f(f(i * f(1.047)) + f(Number(hit.serial % 7n) * f(0.3)));
      burst
        .moveTo(f(to.x + f(f(Math.cos(angle)) * 3)), f(to.y + f(f(Math.sin(angle)) * 2)))
        .lineTo(f(to.x + f(f(Math.cos(angle)) * 9)), f(to.y + f(f(Math.sin(angle)) * 6)));
    }
    burst
      .strokeWidth(f(1.6))
      .strokeCap('round')
      .strokeFill(...tint);
    paint.add(burst);
    if (!hit.ranged && !hit.onPerson) {
      const slash = new ShapeNode()
        .moveTo(f(to.x - 9), f(to.y - 6))
        .cubicTo(f(to.x - 2), f(to.y - 2), f(to.x + 3), f(to.y + 2), f(to.x + 9), f(to.y + 7))
        .strokeWidth(f(2.2))
        .strokeCap('round')
        .strokeFill(255, 250, 230, 230);
      paint.add(slash);
    }
    s.combat.add(paint);
    const number = new TextNode();
    number.font = 'DejaVuSans-Bold';
    number.size = 11;
    number.text = '-' + hit.damage;
    number.color = [...tint, 255];
    number.outline(2, 20, 14, 10);
    number.translate(f(to.x + 4), f(to.y - 14));
    s.combat.add(number);
    s.sparks.push({
      hit: { ...hit, from: { ...hit.from }, to: { ...hit.to } },
      shown: seconds,
      paint,
      number,
    });
  }
  s.sparks = s.sparks.filter((spark) => {
    const age = f(seconds - spark.shown);
    if (age >= 1) {
      s.combat.remove(spark.paint);
      if (spark.number) s.combat.remove(spark.number);
      return false;
    }
    spark.paint.opacity(Math.trunc(f(255 * Math.max(0, f(1 - f(age / f(0.35)))))));
    if (spark.number) {
      const to = project(spark.hit.to.x, spark.hit.to.y);
      spark.number.translate(f(to.x + 4), f(f(to.y - 23) - f(age * 20)));
      spark.number.opacity(Math.trunc(f(255 * Math.min(1, f(f(1 - age) * f(2.5))))));
    }
    return true;
  });
}
export function tread(s: WorldRendererState, town: Town, seconds: number): void {
  const sky = town.climate(),
    lasting = sky.weather === Weather.Snow ? 40 : 240;
  if (sky.snow < f(0.15)) s.footprints = [];
  s.footprints = s.footprints.filter((print) => seconds - print.made <= lasting);
  let changed = false;
  for (const p of town.people()) {
    const last = s.lastStep.get(p.id) ?? point();
    if (p.visibility() <= 0 || sky.snow < f(0.2)) {
      s.lastStep.set(p.id, { ...p.position });
      continue;
    }
    if (distance(last, p.position) < f(0.28)) continue;
    const along = normalized(sub(p.position, last));
    s.leftFoot = !s.leftFoot;
    const side = point(f(-along.y * f(0.06)), f(along.x * f(0.06)));
    s.footprints.push({ at: add(p.position, s.leftFoot ? side : mul(side, -1)), made: seconds });
    s.lastStep.set(p.id, { ...p.position });
    changed = true;
  }
  if (s.footprints.length > 900) s.footprints.splice(0, s.footprints.length - 900);
  if (!changed && seconds - s.printsAt < 1) return;
  s.printsAt = seconds;
  s.prints.remove();
  if (!s.footprints.length) return;
  const marks = new ShapeNode();
  for (const print of s.footprints) marks.appendCircle(print.at.x, print.at.y, f(0.045), f(0.045));
  marks.fill(96, 106, 124, 150);
  s.prints.add(marks);
}

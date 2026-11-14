import {
  Rect,
  Align,
  ButtonStyle,
  Icon,
  button,
  type Color,
} from '../../../../packages/native-ui/src';
import { Tool, Order, toolStructure } from '../../../../packages/engine/src/game-tools';
import { noticeToast } from './notice-toast';
import { toolInfo, buildMenuGroups, toolRequirements, type BuildGroup } from './build-menu-tools';
import {
  Structure,
  Product,
  Faith,
  structureSpec,
  isSeat,
  isHome,
  isLodging,
  isOutfitter,
  rentOf,
  priceOf,
  faithName,
  describe,
} from '../../../../packages/engine/src/building-catalog';
import { Activity } from '../../../../packages/engine/src/person';
import { DungeonKind } from '../../../../packages/engine/src/world-types';
import { worldName } from '../../../../packages/engine/src/world-map';
import { point, project, sub, distance } from '../../../../packages/engine/src/geometry';
import { f32, clamp, lround } from '../../../../packages/engine/src/numeric';
import type { Town } from '../../../../packages/engine/src/town';
import { structureIcon } from '../../../../packages/native-renderer/src/building-icon';
import { constructionIcon } from '../../../../packages/native-renderer/src/construction-icon';
import { buildingAppearanceRevision } from '../../../../packages/native-renderer/src/building-assets';
import type { GameHudApp } from './game-hud-contract';
import { canControl, isPlayerBuilding } from '../../../../packages/engine/src/faction';
import { civicInspector } from './game-civic-panel';
import { hudPaint } from './hud-paint';
import { winterOutlookLine, winterLineHeight, type CampMarker } from './camp-resource-hud';
import { actionButton } from './hud-actions';
import {
  wrapText,
  trackUnlocks,
  noteBuildPage,
  freshGroup,
  freshMark,
  lockMark,
  requirementTip,
  progressInspector,
  type InspectorRows,
} from './game-progress-hud';
import { touchPlacementHeight } from './mobile-layout';
import { combatOverlays } from './game-combat-hud';
import { guideHud } from './game-guide-panel';
import { unitOrdersCard } from './unit-orders-card';
import { groupTabs } from './control-groups';
import { aimPrompt, currentAim } from './skill-commands';
import { floorForecast } from './swarm-hud';
const tools = toolInfo;
/** Every group with every building: locked ones stay in the menu, greyed, with what they need. */
export function buildGroups(_town: Town): BuildGroup[] {
  return [...buildMenuGroups];
}
const dungeonKind = (kind: DungeonKind) =>
  ['Cave', 'Crypt', 'Rift portal', 'Ruined tower', 'Coastal giant hall', 'Rift'][kind] ?? '';
const wrap = wrapText;
export function hud(this: GameHudApp, width: number, height: number): void {
  this.updateContextDock(width, height);
  trackUnlocks(this);
  const c = this.context,
    t = this.theme;
  this.skyMural(width);
  if (this.town.raiding())
    c.text(
      new Rect(
        (width - Math.min(320, width - 24)) / 2,
        f32(f32(this.skyBounds.y + this.skyBounds.h) + 8),
        Math.min(320, width - 24),
        20,
      ),
      'Raid! Defend the settlement',
      t.danger,
      12,
      true,
      Align.Center,
    );
  if ((this.status || this.current.problem) && !(this.touchMode && this.toolStructure() !== undefined))
    c.text(
      new Rect(16, f32(this.dockBounds.y - 28), f32(width - 32), 22),
      this.status || this.current.problem,
      t.danger,
      13,
      true,
      Align.Center,
    );
  if (this.pending !== Order.None)
    c.text(
      new Rect(12, f32(this.dockBounds.y - 34), f32(width - 24), 22),
      this.touchMode
        ? this.pending === Order.Move
          ? 'Tap a destination'
          : this.pending === Order.Work
            ? 'Tap a resource, building or road'
            : 'Tap a target or destination'
        : this.pending === Order.Move
          ? 'Move: choose a destination'
          : this.pending === Order.Work
            ? 'Work: choose a resource, building or road'
            : 'Attack: choose an enemy, resource or destination',
      t.accent,
      13,
      true,
      Align.Center,
    );
  else if (currentAim(this))
    c.text(new Rect(12, f32(this.dockBounds.y - 34), f32(width - 24), 22), aimPrompt(this), t.accent, 13, true, Align.Center);
  if (!this.touchMode && width > 640 && !this.town.camp() && this.town.map().dungeons().length) {
    const lair = this.town.map().dungeons()[0].origin,
      start = this.town.map().camp(),
      toward = sub(project(f32(lair.x + 1), f32(lair.y + 1)), project(start.x, start.y)),
      angle = f32(f32(Math.atan2(toward.y, toward.x)) * f32(57.3)),
      ways = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'],
      way = ways[lround(f32((angle < 0 ? f32(angle + 360) : angle) / 45)) % 8],
      hintX = 16,
      hintWidth = Math.max(1, f32(f32(width - hintX) - 316)),
      hint = `Found a camp (C) near ${this.town.map().dungeons()[0].name} (${way}).`;
    let y = f32(f32(this.skyBounds.y + this.skyBounds.h) + 8);
    for (const row of wrap(c, hint, hintWidth, 11, 2)) {
      c.text(new Rect(hintX, y, hintWidth, 17), row, t.accent, 11);
      y = f32(y + 17);
    }
  }
  noticeToast(this, width, height);
  this.objectives(width, height, this.touchMode ? (this.timeExpanded ? 116 : 64) : width < 900 ? 104 : 64);
  this.realmPanel(width, height);
  this.timeControls(width);
  this.campSupplies(width, height);
  this.calendarDetails(width);
  this.taskbar(width, height);
  if (!this.town.isTitleAutoplay()) groupTabs(this, height);
  combatOverlays(this, width, height);
  this.realmRewardBanner(width, height);
  this.sagaBanner(width, height);
  guideHud(this, width, height);
}
export function campSupplies(this: GameHudApp, width: number, height: number): void {
  const markers: CampMarker[] = [];
  for (const b of this.town.buildings())
    if (isPlayerBuilding(b) && isSeat(b.kind) && this.town.map().revealed(b.center)) {
      const roof = this.camera.toScreen(
        this.renderer.buildingRoof(b) ?? project(b.center.x, b.center.y, 32),
        width,
        height,
      );
      if (roof.x < -48 || roof.x > f32(width + 48) || roof.y < 0 || roof.y > f32(height + 48)) continue;
      markers.push({ camp: b.id, roof });
    }
  let hovered = -1;
  if (
    !this.touchMode &&
    this.tool === Tool.Select &&
    this.pending === Order.None &&
    !this.panFrom &&
    !this.boxFrom &&
    !this.context.controlAt(this.mouse.x, this.mouse.y) &&
    this.personAt(this.mouse) < 0
  ) {
    const b = this.town.building(this.buildingAtScreen(this.mouse));
    if (isPlayerBuilding(b) && isSeat(b.kind)) hovered = b.id;
  }
  const top = width < 900 && this.timeExpanded ? 100 : 60;
  this.campResources.draw(
    this.context,
    this.theme,
    this.town,
    markers,
    hovered,
    new Rect(
      12,
      top,
      f32(width - 24),
      Math.max(0, f32(Math.min(f32(height - 12), f32(this.dockBounds.y - 12)) - top)),
    ),
    this.reducedMotion(),
  );
}
export function inspector(this: GameHudApp, panel: Rect, draw = true): number {
  const c = this.context,
    t = this.theme,
    building = this.selected >= 0 ? this.town.building(this.selected) : null;
  if (!building && this.selectedDungeon < 0) return 0;
  if (this.touchMode && building?.built() && isSeat(building.kind)) {
    const stores = 180 + (winterOutlookLine(this.town, building.id) ? winterLineHeight : 0);
    if (draw)
      this.campResources.drawStores(
        c,
        t,
        this.town,
        building.id,
        new Rect(panel.x + 8, panel.y + 8, panel.w - 16, stores),
      );
    return stores + 16;
  }
  if (building?.built() && [Structure.Shrine, Structure.Guild, Structure.GuildHall].includes(building.kind))
    return civicInspector.call(this, building, panel, draw);
  let y = 12;
  const left = f32(panel.x + 112),
    inner = f32(panel.w - 128),
    top = panel.y,
    rows: (() => void)[] = [],
    textRow = (text: string, color: Color, size = 13, bold = false) => {
      const at = y;
      rows.push(() => c.text(new Rect(left, f32(top + at), inner, f32(size + 8)), text, color, size, bold));
      y = f32(y + f32(size + 9));
    };
  if (building) {
    const spec = structureSpec(building.kind);
    textRow(spec.name, t.text, 17, true);
    if (building.faction > 0)
      textRow(`Neutral settlement #${building.faction} · inspection only`, t.accent, 12, true);
    if (building.built() && building.health < 1)
      textRow(
        `Damaged: ${Math.trunc(f32(building.health * 100))}%  -  builders will mend it`,
        t.danger,
        12,
        true,
      );
    for (const line of wrap(c, spec.description, inner, 12)) textRow(line, t.muted, 12);
    y = f32(y + 4);
    if (!building.built()) {
      textRow(`Under construction: ${Math.trunc(f32(building.progress * 100))}%`, t.accent, 13, true);
      textRow('On site: ' + describe(building.materials.delivered), t.text, 12);
      textRow('Required: ' + describe(building.materials.required), t.muted, 12);
      const source = this.town.constructionSupplyCamp(building.id);
      textRow(
        source >= 0 ? 'Road supply: Camp #' + (source + 1) : 'Gather locally and carry materials here',
        t.muted,
        11,
      );
    }
    if (spec.residents) textRow(`Homes ${spec.residents} people`, t.text);
    if (rentOf(building.kind)) {
      const owner = this.town.person(building.owner);
      textRow(
        owner
          ? `Owned by ${owner.name}`
          : `Let for ${rentOf(building.kind)} gold a day per resident; sells for ${priceOf(building.kind)}`,
        owner ? t.accent : t.muted,
        12,
      );
    }
    if (spec.beds) textRow(`Beds for ${spec.beds} guests`, t.text);
    if (building.built() && (isHome(building.kind) || isLodging(building.kind))) {
      const residents = this.town.occupants(building.id),
        pageSize = 6,
        pages = Math.max(1, Math.trunc(f32(f32(f32(residents.length + pageSize) - 1) / pageSize)));
      this.residentPage = Math.min(this.residentPage, f32(pages - 1));
      textRow(
        `${isLodging(building.kind) ? 'Guests ' : 'Residents '}${residents.length}${isLodging(building.kind) ? '  -  click a name to inspect' : '  -  click a name to inspect'}`,
        t.accent,
        12,
        true,
      );
      const last = Math.min(residents.length, f32(f32(this.residentPage + 1) * pageSize));
      for (let i = f32(this.residentPage * pageSize); i < last; i++) {
        const id = residents[i],
          at = y;
        rows.push(() => {
          const p = this.town.person(id);
          if (!p) return;
          const resting = p.task === Activity.Sleeping && p.taskSite === building.id,
            present = this.town.shelterOf(p) === building.id,
            state = present
              ? p.inside
                ? p.activity === Activity.Sleeping
                  ? 'Resting'
                  : 'Inside'
                : 'Leaving'
              : resting
                ? 'On the way'
                : 'Away';
          button(
            c,
            'resident-' + id,
            new Rect(left, f32(top + at), f32(inner - 174), 28),
            p.name,
            () => this.selectPeople([id]),
            ButtonStyle.Quiet,
          );
          c.text(
            new Rect(f32(f32(left + inner) - 168), f32(top + at), 88, 28),
            state,
            present ? t.success : t.muted,
            11,
          );
          button(
            c,
            'resident-leave-' + id,
            new Rect(f32(f32(left + inner) - 74), f32(top + at), 74, 28),
            'Leave',
            () => {
              this.selectPeople([id]);
              this.leaveSelected();
            },
            ButtonStyle.Default,
            canControl(p) && (present || resting),
          );
        });
        y = f32(y + 32);
      }
      if (pages > 1) {
        const at = y,
          page = this.residentPage;
        rows.push(() => {
          button(
            c,
            'residents-prev',
            new Rect(left, f32(top + at), 80, 26),
            'Previous',
            () => {
              this.residentPage--;
            },
            ButtonStyle.Quiet,
            page > 0,
          );
          c.text(new Rect(f32(left + 88), f32(top + at), 80, 26), `${f32(page + 1)} / ${pages}`, t.muted, 12);
          button(
            c,
            'residents-next',
            new Rect(f32(left + 174), f32(top + at), 80, 26),
            'Next',
            () => {
              this.residentPage++;
            },
            ButtonStyle.Quiet,
            f32(page + 1) < pages,
          );
        });
        y = f32(y + 30);
      }
    }
    if (building.kind === Structure.WoodStore) textRow('Keeps 240 more logs and planks', t.text);
    if (building.kind === Structure.Granary) textRow('Keeps 240 more food; meals served here', t.text);
    if (building.kind === Structure.StoneStore) textRow('Keeps 240 more rough and cut stone', t.text);
    if (spec.storage) textRow(`Keeps ${spec.storage} more of wood, stone, food and water`, t.text);
    if (isLodging(building.kind) || building.kind === Structure.Tavern || isOutfitter(building.kind))
      textRow(`Earned ${building.earned} gold from guests`, t.muted, 12);
    if (building.kind === Structure.Guild || building.kind === Structure.GuildHall)
      textRow(`${building.trainingCount} residents trained`, t.muted, 12);
    if (building.kind === Structure.Chapel && building.built()) {
      const peoples = ['humans', 'elves', 'dwarves', 'beastfolk'];
      textRow(`${faithName(building.faith)}: draws ${peoples[building.faith]}`, t.accent, 12, true);
      const at = y,
        id = building.id,
        current = building.faith;
      rows.push(() => {
        const tabs = ['Dawn', 'Grove', 'Forge', 'Moon'],
          w = Math.min(90, f32(f32(inner - 9) / 4));
        for (let i = 0; i < 4; i++)
          button(
            c,
            'faith-' + tabs[i],
            new Rect(f32(left + f32(i * f32(w + 3))), f32(top + at), w, 26),
            tabs[i],
            () => {
              if (isPlayerBuilding(this.town.building(id))) this.town.setFaith(id, i);
            },
            current === i ? ButtonStyle.Primary : ButtonStyle.Default,
            isPlayerBuilding(building),
          );
      });
      y = f32(y + 32);
    }
    if (spec.jobs) {
      const at = y,
        id = building.id,
        workers = building.workers,
        hands = this.town.idle() > 0 || this.town.employed() > workers;
      rows.push(() => {
        const labelWidth = this.touchMode ? inner - 100 : 200,
          size = this.touchMode ? 44 : 30,
          rowHeight = this.touchMode ? 44 : 26;
        c.text(
          new Rect(left, f32(top + at), labelWidth, rowHeight),
          `Workers ${workers} / ${spec.jobs}`,
          t.text,
          13,
        );
        button(
          c,
          'workers-less',
          new Rect(f32(left + (this.touchMode ? inner - 94 : 200)), f32(top + at), size, rowHeight),
          '-',
          () => {
            if (isPlayerBuilding(this.town.building(id))) this.town.setWorkers(id, f32(workers - 1));
          },
          ButtonStyle.Default,
          isPlayerBuilding(building) && workers > 0,
        );
        button(
          c,
          'workers-more',
          new Rect(f32(left + (this.touchMode ? inner - 44 : 234)), f32(top + at), size, rowHeight),
          '+',
          () => {
            if (isPlayerBuilding(this.town.building(id))) this.town.setWorkers(id, f32(workers + 1));
          },
          ButtonStyle.Default,
          isPlayerBuilding(building) && workers < spec.jobs && hands,
        );
      });
      y = f32(y + (this.touchMode ? 50 : 32));
      const output = this.town.dailyOutput(building);
      if (building.kind === Structure.Farm)
        textRow(
          `Fields tended ${this.town.tendedFieldAcres()} of ${this.town.fieldAcres()} acres`,
          t.muted,
          12,
        );
      else if (spec.product === Product.Wood) {
        let standing = 0;
        const map = this.town.map();
        for (let y = f32(Math.trunc(building.center.y) - 5); y <= f32(Math.trunc(building.center.y) + 5); y++)
          for (
            let x = f32(Math.trunc(building.center.x) - 5);
            x <= f32(Math.trunc(building.center.x) + 5);
            x++
          )
            if (
              map.inside(x, y) &&
              distance(point(f32(x + f32(0.5)), f32(y + f32(0.5))), building.center) < f32(4.6)
            )
              standing = f32(standing + map.at(x, y).trees);
        textRow(
          standing
            ? `Fells nearby trees: ${standing} left in reach`
            : 'No trees left in reach; they grow back slowly',
          standing ? t.success : t.danger,
          12,
        );
      } else if (spec.product === Product.Planks || spec.product === Product.CutStone)
        textRow(
          spec.product === Product.Planks
            ? '2 logs → 1 plank / 24 worker seconds'
            : '2 stone → 1 cut stone / 30 worker seconds',
          t.success,
          12,
        );
      else if (spec.product !== Product.None)
        textRow(
          output.empty() ? 'No output' : `Makes ${describe(output)} a day`,
          output.empty() ? t.danger : t.success,
          12,
        );
    }
    const progress: InspectorRows = { rows, left, inner, top, y };
    progressInspector(this, building, -1, progress);
    y = progress.y;
    const growth = this.town.growthStatus(building);
    if (growth.grows) {
      y = f32(y + 4);
      textRow('Grows into ' + growth.next, t.accent, 13, true);
      const at = y,
        fraction = growth.needed ? f32(growth.days / growth.needed) : 0;
      rows.push(() => {
        c.rect(new Rect(left, f32(f32(top + at) + 4), inner, 8), t.raised, 4);
        c.rect(new Rect(left, f32(f32(top + at) + 4), Math.max(8, f32(inner * fraction)), 8), t.accent, 4);
      });
      y = f32(y + 18);
      textRow(`${growth.days} / ${growth.needed} days`, t.muted, 12);
      if (growth.reason)
        for (const line of wrap(c, growth.reason, inner, 12, 2))
          textRow(line, growth.ready ? t.muted : t.danger, 12);
    }
  } else {
    const site = this.town.map().dungeons()[this.selectedDungeon];
    textRow(site.name, t.text, 16, true);
    textRow(
      site.kind === DungeonKind.Return
        ? 'Rift  -  the way back to Midgard'
        : `${dungeonKind(site.kind)}  -  a way to ${worldName(this.town.map().destination(site))}`,
      t.accent,
      13,
    );
    if (site.kind === DungeonKind.Return) {
      for (const line of wrap(
        c,
        'The way back to Midgard. Gather the whole party here, then choose Go home. After the guardian falls the way opens from anywhere.',
        inner,
        12,
      ))
        textRow(line, t.muted, 12);
    } else if (site.kind === DungeonKind.GiantHall) {
      for (const line of wrap(
        c,
        'Neutral stone giants live on the eastern coast. They leave their hall by day and return at dusk. They retaliate only when attacked.',
        inner,
        12,
      ))
        textRow(line, t.muted, 12);
    } else {
      const gate = this.selectedDungeon,
        floors = this.town.gateFloors(gate),
        chosen = Math.min(this.gateFloor.get(gate) ?? this.town.deepestOpenFloor(gate), this.town.deepestOpenFloor(gate));
      textRow(
        floors.sealed ? 'Sealed: no raid leaves this gate' : `Floors cleared: ${floors.cleared} of ${floors.total}`,
        floors.sealed ? t.success : t.text,
        12,
        true,
      );
      const at = y;
      rows.push(() => {
        const span = f32(f32(inner - 8 * (floors.total - 1)) / floors.total);
        for (let floor = 0; floor < floors.total; ++floor)
          button(
            c,
            'gate-floor/' + floor,
            new Rect(f32(left + f32((span + 8) * floor)), f32(f32(top + at) + 2), span, 26),
            `Floor ${floor + 1}` + (floor < floors.cleared ? ' *' : ''),
            () => this.gateFloor.set(gate, floor),
            ButtonStyle.Default,
            this.town.floorOpen(gate, floor),
            undefined,
            floor === chosen,
          );
      });
      y = f32(y + 34);
      floorForecast(this, gate, chosen).forEach((line, i) => {
        for (const row of wrap(c, line, inner, 12)) textRow(row, i === 0 ? t.text : t.muted, 12);
      });
      const problem = this.town.expeditionProblem(gate, chosen);
      for (const line of wrap(
        c,
        problem ||
          `Select residents and right-click this gate to lead them to floor ${chosen + 1}. * marks a cleared floor that can be fought again. Clear floor ${floors.total} to seal the gate.`,
        inner,
        12,
      ))
        textRow(line, problem ? t.danger : t.muted, 12);
      const progress: InspectorRows = { rows, left, inner, top, y };
      progressInspector(this, null, gate, progress);
      y = progress.y;
    }
  }
  const h = Math.max(126, f32(y + 10));
  if (!draw) return h;
  const frame = new Rect(f32(panel.x + 12), f32(panel.y + 12), 84, 94);
  c.rect(frame, t.raised, t.radius, t.border);
  if (building) {
    const art = new Rect(f32(frame.x + 10), f32(frame.y + 10), f32(frame.w - 20), f32(frame.h - 20)),
      kind = building.kind;
    c.paint(
      `inspect-${buildingAppearanceRevision(kind)}-${kind}-${Math.trunc(art.x)}-${Math.trunc(art.y)}`,
      () => {
        const holder = new c.tvg.Scene(),
          icon = hudPaint(c, structureIcon(kind, art.w, art.h));
        holder.add(icon);
        icon.dispose();
        holder.translate(art.x, art.y);
        return holder;
      },
    );
  }
  for (const row of rows) row();
  return h;
}
export function buildMenuBounds(this: GameHudApp, width: number, height: number, global: boolean): Rect {
  const groups = buildGroups(this.town),
    page = clamp(global ? this.globalCard : this.card, 0, groups.length),
    count = page === 0 ? groups.length : groups[f32(page - 1)].tools.length,
    cell = page === 0 ? 78 : 86,
    available = Math.max(160, f32(width - 24)),
    columns = Math.max(1, Math.min(count, Math.trunc(f32(f32(available - 18) / f32(cell + 6))))),
    w = Math.min(available, Math.max(244, f32(f32(f32(columns * cell) + f32(f32(columns - 1) * 6)) + 24))),
    rows = Math.trunc(f32(f32(f32(count + columns) - 1) / columns)),
    h = f32(
      f32(
        f32((this.touchMode ? 60 : 48) + f32(rows * (page === 0 ? (this.touchMode ? 44 : 32) : 64))) +
          f32(f32(rows - 1) * 6),
      ) + (page === 0 ? 6 : 30),
    );
  return new Rect(f32(f32(width - w) / 2), f32(f32(height - 56) - h), w, h);
}
export function commandCard(
  this: GameHudApp,
  area: Rect,
  scale = 1,
  global = false,
  buildMenu = false,
): void {
  const c = this.context,
    t = this.theme,
    appearance = { fontSize: f32(12 * scale), radius: f32(t.radius * scale) },
    drawButton = (
      id: string,
      bounds: Rect,
      label: string,
      activate: () => void,
      style = ButtonStyle.Default,
      enabled = true,
      look: { fill?: Color } = {},
    ) => {
      button(
        c,
        `${global ? 'global/' : 'unit/'}${id}`,
        bounds,
        label,
        activate,
        style,
        enabled,
        Icon.None,
        false,
        { ...appearance, ...look },
      );
    };
  if (!buildMenu) {
    unitOrdersCard(this, area, scale, global);
    return;
  }
  const groups = buildGroups(this.town),
    page = clamp(global ? this.globalCard : this.card, 0, groups.length),
    setPage = (next: number) => {
      const d = this.dockBounds;
      this.drawerBridge = new Rect(d.x, d.y, d.w, d.h);
      if (global) this.globalCard = next;
      else this.card = next;
      this.buildHint = null;
    };
  noteBuildPage(this, page === 0 ? [] : groups[f32(page - 1)].tools);
  actionButton(
    c,
    `${global ? 'global/' : 'unit/'}card-back`,
    new Rect(f32(area.x + 10), f32(area.y + 5), this.touchMode ? 44 : 34, this.touchMode ? 44 : 32),
    'back',
    'Back',
    () => {
      if (page > 0) setPage(0);
      else this.dismissBuildDrawer();
    },
    false,
    true,
    false,
  );
  let title = page === 0 ? 'Build' : groups[f32(page - 1)].name;
  if (!global && this.chosen.length === 1) {
    const p = this.town.person(this.chosen[0]);
    if (p) title = `${title} · ${p.name}`;
  }
  c.text(
    new Rect(f32(area.x + 64), f32(area.y + 10), f32(area.w - 76), 22),
    c.elideText(title, f32(area.w - 76), 13, true),
    t.text,
    13,
    true,
  );
  const count = page === 0 ? groups.length : groups[f32(page - 1)].tools.length,
    preferred = page === 0 ? 78 : 86,
    columns = Math.max(1, Math.min(count, Math.trunc(f32(f32(area.w - 18) / f32(preferred + 6))))),
    w = f32(f32(f32(area.w - 24) - f32(f32(columns - 1) * 6)) / columns),
    h = page === 0 ? (this.touchMode ? 44 : 32) : 64,
    cell = (i: number) =>
      new Rect(
        f32(f32(area.x + 12) + f32((i % columns) * f32(w + 6))),
        f32(f32(area.y + (this.touchMode ? 54 : 40)) + f32(Math.trunc(f32(i / columns)) * f32(h + 6))),
        w,
        h,
      );
  if (page === 0) {
    for (let i = 0; i < count; i++) {
      const { name, glyph, tools: members } = groups[i];
      actionButton(c, `${global ? 'global/' : 'unit/'}card-group-${name}`, cell(i), glyph, name, () =>
        setPage(f32(i + 1)),
      );
      if (freshGroup(this, members)) freshMark(this, cell(i), false);
    }
    return;
  }
  let detail = 'Choose a building',
    detailColor = t.muted;
  const group = groups[f32(page - 1)];
  for (let i = 0; i < count; i++) {
    const id = group.tools[i],
      bounds = cell(i),
      kind = toolStructure(id),
      hasIcon = kind !== undefined || id === Tool.Road || id === Tool.Pave || id === Tool.Field;
    // Locked cards stay in the menu: a press lists what they need instead of picking them.
    const needs = toolRequirements(this.town, id),
      missing = needs.filter((need) => !need.done),
      why = missing.length ? 'Locked: ' + missing.map((need) => need.text).join(' · ') : '',
      cardId = `${global ? 'global/' : 'unit/'}card-pick-${tools[id].label}`;
    drawButton(
      'card-pick-' + tools[id].label,
      bounds,
      hasIcon ? '' : tools[id].label,
      () => {
        if (!missing.length) this.selectTool(id, !global);
        else this.buildHint = this.buildHint === id ? null : id;
      },
      this.tool === id ? ButtonStyle.Primary : ButtonStyle.Default,
      true,
      missing.length ? { fill: t.surface } : {},
    );
    if (hasIcon) {
      const dim = !!why,
        art = new Rect(f32(bounds.x + 6), f32(bounds.y + 3), f32(bounds.w - 12), f32(bounds.h - 23));
      c.paint(
        `card-icon-${kind === undefined ? 0n : buildingAppearanceRevision(kind)}${JSON.stringify([id, art, dim])}`,
        () => {
          const holder = new c.tvg.Scene(),
            icon = hudPaint(c, constructionIcon(id, art.w, art.h));
          holder.add(icon);
          icon.dispose();
          holder.translate(art.x, art.y);
          if (dim) holder.opacity(90);
          return holder;
        },
      );
      c.text(
        new Rect(f32(bounds.x + 3), f32(f32(bounds.y + bounds.h) - 20), f32(bounds.w - 6), 18),
        tools[id].label,
        dim ? t.muted : t.text,
        11,
        false,
        Align.Center,
      );
    }
    if (missing.length) {
      lockMark(this, bounds);
      if (this.buildHint === id || bounds.contains(this.mouse.x, this.mouse.y) || c.focused() === cardId)
        requirementTip(this, cardId, id, needs);
    }
    if (this.unlockFresh.has(id)) freshMark(this, bounds, true);
    if (bounds.contains(this.mouse.x, this.mouse.y) || this.buildHint === id) {
      detail =
        why ||
        (kind !== undefined ? `${describe(structureSpec(kind).cost)} · ${tools[id].key}` : tools[id].hint);
      detailColor = why ? t.accent : t.muted;
    }
  }
  c.text(
    new Rect(f32(area.x + 12), f32(f32(area.y + area.h) - 26), f32(area.w - 24), 18),
    c.elideText(detail, f32(area.w - 24), 11),
    detailColor,
    11,
  );
}
export function placementPanelBounds(this: GameHudApp, width: number, height: number): Rect {
  const w = Math.min(this.touchMode ? 520 : 460, f32(width - 24)),
    h = this.touchMode ? touchPlacementHeight : 70;
  return new Rect(f32(f32(width - w) / 2), f32(height - 12 - h), w, h);
}
export function placementPanel(this: GameHudApp, panel: Rect): void {
  const c = this.context,
    t = this.theme;
  if (this.touchMode) {
    const kind = this.toolStructure(),
      detail =
        kind !== undefined
          ? this.current.problem || `${describe(structureSpec(kind).cost)} · Tap or drag to position`
          : this.tool === Tool.Road || this.tool === Tool.Field
            ? 'Draw with one finger · Move or zoom with two'
            : 'Tap a target · Drag to move the map',
      y = panel.y + 56;
    c.text(new Rect(panel.x + 12, panel.y + 8, panel.w - 24, 22), tools[this.tool].label, t.text, 14, true);
    c.text(
      new Rect(panel.x + 12, panel.y + 32, panel.w - 24, 18),
      c.elideText(detail, panel.w - 24, 11),
      this.current.problem ? t.danger : t.muted,
      11,
    );
    actionButton(c, 'placement-build', new Rect(panel.x + 10, y, 44, 44), 'build', 'Buildings', () => {
      this.globalCard = 0;
      this.card = -1;
      this.drawerPinned = true;
      this.drawerSuppressed = false;
    });
    if (kind !== undefined) {
      actionButton(c, 'placement-rotate', new Rect(panel.x + 62, y, 44, 44), 'rotate', 'Rotate', () =>
        this.rotate(Math.PI / 12),
      );
      button(
        c,
        'placement-confirm',
        new Rect(panel.x + 116, y, panel.w - 180, 44),
        'Place',
        () => this.confirmTouchPlacement(),
        ButtonStyle.Primary,
        !!this.touchPlacement && this.current.preview.valid,
      );
    } else if (this.tool === Tool.Field && this.outline.length) {
      actionButton(c, 'placement-undo', new Rect(panel.x + 62, y, 44, 44), 'back', 'Undo point', () =>
        this.undoPoint(),
      );
      button(
        c,
        'placement-confirm',
        new Rect(panel.x + 116, y, panel.w - 180, 44),
        'Plant',
        () => this.finish(),
        ButtonStyle.Primary,
        this.outline.length >= 3 && this.current.preview.valid,
      );
    } else
      c.text(
        new Rect(panel.x + 60, y, panel.w - 124, 44),
        'Two fingers to move / zoom',
        t.muted,
        11,
        false,
        Align.Center,
      );
    actionButton(
      c,
      'placement-cancel',
      new Rect(panel.x + panel.w - 54, y, 44, 44),
      'close',
      'Cancel placement',
      () => this.selectTool(Tool.Select),
      false,
      true,
      false,
    );
    return;
  }
  c.text(
    new Rect(f32(panel.x + 12), f32(panel.y + 9), f32(panel.w - 172), 22),
    tools[this.tool].label,
    t.text,
    14,
    true,
  );
  const kind = this.toolStructure(),
    detail = kind !== undefined ? `${describe(structureSpec(kind).cost)} · R rotates` : tools[this.tool].hint;
  c.text(
    new Rect(f32(panel.x + 12), f32(panel.y + 36), f32(panel.w - 24), 18),
    c.elideText(detail, f32(panel.w - 24), 11),
    t.muted,
    11,
  );
  button(
    c,
    'placement-build',
    new Rect(f32(f32(panel.x + panel.w) - 156), f32(panel.y + 9), 68, 24),
    'Build',
    () => {
      this.globalCard = 0;
      this.card = -1;
      this.drawerPinned = true;
      this.drawerSuppressed = false;
    },
    ButtonStyle.Quiet,
  );
  button(
    c,
    'placement-cancel',
    new Rect(f32(f32(panel.x + panel.w) - 82), f32(panel.y + 9), 70, 24),
    'Cancel',
    () => this.selectTool(Tool.Select),
    ButtonStyle.Quiet,
  );
}

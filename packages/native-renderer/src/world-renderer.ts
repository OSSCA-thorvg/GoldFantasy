// Retained WebCanvas world rendering with ground-baseline object ordering and cached geometry.
import { Camera, point, project, tileHalfHeight, type Point } from '../../engine/src/geometry';
import { f32 as f } from '../../engine/src/numeric';
import { Preview } from '../../engine/src/game-tools';
import { VisibilityMap } from '../../engine/src/visibility-map';
import type { Town } from '../../engine/src/town';
import type { Traffic } from '../../engine/src/traffic';
import type { Building } from '../../engine/src/town-models';
import type { Strike } from '../../engine/src/thunderstorm';
import type { TileRegion } from './render-types';
import { WorldRendererState } from './world-renderer-state';
import { WorldPicker } from './world-picking';
import type {
  PickBounds,
  SelectionGeometry,
  WorldHit,
  WorldObjectRef,
  GroundSelectionMarker,
} from './world-picking-types';
import { GroundSelection } from './ground-selection';
import { hasResourceHits, resetResourceHits, updateResourceHits } from './resource-hit';
import { buildingCatalogGeneration } from './building-assets';
import { resize, fitToView, paintMapName, buildPreview, updateGroundChunks } from './world-ground';
import { paintGround, tintGround, paintFields } from './terrain-painter';
import { paintRoads } from './road-painter';
import { syncVisuals, buildObjects, buildRoadLights } from './world-objects';
import { buildDarkness, updateVision } from './world-vision';
import { cullTrees, swayTrees, updateFelling, updateGrowth } from './world-trees';
import { moveAgents, tread, sparkle, markDamage } from './world-people';
import { animate } from './world-animation';
import { paintStorm } from './world-weather';
import { ymirHeight } from './ymir-statue';
import { volcanoHeight, volcanoSmoke } from './volcano-painter';
import { sortWorldObjects, footprintBaseline, baselineDepthAt } from './world-depth';

const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const samePreview = (a: Preview, b: Preview): boolean =>
  a.kind === b.kind &&
  a.closed === b.closed &&
  a.brush === b.brush &&
  a.active === b.active &&
  a.valid === b.valid &&
  a.zoom === b.zoom &&
  samePoint(a.cursor, b.cursor) &&
  a.outline.length === b.outline.length &&
  a.outline.every((p, i) => samePoint(p, b.outline[i])) &&
  a.road.length === b.road.length &&
  a.road.every(
    (p, i) =>
      samePoint(p.point, b.road[i].point) && samePoint(p.in, b.road[i].in) && samePoint(p.out, b.road[i].out),
  );
const intersects = (a: TileRegion, b: TileRegion) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

export class WorldRenderer extends WorldRendererState {
  private readonly picker = new WorldPicker(this);
  private readonly groundSelection = new GroundSelection(this);
  private pickedTown: Town | null = null;
  pick(screen: Point): WorldHit | null {
    return this.picker.pick(screen);
  }
  querySelection(region: PickBounds): WorldHit[] {
    return this.picker.querySelection(region);
  }
  selectionGeometry(ref: WorldObjectRef): SelectionGeometry | null {
    return this.picker.selectionGeometry(ref);
  }
  setGroundSelection(markers: readonly GroundSelectionMarker[]): void {
    const retired = this.groundSelection.set(this.picker.groundSelection(markers, this.pickedTown));
    this.adapter.sync(this.selection);
    if (retired) this.collectPaints();
  }
  presented(dpr: number): void {
    if (this.pickedTown) this.picker.presented(this.pickedTown, dpr);
  }
  invalidatePresentation(): void {
    this.picker.invalidate();
  }
  override dispose(): void {
    resetResourceHits(this);
    this.picker.invalidate();
    this.pickedTown = null;
    super.dispose();
  }

  animating(): boolean {
    return (
      this.fallingTrees.length !== 0 ||
      this.growingTrees.length !== 0 ||
      hasResourceHits(this) ||
      [...this.visuals.values()].some((v) => v.frame < v.layout.frames)
    );
  }
  visible(at: Point): boolean {
    return this.currentVisibility.sample(at) >= 119;
  }
  invalidateMap(): void {
    resetResourceHits(this);
    this.invalidatePresentation();
    for (const tree of this.fallingTrees) this.rows[tree.row]?.remove(tree.paint);
    this.fallingTrees = [];
    this.seenTreeEvent = 0n;
    for (const tree of this.growingTrees) this.rows[tree.row]?.remove(tree.paint);
    this.growingTrees = [];
    this.treeCounts = new Uint8Array();
    for (const landmark of [this.ymirPaint, this.volcanoPaint]) {
      landmark.paint = undefined;
      landmark.key = -1n;
    }
    this.nameDirty = true;
    this.ground.remove();
    this.groundTints = [];
    this.groundChunks = [];
    this.overviewChunks = [];
    this.detailedGround = this.overviewGround = null;
    this.groundWidth = this.groundHeight = 0;
    this.ornaments.remove();
    this.ornamentLook = -1n;
    for (const figure of this.figures.values()) {
      figure.row = -1;
      figure.last = point(-1, -1);
    }
    for (const beast of this.beasts.values()) beast.row = -1;
    this.objects.remove();
    this.rows = [];
    this.rowTrees = [];
    this.rowBuildings = [];
    this.rowLamps = [];
    this.treeKeys = [];
    this.treeBounds = [];
    this.rowCanopies = [];
    this.swaying = false;
    this.fog.remove();
    this.memory.remove();
    this.visibilityPicture = null;
    this.fogBorder = null;
    this.exploredVisibility = new VisibilityMap();
    this.currentVisibility = new VisibilityMap();
    this.visibilityPixels = new Uint32Array();
    this.vision = [];
    this.groundSelection.clear();
    this.combat.remove();
    this.damageBack = this.damageLeft = null;
    this.sparks = [];
    this.nextSpark = 0n;
    this.prints.remove();
    this.footprints = [];
    this.lastStep.clear();
    this.printsAt = -1;
    this.revision = this.roadRevision = -1n;
    this.climateKey = -1;
    this.sightCount = -1;
  }
  invalidateTerrain(area: TileRegion): void {
    this.nameDirty = true;
    const whole =
      area.left <= 0 && area.top <= 0 && area.right >= this.groundWidth && area.bottom >= this.groundHeight;
    for (const chunk of this.groundChunks)
      if (intersects(chunk.area, area)) {
        chunk.dirty = true;
        chunk.edited = !whole;
      }
    if (whole) for (const chunk of this.overviewChunks) chunk.dirty = true;
    const first = Math.max(0, area.left + area.top),
      last = Math.min(this.treeKeys.length, area.right + area.bottom);
    for (let row = first; row < last; row++) this.treeKeys[row] = -1n;
    this.revision = this.roadRevision = -1n;
    this.ornamentLook = -1n;
  }
  finishTerrainEdits(): void {
    if (this.groundChunks.filter((chunk) => chunk.edited).length < 32) return;
    for (const chunk of this.overviewChunks) chunk.dirty = true;
  }
  buildingDrawnAt(town: Town, at: Point): number {
    let found = -1,
      front = f(-1e30);
    for (const building of town.buildings()) {
      const item = this.visuals.get(building.id);
      if (!item?.picture) continue;
      let left = f(1e30),
        right = f(-1e30),
        bottom = f(-1e30);
      for (const corner of building.footprint().corners()) {
        const p = project(corner.x, corner.y);
        left = Math.min(left, p.x);
        right = Math.max(right, p.x);
        bottom = Math.max(bottom, p.y);
      }
      const corner = building.corner(),
        anchor = project(corner.x, corner.y),
        top = Math.min(f(anchor.y - item.layout.originY), bottom);
      if (at.x < left || at.x > right || at.y < top || at.y > bottom) continue;
      const baseline = footprintBaseline(building.footprint()),
        depth = baselineDepthAt(baseline, at.x);
      if (depth > front) {
        front = depth;
        found = building.id;
      }
    }
    return found;
  }
  buildingRoof(building: Building): Point | undefined {
    const item = this.visuals.get(building.id);
    if (!item?.picture) return undefined;
    const corner = building.corner(),
      anchor = project(corner.x, corner.y);
    return point(project(building.center.x, building.center.y).x, f(anchor.y - item.layout.originY));
  }
  lightning(next: Strike): void {
    this.strike = { ...next };
    this.struck = this.view.toWorld(
      point(f(next.across * this.viewWidth), f(next.down * this.viewHeight)),
      this.viewWidth,
      this.viewHeight,
    );
  }
  update(
    town: Town,
    traffic: Traffic,
    camera: Camera,
    width: number,
    height: number,
    seconds: number,
    preview: Preview,
    selected: readonly number[] = [],
  ): void {
    this.picker.beginFrame();
    this.pickedTown = town;
    resize(this, width, height);
    this.view = new Camera(camera.x, camera.y, camera.zoom);
    this.renderedAt = seconds;
    fitToView(this);
    this.world.transform([
      camera.zoom,
      0,
      f(f(width / 2) - f(camera.x * camera.zoom)),
      0,
      camera.zoom,
      f(f(height / 2) - f(camera.y * camera.zoom)),
      0,
      0,
      1,
    ]);
    paintMapName(this, town.map(), camera.zoom);
    const climate = town.climate();
    paintStorm(this, seconds, climate.night);
    const key =
      Math.trunc(f(climate.summer * 8)) |
      (Math.trunc(f(climate.autumn * 8)) << 4) |
      (Math.trunc(f(climate.snow * 10)) << 8) |
      (Math.trunc(f(climate.frost * 4)) << 12);
    if (this.editorView) updateGroundChunks(this, town.map(), climate, key !== this.climateKey);
    const generation = buildingCatalogGeneration(),
      objectsChanged =
        town.objectRevision() !== this.revision ||
        key !== this.climateKey ||
        generation !== this.appearanceGeneration;
    const roadsChanged = town.roadRevision() !== this.roadRevision;
    if (objectsChanged) {
      this.appearanceGeneration = generation;
      this.revision = town.objectRevision();
      syncVisuals(this, town, seconds);
      if (!this.editorView && !this.groundTints.length)
        this.groundTints = paintGround(this.ground, town.map());
      if (key !== this.climateKey) {
        this.climateKey = key;
        tintGround(this.groundTints, climate);
      }
      this.farmland.remove();
      paintFields(this.farmland, town);
      buildObjects(this, town, climate);
    }
    if (roadsChanged) {
      this.roadRevision = town.roadRevision();
      this.roads.remove();
      paintRoads(this.roads, town.roads(), town.map());
    }
    if (objectsChanged || roadsChanged) {
      const lightsChanged = buildRoadLights(this, town, traffic, objectsChanged);
      if (lightsChanged) {
        if (!this.editorView) buildDarkness(this, town.map());
        else {
          this.lastFlicker = -1;
          animate(this, town, 0);
        }
      }
      this.shownPreview = new Preview();
      this.shownPreview.zoom = -1;
    }
    if (!samePreview(preview, this.shownPreview)) {
      this.shownPreview = structuredClone(preview);
      buildPreview(this, preview);
    }
    cullTrees(this);
    swayTrees(this, climate.wind, seconds);
    if (this.editorView) {
      const top = f(camera.y - f(f(height / 2) / camera.zoom)),
        bottom = f(camera.y + f(f(height / 2) / camera.zoom));
      for (let i = 0; i < this.rows.length; i++) {
        const base = f((i + 1) * tileHalfHeight),
          reach =
            i === this.ymirRow
              ? f(ymirHeight + 6 * tileHalfHeight)
              : i === this.fireRow
                ? f(f(volcanoHeight + volcanoSmoke) + 12 * tileHalfHeight)
                : 140;
        const opacity = f(base + 32) >= top && f(base - reach) <= bottom ? 255 : 0;
        this.rowBuildings[i].opacity(opacity);
        this.rowLamps[i].opacity(opacity);
        this.rows[i].opacity(opacity);
      }
      for (const layer of [
        this.fog,
        this.memory,
        this.darkness,
        this.warmth,
        this.clouds,
        this.overcast,
        this.precipitation,
      ])
        layer.opacity(0);
      if (this.sceneView) moveAgents(this, town, traffic, 0, selected);
    } else {
      updateVision(this, town);
      tread(this, town, seconds);
      sparkle(this, town, seconds);
      markDamage(this, town);
      moveAgents(this, town, traffic, seconds, selected);
      updateFelling(this, town);
      updateGrowth(this, town, seconds);
      updateResourceHits(this, town);
      animate(this, town, seconds);
    }
    sortWorldObjects(this);
    this.adapter.sync(this.root);
    this.collectPaints();
  }
  private collectPaints(): void {
    // Native caches hold independent references even while their rows are culled.
    this.adapter.collect([
      this.root,
      ...[...this.visuals.values()].map((v) => v.picture),
      ...[...this.figures.values(), ...this.beasts.values()].map((v) => v.paint),
      ...[this.ymirPaint.paint, this.volcanoPaint.paint].filter((p) => p !== undefined),
    ]);
  }
}

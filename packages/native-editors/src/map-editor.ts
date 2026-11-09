import type { Scene } from '@thorvg/webcanvas';
import {
  Camera,
  Climate,
  DungeonKind,
  Terrain,
  WorldMap,
  clamp,
  distance,
  f32 as f,
  point,
  project,
  terrainCount,
  unproject,
  type Point,
} from '../../engine/src';
import { groundColor } from '../../native-renderer/src/terrain-painter';
import {
  Align,
  ButtonStyle,
  Context,
  EventType,
  Icon,
  Key,
  Rect,
  TextInput,
  button,
  rgba,
  setTransform,
  textField,
  type Color,
} from '../../native-ui/src';
import { MapDocument } from './map-document';
import { TileRegion, type DocumentFiles } from './documents';

export interface MapPreviewRenderer {
  scene(): Scene;
  invalidateMap(): void;
  invalidateTerrain(area: TileRegion): void;
  finishTerrainEdits(): void;
  update(map: WorldMap, camera: Camera, width: number, height: number, time: number): void;
  dispose(): void;
}
const sizes = [64, 96, 128, 176, 256];
const terrains = [
  'Grass',
  'Meadow',
  'Forest',
  'Water',
  'Rock',
  'Sand',
  'Sea',
  'Mountain',
  'Ash',
  'Frost',
  'Ice',
  'Lava',
  'Clear trees',
];
const sites = ['Start position', 'Cave', 'Crypt', 'Portal', 'Ruin', 'Giant hall', 'Remove dungeon'];
function editorButton(
  c: Context,
  id: string,
  r: Rect,
  text: string,
  action: () => void,
  style = ButtonStyle.Default,
  enabled = true,
) {
  return button(c, id, r, text, action, style, enabled, Icon.None, false, { focusRing: true });
}

/** Exact source map editor layout and event routing; the host owns document IO. */
export class MapEditor {
  static readonly clearTool = terrainCount;
  static readonly startTool = MapEditor.clearTool + 1;
  static readonly firstDungeonTool = MapEditor.startTool + 1;
  static readonly removeTool = MapEditor.firstDungeonTool + 5;
  private readonly doc: MapDocument;
  private preview: WorldMap | null = null;
  private camera = new Camera();
  private canvas = new Rect();
  private path = new TextInput();
  private seed = new TextInput();
  private lastPaint: Point | undefined;
  private panFrom: Point | undefined;
  private mouse = point(-1, -1);
  private radius = 3;
  private tool = 0;
  private category = 0;
  private sizeIndex = 3;
  private shownRevision = 0;
  private feedback = '';
  private failed = false;
  private fitPending = false;
  constructor(
    map: WorldMap,
    private readonly renderer: MapPreviewRenderer,
    private readonly files: DocumentFiles,
    private readonly shortcutLabel: (text: string) => string = (text) => text.replace(/^Mod\+/, 'Ctrl+'),
  ) {
    this.doc = new MapDocument(map);
    this.syncSettings();
    const filename = 'maps/untitled.hearthmap';
    this.path = new TextInput(filename, filename.length);
    this.home();
  }
  document(): MapDocument {
    return this.doc;
  }
  view(): Camera {
    return this.camera;
  }
  canvasBounds(): Rect {
    return this.canvas;
  }
  textFocused(c: Context): boolean {
    return c.focused() === 'map-path' || c.focused() === 'map-seed';
  }
  dragging(): boolean {
    return !!this.lastPaint || !!this.panFrom;
  }
  choose(value: number): void {
    this.tool = clamp(Math.trunc(value), 0, MapEditor.removeTool);
    this.category = this.tool >= MapEditor.startTool ? 1 : 0;
  }
  resizeBrush(delta: number): void {
    this.radius = clamp(f(this.radius + delta), 1, 12);
  }
  setPath(value: string): void {
    this.path = new TextInput(value, new TextEncoder().encode(value).length);
  }
  dispose(): void {
    this.finishStroke();
    this.renderer.dispose();
  }
  private syncSettings(): void {
    const text = String(this.doc.map().seed());
    this.seed = new TextInput(text, text.length);
    for (let i = 0; i < 5; i++) if (sizes[i] === this.doc.map().width()) this.sizeIndex = i;
  }
  private worldAt(screen: Point): Point {
    const p = this.camera.toWorld(
      point(f(screen.x - this.canvas.x), f(screen.y - this.canvas.y)),
      this.canvas.w,
      this.canvas.h,
    );
    return unproject(p.x, p.y);
  }
  private screenAt(world: Point): Point {
    const p = this.camera.toScreen(project(world.x, world.y), this.canvas.w, this.canvas.h);
    return point(f(p.x + this.canvas.x), f(p.y + this.canvas.y));
  }
  home(): void {
    this.fitPending = false;
    const at = project(this.doc.map().camp().x, this.doc.map().camp().y);
    Object.assign(this.camera, new Camera(at.x, at.y, f(0.7)));
  }
  fit(): void {
    if (this.canvas.w <= 0) {
      this.fitPending = true;
      return;
    }
    this.fitPending = false;
    const map = this.doc.map(),
      at = project(f(map.width() / 2), f(map.height() / 2));
    const zoom = Math.min(
      f(Math.max(100, f(this.canvas.w - 32)) / f(32 * f(map.width() + map.height()))),
      f(Math.max(100, f(this.canvas.h - 48)) / f(16 * f(map.width() + map.height()))),
    );
    Object.assign(this.camera, new Camera(at.x, at.y, clamp(zoom, f(0.025), 3)));
  }
  private finishStroke(): void {
    this.doc.endStroke();
    this.lastPaint = undefined;
    this.renderer.finishTerrainEdits();
  }
  undo(): void {
    this.finishStroke();
    this.doc.undo();
    this.syncSettings();
  }
  redo(): void {
    this.finishStroke();
    this.doc.redo();
    this.syncSettings();
  }
  async save(): Promise<boolean> {
    this.finishStroke();
    try {
      await this.doc.save(this.path.value, this.files);
      this.failed = false;
      this.feedback = 'Map saved.';
      return true;
    } catch (error) {
      this.failed = true;
      this.feedback = error instanceof Error ? error.message : String(error);
      return false;
    }
  }
  async load(): Promise<boolean> {
    this.finishStroke();
    try {
      await this.doc.load(this.path.value, this.files);
      this.failed = false;
      this.syncSettings();
      this.feedback = 'Map loaded.';
      this.fit();
      return true;
    } catch (error) {
      this.failed = true;
      this.feedback = error instanceof Error ? error.message : String(error);
      return false;
    }
  }
  private regenerate(): void {
    const text = this.seed.value,
      value = Number(text);
    if (!/^\d+$/.test(text) || !Number.isInteger(value) || value < 0 || value > 4294967295) {
      this.failed = true;
      this.feedback = 'Enter a seed from 0 to 4294967295.';
      return;
    }
    this.finishStroke();
    this.doc.regenerate(value, sizes[this.sizeIndex]);
    this.fit();
    this.failed = false;
    this.feedback = 'New island generated. Undo restores the previous map.';
  }
  private stamp(at: Point): void {
    if (this.tool < terrainCount) this.doc.paint(at, this.radius, this.tool);
    else if (this.tool === MapEditor.clearTool) this.doc.clearTrees(at, this.radius);
  }
  pointerDown(c: Context, p: Point, secondary: boolean): void {
    this.mouse = p;
    c.pointerMove(p.x, p.y);
    if (!this.canvas.contains(p.x, p.y)) {
      if (!secondary) c.pointerDown(p.x, p.y);
      return;
    }
    c.focus('');
    if (secondary) {
      this.panFrom = p;
      return;
    }
    const at = this.worldAt(p);
    if (!this.doc.map().inside(at)) return;
    if (this.tool < MapEditor.startTool) {
      this.doc.beginStroke();
      this.lastPaint = at;
      this.stamp(at);
      return;
    }
    const changed =
      this.tool === MapEditor.startTool
        ? this.doc.setStart(at)
        : this.tool === MapEditor.removeTool
          ? this.doc.removeDungeon(at)
          : this.doc.addDungeon(at, this.tool - MapEditor.firstDungeonTool);
    this.failed = !changed;
    this.feedback = changed
      ? 'Placement updated.'
      : this.tool === MapEditor.startTool
        ? 'Choose a dry, level 5 x 5 clearing.'
        : this.tool === MapEditor.removeTool
          ? 'Click a dungeon entrance to remove it.'
          : 'Choose a free, dry 2 x 2 area away from the start.';
  }
  pointerMove(c: Context, p: Point): void {
    this.mouse = p;
    c.pointerMove(p.x, p.y);
    if (this.panFrom) {
      this.camera.x = f(this.camera.x - f(f(p.x - this.panFrom.x) / this.camera.zoom));
      this.camera.y = f(this.camera.y - f(f(p.y - this.panFrom.y) / this.camera.zoom));
      this.panFrom = p;
    }
    if (!this.lastPaint || !this.canvas.contains(p.x, p.y)) return;
    const at = this.worldAt(p);
    if (!this.doc.map().inside(at) || distance(this.lastPaint, at) < f(0.01)) return;
    if (this.tool < terrainCount) this.doc.paintSegment(this.lastPaint, at, this.radius, this.tool);
    else if (this.tool === MapEditor.clearTool) this.doc.clearTreesSegment(this.lastPaint, at, this.radius);
    this.lastPaint = at;
  }
  pointerUp(c: Context, p: Point, secondary: boolean): void {
    if (secondary) {
      this.panFrom = undefined;
      return;
    }
    if (this.lastPaint) {
      this.pointerMove(c, p);
      if (this.canvas.contains(p.x, p.y)) {
        const at = this.worldAt(p);
        if (this.doc.map().inside(at) && distance(this.lastPaint, at) > f(0.01)) this.stamp(at);
      }
      this.finishStroke();
      return;
    }
    c.pointerUp(p.x, p.y);
  }
  wheel(c: Context, p: Point, amount: number): void {
    if (!this.canvas.contains(p.x, p.y)) {
      c.pointerMove(p.x, p.y);
      c.wheel(amount);
      return;
    }
    const before = this.worldAt(p);
    this.camera.zoom = clamp(f(this.camera.zoom * f(Math.pow(f(1.15), amount))), f(0.025), 4);
    const after = this.worldAt(p),
      delta = project(f(before.x - after.x), f(before.y - after.y));
    this.camera.x = f(this.camera.x + delta.x);
    this.camera.y = f(this.camera.y + delta.y);
    this.mouse = p;
  }
  private minimap(c: Context, r: Rect): void {
    const map = this.doc.map(),
      t = c.theme();
    c.rect(r, t.background, t.radius, t.border);
    c.paint('map-mini' + this.doc.revision() + JSON.stringify(r), () => {
      const root = new c.tvg.Scene(),
        climate = new Climate();
      for (let kind = 0; kind < terrainCount; kind++) {
        const shape = new c.tvg.Shape();
        for (let y = 0; y < map.height(); y += 3)
          for (let x = 0; x < map.width(); x += 3)
            if (map.at(x, y).terrain === kind)
              shape.appendRect(
                f(r.x + f(f(r.w * x) / map.width())),
                f(r.y + f(f(r.h * y) / map.height())),
                f(f(f(r.w * Math.min(3, map.width() - x)) / map.width()) + f(0.1)),
                f(f(f(r.h * Math.min(3, map.height() - y)) / map.height()) + f(0.1)),
              );
        const color = groundColor(kind, 1, climate);
        shape.fill(color[0], color[1], color[2]);
        root.add(shape);
        shape.dispose();
      }
      return root;
    });
    const dot = (p: Point, color: Color, radius: number) =>
      c.rect(
        new Rect(
          f(f(r.x + f(f(r.w * p.x) / map.width())) - radius),
          f(f(r.y + f(f(r.h * p.y) / map.height())) - radius),
          radius * 2,
          radius * 2,
        ),
        color,
        radius,
      );
    dot(map.camp(), t.accent, 4);
    for (const site of map.dungeons()) dot(point(site.origin.x + 1, site.origin.y + 1), t.text, 2);
    const center = unproject(this.camera.x, this.camera.y);
    dot(point(clamp(center.x, 0, map.width()), clamp(center.y, 0, map.height())), t.success, 3);
    c.control(
      'map-minimap',
      r,
      (event) => {
        if (event.type !== EventType.Press && event.type !== EventType.Drag) return;
        const p = project(
          f(clamp(f(f(event.x - r.x) / r.w), 0, 1) * this.doc.map().width()),
          f(clamp(f(f(event.y - r.y) / r.h), 0, 1) * this.doc.map().height()),
        );
        this.camera.x = p.x;
        this.camera.y = p.y;
      },
      true,
      false,
      false,
      true,
    );
  }
  render(c: Context, viewport: Rect, close: (apply: boolean) => void): void {
    const t = c.theme();
    this.canvas = new Rect(216, 94, Math.max(120, f(viewport.w - 516)), Math.max(120, f(viewport.h - 188)));
    if (this.fitPending) this.fit();
    if (this.shownRevision !== this.doc.revision()) {
      const area = this.doc.takeDirtyArea();
      if (
        !this.preview ||
        this.preview.width() !== this.doc.map().width() ||
        this.preview.height() !== this.doc.map().height() ||
        this.preview.seed() !== this.doc.map().seed()
      ) {
        this.renderer.invalidateMap();
        this.preview = this.doc.previewMap();
      } else {
        this.renderer.invalidateTerrain(area);
        this.preview = this.doc.updatePreview(this.preview, area);
      }
      this.shownRevision = this.doc.revision();
    }
    this.renderer.update(this.preview!, this.camera, this.canvas.w, this.canvas.h, c.time());
    setTransform(this.renderer.scene(), {
      e11: 1,
      e12: 0,
      e13: this.canvas.x,
      e21: 0,
      e22: 1,
      e23: this.canvas.y,
      e31: 0,
      e32: 0,
      e33: 1,
    });
    c.rect(viewport, t.background);
    c.clip(this.canvas, () => c.add(this.renderer.scene()));
    c.control('map-canvas', this.canvas, undefined, true, false);
    c.text(new Rect(24, 18, 400, 18), 'MIDGARD  /  CREATOR TOOLS', t.muted, 11, true);
    c.text(new Rect(24, 39, 380, 32), 'Map Editor', t.text, 24, true);
    c.text(
      new Rect(290, 42, 240, 24),
      this.doc.changed() ? 'Unsaved changes' : 'Landscape draft',
      t.muted,
      12,
    );
    editorButton(
      c,
      'map-undo',
      new Rect(viewport.w - 408, 32, 80, 32),
      'Undo',
      () => this.undo(),
      ButtonStyle.Default,
      this.doc.canUndo(),
    );
    editorButton(
      c,
      'map-redo',
      new Rect(viewport.w - 320, 32, 80, 32),
      'Redo',
      () => this.redo(),
      ButtonStyle.Default,
      this.doc.canRedo(),
    );
    editorButton(
      c,
      'map-cancel',
      new Rect(viewport.w - 224, 32, 88, 32),
      'Cancel',
      () => close(false),
      ButtonStyle.Quiet,
    );
    const issue = this.doc.validation();
    editorButton(
      c,
      'map-play',
      new Rect(viewport.w - 128, 32, 104, 32),
      'Play map',
      () => close(true),
      ButtonStyle.Primary,
      !issue,
    );
    c.line(16, 80, viewport.w - 16, 80, t.border);
    c.rect(new Rect(16, 94, 188, this.canvas.h), t.surface, t.radius, t.border);
    for (let i = 0; i < 2; i++)
      editorButton(
        c,
        'map-tab-' + i,
        new Rect(24 + i * 88, 104, 84, 30),
        i ? 'Sites' : 'Terrain',
        () => {
          if (this.category !== i) this.choose(i ? MapEditor.startTool : 0);
        },
        this.category === i ? ButtonStyle.Primary : ButtonStyle.Quiet,
      );
    const count = this.category ? MapEditor.removeTool - MapEditor.startTool + 1 : MapEditor.clearTool + 1;
    for (let i = 0; i < count; i++) {
      const index = this.category ? MapEditor.startTool + i : i;
      let label = this.category ? sites[i] : terrains[i];
      if (!this.category && i < 9) label = `${i + 1}  ${label}`;
      editorButton(
        c,
        'map-tool-' + index,
        new Rect(24, 146 + i * 30, 172, 26),
        label,
        () => {
          this.tool = index;
        },
        this.tool === index ? ButtonStyle.Primary : ButtonStyle.Quiet,
      );
    }
    if (!this.category) {
      const y = 146 + (MapEditor.clearTool + 1) * 30 + 12;
      c.text(new Rect(28, y, 164, 22), 'Brush radius', t.muted, 12);
      editorButton(c, 'map-radius-down', new Rect(28, y + 28, 32, 30), '-', () => this.resizeBrush(-1));
      c.text(
        new Rect(64, y + 28, 88, 30),
        `${Math.trunc(this.radius)} tiles`,
        t.text,
        13,
        false,
        Align.Center,
      );
      editorButton(c, 'map-radius-up', new Rect(156, y + 28, 32, 30), '+', () => this.resizeBrush(1));
      c.text(new Rect(28, y + 70, 164, 36), 'Drag to paint.\nWater can form rivers.', t.muted, 11);
    } else
      c.text(
        new Rect(28, 358, 164, 66),
        'Click to place a site.\nA start clears its trees.\nDungeons use 2 x 2 tiles.',
        t.muted,
        11,
      );
    const right = viewport.w - 284;
    c.rect(new Rect(right, 94, 268, this.canvas.h), t.surface, t.radius, t.border);
    c.text(new Rect(right + 16, 106, 236, 22), 'OVERVIEW', t.muted, 11, true);
    this.minimap(c, new Rect(right + 14, 138, 240, 158));
    editorButton(c, 'map-fit', new Rect(right + 14, 308, 116, 30), 'Fit island', () => this.fit());
    editorButton(c, 'map-home', new Rect(right + 138, 308, 116, 30), 'Go to start', () => this.home());
    c.text(new Rect(right + 16, 352, 236, 22), 'ISLAND', t.muted, 11, true);
    c.text(new Rect(right + 16, 380, 58, 26), 'Seed', t.muted, 12);
    textField(c, 'map-seed', new Rect(right + 70, 378, 182, 30), this.seed, '0', true, (key) => {
      if (key !== Key.Enter) return false;
      this.regenerate();
      return true;
    });
    editorButton(c, 'map-size-prev', new Rect(right + 14, 422, 32, 28), '<', () => {
      this.sizeIndex = (this.sizeIndex + 4) % 5;
    });
    c.text(
      new Rect(right + 48, 422, 158, 28),
      `${sizes[this.sizeIndex]} x ${sizes[this.sizeIndex]}`,
      t.text,
      13,
      false,
      Align.Center,
    );
    editorButton(c, 'map-size-next', new Rect(right + 220, 422, 32, 28), '>', () => {
      this.sizeIndex = (this.sizeIndex + 1) % 5;
    });
    editorButton(c, 'map-generate', new Rect(right + 14, 462, 238, 32), 'Generate island', () =>
      this.regenerate(),
    );
    c.text(
      new Rect(right + 16, 506, 236, 22),
      `${this.doc.map().width()} x ${this.doc.map().height()} tiles / ${this.doc.map().dungeons().length} dungeons`,
      t.muted,
      12,
    );
    let guidance = !issue ? 'Ready to play.\nPlay map starts a new settlement.' : issue;
    if (issue) {
      let split = issue.length;
      while (split >= 0 && c.textWidth(issue.slice(0, split), 12) > 232)
        split = issue.lastIndexOf(' ', split - 1);
      if (split >= 0 && split < issue.length)
        guidance = issue.slice(0, split) + '\n' + issue.slice(split + 1);
    }
    c.text(new Rect(right + 16, 540, 236, 60), guidance, !issue ? t.success : t.danger, 12);
    if (this.canvas.contains(this.mouse.x, this.mouse.y)) {
      const at = this.worldAt(this.mouse);
      if (this.doc.map().inside(at)) {
        const color = t.accent;
        c.clip(this.canvas, () =>
          c.paint(
            JSON.stringify([
              'map-brush',
              at,
              this.radius,
              this.tool,
              this.camera.x,
              this.camera.y,
              this.camera.zoom,
              this.canvas,
            ]),
            () => {
              const shape = new c.tvg.Shape();
              for (let i = 0; i <= 40; i++) {
                const a = f(f(i * f(6.2831853)) / 40),
                  reach = this.tool < MapEditor.startTool ? this.radius : f(1.4),
                  p = this.screenAt(
                    point(f(at.x + f(f(Math.cos(a)) * reach)), f(at.y + f(f(Math.sin(a)) * reach))),
                  );
                if (!i) shape.moveTo(p.x, p.y);
                else shape.lineTo(p.x, p.y);
              }
              return shape
                .close()
                .fill(color.r, color.g, color.b, 24)
                .stroke({ width: 1.5, color: [color.r, color.g, color.b, 255] });
            },
          ),
        );
      }
    }
    const marker = (p: Point, label: string, color: Color) => {
      const screen = this.screenAt(p);
      if (!this.canvas.contains(screen.x, screen.y)) return;
      c.rect(new Rect(screen.x - 4, screen.y - 4, 8, 8), color, 4);
      c.text(new Rect(screen.x - 64, screen.y - 28, 128, 22), label, color, 12, true, Align.Center);
    };
    c.clip(this.canvas, () => marker(this.doc.map().camp(), 'START', t.accent));
    const footer = viewport.h - 78;
    c.text(new Rect(24, footer, 56, 30), 'MAP FILE', t.muted, 11, true);
    textField(
      c,
      'map-path',
      new Rect(94, footer, viewport.w - 294, 30),
      this.path,
      'maps/my-island.hearthmap',
      true,
      (key) => {
        if (key !== Key.Enter) return false;
        void this.save();
        return true;
      },
      Icon.Folder,
    );
    editorButton(c, 'map-load', new Rect(viewport.w - 184, footer, 72, 30), 'Load', () => {
      void this.load();
    });
    editorButton(c, 'map-save', new Rect(viewport.w - 104, footer, 80, 30), 'Save', () => {
      void this.save();
    });
    const message =
      this.feedback ||
      `Paint: left drag / Pan: right drag / Zoom: wheel / ${this.shortcutLabel('Mod+Z')}: undo / ${this.shortcutLabel('Mod+S')}: save / Esc: cancel draft`;
    c.text(
      new Rect(24, viewport.h - 38, viewport.w - 48, 24),
      c.elideText(message, viewport.w - 48, 12),
      this.failed ? t.danger : t.muted,
      12,
    );
  }
}

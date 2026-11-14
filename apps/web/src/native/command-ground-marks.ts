// Command marks lie on the ground with the combat marks, under the selection rings and every figure: the true
// radius of an aimed skill under the cursor, and the spot each selected resident walking on orders will stand.
import { SceneNode, ShapeNode } from '../../../../packages/native-renderer/src/paint';
import { appendTaperArc, groundRadii, tone } from '../../../../packages/native-renderer/src/combat-paint';
import { project, type Point } from '../../../../packages/engine/src/geometry';
import { Activity } from '../../../../packages/engine/src/person';
import { controllableIds } from './game-control';
import { aimPreview } from './skill-commands';
import type { GameAppState } from './game-app-state';

const maxRings = 2;
const maxSlots = 12;
interface Ring {
  disc: ShapeNode;
  arcs: ShapeNode;
  /** Radius and reach the paths and colours were last built for. */
  built: string;
}
interface Marks {
  root: SceneNode;
  rings: Ring[];
  slots: { disc: ShapeNode; rim: ShapeNode }[];
  /** Attack-move or move, per slot, as last painted. */
  slotsBuilt: string[];
}
const retained = new WeakMap<SceneNode, Marks>();
/** The renderer's ground layer for combat marks, when the renderer is the real one. */
function groundLayer(app: GameAppState): SceneNode | null {
  const renderer = app.renderer;
  return 'combatGround' in renderer && renderer.combatGround instanceof SceneNode ? renderer.combatGround : null;
}
function marksOn(layer: SceneNode): Marks {
  let marks = retained.get(layer);
  if (!marks) {
    const root = new SceneNode(),
      rings = Array.from({ length: maxRings }, () => ({ disc: new ShapeNode(), arcs: new ShapeNode(), built: '' })),
      slots = Array.from({ length: maxSlots }, () => ({ disc: new ShapeNode(), rim: new ShapeNode() }));
    for (const ring of rings) root.add(ring.disc).add(ring.arcs);
    for (const slot of slots) root.add(slot.disc).add(slot.rim);
    marks = { root, rings, slots, slotsBuilt: slots.map(() => '') };
    retained.set(layer, marks);
  }
  // The layer is emptied when the map is repainted; the list of marks itself never changes.
  if (!layer.children.includes(marks.root)) layer.add(marks.root);
  return marks;
}
function buildRing(ring: Ring, radius: number, inReach: boolean): void {
  const key = `${radius}/${inReach}`;
  if (ring.built === key) return;
  ring.built = key;
  const { rx, ry } = groundRadii(radius),
    ink = tone.ink,
    light = inReach ? tone.sand : tone.rust;
  ring.disc.reset().appendCircle(0, 0, rx, ry).fill(ink[0], ink[1], ink[2], inReach ? 44 : 30);
  ring.arcs.reset();
  // Four brush strokes round the rim, tapered at both ends, with small gaps between them.
  for (let i = 0; i < 4; i++) {
    const a0 = (i * Math.PI) / 2 + 0.12,
      a1 = ((i + 1) * Math.PI) / 2 - 0.12;
    appendTaperArc(ring.arcs, rx, ry, a0, a1, Math.max(2.2, rx * 0.06), 0.35, 0.35, 0.5);
  }
  ring.arcs.fill(light[0], light[1], light[2], inReach ? 210 : 190);
}
function buildSlot(marks: Marks, i: number, attack: boolean): void {
  const key = String(attack);
  if (marks.slotsBuilt[i] === key) return;
  marks.slotsBuilt[i] = key;
  const color = attack ? tone.rust : tone.sand,
    ink = tone.ink,
    { disc, rim } = marks.slots[i];
  disc.reset().appendCircle(0, 0, 9, 4.6).fill(ink[0], ink[1], ink[2], 70);
  rim.reset();
  appendTaperArc(rim, 9, 4.6, -Math.PI * 0.92, Math.PI * 0.82, 2.8, 0.25, 0.3, 0.5);
  rim.fill(color[0], color[1], color[2], 235);
}
/** Where each selected resident walking on a Move or attack-move order will stand: the slot the engine gave. */
function arrivals(app: GameAppState): { at: Point; attack: boolean }[] {
  return controllableIds(app.town, app.chosen)
    .map((id) => app.town.person(id))
    .filter((p) => !!p && p.ordered && p.activity === Activity.Moving && !p.approachingOrder && p.moving())
    .slice(0, maxSlots)
    .map((p) => ({ at: { ...p!.goal }, attack: p!.aggressive }));
}
/** Lays this frame's command marks on the ground, before the renderer syncs the world. */
export function commandGroundMarks(app: GameAppState): void {
  const layer = groundLayer(app);
  if (!layer) return;
  const preview = aimPreview(app),
    slots = arrivals(app);
  if (!preview && !slots.length) {
    // Nothing to show: hiding the root keeps the layer's own list of children as it is.
    const marks = retained.get(layer);
    if (marks && marks.root.alpha) marks.root.opacity(0);
    return;
  }
  const marks = marksOn(layer);
  marks.root.opacity(255);
  marks.rings.forEach((ring, i) => {
    const shown = preview?.rings[i];
    if (!shown || !preview) {
      ring.disc.opacity(0);
      ring.arcs.opacity(0);
      return;
    }
    buildRing(ring, shown.radius, shown.inReach);
    const at = project(preview.at.x, preview.at.y);
    for (const node of [ring.disc, ring.arcs]) node.translate(at.x, at.y).opacity(255);
  });
  marks.slots.forEach((slot, i) => {
    const arrival = slots[i];
    if (!arrival) {
      slot.disc.opacity(0);
      slot.rim.opacity(0);
      return;
    }
    buildSlot(marks, i, arrival.attack);
    const p = project(arrival.at.x, arrival.at.y);
    for (const node of [slot.disc, slot.rim]) node.translate(p.x, p.y).opacity(255);
  });
}

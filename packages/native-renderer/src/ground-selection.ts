import { SceneNode, ShapeNode, type Matrix } from './paint';
import type { WorldRendererState } from './world-renderer-state';
import type { ResolvedGroundSelectionMarker } from './world-picking-types';

/** Logical-screen strokes, rendered on the ground before every world object. */
export class GroundSelection {
  private markers = new Map<string, { paint: SceneNode; signature: string }>();
  constructor(private readonly state: WorldRendererState) {}

  clear(): void {
    this.markers.clear();
    this.state.selection.remove();
  }

  set(markers: readonly ResolvedGroundSelectionMarker[]): boolean {
    const s = this.state,
      zoom = s.view.zoom,
      children: SceneNode[] = [],
      live = new Set<string>();
    const transform: Matrix = [
      1 / zoom,
      0,
      s.view.x - s.viewWidth / (2 * zoom),
      0,
      1 / zoom,
      s.view.y - s.viewHeight / (2 * zoom),
      0,
      0,
      1,
    ];
    if (transform.some((value, i) => Math.fround(value) !== s.selection.matrix[i]))
      s.selection.transform(transform);
    for (const marker of markers) {
      const { key, kind, geometry, hover } = marker,
        paths = geometry.paths ?? (geometry.path ? [geometry.path] : []),
        opacity = Math.max(0, Math.min(255, geometry.opacity));
      if (!opacity || (kind === 'road' && !paths.length) || live.has(key)) continue;
      live.add(key);
      const signature = JSON.stringify([
        kind,
        geometry.foot,
        geometry.groundOutline,
        geometry.ellipse,
        paths,
        opacity,
        hover,
      ]);
      let retained = this.markers.get(key);
      if (!retained) {
        retained = { paint: new SceneNode().add(new ShapeNode()).add(new ShapeNode()), signature: '' };
        this.markers.set(key, retained);
      }
      if (retained.signature !== signature) {
        for (const [index, width, color] of [
          [0, 3.5, [28, 24, 20, Math.round(opacity * 0.85)]],
          [1, 1.5, hover ? [143, 205, 225, opacity] : [240, 210, 120, opacity]],
        ] as const) {
          const shape = retained.paint.children[index];
          if (!(shape instanceof ShapeNode)) continue;
          shape.reset().fill(0, 0, 0, 0);
          if (paths.length) {
            for (const path of paths)
              if (path.length > 1) {
                shape.moveTo(path[0].x, path[0].y);
                for (const p of path.slice(1)) shape.lineTo(p.x, p.y);
              }
          } else if (kind === 'field' && geometry.groundOutline?.length) {
            const outline = geometry.groundOutline;
            shape.moveTo(outline[0].x, outline[0].y);
            for (const p of outline.slice(1)) shape.lineTo(p.x, p.y);
            shape.close();
          } else {
            const outline = geometry.groundOutline,
              ellipse =
                geometry.ellipse ??
                (outline?.length
                  ? {
                      rx: Math.max(...outline.map((p) => Math.abs(p.x - geometry.foot.x))) + 3,
                      ry: Math.max(...outline.map((p) => Math.abs(p.y - geometry.foot.y))) + 2,
                    }
                  : { rx: 8, ry: 4 });
            shape.appendCircle(
              geometry.foot.x,
              geometry.foot.y,
              Math.max(4, ellipse.rx),
              Math.max(2, ellipse.ry),
            );
          }
          shape
            .strokeWidth(width)
            .strokeFill(color[0], color[1], color[2], color[3])
            .strokeCap('round')
            .strokeJoin('round');
        }
        retained.signature = signature;
      }
      children.push(retained.paint);
    }
    let retired = false;
    for (const key of this.markers.keys())
      if (!live.has(key)) {
        this.markers.delete(key);
        retired = true;
      }
    if (
      children.length !== s.selection.children.length ||
      children.some((paint, i) => paint !== s.selection.children[i])
    ) {
      s.selection.children = children;
      s.selection.version++;
    }
    return retired;
  }
}

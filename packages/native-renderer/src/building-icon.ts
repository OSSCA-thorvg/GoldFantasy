import { point } from '../../engine/src/geometry';
import { f32 } from '../../engine/src/numeric';
import { Structure, structureSpec } from '../../engine/src/building-catalog';
import { SceneNode, ShapeNode, type Rgb } from './paint';
import { BuildingProjection, orientModel, splitAngle, type Model } from './building-model';
import { validateBuildingAsset } from './building-asset';
import { buildingFaces, Motion, FaceStyle } from './building-faces';
import { depthBatches } from './building-depth';
import { structureModel } from './building-assets';
export function buildingIcon(
  source: Model,
  size: number,
  width: number,
  height: number,
  angle = 0,
  projection = new BuildingProjection(),
): SceneNode {
  validateBuildingAsset({ id: 'preview', name: 'Preview', footprint: size, variants: [source] });
  if (
    ![angle, width, height, projection.halfWidth, projection.halfHeight].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    projection.halfWidth <= 0 ||
    projection.halfWidth > 512 ||
    projection.halfHeight <= 0 ||
    projection.halfHeight > 512
  )
    throw new Error('invalid building icon dimensions');
  const model = structuredClone(source),
    { quarterTurns: quarter, remainder: turn } = splitAngle(angle);
  orientModel(model, quarter, size);
  const still = new Motion();
  still.turn = turn;
  still.projection = projection;
  still.pivot = point(f32(size / 2), f32(size / 2));
  const faces = buildingFaces(model, still),
    batches = depthBatches(faces, 1000),
    icon = new SceneNode();
  if (!batches.length) return icon;
  let minX = 3.4028234663852886e38,
    minY = minX,
    maxX = -minX,
    maxY = -minX;
  for (const batch of batches)
    for (const polygon of batch.polygons)
      for (const p of polygon) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
  const k = Math.min(f32(width / Math.max(1, f32(maxX - minX))), f32(height / Math.max(1, f32(maxY - minY))));
  for (const batch of batches) {
    const face = faces[batch.source],
      alpha = face.opacity.length ? f32(face.opacity[f32(face.opacity.length - 1)][1] / 100) : 1;
    if (alpha <= 0) continue;
    const shape = new ShapeNode();
    for (const polygon of batch.polygons) {
      shape.moveTo(f32(f32(polygon[0].x - minX) * k), f32(f32(polygon[0].y - minY) * k));
      for (let j = 1; j < polygon.length; j++)
        shape.lineTo(f32(f32(polygon[j].x - minX) * k), f32(f32(polygon[j].y - minY) * k));
      if (!batch.line) shape.close();
    }
    const a = Math.trunc(f32(255 * alpha)) & 255;
    if (batch.line) {
      const outline = face.style === FaceStyle.Outlined,
        color: Rgb = outline ? [20, 18, 24] : face.color;
      shape
        .strokeWidth(Math.max(outline ? f32(0.5) : f32(0.6), f32((outline ? f32(1.2) : face.width) * k)))
        .strokeCap('round')
        .strokeJoin('round')
        .strokeFill(...color, a);
    } else shape.fill(...face.color, a);
    icon.add(shape);
  }
  icon.translate(
    f32(f32(width - f32(f32(maxX - minX) * k)) / 2),
    f32(f32(height - f32(f32(maxY - minY) * k)) / 2),
  );
  return icon;
}
export function structureIcon(kind: Structure, width: number, height: number): SceneNode {
  return buildingIcon(structureModel(kind, 4), structureSpec(kind).size, width, height);
}

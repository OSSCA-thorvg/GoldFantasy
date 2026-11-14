// Flat storybook finish: one base tone, a dusk rim on the side away from the light, an optional ink edge.
import { SceneNode, type Rgb } from './paint';
import { mix } from './vector-paint';
import { boxOf, moved, shapeOf, type Form } from './outline-form';

export interface Finish {
  /** Half-width of the ink edge around each form; 0 draws none. */
  ink: number;
  /** How far the lit face of a form sits toward the light; 0 leaves forms flat. */
  rim: number;
  /**
   * Draw the lit face as the form itself, smaller and set toward the light, instead of clipping
   * it. Exact only for a rounded form with no hollows, and far cheaper for small figures.
   */
  inset?: boolean;
}
export const inkTone: Rgb = [44, 36, 46];
/** The unlit side falls toward dusk indigo rather than black, so flat tones stay luminous. */
export const dusk = (color: Rgb, depth = 0.34): Rgb => mix(color, [46, 44, 84], depth);
export const glint = (color: Rgb, lift = 0.28): Rgb => mix(color, [255, 244, 222], lift);

export function paintForm(
  scene: SceneNode,
  form: Form,
  base: Rgb,
  finish: Finish,
  shade: Rgb = dusk(base),
  alpha = 255,
): void {
  if (!form.length) return;
  if (finish.ink > 0)
    scene.add(
      shapeOf(form)
        .fill(...inkTone, alpha)
        .strokeFill(...inkTone, alpha)
        .strokeWidth(finish.ink * 2)
        .strokeJoin('round'),
    );
  if (finish.rim <= 0) {
    scene.add(shapeOf(form).fill(...base, alpha));
    return;
  }
  scene.add(shapeOf(form).fill(...shade, alpha));
  const lit = shapeOf(form).fill(...base, alpha);
  if (finish.inset) {
    // Shrink toward the point of the outline that faces the light: the copy stays inside.
    const box = boxOf(form),
      k = Math.max(0.6, 1 - finish.rim / Math.max(0.01, Math.min(box.w, box.h) / 2)),
      x = box.x + box.w * 0.15,
      y = box.y + box.h * 0.15;
    lit.transform([k, 0, x * (1 - k), 0, k, y * (1 - k), 0, 0, 1]);
  } else lit.clip(shapeOf(moved(form, -finish.rim, -finish.rim * 0.85)));
  scene.add(lit);
}

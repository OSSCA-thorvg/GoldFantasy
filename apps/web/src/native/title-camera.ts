import { Camera, project } from '../../../../packages/engine/src/geometry';
import { Activity } from '../../../../packages/engine/src/person';
import type { PreviewWorld } from './application-contracts';
const f = Math.fround;
export class TitleCamera {
  private view = new Camera();
  private subject = -1;
  private ready = false;
  reset(): void {
    this.ready = false;
    this.subject = -1;
  }
  followedUnit(): number {
    return this.subject;
  }
  update(town: PreviewWorld, width: number, height: number, seconds: number, reducedMotion = false): Camera {
    let person = town.titleAutoplaySubject();
    if (person && (person.health <= 0 || person.activity === Activity.Leaving)) person = null;
    this.subject = person ? person.id : -1;
    const at = person ? person.position : town.map().camp(),
      projected = project(at.x, at.y, 12),
      zoom = f(1.2);
    const target = new Camera(
      f(projected.x + f(f(width * f(0.15)) / zoom)),
      f(projected.y - f(f(height * f(0.08)) / zoom)),
      zoom,
    );
    if (!this.ready || reducedMotion) {
      this.view = target;
      this.ready = true;
      return new Camera(this.view.x, this.view.y, this.view.zoom);
    }
    const ease = f(1 - Math.exp(-Math.max(0, Math.min(0.25, seconds)) / 0.35));
    this.view.x = f(this.view.x + f(f(target.x - this.view.x) * ease));
    this.view.y = f(this.view.y + f(f(target.y - this.view.y) * ease));
    this.view.zoom = zoom;
    return new Camera(this.view.x, this.view.y, this.view.zoom);
  }
}

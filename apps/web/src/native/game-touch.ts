import { PointerButton, Tool, toolStructure } from '../../../../packages/engine/src/game-tools';
import { point, distance, project, unproject, type Point } from '../../../../packages/engine/src/geometry';
import { clamp, f32 } from '../../../../packages/engine/src/numeric';
import type { AppEvent } from './application-contracts';
import type { GameInputApp } from './game-input';
import { placementMapBounds } from './mobile-layout';
import type { GameAppState } from './game-app-state';

interface TouchApp extends GameInputApp {
  pointerDown(x: number, y: number, button: PointerButton): void;
  pointerUp(x: number, y: number, button: PointerButton): void;
}
export function moveTouchPlacement(this: TouchApp, screen: Point): void {
  const area = placementMapBounds(this.viewWidth, this.viewHeight),
    x = clamp(screen.x, area.x, area.x + area.w),
    y = clamp(screen.y, area.y, area.y + area.h),
    projected = this.camera.toWorld(point(x, y), this.viewWidth, this.viewHeight);
  this.touchPlacement = unproject(projected.x, projected.y);
  this.cursor = { ...this.touchPlacement };
}
export function confirmTouchPlacement(this: TouchApp): void {
  if (!this.touchMode || !this.touchPlacement || toolStructure(this.tool) === undefined) return;
  this.cursor = { ...this.touchPlacement };
  this.press();
}
/** Rotation changes the viewport, not the chosen world site. Keep that site in view. */
export function keepTouchPlacementVisible(this: GameAppState): void {
  if (!this.touchMode || !this.touchPlacement) return;
  const area = placementMapBounds(this.viewWidth, this.viewHeight),
    at = this.camera.toScreen(
      project(this.touchPlacement.x, this.touchPlacement.y),
      this.viewWidth,
      this.viewHeight,
    ),
    x = clamp(at.x, area.x, area.x + area.w),
    y = clamp(at.y, area.y, area.y + area.h);
  this.camera.x = f32(this.camera.x + (at.x - x) / this.camera.zoom);
  this.camera.y = f32(this.camera.y + (at.y - y) / this.camera.zoom);
  this.renderer.invalidatePresentation();
  this.hoveredWorldTarget = null;
}
/** Taps select/target; drags pan. Drawing tools explicitly own one-finger strokes. */
export function handleTouchEvent(this: TouchApp, event: AppEvent): boolean {
  if (event.pointerType !== 'touch') return false;
  const at = point(event.x, event.y);
  if (event.type === 'Gesture') {
    const gesture = event.gesture;
    if (gesture) {
      const placement = this.touchPlacement ? this.toScreen(this.touchPlacement) : null;
      this.camera.x = f32(this.camera.x - gesture.dx / this.camera.zoom);
      this.camera.y = f32(this.camera.y - gesture.dy / this.camera.zoom);
      this.zoomBy(gesture.scale, at);
      // The placement reticle stays above the dock while the map moves beneath it.
      if (placement) moveTouchPlacement.call(this, placement);
      this.context.setPointerPosition(-1, -1);
    }
    return true;
  }
  if (event.type === 'PointerDown') {
    const ui = this.context.controlAt(at.x, at.y),
      mode = ui
        ? 'ui'
        : toolStructure(this.tool) !== undefined
          ? 'place'
          : this.tool === Tool.Road || this.tool === Tool.Field
            ? 'draw'
            : 'tap';
    this.touchGesture = { start: at, last: at, mode };
    if (mode === 'ui' || mode === 'draw') this.pointerDown(at.x, at.y, PointerButton.Primary);
    else {
      this.mobileQuestsExpanded = false;
      this.timeExpanded = false;
      this.pointerMove(at.x, at.y);
      if (mode === 'place') moveTouchPlacement.call(this, point(at.x, at.y - 52));
    }
    return true;
  }
  if (event.type !== 'PointerMove' && event.type !== 'PointerUp') return false;
  const gesture = this.touchGesture;
  if (!gesture) return true;
  if (gesture.mode === 'tap' && distance(gesture.start, at) > 10) {
    gesture.mode = 'pan';
    this.dismissBuildDrawer();
  }
  if (gesture.mode === 'pan') {
    // Include the initial dead-zone movement, then follow the finger exactly.
    this.camera.x = f32(this.camera.x - (at.x - gesture.last.x) / this.camera.zoom);
    this.camera.y = f32(this.camera.y - (at.y - gesture.last.y) / this.camera.zoom);
    this.renderer.invalidatePresentation();
    this.hoveredWorldTarget = null;
  } else if (gesture.mode === 'place') {
    if (!this.context.controlAt(at.x, at.y)) moveTouchPlacement.call(this, point(at.x, at.y - 52));
  } else if (gesture.mode === 'ui' || gesture.mode === 'draw') {
    if (gesture.mode === 'ui' || !this.context.controlAt(at.x, at.y)) this.pointerMove(at.x, at.y);
  }
  if (gesture.mode !== 'tap') gesture.last = at;
  if (event.type === 'PointerUp') {
    this.touchGesture = null;
    if (gesture.mode === 'ui') this.pointerUp(at.x, at.y, PointerButton.Primary);
    else if (!this.context.controlAt(at.x, at.y)) {
      if (gesture.mode === 'tap') {
        this.pointerDown(at.x, at.y, PointerButton.Primary);
        this.pointerUp(at.x, at.y, PointerButton.Primary);
      } else if (gesture.mode === 'draw') this.pointerUp(at.x, at.y, PointerButton.Primary);
    } else if (gesture.mode === 'draw') this.cancelPointer();
    // Touch has no hover: do not leave a tooltip or calendar on top of the map.
    this.context.setPointerPosition(-1, -1);
    if (!this.context.textFocused()) this.context.focus('');
    this.skyHovered = false;
  }
  return true;
}

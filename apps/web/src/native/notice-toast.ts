import { Align, EventType, Rect } from '../../../../packages/native-ui/src';
import { f32 } from '../../../../packages/engine/src/numeric';
import type { GameAppState } from './game-app-state';

/** How long a notice shows, and how soon it gives way to one waiting behind it. */
export const noticeRules = { seconds: 10, yieldAfter: 2.5 };
type Toast = Pick<GameAppState, 'notice' | 'noticeFrom' | 'noticeUntil'>;
/** The toast can take the next notice: its time is up, or one waits and this one has had its share. */
export const noticeDue = (app: Toast, now: number, waiting: boolean): boolean =>
  now >= app.noticeUntil || (waiting && now >= app.noticeFrom + noticeRules.yieldAfter);
export function showNotice(app: Toast, text: string, now: number): void {
  app.notice = text;
  app.noticeFrom = now;
  app.noticeUntil = now + noticeRules.seconds;
}
/** The notice above the dock. A click puts it away, and one waiting behind it takes its place. */
export function noticeToast(app: GameAppState, width: number, height: number): void {
  const c = app.context,
    t = app.theme;
  if (!app.notice || c.time() >= app.noticeUntil || height < 540) return;
  const w = Math.min(560, f32(width - 24), Math.max(360, f32(c.textWidth(app.notice, 13, true) + 36))),
    toast = new Rect(f32(f32(width - w) / 2), f32(app.dockBounds.y - 46), w, 36);
  c.control(
    'notice',
    toast,
    (event) => {
      if (event.type === EventType.Activate) app.noticeUntil = 0;
    },
    true,
    false,
  );
  c.rect(toast, t.raised, t.radius, t.accent);
  c.text(
    new Rect(f32(toast.x + 12), toast.y, f32(toast.w - 24), toast.h),
    c.elideText(app.notice, f32(w - 24), 13, true),
    t.text,
    13,
    true,
    Align.Center,
  );
  c.requestFrameAt(app.noticeUntil);
}

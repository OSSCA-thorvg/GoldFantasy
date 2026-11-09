import type { Application } from './application-contracts';

/** Match ui::Session::updateCursor query order and SDL cursor shapes. */
export function applicationCursor(app: Pick<Application, 'command'>): string {
  if (app.command('ui.cursor', 'resize-horizontal')) return 'ew-resize';
  if (app.command('ui.cursor', 'resize-vertical')) return 'ns-resize';
  if (app.command('ui.cursor', 'text')) return 'text';
  if (app.command('ui.cursor', 'crosshair')) return 'crosshair';
  return 'default';
}

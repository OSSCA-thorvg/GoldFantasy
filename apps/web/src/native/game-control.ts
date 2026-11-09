import type { Town } from '../../../../packages/engine/src/town';
import { canControl, controlReason } from '../../../../packages/engine/src/faction';

/** Recheck at dispatch: a selected resident may become overwhelmed or leave the faction. */
export function controllableIds(town: Pick<Town, 'person'>, ids: readonly number[]): number[] {
  return ids.filter((id) => canControl(town.person(id)));
}
export function selectionControlReason(town: Pick<Town, 'person'>, ids: readonly number[]): string {
  return ids.length ? controlReason(town.person(ids[0])) : 'Select a resident first.';
}

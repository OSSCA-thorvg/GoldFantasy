import { combatRules } from './combat-events';
import type { Person } from './person';

/** Health cannot rise above this while a wound lasts. */
export const healthCap = (p: Person): number => (p.woundDays > 0 ? combatRules.woundedHealth : 1);

import { afterEach, describe, expect, it } from 'vitest';
import {
  PhraseBook,
  defaultLocale,
  hasHangul,
  locale,
  localeRevision,
  onLocaleChange,
  setLocale,
  translate,
} from '../../packages/localization/src/index';
import { korean, koreanPhrases } from '../../packages/localization/src/korean';
import goals from '../../packages/engine/data/settlement-goals.json';
import { Structure, structureSpec } from '../../packages/engine/src/building-catalog';
import { itemCatalog } from '../../packages/engine/src/equipment';
import { Activity, Calling, activityName, callingName } from '../../packages/engine/src/person';
import { goalBranchName, GoalBranch } from '../../packages/engine/src/settlement-progression';
import { pressureNotice, raidWarning, RaidKind } from '../../packages/engine/src/raid-progression';

describe('phrase book', () => {
  // Stand-in target text keeps this fixture free of any one language.
  const book = new PhraseBook({
    Tent: 'TENT*',
    wood: 'WOOD*',
    'Complete {0}': '{0} <- finish',
    '{0} reached level {1}!': 'L{1}: {0}',
    '{0} wood': 'WOOD* x{0}',
    '{0} stone': 'STONE* x{0}',
    'Needs {0}': 'need {0}',
    'Needs {0} residents': 'residents needed: {0}',
  });
  it('matches whole phrases and leaves unknown text alone', () => {
    expect(book.translate('Tent')).toBe('TENT*');
    expect(book.translate('Tents')).toBe('Tents');
    expect(book.translate('42')).toBe('42');
    expect(book.missing()).toEqual(['Tents']);
  });
  it('fills, reorders and translates the changing parts', () => {
    expect(book.translate('Complete Tent')).toBe('TENT* <- finish');
    expect(book.translate('Bjorn reached level 3!')).toBe('L3: Bjorn');
    expect(book.translate('  Tent ')).toBe('  TENT* ');
  });
  it('prefers the pattern with the most fixed text', () => {
    expect(book.translate('Needs 6 residents')).toBe('residents needed: 6');
    expect(book.translate('Needs 12 wood')).toBe('need WOOD* x12');
  });
  it('translates lists piece by piece but never half of one', () => {
    expect(book.translate('12 wood, 3 stone')).toBe('WOOD* x12, STONE* x3');
    expect(book.translate('12 wood, 3 apples')).toBe('12 wood, 3 apples');
  });
  it('does not mistake another sentence for a changing part', () => {
    expect(book.translate('Chop, carry and store the wood')).toBe('Chop, carry and store the wood');
  });
});

describe('language choice', () => {
  afterEach(() => setLocale(defaultLocale));
  it('starts in English and passes text through untouched', () => {
    expect(locale()).toBe('ENG');
    expect(translate('Settings')).toBe('Settings');
  });
  it('switches to Korean, tells listeners and bumps the revision', () => {
    const seen: string[] = [],
      before = localeRevision(),
      stop = onLocaleChange((next) => seen.push(next));
    setLocale('KR');
    setLocale('KR');
    expect(seen).toEqual(['KR']);
    expect(localeRevision()).toBe(before + 1);
    expect(hasHangul(translate('Settings'))).toBe(true);
    expect(hasHangul(translate('Language'))).toBe(true);
    stop();
    setLocale('ENG');
    expect(seen).toEqual(['KR']);
  });
});

describe('Korean tables', () => {
  const known = (text: string) => expect(hasHangul(korean.translate(text)), text).toBe(true);
  it('keeps every placeholder of a key in its translation', () => {
    for (const table of koreanPhrases)
      for (const [key, value] of Object.entries(table)) {
        const used = (text: string) => [...text.matchAll(/\{(\d+)\}/g)].map((hit) => hit[1]).sort();
        expect(used(value), key).toEqual(used(key));
      }
  });
  it('covers every goal, building, item, activity and calling', () => {
    for (const goal of goals) {
      known(goal.title);
      known(goal.description);
    }
    for (let kind = 0; kind < Structure.Count; ++kind) known(structureSpec(kind).name);
    for (const item of itemCatalog) {
      known(item.name);
      known(item.description);
    }
    for (let activity = Activity.Moving; activityName(activity); ++activity) known(activityName(activity));
    for (let calling = Calling.Settler; callingName(calling); ++calling) known(callingName(calling));
    for (let branch = GoalBranch.Core; goalBranchName(branch); ++branch) known(goalBranchName(branch));
  });
  it('covers composed engine messages', () => {
    for (const text of [
      'Complete Lumberyard',
      'Needs 6 residents',
      pressureNotice(2),
      pressureNotice(12),
      raidWarning(RaidKind.Horde, 'Wolf Cave'),
      'Bjorn reached level 3!',
      '12 wood, 3 stone',
    ])
      known(text);
  });
});

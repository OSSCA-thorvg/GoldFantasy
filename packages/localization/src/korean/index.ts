import { PhraseBook } from '../phrase-book';
import { catalogPhrases } from './catalog';
import { combatPhrases } from './combat';
import { editorPhrases } from './editors';
import { expeditionPhrases } from './expedition';
import { expeditionResultPhrases } from './expedition-result';
import { godsPhrases } from './gods';
import { guidePhrases } from './guide';
import { hudPhrases } from './hud';
import { offeringPhrases } from './offering';
import { progressPhrases } from './progress';
import { settingsPhrases } from './settings';
import { townPhrases } from './town';

// Later tables win, so shared UI terms follow the game HUD's wording.
export const koreanPhrases = [
  editorPhrases,
  catalogPhrases,
  townPhrases,
  guidePhrases,
  combatPhrases,
  progressPhrases,
  godsPhrases,
  offeringPhrases,
  expeditionPhrases,
  expeditionResultPhrases,
  hudPhrases,
  settingsPhrases,
];
export const korean = new PhraseBook(...koreanPhrases);

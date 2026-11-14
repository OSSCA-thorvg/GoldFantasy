import { PhraseBook } from '../phrase-book';
import { catalogPhrases } from './catalog';
import { editorPhrases } from './editors';
import { guidePhrases } from './guide';
import { hudPhrases } from './hud';
import { settingsPhrases } from './settings';
import { townPhrases } from './town';

// Later tables win, so shared UI terms follow the game HUD's wording.
export const koreanPhrases = [editorPhrases, catalogPhrases, townPhrases, guidePhrases, hudPhrases, settingsPhrases];
export const korean = new PhraseBook(...koreanPhrases);

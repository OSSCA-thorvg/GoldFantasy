import type { Paint, ThorVGNamespace } from '@thorvg/webcanvas';
import type {
  CharacterPreviewRenderer,
  PortraitBackdrop as EditorBackdrop,
} from '../../native-editors/src/character-editor';
import {
  characterFigure,
  characterFigurePlacement,
  characterPortraitPlacement,
  hairFitAnchors,
} from './character-assets';
import { portraitBackdrop, portraitBackground, type PortraitBackdrop } from './portrait-background';
import { personPortrait, moodOf } from './person-portrait';
import { WebCanvasAdapter } from './webcanvas-adapter';
import type { PaintNode } from './paint';
const fromEditor = (b: EditorBackdrop): PortraitBackdrop => ({
  ground: [b.ground.r, b.ground.g, b.ground.b],
  left: [b.left.r, b.left.g, b.left.b],
  right: [b.right.r, b.right.g, b.right.b],
  distant: [b.distant.r, b.distant.g, b.distant.b],
});
/** Owns each returned native paint; Context's retained cache releases it. */
export function createCharacterPreview(tvg: ThorVGNamespace): CharacterPreviewRenderer {
  const owned = (node: PaintNode): Paint => {
    const adapter = new WebCanvasAdapter(tvg);
    try {
      return adapter.sync(node).duplicate();
    } finally {
      adapter.dispose();
    }
  };
  return {
    backdrop() {
      const b = portraitBackdrop(),
        convert = (color: readonly [number, number, number]) => ({ r: color[0], g: color[1], b: color[2] });
      return {
        ground: convert(b.ground),
        left: convert(b.left),
        right: convert(b.right),
        distant: convert(b.distant),
      };
    },
    portrait: (person, width, height, b) =>
      owned(personPortrait(person, moodOf(person), width, height, fromEditor(b))),
    background: (b, width, height) => owned(portraitBackground(fromEditor(b), width, height)),
    figure: (look) => owned(characterFigure(look)),
    figurePlacement: characterFigurePlacement,
    portraitPlacement: characterPortraitPlacement,
    hairFitAnchors,
  };
}

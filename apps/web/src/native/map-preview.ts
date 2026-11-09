import type { ThorVGNamespace } from '@thorvg/webcanvas';
import type { MapPreviewRenderer } from '../../../../packages/native-editors/src';
import { WorldRenderer } from '../../../../packages/native-renderer/src/world-renderer';
import { Town } from '../../../../packages/engine/src/town';
import { Traffic } from '../../../../packages/engine/src/traffic';
import { Preview } from '../../../../packages/engine/src/game-tools';
import type { WorldMap } from '../../../../packages/engine/src/world-map';
/** Native MapPreview Town overload, kept separate from the live session. */
export function createMapPreview(tvg: ThorVGNamespace): MapPreviewRenderer {
  const renderer = new WorldRenderer(tvg);
  renderer.setEditorView(true);
  let town: Town | undefined, traffic: Traffic | undefined, map: WorldMap | undefined;
  return {
    scene: () => renderer.scene(),
    invalidateMap: () => renderer.invalidateMap(),
    invalidateTerrain: (area) => renderer.invalidateTerrain(area),
    finishTerrainEdits: () => renderer.finishTerrainEdits(),
    update(next, camera, width, height, time) {
      if (map !== next) {
        map = next;
        town = new Town(next, 176, false, true);
        traffic = new Traffic(next.seed());
      }
      // MapEditor owns this isolated preview map and applies the native dirty-region updates to it.
      // Share that preview storage only inside this adapter; ordinary Town construction copies maps.
      town!.world = next;
      town!.open = new Uint8Array(next.dungeons().length);
      const preview = new Preview();
      preview.zoom = camera.zoom;
      renderer.update(town!, traffic!, camera, width, height, time, preview, []);
    },
    dispose: () => renderer.dispose(),
  };
}

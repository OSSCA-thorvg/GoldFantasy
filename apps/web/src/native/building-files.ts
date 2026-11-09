// Browser filesystem boundary for the original live building catalog and its saved baselines.
import { BUILDING_ASSETS } from '../../../../packages/content/src/assets';
import { Structure } from '../../../../packages/engine/src/building-catalog';
import {
  buildingAsset,
  buildingAssetId,
  loadBuildingAssetCatalog,
} from '../../../../packages/native-renderer/src/building-assets';
import { decodeBuildingAsset } from '../../../../packages/native-renderer/src/building-asset';
import type { BuildingDocumentFiles, BuildingEditorEntry } from '../../../../packages/native-editors/src';
export class BuildingFiles {
  private readonly originals = new Map<string, BuildingEditorEntry>();
  constructor(private readonly files: BuildingDocumentFiles) {
    for (const raw of Object.values(BUILDING_ASSETS)) {
      const path = `/assets/buildings/${raw.id}.json`;
      if (!files.exists(path)) files.stage(path, JSON.stringify(raw, null, 2) + '\n');
    }
    this.loadDirectory();
  }
  loadDirectory(directory = '/assets/buildings'): void {
    const entries = Array.from({ length: Structure.Count }, (_, kind) => {
      const path = `${directory.replace(/\/$/, '')}/${buildingAssetId(kind)}.json`,
        text = this.files.readSync(path, 4 * 1024 * 1024),
        asset = decodeBuildingAsset(text.replace(/^\ufeff/, ''));
      return { asset, path, source: { asset, text } };
    });
    loadBuildingAssetCatalog(entries.map((entry) => entry.asset));
    this.originals.clear();
    for (const entry of entries) this.originals.set(entry.asset.id, entry);
  }
  entry(kind: Structure): BuildingEditorEntry {
    const asset = buildingAsset(kind),
      source = this.originals.get(buildingAssetId(kind))!;
    return structuredClone({ ...source, asset, accepted: asset });
  }
  remember(entry: BuildingEditorEntry): void {
    if (entry.source) this.originals.set(entry.source.asset.id, structuredClone(entry));
  }
}

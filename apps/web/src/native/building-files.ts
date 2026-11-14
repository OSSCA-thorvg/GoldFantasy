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
/** Which bundled revision of each asset the stored copy was staged from. */
const bundledMarks = '/assets/buildings.bundled.json';
export function textMark(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16);
}
function storedMarks(files: BuildingDocumentFiles): Record<string, string> {
  try {
    const marks: unknown = JSON.parse(files.readSync(bundledMarks, 64 * 1024));
    if (marks && typeof marks === 'object' && !Array.isArray(marks))
      return Object.fromEntries(Object.entries(marks).filter(([, mark]) => typeof mark === 'string'));
  } catch {
    // No marks yet: every stored copy predates them.
  }
  return {};
}
export class BuildingFiles {
  private readonly originals = new Map<string, BuildingEditorEntry>();
  constructor(private readonly files: BuildingDocumentFiles) {
    // Stored copies outlive a release, so new bundled art must replace the copy it was staged
    // from. A copy the player edited is set aside under replaced/ rather than lost.
    const marks = storedMarks(files);
    let moved = false;
    for (const raw of Object.values(BUILDING_ASSETS)) {
      const path = `/assets/buildings/${raw.id}.json`,
        text = JSON.stringify(raw, null, 2) + '\n',
        mark = textMark(text);
      if (files.exists(path)) {
        if (marks[raw.id] === mark) continue;
        const stored = files.readSync(path, 4 * 1024 * 1024);
        if (stored !== text) {
          if (textMark(stored) !== marks[raw.id])
            files.stage(`/assets/buildings/replaced/${raw.id}.json`, stored);
          files.stage(path, text);
        }
      } else files.stage(path, text);
      marks[raw.id] = mark;
      moved = true;
    }
    if (moved) files.stage(bundledMarks, JSON.stringify(marks));
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

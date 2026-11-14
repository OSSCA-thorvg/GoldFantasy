import { expect, it } from 'vitest';
import { BuildingFiles, textMark } from '../../apps/web/src/native/building-files';
import { BUILDING_ASSETS } from '../../packages/content/src/assets';
import type { BuildingDocumentFiles } from '../../packages/native-editors/src';

class MemoryFiles implements BuildingDocumentFiles {
  readonly data = new Map<string, string>();
  exists(path: string): boolean {
    return this.data.has(path);
  }
  readSync(path: string): string {
    const value = this.data.get(path);
    if (value === undefined) throw new Error('File does not exist');
    return value;
  }
  stage(path: string, value: string): void {
    this.data.set(path, value);
  }
}
const cottage = '/assets/buildings/cottage.json',
  kept = '/assets/buildings/replaced/cottage.json',
  marks = '/assets/buildings.bundled.json',
  bundled = JSON.stringify(BUILDING_ASSETS.Cottage, null, 2) + '\n',
  // A valid asset that differs from today's bundle, standing in for an earlier release or an edit.
  earlier = bundled.replace('"name": "Cottage"', '"name": "Old cottage"');

it('stages the bundled catalog on a first run and remembers which revision it staged', () => {
  const files = new MemoryFiles();
  new BuildingFiles(files);
  expect(files.readSync(cottage)).toBe(bundled);
  expect(JSON.parse(files.readSync(marks)).cottage).toBe(textMark(bundled));
  expect(files.exists(kept)).toBe(false);
});
it('replaces a stored copy from before revisions were recorded, keeping the old one aside', () => {
  const files = new MemoryFiles();
  files.stage(cottage, earlier);
  new BuildingFiles(files);
  expect(files.readSync(cottage)).toBe(bundled);
  expect(files.readSync(kept)).toBe(earlier);
});
it('lets an untouched copy follow new bundled art without leaving a backup', () => {
  const files = new MemoryFiles();
  new BuildingFiles(files);
  files.stage(cottage, earlier);
  files.stage(marks, JSON.stringify({ ...JSON.parse(files.readSync(marks)), cottage: textMark(earlier) }));
  new BuildingFiles(files);
  expect(files.readSync(cottage)).toBe(bundled);
  expect(files.exists(kept)).toBe(false);
});
it('leaves a copy edited after staging alone while the bundle is unchanged, and sets it aside when it moves on', () => {
  const files = new MemoryFiles();
  new BuildingFiles(files);
  files.stage(cottage, earlier);
  new BuildingFiles(files);
  expect(files.readSync(cottage)).toBe(earlier);
  files.stage(marks, JSON.stringify({ ...JSON.parse(files.readSync(marks)), cottage: 'older-release' }));
  new BuildingFiles(files);
  expect(files.readSync(cottage)).toBe(bundled);
  expect(files.readSync(kept)).toBe(earlier);
});

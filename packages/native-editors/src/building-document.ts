// Native BuildingEditor::Impl and document commands. Browser cache replaces filesystem I/O.
import { f32 as f, clamp } from '../../engine/src/numeric';
import {
  decodeBuildingAsset,
  encodeBuildingAsset,
  validateBuildingAsset,
  type BuildingAsset,
} from '../../native-renderer/src/building-asset';
import {
  RoofShape,
  Trim,
  Ornament,
  type Block,
  type Patch,
  type Model,
} from '../../native-renderer/src/building-model';
import { TextInput } from '../../native-ui/src';

export interface BuildingDocumentFiles {
  exists(path: string): boolean;
  readSync(path: string, maxBytes?: number): string;
  stage(path: string, text: string, maxBytes?: number): void;
}
export interface BuildingEditorSource {
  asset: BuildingAsset;
  text: string | null;
}
export interface BuildingEditorEntry {
  asset: BuildingAsset;
  path: string;
  source?: BuildingEditorSource;
  accepted?: BuildingAsset;
}
export type BuildingApply = (asset: BuildingAsset, error: { value: string }) => boolean;
interface Pending {
  asset: BuildingAsset;
  path: string;
  text: string | null;
  baseline: boolean;
  close?: boolean;
  saved?: BuildingAsset;
  accepted?: BuildingAsset;
}
export const maximumBuildingBytes = 4 * 1024 * 1024;
const copy = <T>(value: T): T => structuredClone(value);
function equalValue(a: unknown, b: unknown): boolean {
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && equalValue(Reflect.get(a, key), Reflect.get(b, key)))
  );
}
const same = (a: BuildingAsset, b: BuildingAsset): boolean => equalValue(a, b);
const bytes = (text: string): number => new TextEncoder().encode(text).length;
const canonical = (path: string): string => {
  const parts: string[] = [];
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return '/' + parts.join('/');
};
export const sameBuildingDestination = (a: string, b: string): boolean =>
  !!a && !!b && canonical(a) === canonical(b);
export function buildingNumber(value: number): string {
  if (value === 0) return Object.is(value, -0) ? '-0' : '0';
  const text = value.toPrecision(6).toLowerCase(),
    [mantissa, exponentText] = text.split('e');
  const exponent = Math.floor(Math.log10(Math.abs(Number(text))));
  if (exponent >= -4 && exponent < 6)
    return Number(text)
      .toFixed(Math.max(0, 5 - exponent))
      .replace(/(\.\d*?)0+$/, '$1')
      .replace(/\.$/, '');
  const scientific = Number(text).toExponential(5).split('e');
  const power = Number(exponentText ?? scientific[1]);
  return (
    (exponentText === undefined ? scientific[0] : mantissa).replace(/0+$/, '').replace(/\.$/, '') +
    'e' +
    (power < 0 ? '-' : '+') +
    String(Math.abs(power)).padStart(2, '0')
  );
}
export function buildingNumeric(text: string): number | undefined {
  if (/^[ \t\n\r\v\f]*[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) {
    const value = Number(text);
    return Number.isFinite(value) ? value : undefined;
  }
  const hex = text.match(/^[ \t\n\r\v\f]*([+-]?)0x([\da-f]*)(?:\.([\da-f]*))?(?:p([+-]?\d+))?$/i);
  if (!hex || !(hex[2] || hex[3])) return undefined;
  const fraction = hex[3] ?? '';
  const value =
    (hex[1] === '-' ? -1 : 1) *
    (parseInt(hex[2] || '0', 16) + (fraction ? parseInt(fraction, 16) / 16 ** fraction.length : 0)) *
    2 ** Number(hex[4] ?? 0);
  return Number.isFinite(value) ? value : undefined;
}
const defaultBlock = (): Block => ({
  x0: 0,
  y0: 0,
  x1: 1,
  y1: 1,
  wall: 28,
  roof: 18,
  shape: RoofShape.GableX,
  wallLit: [190, 165, 120],
  wallShade: [145, 120, 85],
  roofLit: [125, 75, 55],
  roofShade: [90, 50, 40],
  base: 0,
  delay: 0,
  windows: 0,
  door: false,
  trim: Trim.None,
  glass: [232, 162, 72],
  ornament: Ornament.None,
  accent: [156, 40, 46],
  doorFacing: 0,
});
const defaultPatch = (): Patch => ({
  x0: 0,
  y0: 0,
  x1: 1,
  y1: 1,
  color: [105, 120, 75],
  furrows: 0,
  furrow: [0, 0, 0],
  delay: 0,
});
const readable = (text: string): string => text.replace(/^\ufeff/, '');
function formatted(text: string, baseline: string | null): string {
  if (!baseline) return text;
  const withoutCrLf = baseline.replaceAll('\r\n', '');
  if (baseline.includes('\r\n') && !withoutCrLf.includes('\n') && !withoutCrLf.includes('\r'))
    text = text.replaceAll('\n', '\r\n');
  else if (baseline.includes('\r') && !baseline.includes('\n')) text = text.replaceAll('\n', '\r');
  if (baseline.startsWith('\ufeff')) text = '\ufeff' + text;
  return text;
}

export class BuildingDocument {
  draft!: BuildingAsset;
  saved!: BuildingAsset;
  accepted!: BuildingAsset;
  path = '';
  baselineText: string | null = null;
  baseline = false;
  gameMode = false;
  patch = false;
  playing = false;
  closeReady = false;
  previewFailed = false;
  variant = 0;
  selected = 0;
  revision = 0n;
  acceptedRevision = 0n;
  past: BuildingAsset[] = [];
  future: BuildingAsset[] = [];
  choices: BuildingEditorEntry[] = [];
  choiceIndex: number | undefined;
  fields = new Map<string, TextInput>();
  fieldValues = new Map<string, string>();
  pathInput = new TextInput();
  feedback = 'Edit a primitive, then Save or Apply the draft.';
  pending: Pending | undefined;
  callback: BuildingApply | undefined;
  savedCallback: ((entry: BuildingEditorEntry) => void) | undefined;
  angle = 0;
  zoom = 1;
  frame = 0;
  scroll = 0;
  listScroll = 0;
  contentHeight = 0;
  inspectorHeight = 0;
  tab = 0;
  mode = 0;
  narrowPanel = 0;
  picker = 0;
  pickerScroll = 0;
  previous = -1;
  animationKey = '';
  constructor(
    entry: BuildingEditorEntry,
    readonly files: BuildingDocumentFiles,
  ) {
    this.install(this.prepare(entry));
  }
  document(): BuildingEditorEntry {
    return {
      asset: copy(this.draft),
      path: this.path,
      source: this.baseline ? { asset: copy(this.saved), text: this.baselineText } : undefined,
      accepted: copy(this.accepted),
    };
  }
  private read(path: string, missing = false): string | null {
    if (!this.files.exists(path)) {
      if (missing) return null;
      throw new Error('File does not exist');
    }
    const text = this.files.readSync(path, maximumBuildingBytes);
    if (bytes(text) > maximumBuildingBytes) throw new Error('File exceeds size limit');
    return text;
  }
  private prepare(entry: BuildingEditorEntry): Pending {
    validateBuildingAsset(entry.asset);
    if (entry.accepted) validateBuildingAsset(entry.accepted);
    const next: Pending = {
      asset: copy(entry.asset),
      path: entry.path,
      text: null,
      baseline: false,
      accepted: entry.accepted ? copy(entry.accepted) : undefined,
    };
    if (entry.source) {
      validateBuildingAsset(entry.source.asset);
      next.saved = copy(entry.source.asset);
      next.text = entry.source.text;
      next.baseline = true;
    } else if (next.path) {
      const text = this.read(next.path, true);
      let equal = false;
      if (text !== null) {
        try {
          equal = same(decodeBuildingAsset(readable(text)), next.asset);
        } catch {}
      }
      if (text === null || equal) {
        next.text = text;
        next.baseline = true;
      }
    }
    return next;
  }
  private findChoice(): void {
    this.choiceIndex = this.choices.findIndex(
      (c) =>
        c.asset.id === this.draft.id && (c.path === this.path || sameBuildingDestination(c.path, this.path)),
    );
    if (this.choiceIndex < 0) this.choiceIndex = undefined;
  }
  private rememberChoice(): void {
    if (this.choiceIndex !== undefined && this.choiceIndex < this.choices.length)
      this.choices[this.choiceIndex] = this.document();
  }
  buffered(): boolean {
    return [...this.fields].some(
      ([key, input]) => this.fieldValues.has(key) && input.value !== this.fieldValues.get(key),
    );
  }
  flush(): boolean {
    const edits = [...this.fields]
      .filter(([key, input]) => this.fieldValues.has(key) && input.value !== this.fieldValues.get(key))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, input]) => [key, input.value] as const);
    for (const [key, text] of edits) {
      if (!this.property(key, text)) return false;
      this.fieldValues.set(key, text);
    }
    return true;
  }
  dirty(): boolean {
    return !same(this.draft, this.saved) || this.buffered();
  }
  unsettled(): boolean {
    return this.dirty() || !same(this.draft, this.accepted);
  }
  model(): Model {
    return this.draft.variants[this.variant];
  }
  clampSelection(): void {
    this.variant = Math.min(this.variant, this.draft.variants.length - 1);
    if (this.patch && !this.model().patches.length) this.patch = false;
    if (!this.patch && !this.model().blocks.length) this.patch = true;
    const count = this.patch ? this.model().patches.length : this.model().blocks.length;
    this.selected = count ? Math.min(this.selected, count - 1) : 0;
  }
  private history(before: BuildingAsset): void {
    if (this.past.length === 64) this.past.shift();
    this.past.push(before);
    this.future = [];
    this.clampSelection();
    this.revision++;
  }
  edit(change: (candidate: BuildingAsset) => void): boolean {
    const candidate = copy(this.draft);
    change(candidate);
    try {
      validateBuildingAsset(candidate);
    } catch (error) {
      this.feedback = error instanceof Error ? error.message : String(error);
      return false;
    }
    if (
      this.gameMode &&
      (candidate.id !== this.draft.id ||
        candidate.footprint !== this.draft.footprint ||
        candidate.variants.length !== this.draft.variants.length)
    ) {
      this.feedback = 'Game assets retain their ID, footprint and variant slots.';
      return false;
    }
    if (!same(candidate, this.draft)) {
      const before = this.draft;
      this.draft = candidate;
      this.history(before);
    }
    this.feedback = 'Draft updated. Apply publishes it; Save writes the JSON.';
    return true;
  }
  private install(next: Pending): void {
    this.draft = next.asset;
    this.saved = copy(next.saved ?? this.draft);
    this.accepted = copy(next.accepted ?? this.draft);
    this.revision++;
    this.acceptedRevision++;
    this.path = next.path;
    this.baselineText = next.text;
    this.baseline = next.baseline;
    this.findChoice();
    this.pathInput = new TextInput(this.path, bytes(this.path));
    this.variant = this.selected = 0;
    this.patch = !this.model().blocks.length;
    this.past = [];
    this.future = [];
    this.fields.clear();
    this.fieldValues.clear();
    this.pending = undefined;
    this.frame = this.scroll = this.listScroll = 0;
    this.animationKey = '';
    this.previewFailed = false;
    this.feedback = 'Asset opened as a draft. Apply publishes changes.';
  }
  private stage(next: Pending): boolean {
    if (this.unsettled()) {
      this.pending = next;
      this.feedback = 'Unsaved or unapplied changes. Discard them or keep editing.';
      return false;
    }
    this.install(next);
    return true;
  }
  property(key: string, text: string): boolean {
    if (key === 'name' || key === 'id')
      return this.edit((asset) => {
        asset[key] = text;
      });
    const value = buildingNumeric(text);
    if (value === undefined || Math.abs(value) > 3.4028234663852886e38) {
      this.feedback = 'Enter a finite numeric value.';
      return false;
    }
    let known = true;
    const result = this.edit((asset) => {
      if (key === 'footprint') {
        asset.footprint = f(value);
        return;
      }
      const model = asset.variants[this.variant];
      const assign = (item: Block | Patch): boolean => {
        if (key === 'x0' || key === 'y0' || key === 'x1' || key === 'y1' || key === 'delay') {
          item[key] = f(value);
          return true;
        }
        return false;
      };
      const color = (
        name: string,
        rgb: readonly [number, number, number],
        set: (value: readonly [number, number, number]) => void,
      ): boolean => {
        if (!key.startsWith(name + '.')) return false;
        if (value < 0 || value > 255 || Math.floor(value) !== value) {
          known = false;
          return true;
        }
        const channel = key.slice(name.length + 1);
        if (channel === 'r') set([value, rgb[1], rgb[2]]);
        else if (channel === 'g') set([rgb[0], value, rgb[2]]);
        else if (channel === 'b') set([rgb[0], rgb[1], value]);
        else known = false;
        return true;
      };
      if (this.patch) {
        const item = model.patches[this.selected];
        if (assign(item)) return;
        if (key === 'furrows') {
          if (value >= 0 && value <= 32 && value === Math.floor(value)) item.furrows = value;
          else known = false;
        } else if (
          !color('color', item.color, (value) => {
            item.color = value;
          }) &&
          !color('furrow', item.furrow, (value) => {
            item.furrow = value;
          })
        )
          known = false;
      } else {
        const item = model.blocks[this.selected];
        if (assign(item)) return;
        if (key === 'wall' || key === 'roof' || key === 'base') item[key] = f(value);
        else if (key === 'windows') {
          if (value >= 0 && value <= 8 && value === Math.floor(value)) item.windows = value;
          else known = false;
        } else if (key === 'door') {
          if (value === 0 || value === 1) item.door = value !== 0;
          else known = false;
        } else if (key === 'shape') {
          if (value >= 0 && value <= 3 && value === Math.floor(value)) item.shape = value;
          else known = false;
        } else if (key === 'trim') {
          if (value >= 0 && value <= 3 && value === Math.floor(value)) item.trim = value;
          else known = false;
        } else if (key === 'ornament') {
          if (value >= 0 && value <= 2 && value === Math.floor(value)) item.ornament = value;
          else known = false;
        } else if (
          !color('wallLit', item.wallLit, (value) => {
            item.wallLit = value;
          }) &&
          !color('wallShade', item.wallShade, (value) => {
            item.wallShade = value;
          }) &&
          !color('roofLit', item.roofLit, (value) => {
            item.roofLit = value;
          }) &&
          !color('roofShade', item.roofShade, (value) => {
            item.roofShade = value;
          }) &&
          !color('glass', item.glass, (value) => {
            item.glass = value;
          }) &&
          !color('accent', item.accent, (value) => {
            item.accent = value;
          })
        )
          known = false;
      }
    });
    if (!known) this.feedback = 'Unknown field or value outside its allowed range: ' + key;
    return result && known;
  }
  setChoices(choices: BuildingEditorEntry[]): void {
    this.choices = copy(choices);
    this.findChoice();
    this.rememberChoice();
  }
  setVariant(value: number): void {
    if (!this.flush()) return;
    this.variant = Math.min(value, this.draft.variants.length - 1);
    this.clampSelection();
    this.fields.clear();
    this.fieldValues.clear();
  }
  undo(): void {
    if (this.pending || !this.flush() || !this.past.length) return;
    this.future.push(this.draft);
    this.draft = this.past.pop()!;
    this.revision++;
    this.clampSelection();
    this.fields.clear();
    this.fieldValues.clear();
    this.feedback = 'Undo';
  }
  redo(): void {
    if (this.pending || !this.flush() || !this.future.length) return;
    this.past.push(this.draft);
    this.draft = this.future.pop()!;
    this.revision++;
    this.clampSelection();
    this.fields.clear();
    this.fieldValues.clear();
    this.feedback = 'Redo';
  }
  setAsset(asset: BuildingAsset, path: string, error?: { value: string }): boolean {
    return this.setEntry({ asset, path }, error);
  }
  private setEntry(entry: BuildingEditorEntry, error?: { value: string }): boolean {
    try {
      const result = this.stage(this.prepare(entry));
      if (!result && error) error.value = this.feedback;
      return result;
    } catch (problem) {
      this.feedback = problem instanceof Error ? problem.message : String(problem);
      if (error) error.value = this.feedback;
      return false;
    }
  }
  load(path: string): boolean {
    try {
      const text = this.read(path)!;
      const asset = decodeBuildingAsset(readable(text));
      if (this.gameMode) {
        const choice = this.choices.find((c) => c.asset.id === asset.id);
        if (
          !choice ||
          choice.asset.footprint !== asset.footprint ||
          choice.asset.variants.length !== asset.variants.length
        ) {
          this.feedback = 'Game assets must retain a known ID, footprint and variant slots.';
          return false;
        }
      }
      const next: Pending = { asset, path, text, baseline: true };
      if (asset.id === this.draft.id) next.accepted = copy(this.accepted);
      else
        for (const choice of this.choices)
          if (choice.asset.id === asset.id) next.accepted = copy(choice.accepted ?? choice.asset);
      return this.stage(next);
    } catch (error) {
      this.feedback = error instanceof Error ? error.message : String(error);
      return false;
    }
  }
  save(destination = ''): boolean {
    if (!this.flush()) return false;
    const path = destination || this.path;
    if (!path) {
      this.feedback = 'Enter a destination path before saving.';
      return false;
    }
    try {
      validateBuildingAsset(this.draft);
      let baseline = this.baselineText;
      if (!sameBuildingDestination(path, this.path)) baseline = this.read(path, true);
      else if (!this.baseline) {
        this.feedback = 'No disk baseline for this path. Open it first or Save As to a new path.';
        return false;
      }
      if (this.read(path, true) !== baseline) throw new Error('file differs from the supplied baseline');
      const text = formatted(encodeBuildingAsset(this.draft), baseline);
      this.files.stage(path, text, maximumBuildingBytes);
      this.path = path;
      this.baselineText = text;
      this.baseline = true;
      this.saved = copy(this.draft);
      this.rememberChoice();
      this.savedCallback?.(this.document());
      this.pathInput = new TextInput(path, bytes(path));
      this.feedback = 'Saved JSON. Apply publishes the draft separately.';
      return true;
    } catch (error) {
      this.feedback = 'Save failed: ' + (error instanceof Error ? error.message : String(error));
      return false;
    }
  }
  exportTo(path: string): boolean {
    if (!this.flush()) return false;
    if (!path) {
      this.feedback = 'Enter an export destination.';
      return false;
    }
    try {
      validateBuildingAsset(this.draft);
      if (this.files.exists(path)) throw new Error('file differs from the supplied baseline');
      this.files.stage(path, encodeBuildingAsset(this.draft), maximumBuildingBytes);
      this.feedback = 'Exported JSON; draft and active path retained.';
      return true;
    } catch (error) {
      this.feedback = 'Export failed: ' + (error instanceof Error ? error.message : String(error));
      return false;
    }
  }
  apply(callback?: BuildingApply): boolean {
    if (!this.flush()) return false;
    if (this.pending) {
      this.feedback = 'Resolve the pending discard decision first.';
      return false;
    }
    if (this.previewFailed) {
      this.feedback = 'The preview must render successfully before this draft can be applied.';
      return false;
    }
    try {
      validateBuildingAsset(this.draft);
      const error = { value: '' };
      if (callback && !callback(this.draft, error)) {
        this.feedback = error.value || 'The application rejected this asset.';
        return false;
      }
    } catch (error) {
      this.feedback = error instanceof Error ? error.message : String(error);
      return false;
    }
    this.accepted = copy(this.draft);
    this.acceptedRevision++;
    for (const choice of this.choices)
      if (choice.asset.id === this.draft.id) choice.accepted = copy(this.accepted);
    this.rememberChoice();
    this.feedback = callback
      ? 'Draft applied. Save separately to keep the JSON.'
      : 'Draft accepted locally. Save or Export to use it in a project.';
    return true;
  }
  command(id: string, argument = ''): boolean {
    if (id === 'asset.open' || id === 'open' || id === 'reload')
      return this.load(id === 'reload' ? this.path : argument);
    if (id === 'asset.save' || id === 'save') return this.save(argument);
    if (id === 'asset.export' || id === 'export') return this.exportTo(argument);
    if (id === 'apply') return this.apply(this.callback);
    if (id === 'undo') {
      this.undo();
      return true;
    }
    if (id === 'redo') {
      this.redo();
      return true;
    }
    if (id === 'reset') {
      this.fields.clear();
      this.fieldValues.clear();
      return this.edit((asset) => Object.assign(asset, copy(this.saved)));
    }
    if (id === 'close') {
      const valid = this.flush();
      if (!valid || this.unsettled())
        this.pending = { asset: this.draft, path: '', text: null, baseline: false, close: true };
      else this.closeReady = true;
      return true;
    }
    if (id === 'keep') {
      this.pending = undefined;
      return true;
    }
    if (id === 'discard') {
      if (!this.pending) return false;
      if (this.pending.close) {
        this.pending = undefined;
        this.closeReady = true;
      } else this.install(this.pending);
      return true;
    }
    if (this.pending) {
      this.feedback = 'Resolve the pending discard decision first.';
      return false;
    }
    if (!this.flush()) return false;
    if (id === 'variant' || id === 'select.block' || id === 'select.patch' || id === 'asset.choice') {
      const value = buildingNumeric(argument);
      if (value === undefined || value < 0 || Math.floor(value) !== value) return false;
      const count =
        id === 'variant'
          ? this.draft.variants.length
          : id === 'asset.choice'
            ? this.choices.length
            : id === 'select.patch'
              ? this.model().patches.length
              : this.model().blocks.length;
      if (value >= count) return false;
      if (id === 'variant') {
        this.setVariant(value);
        return true;
      }
      if (id === 'asset.choice') return this.setEntry(copy(this.choices[value]));
      this.patch = id === 'select.patch';
      this.selected = value;
      this.fields.clear();
      this.fieldValues.clear();
      return true;
    }
    if (id === 'property') {
      const at = argument.indexOf('=');
      return at >= 0 && this.property(argument.slice(0, at), argument.slice(at + 1));
    }
    if (
      [
        'block.add',
        'patch.add',
        'selection.duplicate',
        'selection.delete',
        'variant.add',
        'variant.delete',
      ].includes(id)
    ) {
      const patch = id === 'patch.add' || (id !== 'block.add' && this.patch),
        index = this.selected;
      const result = this.edit((asset) => {
        if (id === 'variant.add') {
          asset.variants.push(copy(asset.variants[this.variant]));
          return;
        }
        if (id === 'variant.delete') {
          asset.variants.splice(this.variant, 1);
          return;
        }
        const model = asset.variants[this.variant];
        if (id === 'block.add') model.blocks.push(defaultBlock());
        else if (id === 'patch.add') model.patches.push(defaultPatch());
        else if (patch) {
          if (id === 'selection.delete') model.patches.splice(index, 1);
          else model.patches.push(copy(model.patches[index]));
        } else {
          if (id === 'selection.delete') model.blocks.splice(index, 1);
          else model.blocks.push(copy(model.blocks[index]));
        }
      });
      if (result && (id.endsWith('.add') || id === 'selection.duplicate')) {
        if (id === 'variant.add') this.setVariant(this.draft.variants.length - 1);
        else {
          this.patch = patch;
          this.selected = (patch ? this.model().patches.length : this.model().blocks.length) - 1;
        }
      }
      return result;
    }
    return false;
  }
  wheel(delta: number): void {
    this.scroll = clamp(
      f(this.scroll - f(delta * 32)),
      0,
      Math.max(0, f(this.contentHeight - this.inspectorHeight)),
    );
  }
}

// Literal native Building Studio layout and interaction translation.
import type { Animation } from '@thorvg/webcanvas';
import { f32, clamp } from '../../engine/src/numeric';
import { point } from '../../engine/src/geometry';
import {
  Context,
  Rect,
  Key,
  EventType,
  Icon,
  ButtonStyle,
  Align,
  TextInput,
  button as uiButton,
  textField,
  setTransform,
  rgba,
  type Appearance,
  type Color,
} from '../../native-ui/src';
import { BuildingProjection } from '../../native-renderer/src/building-model';
import {
  buildingStillAnimation,
  buildingRiseAnimation,
  type RiseAnimation,
  type BuildingStage,
} from '../../native-renderer/src/building-animation';
import type { BuildingAsset } from '../../native-renderer/src/building-asset';
import {
  BuildingDocument,
  buildingNumber as number,
  buildingNumeric as numeric,
  type BuildingDocumentFiles,
  type BuildingEditorEntry,
  type BuildingApply,
} from './building-document';
const pi = f32(Math.PI);
const box = (x: number, y: number, w: number, h: number) => new Rect(x, y, w, h);
const addDouble = (a: number, b: number) => a + b;
const elapsedDouble = (now: number, previous: number) =>
  previous < 0 ? 0 : Math.max(0, Math.min(0.25, now - previous));
export class BuildingEditor {
  readonly state: BuildingDocument;
  private animation: Animation | undefined;
  private layout: RiseAnimation = {
    json: '',
    width: 0,
    height: 0,
    originX: 0,
    originY: 0,
    frames: 0,
    frameRate: 0,
  };
  private context: Context | undefined;
  constructor(entry: BuildingEditorEntry, files: BuildingDocumentFiles) {
    this.state = new BuildingDocument(entry, files);
  }
  document(): BuildingEditorEntry {
    return this.state.document();
  }
  current(): BuildingAsset {
    return this.state.draft;
  }
  onSaved(callback: (entry: BuildingEditorEntry) => void): void {
    this.state.savedCallback = callback;
  }
  setChoices(choices: BuildingEditorEntry[]): void {
    this.state.setChoices(choices);
  }
  setGameMode(value: boolean): void {
    this.state.gameMode = value;
  }
  setVariant(value: number): void {
    this.state.setVariant(value);
  }
  setAsset(
    asset: BuildingAsset,
    path: string,
    error?: {
      value: string;
    },
  ): boolean {
    return this.state.setAsset(asset, path, error);
  }
  changed(): boolean {
    return this.state.dirty();
  }
  animating(): boolean {
    return this.state.playing && !this.state.pending;
  }
  pendingDiscard(): boolean {
    return !!this.state.pending;
  }
  message(): string {
    return this.state.feedback;
  }
  load(path: string): boolean {
    return this.state.load(path);
  }
  save(path = ''): boolean {
    return this.state.save(path);
  }
  exportTo(path: string): boolean {
    return this.state.exportTo(path);
  }
  command(id: string, argument = ''): boolean {
    return this.state.command(id, argument);
  }
  apply(callback?: BuildingApply): boolean {
    return this.state.apply(callback);
  }
  undo(): void {
    this.state.undo();
  }
  redo(): void {
    this.state.redo();
  }
  wheel(delta: number): void {
    this.state.wheel(delta);
  }
  textFocused(context: Context): boolean {
    return context.focused().startsWith('building/field/') || context.focused() === 'building/path';
  }
  key(context: Context, key: Key, _primary = false, shift = false): void {
    const s = this.state;
    if (s.pending && key !== Key.Escape) {
      context.key(key, shift);
      return;
    }
    if (key === Key.Escape && s.picker) {
      s.picker = 0;
      return;
    }
    if (key === Key.Escape) {
      this.command(s.pending ? 'keep' : 'close');
      return;
    }
    if (key === Key.Delete && !this.textFocused(context)) {
      this.command('selection.delete');
      return;
    }
    context.key(key, shift);
  }
  private release(animation: Animation): void {
    if (this.context && !this.context.scene().isDisposed)
      this.context.deferRelease(() => animation.dispose());
    else animation.dispose();
  }
  dispose(): void {
    if (this.animation) {
      this.release(this.animation);
      this.animation = undefined;
    }
  }
  render(context: Context, bounds: Rect, applyCallback: BuildingApply | undefined, close: () => void): void {
    this.context = context;
    const s = this.state;
    s.callback = applyCallback;
    if (s.closeReady) {
      s.closeReady = false;
      close();
      return;
    }
    const theme = context.theme(),
      compact: Appearance = { radius: 2, fontSize: 12, border: { token: 'border' }, focusRing: true };
    const button = (
      id: string,
      rect: Rect,
      label: string,
      action: () => void,
      enabled = true,
      active = false,
    ) => {
      uiButton(
        context,
        'building/' + id,
        rect,
        label,
        () => {
          if (['close', 'keep', 'discard', 'reset', 'picker-close'].includes(id) || s.flush()) action();
        },
        ButtonStyle.Quiet,
        enabled,
        Icon.None,
        active,
        compact,
      );
    };
    const action = (id: string, rect: Rect, label: string, enabled = true) =>
      button(
        id,
        rect,
        label,
        () => {
          this.command(id);
        },
        enabled,
      );
    const x = bounds.x,
      y = bounds.y,
      w = bounds.w,
      h = bounds.h;
    if (s.pending) {
      if (context.focused() !== 'building/keep' && context.focused() !== 'building/discard')
        context.focus('building/keep');
      context.rect(bounds, rgba(theme.background.r, theme.background.g, theme.background.b, 232));
      context.control('building/discard-barrier', bounds, () => {}, true, false);
      const dialogW = Math.min(440, f32(w - 24)),
        dialogX = f32(x + f32(f32(w - dialogW) / 2)),
        dialogY = f32(f32(y + f32(h / 2)) - 68);
      context.rect(box(dialogX, dialogY, dialogW, 136), theme.surface, 2, theme.border);
      context.text(
        box(f32(dialogX + 16), f32(dialogY + 12), f32(dialogW - 32), 28),
        'Discard draft changes?',
        theme.text,
        15,
        true,
      );
      context.text(
        box(f32(dialogX + 16), f32(dialogY + 44), f32(dialogW - 32), 24),
        'Saved JSON and published assets stay unchanged.',
        theme.muted,
        11,
      );
      button('discard', box(f32(dialogX + 16), f32(dialogY + 90), 104, 28), 'Discard', () => {
        this.command('discard');
      });
      button(
        'keep',
        box(f32(f32(dialogX + dialogW) - 136), f32(dialogY + 90), 120, 28),
        'Keep Editing',
        () => {
          this.command('keep');
        },
      );
      return;
    }
    if (s.picker) {
      context.rect(bounds, theme.background);
      context.text(
        box(f32(x + 16), f32(y + 10), f32(w - 112), 28),
        s.picker === 1 ? 'Building catalog' : 'Choose variant',
        theme.text,
        15,
        true,
      );
      button('picker-close', box(f32(f32(x + w) - 88), f32(y + 10), 72, 28), 'Return', () => {
        s.picker = 0;
      });
      context.rect(box(x, f32(y + 47), w, 1), theme.border);
      const items = box(f32(x + 12), f32(y + 58), Math.max(0, f32(w - 24)), Math.max(0, f32(h - 74))),
        columns = w >= 900 ? 3 : w >= 600 ? 2 : 1,
        count = s.picker === 1 ? s.choices.length : s.draft.variants.length;
      const rowHeight = 40,
        cellWidth = f32(f32(items.w - f32(f32(columns - 1) * 8)) / columns),
        content = f32(Math.trunc(f32(f32(f32(count + columns) - 1) / columns)) * rowHeight);
      s.pickerScroll = clamp(s.pickerScroll, 0, Math.max(0, f32(content - items.h)));
      context.control(
        'building/picker-scroll',
        items,
        (event) => {
          if (event.type === EventType.Scroll) s.pickerScroll = f32(s.pickerScroll - f32(event.y * 40));
        },
        true,
        false,
        true,
      );
      context.clip(items, () => {
        for (let i = 0; i < count; i++) {
          const assets = s.picker === 1,
            label = assets ? s.choices[i].asset.name : 'Variant ' + f32(i + 1),
            active = assets ? s.choices[i].asset.id === s.draft.id : i === s.variant;
          button(
            'picker-' + i,
            box(
              f32(items.x + f32((i % columns) * f32(cellWidth + 8))),
              f32(f32(items.y + f32(Math.trunc(f32(i / columns)) * rowHeight)) - s.pickerScroll),
              cellWidth,
              32,
            ),
            label,
            () => {
              s.picker = 0;
              this.command(assets ? 'asset.choice' : 'variant', String(i));
            },
            true,
            active,
          );
        }
      });
      return;
    }
    const narrow = w < 860;
    context.rect(bounds, theme.background);
    context.rect(box(x, y, w, 40), theme.surface);
    context.text(
      box(f32(x + 12), f32(y + 5), Math.max(0, f32(w - 260)), 28),
      w < 480 ? 'Buildings' : 'Building Studio',
      theme.text,
      14,
      true,
    );
    action('undo', box(f32(f32(x + w) - 244), f32(y + 6), 54, 28), 'Undo', !!s.past.length);
    action('redo', box(f32(f32(x + w) - 184), f32(y + 6), 54, 28), 'Redo', !!s.future.length);
    action('reset', box(f32(f32(x + w) - 124), f32(y + 6), 54, 28), 'Reset', s.dirty());
    action('close', box(f32(f32(x + w) - 64), f32(y + 6), 52, 28), 'Close');
    context.rect(box(x, f32(y + 39), w, 1), theme.border);
    const variantWidth = narrow ? 124 : 168,
      assetWidth = Math.max(40, f32(f32(f32(w - 30) - variantWidth) - (s.gameMode ? 0 : 64)));
    if (s.choices.length)
      button('asset', box(f32(x + 12), f32(y + 46), assetWidth, 28), s.draft.name + '  ▾', () => {
        s.picker = 1;
        s.pickerScroll = 0;
        s.playing = false;
      });
    else
      context.text(
        box(f32(x + 12), f32(y + 46), assetWidth, 28),
        context.elideText(s.draft.name, assetWidth, 12),
        theme.text,
        12,
        true,
      );
    const variantX = f32(f32(x + 18) + assetWidth);
    button(
      'variant',
      box(variantX, f32(y + 46), variantWidth, 28),
      'Variant ' + f32(s.variant + 1) + ' / ' + s.draft.variants.length + '  ▸',
      () => {
        s.picker = 2;
        s.pickerScroll = 0;
        s.playing = false;
      },
    );
    if (!s.gameMode) {
      action(
        'variant.add',
        box(f32(f32(variantX + variantWidth) + 6), f32(y + 46), 26, 28),
        '+',
        s.draft.variants.length < 32,
      );
      action(
        'variant.delete',
        box(f32(f32(variantX + variantWidth) + 36), f32(y + 46), 26, 28),
        '−',
        s.draft.variants.length > 1,
      );
    }
    let bodyY = f32(y + 84),
      bodyH = Math.max(0, f32(h - 164));
    if (narrow) {
      const width = f32(f32(w - 32) / 3),
        names = ['Preview', 'Primitives', 'Properties'];
      for (let i = 0; i < 3; i++)
        button(
          'panel' + i,
          box(f32(f32(x + 12) + f32(i * f32(width + 4))), bodyY, width, 28),
          names[i],
          () => {
            s.narrowPanel = i;
            if (i !== 0) s.playing = false;
          },
          true,
          s.narrowPanel === i,
        );
      bodyY = f32(bodyY + 36);
      bodyH = Math.max(0, f32(bodyH - 36));
    }
    const listW = narrow ? w : 178,
      inspectW = narrow ? w : 292,
      list = box(x, bodyY, listW, bodyH),
      inspect = box(narrow ? x : f32(f32(x + w) - inspectW), bodyY, inspectW, bodyH),
      preview = box(
        narrow ? x : f32(f32(x + listW) + 1),
        bodyY,
        narrow ? w : f32(f32(f32(w - listW) - inspectW) - 2),
        bodyH,
      );
    if (!narrow || s.narrowPanel === 1) {
      context.rect(list, theme.surface);
      context.text(box(f32(list.x + 12), list.y, f32(list.w - 24), 26), 'PRIMITIVES', theme.muted, 11, true);
      const half = f32(f32(list.w - 28) / 2);
      action(
        'block.add',
        box(f32(list.x + 12), f32(list.y + 28), half, 28),
        '+ Block',
        s.model().blocks.length < 64,
      );
      action(
        'patch.add',
        box(f32(f32(list.x + 16) + half), f32(list.y + 28), half, 28),
        '+ Patch',
        s.model().patches.length < 32,
      );
      const items = box(list.x, f32(list.y + 64), list.w, Math.max(0, f32(list.h - 102))),
        total = f32(f32(s.model().blocks.length + s.model().patches.length) * 32);
      s.listScroll = clamp(s.listScroll, 0, Math.max(0, f32(total - items.h)));
      context.control(
        'building/list',
        items,
        (event) => {
          if (event.type === EventType.Scroll) s.listScroll = f32(s.listScroll - f32(event.y * 32));
        },
        true,
        false,
        true,
      );
      context.clip(items, () => {
        let row = f32(items.y - s.listScroll);
        const primitives = (patches: boolean, count: number) => {
          for (let i = 0; i < count; i++) {
            const id = patches ? 'select.patch' : 'select.block';
            button(
              id + i,
              box(f32(list.x + 12), row, f32(list.w - 24), 28),
              (patches ? 'Patch ' : 'Block ') + f32(i + 1),
              () => {
                this.command(id, String(i));
              },
              true,
              s.patch === patches && s.selected === i,
            );
            row = f32(row + 32);
          }
        };
        primitives(false, s.model().blocks.length);
        primitives(true, s.model().patches.length);
      });
      action('selection.duplicate', box(f32(list.x + 12), f32(f32(list.y + list.h) - 32), half, 28), 'Copy');
      action(
        'selection.delete',
        box(f32(f32(list.x + 16) + half), f32(f32(list.y + list.h) - 32), half, 28),
        'Delete',
        f32(s.model().blocks.length + s.model().patches.length) > 1,
      );
    }
    if (!narrow || s.narrowPanel === 2) {
      context.rect(inspect, theme.surface);
      const names = ['Geometry', 'Details', 'Colors'],
        tabW = f32(f32(inspect.w - 24) / 3);
      for (let i = 0; i < 3; i++)
        button(
          'tab' + i,
          box(f32(f32(inspect.x + 12) + f32(i * tabW)), inspect.y, tabW, 28),
          names[i],
          () => {
            s.tab = i;
            s.scroll = 0;
          },
          true,
          s.tab === i,
        );
      const area = box(inspect.x, f32(inspect.y + 36), inspect.w, Math.max(0, f32(inspect.h - 36)));
      s.inspectorHeight = area.h;
      s.scroll = clamp(s.scroll, 0, Math.max(0, f32(s.contentHeight - area.h)));
      context.control(
        'building/inspector',
        area,
        (event) => {
          if (event.type === EventType.Scroll) this.wheel(event.y);
        },
        true,
        false,
        true,
      );
      let row = f32(area.y - s.scroll);
      context.clip(area, () => {
        const field = (key: string, label: string, value: string, enabled: boolean, step = 0) => {
          const id = 'building/field/' + key;
          let input = s.fields.get(key);
          if (!input) {
            input = new TextInput();
            s.fields.set(key, input);
          }
          const previous = s.fieldValues.get(key);
          if (previous === undefined) {
            input.value = value;
            input.cursor = new TextEncoder().encode(value).length;
            s.fieldValues.set(key, value);
          } else if (input.value === previous) {
            if (input.value !== value) {
              input.value = value;
              input.cursor = Math.min(input.cursor, new TextEncoder().encode(value).length);
            }
            s.fieldValues.set(key, value);
          }
          const start = f32(f32(inspect.x + inspect.w) - 150);
          context.text(box(f32(inspect.x + 12), row, f32(inspect.w - 170), 28), label, theme.text, 12);
          textField(
            context,
            id,
            box(f32(start + (step ? 25 : 0)), row, step ? 86 : 138, 28),
            input,
            label,
            enabled,
            (keyEvent) => {
              if (keyEvent !== Key.Enter) return false;
              const ok = s.flush();
              if (ok) context.focus('');
              return true;
            },
            Icon.None,
            compact,
          );
          if (step) {
            const change = (delta: number) => {
              const current = numeric(s.fields.get(key)?.value ?? value);
              if (current !== undefined) s.property(key, number(addDouble(current, delta)));
            };
            button('minus/' + key, box(start, row, 23, 28), '−', () => change(-step), enabled);
            button('plus/' + key, box(f32(start + 113), row, 25, 28), '+', () => change(step), enabled);
          }
          row = f32(row + 34);
        };
        const numericField = (key: string, label: string, value: number, step = 1, enabled = true) =>
          field(key, label, number(value), enabled, step);
        const choice = (key: string, label: string, value: number, labels: string[]) => {
          context.text(box(f32(inspect.x + 12), row, f32(inspect.w - 170), 28), label, theme.text, 12);
          button(
            'choice/' + key,
            box(f32(f32(inspect.x + inspect.w) - 150), row, 138, 28),
            labels[value] + '  ▸',
            () => {
              s.property(key, String(f32(value + 1) % labels.length));
            },
          );
          row = f32(row + 34);
        };
        const color = (key: string, label: string, rgb: readonly [number, number, number]) => {
          context.rect(
            box(f32(inspect.x + 12), f32(row + 6), 16, 16),
            rgba(rgb[0], rgb[1], rgb[2]),
            2,
            theme.border,
          );
          context.text(box(f32(inspect.x + 36), row, f32(inspect.w - 48), 28), label, theme.muted, 12, true);
          row = f32(row + 30);
          numericField(key + '.r', 'Red', rgb[0]);
          numericField(key + '.g', 'Green', rgb[1]);
          numericField(key + '.b', 'Blue', rgb[2]);
          row = f32(row + 6);
        };
        if (s.tab === 0) {
          field('name', 'Asset name', s.draft.name, true);
          field('id', 'Asset ID', s.draft.id, !s.gameMode);
          numericField('footprint', 'Footprint', s.draft.footprint, f32(0.25), !s.gameMode);
          const p = s.patch ? s.model().patches[s.selected] : s.model().blocks[s.selected];
          numericField('x0', 'Left X', p.x0, 0.05);
          numericField('y0', 'Back Y', p.y0, 0.05);
          numericField('x1', 'Right X', p.x1, 0.05);
          numericField('y1', 'Front Y', p.y1, 0.05);
          if (!s.patch) {
            const b = s.model().blocks[s.selected];
            numericField('base', 'Base height', b.base);
            numericField('wall', 'Wall height', b.wall);
            numericField('roof', 'Roof height', b.roof);
            choice('shape', 'Roof', b.shape, ['Flat', 'Gable X', 'Gable Y', 'Pyramid']);
          }
        } else if (s.tab === 1) {
          if (s.patch) {
            const p = s.model().patches[s.selected];
            numericField('furrows', 'Furrows', p.furrows);
            numericField('delay', 'Delay / frames', p.delay);
          } else {
            const b = s.model().blocks[s.selected];
            numericField('delay', 'Delay / frames', b.delay);
            numericField('windows', 'Windows', b.windows);
            choice('door', 'Door', Number(b.door), ['No', 'Yes']);
            choice('trim', 'Trim', b.trim, ['None', 'Timber', 'Crenels', 'Stakes']);
            choice('ornament', 'Ornament', b.ornament, ['None', 'Banner', 'Crystal']);
          }
        } else if (s.patch) {
          const p = s.model().patches[s.selected];
          color('color', 'Ground', p.color);
          color('furrow', 'Furrows', p.furrow);
        } else {
          const b = s.model().blocks[s.selected];
          color('wallLit', 'Wall / light', b.wallLit);
          color('wallShade', 'Wall / shade', b.wallShade);
          color('roofLit', 'Roof / light', b.roofLit);
          color('roofShade', 'Roof / shade', b.roofShade);
          color('glass', 'Window glass', b.glass);
          color('accent', 'Accent', b.accent);
        }
      });
      s.contentHeight = f32(f32(row + s.scroll) - area.y);
      if (s.contentHeight > area.h && area.h > 0) {
        const thumb = Math.max(20, f32(f32(area.h * area.h) / s.contentHeight));
        context.rect(box(f32(f32(area.x + area.w) - 4), area.y, 2, area.h), theme.border);
        context.rect(
          box(
            f32(f32(area.x + area.w) - 4),
            f32(area.y + f32(f32(f32(area.h - thumb) * s.scroll) / f32(s.contentHeight - area.h))),
            2,
            thumb,
          ),
          theme.muted,
          1,
        );
      }
    }
    if (!narrow) {
      context.rect(box(f32(list.x + list.w), bodyY, 1, bodyH), theme.border);
      context.rect(box(f32(inspect.x - 1), bodyY, 1, bodyH), theme.border);
    }
    if ((!narrow || s.narrowPanel === 0) && preview.w > 0 && preview.h > 100) {
      context.rect(preview, theme.background);
      const controlW = f32(f32(preview.w - 32) / 3),
        names = ['Still', 'Construction', 'Upgrade'];
      for (let i = 0; i < 3; i++)
        button(
          'mode' + i,
          box(f32(f32(preview.x + 12) + f32(i * f32(controlW + 4))), preview.y, controlW, 28),
          names[i],
          () => {
            s.mode = i;
            s.frame = 0;
            s.playing = i !== 0;
          },
          true,
          s.mode === i,
        );
      const art = box(
        f32(preview.x + 12),
        f32(preview.y + 38),
        f32(preview.w - 24),
        Math.max(1, f32(preview.h - 154)),
      );
      let key = String(s.revision) + ':' + s.variant + ':' + number(s.angle) + ':' + s.mode;
      if (s.mode === 2) key += ':' + s.acceptedRevision;
      if (key !== s.animationKey) {
        try {
          const old: BuildingStage[] = [];
          if (s.mode === 2)
            old.push({
              model: s.accepted.variants[Math.min(s.variant, f32(s.accepted.variants.length - 1))],
              footprint: s.accepted.footprint,
              dx: 0,
              dy: 0,
            });
          const layout =
              s.mode === 0
                ? buildingStillAnimation(s.model(), s.draft.footprint, s.angle)
                : buildingRiseAnimation(s.model(), s.draft.footprint, old, s.angle),
            animation = new context.tvg.Animation();
          try {
            animation.load(layout.json);
            if (!animation.picture) throw new Error('Could not load the building preview.');
          } catch (error) {
            animation.dispose();
            throw error;
          }
          if (this.animation) this.release(this.animation);
          this.animation = animation;
          this.layout = layout;
          this.layout.json = '';
          if (s.previewFailed) s.feedback = 'Preview updated. Save or Apply the draft.';
          s.previewFailed = false;
        } catch (error) {
          s.feedback =
            'Could not render the building preview: ' +
            (error instanceof Error ? error.message : String(error));
          s.previewFailed = true;
          s.playing = false;
        }
        s.animationKey = key;
      }
      const now = context.time(),
        elapsed = elapsedDouble(now, s.previous);
      s.previous = now;
      if (s.playing && s.mode !== 0) {
        s.frame = f32(s.frame + f32(elapsed * this.layout.frameRate));
        if (s.frame >= f32(this.layout.frames - 1)) {
          s.frame = Math.max(0, f32(this.layout.frames - 1));
          s.playing = false;
        }
      }
      if (this.animation) {
        const scale = f32(
            f32(
              Math.min(
                f32(art.w / Math.max(1, this.layout.width)),
                f32(art.h / Math.max(1, this.layout.height)),
              ) * f32(0.88),
            ) * s.zoom,
          ),
          tx = f32(art.x + f32(f32(art.w - f32(this.layout.width * scale)) / 2)),
          ty = f32(art.y + f32(f32(art.h - f32(this.layout.height * scale)) / 2));
        this.animation.frame(
          s.mode === 0
            ? Math.max(0, f32(this.layout.frames - 1))
            : clamp(s.frame, 0, Math.max(0, f32(this.layout.frames - 1))),
        );
        context.clip(art, () => {
          const picture = this.animation?.picture;
          if (!picture) return;
          context.add(picture);
          setTransform(picture, {
            e11: scale,
            e12: 0,
            e13: tx,
            e21: 0,
            e22: scale,
            e23: ty,
            e31: 0,
            e32: 0,
            e33: 1,
          });
          const project = (px: number, py: number, z: number) => {
            const center = f32(s.draft.footprint / 2),
              a = f32(px - center),
              b = f32(py - center),
              rx = f32(f32(center + f32(a * f32(Math.cos(s.angle)))) - f32(b * f32(Math.sin(s.angle)))),
              ry = f32(f32(center + f32(a * f32(Math.sin(s.angle)))) + f32(b * f32(Math.cos(s.angle)))),
              p = new BuildingProjection().project(rx, ry, z);
            return point(
              f32(tx + f32(f32(p.x + this.layout.originX) * scale)),
              f32(ty + f32(f32(p.y + this.layout.originY) * scale)),
            );
          };
          const outline = (x0: number, y0: number, x1: number, y1: number, z: number, color: Color) => {
            const p = [project(x0, y0, z), project(x1, y0, z), project(x1, y1, z), project(x0, y1, z)];
            for (let i = 0; i < 4; i++)
              context.line(p[i].x, p[i].y, p[f32(i + 1) % 4].x, p[f32(i + 1) % 4].y, color, 1);
          };
          outline(0, 0, s.draft.footprint, s.draft.footprint, 0, theme.muted);
          if (s.patch) {
            const p = s.model().patches[s.selected];
            outline(p.x0, p.y0, p.x1, p.y1, 0, theme.accent);
          } else {
            const b = s.model().blocks[s.selected];
            outline(b.x0, b.y0, b.x1, b.y1, f32(b.base + b.wall), theme.accent);
          }
        });
      }
      const row = f32(f32(preview.y + preview.h) - 108),
        q = f32(f32(preview.w - 36) / 4);
      button('rotate-left', box(f32(preview.x + 12), row, q, 28), '−90°', () => {
        s.angle = f32(s.angle - f32(pi / 2));
      });
      button('rotate-right', box(f32(f32(preview.x + 16) + q), row, q, 28), '+90°', () => {
        s.angle = f32(s.angle + f32(pi / 2));
      });
      button('zoom', box(f32(f32(preview.x + 20) + f32(q * 2)), row, q, 28), 'Zoom +', () => {
        s.zoom = Math.min(4, f32(s.zoom * f32(1.25)));
      });
      button('fit', box(f32(f32(preview.x + 24) + f32(q * 3)), row, q, 28), 'Fit', () => {
        s.zoom = 1;
      });
      const rotation = box(f32(preview.x + 12), f32(row + 36), f32(preview.w - 24), 20);
      context.rect(rotation, theme.surface, 2, theme.border);
      context.text(
        rotation,
        'Angle ' + number(f32(f32(s.angle * 180) / pi)) + '°  ·  drag',
        theme.muted,
        11,
        false,
        Align.Center,
      );
      context.control(
        'building/rotation',
        rotation,
        (event) => {
          if (event.type === EventType.Press || event.type === EventType.Drag)
            s.angle = f32(f32(f32(clamp(f32(f32(event.x - rotation.x) / rotation.w), 0, 1) * 2) - 1) * pi);
        },
        true,
        false,
        false,
        true,
      );
      button('play', box(f32(preview.x + 12), f32(row + 64), 64, 28), s.playing ? 'Pause' : 'Play', () => {
        if (s.mode === 0) s.mode = 1;
        if (s.frame >= f32(this.layout.frames - 1)) s.frame = 0;
        s.playing = !s.playing;
      });
      button('restart', box(f32(preview.x + 80), f32(row + 64), 64, 28), 'Restart', () => {
        if (s.mode === 0) s.mode = 1;
        s.frame = 0;
        s.playing = true;
      });
      const scrub = box(f32(preview.x + 152), f32(row + 68), Math.max(0, f32(preview.w - 164)), 20);
      context.rect(scrub, theme.surface, 2, theme.border);
      const progress = s.mode === 0 ? 1 : f32(s.frame / Math.max(1, f32(this.layout.frames - 1)));
      context.rect(
        box(scrub.x, scrub.y, f32(scrub.w * progress), scrub.h),
        rgba(theme.accent.r, theme.accent.g, theme.accent.b, 75),
        2,
      );
      context.text(
        scrub,
        'Frame ' + Math.trunc(s.mode === 0 ? f32(this.layout.frames - 1) : s.frame),
        theme.text,
        11,
        false,
        Align.Center,
      );
      context.control(
        'building/scrub',
        scrub,
        (event) => {
          if ((event.type === EventType.Press || event.type === EventType.Drag) && scrub.w > 0) {
            if (s.mode === 0) s.mode = 1;
            s.playing = false;
            s.frame = f32(
              clamp(f32(f32(event.x - scrub.x) / scrub.w), 0, 1) * Math.max(0, f32(this.layout.frames - 1)),
            );
          }
        },
        true,
        false,
        false,
        true,
      );
    }
    const footer = f32(f32(y + h) - 72);
    context.rect(box(x, f32(footer - 8), w, 80), theme.surface);
    context.rect(box(x, f32(footer - 8), w, 1), theme.border);
    textField(
      context,
      'building/path',
      box(f32(x + 12), footer, Math.max(0, f32(w - 256)), 28),
      s.pathInput,
      'JSON file path',
      true,
      undefined,
      Icon.None,
      compact,
    );
    button('open', box(f32(f32(x + w) - 238), footer, 66, 28), 'Open', () => {
      this.load(s.pathInput.value);
    });
    button('save', box(f32(f32(x + w) - 168), footer, 64, 28), 'Save', () => {
      this.save(s.pathInput.value);
    });
    button('apply', box(f32(f32(x + w) - 100), footer, 88, 28), applyCallback ? 'Apply' : 'Accept', () => {
      this.apply(s.callback);
    });
    button(
      'reload',
      box(f32(x + 12), f32(footer + 34), 64, 28),
      'Reload',
      () => {
        this.command('reload');
      },
      !!s.path,
    );
    button('export', box(f32(x + 80), f32(footer + 34), 64, 28), 'Export', () => {
      this.exportTo(s.pathInput.value);
    });
    const status = (s.dirty() ? '● ' : '') + s.feedback;
    context.text(
      box(f32(x + 156), f32(footer + 34), Math.max(0, f32(w - 168)), 28),
      context.elideText(status, Math.max(0, f32(w - 168)), 11),
      theme.muted,
      11,
    );
  }
}
export type {
  BuildingDocumentFiles,
  BuildingEditorEntry,
  BuildingEditorSource,
  BuildingApply,
} from './building-document';

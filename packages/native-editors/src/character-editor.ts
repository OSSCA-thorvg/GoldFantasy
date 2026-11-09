import type { Paint } from '@thorvg/webcanvas';
import {
  BodyType,
  FaceShape,
  Person,
  PortraitEyeForm,
  applyCharacter,
  appearanceOf,
  baldHairAsset,
  characterAssetGender,
  characterAssetGroup,
  characterAssetReady,
  characterOutfitReady,
  characterPreset,
  clamp,
  decodeCharacter,
  encodeCharacter,
  eyeAssetName,
  eyeReferenceCount,
  faceBaseCount,
  faceBaseName,
  f32 as f,
  hairAssetCount,
  hairAssetName,
  maxPresetBytes,
  outfitAssetCount,
  outfitAssetName,
  randomCharacterReference,
  refreshShades,
  resolveCharacterAssets,
  safeCharacterOutfitAsset,
  useCharacterReference,
  validCharacter,
  type Appearance,
  type CharacterPreset,
  type Point,
  type Rgb,
} from '../../engine/src';
import { copyNative } from '../../engine/src/native-copy';
import { Align, ButtonStyle, Context, Icon, Rect, TextInput, rgba, textField } from '../../native-ui/src';
import { characterButton, characterChoice, characterColor, characterSlider } from './character-controls';
import { utf8Bytes, type DocumentFiles } from './documents';

export interface PortraitBackdrop {
  ground: Rgb;
  left: Rgb;
  right: Rgb;
  distant: Rgb;
}
export interface CharacterPlacement {
  scale: number;
  origin: Point;
}
export interface CharacterPreviewRenderer {
  backdrop(): PortraitBackdrop;
  portrait(person: Person, width: number, height: number, backdrop: PortraitBackdrop): Paint;
  background(backdrop: PortraitBackdrop, width: number, height: number): Paint;
  figure(look: Appearance): Paint;
  figurePlacement(look: Appearance, width: number, height: number): CharacterPlacement;
  portraitPlacement(look: Appearance, width: number, height: number): CharacterPlacement;
  hairFitAnchors(look: Appearance): readonly { source: Point; target: Point }[];
}
type FloatKey = { [K in keyof Appearance]: Appearance[K] extends number ? K : never }[keyof Appearance];
type BoolKey = { [K in keyof Appearance]: Appearance[K] extends boolean ? K : never }[keyof Appearance];
function setFloat<K extends FloatKey>(look: Appearance, member: K, value: Appearance[K]): void {
  look[member] = value;
}
const categories = ['Character', 'Face', 'Eyes & mouth', 'Hair', 'Outfit', 'Colors'];

/** Native authoring UI and state history; no DOM controls or redesigned layouts. */
export class CharacterEditor {
  private readonly original: Person;
  private preset: CharacterPreset;
  private name: TextInput;
  private path: TextInput;
  private past: CharacterPreset[] = [];
  private future: CharacterPreset[] = [];
  private backdrop: PortraitBackdrop;
  private showFitGuides = false;
  private category = 0;
  private colorTarget = 0;
  private faceRegion = 0;
  private eyeRegion = 0;
  private hairGroup = 0;
  private referenceGroup = 0;
  private genderFilter = 0;
  private compare = false;
  private failed = false;
  private feedback = '';
  constructor(
    person: Person,
    private readonly renderer: CharacterPreviewRenderer,
    private readonly files: DocumentFiles,
    directory = 'characters',
  ) {
    this.original = copyNative(person);
    this.preset = characterPreset(person);
    this.name = new TextInput(this.preset.name, utf8Bytes(this.preset.name));
    this.hairGroup = this.referenceGroup = characterAssetGroup(this.preset.look.hairAsset);
    const filename = directory.replace(/\/$/, '') + '/character-' + person.id + '.character';
    this.path = new TextInput(filename, utf8Bytes(filename));
    this.backdrop = renderer.backdrop();
  }
  current(): CharacterPreset {
    const value = structuredClone(this.preset);
    value.name = this.name.value;
    return value;
  }
  changed(): boolean {
    return encodeCharacter(this.current()) !== encodeCharacter(characterPreset(this.original));
  }
  personId(): number {
    return this.original.id;
  }
  message(): string {
    return this.feedback;
  }
  setBackdrop(value: PortraitBackdrop): void {
    this.backdrop = structuredClone(value);
  }
  setPresetPath(value: string): void {
    this.path = new TextInput(value, utf8Bytes(value));
  }
  private remember(): void {
    const value = this.current();
    if (!this.past.length || encodeCharacter(this.past[this.past.length - 1]) !== encodeCharacter(value))
      this.past.push(value);
    if (this.past.length > 64) this.past.shift();
    this.future = [];
    this.feedback = '';
  }
  private restore(value: CharacterPreset): void {
    this.preset = structuredClone(value);
    resolveCharacterAssets(this.preset.look);
    this.name = new TextInput(value.name, utf8Bytes(value.name));
    this.hairGroup = this.referenceGroup = characterAssetGroup(this.preset.look.hairAsset);
  }
  setPreset(value: CharacterPreset): void {
    if (!validCharacter(value)) return;
    this.remember();
    this.restore(value);
  }
  private regenerate(): void {
    const a = this.preset.look,
      ref = randomCharacterReference(this.preset.seed, a.bodyType);
    useCharacterReference(a, ref);
    this.hairGroup = this.referenceGroup = characterAssetGroup(ref);
    a.seed = this.preset.seed;
  }
  randomize(): void {
    this.remember();
    this.preset.seed = (Math.imul(this.preset.seed, 1664525) + 1013904223) >>> 0;
    this.regenerate();
  }
  reset(): void {
    this.remember();
    this.restore(characterPreset(this.original));
  }
  undo(): void {
    if (!this.past.length) return;
    this.future.push(this.current());
    this.restore(this.past.pop()!);
    this.feedback = '';
  }
  redo(): void {
    if (!this.future.length) return;
    this.past.push(this.current());
    this.restore(this.future.pop()!);
    this.feedback = '';
  }
  async save(): Promise<boolean> {
    try {
      const current = this.current();
      if (!validCharacter(current)) throw new Error('Enter a name of 1 to 96 bytes.');
      if (!this.path.value) throw new Error('Enter a preset file path.');
      await this.files.write(this.path.value, encodeCharacter(current), maxPresetBytes);
      this.failed = false;
      this.feedback = 'Preset saved.';
      return true;
    } catch (error) {
      this.failed = true;
      this.feedback = error instanceof Error ? error.message : String(error);
      return false;
    }
  }
  async load(): Promise<boolean> {
    try {
      const value = decodeCharacter(await this.files.read(this.path.value, maxPresetBytes));
      this.failed = false;
      this.setPreset(value);
      this.feedback = 'Preset loaded. Apply to use it in the game.';
      return true;
    } catch (error) {
      this.failed = true;
      this.feedback = error instanceof Error ? error.message : String(error);
      return false;
    }
  }
  private previews(c: Context, r: Rect): void {
    const t = c.theme(),
      person = copyNative(this.original);
    if (!this.compare) applyCharacter(person, this.current());
    const look = appearanceOf(person),
      key = encodeCharacter(characterPreset(person)) + JSON.stringify(this.backdrop);
    c.rect(r, t.background, t.radius, t.border);
    c.text(
      new Rect(r.x + 16, r.y + 10, r.w - 32, 20),
      this.compare ? 'ORIGINAL' : 'STATIC PREVIEW',
      t.muted,
      11,
      true,
    );
    const portraitW = Math.min(300, f(f(r.w - 48) * f(0.5))),
      portrait = new Rect(r.x + 16, r.y + 56, portraitW, r.h - 106),
      body = new Rect(portrait.x + portrait.w + 16, portrait.y, r.w - portrait.w - 48, portrait.h);
    c.text(new Rect(portrait.x, r.y + 33, portrait.w, 18), 'PORTRAIT', t.text, 11, true);
    c.text(new Rect(body.x, r.y + 33, body.w, 18), 'WHOLE OUTFIT', t.text, 11, true);
    c.paint('studio-portrait' + key + JSON.stringify(portrait), () => {
      const face = this.renderer.portrait(person, portrait.w, portrait.h, this.backdrop);
      face.translate(portrait.x, portrait.y);
      return face;
    });
    c.paint('studio-body' + key + JSON.stringify(body), () => {
      const frame = new c.tvg.Scene(),
        background = this.renderer.background(this.backdrop, body.w, body.h);
      frame.add(background);
      background.dispose();
      const figure = this.renderer.figure(look),
        placement = this.renderer.figurePlacement(look, body.w, body.h);
      figure.scale(placement.scale).translate(placement.origin.x, placement.origin.y);
      frame.add(figure);
      figure.dispose();
      const clip = new c.tvg.Shape().appendRect(0, 0, body.w, body.h, { rx: 4, ry: 4 });
      frame.clip(clip);
      clip.dispose();
      const holder = new c.tvg.Scene().add(frame).translate(body.x, body.y);
      frame.dispose();
      return holder;
    });
    if (this.showFitGuides) {
      const placement = this.renderer.portraitPlacement(look, portrait.w, portrait.h),
        scale = placement.scale;
      for (const anchor of this.renderer.hairFitAnchors(look)) {
        const p = anchor.target,
          x = f(f(portrait.x + placement.origin.x) + f(p.x * scale)),
          y = f(f(portrait.y + placement.origin.y) + f(p.y * scale));
        c.line(x - 3, y, x + 3, y, t.accent, 1);
        c.line(x, y - 3, x, y + 3, t.accent, 1);
      }
    }
    c.text(
      new Rect(r.x + 16, r.y + r.h - 38, r.w - 32, 26),
      'Face and hair edits preserve the selected outfit.',
      t.muted,
      12,
    );
  }
  render(c: Context, viewport: Rect, close: (apply: boolean) => void): void {
    if (this.name.value !== this.preset.name) {
      const previous = structuredClone(this.preset);
      if (!this.past.length || encodeCharacter(this.past[this.past.length - 1]) !== encodeCharacter(previous))
        this.past.push(previous);
      if (this.past.length > 64) this.past.shift();
      this.future = [];
      this.preset.name = this.name.value;
    }
    const t = c.theme();
    c.rect(viewport, rgba(t.background.r, t.background.g, t.background.b, 225));
    c.modal('studio-name', () => close(false));
    c.control('studio-backdrop', viewport, () => {}, true, false);
    const panel = viewport.inset(16);
    c.rect(panel, rgba(t.surface.r, t.surface.g, t.surface.b, 255), t.radius, t.border);
    c.text(new Rect(panel.x + 20, panel.y + 12, 300, 18), 'MIDGARD  /  CREATOR TOOLS', t.muted, 11, true);
    c.text(new Rect(panel.x + 20, panel.y + 32, 400, 34), 'Character Studio', t.text, 24, true);
    c.text(
      new Rect(panel.x + 400, panel.y + 34, panel.w - 670, 28),
      this.changed() ? 'Unapplied changes' : 'Editing ' + this.original.name,
      t.muted,
      12,
      false,
      Align.End,
    );
    characterButton(
      c,
      'studio-random',
      new Rect(panel.x + panel.w - 248, panel.y + 28, 120, 32),
      'Vary face',
      () => this.randomize(),
    );
    characterButton(
      c,
      'studio-compare',
      new Rect(panel.x + panel.w - 116, panel.y + 28, 96, 32),
      'Original',
      () => {
        this.compare = !this.compare;
      },
      ButtonStyle.Default,
      true,
      Icon.None,
      this.compare,
    );
    c.line(panel.x, panel.y + 78, panel.x + panel.w, panel.y + 78, t.border);
    const top = panel.y + 94,
      contentH = panel.h - 226;
    c.text(new Rect(panel.x + 20, top, 120, 20), 'CUSTOMIZE', t.muted, 11, true);
    for (let i = 0; i < 6; i++)
      characterButton(
        c,
        'studio-tab-' + i,
        new Rect(panel.x + 12, top + 32 + i * 38, 132, 32),
        categories[i],
        () => {
          this.category = i;
          this.colorTarget = 0;
        },
        ButtonStyle.Quiet,
        true,
        Icon.None,
        this.category === i,
      );
    characterButton(
      c,
      'studio-undo',
      new Rect(panel.x + 12, top + contentH - 112, 62, 30),
      'Undo',
      () => this.undo(),
      ButtonStyle.Default,
      !!this.past.length,
    );
    characterButton(
      c,
      'studio-redo',
      new Rect(panel.x + 82, top + contentH - 112, 62, 30),
      'Redo',
      () => this.redo(),
      ButtonStyle.Default,
      !!this.future.length,
    );
    characterButton(
      c,
      'studio-reset',
      new Rect(panel.x + 12, top + contentH - 70, 132, 32),
      'Reset to original',
      () => this.reset(),
      ButtonStyle.Quiet,
      this.changed(),
    );
    c.text(new Rect(panel.x + 20, top + contentH - 26, 120, 18), 'Seed ' + this.preset.seed, t.muted, 11);
    const right = panel.x + panel.w - 324;
    this.previews(c, new Rect(panel.x + 160, top, right - panel.x - 180, contentH));
    this.controls(c, new Rect(right, top, 304, contentH));
    const footer = panel.y + panel.h - 112;
    c.line(panel.x, footer - 8, panel.x + panel.w, footer - 8, t.border);
    c.text(new Rect(panel.x + 20, footer, 200, 18), 'PRESET FILE', t.muted, 11, true);
    const fileW = panel.w - 460;
    textField(
      c,
      'studio-path',
      new Rect(panel.x + 20, footer + 24, fileW, 32),
      this.path,
      'characters/my-character.character',
      true,
      undefined,
      Icon.Folder,
    );
    characterButton(c, 'studio-load', new Rect(panel.x + 32 + fileW, footer + 24, 76, 32), 'Load', () => {
      void this.load();
    });
    characterButton(
      c,
      'studio-save',
      new Rect(panel.x + 116 + fileW, footer + 24, 76, 32),
      'Save',
      () => {
        void this.save();
      },
      ButtonStyle.Default,
      validCharacter(this.current()),
    );
    characterButton(
      c,
      'studio-cancel',
      new Rect(panel.x + panel.w - 240, footer + 24, 88, 32),
      'Cancel',
      () => close(false),
      ButtonStyle.Quiet,
    );
    characterButton(
      c,
      'studio-apply',
      new Rect(panel.x + panel.w - 140, footer + 24, 120, 32),
      'Apply to game',
      () => close(true),
      ButtonStyle.Primary,
      validCharacter(this.current()),
    );
    const message = !validCharacter(this.current())
      ? 'Enter a name of 1 to 96 bytes.'
      : this.feedback || 'Save keeps this head and outfit. Apply updates the character.';
    c.text(
      new Rect(panel.x + 20, footer + 67, panel.w - 40, 22),
      c.elideText(message, panel.w - 40, 12),
      this.failed || !validCharacter(this.current()) ? t.danger : t.muted,
      12,
    );
  }
  private controls(c: Context, r: Rect): void {
    const t = c.theme(),
      headings = [
        'Character identity',
        'Face & skull',
        'Eyes, brows & mouth',
        'Hair library',
        'Whole outfit',
        'Head colours',
      ];
    c.text(new Rect(r.x, r.y, r.w, 24), headings[this.category], t.text, 17, true);
    let y = r.y + 38;
    const a = this.preset.look;
    const names = (count: number, name: (i: number) => string) =>
      Array.from({ length: count }, (_, i) => name(i));
    const choice = (
      id: string,
      label: string,
      options: readonly string[],
      value: number,
      change: (value: number) => void,
    ) => {
      characterChoice(
        c,
        id,
        new Rect(r.x, y, r.w, 56),
        label,
        options,
        clamp(value, 0, options.length - 1),
        (v) => {
          this.remember();
          change(v);
        },
      );
      y += 64;
    };
    const slider = (id: string, label: string, member: FloatKey, low: number, high: number) => {
      characterSlider(
        c,
        id,
        new Rect(r.x, y, r.w, 44),
        label,
        a[member],
        low,
        high,
        () => this.remember(),
        (v) => {
          setFloat(this.preset.look, member, v);
        },
      );
      y += 44;
    };
    const toggle = (id: string, label: string, member: BoolKey) =>
      choice(id, label, ['Off', 'On'], Number(a[member]), (v) => {
        this.preset.look[member] = v !== 0;
      });
    const allGroups = [
        'Original artwork',
        'Construction studies',
        'Earlier colour artwork',
        'Dot-eye studies',
        'Flat-lid elf',
      ],
      groupIds: number[] = [],
      groups: string[] = [];
    for (let g = 0; g < 5; g++)
      for (let i = 0; i < hairAssetCount; i++)
        if (characterAssetReady(i) && characterAssetGroup(i) === g) {
          groupIds.push(g);
          groups.push(allGroups[g]);
          break;
        }
    const groupPosition = (g: number) => Math.max(0, groupIds.indexOf(g));
    const pool = (group: number, gender: number) => {
      const ids: number[] = [];
      for (let i = 0; i < hairAssetCount; i++)
        if (
          characterAssetReady(i) &&
          characterAssetGroup(i) === group &&
          (gender === 0 || characterAssetGender(i) === gender - 1 || i === baldHairAsset)
        )
          ids.push(i);
      if (!ids.length) ids.push(baldHairAsset);
      return ids;
    };
    const assetChoice = (
      id: string,
      label: string,
      ids: number[],
      value: number,
      change: (id: number) => void,
    ) => {
      const choices = [...ids];
      let current = choices.indexOf(value);
      if (current < 0) {
        current = choices.length;
        choices.push(value);
      }
      choice(id, label, choices.map(hairAssetName), current, (v) => change(choices[v]));
    };
    const target = (
      id: string,
      label: string,
      member: 'scalpTarget' | 'jawTarget',
      blend: 'scalpBlend' | 'jawBlend',
    ) => {
      const options = names(faceBaseCount, faceBaseName);
      options.push('Use source');
      choice(id, label, options, a[member] === 255 ? faceBaseCount : a[member], (v) => {
        this.preset.look[member] = v === faceBaseCount ? 255 : v;
        if (v !== faceBaseCount && this.preset.look[blend] === 0) this.preset.look[blend] = f(0.5);
      });
    };
    if (this.category === 0) {
      c.text(new Rect(r.x, y, r.w, 18), 'Name', t.muted, 12);
      textField(c, 'studio-name', new Rect(r.x, y + 23, r.w, 32), this.name, 'Character name');
      y += 66;
      choice('studio-gender', 'Gender / random asset weighting', ['Male', 'Female'], a.bodyType, (v) => {
        this.preset.look.bodyType = v;
      });
      choice('studio-race', 'Species', ['Human', 'God', 'Giant'], this.preset.race, (v) => {
        this.preset.race = v;
      });
      choice(
        'studio-calling',
        'Calling',
        ['Settler', 'Traveller', 'Warrior', 'Ranger', 'Mage', 'Cleric', 'Bard'],
        this.preset.calling,
        (v) => {
          this.preset.calling = v;
        },
      );
      choice(
        'studio-reference-group',
        'Reference library',
        groups,
        groupPosition(this.referenceGroup),
        (v) => {
          this.referenceGroup = groupIds[v];
        },
      );
      assetChoice('studio-reference', 'Reference look', pool(this.referenceGroup, 0), a.hairAsset, (v) => {
        useCharacterReference(this.preset.look, v);
        this.hairGroup = this.referenceGroup = characterAssetGroup(v);
      });
    } else if (this.category === 1) {
      choice(
        'studio-face-region',
        'Region',
        ['Upper skull', 'Jaw interpolation', 'Face style', 'Ears'],
        this.faceRegion,
        (v) => {
          this.faceRegion = v;
        },
      );
      if (this.faceRegion === 0) {
        choice(
          'studio-cranium-base',
          'Upper skull source',
          names(faceBaseCount, faceBaseName),
          a.scalpAsset,
          (v) => {
            this.preset.look.scalpAsset = v;
          },
        );
        target('studio-scalp-target', 'Upper skull target', 'scalpTarget', 'scalpBlend');
        slider('studio-scalp-blend', 'Upper skull interpolation', 'scalpBlend', 0, 1);
        slider('studio-scalp-width', 'Cranium width', 'scalpWidth', 0.88, 1.12);
        slider('studio-scalp-height', 'Crown height', 'scalpHeight', 0.88, 1.12);
        slider('studio-forehead', 'Forehead line', 'foreheadShift', -0.2, 0.2);
        slider('studio-temples', 'Temple spacing', 'templeWidth', 0.94, 1.06);
      } else if (this.faceRegion === 1) {
        choice('studio-face-asset', 'Jaw source', names(faceBaseCount, faceBaseName), a.faceAsset, (v) => {
          this.preset.look.faceAsset = v;
        });
        target('studio-jaw-target', 'Jaw target', 'jawTarget', 'jawBlend');
        slider('studio-jaw-blend', 'Jaw interpolation', 'jawBlend', 0, 1);
        slider('studio-jaw-width', 'Jaw width', 'jawWidth', 0.65, 1.35);
        slider('studio-chin-length', 'Chin length', 'chinLength', 0.65, 1.5);
        slider('studio-cheeks', 'Cheeks', 'cheekFullness', 0, 1);
      } else if (this.faceRegion === 2) {
        choice(
          'studio-face-shape',
          'Shape target',
          ['Reference', 'Oval', 'Round', 'Angular'],
          a.faceShape,
          (v) => {
            this.preset.look.faceShape = v;
          },
        );
        slider('studio-face-morph', 'Shape blend', 'faceBlend', 0, 1);
        slider('studio-face-width', 'Whole face width', 'faceWidth', -0.35, 1.35);
      } else {
        choice('studio-ear-asset', 'Ear source', names(faceBaseCount, faceBaseName), a.earAsset, (v) => {
          this.preset.look.earAsset = v;
        });
        slider('studio-ear-scale', 'Ear size', 'earScale', 0.7, 1.3);
        slider('studio-ear-height', 'Ear height', 'earHeight', -0.5, 0.5);
        slider('studio-ear-angle', 'Ear angle', 'earTilt', -0.25, 0.25);
      }
      if (y + 40 < r.y + r.h)
        characterButton(
          c,
          'studio-fit-guides',
          new Rect(r.x, y + 8, r.w, 28),
          this.showFitGuides ? 'Hide scalp anchors' : 'Show scalp anchors',
          () => {
            this.showFitGuides = !this.showFitGuides;
          },
          ButtonStyle.Quiet,
        );
    } else if (this.category === 2) {
      choice(
        'studio-eye-region',
        'Region',
        ['Eye shape', 'Eye placement / pupils', 'Eye outlines', 'Eyebrows', 'Mouth / nose'],
        this.eyeRegion,
        (v) => {
          this.eyeRegion = v;
        },
      );
      if (this.eyeRegion === 0) {
        choice('studio-eye-kind', 'Eye rendering', ['Dot eyes', 'Open eyes'], a.portraitEyeKind, (v) => {
          this.preset.look.portraitEyeKind = v;
        });
        choice(
          'studio-eye-form',
          'Eye form',
          ['Round', 'Almond', 'Half lid', 'Source recipe'],
          a.portraitEyeForm,
          (v) => {
            this.preset.look.portraitEyeForm = v;
          },
        );
        choice(
          'studio-eye-reference',
          'Eye recipe',
          names(eyeReferenceCount, eyeAssetName),
          a.eyeReference,
          (v) => {
            this.preset.look.eyeReference = v;
            this.preset.look.portraitEyeForm = PortraitEyeForm.Reference;
          },
        );
        slider('studio-eye-size', 'Eye size', 'eyeSize', 0.25, 2.5);
        slider('studio-eye-width', 'Eye width', 'eyeWidth', 0.4, 1.8);
        slider('studio-eye-height', 'Eye height', 'eyeHeight', 0.4, 1.8);
        slider('studio-eye-open', 'Eye openness', 'eyeOpenness', 0.1, 1.4);
        slider('studio-eye-round', 'Roundness blend', 'eyeRoundness', 0, 1);
      } else if (this.eyeRegion === 1) {
        slider('studio-eye-spacing', 'Eye spacing', 'eyeGap', 6, 11);
        slider('studio-eye-level', 'Eye level', 'eyeLevel', -0.4, 0.4);
        slider('studio-eye-tilt', 'Eye tilt', 'eyeTilt', -0.4, 0.4);
        if (a.portraitEyeKind === 1) {
          slider('studio-pupil', 'Pupil size', 'irisSize', 0.5, 1.4);
          slider('studio-pupil-height', 'Pupil height', 'pupilHeight', 0.5, 2);
          slider('studio-pupil-y', 'Pupil vertical position', 'pupilY', -0.6, 0.6);
        }
      } else if (this.eyeRegion === 2) {
        toggle('studio-eye-outline', 'Full eye outline', 'eyeOutline');
        toggle('studio-eye-lid', 'Upper lid line (open eyes)', 'upperLid');
        slider('studio-eye-stroke', 'Eye line weight', 'eyeStroke', 0.25, 2);
      } else if (this.eyeRegion === 3) {
        toggle('studio-brows-visible', 'Eyebrows', 'browVisible');
        choice(
          'studio-brow-reference',
          'Brow recipe',
          names(eyeReferenceCount, eyeAssetName),
          a.browReference,
          (v) => {
            this.preset.look.browReference = v;
          },
        );
        slider('studio-brow-width', 'Brow width', 'browWidth', 0.5, 1.8);
        slider('studio-brow-spacing', 'Brow spacing', 'browSpacing', 0.7, 1.4);
        slider('studio-brow-height', 'Brow height', 'browHeight', -0.7, 0.7);
        slider('studio-brow-tilt', 'Brow angle', 'browTilt', -0.6, 0.6);
        slider('studio-brow-curve', 'Brow curvature', 'browCurve', -1, 1);
        slider('studio-brow-weight', 'Brow line weight', 'browWeight', 0.5, 3);
      } else {
        slider('studio-mouth-curve', 'Mouth curve', 'mouthCurve', -1, 1);
        slider('studio-mouth-width', 'Mouth width', 'mouthWidth', 3, 10);
        slider('studio-mouth-weight', 'Mouth line weight', 'lipFullness', 0.75, 1.25);
        slider('studio-nose-size', 'Nose size', 'noseScale', 0.6, 1.6);
      }
    } else if (this.category === 3) {
      choice('studio-hair-group', 'Asset library', groups, groupPosition(this.hairGroup), (v) => {
        this.hairGroup = groupIds[v];
      });
      choice(
        'studio-hair-gender',
        'Asset pool',
        ['All', 'Masculine', 'Feminine', 'Unisex'],
        this.genderFilter,
        (v) => {
          this.genderFilter = v;
        },
      );
      assetChoice(
        'studio-hair-asset',
        'Whole hairstyle',
        pool(this.hairGroup, this.genderFilter),
        a.hairAsset,
        (v) => {
          const a = this.preset.look;
          a.hairAsset = v;
          a.hairCap = a.hairFringe = a.hairBack = a.hairTied = 255;
        },
      );
      slider('studio-hair-length', 'Long hair length', 'hairLength', 0.8, 1.2);
      slider('studio-side-locks', 'Side lock clearance', 'sideLockGap', -0.2, 0.4);
      if (y + 32 < r.y + r.h)
        characterButton(
          c,
          'studio-fit-guides',
          new Rect(r.x, y + 4, r.w, 28),
          this.showFitGuides ? 'Hide scalp anchors' : 'Show scalp anchors',
          () => {
            this.showFitGuides = !this.showFitGuides;
          },
          ButtonStyle.Quiet,
        );
    } else if (this.category === 4) {
      const ids: number[] = [],
        labels: string[] = [];
      for (let i = 0; i < outfitAssetCount; i++)
        if (characterOutfitReady(i)) {
          ids.push(i);
          labels.push(outfitAssetName(i));
        }
      const found = ids.indexOf(safeCharacterOutfitAsset(a.outfitAsset));
      choice('studio-outfit-asset', 'Outfit set', labels, found < 0 ? ids.length : found, (v) => {
        this.preset.look.outfitAsset = ids[v];
      });
      c.text(new Rect(r.x, y + 12, r.w, 20), 'Swap the copied outfit as one set.', t.muted, 12);
    } else {
      choice('studio-head-color', 'Colour', ['Skin', 'Hair'], this.colorTarget, (v) => {
        this.colorTarget = v;
      });
      const member = this.colorTarget ? 'hair' : 'skin';
      characterColor(
        c,
        new Rect(r.x, y + 12, r.w, r.h - 80),
        a[member],
        () => this.remember(),
        (v) => {
          this.preset.look[member] = v;
          refreshShades(this.preset.look);
        },
      );
    }
  }
}

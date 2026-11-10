// Translated from src/game/scene_application.cpp in the pinned native reference.
import type { Scene, ThorVGNamespace } from '@thorvg/webcanvas';
import {
  Align,
  ButtonStyle,
  Context,
  EventType,
  Key,
  Rect,
  Theme,
  button,
  type NativeFontMetrics,
} from '../../../../packages/native-ui/src/index';
import {
  emptyEvent,
  type AppEvent,
  type Application,
  type Camera,
  type LaunchOptions,
  type NativeSound,
  type Preview,
  type Property,
  type SceneId,
  type SceneServices,
} from './application-contracts';

import { Cue, Sound } from '../../../../packages/native-audio/src/sound-types';
import { gameTheme, reducedMotionPreferred } from './game-theme';
import { TitleCamera } from './title-camera';
import { drawTitleWordmark } from './title-wordmark';
import { structureSpec } from '../../../../packages/engine/src/building-catalog';
import { Activity, activityName } from '../../../../packages/engine/src/person';
const f = Math.fround;
const settingsIcon =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.6" stroke-linejoin="round"><path d="M10 2.8h4l.5 2.5 1.7 1 2.4-.8 2 3.5-1.9 1.7v2.6l1.9 1.7-2 3.5-2.4-.8-1.7 1-.5 2.5h-4l-.5-2.5-1.7-1-2.4.8-2-3.5 1.9-1.7v-2.6L3.4 9l2-3.5 2.4.8 1.7-1Z"/><circle cx="12" cy="12" r="3.2"/></svg>';
type Intro = 'None' | 'Cover' | 'Loading' | 'Reveal';

export class SceneApplication implements Application {
  private readonly options: LaunchOptions;
  private current: SceneId = 'Title';
  private requested: SceneId | undefined = 'Title';
  private gameSession: Application | undefined;
  private editorSession: Application | undefined;
  private retiring: { app: Application; until: number }[] = [];
  private readonly root: Scene;
  private readonly overlay: Context;
  private newGame = false;
  private continueGame = false;
  private overlayPointer = false;
  private previewFromSave = false;
  private settingsOpen = false;
  private readonly savePath: string;
  private message = '';
  private messageUntil = -1;
  private titleFollow = new TitleCamera();
  private preview: Preview | undefined;
  private titleSound: NativeSound | undefined;
  private hoveredTitleItem = '';
  private intro: Intro = 'None';
  private introTime = 0;
  private lastFrame = -1;
  private fog = 0;
  private introFrom: Camera = { x: 0, y: 0, zoom: 1 };
  private introTo: Camera = { x: 0, y: 0, zoom: 1 };

  constructor(
    value: LaunchOptions,
    tvg: ThorVGNamespace,
    fonts: NativeFontMetrics,
    private readonly services: SceneServices,
  ) {
    this.options = { ...value, titleScreen: false };
    this.root = new tvg.Scene();
    this.overlay = new Context(tvg, fonts);
    if (!this.overlay.setIcons([{ name: 'settings', data: settingsIcon, mime: 'svg' }]))
      throw new Error(this.overlay.iconError());
    this.savePath = value.saveFile || services.preferenceSavePath();
    if (value.studio || value.characterFile) this.requested = 'CharacterStudio';
    else if (value.mapEditor) this.requested = 'MapEditor';
    else if (value.demo || value.buildingStudio || value.buildingFile) this.requested = 'Game';
  }

  title(): string {
    return 'Midgard';
  }
  scene(): Scene {
    return this.root;
  }
  presented(pixelRatio: number): void {
    const active = this.current === 'Game' ? this.gameSession : this.editorSession;
    if (this.current !== 'Title') active?.presented?.(pixelRatio);
  }
  invalidatePresentation(): void {
    this.gameSession?.invalidatePresentation?.();
    this.editorSession?.invalidatePresentation?.();
  }

  render(width: number, height: number, seconds: number): void {
    width = f(width);
    height = f(height);
    const dt = this.lastFrame < 0 ? 0 : Math.max(0, Math.min(0.1, seconds - this.lastFrame));
    this.lastFrame = seconds;
    this.retiring = this.retiring.filter((session) => {
      if (seconds < session.until) return true;
      session.app.dispose();
      return false;
    });
    if (this.requested) {
      this.transition(this.requested);
      this.requested = undefined;
    }
    if (this.intro !== 'None') this.advanceIntro(dt);
    if (this.current === 'Title' && this.preview) {
      this.preview.state().advanceTitleAutoplay(dt);
      if (this.intro === 'None') {
        this.preview.setView(
          this.titleFollow.update(this.preview.state(), width, height, dt, reducedMotionPreferred()),
        );
        const subject = this.preview.state().titleAutoplaySubject();
        if (subject) {
          const selected = this.preview.selectedPeople();
          if (selected.length !== 1 || selected[0] !== subject.id) this.preview.selectPeople([subject.id]);
        }
      }
      this.preview.render(width, height, seconds, false);
      if (this.titleSound) {
        this.titleSound.setAmbience(this.preview.ambience());
        for (const cue of this.preview.takeCues()) this.titleSound.play(cue);
      }
    }
    const theme = gameTheme();
    theme.accent = { r: 210, g: 184, b: 113, a: 255 };
    if (this.current === 'Title') {
      theme.surface = { r: 0, g: 0, b: 0, a: 0 };
      theme.raised = { r: 0, g: 0, b: 0, a: 0 };
      theme.selection = { r: 0, g: 0, b: 0, a: 0 };
      theme.text = { r: 244, g: 231, b: 206, a: 255 };
      theme.accentText = { r: 46, g: 53, b: 37, a: 255 };
      theme.border = { r: 153, g: 129, b: 82, a: 180 };
      theme.radius = 3;
    }
    this.overlay.begin(theme, new Rect(0, 0, width, height), seconds);
    if (this.current === 'Title') {
      const narrow = width < 680,
        titleCenter = f(width * (narrow ? 0.5 : 0.8)),
        titleWidth = Math.min(520, narrow ? width - 36 : f(width * f(0.36))),
        tagline = 'A WORLD WAITING FOR YOUR STORY',
        taglineSize = Math.min(12, (12 * (titleWidth - 8)) / this.overlay.textWidth(tagline, 12, true));
      this.overlay.text(
        new Rect(f(titleCenter - titleWidth / 2), f(height * f(0.17)), titleWidth, 28),
        tagline,
        { r: 205, g: 217, b: 207, a: 255 },
        taglineSize,
        true,
        Align.Center,
      );
      drawTitleWordmark(this.overlay, titleCenter, f(height * f(0.22)), titleWidth);
      const subject = this.preview?.state().titleAutoplaySubject();
      if (subject) {
        let activity = activityName(subject.activity);
        if (subject.task === Activity.Building) {
          const site = this.preview?.state().building(subject.taskSite);
          if (site) activity = 'Building ' + structureSpec(site.kind).name;
        } else if (subject.task === Activity.Roadwork) activity = 'Building a road';
        this.overlay.text(
          new Rect(24, f(height - 52), f(f(width * f(0.5)) - 48), 20),
          'Following ' + subject.name,
          theme.text,
          12,
          true,
        );
        this.overlay.text(
          new Rect(24, f(height - 32), f(f(width * f(0.5)) - 48), 18),
          activity,
          theme.accent,
          11,
        );
      }
      const bw = Math.min(300, narrow ? width - 48 : f(width * f(0.32)));
      const left = f(titleCenter - f(bw / 2)),
        top = f(height * f(0.42));
      let hoveredItem = '';
      const menu = (id: string, bounds: Rect, label: string, activate: () => void, enabled = true) => {
        const state = button(this.overlay, id, bounds, label, activate, ButtonStyle.Quiet, enabled);
        if (enabled && state.hovered) hoveredItem = id;
        if (enabled && (state.hovered || state.focused || state.pressed)) {
          const color = state.pressed ? { r: 255, g: 245, b: 208, a: 255 } : theme.accent;
          this.overlay.rect(
            new Rect(f(bounds.x + 24), f(f(bounds.y + bounds.h) - 3), f(bounds.w - 48), 2),
            color,
          );
          this.overlay.text(
            new Rect(f(bounds.x + 3), bounds.y, 18, bounds.h),
            '>',
            color,
            16,
            true,
            Align.Center,
          );
        }
      };
      menu('new-game', new Rect(left, top, bw, 44), 'Start Game', () => this.beginGame(false));
      menu(
        'continue',
        new Rect(left, f(top + 53), bw, 44),
        'Continue',
        () => this.beginGame(true),
        !!this.gameSession || this.services.exists(this.savePath),
      );
      menu('studio', new Rect(left, f(top + 106), bw, 40), 'Character Studio', () => {
        this.requested = 'CharacterStudio';
      });
      menu('map-editor', new Rect(left, f(top + 155), bw, 40), 'Map Editor', () => {
        this.requested = 'MapEditor';
      });
      if (hoveredItem !== this.hoveredTitleItem) {
        if (hoveredItem && this.intro === 'None' && this.titleSound)
          this.titleSound.play(new Sound(Cue.Click, f(0.35), 0));
        this.hoveredTitleItem = hoveredItem;
      }
      if (this.message)
        this.overlay.text(
          new Rect(24, f(top + 209), f(width - 48), 42),
          this.message,
          theme.danger,
          14,
          false,
          Align.Center,
        );
    } else {
      const session = this.active();
      if (!session) throw new Error('An active scene must own its application.');
      session.render(width, height, seconds);
      if (this.current !== 'Game' && !session.command('session.authoring')) {
        if (this.current === 'MapEditor') {
          this.retire(this.gameSession);
          this.gameSession = this.editorSession;
          this.editorSession = undefined;
          this.requested = 'Game';
        } else this.requested = 'Title';
      }
      if (this.intro === 'None') {
        const bounds = new Rect(f(width - 52), 12, 36, 36);
        const state = button(this.overlay, 'settings', bounds, '', () => this.openSettings());
        this.overlay.icon('settings/gear', bounds.inset(7), 'settings', theme.text, {
          hovered: state.hovered,
          pressed: state.pressed,
          active: this.settingsOpen,
          enabled: true,
          focused: state.focused,
        });
        if (this.settingsOpen) this.drawSettings(width, height, theme);
        else if (this.message && this.current === 'Game' && seconds < this.messageUntil) {
          const w = Math.min(300, f(width - 32)),
            toast = new Rect(f(f(width - w) / 2), 58, w, 30);
          this.overlay.rect(toast, theme.raised, theme.radius, theme.border);
          this.overlay.text(toast.inset(4), this.message, theme.text, 12, false, Align.Center);
          this.overlay.requestFrameAt(this.messageUntil);
        }
      }
    }
    if (this.intro !== 'None')
      this.overlay.rect(new Rect(0, 0, width, height), {
        r: 0,
        g: 0,
        b: 0,
        a: Math.trunc(f(Math.max(0, Math.min(1, this.fog)) * 255)),
      });
    this.overlay.end();
  }

  event(event: AppEvent): void {
    if (this.intro !== 'None') return;
    if (this.settingsOpen) {
      if (event.type === 'PointerMove') this.overlay.pointerMove(event.x, event.y);
      else if (event.type === 'PointerDown' && event.button === 1) this.overlay.pointerDown(event.x, event.y);
      else if (event.type === 'PointerUp' && event.button === 1) this.overlay.pointerUp(event.x, event.y);
      else if (event.type === 'PointerCancel') {
        this.overlay.cancelPointer();
        this.overlayPointer = false;
      } else if (event.type === 'KeyDown') {
        if (event.key === Key.Escape || event.text === 'escape') this.closeSettings();
        else if ((event.control || event.meta) && event.text === 's' && this.current === 'Game') this.save();
        else this.overlay.key(event.key, event.shift);
      }
      return;
    }
    if (event.type === 'PointerCancel') {
      this.overlay.cancelPointer();
      this.active()?.event(event);
      return;
    }
    if (
      event.type === 'KeyDown' &&
      (event.control || event.meta) &&
      event.text === 's' &&
      this.current === 'Game'
    ) {
      this.save();
      return;
    }
    if (event.type === 'KeyDown' && event.text === 'escape' && this.current !== 'Game') {
      this.requested = 'Title';
      return;
    }
    if (event.type === 'PointerMove') this.overlay.pointerMove(event.x, event.y);
    if (event.type === 'PointerDown' && event.button === 1) {
      this.overlayPointer = this.overlay.controlAt(event.x, event.y);
      if (this.overlayPointer) {
        this.overlay.pointerDown(event.x, event.y);
        return;
      }
    }
    if (event.type === 'PointerUp' && event.button === 1 && this.overlayPointer) {
      this.overlay.pointerUp(event.x, event.y);
      this.overlayPointer = false;
      return;
    }
    if (
      event.type === 'KeyDown' &&
      this.overlay.focused() === 'settings' &&
      (event.key === Key.Enter || event.key === Key.Space)
    ) {
      this.overlay.key(event.key);
      return;
    }
    if (this.current === 'Title') {
      if (event.type === 'KeyDown') {
        this.overlay.key(event.key, event.shift);
        if (event.text === 'return' && !this.overlay.focused()) this.beginGame(false);
      }
      return;
    }
    if (this.current === 'Game' && event.type === 'KeyDown' && (event.text === 'f2' || event.text === 'f3'))
      return;
    if (!this.overlayPointer) this.active()?.event(event);
  }

  command(id: string, argument = ''): boolean {
    if (id === 'scene.title') {
      this.requested = 'Title';
      return true;
    }
    if (id === 'scene.new') {
      this.beginGame(false);
      return true;
    }
    if (id === 'scene.continue') {
      this.beginGame(true);
      return true;
    }
    if (id === 'scene.preview-saved') return this.previewFromSave;
    if (id === 'scene.is-transitioning') return this.intro !== 'None';
    if (id === 'scene.is-title') return this.current === 'Title';
    if (id === 'scene.is-game') return this.current === 'Game';
    if (id === 'ui.cursor' && this.settingsOpen) return false;
    if (id === 'session.save') return this.save();
    if (id === 'edit.character') {
      if (this.current !== 'Title') return false;
      this.requested = 'CharacterStudio';
      return true;
    }
    if (id === 'edit.map') {
      if (this.current !== 'Title') return false;
      this.requested = 'MapEditor';
      return true;
    }
    return this.active()?.command(id, argument) ?? false;
  }
  properties(): Property[] {
    return this.active()?.properties() ?? [];
  }
  property(id: string, value: number): boolean {
    return this.active()?.property(id, value) ?? false;
  }
  actions(): { id: string; label: string }[] {
    return [
      { id: 'scene.title', label: 'Back to Title' },
      { id: 'session.save', label: 'Save' },
    ];
  }
  private active(): Application | undefined {
    return this.current === 'Game'
      ? this.gameSession
      : this.current === 'Title'
        ? undefined
        : this.editorSession;
  }
  private retire(session: Application | undefined): void {
    if (!session) return;
    session.command('session.suspend');
    this.retiring.push({ app: session, until: this.lastFrame + 1.5 });
  }
  private openSettings(): void {
    if (this.settingsOpen) return;
    this.settingsOpen = true;
    this.message = '';
    const session = this.active();
    if (session) {
      session.event(emptyEvent('PointerCancel'));
      session.command('session.freeze', 'on');
      session.command('session.suspend');
    }
  }
  private closeSettings(): void {
    if (!this.settingsOpen) return;
    this.settingsOpen = false;
    this.overlay.cancelPointer();
    this.overlayPointer = false;
    const session = this.active();
    if (session) {
      session.command('session.freeze', 'off');
      session.command('session.resume');
    }
  }
  private drawSettings(width: number, height: number, theme: Theme): void {
    const game = this.current === 'Game';
    const close = () => this.closeSettings();
    this.overlay.modal(game ? 'settings/save' : 'settings/title', close);
    const viewport = new Rect(0, 0, width, height);
    this.overlay.control(
      'settings/backdrop',
      viewport,
      (event) => {
        if (event.type === EventType.Activate) close();
      },
      true,
      false,
    );
    this.overlay.rect(viewport, { r: 0, g: 0, b: 0, a: 144 });
    const w = Math.min(320, f(width - 32)),
      h = game ? 216 : 154;
    const panel = new Rect(f(f(width - w) / 2), f(f(height - h) / 2), w, h);
    this.overlay.control('settings/panel', panel, () => {}, true, false);
    this.overlay.rect(
      new Rect(f(panel.x - 2), f(panel.y + 6), f(panel.w + 4), f(panel.h + 4)),
      { r: 0, g: 0, b: 0, a: 70 },
      12,
    );
    this.overlay.rect(panel, theme.surface, 10, theme.border);
    this.overlay.text(
      new Rect(f(panel.x + 24), f(panel.y + 17), f(panel.w - 80), 28),
      'Settings',
      theme.text,
      18,
      true,
    );
    const dismiss = new Rect(f(f(panel.x + panel.w) - 46), f(panel.y + 16), 28, 28);
    const state = button(this.overlay, 'settings/close', dismiss, '', close, ButtonStyle.Quiet);
    const ink = state.hovered || state.focused ? theme.text : theme.muted;
    this.overlay.line(f(dismiss.x + 9), f(dismiss.y + 9), f(dismiss.x + 19), f(dismiss.y + 19), ink, f(1.5));
    this.overlay.line(f(dismiss.x + 19), f(dismiss.y + 9), f(dismiss.x + 9), f(dismiss.y + 19), ink, f(1.5));
    let y = f(panel.y + 64);
    if (game) {
      button(
        this.overlay,
        'settings/save',
        new Rect(f(panel.x + 24), y, f(panel.w - 48), 40),
        'Save',
        () => {
          this.save();
        },
        ButtonStyle.Primary,
      );
      y = f(y + 50);
    }
    button(
      this.overlay,
      'settings/title',
      new Rect(f(panel.x + 24), y, f(panel.w - 48), 40),
      'Back to Title',
      () => {
        this.requested = 'Title';
      },
    );
    if (game && this.message)
      this.overlay.text(
        new Rect(f(panel.x + 24), f(panel.y + 170), f(panel.w - 48), 24),
        this.message,
        theme.text,
        12,
        false,
        Align.Center,
      );
  }
  private transition(next: SceneId): void {
    this.hoveredTitleItem = '';
    if (this.settingsOpen) this.active()?.command('session.freeze', 'off');
    this.settingsOpen = false;
    this.root.remove();
    this.overlay.cancelPointer();
    this.overlayPointer = false;
    this.titleSound?.fadeOut();
    const active = this.active();
    if (active) {
      active.event(emptyEvent('PointerCancel'));
      active.command('session.suspend');
    }
    this.message = '';
    if (next === 'Game') {
      if (this.newGame || !this.gameSession || (this.continueGame && this.services.exists(this.savePath))) {
        const candidate = this.services.createApplication({
          ...this.options,
          studio: false,
          mapEditor: false,
          characterFile: '',
        });
        if (this.continueGame && !candidate.command('session.load', this.savePath)) {
          this.message = 'Could not load the saved game.';
          next = 'Title';
          candidate.dispose();
        } else {
          this.retire(this.gameSession);
          this.gameSession = candidate;
        }
      }
      this.newGame = this.continueGame = false;
    } else if (next !== 'Title') {
      const launch = {
        ...this.options,
        demo: false,
        raid: false,
        buildingStudio: false,
        buildingFile: '',
        studio: next === 'CharacterStudio',
        mapEditor: next === 'MapEditor',
      };
      if (!launch.studio) launch.characterFile = '';
      this.retire(this.editorSession);
      this.editorSession = this.services.createApplication(launch);
    }
    this.current = next;
    const session = this.active();
    if (session) {
      session.command('session.resume');
      this.root.add(session.scene());
    }
    this.root.add(this.overlay.scene());
    if (this.current === 'Title') {
      this.retire(this.editorSession);
      this.editorSession = undefined;
      this.preparePreview();
      this.root.remove();
      if (this.preview) this.root.add(this.preview.worldScene());
      this.root.add(this.overlay.scene());
    }
  }
  private save(): boolean {
    if (this.current !== 'Game' || !this.gameSession) return false;
    const ok = this.gameSession.command('session.save', this.savePath);
    if (ok) this.services.syncSave();
    this.message = ok ? 'Game saved.' : 'Could not save the game.';
    this.messageUntil = this.lastFrame + 2.5;
    return ok;
  }
  private preparePreview(): void {
    this.preview?.dispose();
    this.preview = this.services.createPreview(
      this.options.world === 'Designed'
        ? this.services.designedWorldSeed
        : (this.options.seed ?? this.services.randomDevice()),
    );
    this.previewFromSave = false;
    if (this.services.exists(this.savePath)) {
      if (this.services.loadPreview(this.preview, this.savePath)) this.previewFromSave = true;
      else this.message = 'Could not preview the save. Showing a new world.';
    } else if (this.options.mapFile) this.preview.loadMapFile(this.options.mapFile);
    this.preview.selectPeople([]);
    this.preview.state().startTitleAutoplay(this.services.randomDevice());
    this.titleFollow.reset();
    if (!this.titleSound) this.titleSound = this.services.createSound();
    this.titleSound.fadeIn();
  }

  private static ease(t: number): number {
    t = f(Math.max(0, Math.min(1, t)));
    return f(f(t * t) * f(3 - f(2 * t)));
  }
  private static blend(a: Camera, b: Camera, t: number): Camera {
    t = SceneApplication.ease(t);
    return {
      x: f(a.x + f(f(b.x - a.x) * t)),
      y: f(a.y + f(f(b.y - a.y) * t)),
      zoom: f(a.zoom + f(f(b.zoom - a.zoom) * t)),
    };
  }
  private settlementCamera(): Camera {
    if (!this.preview) throw new Error('The title must own a preview world.');
    const p = this.preview.state().camp()?.center ?? this.preview.state().map().camp();
    return { x: f(f(p.x - p.y) * 32), y: f(f(f(p.x + p.y) * 16) - 32), zoom: f(1.4) };
  }
  private beginGame(continuing: boolean): void {
    if (this.intro !== 'None' || this.current !== 'Title') return;
    this.newGame = !continuing;
    this.continueGame = continuing;
    this.intro = 'Cover';
    this.introTime = 0;
    this.overlay.cancelPointer();
    if (this.preview) {
      this.introFrom = { ...this.preview.view() };
      this.introTo = this.settlementCamera();
    }
  }
  private advanceIntro(dt: number): void {
    this.introTime += dt;
    if (this.intro === 'Cover') {
      this.preview?.setView(SceneApplication.blend(this.introFrom, this.introTo, f(this.introTime / 1.6)));
      this.fog = SceneApplication.ease(f(this.introTime / 0.7));
      if (this.introTime >= 0.7) {
        this.intro = 'Loading';
        this.introTime = 0;
      }
    } else if (this.intro === 'Loading') {
      this.fog = 1;
      if (this.introTime < 0.18) return;
      this.transition('Game');
      if (this.current !== 'Game') {
        this.intro = 'None';
        this.fog = 0;
        return;
      }
      const session = this.gameSession;
      if (!session) throw new Error('The game scene must own a session.');
      session.command('session.freeze', 'on');
      session.command('session.focus-settlement');
      for (const property of session.properties()) {
        if (property.id === 'camera.x') this.introTo.x = f(property.value);
        if (property.id === 'camera.y') this.introTo.y = f(property.value);
        if (property.id === 'zoom') this.introTo.zoom = f(property.value);
      }
      this.introFrom = { ...(this.preview?.view() ?? this.introTo) };
      this.intro = 'Reveal';
      this.introTime = 0;
    } else if (this.intro === 'Reveal') {
      const camera = SceneApplication.blend(this.introFrom, this.introTo, f(this.introTime / 1.1));
      this.gameSession?.property('camera.x', camera.x);
      this.gameSession?.property('camera.y', camera.y);
      this.gameSession?.property('zoom', camera.zoom);
      this.fog = f(1 - SceneApplication.ease(f(this.introTime / 1.1)));
      if (this.introTime >= 1.1) {
        this.intro = 'None';
        this.fog = 0;
        this.gameSession?.command('session.freeze', 'off');
      }
    }
  }
  dispose(): void {
    this.root.remove();
    this.root.dispose();
    this.overlay.dispose();
    this.gameSession?.dispose();
    this.gameSession = undefined;
    this.editorSession?.dispose();
    this.editorSession = undefined;
    this.preview?.dispose();
    this.preview = undefined;
    this.titleSound?.dispose();
    this.titleSound = undefined;
    for (const session of this.retiring) session.app.dispose();
    this.retiring = [];
  }
}

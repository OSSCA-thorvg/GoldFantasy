import { type ThorVGNamespace } from '@thorvg/webcanvas';
import { initializeWebCanvas } from './startup-canvas';
import { Context, loadNativeFonts, type NativeFontMetrics } from '../../../../packages/native-ui/src';
import { prepareScriptRuntime } from '../../../../packages/native-ui/src/script';
import hudScript from '../../../../packages/native-ui/assets/hud.lua?raw';
import demoScript from '../../../../packages/native-ui/assets/demo.lua?raw';
import { WorldRenderer } from '../../../../packages/native-renderer/src/world-renderer';
import { createCharacterPreview } from '../../../../packages/native-renderer/src/character-preview';
import { sounds } from '../../../../packages/native-audio/src/sound-library';
import { BrowserSoundDevice, disposeNativeAudio } from '../../../../packages/native-audio/src/browser-audio';
import { Town } from '../../../../packages/engine/src/town';
import { decodeTown } from '../../../../packages/engine/src/save-game';
import { designedWorldSeed } from '../../../../packages/engine/src/ymir-born';
import { GameApp } from './game-app';
import { GameApplication } from './game-application';
import { SceneApplication } from './scene-application';
import { BuildingFiles } from './building-files';
import { BrowserFiles } from './browser-files';
import { BrowserHost } from './browser-host';
import { createMapPreview } from './map-preview';
import { buildDemo } from './demo';
import {
  defaultLaunchOptions,
  type Application,
  type LaunchOptions,
  type SceneServices,
} from './application-contracts';
export function createNativeServices(
  tvg: ThorVGNamespace,
  fonts: NativeFontMetrics,
  files: BrowserFiles,
): SceneServices {
  for (const [path, source] of [
    ['/scripts/hud.lua', hudScript],
    ['/scripts/demo.lua', demoScript],
  ]) {
    if (!files.exists(path)) files.stage(path, source);
  }
  const buildings = new BuildingFiles(files);
  const gameServices = {
    buildings,
    files,
    sounds,
    createContext: () => new Context(tvg, fonts),
    createRenderer: () => new WorldRenderer(tvg),
    mapPreview: () => createMapPreview(tvg),
    characterPreview: () => createCharacterPreview(tvg),
  };
  const randomDevice = () => crypto.getRandomValues(new Uint32Array(1))[0];
  const applicationServices = {
    tvg,
    files,
    loadBuildingAssets: (directory: string) => buildings.loadDirectory(directory || undefined),
    createGame: (seed: number) => new GameApp(seed, gameServices),
    createContext: gameServices.createContext,
    createSound: () => new BrowserSoundDevice(),
    designedWorldSeed,
    randomDevice,
    frameTime: () => performance.now() / 1000,
    buildDemo,
  };
  const services: SceneServices = {
    createApplication: (options: LaunchOptions) =>
      options.titleScreen
        ? new SceneApplication(options, tvg, fonts, services)
        : new GameApplication(options, applicationServices),
    createPreview: (seed) => new GameApp(seed, gameServices),
    loadPreview(preview, path) {
      if (!(preview instanceof GameApp)) return false;
      try {
        preview.town = decodeTown(files.readSync(path), (map) => new Town(map, 176, false, true));
        return true;
      } catch {
        return false;
      }
    },
    createSound: applicationServices.createSound,
    exists: (path) => files.exists(path),
    preferenceSavePath: () => '/saves/current.goldfantasy',
    randomDevice,
    designedWorldSeed,
    syncSave: () => {
      void files.sync().catch((error) => console.error(error));
    },
  };
  return services;
}
export interface NativeRuntime {
  host: BrowserHost;
  app: Application;
  tvg: ThorVGNamespace;
  files: BrowserFiles;
  dispose(): Promise<void>;
}
export async function startNativeGame(
  element: HTMLCanvasElement,
  options: Partial<LaunchOptions> = {},
  renderer: 'gl' | 'sw' | 'wg' = 'gl',
  preparedCanvas?: ThorVGNamespace,
): Promise<NativeRuntime> {
  const tvg = preparedCanvas ?? (await initializeWebCanvas(renderer));
  let files: BrowserFiles | undefined, host: BrowserHost | undefined;
  try {
    const fonts = await loadNativeFonts(tvg);
    files = await BrowserFiles.open();
    // Sound devices prepare asynchronously when the scene creates them. The
    // first frame must not wait for the complete effects sample download.
    await prepareScriptRuntime();
    const services = createNativeServices(tvg, fonts, files),
      app = services.createApplication({ ...defaultLaunchOptions(), titleScreen: true, ...options });
    host = new BrowserHost(element, tvg, app);
    let closed = false;
    const runtime: NativeRuntime = {
      host,
      app,
      tvg,
      files,
      async dispose() {
        if (closed) return;
        closed = true;
        try {
          host!.dispose();
          await files!.sync();
        } finally {
          await files!.close();
          await disposeNativeAudio();
          tvg.term();
        }
      },
    };
    window.addEventListener(
      'pagehide',
      () => {
        void runtime.dispose();
      },
      { once: true },
    );
    return runtime;
  } catch (error) {
    host?.dispose();
    await files?.close();
    await disposeNativeAudio();
    tvg.term();
    throw error;
  }
}

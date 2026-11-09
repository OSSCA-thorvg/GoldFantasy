import { initializeWebCanvas } from './startup-canvas';
import { showStartupSplash } from './startup-splash';
import { captureStartupAudio } from './startup-audio';
import type { NativeRuntime } from './bootstrap';
import type { BrowserSoundDevice } from '../../../../packages/native-audio/src/browser-audio';
import { Ambience } from '../../../../packages/native-audio/src/sound-types';
import './native.css';
const element = document.querySelector('#world');
if (!(element instanceof HTMLCanvasElement)) throw new Error('Midgard canvas is missing.');
const query = new URLSearchParams(location.search),
  renderer = query.get('renderer');
const backend = renderer === 'sw' ? 'sw' : renderer === 'wg' || renderer === 'wgpu' ? 'wg' : 'gl';
const audio = captureStartupAudio(document.querySelector<HTMLElement>('#startup-audio-hint')!);
const canvasReady = initializeWebCanvas(backend);
// The splash can finish loading after a failed graphics request; handle that
// rejection now while keeping the actual startup error for the main flow.
void canvasReady.catch(() => {});
const splash = showStartupSplash(document.querySelector<HTMLElement>('#startup')!, canvasReady);
let abandoned = false,
  startupFinished = false,
  runtime: NativeRuntime | undefined,
  startupSound: BrowserSoundDevice | undefined;
window.addEventListener(
  'pagehide',
  () => {
    abandoned = true;
    startupFinished = true;
    audio.dispose();
    startupSound?.dispose();
    if (!runtime) void audio.context?.close().catch(() => {});
  },
  { once: true },
);
const audioReady = import('../../../../packages/native-audio/src/browser-audio')
  .then((module) => {
    if (abandoned) return;
    void module.prepareNativeAudio(audio.context);
    if (!startupFinished) {
      startupSound = new module.BrowserSoundDevice();
      startupSound.setAmbience(Object.assign(new Ambience(), { wind: 0.15, birds: 0.2, music: 0.12 }));
      startupSound.fadeIn(0.4);
    }
    audio.handoff();
  })
  .catch((error) => console.warn('Audio preparation is unavailable:', error));
const gameReady = Promise.all([import('./bootstrap'), import('./launch-options'), canvasReady]);
void gameReady.catch(() => {});
void (async () => {
  await splash.ready;
  // Give browsers without OffscreenCanvas a paint before synchronous world setup.
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const [{ startNativeGame }, { parseLaunchQuery }, tvg] = await gameReady;
  if (abandoned) {
    tvg.term();
    return;
  }
  void audioReady;
  const options = parseLaunchQuery(query);
  // Native main chooses random entropy once, so the title and Start share the same world.
  if (options.world === 'Random' && options.seed === undefined)
    options.seed = crypto.getRandomValues(new Uint32Array(1))[0];
  runtime = await startNativeGame(element, options, backend, tvg, false);
  if (abandoned) {
    await runtime.dispose();
    return;
  }
  runtime.host.render(0);
  startupSound?.fadeOut(0.15);
  await splash.finish();
  startupFinished = true;
  startupSound?.dispose();
  runtime.host.start();
  return runtime;
})()
  .then((runtime) => {
    if (runtime && query.has('test'))
      Object.defineProperty(window, 'goldfantasy', { value: runtime, configurable: true });
  })
  .catch((error) => {
    abandoned = true;
    splash.dispose();
    startupFinished = true;
    startupSound?.dispose();
    audio.dispose();
    if (runtime) void runtime.dispose().catch(console.error);
    else void audio.context?.close().catch(() => {});
    console.error(error);
    const status = document.createElement('pre');
    status.id = 'startup-error';
    status.textContent = error instanceof Error ? error.message : String(error);
    document.body.append(status);
  });

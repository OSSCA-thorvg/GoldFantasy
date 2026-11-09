import { startNativeGame } from './bootstrap';
import { parseLaunchQuery } from './launch-options';
import './native.css';
const element = document.querySelector('#world');
if (!(element instanceof HTMLCanvasElement)) throw new Error('Midgard canvas is missing.');
const query = new URLSearchParams(location.search),
  renderer = query.get('renderer');
void (async () => {
  const options = parseLaunchQuery(query);
  // Native main chooses random entropy once, so the title and Start share the same world.
  if (options.world === 'Random' && options.seed === undefined)
    options.seed = crypto.getRandomValues(new Uint32Array(1))[0];
  return startNativeGame(
    element,
    options,
    renderer === 'sw' ? 'sw' : renderer === 'wg' || renderer === 'wgpu' ? 'wg' : 'gl',
  );
})()
  .then((runtime) => {
    if (query.has('test'))
      Object.defineProperty(window, 'goldfantasy', { value: runtime, configurable: true });
  })
  .catch((error) => {
    console.error(error);
    const status = document.createElement('pre');
    status.id = 'startup-error';
    status.textContent = error instanceof Error ? error.message : String(error);
    document.body.append(status);
  });

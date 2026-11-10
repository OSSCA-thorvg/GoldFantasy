import type { Canvas, ThorVGNamespace } from '@thorvg/webcanvas';
import { Key } from '../../../../packages/native-ui/src';
import { emptyEvent, type Application, type AppEvent } from './application-contracts';
import { applicationCursor } from './browser-cursor';
import { invalidateWebCanvasRasterResources } from '../../../../packages/native-renderer/src/webcanvas-adapter';

const keys = new Map<string, Key>([
  ['Tab', Key.Tab],
  ['Enter', Key.Enter],
  [' ', Key.Space],
  ['Escape', Key.Escape],
  ['ArrowLeft', Key.Left],
  ['ArrowRight', Key.Right],
  ['ArrowUp', Key.Up],
  ['ArrowDown', Key.Down],
  ['Home', Key.Home],
  ['End', Key.End],
  ['Backspace', Key.Backspace],
  ['Delete', Key.Delete],
]);
const nativeKey = (key: string): string =>
  key === ' '
    ? 'space'
    : key === 'Enter'
      ? 'return'
      : key.startsWith('Arrow')
        ? key.slice(5).toLowerCase()
        : key.toLowerCase();
export interface BrowserHostOptions {
  autoStart?: boolean;
  devicePixelRatio?: boolean;
}
/** Browser event/device boundary. Every visible control is painted by the original ThorVG UI. */
export class BrowserHost {
  private canvas: Canvas;
  private readonly devicePixelRatio: boolean;
  private readonly events = new AbortController();
  private readonly resizeObserver: ResizeObserver;
  private readonly textInput: HTMLTextAreaElement;
  private composing = false;
  private frame = 0;
  private running = false;
  private closed = false;
  private surfaceLost = false;
  private resumeAfterRestore = false;
  private renderedAt = 0;
  private width = 0;
  private height = 0;
  private readonly pressed = new Set<string>();
  private readonly started = performance.now();
  constructor(
    private readonly element: HTMLCanvasElement,
    private readonly tvg: ThorVGNamespace,
    readonly app: Application,
    options: BrowserHostOptions = {},
  ) {
    this.devicePixelRatio = options.devicePixelRatio ?? true;
    this.canvas = this.createCanvas();
    this.canvas.add(app.scene());
    element.tabIndex = 0;
    this.textInput = document.createElement('textarea');
    this.textInput.dataset.goldfantasyTextInput = '';
    this.textInput.setAttribute('aria-label', 'Game text input');
    this.textInput.tabIndex = -1;
    this.textInput.autocomplete = 'off';
    this.textInput.autocapitalize = 'off';
    this.textInput.spellcheck = false;
    this.textInput.style.cssText =
      'position:fixed;left:0;top:0;width:1px;height:1px;padding:0;border:0;opacity:0;pointer-events:none;resize:none;';
    document.body.append(this.textInput);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(element);
    this.resize();
    const signal = this.events.signal,
      dispatch = (event: AppEvent) => {
        if (!this.closed) {
          this.app.event(event);
          this.syncTextInput();
        }
      };
    element.addEventListener(
      'webglcontextlost',
      (event) => {
        if (this.closed || this.surfaceLost || this.canvas.renderer !== 'gl') return;
        event.preventDefault();
        const running = this.running;
        this.stop();
        this.resumeAfterRestore = running;
        this.surfaceLost = true;
        this.app.invalidatePresentation?.();
        this.releaseInput();
        this.canvas.remove();
        this.canvas.destroy();
      },
      { signal },
    );
    element.addEventListener(
      'webglcontextrestored',
      () => {
        if (this.closed || !this.surfaceLost) return;
        this.canvas = this.createCanvas();
        invalidateWebCanvasRasterResources();
        this.canvas.add(this.app.scene());
        this.surfaceLost = false;
        const resume = this.resumeAfterRestore;
        this.resumeAfterRestore = false;
        // Repaint the same simulation instant before resuming any animation loop.
        this.render(this.renderedAt);
        if (resume) this.start();
      },
      { signal },
    );
    const pointer = (type: AppEvent['type'], e: PointerEvent) => {
      const bounds = element.getBoundingClientRect(),
        event = emptyEvent(type);
      event.x = e.clientX - bounds.left;
      event.y = e.clientY - bounds.top;
      event.button = e.button + 1;
      event.shift = e.shiftKey;
      event.control = e.ctrlKey;
      event.alt = e.altKey;
      event.meta = e.metaKey;
      dispatch(event);
    };
    element.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
    element.addEventListener(
      'pointerdown',
      (e) => {
        e.preventDefault();
        element.focus({ preventScroll: true });
        element.setPointerCapture(e.pointerId);
        pointer('PointerDown', e);
      },
      { signal },
    );
    element.addEventListener('pointermove', (e) => pointer('PointerMove', e), { signal });
    element.addEventListener(
      'pointerup',
      (e) => {
        pointer('PointerUp', e);
        if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId);
      },
      { signal },
    );
    element.addEventListener('pointercancel', (e) => pointer('PointerCancel', e), { signal });
    element.addEventListener(
      'pointerleave',
      (e) => {
        if (e.buttons === 0) {
          const event = emptyEvent('PointerMove');
          event.x = event.y = -1;
          dispatch(event);
        }
      },
      { signal },
    );
    element.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const bounds = element.getBoundingClientRect(),
          event = emptyEvent('Wheel');
        event.x = e.clientX - bounds.left;
        event.y = e.clientY - bounds.top;
        event.delta = -e.deltaY / (e.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? 100 : 1);
        dispatch(event);
      },
      { passive: false, signal },
    );
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.ownsFocus() || this.composing || e.isComposing || e.keyCode === 229) return;
        const typing = document.activeElement === this.textInput;
        const event = emptyEvent('KeyDown');
        event.key = keys.get(e.key) ?? Key.Unknown;
        event.text = nativeKey(e.key);
        event.shift = e.shiftKey;
        event.control = e.ctrlKey;
        event.alt = e.altKey;
        event.meta = e.metaKey;
        this.pressed.add(event.text);
        dispatch(event);
        const editable = typing && (!keys.has(e.key) || e.key === ' ') && !/^F\d{1,2}$/.test(e.key);
        // Native key handling owns cursor/editing keys and app shortcuts. The
        // editable bridge owns committed text, including dead keys and IMEs.
        if (
          (!editable && !e.metaKey && !e.ctrlKey) ||
          ((e.metaKey || e.ctrlKey) && ['s', 'o', 'z', 'y'].includes(event.text))
        )
          e.preventDefault();
      },
      { signal },
    );
    window.addEventListener(
      'keyup',
      (e) => {
        if (!this.ownsFocus() || this.composing || e.isComposing || e.keyCode === 229) return;
        const event = emptyEvent('KeyUp');
        event.key = keys.get(e.key) ?? Key.Unknown;
        event.text = nativeKey(e.key);
        event.shift = e.shiftKey;
        event.control = e.ctrlKey;
        event.alt = e.altKey;
        event.meta = e.metaKey;
        if (!this.pressed.delete(event.text)) return;
        dispatch(event);
      },
      { signal },
    );
    this.textInput.addEventListener(
      'compositionstart',
      () => {
        this.composing = true;
      },
      { signal },
    );
    this.textInput.addEventListener(
      'compositionend',
      (e) => {
        this.composing = false;
        const event = emptyEvent('Text');
        event.text = e.data;
        this.textInput.value = '';
        if (event.text) dispatch(event);
      },
      { signal },
    );
    this.textInput.addEventListener(
      'input',
      (e) => {
        if (this.composing || (e instanceof InputEvent && e.isComposing)) return;
        const text = this.textInput.value;
        this.textInput.value = '';
        // Composition is committed by compositionend. Some engines also send a
        // final input event afterward; it must not insert the same text twice.
        if ((e instanceof InputEvent && e.inputType.includes('Composition')) || !text) return;
        const event = emptyEvent('Text');
        event.text = text;
        dispatch(event);
      },
      { signal },
    );
    window.addEventListener(
      'focusout',
      () => {
        queueMicrotask(() => {
          if (!this.closed && !this.ownsFocus()) this.releaseInput();
        });
      },
      { signal },
    );
    window.addEventListener('blur', () => this.releaseInput(), { signal });
    window.addEventListener('pagehide', () => this.dispose(), { signal });
    if (options.autoStart !== false) this.start();
  }
  private ownsFocus(): boolean {
    return (
      document.hasFocus() &&
      (document.activeElement === this.element || document.activeElement === this.textInput)
    );
  }
  private syncTextInput(): void {
    if (!this.ownsFocus()) return;
    const wanted = !this.app.command('ui.text-input', 'off');
    if (wanted && document.activeElement !== this.textInput) {
      const bounds = this.element.getBoundingClientRect();
      this.textInput.style.left = `${bounds.left}px`;
      this.textInput.style.top = `${bounds.top}px`;
      this.textInput.focus({ preventScroll: true });
    } else if (!wanted && document.activeElement === this.textInput) {
      this.textInput.value = '';
      this.element.focus({ preventScroll: true });
    }
  }
  private releaseInput(): void {
    for (const text of this.pressed) {
      const event = emptyEvent('KeyUp');
      event.text = text;
      this.app.event(event);
    }
    this.pressed.clear();
    this.app.event(emptyEvent('PointerCancel'));
  }
  private createCanvas(): Canvas {
    return new this.tvg.Canvas(this.element, {
      width: Math.max(1, this.element.clientWidth),
      height: Math.max(1, this.element.clientHeight),
      enableDevicePixelRatio: this.devicePixelRatio,
    });
  }
  private resize(): void {
    if (this.closed || this.surfaceLost) return;
    const width = Math.max(1, this.element.clientWidth),
      height = Math.max(1, this.element.clientHeight);
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.app.invalidatePresentation?.();
    this.canvas.resize(width, height);
  }
  render(seconds = (performance.now() - this.started) / 1000): void {
    if (this.closed || this.surfaceLost) return;
    this.resize();
    this.renderedAt = seconds;
    this.app.render(this.width, this.height, seconds);
    if (this.closed || this.surfaceLost) return;
    this.syncTextInput();
    this.canvas.update().render();
    this.app.presented?.(this.canvas.dpr);
    this.element.style.cursor = applicationCursor(this.app);
  }
  start(): void {
    if (this.closed) return;
    this.running = true;
    if (this.frame) return;
    if (this.surfaceLost) {
      this.resumeAfterRestore = true;
      return;
    }
    const draw = () => {
      this.frame = 0;
      if (this.closed) return;
      this.render();
      if (this.running && !this.closed && !this.surfaceLost) this.frame = requestAnimationFrame(draw);
    };
    this.frame = requestAnimationFrame(draw);
  }
  stop(): void {
    this.running = false;
    this.resumeAfterRestore = false;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.stop();
    this.events.abort();
    this.resizeObserver.disconnect();
    this.textInput.remove();
    if (!this.surfaceLost) this.canvas.remove();
    this.app.dispose();
    if (!this.surfaceLost) this.canvas.destroy();
  }
}

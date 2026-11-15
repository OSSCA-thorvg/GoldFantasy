// The opening saga shown before a new game: six narrated storybook panels.
import type { Paint, ThorVGNamespace } from '@thorvg/webcanvas';
import { PictureNode, SceneNode, ShapeNode } from '../../../../packages/native-renderer/src/paint';
import { WebCanvasAdapter } from '../../../../packages/native-renderer/src/webcanvas-adapter';
import { sharedAudioContext } from '../../../../packages/native-audio/src/browser-audio';
import { wakingPanel } from '../../../../packages/native-renderer/src/saga-waking-panel';
import {
  sagaHeight,
  sagaWidth,
  type SagaArt,
  type SagaPanel,
} from '../../../../packages/native-renderer/src/saga-panel';
import {
  shapingPanel,
  slayingPanel,
  voidPanel,
} from '../../../../packages/native-renderer/src/saga-creation-panels';
import { remainsPanel, risingPanel } from '../../../../packages/native-renderer/src/saga-descent-panels';

interface Beat {
  panel: (art: SagaArt) => SagaPanel;
  /** Caption phrases, shown one at a time in step with the narration. */
  lines: string[];
  /** Length of the narration take, in seconds. */
  spoken: number;
}
export const sagaBeats: Beat[] = [
  {
    panel: voidPanel,
    lines: ['Before the world, there was only the void...', 'and in the void, Ymir, the first giant.'],
    spoken: 7.5,
  },
  {
    panel: slayingPanel,
    lines: ['Odin and his brothers rose against him...', 'and the giant fell.'],
    spoken: 5,
  },
  {
    panel: shapingPanel,
    lines: [
      'From his body, they shaped the land.',
      'His flesh became the earth. His blood, the sea.',
      'His bones, the mountains.',
      'They named it... Midgard.',
    ],
    spoken: 12.3,
  },
  {
    panel: remainsPanel,
    lines: [
      'But not all of the giant was laid to rest.',
      'Deep beneath the land, what remains of him still festers.',
    ],
    spoken: 8.3,
  },
  {
    panel: risingPanel,
    lines: ['And from those depths, foul things climb toward the light.'],
    spoken: 4.8,
  },
  {
    panel: wakingPanel,
    lines: ['Now, you wake upon the shore.', 'Seal the gates. Drive them back into the dark.'],
    spoken: 7.2,
  },
];
const leadIn = 0.7;
const leadOut = 1.5;
const fadeIn = 0.9;
const fadeOut = 0.7;
const bedVolume = 0.3;

/** One narration take or the music bed, played on the game's own audio context. */
class SagaClip {
  private buffer: AudioBuffer | undefined;
  private source: AudioBufferSourceNode | undefined;
  private gain: GainNode | undefined;
  private wanted = false;
  private stopped = false;
  constructor(
    private readonly context: AudioContext,
    path: string,
    private volume: number,
  ) {
    void fetch(`${import.meta.env?.BASE_URL ?? '/'}assets/audio/${path}`)
      .then((response) => response.arrayBuffer())
      .then((bytes) => context.decodeAudioData(bytes))
      .then((buffer) => {
        this.buffer = buffer;
        if (this.wanted) this.play();
      })
      // The captions carry the story if a take cannot be loaded.
      .catch(() => {});
  }
  play(): void {
    this.wanted = true;
    if (!this.buffer || this.source || this.stopped) return;
    void this.context.resume().catch(() => {});
    this.gain = this.context.createGain();
    this.gain.gain.value = this.volume;
    this.gain.connect(this.context.destination);
    this.source = this.context.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.connect(this.gain);
    this.source.start();
  }
  level(volume: number): void {
    this.volume = volume;
    if (this.gain) this.gain.gain.value = volume;
  }
  stop(): void {
    this.stopped = true;
    try {
      this.source?.stop();
    } catch {
      // Already ended.
    }
    this.gain?.disconnect();
  }
}
const clip = (path: string, volume: number): SagaClip | undefined => {
  const context = sharedAudioContext();
  return context && typeof fetch === 'function' ? new SagaClip(context, path, volume) : undefined;
};

/** Decodes an image under `assets/` into a picture node; the node stays 1 x 1 if that fails. */
async function loadPicture(path: string, into: PictureNode): Promise<void> {
  if (typeof fetch !== 'function' || typeof createImageBitmap !== 'function') return;
  try {
    const response = await fetch(`${import.meta.env?.BASE_URL ?? '/'}assets/${path}`),
      bitmap = await createImageBitmap(await response.blob()),
      context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d');
    if (!context) return;
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
    into.load(new Uint8Array(pixels.data.buffer), bitmap.width, bitmap.height);
  } catch {
    // The drawn map remains.
  }
}

export class IntroSaga {
  private readonly adapter: WebCanvasAdapter;
  private readonly root = new SceneNode();
  private readonly ground = new ShapeNode();
  private readonly frame = new SceneNode();
  private readonly window = new SceneNode();
  private readonly border = new ShapeNode();
  private readonly takes: (SagaClip | undefined)[];
  private readonly bed: SagaClip | undefined;
  private panel: SagaPanel | undefined;
  private index = -1;
  private time = 0;
  private clock = 0;
  private spoke = false;
  private effects: SagaClip[] = [];
  private fired = 0;
  private ringing: SagaClip[] = [];
  private readonly art: SagaArt = { world: new PictureNode(new Uint8Array(4), 1, 1) };
  private done = false;
  private width = -1;
  private height = -1;
  private posed = false;
  private posedArt = -1;
  private collectPending = true;
  readonly paint: Paint;

  constructor(
    tvg: ThorVGNamespace,
    private readonly still = false,
  ) {
    this.adapter = new WebCanvasAdapter(tvg);
    this.window.clip(new ShapeNode().appendRect(0, 0, sagaWidth, sagaHeight));
    this.border
      .appendRect(0, 0, sagaWidth, sagaHeight)
      .strokeFill(196, 176, 132, 200)
      .strokeWidth(3)
      .strokeJoin('miter');
    this.frame.add(this.window).add(this.border);
    this.root.add(this.ground).add(this.frame);
    this.takes = sagaBeats.map((_, i) => clip(`narration/en/intro_${i + 1}.ogg`, 1));
    this.bed = clip('music/dawn/saga_world_tree.ogg', bedVolume);
    this.bed?.play();
    void loadPicture('saga/midgard.jpg', this.art.world);
    this.turnTo(0);
    this.paint = this.adapter.sync(this.root);
  }
  private length(): number {
    return leadIn + sagaBeats[this.index].spoken + leadOut;
  }
  private turnTo(index: number): void {
    this.takes[this.index]?.stop();
    if (index >= sagaBeats.length) {
      this.done = true;
      return;
    }
    this.index = index;
    this.time = 0;
    this.spoke = false;
    this.fired = 0;
    this.posed = false;
    this.collectPending = true;
    if (this.panel) this.window.remove(this.panel.scene);
    // A long sound, like the giant's fall, rings on under the next panel.
    this.ringing.push(...this.effects);
    this.panel = sagaBeats[index].panel(this.art);
    // Loaded with the panel so each is ready by its moment.
    this.effects = (this.panel.cues ?? []).flatMap((cue) => clip(`${cue.sound}.ogg`, cue.volume) ?? []);
    this.window.add(this.panel.scene);
  }
  /** Returns false once the last panel has faded out. */
  advance(dt: number, width: number, height: number): boolean {
    if (this.done) return false;
    this.time += dt;
    this.clock += dt;
    if (this.time >= this.length()) this.turnTo(this.index + 1);
    if (this.done) return false;
    if (!this.spoke && this.time >= leadIn) {
      this.spoke = true;
      this.takes[this.index]?.play();
    }
    const cues = this.panel?.cues ?? [];
    while (this.fired < cues.length && this.time / this.length() >= cues[this.fired].at)
      this.effects[this.fired++]?.play();
    const length = this.length(),
      shown = Math.min(1, this.time / fadeIn, (length - this.time) / fadeOut),
      band = Math.max(64, Math.min(128, height * 0.17)),
      pad = Math.min(36, width * 0.03),
      k = Math.max(0.01, Math.min((width - pad * 2) / sagaWidth, (height - band - pad) / sagaHeight));
    if (this.bed && this.index === sagaBeats.length - 1)
      this.bed.level(bedVolume * Math.max(0, Math.min(1, (length - this.time) / 3)));
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      this.ground.reset().appendRect(0, 0, width, height).fill(8, 8, 14);
      this.frame.transform([
        k,
        0,
        (width - sagaWidth * k) / 2,
        0,
        k,
        pad + (height - band - pad - sagaHeight * k) / 2,
        0,
        0,
        1,
      ]);
    }
    const opacity = Math.round(255 * Math.max(0, shown));
    if (this.frame.alpha !== opacity) this.frame.opacity(opacity);
    if (!this.still || !this.posed || this.posedArt !== this.art.world.dataVersion) {
      this.panel?.pose(this.still ? 0.8 : this.time / length, this.still ? 0 : this.clock);
      this.posed = true;
      this.posedArt = this.art.world.dataVersion;
    }
    this.adapter.sync(this.root);
    if (this.collectPending) {
      this.adapter.collect([this.root]);
      this.collectPending = false;
    }
    return true;
  }
  /** The phrase being spoken and how visible it is, 0..1. */
  caption(): { text: string; shown: number } {
    if (this.done || this.index < 0) return { text: '', shown: 0 };
    const beat = sagaBeats[this.index],
      total = beat.lines.reduce((sum, line) => sum + line.length, 0),
      spoken = beat.spoken;
    let from = leadIn;
    for (const [i, line] of beat.lines.entries()) {
      const last = i === beat.lines.length - 1,
        until = last ? this.length() - fadeOut / 2 : from + (spoken * line.length) / total;
      if (this.time < until || last)
        return {
          text: line,
          shown: Math.max(0, Math.min(1, (this.time - from) / 0.35, (until - this.time) / 0.3)),
        };
      from = until;
    }
    return { text: '', shown: 0 };
  }
  /** Where the panel sits on screen, so captions can be set under it. */
  captionTop(width: number, height: number): number {
    const band = Math.max(64, Math.min(128, height * 0.17)),
      pad = Math.min(36, width * 0.03),
      k = Math.min((width - pad * 2) / sagaWidth, (height - band - pad) / sagaHeight);
    return pad + (height - band - pad - sagaHeight * k) / 2 + sagaHeight * k;
  }
  next(): void {
    if (!this.done) this.turnTo(this.index + 1);
  }
  skip(): void {
    this.takes[this.index]?.stop();
    this.done = true;
  }
  dispose(): void {
    for (const take of this.takes) take?.stop();
    this.bed?.stop();
    for (const effect of [...this.effects, ...this.ringing]) effect.stop();
    this.adapter.dispose();
  }
}

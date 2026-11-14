// The whole opening saga as a video with its own narration, music bed and panel effects, captions as the game sets
// them. The picture is the game's IntroSaga; the sound is mixed from the same files at the times the saga plays them.
import { resolve } from 'node:path';
import { root } from '../readme-media/capture-session.mjs';
import { docsWork, encodeVideo, ffmpeg, recordFrames } from './video-assembly.mjs';

export async function captureOpeningVideo(session) {
  const width = 1280,
    height = 720,
    fps = 30,
    page = await session.page(width, height);
  try {
    const plan = await page.evaluate(
      async ({ width, height }) => {
        const [{ initializeWebCanvas }, { IntroSaga, sagaBeats }, { PictureNode }] = await Promise.all([
          import('/apps/web/src/native/startup-canvas.ts'),
          import('/apps/web/src/native/intro-saga.ts'),
          import('/packages/native-renderer/src/paint.ts'),
        ]);
        const tvg = await initializeWebCanvas('gl'),
          element = document.createElement('canvas');
        document.body.append(element);
        const canvas = new tvg.Canvas(element, { width, height, enableDevicePixelRatio: false }),
          saga = new IntroSaga(tvg);
        canvas.add(saga.paint);
        // The game draws the caption in its own HUD; here a page element in the same face, colour and place.
        const font = new FontFace('Saga', 'url(/assets/native-fonts/DejaVuSans.ttf)');
        try {
          await font.load();
          document.fonts.add(font);
        } catch {
          // The fallback face still reads.
        }
        const caption = document.createElement('div');
        caption.style.cssText = 'position:absolute;left:8px;right:8px;text-align:center;color:rgb(236,226,204);font-family:Saga,DejaVu Sans,sans-serif;white-space:nowrap';
        document.body.append(caption);
        await new Promise((done) => setTimeout(done, 1500));
        let ended = false;
        window.saga = {
          advance(dt) {
            if (!ended && !saga.advance(dt, width, height)) ended = true;
            canvas.update().render();
            const { text, shown } = saga.caption(),
              top = saga.captionTop(width, height),
              band = height - top,
              size = Math.min(34, Math.max(14, band * 0.3));
            caption.textContent = text;
            caption.style.opacity = String(Math.max(0, shown));
            caption.style.fontSize = `${size}px`;
            caption.style.top = `${top + band * 0.18 + (band * 0.5 - size * 1.2) / 2}px`;
            return ended;
          },
        };
        // When each sound starts: narration after the lead-in, panel effects at their share of the panel.
        const leadIn = 0.7,
          leadOut = 1.5,
          sounds = [{ path: 'music/dawn/saga_world_tree.ogg', at: 0, volume: 0.3 }];
        let start = 0;
        sagaBeats.forEach((beat, i) => {
          const length = leadIn + beat.spoken + leadOut,
            panel = beat.panel({ world: new PictureNode(new Uint8Array(4), 1, 1) });
          sounds.push({ path: `narration/en/intro_${i + 1}.ogg`, at: start + leadIn, volume: 1 });
          for (const cue of panel.cues ?? []) sounds.push({ path: `${cue.sound}.ogg`, at: start + cue.at * length, volume: cue.volume });
          start += length;
        });
        return { sounds, seconds: start };
      },
      { width, height },
    );
    const frames = await recordFrames(page, 'opening', {
      count: Math.ceil(plan.seconds * fps) + fps,
      step: ([i, dt]) => window.saga.advance(i === 0 ? 0.001 : dt),
      arg: 1 / fps,
    });
    // The bed fades out over the last panel's final three seconds, as the saga does.
    const inputs = plan.sounds.flatMap((s) => ['-i', resolve(root, 'public/assets/audio', s.path)]),
      chains = plan.sounds.map((s, k) => {
        const fade = k === 0 ? `,afade=t=out:st=${(plan.seconds - 3).toFixed(2)}:d=3` : '';
        return `[${k}:a]aresample=44100,aformat=channel_layouts=stereo,volume=${s.volume}${fade},adelay=${Math.round(s.at * 1000)}:all=1[a${k}]`;
      }),
      mix = `${chains.join(';')};${plan.sounds.map((_, k) => `[a${k}]`).join('')}amix=inputs=${plan.sounds.length}:normalize=0:duration=longest,atrim=0:${(frames.frames / fps).toFixed(2)}[out]`,
      wav = resolve(docsWork, 'opening.wav');
    ffmpeg([...inputs, '-filter_complex', mix, '-map', '[out]', wav]);
    return { opening: { ...(await encodeVideo('opening', { fps, width: 1280, audio: wav, crf: 24, posterAt: 6.6 })), seconds: plan.seconds, sounds: plan.sounds.length } };
  } finally {
    await page.context().close();
  }
}

// The first panel of the opening saga only: the giant wakes and opens his eyes. No caption, no later panel.
import { recordGif } from './capture-session.mjs';

export async function captureOpening(session) {
  const width = 1280,
    height = 800,
    page = await session.page(width, height);
  try {
    const frame = await page.evaluate(
      async ({ width, height }) => {
        const [{ initializeWebCanvas }, { IntroSaga }, { sagaWidth, sagaHeight }] = await Promise.all([
          import('/apps/web/src/native/startup-canvas.ts'),
          import('/apps/web/src/native/intro-saga.ts'),
          import('/packages/native-renderer/src/saga-panel.ts'),
        ]);
        const tvg = await initializeWebCanvas('gl'),
          element = document.createElement('canvas');
        document.body.append(element);
        const canvas = new tvg.Canvas(element, { width, height, enableDevicePixelRatio: false }),
          saga = new IntroSaga(tvg);
        canvas.add(saga.paint);
        // The pictures load in the background; the first panel draws none of them, but wait for the frame to settle.
        await new Promise((done) => setTimeout(done, 500));
        window.saga = {
          advance(dt) {
            if (!saga.advance(dt, width, height)) throw new Error('The first panel ended early');
            canvas.update().render();
          },
        };
        // The same placement the saga uses for its framed window, so the GIF is the picture alone.
        const band = Math.max(64, Math.min(128, height * 0.17)),
          pad = Math.min(36, width * 0.03),
          k = Math.min((width - pad * 2) / sagaWidth, (height - band - pad) / sagaHeight);
        return {
          x: Math.round((width - sagaWidth * k) / 2),
          y: Math.round(pad + (height - band - pad - sagaHeight * k) / 2),
          width: Math.round(sagaWidth * k),
          height: Math.round(sagaHeight * k),
        };
      },
      { width, height },
    );
    // The panel lasts 9.7 s from black to black; shown at 1.5 times its pace so the GIF stays short and loops on black.
    return {
      opening: await recordGif(page, 'opening', {
        count: 65,
        fps: 10,
        width: 720,
        colors: 192,
        clip: frame,
        step: ([i]) => window.saga.advance(i === 0 ? 0.01 : 0.15),
      }),
    };
  } finally {
    await page.context().close();
  }
}

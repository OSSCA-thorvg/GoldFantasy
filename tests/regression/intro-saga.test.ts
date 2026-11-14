import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { IntroSaga, sagaBeats } from '../../apps/web/src/native/intro-saga';
import { korean } from '../../packages/localization/src/korean';

let tvg: ThorVGNamespace;
beforeAll(async () => {
  vi.stubGlobal('OffscreenCanvas', class {});
  const bytes = readFileSync('node_modules/@thorvg/webcanvas/dist/thorvg.wasm');
  tvg = await ThorVG.init({
    renderer: 'sw',
    locateFile: () => `data:application/wasm;base64,${bytes.toString('base64')}`,
  });
});
afterAll(() => {
  tvg.term();
  vi.unstubAllGlobals();
});

describe('the opening saga', () => {
  it('tells every phrase of every panel in order, then ends', () => {
    const saga = new IntroSaga(tvg),
      told: string[] = [];
    try {
      for (let frame = 0; frame < 2000 && saga.advance(0.1, 1280, 800); frame++) {
        const { text, shown } = saga.caption();
        if (shown > 0 && told.at(-1) !== text) told.push(text);
      }
      expect(told).toEqual(sagaBeats.flatMap((beat) => beat.lines));
      expect(saga.advance(0.1, 1280, 800)).toBe(false);
    } finally {
      saga.dispose();
    }
  });
  it('moves on a panel at a time when asked, and stops at once when skipped', () => {
    const saga = new IntroSaga(tvg, true);
    try {
      saga.advance(1.2, 400, 700);
      expect(saga.caption().text).toBe(sagaBeats[0].lines[0]);
      saga.next();
      saga.advance(1.2, 400, 700);
      expect(saga.caption().text).toBe(sagaBeats[1].lines[0]);
      saga.skip();
      expect(saga.advance(0.1, 400, 700)).toBe(false);
    } finally {
      saga.dispose();
    }
  });
  it('has a Korean caption for every phrase', () => {
    for (const line of sagaBeats.flatMap((beat) => beat.lines)) expect(korean.translate(line)).not.toBe(line);
  });
});

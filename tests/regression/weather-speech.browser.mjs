import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

let server,
  browser,
  closed = false;
let releaseHammer, releaseWeather;
const hammerGate = new Promise((resolve) => (releaseHammer = resolve));
const weatherGate = new Promise((resolve) => (releaseWeather = resolve));
const errors = [];
try {
  server = await createServer({
    logLevel: 'error',
    plugins: [
      {
        name: 'weather-speech-probe',
        configureServer(server) {
          server.middlewares.use('/weather-speech-probe', (_request, response) => {
            response.setHeader('Content-Type', 'text/html');
            response.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><button style="width:200px;height:100px">Enable sound</button><script type="module">
            import { BrowserSoundDevice, disposeNativeAudio } from '/packages/native-audio/src/browser-audio.ts';
            import { Cue, Sound, VoiceKind, VoiceLine } from '/packages/native-audio/src/sound-types.ts';
            import { SoundLibrary, sounds } from '/packages/native-audio/src/sound-library.ts';
            import { voicePrefix } from '/packages/native-audio/src/spoken-voice.ts';
            import { SoundBoard } from '/packages/native-audio/src/sound-board.ts';
            import { PersonSpeech } from '/packages/native-audio/src/person-speech.ts';
            import endings from '/packages/native-audio/src/data/effect-endings.json';
            const device = new BrowserSoundDevice();
            window.probe = { device, ready: false, events: [], dispose: disposeNativeAudio };
            probe.prepare = () => {
              const s = new Sound(Cue.PrepareSpeech); s.voice = VoiceKind.Huntress; s.line = VoiceLine.Thunder;
              device.play(s);
            };
            probe.speak = () => {
              const s = new Sound(Cue.Speech); s.voice = VoiceKind.Huntress; s.line = VoiceLine.Thunder;
              s.speaker = 3; s.delay = .35; s.take = 1;
              const name = sounds.name(voicePrefix(s.line, s.voice), s.take);
              s.duration = sounds.duration(name); device.play(s); return { name, duration: s.duration };
            };
            probe.offline = async () => {
              const library = new SoundLibrary(endings), rows = [];
              for (let voice = 0; voice < VoiceKind.Count; voice++) {
                for (const [line, count] of [[VoiceLine.Rain, 2], [VoiceLine.Snow, 2], [VoiceLine.Thunder, 3]]) {
                  const prefix = voicePrefix(line, voice);
                  if (library.count(prefix) !== count) throw new Error('Missing weather takes: ' + prefix);
                  for (let take = 0; take < count; take++) {
                    const name = library.name(prefix, take);
                    await library.load(undefined, name);
                    const clip = library.clip(prefix, take);
                    if (!clip.pcm?.some((v) => v !== 0)) throw new Error('Silent decoded weather: ' + name);
                    sounds.setClip(name, clip.pcm, clip.rate);
                    const speech = new PersonSpeech();
                    if (!speech.say(line, 2, 1, voice, take) || speech.voice() !== line || speech.text() !== library.caption(name))
                      throw new Error('Recorded caption routing failed: ' + name);
                    const sound = new Sound(Cue.Speech); sound.voice = voice; sound.line = line; sound.take = take;
                    sound.speaker = voice; sound.duration = clip.duration(); sound.delay = .25;
                    const board = new SoundBoard(); board.play(sound);
                    if (board.voices.length !== 1 || board.voices[0].clip.pcm !== clip.pcm)
                      throw new Error('Mixer did not use the recorded take: ' + name);
                    const count = Math.ceil((sound.delay + sound.duration + .1) * 44100);
                    let before = 0, after = 0, first = -1, finite = true;
                    for (let at = 0; at < count; at += 128) {
                      const n = Math.min(128, count - at), pcm = new Float32Array(n * 2);
                      board.render(pcm, n);
                      for (let i = 0; i < n; i++) {
                        const v = pcm[i * 2]; finite &&= Number.isFinite(v);
                        if ((at + i) / 44100 < .249) before += v * v; else after += v * v;
                        if (first < 0 && Math.abs(v) > .00001) first = (at + i) / 44100;
                      }
                    }
                    rows.push({ name, frames: clip.frames, duration: speech.voiceDuration(), caption: speech.text(), before, after, first, finite });
                  }
                }
              }
              return rows;
            };
            await device.ready;
            const node = device.node, post = node.port.postMessage.bind(node.port);
            node.port.postMessage = (message, ...rest) => {
              probe.events.push({ kind: message.kind, sound: message.sound, names: message.clips?.map((clip) => clip.name) });
              return post(message, ...rest);
            };
            const analyser = device.session.context.createAnalyser(); analyser.fftSize = 2048; node.connect(analyser);
            probe.sample = () => {
              const pcm = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(pcm);
              return Math.sqrt(pcm.reduce((sum, v) => sum + v * v, 0) / pcm.length);
            };
            device.fadeIn(.01); probe.ready = true;
          </script>`);
          });
        },
      },
    ],
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({
    headless: true,
    args: ['--mute-audio', '--autoplay-policy=document-user-activation-required'],
  });
  const page = await browser.newPage({
    viewport: { width: 400, height: 700 },
    isMobile: true,
    hasTouch: true,
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/assets/audio/sfx/hammer_01.ogg', async (route) => {
    await hammerGate;
    if (!closed) await route.continue();
  });
  await page.route(/\/assets\/audio\/voice\/[^/]+\/(rain|snow|thunder)_\d+\.ogg$/, async (route) => {
    await weatherGate;
    if (!closed) await route.continue();
  });
  const cdp = await page.context().newCDPSession(page);
  const read = async (expression) => {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: false,
    });
    if (result.exceptionDetails)
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const until = async (expression) => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (await read(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('Timed out: ' + expression + '; errors=' + JSON.stringify(errors));
  };
  await page.goto(`${origin}/weather-speech-probe`);
  await until('!!window.probe?.device');
  assert.equal(await read('probe.device.session.context.state'), 'suspended');
  assert.equal(await read('probe.ready'), false);
  await page.touchscreen.tap(70, 50);
  await until('probe.device.session.context.state === "running"');
  releaseHammer();
  await until('probe.ready');
  assert.equal(await read('probe.sample()'), 0, 'No ambient/music can masquerade as speech');
  await read('probe.prepare()');
  assert.equal(await read('probe.events.some((event) => event.kind === "play")'), false);
  releaseWeather();
  await until('[1,2,3].every((n) => probe.device.session.library.hasClip("voice/huntress/thunder_0" + n))');
  assert.equal(await read('probe.sample()'), 0, 'Preparing recorded lines must remain silent');
  const requested = await read('probe.speak()');
  await until('probe.sample() > .0001');
  const routing = await read('probe.events');
  const playIndex = routing.findIndex((event) => event.kind === 'play');
  assert.ok(playIndex >= 0);
  assert.ok(
    routing
      .slice(0, playIndex)
      .some((event) => event.kind === 'clips' && event.names.includes(requested.name)),
  );
  assert.equal(routing[playIndex].sound.delay, 0.35);
  assert.equal(routing[playIndex].sound.take, 1);
  assert.equal(routing[playIndex].sound.duration, requested.duration);
  await read('probe.device.session.context.suspend()');
  assert.equal(await read('probe.device.session.context.state'), 'suspended');
  await page.touchscreen.tap(70, 50);
  await until('probe.device.session.context.state === "running"');
  const rows = await read('probe.offline()');
  assert.equal(rows.length, 35);
  for (const row of rows) {
    assert.equal(row.finite, true, row.name);
    assert.equal(row.before, 0, row.name + ': played before scheduled reaction');
    assert.ok(row.after > 0.001, row.name + ': recorded PCM was not mixed');
    assert.ok(row.first >= 0.249 && row.first < 0.25 + row.duration, row.name);
    assert.ok(row.caption.length > 0 && row.frames > 0, row.name);
  }
  await read('probe.dispose()');
  assert.equal(await read('probe.device.session.context.state'), 'closed');
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      strictMobileEarlyTouch: true,
      prepareIsSilent: true,
      liveWorkletRecordedSpeech: requested.name,
      laterSuspensionResumes: true,
      decodedWeatherTakes: rows.length,
      scheduledPcmChecks: rows.map(({ name, before, after, first }) => ({ name, before, after, first })),
      errors,
    }),
  );
} finally {
  closed = true;
  releaseHammer();
  releaseWeather();
  await browser?.close();
  await server?.close();
}

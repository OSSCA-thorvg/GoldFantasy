import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const port = Number(process.env.AUDIO_TEST_PORT ?? 0);
let server,
  browser,
  closed = false;
let releaseHammer, releaseVoice;
const hammerGate = new Promise((resolve) => (releaseHammer = resolve));
const voiceGate = new Promise((resolve) => (releaseVoice = resolve));
const errors = [],
  requests = [];
try {
  const probePage = (_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><button style="width:200px;height:100px">Enable sound</button><script type="module">
      import { BrowserSoundDevice, prepareNativeAudio, disposeNativeAudio } from '/packages/native-audio/src/browser-audio.ts';
      import { Ambience, Cue, Sound, VoiceKind, VoiceLine } from '/packages/native-audio/src/sound-types.ts';
      window.probe={ready:false,events:[],dispose:disposeNativeAudio};
      const device=new BrowserSoundDevice(); probe.device=device;
      const ambience=new Ambience(); ambience.wind=.6; ambience.birds=.5; ambience.woods=.5; ambience.hammering=.4;
      device.setAmbience(ambience); device.fadeIn(.05);
      const tune=new Sound(Cue.Music); tune.track='music/build/day_hammer_harvest'; device.play(tune);
      await device.ready; probe.ready=true;
      const node=device.node, post=node.port.postMessage.bind(node.port);
      node.port.postMessage=(message,...rest)=>{probe.events.push(message.kind); return post(message,...rest);};
      const analyser=device.session.context.createAnalyser(); analyser.fftSize=2048; node.connect(analyser); probe.analyser=analyser;
      probe.sample=()=>{const pcm=new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(pcm); return Math.sqrt(pcm.reduce((sum,x)=>sum+x*x,0)/pcm.length);};
      probe.speak=()=>{const s=new Sound(Cue.Speech); s.voice=VoiceKind.Berserker; s.line=VoiceLine.Ack; s.speaker=0; s.duration=10; device.play(s);};
      probe.resume=()=>device.session.context.suspend();
    </script>`);
  };
  server = await createServer({
    logLevel: 'error',
    plugins: [
      {
        name: 'audio-priority-probe',
        configureServer(server) {
          server.middlewares.use('/audio-priority-probe', probePage);
        },
      },
    ],
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port, hmr: false, watch: null },
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
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (r.url().endsWith('.ogg')) requests.push(r.url());
  });
  await page.route('**/assets/audio/sfx/hammer_01.ogg', async (route) => {
    await hammerGate;
    if (!closed) await route.continue();
  });
  await page.route('**/assets/audio/voice/berserker/ack_01.ogg', async (route) => {
    await voiceGate;
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const until = async (expression) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await read(expression)) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('Timed out: ' + expression + '; errors=' + JSON.stringify(errors));
  };
  await page.goto(`${origin}/audio-priority-probe`);
  await until('!!window.probe?.device');
  assert.equal(await read('probe.device.session.context.state'), 'suspended');
  assert.equal(await read('probe.ready'), false);
  await page.touchscreen.tap(70, 50);
  await until('probe.device.session.context.state === "running"');
  const isMusicRequest = (url) => url.includes('/music/build/day_hammer_harvest.ogg');
  // AudioContext state and request events arrive independently in Playwright.
  if (!requests.some(isMusicRequest)) {
    await page.waitForRequest((request) => isMusicRequest(request.url()), { timeout: 15000 });
  }
  assert.equal(await read('probe.ready'), false, 'Critical effects remain blocked during music fetch');
  assert.ok(
    requests.some(isMusicRequest),
    'Music fetch starts before critical effects finish',
  );
  releaseHammer();
  await until('probe.ready');
  await until('probe.sample() > .0001');
  assert.equal(await read('probe.device.session.library.hasClip("voice/berserker/ack_01")'), false);
  assert.ok(await read('probe.device.session.library.snapshot().clips.length < 290'));
  await read('probe.speak()');
  releaseVoice();
  await until('probe.device.session.library.hasClip("voice/berserker/ack_01")');
  await until('probe.events.includes("clips") && probe.events.includes("play")');
  await read('probe.resume()');
  assert.equal(await read('probe.device.session.context.state'), 'suspended');
  await page.touchscreen.tap(70, 50);
  await until('probe.device.session.context.state === "running"');
  await until('probe.sample() > .0001');
  await until('probe.device.session.library.snapshot().clips.length === 290');
  await read('probe.dispose()');
  assert.equal(await read('probe.device.session.context.state'), 'closed');
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      strictMobileTouchBeforeCriticalReady: true,
      musicFetchBeforeCriticalReady: true,
      audibleBeforeAll290Effects: true,
      incrementalClipInstallation: true,
      requestedVoicePlays: true,
      laterSuspensionResumes: true,
      all290Loaded: true,
      errors,
    }),
  );
} finally {
  closed = true;
  releaseHammer();
  releaseVoice();
  await browser?.close();
  await server?.close();
}

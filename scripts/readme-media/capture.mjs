// Rebuilds every image and GIF in the README from the running game.
// Usage: ORCA_BACKGROUND_LAUNCH=1 node scripts/readme-media/capture.mjs [scene ...]   (npm run media:readme)
// Needs ffmpeg on PATH and `npx playwright install chromium`. Frames and contact sheets go to artifacts/readme-media.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startSession, workFolder } from './capture-session.mjs';

// Each scene in its own file, loaded only when it runs.
const scenes = {
  opening: ['./opening-saga.mjs', 'captureOpening'],
  settlement: ['./settlement-scenes.mjs', 'captureSettlement'],
  weather: ['./weather-scenes.mjs', 'captureWeather'],
  crafting: ['./crafting-scene.mjs', 'captureCrafting'],
  army: ['./army-scenes.mjs', 'captureArmy'],
  hunt: ['./hunt-scene.mjs', 'captureHunt'],
  gods: ['./gods-scenes.mjs', 'captureGods'],
  altar: ['./altar-scene.mjs', 'captureAltar'],
  outlines: ['./forest-outlines.mjs', 'captureForestOutlines'],
  creative: ['./creative-scenes.mjs', 'captureCreativeTools'],
  interface: ['./interface-stills.mjs', 'captureInterface'],
};
const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
for (const name of wanted) if (!scenes[name]) throw new Error(`Unknown scene ${name}; known: ${Object.keys(scenes).join(', ')}`);
const report = { scenes: {}, errors: [] };
const session = await startSession();
const deadline = setTimeout(() => void session.close(), 45 * 60 * 1000);
try {
  for (const [name, [file, entry]] of Object.entries(scenes)) {
    if (wanted.length && !wanted.includes(name)) continue;
    const started = Date.now();
    process.stdout.write(`${name}...\n`);
    try {
      report.scenes[name] = await (await import(file))[entry](session);
    } catch (error) {
      report.errors.push(`${name}: ${error.stack ?? error}`);
      process.exitCode = 1;
    }
    process.stdout.write(`${name}: ${((Date.now() - started) / 1000).toFixed(0)} s\n`);
  }
  report.errors.push(...session.errors);
  if (session.errors.length) process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await session.close();
  await mkdir(workFolder, { recursive: true });
  await writeFile(
    resolve(workFolder, `report${wanted.length ? '-' + wanted.join('-') : ''}.json`),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));
}

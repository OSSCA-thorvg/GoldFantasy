// Rebuilds the videos of the presentation page (public/docs.html) from the running game.
// Usage: ORCA_BACKGROUND_LAUNCH=1 node scripts/docs-media/capture.mjs [part ...]   (npm run media:docs)
// Parts: opening, rigging, algorithms, perf, arc (one whole expedition with chapters), gameplay (the README scenes again at 30 fps, with their sound),
// assets (stills, wordmark, sound samples; after gameplay). Needs ffmpeg with libx264 and the AAC encoder.
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { root, startSession } from '../readme-media/capture-session.mjs';
import { docsFolder, docsWork, ffmpeg } from './video-assembly.mjs';

const parts = {
  opening: ['./opening-video.mjs', 'captureOpeningVideo'],
  rigging: ['./rigging-video.mjs', 'captureRiggingVideo'],
  algorithms: ['./algorithm-videos.mjs', 'captureAlgorithmVideos'],
  perf: ['./perf-video.mjs', 'capturePerfVideo'],
  arc: ['./dungeon-arc.mjs', 'captureDungeonArc'],
  optimisation: ['./optimisation-videos.mjs', 'captureOptimisationVideos'],
  environment: ['./environment-videos.mjs', 'captureEnvironmentVideos'],
  effects: ['./effects-showcase.mjs', 'captureEffectsShowcase'],
  buildings: ['./buildings-videos.mjs', 'captureBuildingVideos'],
};
const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-')),
  wants = (name) => !wanted.length || wanted.includes(name),
  report = { parts: {}, errors: [] };
const session = await startSession();
try {
  for (const [name, [file, entry]] of Object.entries(parts)) {
    if (!wants(name)) continue;
    process.stdout.write(`${name}...\n`);
    try {
      report.parts[name] = await (await import(file))[entry](session);
    } catch (error) {
      report.errors.push(`${name}: ${error.stack ?? error}`);
      process.exitCode = 1;
    }
  }
  report.errors.push(...session.errors);
} finally {
  await session.close();
}
// The README scenes that run at the pace of play, recorded again at 30 frames a second with the game's sound.
if (wants('gameplay')) {
  const result = spawnSync(
    process.execPath,
    [resolve(root, 'scripts/readme-media/capture.mjs'), 'army', 'gods', 'altar', 'weather', 'outlines', 'crafting', 'hunt', 'settlement'],
    {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        MEDIA_VIDEO_FPS: '30',
        MEDIA_ONLY: 'formation,army-fight,revive,thor-arrival,thor-night-hunt,jormungandr,altar,thunderstorm,rain,snow,forest-outlines,felling,workbench,hunt,town-life,day-night,construction',
      },
    },
  );
  if (result.status) report.errors.push(`gameplay: exit ${result.status}`);
}
// Stills, the wordmark and the sound samples, from the game's own files.
if (wants('assets')) {
  const copies = [
    ['apps/web/src/native/assets/midgard-wordmark.svg', 'wordmark.svg'],
    ['.github/media/midgard-expedition.png', 'expedition.png'],
  ];
  for (const [from, to] of copies) await copyFile(resolve(root, from), resolve(docsFolder, to));
  // A moment of the fight with its frost ring, numbers and bars, for the four-tier figure.
  ffmpeg(['-ss', '3.0', '-i', resolve(docsFolder, 'army-fight.mp4'), '-frames:v', '1', '-q:v', '3', resolve(docsFolder, 'combat-tiers.jpg')]);
  ffmpeg(['-ss', '6.6', '-i', resolve(docsFolder, 'opening.mp4'), '-frames:v', '1', '-q:v', '4', resolve(docsFolder, 'opening.jpg')]);
  await mkdir(resolve(docsFolder, 'audio'), { recursive: true });
  // AAC plays in every browser; long tracks are cut to a sample with a short fade.
  for (const [from, to, seconds] of [
    ['sfx/clash_01.ogg', 'clash', 0],
    ['sfx/combat/frost_01.ogg', 'frost', 0],
    ['sfx/coins_01.ogg', 'coins', 0],
    ['sfx/saga/giant_fall.ogg', 'giant-fall', 0],
    ['music/dawn/saga_world_tree.ogg', 'world-tree', 40],
    ['music/realm/niflheim_1.ogg', 'niflheim-1', 40],
    ['voice/maiden/ack_01.ogg', 'maiden', 0],
    ['voice/huntress/alarm_01.ogg', 'huntress', 0],
    ['voice/veteran/thanks_01.ogg', 'veteran', 0],
    ['narration/en/intro_1.ogg', 'narration', 0],
  ])
    ffmpeg([
      '-i',
      resolve(root, 'public/assets/audio', from),
      ...(seconds ? ['-t', String(seconds), '-af', `afade=t=out:st=${seconds - 3}:d=3`] : []),
      '-c:a',
      'aac',
      '-b:a',
      seconds ? '112k' : '96k',
      resolve(docsFolder, 'audio', `${to}.m4a`),
    ]);
  report.parts.assets = 'copied and transcoded';
  // Media the page no longer uses is not shipped.
  const { readdir, unlink } = await import('node:fs/promises'),
    page = await (await import('node:fs/promises')).readFile(resolve(root, 'public/docs.html'), 'utf8');
  for (const f of await readdir(docsFolder, { withFileTypes: true }))
    if (f.isFile() && !page.includes(`docs/${f.name}`)) await unlink(resolve(docsFolder, f.name));
}
await mkdir(docsWork, { recursive: true });
await writeFile(resolve(docsWork, `report${wanted.length ? '-' + wanted.join('-') : ''}.json`), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (report.errors.length) process.exitCode = 1;

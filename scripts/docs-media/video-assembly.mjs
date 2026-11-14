// Frames to H.264 MP4 (with an AAC track when there is sound) for the presentation page in public/docs.
import { spawnSync } from 'node:child_process';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { root, workFolder as readmeWork } from '../readme-media/capture-session.mjs';

export const docsFolder = resolve(root, 'public/docs');
export const docsWork = resolve(root, 'artifacts/docs-media');

export function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(result.stderr || 'ffmpeg failed');
  return result;
}

/** Records `count` frames into artifacts/docs-media/frames/<name> (step as in recordGif; may return true or { done, clip }). */
export async function recordFrames(page, name, { count, step, arg, clip }) {
  const folder = resolve(docsWork, 'frames', name);
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
  let recorded = 0;
  for (let i = 0; i < count; ++i) {
    const result = await page.evaluate(step, [i, arg]),
      area = result?.clip ?? clip;
    await page.screenshot({ path: resolve(folder, `${String(i).padStart(4, '0')}.png`), ...(area ? { clip: area } : {}) });
    recorded = i + 1;
    if (i % 60 === 0) process.stdout.write(`  ${name}: frame ${i}/${count}\n`);
    if (result === true || result?.done === true) break;
  }
  return { folder, frames: recorded };
}

/**
 * Encodes a frame folder to public/docs/<name>.mp4 at `width`. `audio` is a WAV/OGG path muxed as AAC; `from` reads
 * the README capture's frames (artifacts/readme-media/frames/<name>) instead. Also writes a poster JPEG.
 */
export async function encodeVideo(name, { fps = 30, width = 1280, audio, from, pattern, crf = 23, source, posterAt = 0 } = {}) {
  const folder = source ?? (from ? resolve(readmeWork, 'frames', from) : resolve(docsWork, 'frames', name)),
    files = (await readdir(folder)).filter((f) => f.endsWith('.png')).sort(),
    digits = files[0].replace('.png', '').length,
    out = resolve(docsFolder, `${name}.mp4`);
  await mkdir(docsFolder, { recursive: true });
  const args = ['-framerate', String(fps), '-i', resolve(folder, pattern ?? `%0${digits}d.png`)];
  if (audio) args.push('-i', audio);
  args.push(
    '-vf',
    `scale=${width}:-2:flags=lanczos,format=yuv420p`,
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    String(crf),
    '-movflags',
    '+faststart',
  );
  if (audio) args.push('-c:a', 'aac', '-b:a', '128k', '-shortest');
  else args.push('-an');
  args.push(out);
  ffmpeg(args);
  ffmpeg(['-ss', String(posterAt), '-i', out, '-frames:v', '1', '-q:v', '4', resolve(docsFolder, `${name}.jpg`)]);
  return { file: `docs/${name}.mp4`, bytes: (await stat(out)).size, frames: files.length, fps, sound: !!audio };
}

/** Writes mono 16-bit PCM samples (Float32 in -1..1) as a WAV file. */
export async function writeWav(path, samples, rate = 44100, channels = 2) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; ++i) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, Buffer.concat([header, data]));
}

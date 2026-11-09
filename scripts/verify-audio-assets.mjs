// Ship the original compressed audio assets; browsers decode them during playback preparation.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function verifyAudioAssets(root = fileURLToPath(new URL('../', import.meta.url))) {
  const metadata = JSON.parse(
    readFileSync(resolve(root, 'packages/native-audio/src/data/audio-sources.json'), 'utf8'),
  );
  const manifest = JSON.parse(
    readFileSync(resolve(root, 'packages/native-audio/src/data/audio-manifest.json'), 'utf8'),
  );
  const expected = new Set(manifest.map((entry) => entry.name + '.ogg'));
  const actual = new Set(metadata.sources.map((entry) => entry.path));
  if (
    actual.size !== metadata.sources.length ||
    actual.size !== expected.size ||
    [...expected].some((path) => !actual.has(path))
  )
    throw new Error('Audio source checksums must cover every manifest entry exactly once.');
  const endingBytes = readFileSync(resolve(root, 'packages/native-audio/src/data/effect-endings.json'));
  const endings = JSON.parse(endingBytes.toString('utf8'));
  const effectSources = metadata.sources.filter((entry) => !entry.path.startsWith('music/'));
  if (
    createHash('sha256').update(endingBytes).digest('hex') !== metadata.endingsSha256 ||
    createHash('sha256').update(JSON.stringify(effectSources)).digest('hex') !== endings.sourceSha256
  )
    throw new Error('Effect ending samples must match the recorded Ogg sources.');
  const hash = (path) =>
    createHash('sha256')
      .update(readFileSync(resolve(root, 'public/assets/audio', path)))
      .digest('hex');
  const stale = metadata.sources
    .filter((entry) => hash(entry.path) !== entry.sha256)
    .map((entry) => entry.path);
  if (stale.length)
    throw new Error(
      'Audio sources differ from their recorded checksums: ' +
        stale.join(', ') +
        '. Restore the matching Ogg assets or update their manifest and source checksums.',
    );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) verifyAudioAssets();

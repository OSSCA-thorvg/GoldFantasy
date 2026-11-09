// Effect assets and their native-decoded PCM must be updated together.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function verifyAudioAssets(root = fileURLToPath(new URL('../', import.meta.url))) {
  const metadata = JSON.parse(
    readFileSync(resolve(root, 'packages/native-audio/src/data/pcm-sources.json'), 'utf8'),
  );
  const hash = (path) =>
    createHash('sha256')
      .update(readFileSync(resolve(root, 'public/assets/audio', path)))
      .digest('hex');
  const stale = metadata.sources
    .filter((entry) => hash(entry.path) !== entry.sha256)
    .map((entry) => entry.path);
  if (hash('native-effects.pcm.gz') !== metadata.packedSha256) stale.push('native-effects.pcm.gz');
  if (stale.length)
    throw new Error(
      'Audio sources and native PCM differ: ' +
        stale.join(', ') +
        '. Restore the matching audio assets and PCM pack before building.',
    );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) verifyAudioAssets();

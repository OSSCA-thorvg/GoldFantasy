// The buildings: block models drawn as vector shapes, edited live in the Building Studio. Shares its capture with the
// presentation page (scripts/docs-media/buildings-videos.mjs) and assembles the README GIF from the studio frames.
import { spawnSync } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { captureBuildingVideos } from '../docs-media/buildings-videos.mjs';
import { mediaFolder, root, wants } from './capture-session.mjs';

export async function captureBuildings(session) {
  const out = await captureBuildingVideos(session);
  if (!wants('building-studio') || out.studioError) return out;
  const frames = resolve(root, 'artifacts/docs-media/frames/studio'),
    gif = resolve(mediaFolder, 'midgard-building-studio.gif');
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '30', '-i', resolve(frames, '%04d.png'), '-filter_complex',
    "[0:v]select='not(mod(n\\,3))',setpts=N/(10*TB),scale=720:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle", '-r', '10', '-loop', '0', gif], { encoding: 'utf8' });
  if (r.status) throw new Error(r.stderr);
  out.gif = { file: 'midgard-building-studio.gif', bytes: (await stat(gif)).size };
  return out;
}

// Fills the two "how it was made" step strips of public/docs.html from artifacts/docs-sources/<topic>/notes.md.
// Usage: node scripts/docs-media/build-story-sections.mjs
// A topic whose folder or notes are missing leaves its section out (an empty marker pair), so no link can break.
//
// notes.md: numbered one-line steps; each may be followed by indented `media:`, `caption:` and `source:` lines,
// for example
//   1. Draw the reference sheet.
//      media: reference.png
//      caption: The reference sheet for one resident.
//      source: packages/native-renderer/src/likeness-head.ts
// Media files sit beside notes.md (png, jpg, webp, mp4) and are copied to public/docs/story/<topic>/.
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..'),
  page = resolve(root, 'public/docs.html'),
  topics = [
    {
      key: 'characters',
      title: 'How residents are animated',
      sub: 'What this documents: clips of joint angles, blows chosen by weapon, crafting, the bard, worn equipment. Not shown here: reference images and first studies, how a likeness became vector shapes, part layering and garments.',
      note: 'The design-sheet to traced-path pipeline shown with the opening saga was used for the saga’s fighters, not for the small in-game residents.',
      noteLink: '#story-saga',
      after: 'Next: the shared skeleton of the rigged figures, and inverse kinematics.',
      link: '#animation',
      // The one capture from the running app was taken at night; it is lifted so the motion reads.
      brighten: ['03-craft-in-game.png'],
    },
    {
      key: 'saga',
      title: 'How the opening saga was made',
      sub: 'Six narrated panels on a 1600 × 900 board, drawn as vector shapes. The fighters were traced from design sheets and have no rig.',
      // Steps of the notes that the lead strip already tells.
      skip: [2, 3, 5],
      skipMedia: ['07-slaying-panel.mp4'],
      after: '',
      link: '',
      brighten: [],
    },
  ];
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Numbered steps, each with `- Media: \`file\` — caption` lines (or `Media: none.`) and a `- Sources:` line. */
function parse(text) {
  const steps = [];
  for (const line of text.split('\n')) {
    if (/^#+\s/.test(line) && steps.length) break;
    const step = /^(\d+)[.)]\s+(.+)$/.exec(line);
    if (step) {
      steps.push({ n: Number(step[1]), text: step[2].trim(), media: [] });
      continue;
    }
    const media = /^\s+-?\s*Media:\s*`([^`]+)`\s*(?:[—-]+\s*(.*))?$/i.exec(line);
    if (media && steps.length) steps.at(-1).media.push({ file: media[1], caption: (media[2] ?? '').trim() });
    const source = /^\s+-?\s*Sources?:\s*(.+)$/i.exec(line);
    // Local tools that are not in the repository are not named on the page.
    if (source && steps.length)
      steps.at(-1).source = source[1]
        .replace(/`/g, '')
        .split(/,\s*(?![^()]*\))/)
        .filter((s) => !/build-rig-clips/.test(s))
        .join(', ')
        .trim();
  }
  return steps;
}

async function section(topic) {
  const folder = resolve(root, 'artifacts/docs-sources', topic.key),
    notes = resolve(folder, 'notes.md');
  if (!existsSync(notes)) return { html: '', note: `${topic.key}: no notes, section left out` };
  const steps = parse(await readFile(notes, 'utf8'));
  if (!steps.length) return { html: '', note: `${topic.key}: notes have no numbered steps, section left out` };
  const out = resolve(root, 'public/docs/story', topic.key);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const cards = [];
  for (const s of steps.filter((s) => !(topic.skip ?? []).includes(s.n))) {
    s.media = s.media.filter((m) => !(topic.skipMedia ?? []).includes(m.file));
    const media = [];
    for (const m of s.media) {
      const from = resolve(folder, m.file);
      // A step whose media is missing is shown without it rather than with a broken link.
      if (!existsSync(from)) continue;
      const video = extname(m.file).toLowerCase() === '.mp4',
        file = video ? basename(m.file) : basename(m.file).replace(/\.[^.]+$/, '.webp'),
        to = resolve(out, file);
      if (video) await copyFile(from, to);
      else {
        const lift = topic.brighten.includes(basename(m.file)) ? 'curves=all=0/0 0.25/0.42 1/1,' : '';
        const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', from, '-vf', `${lift}scale='min(1280,iw)':-2`, '-quality', '82', to]);
        if (r.status) throw new Error(`Cannot convert ${m.file}: ${r.stderr}`);
      }
      const src = `docs/story/${topic.key}/${encodeURIComponent(file)}`,
        alt = escape(m.caption || s.text);
      media.push(
        (video ? `<video src="${src}" muted autoplay loop playsinline preload="metadata"></video>` : `<img src="${src}" alt="${alt}" loading="lazy">`) +
          (m.caption ? `<figcaption>${escape(m.caption)}</figcaption>` : ''),
      );
    }
    cards.push(`      <figure class="step"><div class="step-n">${s.n}</div><p>${escape(s.text)}</p>${media.join('')}${s.source ? `<span class="src">${escape(s.source)}</span>` : ''}</figure>`);
  }
  const html = `<section id="story-${topic.key}" data-title="${escape(topic.title)}">
  <div class="wrap">
    <div class="kicker">How it was made</div>
    <h2>${escape(topic.title)}</h2>
    <p class="sub">${escape(topic.sub)}</p>${topic.note ? `\n    <p class="sub"><a href="${topic.noteLink}">${escape(topic.note)}</a></p>` : ''}${topic.key === 'saga' ? await leadStrip(folder, out) : ''}
    <div class="steps">
${cards.join('\n')}
    </div>${topic.link ? `\n    <p class="sub" style="margin-top:.8em"><a href="${topic.link}">${escape(topic.after)}</a></p>` : ''}
  </div>
</section>
`;
  return { html, note: `${topic.key}: ${steps.length} steps` };
}

const run = (args) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status) throw new Error(r.stderr);
};
/**
 * The saga fighters from sheet to screen, from the design sheets in artifacts/docs-sources/reference (generated with
 * Codex 6.1, as the project author records). Left out when the sheets are missing.
 */
async function leadStrip(folder, out) {
  const ref = resolve(root, 'artifacts/docs-sources/reference'),
    thrust = resolve(ref, 'odin-spear-thrust-sheet.png'),
    warriors = resolve(ref, 'odin-and-warriors-sheet.png');
  if (!existsSync(thrust) || !existsSync(warriors)) return '';
  // Transparent sheets set on the page's panel colour.
  const flat = (from, to, crop) =>
    run([
      '-i', from, '-f', 'lavfi', '-i', 'color=c=0x191D19:s=16x16',
      '-filter_complex', `[0:v]format=rgba,${crop ? `crop=${crop},` : ''}scale='min(1280,iw)':-2[fg];[1:v]format=rgba[c];[c][fg]scale2ref[bg][f];[bg][f]overlay=format=auto,format=rgb24`,
      '-frames:v', '1', '-quality', '84', resolve(out, to),
    ]);
  flat(thrust, 'sheet-thrust.webp');
  flat(warriors, 'sheet-warriors.webp');
  flat(thrust, 'sheet-pose-1.webp', 'iw*0.31:ih:0:0');
  const has = (f) => existsSync(resolve(folder, f));
  const copy = async (f, quality = 82) => {
    const to = f.replace(/\.png$/, '.webp');
    run(['-i', resolve(folder, f), '-vf', "scale='min(1280,iw)':-2", '-quality', String(quality), resolve(out, to)]);
    return to;
  };
  const img = (f, alt) => `<img src="docs/story/saga/${f}" alt="${escape(alt)}" loading="lazy">`;
  const cards = [];
  cards.push(`<figure class="step"><div class="step-n">1</div><p>A design sheet: Odin in three poses, coiled, the thrust, the thrust held.</p>${img('sheet-thrust.webp', 'Design sheet: Odin in three poses with his spear')}<figcaption>Design sheet, generated with Codex 6.1.</figcaption>${img('sheet-warriors.webp', 'Design sheet: Odin with his spear between two kneeling brothers with shields')}<figcaption>The second sheet, generated with Codex 6.1: Odin between his brothers.</figcaption></figure>`);
  if (has('02-traced-paths.png')) {
    const traced = await copy('02-traced-paths.png');
    cards.push(`<figure class="step"><div class="step-n">2</div><p>Vectorised: the sheet traced into flat filled paths by a vectorizer tool, numbered back to front.</p><div class="pair">${img('sheet-pose-1.webp', 'The first pose on the sheet')}${img(traced, 'The same pose traced into numbered paths')}</div><figcaption>The same pose: sheet, then traced paths.</figcaption><span class="src">packages/native-renderer/src/saga-fighter-parts.ts (generated path data)</span></figure>`);
  }
  if (has('03-odin-three-poses.png')) {
    const poses = await copy('03-odin-three-poses.png');
    cards.push(`<figure class="step"><div class="step-n">3</div><p>No rig: the fighters have no bones; the blow is three traced drawings shown in turn over the same planted boots.</p>${img(poses, 'Odin’s three traced poses')}<figcaption>Coiled, thrust, held: lean, crouch and wind differ, the boots stay.</figcaption><span class="src">saga-fighters.ts (allfatherStriking)</span></figure>`);
  }
  if (has('05-cloth-on-planted-feet.png')) {
    const cloth = await copy('05-cloth-on-planted-feet.png');
    cards.push(`<figure class="step"><div class="step-n">4</div><p>Motion without joints: cloak and hair outline points ride a travelling wave that dies away at a guard line.</p>${img(cloth, 'Cape and hair change shape between moments while the boots stay still')}<span class="src">saga-fighters.ts (Streamer, Flowing) · tests/regression/saga-fighters.test.ts</span></figure>`);
  }
  // The finished panel with its narration, music and effects: cut from the opening video, which carries the game's sound.
  const opening = resolve(root, 'public/docs/opening.mp4');
  if (existsSync(opening)) {
    run(['-ss', '9.7', '-i', opening, '-t', '7.2', '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', resolve(out, 'slaying-panel.mp4')]);
    cards.push(`<figure class="step sound"><div class="step-n">5</div><p>The finished panel in the game: the slaying, at its real pace with its sound.</p><video src="docs/story/saga/slaying-panel.mp4" muted autoplay loop playsinline controls preload="metadata"></video><span class="src">saga-creation-panels.ts (slayingPanel) · intro-saga.ts</span></figure>`);
  }
  return `\n    <h3 style="color:var(--bright);margin:.6em 0 .4em">From sheet to screen: the saga’s fighters</h3>\n    <div class="steps lead">\n      ${cards.join('\n      ')}\n    </div>\n    <h3 style="color:var(--bright);margin:1em 0 .4em">The rest of the saga</h3>`;
}

let text = await readFile(page, 'utf8');
for (const topic of topics) {
  const open = `<!-- story:${topic.key} -->`,
    close = `<!-- /story:${topic.key} -->`,
    a = text.indexOf(open),
    b = text.indexOf(close);
  if (a < 0 || b < a) throw new Error(`docs.html has no ${open} … ${close} markers`);
  const { html, note } = await section(topic);
  text = text.slice(0, a + open.length) + (html ? `\n${html}` : '') + text.slice(b);
  console.log(note);
}
await writeFile(page, text);

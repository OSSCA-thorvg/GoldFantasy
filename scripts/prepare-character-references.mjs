// Simulation needs character names and selection rules, not the authoring SVG geometry.
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [pool, library] = await Promise.all(
  ['character-pool.json', 'character-library.json'].map(async (name) =>
    JSON.parse(await readFile(new URL(`packages/content/assets/characters/${name}`, root), 'utf8')),
  ),
);
const nameOnly = ({ name }) => ({ name });
const references = {
  faces: pool.faces.map(nameOnly),
  heads: library.heads.map(nameOnly),
  looks: pool.looks.map(({ name, native_face, gender, group, eye, ready, fallback }) => ({
    name,
    native_face,
    gender,
    group,
    eye,
    ready,
    fallback,
  })),
  outfits: library.outfits.map(nameOnly),
};
const target = new URL('packages/engine/data/character-references.json', root);
const text = JSON.stringify(references) + '\n';
let previous;
try {
  previous = await readFile(target, 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (text !== previous) await writeFile(target, text);

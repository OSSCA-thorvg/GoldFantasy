// Rebuilds the development log, public/docs/devlog, from the local working galleries in artifacts/ (git-ignored):
// one page per topic plus an index, with PNGs as WebP, GIFs and frame strips as short H.264 loops, and audio linked
// from public/assets/audio instead of copied. Fails without touching the published folder if a source is missing.
// Run: node scripts/docs-media/build-devlog.mjs   (needs ffmpeg and ffprobe with libwebp and libx264 on PATH)
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

// The development log's topics: which working-gallery pictures from artifacts/ are kept, in what order, and what
// each one shows. Paths are relative to artifacts/; audio paths are relative to public/assets/audio/.
// An item is { src } (a PNG or GIF), { frames: { html, from, count } } (PNGs embedded in a gallery page) or
// { frames: { files } }, or { audio }. `crop` is [x, y, w, h] in source pixels; `rejected` marks what never shipped.

const env = 'regression/environment';
const gods = 'regression/gods';
const fx = 'regression/combat-effects/gif';
const walk = Array.from({ length: 8 }, (_, i) => `${env}/ghosts-after-walk-${i}.png`);
const rainStrip = Array.from({ length: 6 }, (_, i) => `regression/rain-splash/strip-${i}.png`);

const groups = [
  'Characters and rigging',
  'Environment',
  'Combat and effects',
  'Gods and world events',
  'Interface',
  'Audio',
];

const topics = [
  {
    slug: 'rigging',
    group: 'Characters and rigging',
    title: 'One rig for every body',
    summary: 'Whether monsters, residents and animals could all move on one shared skeleton and clip set.',
    thumb: { frames: { html: 'devlog-sources/rig-preview.html', from: 1, count: 1 } },
    lead: 'Monsters, residents and animals are posed by one shared skeleton and one set of animation clips; each kind brings only its own outline. These loops are the preview sheets that were checked before the rig went into the game.',
    sections: [
      {
        title: 'Monsters',
        cols: 1,
        items: [
          {
            frames: { html: 'devlog-sources/rig-preview.html', from: 1, count: 24 },
            fps: 14,
            width: 960,
            name: 'monsters',
            caption: 'Rows: goblin, draugr, imp, warg and jotunn, each idle, walking and attacking. Last row: swarm runners, a spitter, dens, a fall, and a newcomer climbing out.',
          },
        ],
      },
      {
        title: 'Residents',
        cols: 1,
        items: [
          {
            frames: { html: 'devlog-sources/rig-preview.html', from: 25, count: 24 },
            fps: 14,
            width: 960,
            name: 'residents',
            caption: 'Top row: sword, mace, bare hands, two-handed axe, three walks, eating. Bottom row: wave, hair tuck, thinking, shrug, stretch, prayer, counter work, lookout.',
          },
        ],
      },
      {
        title: 'Animals',
        cols: 1,
        items: [
          {
            frames: { html: 'devlog-sources/animals-rig-preview.html', from: 0, count: 28 },
            fps: 14,
            width: 960,
            name: 'animals',
            caption: 'One outline each on the shared rig. Columns: standing, grazing or pecking, three moments of the walk, asleep, asleep facing left. Rows: cow, pig, hen, wolf, dog, cat.',
          },
        ],
      },
      {
        title: 'In the game',
        cols: 1,
        items: [
          {
            frames: { html: 'devlog-sources/rig-preview.html', from: 0, count: 1 },
            name: 'in-game',
            caption: 'Rigged residents and monsters fighting at a den.',
          },
        ],
      },
    ],
  },
  {
    slug: 'portraits',
    group: 'Characters and rigging',
    title: 'Faces and portraits',
    summary: 'One likeness for portrait and sprite: plain dot eyes, no mouth or nose.',
    thumb: { src: 'devlog-sources/viz/portraits.png', crop: [0, 0, 880, 550] },
    lead: 'Each resident has one design that is used both for the portrait in the interface and for the small figure in the world. The eyes were redrawn as plain dots, without mouth or nose, and checked on the whole cast at once.',
    sections: [
      {
        title: 'The whole cast',
        cols: 1,
        items: [
          {
            src: 'devlog-sources/viz/portraits.png',
            caption: 'Every portrait with the new eyes. The first two are Askr and Embla.',
          },
        ],
      },
      {
        title: 'At street size',
        cols: 1,
        items: [{ src: 'devlog-sources/viz/zoom.png', caption: 'The same eyes on the figures in the world.' }],
      },
    ],
  },
  {
    slug: 'hidden-units',
    group: 'Environment',
    title: 'Units behind trees and peaks',
    summary: 'How to show residents and monsters standing behind tall trees and peaks.',
    thumb: { src: `${env}/ghosts-after-close-felling-a.png` },
    lead: 'Taller trees and peaks hide whoever stands behind them. The first fix drew a body ellipse and a head ellipse for each hidden unit, which in a forest read as rows of the figure 8. Now each hidden unit is a plain posed outline: body, face contour and what is in hand, with no hair, hat or clothing. Our side is drawn in a light warm line, monsters in the rust of their health bars. The outlines cost under half a millisecond a frame with 170 units in the densest forest.',
    sections: [
      {
        title: 'Five residents felling trees deep in a forest',
        text: 'Close crops of the same three frames, taken at zoom 1.6.',
        cols: 3,
        items: [
          { src: `${env}/ghosts-before-felling.png`, crop: [432, 202, 480, 300], label: 'Before', caption: 'No outline: the fellers are almost invisible.' },
          { src: `${env}/ghosts-ellipse-felling.png`, crop: [432, 202, 480, 300], label: 'Rejected attempt', rejected: true, caption: 'Ellipses: each hidden resident reads as an 8.' },
          { src: `${env}/ghosts-after-felling.png`, crop: [432, 202, 480, 300], label: 'Now', caption: 'Posed outlines swinging their axes.' },
        ],
      },
      {
        title: 'A fight inside the forest, on a phone',
        text: 'Twenty residents against a swarm of 150, seen through a 390 by 800 slice of the screen.',
        cols: 3,
        items: [
          { src: `${env}/ghosts-before-phone.png`, label: 'Before', caption: 'Only the health bars show where the fight is.' },
          { src: `${env}/ghosts-ellipse-phone.png`, label: 'Rejected attempt', rejected: true, caption: 'The fight as rows of 8s.' },
          { src: `${env}/ghosts-after-phone.png`, label: 'Now', caption: 'Friend and foe as figures, each in its own colour.' },
        ],
      },
      {
        title: 'Three residents just behind a ridge',
        cols: 3,
        items: [
          { src: `${env}/ghosts-before-behind-ridge.png`, crop: [405, 143, 480, 300], label: 'Before', caption: 'No outline.' },
          { src: `${env}/ghosts-ellipse-behind-ridge.png`, crop: [405, 143, 480, 300], label: 'Rejected attempt', rejected: true, caption: 'Ellipses.' },
          { src: `${env}/ghosts-after-behind-ridge.png`, crop: [405, 143, 480, 300], label: 'Now', caption: 'Two stand behind the peak, one stands clear of it.' },
        ],
      },
      {
        title: 'Close-ups of the outlines',
        text: 'Residents are read from the pose they are drawn in; monsters ride one generic two-legged or four-legged skeleton driven by the clip their own rig is playing.',
        cols: 4,
        items: [
          { src: `${env}/ghosts-after-close-felling-a.png`, caption: 'Felling behind a fir: axe forward.' },
          { src: `${env}/ghosts-after-close-felling-b.png`, caption: 'The same swing: axe raised.' },
          { src: `${env}/ghosts-after-close-draugr.png`, caption: 'Draugr, the two-legged kind, with weapons.' },
          { src: `${env}/ghosts-after-close-warg.png`, caption: 'Wargs, the four-legged kind.' },
        ],
      },
      {
        title: 'A walk behind the trees',
        cols: 2,
        items: [
          {
            frames: { files: walk },
            fps: 10,
            hold: 0.6,
            width: 480,
            upscale: 4,
            name: 'walk',
            caption: 'Eight frames a tenth of a second apart: an archer walks behind the trees, steps out of cover, and the outline goes away.',
          },
        ],
      },
    ],
  },
  {
    slug: 'trees-and-mountains',
    group: 'Environment',
    title: 'Trees, mountains and land colours',
    summary: 'Taller trees, peaks that grow with their range, and a return to the earlier land colours.',
    thumb: { src: `${env}/mountains-after-ridge-and-forest.png` },
    lead: 'A resident stands 24 pixels tall at zoom 1. Next to them a grown fir was only 33 pixels, so forests read as lawns. Trees were raised first, then the mountains had to grow to stay above them, and a colour redesign along the way was undone.',
    sections: [
      {
        title: 'Trees',
        text: 'Same cameras, same map. A grown fir went from 33 to 78 pixels at zoom 1.',
        cols: 2,
        items: [
          { src: `${env}/trees-before-forest-edge.png`, label: 'Before', caption: 'Residents beside a forest edge.' },
          { src: `${env}/trees-after-forest-edge.png`, label: 'After', caption: 'The same edge with the taller trees.' },
          { src: `${env}/trees-before-snowy-forest.png`, label: 'Before', caption: 'A snowy forest.' },
          { src: `${env}/trees-after-snowy-forest.png`, label: 'After', caption: 'The same forest.' },
          { src: `${env}/trees-before-felling.png`, label: 'Before', caption: 'Felling: the first blow.' },
          { src: `${env}/trees-after-felling.png`, label: 'After', caption: 'The same blow among taller trees.' },
        ],
      },
      {
        title: 'Mountains',
        text: 'The first attempt stretched each one-tile pyramid up to 225 pixels and read as a field of needles. Now a peak’s height follows how deep it stands in its range: foothills on the edge, a few big summits with shoulders and snow caps deep inside, and no peak over the forest taller than its base is wide.',
        cols: 3,
        items: [
          { src: `${env}/mountains-before-settlement.png`, label: 'Before', caption: 'The old low pyramids beside the settlement.' },
          { src: `${env}/mountains-first-settlement.png`, label: 'Rejected attempt', rejected: true, caption: 'Stretched pyramids: a field of needles.' },
          { src: `${env}/mountains-after-settlement.png`, label: 'Now', caption: 'Height and width grow together.' },
          { src: `${env}/mountains-before-ridge-and-forest.png`, label: 'Before', caption: 'A ridge with forest in front, beside the statue.' },
          { src: `${env}/mountains-first-ridge-and-forest.png`, label: 'Rejected attempt', rejected: true, caption: 'Needles.' },
          { src: `${env}/mountains-after-ridge-and-forest.png`, label: 'Now', caption: 'The gate and the statue stay clear.' },
          { src: `${env}/mountains-before-zoomed-out.png`, label: 'Before', caption: 'Midgard zoomed out.' },
          { src: `${env}/mountains-first-zoomed-out.png`, label: 'Rejected attempt', rejected: true, caption: 'Needles everywhere.' },
          { src: `${env}/mountains-after-zoomed-out.png`, label: 'Now', caption: 'Fewer, larger peaks, and fewer shapes to draw.' },
        ],
      },
      {
        title: 'Land colours',
        text: 'A redesign darkened the trees to a teal close to the ground colour and turned the worlds beyond the gates into pale islands. It was rejected: trees, grass, ground, rocks and peaks went back to the earlier colours, keeping only the drifting water and the gate sprites.',
        cols: 3,
        items: [
          { src: `${env}/restored-midgard-day.png`, label: 'Now', caption: 'Midgard by day with the restored colours.' },
          { src: 'regression/road-quadrants/current/NW-unselected.png', label: 'Rejected attempt', rejected: true, caption: 'Dark teal trees close to the ground colour.' },
          { src: 'regression/realm/gate-2/home.png', label: 'Earlier', caption: 'The look before the redesign, used as the reference.' },
          { src: `${env}/restored-world-muspelheim-island.png`, label: 'Now', caption: 'Muspelheim: peak walls and lava lanes.' },
          { src: `${env}/restored-world-jotunheim-island.png`, label: 'Now', caption: 'Jotunheim: a snowy floor between peak walls.' },
          { src: 'regression/realm/gate-3/whole-realm.png', label: 'Earlier', caption: 'A world beyond a gate before the redesign, under the fog veil.' },
        ],
      },
    ],
  },
  {
    slug: 'lava',
    group: 'Environment',
    title: 'Lava',
    summary: 'Making lava read as hot and moving, by day, at night and beyond a gate.',
    thumb: { src: `${env}/lava-volcano-dusk.png` },
    lead: 'Lava is drawn as flat bands that crawl and hot cores that breathe, in the same painted style as the water. At night it keeps its brightness and warms the ground beside it.',
    sections: [
      {
        title: 'Moving lava',
        cols: 3,
        items: [
          { src: `${env}/lava-day.gif`, caption: 'A lava field at the foot of the volcano by day.' },
          { src: `${env}/lava-night.gif`, caption: 'The same field at night.' },
          { src: `${env}/lava-muspelheim.gif`, caption: 'The lava lanes of Muspelheim at dusk, beyond a gate.' },
        ],
      },
      {
        title: 'The volcano',
        cols: 2,
        items: [
          { src: `${env}/lava-volcano-dusk.png`, caption: 'The volcano in the south of Midgard at dusk.' },
          { src: `${env}/lava-flow-day.png`, caption: 'The flows reaching the shore by day.' },
        ],
      },
    ],
  },
  {
    slug: 'rain',
    group: 'Environment',
    title: 'Rain on the ground',
    summary: 'Small splash rings where rain lands, and none where it should not.',
    thumb: { src: 'regression/rain-splash/lake.png' },
    lead: 'Rain needed to touch the ground. Each drop that lands leaves a small ring for a moment: more in a storm, fewer and thinner when zoomed out, and none in snow or clear weather. Rebuilding the splashes takes about a tenth of a millisecond.',
    sections: [
      {
        title: 'Where rain lands',
        cols: 2,
        items: [
          { src: 'regression/rain-splash/grass.png', caption: 'Rain on grass.' },
          { src: 'regression/rain-splash/lake.png', caption: 'Rain on a lake.' },
          { src: 'regression/rain-splash/storm.png', caption: 'A storm: more splashes.' },
          { src: 'regression/rain-splash/zoom-out.png', caption: 'Zoomed out: thinner.' },
          { src: 'regression/rain-splash/snow.png', caption: 'Snow: no splashes.' },
          {
            frames: { files: rainStrip },
            fps: 15,
            hold: 0,
            width: 600,
            name: 'lake-edge',
            caption: 'A lake edge, frame by frame at a fifteenth of a second.',
          },
        ],
      },
    ],
  },
  {
    slug: 'combat-effects',
    group: 'Combat and effects',
    title: 'Combat effects',
    summary: 'Flat painted blows, skills and swarm deaths, and where each effect is drawn in depth.',
    thumb: { src: 'regression/combat-effects/skill-frost.png' },
    lead: 'Every blow and skill is a flat, two-tone painted shape instead of a glow. Effects are drawn in tiers: marks on the ground go under the units, standing pieces are sorted by depth with them, and only numbers and bars sit on top. The loops below play at game speed.',
    sections: [
      {
        title: 'Weapon blows',
        cols: 3,
        items: [
          { src: `${fx}/strike-single.gif`, caption: 'A single melee blow: slash and impact.' },
          { src: `${fx}/strike-cleave.gif`, caption: 'Cleave: one swing across two neighbouring monsters.' },
          { src: `${fx}/strike-crush.gif`, caption: 'Crush: a heavy overhead blow that staggers.' },
          { src: `${fx}/strike-pierce.gif`, caption: 'Pierce: a shot through two monsters in a line.' },
          { src: `${fx}/strike-splash.gif`, caption: 'Splash: a burst that spills onto neighbours.' },
          { src: `${fx}/crit-and-block.gif`, caption: 'Damage numbers, a critical hit, a block, a heal and contact shards.' },
        ],
      },
      {
        title: 'Skills',
        cols: 3,
        items: [
          { src: `${fx}/skill-challenge.gif`, caption: 'Challenge (warrior): a taunt ring that draws monsters in.' },
          { src: `${fx}/skill-whirl.gif`, caption: 'Whirl (warrior): a spin that hits everything around.' },
          { src: `${fx}/skill-volley.gif`, caption: 'Volley (ranger): a ground mark, then arrows rain down on it.' },
          { src: `${fx}/skill-burst.gif`, caption: 'Rune burst (mage): a rune circle charges, then detonates.' },
          { src: `${fx}/skill-frost.gif`, caption: 'Frost ring (mage): ice crystals rise, hold and melt.' },
          { src: `${fx}/skill-mend.gif`, caption: 'Mend (cleric): a healing pulse on a wounded ally.' },
          { src: `${fx}/skill-sanctuary.gif`, caption: 'Sanctuary (cleric): a protective ground area.' },
          { src: `${fx}/skill-rally.gif`, caption: 'Rallying verse (bard): an aura around the bard.' },
          { src: `${fx}/skill-dirge.gif`, caption: 'Dirge (bard): a weakening song around the bard.' },
        ],
      },
      {
        title: 'Swarms and dens',
        cols: 3,
        items: [
          { src: `${fx}/swarm-kill.gif`, caption: 'A swarmer dies: it breaks into pieces and dust.' },
          { src: `${fx}/swarm-spawn.gif`, caption: 'A den spawns a new swarmer.' },
          { src: `${fx}/den-collapse.gif`, caption: 'A den collapses and the stones scatter.' },
          { src: `${fx}/brood-break.gif`, caption: 'The brood breaks: every swarmer around the den falls apart at once.' },
          { src: `${fx}/crowd.gif`, caption: 'A party of five against 120 monsters, blows landing every frame.' },
          { src: `${fx}/guardian-slam.gif`, caption: 'A guardian winds up behind a red warning, then slams the ground.' },
        ],
      },
      {
        title: 'Draw order',
        text: 'The same effect checked with units in front of it and behind it, so nothing paints over a body that stands nearer the camera.',
        cols: 3,
        items: [
          { src: `${fx}/order-body-front.gif`, caption: 'A slash on a monster with a resident standing in front.' },
          { src: `${fx}/order-body-behind.gif`, caption: 'The same slash with the resident behind the monster.' },
          { src: `${fx}/order-standing-frost.gif`, caption: 'Frost crystals with units inside and outside the ring.' },
          { src: `${fx}/order-ground-rune.gif`, caption: 'A rune circle on the ground under the units standing on it.' },
          { src: `${fx}/order-den-tree.gif`, caption: 'A den collapsing behind a tree.' },
          { src: `${fx}/order-night.gif`, caption: 'Frost, sanctuary and a cleave at night.' },
          { src: `${fx}/downed-and-death.gif`, caption: 'A downed resident (ring and word) next to a fallen one (death wisp).' },
        ],
      },
    ],
  },
  {
    slug: 'gods',
    group: 'Gods and world events',
    title: 'Thor and Jormungandr',
    summary: 'Thor’s visits and the world serpent: brighter strikes, brushed bolts and a darker serpent.',
    thumb: { src: `${gods}/serpent-02-coils-flash.png`, crop: [290, 20, 600, 375] },
    lead: 'Thor comes to Midgard for a few nights: by day he lives among the residents, by night he hunts monsters with his hammer. Jormungandr lies in the sea around Midgard and rises in bad weather. Each pair below is the first version on the left and the reworked one on the right.',
    sections: [
      {
        title: 'The night strike is the brightest thing at night',
        narrow: true,
        cols: 2,
        items: [
          { src: `${gods}/before/thor-13-night-hammer-strike.png`, crop: [380, 20, 600, 480], label: 'Before', caption: 'A thin zigzag that the night swallows.' },
          { src: `${gods}/thor-13-night-hammer-strike.png`, crop: [380, 20, 600, 480], label: 'After', caption: 'A bright forked bolt over the hunted pack.' },
          { src: `${gods}/before/thor-night-hunt.gif`, label: 'Before', caption: 'A night hunt.' },
          { src: `${gods}/thor-night-hunt.gif`, label: 'After', caption: 'The same hunt with the new strike.' },
        ],
      },
      {
        title: 'A brushed, forked bolt instead of a geometric zigzag',
        narrow: true,
        cols: 2,
        items: [
          { src: `${gods}/before/thor-01-arrival-bolt.png`, crop: [400, 0, 600, 480], label: 'Before', caption: 'Thor arrives on a geometric zigzag.' },
          { src: `${gods}/thor-01-arrival-bolt.png`, crop: [400, 0, 600, 480], label: 'After', caption: 'A brushed bolt with a fork.' },
        ],
      },
      {
        title: 'A near-black serpent against the flash',
        narrow: true,
        cols: 2,
        items: [
          { src: `${gods}/before/serpent-02-coils-flash.png`, crop: [290, 20, 600, 480], label: 'Before', caption: 'Pale coils with a lit oval around them.' },
          { src: `${gods}/serpent-02-coils-flash.png`, crop: [290, 20, 600, 480], label: 'After', caption: 'A dark silhouette against the lightning.' },
          { src: `${gods}/before/serpent-01-coils-storm.png`, crop: [290, 0, 600, 480], label: 'Before', caption: 'In the storm: lit ovals round the coils.' },
          { src: `${gods}/serpent-01-coils-storm.png`, crop: [290, 0, 600, 480], label: 'After', caption: 'No ovals under the veil.' },
        ],
      },
      {
        title: 'The ring closes: the tail in the jaws',
        narrow: true,
        text: 'The serpent rings the whole world and bites its own tail, as in the myth. The top-down check shows the loop, the coils that break the surface and the head; cyan marks a coil at the edge of the map.',
        cols: 2,
        items: [
          { src: `${gods}/before/serpent-03-head-and-tail.png`, crop: [295, 120, 600, 480], label: 'Before', caption: 'Head and tail apart.' },
          { src: `${gods}/serpent-03-head-and-tail.png`, crop: [295, 120, 600, 480], label: 'After', caption: 'The tail tip in the jaws.' },
          { src: `${gods}/ring-96-before.png`, label: 'Before', caption: 'On a small map the ring fell short.' },
          { src: `${gods}/ring-96-after.png`, label: 'After', caption: 'A whole ring, passing beyond the map edge where land meets it.' },
        ],
      },
      {
        title: 'Thor at home',
        cols: 2,
        items: [
          { src: `${gods}/thor-pose-sheet.png`, caption: 'Thor’s pose sheet, drawn on the shared rig.' },
          { src: `${gods}/thor-02-guide-card-en.png`, caption: 'His arrival, with the guide card that explains the visit.' },
          { src: `${gods}/thor-14-storm.png`, caption: 'A storm while he stays.' },
          { src: `${gods}/serpent-rising.gif`, caption: 'Jormungandr rising from the sea.' },
        ],
      },
    ],
  },
  {
    slug: 'altar',
    group: 'Gods and world events',
    title: 'Offerings at Odin’s altar',
    summary: 'Turning a plain trade into a short rite: graded offerings, an answer, and sometimes a refusal.',
    thumb: { src: 'regression/prayer/snow-arrival.png', crop: [20, 140, 580, 362] },
    lead: 'New residents come from offerings at Odin’s altar. The first version was a plain dialog with a progress bar. Now the offering is graded, the residents lay the gifts and bow, Odin answers, and the newcomer forms in a column of light. Odin can also turn an offering away.',
    sections: [
      {
        title: 'Before and after',
        cols: 2,
        items: [
          { src: 'regression/prayer/before/offering-configuration.png', label: 'Before', caption: 'The offering dialog.' },
          { src: 'regression/prayer/grade-bountiful.png', label: 'After', caption: 'The offering is graded, here Bountiful, and the dialog says what that tends to bring.' },
          { src: 'regression/prayer/before/clear-prayer.png', label: 'Before', caption: 'Mid-prayer: a bar fills.' },
          { src: 'regression/prayer/rite-kingly-bowing.png', label: 'After', caption: 'The residents bow; a raven comes.' },
          { src: 'regression/prayer/before/clear-transformation.png', label: 'Before', caption: 'The newcomer forms.' },
          { src: 'regression/prayer/rite-kingly-release.png', label: 'After', caption: 'Light over the altar as the newcomer forms.' },
          { src: 'regression/prayer/before/clear-arrival.png', label: 'Before', caption: 'The result.' },
          { src: 'regression/prayer/rite-kingly-arrival.png', label: 'After', caption: 'The result names the grade that was accepted.' },
        ],
      },
      {
        title: 'Refusal and the limit',
        cols: 2,
        items: [
          { src: 'regression/prayer/refused-result.png', caption: 'Odin turns the offering away: the gifts are gone and no one comes.' },
          { src: 'regression/prayer/cap-reached.png', caption: 'Odin sends no more until another floor beyond a gate is cleared.' },
          { src: 'regression/prayer/snow-arrival.png', caption: 'The same rite on a snowy night.' },
          { src: 'regression/prayer/mobile-grade-kingly.png', caption: 'The dialog at phone width.' },
        ],
      },
    ],
  },
  {
    slug: 'expedition',
    group: 'Interface',
    title: 'Expeditions through the gates',
    summary: 'Choosing a party, holding the moment someone falls, and the result screens.',
    thumb: { src: 'regression/expedition-result/death-memorial.png', crop: [300, 0, 700, 438] },
    lead: 'A click on a gate opens the expedition window. Beyond the gate, the game holds the important moments: a fall, a death, the last one down. Every way an expedition can end has its own result screen.',
    sections: [
      {
        title: 'The expedition window',
        cols: 3,
        items: [
          { src: 'regression/expedition/window-party.png', caption: 'All fighters chosen: the verdict says the party is ready.' },
          { src: 'regression/expedition/window-too-weak.png', caption: 'One low bard: too few to stand against a swarm.' },
          { src: 'regression/expedition/window-sealed.png', caption: 'A sealed gate opens read-only.' },
        ],
      },
      {
        title: 'Held moments',
        cols: 3,
        items: [
          { src: 'regression/expedition-result/fall-held.png', caption: 'A fall: the camera on the fallen, the rest veiled, a banner.' },
          { src: 'regression/expedition-result/death-held.png', caption: 'A death: the world holds and the banner names them.' },
          { src: 'regression/expedition-result/death-memorial.png', caption: 'Then the memorial card.' },
          { src: 'regression/expedition-result/last-held.png', caption: 'The last one down: a longer hold.' },
          { src: 'regression/expedition-result/last-dim.png', caption: 'Then the screen dims.' },
          { src: 'regression/expedition-result/clear-home.png', caption: 'Home at the gate, the survivors selected.' },
        ],
      },
      {
        title: 'How an expedition ends',
        cols: 2,
        items: [
          { src: 'regression/expedition-result/clear-result.png', caption: 'A cleared floor.' },
          { src: 'regression/expedition-result/withdraw-result.png', caption: 'The party withdrew.' },
          { src: 'regression/expedition-result/castout-result.png', caption: 'Thrown back through the gate.' },
          { src: 'regression/expedition-result/lost-result.png', caption: 'No one came back.' },
        ],
      },
    ],
  },
  {
    slug: 'smithy-and-tools',
    group: 'Interface',
    title: 'Smithy, workbench and tools',
    summary: 'Crafting stations with levels, weapons and armour, and tools that show in the hand.',
    thumb: { src: 'regression/smithy/07-upgrade-offered.png', crop: [320, 170, 640, 400] },
    lead: 'The workbench makes tools and packs; the smithy makes weapons, shields and armour. Both are upgraded in place for stone and then iron, and the panel always names who will do the work.',
    sections: [
      {
        title: 'The smithy panel',
        cols: 3,
        items: [
          { src: 'regression/smithy/01-smithy-level-1.png', crop: [320, 170, 640, 620], caption: 'A new smithy: wooden weapons ready, stone and iron locked by level.' },
          { src: 'regression/smithy/07-upgrade-offered.png', crop: [320, 170, 640, 620], caption: 'Level 2: the flint sword offers an upgrade for the wooden one in hand, for less.' },
          { src: 'regression/smithy/06-smithy-needs.png', crop: [320, 170, 640, 620], caption: 'The smithy asks for a quarry and more residents before stone.' },
        ],
      },
      {
        title: 'Stations in the world',
        cols: 3,
        items: [
          { src: 'regression/smithy/08-workbench-level-1.png', caption: 'The workbench at level 1.' },
          { src: 'regression/smithy/08-workbench-level-2.png', caption: 'Level 2.' },
          { src: 'regression/smithy/08-workbench-level-3.png', caption: 'Level 3.' },
        ],
      },
      {
        title: 'Tools in the hand',
        text: 'A resident carries the tool that fits the job, so the work can be read from the figure.',
        cols: 3,
        items: [
          { src: 'regression/tool-variety/06b-stone-axe.png', crop: [440, 160, 400, 300], caption: 'A stone axe.' },
          { src: 'regression/tool-variety/07-shovel-road.png', crop: [440, 160, 400, 300], caption: 'A shovel for roadwork.' },
          { src: 'regression/tool-variety/08-spear.png', crop: [440, 160, 400, 300], caption: 'A wooden spear.' },
        ],
      },
      {
        title: 'Equipment',
        cols: 2,
        items: [
          { src: 'regression/smithy/09-unit-window-shield-armor.png', caption: 'The unit window: club and shield in hand, armour worn, tools working from the pack.' },
          { src: 'regression/tool-variety/17-unit-window-basket.png', caption: 'A pack basket holding more tools.' },
        ],
      },
    ],
  },
  {
    slug: 'korean',
    group: 'Interface',
    title: 'The game in Korean',
    summary: 'Walking every new screen in Korean and listing any English left behind.',
    thumb: { src: 'regression/korean/phone-skill-card.png', crop: [0, 240, 390, 244] },
    lead: 'Every new panel, tooltip and banner was opened with the Korean interface, and a check listed every English word still on screen. Only resident names and the name of the Tab key were left.',
    sections: [
      {
        title: 'On a phone',
        cols: 3,
        items: [
          { src: 'regression/korean/phone-combat.png', caption: 'A fight beyond a gate, with the memorial card.' },
          { src: 'regression/korean/phone-skill-card.png', caption: 'The guide card and the skill panel.' },
        ],
      },
      {
        title: 'On a desktop',
        cols: 2,
        items: [
          { src: 'regression/korean/memorial.png', caption: 'A death beyond a gate.' },
          { src: 'regression/korean/market.png', caption: 'The market.' },
          { src: 'regression/korean/altar.png', caption: 'Odin’s altar.' },
          { src: 'regression/korean/winter-calendar.png', caption: 'The winter calendar.' },
        ],
      },
    ],
  },
  {
    slug: 'title',
    group: 'Interface',
    title: 'The title screen',
    summary: 'A world-serpent wordmark, and a title scene that runs on its own.',
    thumb: { src: 'regression/title/final-title-1280x800.png', crop: [760, 120, 520, 325] },
    lead: 'The title wordmark was redrawn around Jormungandr: three compositions were drafted in the letters’ own gold, and the third was refined. Behind it, the title screen plays a small settlement on its own.',
    sections: [
      {
        title: 'Wordmark drafts',
        cols: 1,
        items: [
          { src: 'regression/title/old-1400.png', label: 'Before', caption: 'Lettering with a star above the G and a rule below.' },
          { src: 'regression/title/draft-a-1400.png', label: 'Rejected attempt', rejected: true, caption: 'Draft A: a low ring round the whole word. It read as a badge, the letters shrank, and the head was lost at title size.' },
          { src: 'regression/title/draft-b-1400.png', label: 'Rejected attempt', rejected: true, caption: 'Draft B: a base line rising at both ends. It read as a swoosh, with no bite.' },
          { src: 'regression/title/draft-c-1400.png', label: 'First pass', caption: 'Draft C: a ring round the middle G, the head biting the tail.' },
          { src: 'regression/title/final-1400.png', label: 'Now', caption: 'Draft C refined: a flatter head lying on the ring, an eye dot, one swept-back crest, letters respaced so the ring clears the D and the A.' },
        ],
      },
      {
        title: 'On the title screen',
        cols: 2,
        items: [
          { src: 'regression/title/old-title-1280x800.png', label: 'Before', caption: 'The old wordmark.' },
          { src: 'regression/title/final-title-1280x800.png', label: 'Now', caption: 'The serpent wordmark.' },
          { src: 'regression/title/final-head-4x.png', caption: 'The head at four times title size.' },
          { src: 'regression/title/final-bite-12x.png', caption: 'The bite at twelve times: the head is a separate piece over the tail, with no seam.' },
        ],
      },
      {
        title: 'Leaving the title running',
        text: 'The title scene was left running for half an hour of game time to see whether it stays alive.',
        cols: 2,
        items: [
          { src: 'regression/title-player-before/shot-005.png', caption: 'Ten minutes in: the camera follows Askr through the settlement.' },
          { src: 'regression/title-player-before/shot-006.png', caption: 'Two minutes later nobody was left to follow, a problem this run brought to light.' },
        ],
      },
    ],
  },
  {
    slug: 'audio',
    group: 'Audio',
    title: 'Music and sound',
    summary: 'A music loop for each world and floor, the bard’s lyre, and dry, plain combat sounds.',
    thumb: { src: 'regression/combat-effects/skill-rally.png' },
    lead: 'The sounds below are the files the game ships. Levels were measured on each file and compared against existing tracks before they went in.',
    sections: [
      {
        title: 'Music beyond the gates',
        text: 'One loop for each world and floor. Each world has its own mode and lead instrument; the deeper floors run a little faster and add a drum pulse.',
        cols: 2,
        items: [
          { audio: 'music/realm/asgard_1.ogg', caption: 'Asgard, first floor: dorian mode, horn.' },
          { audio: 'music/realm/vanaheim_2.ogg', caption: 'Vanaheim, second floor: aeolian mode, flute.' },
          { audio: 'music/realm/jotunheim_3.ogg', caption: 'Jotunheim, third floor: phrygian mode, cello.' },
          { audio: 'music/realm/helheim_1.ogg', caption: 'Helheim, first floor: phrygian mode, a hummed lead.' },
        ],
      },
      {
        title: 'The bard’s lyre',
        text: 'Fourteen short phrases, all in D dorian. In the game they are heard softly, only near a bard on screen, with long pauses between them.',
        cols: 3,
        items: [
          { audio: 'sfx/bard/lyre_01.ogg', caption: 'Phrase 1.' },
          { audio: 'sfx/bard/lyre_05.ogg', caption: 'Phrase 5.' },
          { audio: 'sfx/bard/lyre_12.ogg', caption: 'Phrase 12, ending on a strum.' },
        ],
      },
      {
        title: 'Combat sounds',
        text: 'Low, dry and short, so many can play at once in a big fight.',
        cols: 3,
        items: [
          { audio: 'sfx/combat/cleave_01.ogg', caption: 'Sword cleave: a short low sweep, then a dull thwack.' },
          { audio: 'sfx/combat/crush_01.ogg', caption: 'Mace crush: one heavy low thud with a small crack on top.' },
          { audio: 'sfx/combat/volley_01.ogg', caption: 'Volley: three strings loosed together, then arrows landing in earth.' },
          { audio: 'sfx/combat/frost_01.ogg', caption: 'Frost ring: a dry crackle of ice over a low groan.' },
          { audio: 'sfx/combat/swarm_death_01.ogg', caption: 'Swarm death: a very short flop, made to be heard many times a second.' },
          { audio: 'sfx/combat/brood_break_01.ogg', caption: 'The brood breaks: a low boom that rolls away over three seconds.' },
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------------------------------------------------
// Build: check every source, encode into a staging folder, check the result, then swap it in for public/docs/devlog.

const root = resolve(import.meta.dirname, '../..');
const artifacts = resolve(root, 'artifacts');
const audioRoot = resolve(root, 'public/assets/audio');
const target = resolve(root, 'public/docs/devlog');
const staging = resolve(root, 'artifacts/devlog-build');
const ffmpegBin = process.env.FFMPEG || 'ffmpeg';
const ffprobeBin = process.env.FFPROBE || 'ffprobe';
const budget = 40 * 1024 * 1024;
const imageWidth = 1280,
  gridImageWidth = 960,
  videoWidth = 720,
  jobs = 4;

class SourceError extends Error {}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function run(bin, args) {
  return new Promise((done, fail) => {
    const child = spawn(bin, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '',
      err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', fail);
    child.on('close', (code) => (code === 0 ? done(out) : fail(new Error(`${bin} ${args.join(' ')}\n${err}`))));
  });
}
const ffmpeg = (args) => run(ffmpegBin, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

async function probe(file) {
  const out = await run(ffprobeBin, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]);
  const [width, height] = out.trim().split(',').map(Number);
  return { width, height };
}

/** PNGs embedded as data URIs in a self-contained gallery page, in document order. */
const embedded = new Map();
async function embeddedImages(html) {
  if (!embedded.has(html)) {
    const text = await readFile(resolve(artifacts, html), 'utf8');
    embedded.set(html, [...text.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)].map((m) => m[1]));
  }
  return embedded.get(html);
}

/** Every source file an item needs, so a missing one fails the build before anything is written. */
async function checkSources() {
  const missing = [];
  const need = async (path) => {
    if (!existsSync(resolve(artifacts, path))) missing.push(`artifacts/${path}`);
  };
  const needItem = async (item) => {
    if (item.audio) {
      if (!existsSync(resolve(audioRoot, item.audio))) missing.push(`public/assets/audio/${item.audio}`);
    } else if (item.frames?.html) {
      if (!existsSync(resolve(artifacts, item.frames.html))) return missing.push(`artifacts/${item.frames.html}`);
      const found = (await embeddedImages(item.frames.html)).length;
      if (found < item.frames.from + item.frames.count)
        missing.push(`artifacts/${item.frames.html} (needs ${item.frames.from + item.frames.count} embedded images, has ${found})`);
    } else if (item.frames?.files) for (const f of item.frames.files) await need(f);
    else await need(item.src);
  };
  for (const topic of topics) {
    await needItem(topic.thumb);
    for (const section of topic.sections) for (const item of section.items) await needItem(item);
  }
  return missing;
}

/** Writes the item's frames as numbered PNGs and returns an ffmpeg input pattern. */
async function stageFrames(item, folder) {
  await mkdir(folder, { recursive: true });
  if (item.frames.html) {
    const images = (await embeddedImages(item.frames.html)).slice(item.frames.from, item.frames.from + item.frames.count);
    for (const [i, b64] of images.entries()) await writeFile(resolve(folder, `${String(i).padStart(3, '0')}.png`), Buffer.from(b64, 'base64'));
  } else
    for (const [i, file] of item.frames.files.entries())
      await copyFile(resolve(artifacts, file), resolve(folder, `${String(i).padStart(3, '0')}.png`));
  return resolve(folder, '%03d.png');
}

const cropFilter = (crop) => (crop ? [`crop=${crop[2]}:${crop[3]}:${crop[0]}:${crop[1]}`] : []);
const bitexact = ['-map_metadata', '-1', '-fflags', '+bitexact', '-flags:v', '+bitexact'];

async function encodeImage(input, out, { crop, width }) {
  const vf = [...cropFilter(crop), `scale='min(${width},iw)':-1:flags=lanczos`].join(',');
  await ffmpeg(['-i', input, '-frames:v', '1', '-vf', vf, '-c:v', 'libwebp', '-quality', '86', '-compression_level', '6', ...bitexact, out]);
}

async function encodeVideo(input, out, { crop, width, upscale, fps, hold, frames }) {
  const vf = [
    ...(frames ? [] : [`fps=${fps}`]),
    ...cropFilter(crop),
    `scale='min(${width},iw*${upscale})':-2:flags=lanczos`,
    ...(hold ? [`tpad=stop_mode=clone:stop_duration=${hold}`] : []),
    'format=yuv420p',
  ].join(',');
  const source = frames ? ['-framerate', String(fps), '-i', input] : ['-i', input];
  await ffmpeg([...source, '-vf', vf, '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', ...bitexact, out]);
}

async function encodeThumb(input, out, crop) {
  const vf = [...cropFilter(crop), 'scale=480:300:force_original_aspect_ratio=increase:flags=lanczos', 'crop=480:300'].join(',');
  await ffmpeg(['-i', input, '-frames:v', '1', '-vf', vf, '-c:v', 'libwebp', '-quality', '74', '-compression_level', '6', ...bitexact, out]);
}

async function pool(tasks) {
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) await tasks[next++]();
  };
  await Promise.all(Array.from({ length: jobs }, worker));
}

/** Plans one output file per item; returns encode tasks. */
function plan(topic, frameFolder) {
  const used = new Set(),
    tasks = [];
  const outName = (item, ext) => {
    let base = item.name ?? basename(item.src ?? item.audio).replace(/\.[^.]+$/, '');
    if (item.src?.includes('/before/')) base = `before-${base}`;
    if (item.crop && !item.name) base = `${base}-detail`;
    let name = `${base}${ext}`;
    for (let n = 2; used.has(name); ++n) name = `${base}-${n}${ext}`;
    used.add(name);
    return name;
  };
  for (const [s, section] of topic.sections.entries())
    for (const [i, item] of section.items.entries()) {
      if (item.audio) {
        item.out = { kind: 'audio', href: `../../assets/audio/${item.audio}` };
        continue;
      }
      const video = Boolean(item.frames) || item.src.endsWith('.gif');
      if (video && item.frames?.count === 1) {
        // A single embedded frame is a still.
        const name = outName(item, '.webp');
        item.out = { kind: 'image', file: `${topic.slug}/${name}` };
        tasks.push(async () => {
          const input = await stageFrames(item, resolve(frameFolder, `${s}-${i}`));
          await encodeImage(input.replace('%03d', '000'), resolve(staging, item.out.file), { width: imageWidth });
        });
        continue;
      }
      const name = outName(item, video ? '.mp4' : '.webp');
      item.out = { kind: video ? 'video' : 'image', file: `${topic.slug}/${name}` };
      const out = resolve(staging, item.out.file);
      if (video)
        tasks.push(async () => {
          const frames = Boolean(item.frames);
          const input = frames ? await stageFrames(item, resolve(frameFolder, `${s}-${i}`)) : resolve(artifacts, item.src);
          await encodeVideo(input, out, { crop: item.crop, width: item.width ?? videoWidth, upscale: item.upscale ?? 1, fps: item.fps ?? 25, hold: item.hold ?? 0, frames });
        });
      else
        tasks.push(() =>
          encodeImage(resolve(artifacts, item.src), out, { crop: item.crop, width: item.width ?? (section.cols > 1 ? gridImageWidth : imageWidth) }),
        );
    }
  topic.thumbFile = `${topic.slug}/thumb.webp`;
  tasks.push(async () => {
    const thumb = topic.thumb;
    const input = thumb.frames ? (await stageFrames(thumb, resolve(frameFolder, 'thumb'))).replace('%03d', '000') : resolve(artifacts, thumb.src);
    await encodeThumb(input, resolve(staging, topic.thumbFile), thumb.crop);
  });
  return tasks;
}

const style = `
@font-face { font-family: "DejaVu"; src: url("../../assets/native-fonts/DejaVuSans.ttf") format("truetype"); font-weight: 400; font-display: swap; }
@font-face { font-family: "DejaVu"; src: url("../../assets/native-fonts/DejaVuSans-Bold.ttf") format("truetype"); font-weight: 700; font-display: swap; }
@font-face { font-family: "Cinzel"; src: url("../../assets/native-fonts/Cinzel-Black.ttf") format("truetype"); font-display: swap; }
:root {
  --bg: rgb(17, 20, 18);
  --surface: rgb(25, 29, 25);
  --raised: rgb(35, 39, 32);
  --border: rgba(115, 98, 65, 0.82);
  --rule: rgba(115, 98, 65, 0.25);
  --text: rgb(225, 216, 189);
  --muted: rgb(157, 151, 128);
  --accent: rgb(191, 161, 99);
  --bright: rgb(232, 190, 110);
  --gutter: clamp(16px, 4vw, 64px);
  color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 400 clamp(15px, 1.05vw, 18px)/1.55 "DejaVu", Verdana, sans-serif; }
.wrap { width: 100%; max-width: 1360px; margin: 0 auto; padding: 0 var(--gutter); }
nav.top { display: flex; flex-wrap: wrap; gap: 6px 22px; padding: 18px 0; font-size: 0.85em; border-bottom: 1px solid var(--rule); }
a { color: var(--bright); }
a:focus-visible { outline: 2px solid var(--bright); outline-offset: 2px; }
header.page { padding: clamp(28px, 6vh, 64px) 0 clamp(12px, 3vh, 28px); }
h1, h2 { font-family: "Cinzel", Georgia, serif; font-weight: 900; letter-spacing: 0.04em; color: var(--bright); line-height: 1.12; margin: 0 0 0.35em; }
h1 { font-size: clamp(28px, 3.6vw, 50px); }
h2 { font-size: clamp(22px, 2.3vw, 34px); }
.kicker { text-transform: uppercase; letter-spacing: 0.18em; font-size: 0.72em; color: var(--muted); margin-bottom: 0.7em; }
.lead { font-size: clamp(16px, 1.3vw, 21px); max-width: 66ch; margin: 0 0 0.6em; }
.plain { color: var(--muted); margin: 0; }
section.part { padding: clamp(24px, 4vh, 44px) 0; border-top: 1px solid var(--rule); }
section.part > p { max-width: 70ch; margin: 0 0 1.1em; color: var(--text); }
.grid { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: 16px; align-items: start; }
figure { margin: 0; }
figure img, figure video { display: block; width: 100%; height: auto; border-radius: 6px; border: 1px solid var(--border); background: #0b0e0c; }
figure.rejected img, figure.rejected video { border-style: dashed; border-color: var(--muted); }
figure a { display: block; border-radius: 6px; }
figcaption { font-size: 0.82em; color: var(--muted); margin-top: 0.5em; }
.tag { display: inline-block; font-size: 0.78em; letter-spacing: 0.08em; text-transform: uppercase; padding: 0 0.55em; margin-right: 0.45em; border-radius: 4px; border: 1px solid var(--border); color: var(--bright); background: var(--raised); }
.tag.rejected { color: var(--text); border-style: dashed; border-color: var(--muted); background: transparent; }
.sound { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; }
.sound span { display: block; font-size: 0.85em; color: var(--muted); margin-bottom: 8px; }
.sound audio { width: 100%; height: 34px; }
.groups { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: clamp(24px, 4vh, 40px) 16px; padding: 8px 0 clamp(24px, 4vh, 40px); }
.group { grid-column: span var(--n); min-width: 0; }
.group h2 { font-size: clamp(18px, 1.6vw, 24px); padding-bottom: 0.35em; border-bottom: 1px solid var(--rule); }
.cards { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 16px; }
.grid.narrow { max-width: 1000px; }
a.card { display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; color: var(--text); text-decoration: none; transition: background 0.15s, border-color 0.15s; }
a.card:hover, a.card:focus-visible { background: var(--raised); border-color: var(--accent); }
a.card img { display: block; width: 100%; height: auto; aspect-ratio: 8 / 5; object-fit: cover; border-bottom: 1px solid var(--rule); background: #0b0e0c; }
a.card .body { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 6px; flex: 1; }
a.card strong { color: var(--bright); font-weight: 700; }
a.card .what { font-size: 0.86em; color: var(--text); }
a.card .count { margin-top: auto; font-size: 0.75em; color: var(--muted); }
footer.pager { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; padding: 26px 0 48px; border-top: 1px solid var(--rule); font-size: 0.9em; }
@media (max-width: 1000px) {
  .groups { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .group.wide { grid-column: span 2; }
  .group.wide .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 900px) {
  .grid { grid-template-columns: repeat(min(var(--cols), 2), minmax(0, 1fr)); }
}
@media (max-width: 560px) {
  .grid, .groups, .cards { grid-template-columns: minmax(0, 1fr); }
  .group, .group.wide { grid-column: auto; }
  .group.wide .cards { grid-template-columns: minmax(0, 1fr); }
}
`;

function page({ title, description, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="icon" href="../../favicon.svg" type="image/svg+xml">
<style>${style}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

async function figure(item) {
  const label = item.label ? `<span class="tag${item.rejected ? ' rejected' : ''}">${esc(item.label)}</span>` : '';
  const caption = `<figcaption>${label}${esc(item.caption)}</figcaption>`;
  if (item.out.kind === 'audio')
    return `<div class="sound"><span>${esc(item.caption)}</span><audio controls preload="none" src="${item.out.href}"></audio></div>`;
  const { width, height } = await probe(resolve(staging, item.out.file));
  const src = item.out.file;
  const alt = esc(item.caption);
  const media =
    item.out.kind === 'video'
      ? `<video src="${src}" width="${width}" height="${height}" muted autoplay loop playsinline preload="metadata" aria-label="${alt}"></video>`
      : `<a href="${src}" aria-label="Open full size"><img src="${src}" width="${width}" height="${height}" alt="${alt}" loading="lazy" decoding="async"></a>`;
  return `<figure${item.rejected ? ' class="rejected"' : ''}>${media}${caption}</figure>`;
}

const itemCount = (topic) => topic.sections.reduce((n, s) => n + s.items.length, 0);

async function topicPage(topic, index) {
  const prev = topics[index - 1],
    next = topics[index + 1];
  const parts = [];
  for (const section of topic.sections) {
    const figures = [];
    for (const item of section.items) figures.push(await figure(item));
    parts.push(`<section class="part">
<h2>${esc(section.title)}</h2>
${section.text ? `<p>${esc(section.text)}</p>\n` : ''}<div class="grid${section.narrow ? ' narrow' : ''}" style="--cols: ${section.cols}">
${figures.join('\n')}
</div>
</section>`);
  }
  const body = `<div class="wrap">
<nav class="top" aria-label="Development log"><a href="index.html">&larr; Development log</a><a href="../../docs.html">Back to the presentation</a></nav>
<header class="page">
<div class="kicker">${esc(topic.group)}</div>
<h1>${esc(topic.title)}</h1>
<p class="lead">${esc(topic.lead)}</p>
</header>
${parts.join('\n')}
<footer class="pager">
<span>${prev ? `<a href="${prev.slug}.html">&larr; ${esc(prev.title)}</a>` : '<a href="index.html">&larr; Development log</a>'}</span>
<span>${next ? `<a href="${next.slug}.html">${esc(next.title)} &rarr;</a>` : '<a href="index.html">Development log &rarr;</a>'}</span>
</footer>
</div>`;
  return page({ title: `${topic.title} | Midgard development log`, description: topic.summary, body });
}

function indexPage() {
  const sections = groups
    .map((group) => {
      const cards = topics
        .filter((t) => t.group === group)
        .map(
          (t) => `<a class="card" href="${t.slug}.html"><img src="${t.thumbFile}" width="480" height="300" alt="" loading="lazy" decoding="async"><span class="body"><strong>${esc(t.title)}</strong><span class="what">${esc(t.summary)}</span><span class="count">${itemCount(t)} ${t.slug === 'audio' ? 'items' : 'pictures and loops'}</span></span></a>`,
        )
        .join('\n');
      const n = topics.filter((t) => t.group === group).length;
      return `<section class="group${n > 1 ? ' wide' : ''}" style="--n: ${Math.min(n, 4)}">
<h2>${esc(group)}</h2>
<div class="cards">
${cards}
</div>
</section>`;
    })
    .join('\n');
  const body = `<div class="wrap">
<nav class="top" aria-label="Site"><a href="../../docs.html">&larr; Back to the presentation</a></nav>
<header class="page">
<div class="kicker">Midgard</div>
<h1>How it was made: the development log</h1>
<p class="plain">Working galleries from development; some show rejected attempts.</p>
</header>
<div class="groups">
${sections}
</div>
<footer class="pager"><a href="../../docs.html">&larr; Back to the presentation</a></footer>
</div>`;
  return page({ title: 'Midgard development log', description: 'Working galleries from the development of Midgard.', body });
}

async function folderSize(folder) {
  let total = 0;
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = resolve(folder, entry.name);
    total += entry.isDirectory() ? await folderSize(path) : (await stat(path)).size;
  }
  return total;
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

async function main() {
  const missing = await checkSources();
  if (missing.length) {
    throw new SourceError(`Missing source files; public/docs/devlog was left untouched:\n  ${missing.join('\n  ')}`);
  }
  await rm(staging, { recursive: true, force: true });
  const frameFolder = resolve(staging, '.frames');
  for (const topic of topics) await mkdir(resolve(staging, topic.slug), { recursive: true });
  await pool(topics.flatMap((topic) => plan(topic, resolve(frameFolder, topic.slug))));
  await rm(frameFolder, { recursive: true, force: true });

  for (const [i, topic] of topics.entries()) await writeFile(resolve(staging, `${topic.slug}.html`), await topicPage(topic, i));
  await writeFile(resolve(staging, 'index.html'), indexPage());

  for (const file of await readdir(staging)) {
    if (!file.endsWith('.html')) continue;
    const text = await readFile(resolve(staging, file), 'utf8');
    const leak = text.match(/file:\/\/|\/home\/|\/tmp\/|(?:src|href)="\/(?!\/)/);
    if (leak) throw new Error(`${file} contains a local or absolute path near "${leak[0]}"`);
  }

  const rows = [];
  let total = 0;
  for (const topic of topics) {
    const size = (await folderSize(resolve(staging, topic.slug))) + (await stat(resolve(staging, `${topic.slug}.html`))).size;
    total += size;
    rows.push(`  ${topic.slug.padEnd(22)} ${String(itemCount(topic)).padStart(3)} items  ${mb(size).padStart(10)}`);
  }
  total += (await stat(resolve(staging, 'index.html'))).size;
  if (total > budget) throw new Error(`The development log is ${mb(total)}, over the ${mb(budget)} budget; show fewer items.`);

  await rm(target, { recursive: true, force: true });
  await rename(staging, target);
  console.log(`Development log written to public/docs/devlog:\n${rows.join('\n')}\n  ${'total'.padEnd(22)} ${String(topics.reduce((n, t) => n + itemCount(t), 0)).padStart(3)} items  ${mb(total).padStart(10)}`);
}

try {
  await main();
} catch (error) {
  await rm(staging, { recursive: true, force: true });
  console.error(error instanceof SourceError ? error.message : error);
  process.exitCode = 1;
}

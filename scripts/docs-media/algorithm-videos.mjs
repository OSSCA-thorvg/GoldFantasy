// Annotated captures of two algorithms, drawn over the real game: where a building may stand (town-construction.ts)
// and how a freehand stroke becomes a road (road-stroke.ts, road-network.ts). The game draws its own placement ghost
// and road preview; the lines, boxes, curves and labels on top are this page's, computed by the game's own functions.
import { bootGame } from '../readme-media/capture-session.mjs';
import { encodeVideo, recordFrames } from './video-assembly.mjs';

const width = 1280,
  height = 720,
  fps = 30;

/** An overlay canvas and label helpers over the game canvas, in the page. */
async function addOverlay(page) {
  await page.evaluate(async () => {
    const [{ placementVariant }, { flatten }] = await Promise.all([
      import('/packages/engine/src/town-construction.ts'),
      import('/packages/engine/src/road-network.ts'),
    ]);
    const overlay = document.createElement('canvas');
    overlay.width = media.width;
    overlay.height = media.height;
    overlay.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
    document.body.append(overlay);
    const g = overlay.getContext('2d'),
      accent = 'rgb(232,190,110)',
      bad = 'rgb(226,104,84)',
      ink = 'rgba(245,238,222,0.95)';
    media.placementVariant = placementVariant;
    media.flatten = flatten;
    media.draw = {
      g,
      accent,
      bad,
      ink,
      clear: () => g.clearRect(0, 0, media.width, media.height),
      poly(points, color, width = 2, dash = []) {
        g.setLineDash(dash);
        g.strokeStyle = color;
        g.lineWidth = width;
        g.beginPath();
        points.forEach((p, i) => {
          const s = media.screen(p);
          if (i) g.lineTo(s.x, s.y);
          else g.moveTo(s.x, s.y);
        });
        g.stroke();
        g.setLineDash([]);
      },
      dot(p, color, r = 4) {
        const s = media.screen(p);
        g.fillStyle = color;
        g.beginPath();
        g.arc(s.x, s.y, r, 0, Math.PI * 2);
        g.fill();
      },
      ring(p, color, r = 6) {
        const s = media.screen(p);
        g.strokeStyle = color;
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(s.x, s.y, r, 0, Math.PI * 2);
        g.stroke();
      },
      tag(p, text, color, dx = 14, dy = -14) {
        const s = media.screen(p);
        g.font = '600 15px DejaVu Sans, Verdana, sans-serif';
        const w = g.measureText(text).width;
        g.fillStyle = 'rgba(20,24,22,0.86)';
        g.fillRect(s.x + dx - 6, s.y + dy - 15, w + 12, 22);
        g.fillStyle = color;
        g.fillText(text, s.x + dx, s.y + dy);
      },
      caption(lines) {
        g.font = '600 17px DejaVu Sans, Verdana, sans-serif';
        lines.forEach(([text, color], i) => {
          const w = g.measureText(text).width;
          g.fillStyle = 'rgba(20,24,22,0.86)';
          g.fillRect(24, 74 + i * 30 - 18, w + 20, 26);
          g.fillStyle = color;
          g.fillText(text, 34, 74 + i * 30);
        });
      },
    };
  });
}

export async function captureAlgorithmVideos(session) {
  const out = {};
  // Placement: a storehouse carried across open ground, up to a road (it turns its door to the road), onto the
  // road, onto a building, into the forest and the water; every frame asks the game whether it may stand there.
  {
    const page = await session.page(width, height);
    try {
      await bootGame(page, { width, height });
      await addOverlay(page);
      out.setup = await page.evaluate(() => {
        const { E, game } = media,
          t = game.town,
          c = t.map().camp();
        t.summonRaid = () => {};
        t.releaseMonster = () => {};
        t.scout(c.x, c.y, 24);
        t.place(E.Structure.Camp, c, 0);
        t.completeConstruction();
        t.reward(new E.Resources(500, 500, 500, 500, 0, 0, 50, 50, 0));
        const road = (pts) => {
          const path = pts.map(([x, y]) => E.sharpAnchor(E.add(c, E.point(x, y))));
          if (t.canBuildRoad(path).ok) t.buildRoad(path);
        };
        road([[1.2, 0], [9, 0]]);
        t.completeConstruction();
        t.place(E.Structure.Tent, E.add(c, E.point(5, 1.6)), 0);
        t.completeConstruction();
        media.hour(11);
        game.objectivesCollapsed = true;
        game.selectPeople([]);
        media.view = E.add(c, E.point(4.5, 2.5));
        media.look(media.view, 2.1);
        game.selectTool(E.Tool.Storehouse, false);
        media.kind = E.Structure.Storehouse;
        // The cursor's way across the ground, in tiles from the camp.
        media.route = [
          [2.5, 6],
          [5.5, 5.5],
          [5.2, 2.6],
          [6.8, 1.4],
          [7, 0.1],
          [5, 1.6],
          [3, 3.4],
          [0.6, 5.4],
          [-1.5, 6.5],
        ].map(([x, y]) => E.add(c, E.point(x, y)));
        media.quiet();
        media.frames(4, 0.05);
        return { camp: c };
      });
      const frames = await recordFrames(page, 'placement', {
        count: 9 * fps,
        arg: 9 * fps,
        step: ([i, total]) => {
          const { E, game } = media,
            t = game.town,
            d = media.draw,
            route = media.route,
            u = Math.min(0.9999, i / (total - 1)) * (route.length - 1),
            k = Math.floor(u),
            f = u - k,
            ease = f * f * (3 - 2 * f),
            cursor = { x: route[k].x + (route[k + 1].x - route[k].x) * ease, y: route[k].y + (route[k + 1].y - route[k].y) * ease },
            s = media.screen(cursor);
          game.pointerMove(s.x, s.y);
          media.look(media.view, 2.1);
          media.frame(1 / 30);
          const kind = media.kind,
            fit = t.fit(kind, cursor, 0),
            check = t.canPlace(kind, fit.center, fit.angle),
            probe = new E.Building(-1, kind, fit.center, fit.angle, media.placementVariant(t.map(), kind, fit.center)),
            corners = probe.footprint().corners(),
            door = probe.door(),
            color = check.ok ? d.accent : d.bad;
          d.clear();
          d.poly([...corners, corners[0]], color, 2.5);
          d.dot(cursor, d.ink, 3);
          if (fit.snapped) d.poly([cursor, fit.center], d.ink, 1.5, [4, 4]);
          d.dot(door, color, 5);
          d.tag(door, 'door', color, 10, 22);
          // Builders must reach the door: the walk from the camp's door, on the game's own walk grid.
          const path = check.ok ? t.grid.path(t.camp().door(), door) : [];
          if (path.length) d.poly([t.camp().door(), ...path], d.ink, 1.5, [2, 5]);
          d.tag(corners[2], check.ok ? (fit.snapped ? 'Valid · door turned to the road' : 'Valid') : check.reason, color, 12, 30);
          d.caption([
            ['fit(): snaps beside a road and turns the door to it', d.ink],
            ['canPlace(): ground, roads, buildings, fields, a reachable door', d.ink],
          ]);
        },
      });
      out.placement = { ...(await encodeVideo('placement', { fps, width: 1280, crf: 22 })), frames: frames.frames };
    } finally {
      await page.context().close();
    }
  }
  // Roads: a hand-drawn stroke leaving the camp and meeting a road; the samples, the fitted anchors with their
  // handles and the curve, then the road laid.
  {
    const page = await session.page(width, height);
    try {
      await bootGame(page, { width, height });
      await addOverlay(page);
      await page.evaluate(() => {
        const { E, game } = media,
          t = game.town,
          c = t.map().camp();
        t.summonRaid = () => {};
        t.releaseMonster = () => {};
        t.scout(c.x, c.y, 24);
        t.place(E.Structure.Camp, c, 0);
        t.completeConstruction();
        t.reward(new E.Resources(500, 500, 500, 500, 0, 0, 50, 50, 0));
        const path = [[1.2, 0], [9, 0]].map(([x, y]) => E.sharpAnchor(E.add(c, E.point(x, y))));
        if (t.canBuildRoad(path).ok) t.buildRoad(path);
        t.completeConstruction();
        media.hour(11);
        game.objectivesCollapsed = true;
        game.selectPeople([]);
        media.view = E.add(c, E.point(3.8, 2.6));
        media.look(media.view, 2.1);
        game.selectTool(E.Tool.Road, false);
        // A hand's wobbly line: out of the camp, round, and into the road at a slant.
        const knots = [
            [0.2, 1.1],
            [0.8, 3.4],
            [2.6, 5],
            [5, 4.6],
            [6.6, 2.6],
            [7.2, 0.6],
          ],
          pts = [];
        for (let i = 0; i <= 90; ++i) {
          const u = (i / 90) * (knots.length - 1),
            k = Math.min(knots.length - 2, Math.floor(u)),
            f = u - k,
            w = 0.035 * Math.sin(i * 0.7) + 0.02 * Math.sin(i * 1.9);
          pts.push(E.add(c, E.point(knots[k][0] + (knots[k + 1][0] - knots[k][0]) * f + w, knots[k][1] + (knots[k + 1][1] - knots[k][1]) * f - w)));
        }
        media.stroke = pts;
        media.quiet();
        media.frames(4, 0.05);
      });
      const frames = await recordFrames(page, 'roads', {
        count: 8 * fps,
        step: ([i]) => {
          const { game } = media,
            t = game.town,
            d = media.draw,
            n = media.stroke.length,
            drawing = 120,
            at = Math.min(n - 1, Math.floor((i / drawing) * n));
          media.look(media.view, 2.1);
          if (i <= drawing) {
            const s = media.screen(media.stroke[at]);
            if (i === 0) {
              game.pointerMove(s.x, s.y);
              game.pointerDown(s.x, s.y, 0);
            } else game.pointerMove(s.x, s.y);
            if (i === drawing) media.draft = game.roadDraft();
          }
          if (i === drawing + 20) {
            const s = media.screen(media.stroke[n - 1]);
            game.pointerUp(s.x, s.y, 0);
            media.laid = true;
          }
          if (i === drawing + 60) t.completeConstruction();
          media.frame(1 / 30);
          d.clear();
          const samples = i <= drawing ? game.roadStroke : media.stroke;
          for (const p of samples) d.dot(p, 'rgba(245,238,222,0.55)', 2);
          const path = i <= drawing ? game.roadDraft() : media.draft;
          if (path?.length && !(media.laid && i > drawing + 60)) {
            d.poly(media.flatten(path, 0.2), d.accent, 2.5);
            for (const a of path) {
              d.poly([a.in, a.point, a.out], d.ink, 1.2);
              d.ring(a.in, d.ink, 3);
              d.ring(a.out, d.ink, 3);
              d.dot(a.point, d.accent, 5);
            }
          }
          d.caption(
            i <= drawing + 20
              ? [
                  [`${samples.length} pointer samples  ->  ${path?.length ?? 0} anchors with handles (freehandRoad)`, d.ink],
                  ['the start leaves the camp at its edge; the end blends into the road it meets', d.ink],
                ]
              : i <= drawing + 60
                ? [['released: the fitted curve is the road the builders will lay', d.ink]]
                : [['laid: workers route along the network (road-graph.ts)', d.ink]],
          );
        },
      });
      out.roads = { ...(await encodeVideo('roads', { fps, width: 1280, crf: 22 })), frames: frames.frames };
    } finally {
      await page.context().close();
    }
  }
  return out;
}

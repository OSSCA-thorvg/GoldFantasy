#include "hvergelmir_painter.h"
#include "vector_paint.h"
#include <algorithm>
#include <cmath>
#include <iterator>
#include <vector>

namespace hearthold
{
namespace
{
tvg::Shape* filled(const std::vector<Point>& points, Rgba color)
{
    auto shape = tvg::Shape::gen();
    shape->moveTo(points[0].x, points[0].y);
    for (size_t i = 1; i < points.size(); ++i) shape->lineTo(points[i].x, points[i].y);
    shape->close();
    fill(shape, color);
    return shape;
}

// Each step down the shaft: a ledge's top catching the light, then the sheer wall below it. Pale ice under the lip
// falls quickly into the blue-black of the deep.
constexpr Rgb ledges[] = {{150, 186, 212}, {44, 74, 108}, {8, 18, 36}, {3, 7, 18}, {1, 4, 12}};
constexpr Rgb walls[] = {{96, 136, 174}, {16, 32, 58}, {3, 9, 22}, {1, 5, 14}, {0, 2, 8}};
constexpr Rgb frost{214, 226, 238}, cornice{236, 244, 250}, icicle{206, 228, 242}, mist{226, 236, 244};
}  // namespace

void paintHvergelmir(tvg::Scene* ornaments, const WorldMap& map)
{
    auto spring = map.hvergelmir();
    auto lake = [&](Point p) { return std::min(map.value(Layer::Land, p) - .12f, .3f - map.value(Layer::Elevation, p)); };
    if (lake(spring) <= 0) return;
    // Its lip, walked round from the middle: as far as the spring's water reaches each way, and the frost
    // drifted raggedly beyond it.
    constexpr int around = 72;
    std::vector<Point> lip, drift;
    for (int k = 0; k < around; ++k) {
        float bearing = float(k) * 6.2832f / around;
        Point along{std::cos(bearing), std::sin(bearing)};
        float reach = 0;
        while (reach < 16 && lake(spring + along * (reach + .1f)) > 0) reach += .1f;
        auto edge = spring + along * reach, rim = spring + along * (reach + .45f + .55f * hash01(map.seed(), k, 0, 1300));
        lip.push_back(project(edge.x, edge.y));
        drift.push_back(project(rim.x, rim.y));
    }
    auto middle = project(spring.x, spring.y);
    float top = middle.y, bottom = middle.y, left = middle.x, right = middle.x;
    for (auto p : lip) {
        top = std::min(top, p.y); bottom = std::max(bottom, p.y);
        left = std::min(left, p.x); right = std::max(right, p.x);
    }
    float tall = bottom - top, wide = right - left;
    ornaments->add(filled(drift, opaque(frost)));

    // The shaft, seen only through its mouth: each step down a ring sunk far lower and only a little smaller, so the
    // far walls drop sheer from ledge to ledge and the near lip soon hides the rest.
    auto shaft = tvg::Scene::gen();
    auto ring = [&](float share, float sink) {
        std::vector<Point> points;
        for (auto p : lip) points.push_back(middle + (p - middle) * share + Point{0, sink});
        return points;
    };
    for (size_t step = 0; step < std::size(ledges); ++step) {
        float share = 1 - .05f * float(step), sink = tall * .3f * float(step);
        shaft->add(filled(ring(share, sink), opaque(ledges[step])));
        shaft->add(filled(ring(share - .02f, sink + tall * .06f), opaque(walls[step])));
    }
    // Far below, the spring wells up black, lit faintly from beneath.
    shaft->add(glow(middle + Point{0, tall * .5f}, wide * .2f, tall * .18f, {70, 190, 220}, 60));
    // Snow overhangs the far lip, and icicles hang from it down the walls.
    auto overhang = tvg::Shape::gen(), icicles = tvg::Shape::gen();
    for (int k = 0; k < around; ++k) {
        Point a = lip[size_t(k)], b = lip[size_t((k + 1) % around)];
        float far = (middle.y - (a.y + b.y) / 2) / (tall / 2);  // 1 at the far lip, 0 at the sides.
        if (far < .15f) continue;
        Point inward = (middle - lerp(a, b, .5f)) * (.04f * far);
        appendPolygon(overhang, {a, b, b + inward, a + inward});
        for (int i = 0; i < 2; ++i) {
            Point from = lerp(a, b, i * .5f), to = lerp(a, b, i * .5f + .5f), tip = lerp(from, to, .35f + .3f * hash01(map.seed(), k, i + 1, 1300));
            tip.y += tall * far * (.05f + .11f * hash01(map.seed(), k, i + 3, 1300));
            appendPolygon(icicles, {from, to, tip});
        }
    }
    fill(icicles, opaque(icicle));
    fill(overhang, opaque(cornice));
    shaft->add(icicles);
    shaft->add(overhang);
    shaft->clip(filled(lip, opaque(Rgb{255, 255, 255})));
    ornaments->add(shaft);

    // Cold mist climbing out over the near lip in faint, soft wisps.
    for (int i = 0; i < 3; ++i) {
        float across = (float(i) - 1 + (hash01(map.seed(), i, 5, 1300) - .5f) * .6f) * wide * .26f, rise = tall * (.36f + .1f * hash01(map.seed(), i, 6, 1300));
        float r = wide * (.12f + .06f * hash01(map.seed(), i, 7, 1300));
        ornaments->add(glow(middle + Point{across, rise}, r, r * .38f, mist, uint8_t(40 + 24 * hash01(map.seed(), i, 8, 1300))));
    }
}
}  // namespace hearthold

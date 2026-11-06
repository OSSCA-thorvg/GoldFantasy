#include "tree_painter.h"
#include <algorithm>
#include <cmath>

namespace hearthold
{
namespace
{
// 0 at `from`, 1 at `to`, easing between; `from` may lie above `to`.
float ease(float from, float to, float x)
{
    float t = std::clamp((x - from) / (to - from), 0.f, 1.f);
    return t * t * (3 - 2 * t);
}

constexpr Rgb canopyLit{38, 70, 52}, canopyShade{24, 46, 37}, stem{44, 32, 26}, deadwood{96, 88, 84};
constexpr Rgb snowLit{214, 222, 232}, snowShade{180, 190, 206};
}  // namespace

Tree treeAt(const WorldMap& map, int x, int y, int index)
{
    uint32_t seed = map.seed();
    Tree tree;
    tree.foot = treePosition(map, x, y, index);
    // Most trees are about grown; some are saplings and a few old giants.
    tree.size = .5f + std::pow(hash01(seed, x, y, 50 + index), 1.3f) * 1.05f;
    tree.slender = .85f + hash01(seed, x, y, 51 + index) * .4f;
    tree.lean = (hash01(seed, x, y, 52 + index) - .5f) * 3;
    tree.variant = hash01(seed, x, y, 55 + index);
    float heat = map.value(Layer::Heat, tree.foot), pick = hash01(seed, x, y, 53 + index);
    auto terrain = map.at(x, y).terrain;
    // The woods die off towards the fire and carry snow towards the ice, a few trees at a time.
    if (terrain == Terrain::Frost) tree.kind = TreeKind::SnowySpruce;
    else if (terrain == Terrain::Ash || pick < ease(.55f, .66f, heat)) tree.kind = TreeKind::Snag;
    else if (pick < ease(.33f, .25f, heat)) tree.kind = TreeKind::SnowySpruce;
    else tree.kind = TreeKind::Fir;
    if (tree.kind == TreeKind::SnowySpruce) tree.slender += .15f;  // The spruce of the frost grow narrow.
    return tree;
}

TreeBatch::TreeBatch(const Climate& climate) : climate(climate), snowy(climate.snow > .3f)
{
    for (auto*& part : parts) part = tvg::Shape::gen();
}

TreeBatch::~TreeBatch()
{
    for (auto* part : parts)
        if (part) tvg::Paint::rel(part);
}

void TreeBatch::add(const Tree& tree)
{
    auto base = project(tree.foot.x, tree.foot.y);
    switch (tree.kind) {
    case TreeKind::Fir: fir(base, tree); break;
    case TreeKind::SnowySpruce: spruce(base, tree); break;
    case TreeKind::Snag: snag(base, tree); break;
    }
}

// Two stacked triangles on a short trunk, lit on the west; a cap of snow in winter.
void TreeBatch::fir(Point b, const Tree& tree)
{
    float s = tree.size, w = 9 * s, top = 30 * s * tree.slender, foot = b.y - 5 * s;
    parts[Stems]->appendRect(b.x - 1.6f * s, b.y - 6 * s, 3.2f * s, 6 * s);
    appendPolygon(parts[Lit], {{b.x - w, foot}, {b.x, foot - top * .62f}, {b.x, b.y - 3 * s}});
    appendPolygon(parts[Shade], {{b.x + w, foot}, {b.x, foot - top * .62f}, {b.x, b.y - 3 * s}});
    appendPolygon(parts[Lit], {{b.x - w * .74f, foot - top * .36f}, {b.x, foot - top}, {b.x, b.y - 4 * s - top * .36f}});
    appendPolygon(parts[Shade], {{b.x + w * .74f, foot - top * .36f}, {b.x, foot - top}, {b.x, b.y - 4 * s - top * .36f}});
    if (snowy) appendPolygon(parts[SnowLit], {{b.x - w * .34f, foot - top * .7f}, {b.x, foot - top}, {b.x + w * .34f, foot - top * .7f}});
}

// Tiers of drooping boughs narrowing to a spire, snow lying on each tier's upper boughs all year.
void TreeBatch::spruce(Point b, const Tree& tree)
{
    float s = tree.size, height = 36 * s * tree.slender, width = 7.2f * s;
    parts[Stems]->appendRect(b.x - 1.3f * s, b.y - 4 * s, 2.6f * s, 4 * s);
    int tiers = s < .8f ? 3 : 4;
    float bottom = b.y - 3 * s, step = (height - 3 * s) / (tiers + 1.2f), droop = 1.6f * s;
    for (int t = 0; t < tiers; ++t) {
        float foot = bottom - t * step, half = width * (1 - t / (tiers + .6f)), lean = tree.lean * s * (t + 2.2f) / (tiers + 1.2f);
        Point apex{b.x + lean, foot - step * 2.2f}, left{b.x - half, foot + droop}, right{b.x + half, foot + droop}, middle{b.x + lean * .3f, foot};
        appendPolygon(parts[Lit], {left, apex, middle});
        appendPolygon(parts[Shade], {middle, apex, right});
        auto l = lerp(apex, left, .64f), r = lerp(apex, right, .59f), m = lerp(apex, middle, .51f);
        appendPolygon(parts[SnowLit], {apex, l, lerp(l, m, .5f) + Point{0, -.9f * s}, m});
        appendPolygon(parts[SnowShade], {apex, m, lerp(m, r, .5f) + Point{0, .8f * s}, r});
    }
}

// A dead tree by the fire: a weathered grey trunk, often snapped, with bare boughs reaching up.
void TreeBatch::snag(Point b, const Tree& tree)
{
    float s = tree.size * 1.15f, height = 30 * s * tree.slender, lean = tree.lean * s;
    bool snapped = tree.variant < .3f;
    if (snapped) height *= .62f;
    appendPolygon(parts[Dead], {{b.x - 2.2f * s, b.y}, {b.x - .6f * s + lean, b.y - height}, {b.x + .6f * s + lean, b.y - height}, {b.x + 2.2f * s, b.y}});
    int boughs = snapped ? 2 : 4;
    for (int k = 0; k < boughs; ++k) {
        float f = .42f + k * .14f, side = (k + int(tree.variant * 7)) % 2 ? 1.f : -1.f, reach = (11 - 5 * f) * s;
        Point from{b.x + lean * f, b.y - height * f}, tip{from.x + side * reach * .8f, from.y - reach * .75f};
        appendPolygon(parts[Dead], {{from.x, from.y - 1.5f * s}, tip, {from.x, from.y + .7f * s}});
        auto fork = lerp(from, tip, .55f);
        appendPolygon(parts[Dead], {{fork.x, fork.y - .7f * s}, {fork.x + side * 1.6f * s, fork.y - 4.5f * s}, {fork.x + side * .3f * s, fork.y + .4f * s}});
    }
}

std::vector<tvg::Shape*> TreeBatch::finish(float base)
{
    auto canopy = [&](Rgb c) { return mix(mix(c, {78, 70, 40}, .22f * climate.autumn), {70, 78, 86}, .3f * climate.snow); };
    verticalShade(parts[Dead], deadwood, base - 80, base, 1.3f, .75f);
    fill(parts[Stems], opaque(stem));
    verticalShade(parts[Lit], canopy(canopyLit), base - 50, base, 1.35f, .8f);
    verticalShade(parts[Shade], canopy(canopyShade), base - 50, base, 1.3f, .75f);
    fill(parts[SnowShade], opaque(snowShade));
    fill(parts[SnowLit], opaque(snowLit));
    std::vector<tvg::Shape*> drawn;
    for (auto*& part : parts) {
        const tvg::Point* points = nullptr;
        uint32_t count = 0;
        part->path(nullptr, nullptr, &points, &count);
        if (count) drawn.push_back(part);
        else tvg::Paint::rel(part);
        part = nullptr;
    }
    return drawn;
}
}  // namespace hearthold

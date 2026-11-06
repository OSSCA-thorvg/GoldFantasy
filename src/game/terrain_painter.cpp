#include "terrain_painter.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <numeric>
#include <unordered_map>

namespace hearthold
{
namespace
{
constexpr float cliffDepth = 22;  // Screen pixels from the land plateau down to the sea.
constexpr float seaDrop = cliffDepth / (2 * tileHalfHeight);  // The same drop as a world (+x, +y) shift.
constexpr float step = 1.f / WorldMap::resolution;

constexpr std::array<std::array<Rgb, 4>, terrainCount> palette{{
    {{{36, 50, 40}, {40, 55, 42}, {44, 59, 45}, {48, 63, 47}}},  // Grass.
    {{{50, 62, 42}, {54, 66, 44}, {58, 70, 46}, {62, 74, 48}}},  // Meadow, greener than sand.
    {{{28, 40, 33}, {31, 43, 35}, {34, 46, 37}, {37, 49, 39}}},  // Forest floor.
    {{{20, 31, 45}, {22, 34, 49}, {24, 37, 53}, {26, 40, 57}}},  // Water.
    {{{58, 57, 61}, {63, 62, 66}, {68, 67, 71}, {73, 72, 76}}},  // Rock.
    {{{84, 76, 58}, {88, 80, 61}, {92, 83, 64}, {96, 87, 67}}},  // Sand.
    {{{14, 24, 36}, {15, 26, 38}, {16, 28, 40}, {17, 30, 42}}},  // Sea.
    {{{52, 52, 60}, {56, 56, 64}, {60, 60, 68}, {64, 64, 72}}},  // Mountain flanks.
    {{{58, 52, 50}, {62, 56, 53}, {66, 60, 56}, {70, 64, 59}}},  // Ash.
    {{{150, 158, 170}, {156, 164, 176}, {162, 170, 182}, {168, 176, 188}}},  // Frost.
    {{{120, 150, 172}, {126, 156, 178}, {132, 162, 184}, {138, 168, 190}}},  // Ice.
    {{{150, 52, 24}, {162, 60, 26}, {174, 68, 28}, {186, 76, 30}}},  // Lava.
}};

// One marching-squares cell of a region where a sampled field is >= 0.
struct Cell
{
    std::array<Point, 8> inside;
    std::array<std::pair<Point, Point>, 2> edges;
    std::array<std::pair<uint8_t, uint8_t>, 2> sides;
    size_t points = 0, segments = 0;
    bool full = false;
};

template<typename Sample>
Cell contourCell(int i, int j, Sample sample)
{
    constexpr int corners[4][2] = {{0, 0}, {1, 0}, {1, 1}, {0, 1}};
    Cell cell;
    float value[4];
    int in = 0;
    for (int k = 0; k < 4; ++k) {
        value[k] = sample(i + corners[k][0], j + corners[k][1]);
        in += value[k] >= 0;
    }
    if (in == 0) return cell;
    if (in == 4) { cell.full = true; return cell; }
    int crossing = -1, crossingSide = 0, firstSide = 0;
    Point first{};
    for (int k = 0; k < 4; ++k) {
        int n = (k + 1) % 4;
        Point a{(i + corners[k][0]) * step, (j + corners[k][1]) * step}, b{(i + corners[n][0]) * step, (j + corners[n][1]) * step};
        if (value[k] >= 0) cell.inside[cell.points++] = a;
        if ((value[k] >= 0) == (value[n] >= 0)) continue;
        float t = value[k] / (value[k] - value[n]);
        Point p = lerp(a, b, t);
        cell.inside[cell.points++] = p;
        if (value[k] >= 0) { crossing = int(cell.points) - 1; crossingSide = k; }  // Leaving the region: a boundary piece starts.
        else if (crossing >= 0) {
            cell.edges[cell.segments] = {cell.inside[size_t(crossing)], p};
            cell.sides[cell.segments++] = {uint8_t(crossingSide), uint8_t(k)}; crossing = -1;
        } else { first = p; firstSide = k; }
    }
    if (crossing >= 0) {
        cell.edges[cell.segments] = {cell.inside[size_t(crossing)], first};
        cell.sides[cell.segments++] = {uint8_t(crossingSide), uint8_t(firstSide)};
    }
    return cell;
}

TileRegion sampleArea(const WorldMap& map, int margin, const TileRegion* area)
{
    int r = WorldMap::resolution;
    TileRegion result{-margin, -margin, map.width() * r + margin, map.height() * r + margin};
    if (area) {
        result.left = std::max(result.left, area->left * r); result.top = std::max(result.top, area->top * r);
        result.right = std::min(result.right, area->right * r); result.bottom = std::min(result.bottom, area->bottom * r);
    }
    return result;
}

template<typename Sample, typename Visit>
void eachCell(const WorldMap& map, int margin, Sample sample, Visit visit, const TileRegion* area = nullptr)
{
    auto bounds = sampleArea(map, margin, area);
    for (int j = bounds.top; j < bounds.bottom; ++j)
        for (int i = bounds.left; i < bounds.right; ++i) {
            auto cell = contourCell(i, j, sample);
            if (cell.points) visit(cell);
        }
}

void appendOutline(tvg::Shape* shape, const Point* points, size_t count, Point shift = {})
{
    shape->moveTo(points[0].x + shift.x, points[0].y + shift.y);
    for (size_t k = 1; k < count; ++k) shape->lineTo(points[k].x + shift.x, points[k].y + shift.y);
    shape->close();
}

void appendOutline(tvg::Shape* shape, const std::vector<Point>& points, Point shift = {}) { appendOutline(shape, points.data(), points.size(), shift); }

// Keep only the union's boundary. Row rectangles and separate edge-cell polygons contain the
// same land, but their internal edges are retessellated whenever the camera zoom changes.
template<typename Sample>
tvg::Shape* region(const WorldMap& map, int margin, Sample sample, Point shift = {}, const TileRegion* area = nullptr)
{
    auto shape = tvg::Shape::gen();
    auto bounds = sampleArea(map, margin, area);
    if (bounds.empty()) return shape;
    struct Edge { Point a, b; uint64_t from, to; };
    std::vector<Edge> edges;
    const uint64_t stride = uint64_t(bounds.right - bounds.left + 1);
    auto node = [&](int i, int j) { return uint64_t(j - bounds.top) * stride + uint64_t(i - bounds.left); };
    auto vertex = [&](int i, int j) { return (uint64_t(1) << 63) | node(i, j); };
    auto crossing = [&](int i, int j, uint8_t side) {
        if (side == 1) ++i;
        if (side == 2) ++j;
        return node(i, j) * 2 + (side % 2);
    };
    for (int j = bounds.top; j < bounds.bottom; ++j)
        for (int i = bounds.left; i < bounds.right; ++i) {
            auto cell = contourCell(i, j, sample);
            for (size_t k = 0; k < cell.segments; ++k) {
                auto [a, b] = cell.edges[k]; auto [from, to] = cell.sides[k];
                edges.push_back({a, b, crossing(i, j, from), crossing(i, j, to)});
            }
        }
    // A bounded chunk cuts contours at its outer grid edges. Close those cuts in the same
    // clockwise order as the individual cell polygons, including holes in the opposite order.
    auto border = [&](int i, int j, int nextI, int nextJ, uint64_t edge) {
        float a = sample(i, j), b = sample(nextI, nextJ);
        if (a < 0 && b < 0) return;
        Point from{i * step, j * step}, to{nextI * step, nextJ * step};
        auto first = vertex(i, j), last = vertex(nextI, nextJ);
        if ((a >= 0) != (b >= 0)) {
            auto intersection = lerp(from, to, a / (a - b));
            if (a < 0) { from = intersection; first = edge; }
            else { to = intersection; last = edge; }
        }
        edges.push_back({from, to, first, last});
    };
    for (int i = bounds.left; i < bounds.right; ++i) {
        border(i, bounds.top, i + 1, bounds.top, crossing(i, bounds.top, 0));
        border(i + 1, bounds.bottom, i, bounds.bottom, crossing(i, bounds.bottom - 1, 2));
    }
    for (int j = bounds.top; j < bounds.bottom; ++j) {
        border(bounds.right, j, bounds.right, j + 1, crossing(bounds.right - 1, j, 1));
        border(bounds.left, j + 1, bounds.left, j, crossing(bounds.left, j, 3));
    }
    std::unordered_map<uint64_t, size_t> outgoing;
    outgoing.reserve(edges.size());
    for (size_t k = 0; k < edges.size(); ++k) outgoing.emplace(edges[k].from, k);
    std::vector<bool> used(edges.size());
    for (size_t start = 0; start < edges.size(); ++start) {
        if (used[start]) continue;
        shape->moveTo(edges[start].a.x + shift.x, edges[start].a.y + shift.y);
        size_t current = start;
        do {
            used[current] = true;
            const auto& edge = edges[current];
            shape->lineTo(edge.b.x + shift.x, edge.b.y + shift.y);
            auto next = outgoing.find(edge.to);
            if (next == outgoing.end()) break;
            current = next->second;
        } while (!used[current]);
        shape->close();
    }
    return shape;
}

Point drop(Point p, float k = 1) { return {p.x + seaDrop * k, p.y + seaDrop * k}; }

auto layer(const WorldMap& map, Layer which) { return [&map, which](int i, int j) { return map.sample(which, i, j); }; }

// The sea under the cliffs, deepening from sunlit shallows by the shore to the dark of the open sea a band at a
// time, so the water shows its depth by colour alone. A hard frost pales the shallows more than the deep.
void paintSea(tvg::Scene* iso, const WorldMap& map, std::vector<Tinted>& tints, const TileRegion* area)
{
    auto land = layer(map, Layer::Land);
    struct Band
    {
        float depth;
        Rgb color;
        float freezes;
    };
    constexpr Band bands[] = {{.32f, {13, 22, 32}, .08f}, {.18f, {16, 28, 39}, .13f}, {.09f, {20, 35, 47}, .18f}, {.04f, {25, 43, 55}, .22f}, {.012f, {32, 53, 64}, .26f}};
    for (auto band : bands) {
        auto shape = region(map, 2, [&, band](int i, int j) { return land(i, j) + band.depth; }, drop({}), area);
        tints.push_back({shape, [band](const Climate& k) { return opaque(mix(band.color, {84, 98, 116}, band.freezes * k.frost)); }, false});
        iso->add(shape);
    }
}

// Cliff faces hanging from every camera-facing piece of coastline, back to front.
void paintCliffs(tvg::Scene* iso, const WorldMap& map, const TileRegion* area)
{
    struct Face
    {
        Point a, b;
        float depth;
        Rgb color;
        bool molten;
    };
    std::vector<Face> faces;
    eachCell(map, 0, layer(map, Layer::Land), [&](const Cell& cell) {
        for (size_t i = 0; i < cell.segments; ++i) {
            auto [a, b] = cell.edges[i];
            // Land lies right of a->b, so the outward normal is to the left: (dy, -dx).
            float nx = b.y - a.y, ny = a.x - b.x, length = std::hypot(nx, ny);
            if (length < 1e-4f || nx + ny <= 0) continue;
            float side = std::clamp((nx - ny) / length * .5f + .5f, 0.f, 1.f);  // 1 faces screen-right.
            Point inland{(a.x + b.x) / 2 - nx / length * .3f, (a.y + b.y) / 2 - ny / length * .3f};
            auto ground = map.terrainAt(inland);
            // Where lava reaches the shore it pours down the face into the sea.
            bool molten = ground == Terrain::Lava;
            auto rock = molten ? mix(Rgb{240, 128, 46}, Rgb{198, 72, 28}, side)
                      : ground == Terrain::Sand ? mix(Rgb{92, 80, 62}, Rgb{66, 58, 46}, side) : mix(Rgb{50, 44, 44}, Rgb{30, 27, 31}, side);
            faces.push_back({a, b, (a.x + b.x + a.y + b.y) / 2, rock, molten});
        }
    }, area);
    std::sort(faces.begin(), faces.end(), [](const Face& l, const Face& r) { return l.depth < r.depth; });
    // Faces share a shape only while consecutive in depth, keeping the back-to-front order.
    tvg::Shape* current = nullptr;
    uint32_t currentKey = ~0u;
    for (const auto& face : faces) {
        uint32_t key = uint32_t(face.color.r) << 16 | uint32_t(face.color.g) << 8 | face.color.b;
        if (!current || key != currentKey) {
            current = tvg::Shape::gen();
            fill(current, opaque(face.color));
            iso->add(current);
            currentKey = key;
        }
        appendPolygon(current, {face.a, face.b, drop(face.b), drop(face.a)});
    }
    // Dark band where the turf overhangs the face.
    auto lip = tvg::Shape::gen();
    for (const auto& face : faces)
        if (!face.molten) appendPolygon(lip, {face.a, face.b, drop(face.b, .18f), drop(face.a, .18f)});
    fill(lip, {24, 22, 20, 120});
    iso->add(lip);
}

// A ribbon along the river path reaching `half(i)` to each side of its `i`th point, broken where the river is and
// wherever `half` reaches nothing.
template<typename Half>
tvg::Shape* riverRibbon(const River& river, Half half)
{
    auto shape = tvg::Shape::gen();
    const auto& path = river.path;
    if (path.size() < 2) return shape;
    std::vector<Point> left, right;
    std::vector<bool> wet(path.size());
    for (size_t i = 0; i < path.size(); ++i) {
        auto along = normalized(path[std::min(i + 1, path.size() - 1)] - path[i > 0 ? i - 1 : 0]);
        Point normal{-along.y, along.x};
        float reach = half(i);
        wet[i] = river.width[i] > 0 && reach > 0;
        left.push_back(path[i] + normal * reach);
        right.push_back(path[i] - normal * reach);
    }
    for (size_t first = 0; first < path.size();) {
        while (first < path.size() && !wet[first]) ++first;
        size_t end = first;
        while (end < path.size() && wet[end]) ++end;
        if (end - first >= 2) {
            shape->moveTo(left[first].x, left[first].y);
            for (size_t i = first + 1; i < end; ++i) shape->lineTo(left[i].x, left[i].y);
            for (size_t i = end; i-- > first;) shape->lineTo(right[i].x, right[i].y);
            shape->close();
        }
        first = end;
    }
    return shape;
}

struct Crop
{
    Rgb ground, furrow;
};

Crop crop(Season season, bool tended)
{
    if (!tended && season != Season::Winter) return {{52, 58, 40}, {64, 72, 46}};  // Fallow and weedy.
    switch (season) {
    case Season::Spring: return {{78, 60, 42}, {56, 42, 30}};   // Ploughed.
    case Season::Summer: return {{62, 96, 50}, {46, 74, 38}};   // Green shoots.
    case Season::Autumn: return {{166, 136, 62}, {124, 100, 44}};  // Ripe grain.
    case Season::Winter: return {{106, 108, 114}, {84, 86, 92}};   // Frosted stubble.
    }
    return {};
}
}  // namespace

Rgb groundColor(Terrain terrain, uint8_t shade, const Climate& climate)
{
    auto base = palette[size_t(terrain)][shade];
    bool barren = terrain == Terrain::Ash || terrain == Terrain::Frost || terrain == Terrain::Ice || terrain == Terrain::Lava;
    bool bare = isWater(terrain) || isStone(terrain) || terrain == Terrain::Sand || barren;
    if (!bare) {
        base = mix(base, {58, 72, 44}, .2f * climate.summer);
        base = mix(base, {92, 70, 40}, .32f * climate.autumn);
    }
    if (isWater(terrain)) return mix(base, {84, 98, 116}, .55f * climate.frost);
    if (terrain == Terrain::Lava) return base;  // Snow never settles on molten rock.
    return mix(base, {148, 156, 168}, climate.snow * (isStone(terrain) ? .55f : .8f));
}

std::vector<Tinted> paintGround(tvg::Scene* iso, const WorldMap& map, const TileRegion* area)
{
    std::vector<Tinted> tints;
    paintSea(iso, map, tints, area);
    paintCliffs(iso, map, area);

    auto land = layer(map, Layer::Land), elevation = layer(map, Layer::Elevation), moisture = layer(map, Layer::Moisture);
    auto beach = layer(map, Layer::Beach), shade = layer(map, Layer::Shade);
    // Every terrain class is a level set of the same fields terrainAt() reads, painted in its priority
    // order. Each is also cut to the land (min with the coast field) instead of clipping a scene,
    // which would recompose the whole ground on every partial redraw.
    auto add = [&](tvg::Shape* shape, Tint color) {
        tints.push_back({shape, std::move(color), false});
        iso->add(shape);
    };
    auto onLand = [&](auto f) { return [&, f](int i, int j) { return std::min(f(i, j), land(i, j)); }; };
    auto tone = [](Terrain terrain) { return Tint([terrain](const Climate& k) { return opaque(groundColor(terrain, 1, k)); }); };
    auto bounded = [&](auto sample) { return region(map, 0, sample, {}, area); };
    add(bounded(land), tone(Terrain::Grass));
    add(bounded(onLand([&](int i, int j) { return .38f - moisture(i, j); })), tone(Terrain::Meadow));
    add(bounded(onLand([&](int i, int j) { return moisture(i, j) - .54f; })), tone(Terrain::Forest));
    auto heat = layer(map, Layer::Heat);
    add(bounded(onLand([&](int i, int j) { return .25f - heat(i, j); })), tone(Terrain::Frost));
    add(bounded(onLand([&](int i, int j) { return std::min(heat(i, j) - .62f, .5f - moisture(i, j)); })), tone(Terrain::Ash));
    add(bounded(onLand([&](int i, int j) { return elevation(i, j) - .7f; })), tone(Terrain::Rock));
    add(bounded(onLand([&](int i, int j) { return std::min(.2f - heat(i, j), elevation(i, j) - .55f); })), tone(Terrain::Ice));
    auto ridge = layer(map, Layer::Ridge);
    add(bounded(onLand([&](int i, int j) { return std::min(ridge(i, j), land(i, j) - .1f); })), tone(Terrain::Mountain));
    // Round the lava the ash is scorched and the flow's edge cooled to black crust; it glows brighter towards
    // its heart. Snow lies thin on the scorched ground and never on the rest.
    auto lava = [&](float inset) { return onLand([&, inset](int i, int j) { return lavaLevel(land(i, j), heat(i, j), ridge(i, j)) - inset; }); };
    add(bounded(lava(-.12f)), [](const Climate& k) { return opaque(mix({46, 40, 39}, {148, 156, 168}, k.snow * .3f)); });
    add(bounded(lava(-.03f)), [](const Climate&) { return opaque(Rgb{30, 24, 24}); });
    add(bounded(lava(0)), tone(Terrain::Lava));
    add(bounded(lava(.05f)), [](const Climate&) { return opaque(Rgb{204, 92, 34}); });
    add(bounded(lava(.13f)), [](const Climate&) { return opaque(Rgb{240, 150, 56}); });
    add(bounded(onLand([&](int i, int j) { return std::min({land(i, j) - .1f, heat(i, j) - .62f, ridge(i, j) - crestRidge}); })), tone(Terrain::Mountain));  // Volcanic crests.
    add(bounded(onLand([&](int i, int j) { return std::min(.05f - land(i, j), beach(i, j) - .45f); })), tone(Terrain::Sand));
    for (float level : {.25f, .5f, .75f}) add(bounded(onLand([&, level](int i, int j) { return shade(i, j) - level; })), [](const Climate&) { return Rgba{255, 255, 240, 6}; });
    // Relief: slopes facing the light from the west lighter and those turned away darker, two steps each.
    // Measured across two tiles, so the land's broad slopes show and not every ripple of it.
    auto facing = [&](int i, int j) { return (elevation(i + 2, j) - elevation(i - 2, j) + .35f * (elevation(i, j + 2) - elevation(i, j - 2))) / 2; };
    for (auto [step, lit] : {std::pair{.012f, true}, std::pair{.03f, true}, std::pair{.012f, false}, std::pair{.03f, false}})
        add(bounded(onLand([&, step, lit](int i, int j) { return (lit ? facing(i, j) : -facing(i, j)) - step; })),
            [lit](const Climate&) { return lit ? Rgba{255, 250, 235, 18} : Rgba{12, 14, 26, 26}; });
    auto lake = [&](int i, int j) { return std::min(land(i, j) - .12f, .3f - elevation(i, j)); };
    Tint water = [](const Climate& k) { return opaque(groundColor(Terrain::Water, 2, k)); };
    Tint bank = [](const Climate& k) { return opaque(mix(groundColor(Terrain::Sand, 1, k), groundColor(Terrain::Water, 2, k), .35f)); };
    add(bounded([&](int i, int j) { return lake(i, j) + .025f; }), bank);
    add(bounded(lake), water);
    // Lighter round the edge, darker towards the deep middle; ice greys it all alike.
    auto deeper = [](Rgb color) { return Tint([color](const Climate& k) { return opaque(mix(color, {84, 98, 116}, .55f * k.frost)); }); };
    constexpr std::pair<float, Rgb> depths[] = {{.03f, {20, 31, 45}}, {.08f, {16, 26, 38}}, {.14f, {13, 22, 33}}};
    for (auto [depth, color] : depths) add(bounded([&, depth](int i, int j) { return lake(i, j) - depth; }), deeper(color));
    add(bounded([&](int i, int j) { return std::min(lake(i, j), .2f - heat(i, j)); }), tone(Terrain::Ice));  // Frozen lakes.
    // The river runs out to sea, so only its ribbons need the coastline as a clip. Its bed, darker down the
    // middle, narrows away before the coast and where the river runs through a lake instead.
    const auto& river = map.river();
    for (auto [extra, color] : {std::pair{.22f, bank}, std::pair{0.f, water}}) {
        auto ribbon = riverRibbon(river, [&river, extra](size_t i) { return river.width[i] / 2 + extra; });
        tints.push_back({ribbon, color, false});
        auto cut = bounded(land);
        cut->fill(255, 255, 255);
        ribbon->clip(cut);
        iso->add(ribbon);
    }
    auto inland = [&map](Point p) {
        float pond = std::min(map.value(Layer::Land, p) - .12f, .3f - map.value(Layer::Elevation, p));
        return std::clamp((map.value(Layer::Land, p) - .02f) / .1f, 0.f, 1.f) * std::clamp(-pond / .03f, 0.f, 1.f);
    };
    for (auto [share, color] : {std::pair{.55f, depths[0].second}, std::pair{.25f, depths[1].second}})
        add(riverRibbon(river, [&, share](size_t i) { return river.width[i] / 2 * share * inland(river.path[i]); }), deeper(color));
    return tints;
}

void tintGround(const std::vector<Tinted>& tints, const Climate& climate)
{
    for (const auto& tint : tints) {
        auto color = tint.color(climate);
        if (tint.stroke) tint.shape->strokeFill(color.r, color.g, color.b, color.a);
        else fill(tint.shape, color);
    }
}


void paintFields(tvg::Scene* iso, const Town& town)
{
    auto season = town.calendar().season;
    float snow = town.climate().snow;
    int tended = town.tendedFieldAcres();
    for (const auto& field : town.fields()) {
        bool worked = tended >= field.acres() / 2;
        tended = std::max(0, tended - field.acres());
        auto colors = crop(season, worked);
        colors = {mix(colors.ground, {148, 156, 168}, snow * .85f), mix(colors.furrow, {128, 136, 148}, snow * .85f)};
        const auto& outline = field.outline;
        auto plot = tvg::Shape::gen();
        appendOutline(plot, outline);
        fill(plot, opaque(colors.ground));
        plot->strokeWidth(.06f);
        plot->strokeJoin(tvg::StrokeJoin::Round);
        plot->strokeFill(46, 34, 26);
        iso->add(plot);
        // Furrows run along the longest edge, clipped to the outline.
        Point along{1, 0};
        float longest = 0;
        for (size_t i = 0; i < outline.size(); ++i) {
            auto edge = outline[(i + 1) % outline.size()] - outline[i];
            if (length(edge) > longest) { longest = length(edge); along = normalized(edge); }
        }
        Point across{-along.y, along.x};
        auto c = centroid(outline);
        float reach = 0;
        for (auto p : outline) reach = std::max(reach, distance(p, c));
        auto furrows = tvg::Shape::gen();
        for (float offset = -reach; offset <= reach; offset += .25f) {
            auto mid = c + across * offset;
            auto a = mid - along * reach, b = mid + along * reach;
            furrows->moveTo(a.x, a.y);
            furrows->lineTo(b.x, b.y);
        }
        furrows->strokeWidth(.06f);
        furrows->strokeFill(colors.furrow.r, colors.furrow.g, colors.furrow.b);
        auto clip = tvg::Shape::gen();
        appendOutline(clip, outline);
        clip->fill(255, 255, 255);
        auto inner = tvg::Scene::gen();
        inner->add(furrows);
        inner->clip(clip);
        iso->add(inner);
    }
    // Construction sites: a dashed string line between corner stakes.
    for (const auto& item : town.buildings()) {
        if (item.built()) continue;
        auto corners = item.footprint().corners();
        auto line = tvg::Shape::gen();
        appendOutline(line, corners);
        line->strokeWidth(.05f);
        float dash[] = {.18f, .12f};
        line->strokeDash(dash, 2);
        line->strokeFill(214, 186, 120, 200);
        iso->add(line);
        auto stakes = tvg::Shape::gen();
        for (auto p : corners) stakes->appendCircle(p.x, p.y, .07f, .07f);
        stakes->fill(120, 90, 60);
        iso->add(stakes);
    }
}

namespace
{
struct SightCell
{
    int x, y;
    bool operator==(const SightCell&) const = default;
};
struct SightCellHash
{
    size_t operator()(SightCell cell) const { return size_t(uint64_t(uint32_t(cell.x)) * 0x9e3779b1u ^ uint32_t(cell.y)); }
};

std::vector<bool> coveredSights(const std::vector<Sight>& seen)
{
    std::vector<bool> covered(seen.size());
    // Game views use small, finite world coordinates. Keep the old predicate for unusual input.
    bool indexed = std::all_of(seen.begin(), seen.end(), [](const Sight& s) {
        return std::isfinite(s.center.x) && std::isfinite(s.center.y) && std::isfinite(s.radius) &&
               std::abs(s.center.x) <= 1e6f && std::abs(s.center.y) <= 1e6f && s.radius >= 0 && s.radius <= 1e6f;
    });
    if (!indexed) {
        for (size_t i = 0; i < seen.size(); ++i)
            for (size_t j = 0; j < seen.size() && !covered[i]; ++j)
                covered[i] = j != i && distance(seen[i].center, seen[j].center) + seen[i].radius <= seen[j].radius &&
                             (seen[j].radius > seen[i].radius || j < i);
        return covered;
    }
    std::vector<size_t> order(seen.size());
    std::iota(order.begin(), order.end(), size_t(0));
    // Equal circles keep the first patch, exactly as the original all-pairs scan did.
    std::stable_sort(order.begin(), order.end(), [&](size_t a, size_t b) { return seen[a].radius > seen[b].radius; });
    if (order.empty()) return covered;
    constexpr float cellSize = 8;
    auto cell = [](Point p) { return SightCell{int(std::floor(p.x / cellSize)), int(std::floor(p.y / cellSize))}; };
    std::unordered_map<SightCell, std::vector<size_t>, SightCellHash> buckets;
    std::vector<size_t> previous;
    previous.reserve(order.size());
    float largest = seen[order.front()].radius;
    for (size_t i : order) {
        const auto& s = seen[i];
        // Containment requires the centres to be within the difference of the radii. Pad the
        // broad-phase bounds so rounding in distance + radius cannot discard a boundary match.
        float padding = 1e-4f + 4 * std::numeric_limits<float>::epsilon() * (std::abs(s.center.x) + std::abs(s.center.y) + largest);
        float reach = largest - s.radius + padding;
        auto low = cell(s.center - Point{reach, reach}), high = cell(s.center + Point{reach, reach});
        auto contains = [&](size_t j) { return distance(s.center, seen[j].center) + s.radius <= seen[j].radius; };
        int64_t width = int64_t(high.x) - low.x + 1, height = int64_t(high.y) - low.y + 1;
        if (width * height > 4096) {
            covered[i] = std::any_of(previous.begin(), previous.end(), contains);
        } else {
            for (int y = low.y; y <= high.y && !covered[i]; ++y)
                for (int x = low.x; x <= high.x && !covered[i]; ++x) {
                    auto found = buckets.find({x, y});
                    if (found != buckets.end()) covered[i] = std::any_of(found->second.begin(), found->second.end(), contains);
                }
        }
        // Include covered patches too: this preserves the original floating-point predicates
        // without relying on transitivity of approximate circle containment.
        buckets[cell(s.center)].push_back(i);
        previous.push_back(i);
    }
    return covered;
}
}  // namespace

std::vector<tvg::Shape*> paintFog(tvg::Scene* iso, const WorldMap& map, std::vector<FogPatch>* patches)
{
    if (patches) patches->clear();
    // Unseen land and sea are black, fading smoothly into what has been explored. The veil starts the
    // size of the map; the renderer stretches it over the view (huge masked shapes break compositing).
    auto veil = tvg::Shape::gen();
    veil->appendRect(-2, -2, map.width() + 4.f, map.height() + 4.f);
    veil->fill(0, 0, 0);
    auto sight = tvg::Scene::gen();
    const auto& seen = map.sights();
    auto covered = coveredSights(seen);
    for (size_t i = 0; i < seen.size(); ++i) {
        const auto& s = seen[i];
        if (covered[i]) continue;
        auto disc = sightDisc(s.radius + 1);  // Its solid core reaches about the revealed edge.
        disc->translate(s.center.x, s.center.y);
        sight->add(disc);
        if (patches) patches->push_back({disc, {s.center, s.radius + 1}});
    }
    veil->mask(sight, tvg::MaskMethod::InvAlpha);
    iso->add(veil);
    return {veil};
}
}  // namespace hearthold

#include "map_document.h"
#include <core/io/io.h>
#include <ui/text/text.h>
#include <algorithm>
#include <cmath>
#include <iomanip>
#include <limits>
#include <locale>
#include <sstream>

namespace hearthold
{
namespace
{
constexpr size_t maxMapBytes = 40 * 1024 * 1024;
bool dry(Terrain terrain) { return !isWater(terrain) && !isStone(terrain) && !impassable(terrain); }
bool dungeonGround(Terrain terrain) { return !isWater(terrain) && !impassable(terrain); }
// Delvers walk up to the tile just south of an entrance's east half.
bool doorstep(const WorldMap& map, TileCoord origin)
{
    return map.inside(origin.x + 1, origin.y + 2) && dungeonGround(map.terrainAt({origin.x + 1.5f, origin.y + 2.5f}));
}
bool clearing(const WorldMap& map, TileCoord at, int radius)
{
    for (int y = at.y - radius; y <= at.y + radius; ++y)
        for (int x = at.x - radius; x <= at.x + radius; ++x)
            if (!map.inside(x, y) || !dry(map.terrainAt({x + .5f, y + .5f})) || map.at(x, y).dungeon >= 0) return false;
    return true;
}
bool nameValid(const std::string& name)
{
    te::Codepoints valid;
    return !name.empty() && name.size() <= 96 && valid.add(name) && std::none_of(name.begin(), name.end(), [](unsigned char c) { return c < 32 || c == 127; });
}
struct BrushSegment
{
    Point from, to, delta;
    float inverseLengthSquared;
    BrushSegment(Point from, Point to) : from(from), to(to), delta(to - from)
    {
        float squared = delta.x * delta.x + delta.y * delta.y; inverseLengthSquared = squared > 0 ? 1 / squared : 0;
    }
    float distanceSquared(Point point) const
    {
        auto offset = point - from;
        float t = std::clamp((offset.x * delta.x + offset.y * delta.y) * inverseLengthSquared, 0.f, 1.f);
        auto d = offset - delta * t; return d.x * d.x + d.y * d.y;
    }
    TileRegion bounds(float radius) const
    {
        return {int(std::floor(std::min(from.x, to.x) - radius)), int(std::floor(std::min(from.y, to.y) - radius)),
                int(std::ceil(std::max(from.x, to.x) + radius)), int(std::ceil(std::max(from.y, to.y) + radius))};
    }
    // Conservative x extent of a capsule in a horizontal slab, including its round end caps.
    std::pair<float, float> columns(float top, float bottom, float radius) const
    {
        float first = 0, last = 1;
        if (std::abs(delta.y) > .00001f) {
            float a = (top - radius - from.y) / delta.y, b = (bottom + radius - from.y) / delta.y;
            first = std::clamp(std::min(a, b), 0.f, 1.f); last = std::clamp(std::max(a, b), 0.f, 1.f);
        }
        float a = from.x + delta.x * first, b = from.x + delta.x * last;
        return {std::min(a, b) - radius, std::max(a, b) + radius};
    }
};
}  // namespace

MapDocument::MapDocument(WorldMap map) : landscape(std::move(map)), dirtyArea{0, 0, landscape.width(), landscape.height()} {}

void MapDocument::remember(Snapshot snapshot)
{
    if (past.size() == 24) past.erase(past.begin());
    past.push_back(std::move(snapshot)); future.clear(); currentId = nextId++;
}

void MapDocument::touch(TileRegion area) { dirtyArea.include(area); strokeChanged = true; ++visualRevision; }
void MapDocument::invalidateAll() { dirtyArea = {-2, -2, landscape.width() + 2, landscape.height() + 2}; ++visualRevision; }
void MapDocument::beginStroke()
{
    if (before) return;
    before.emplace(); before->id = currentId; before->partial = true;
    // Most strokes touch only a few blocks. Terrain samples are saved lazily before their first edit.
    before->map.origin = landscape.origin; before->map.stream = landscape.stream; before->map.sites = landscape.sites;
    strokeChanged = false;
}

void MapDocument::capture(TileRegion area, bool samples)
{
    constexpr int tileBlock = 16, sampleBlock = tileBlock * WorldMap::resolution;
    int left = std::clamp(area.left, 0, landscape.columns), right = std::clamp(area.right, 0, landscape.columns);
    int top = std::clamp(area.top, 0, landscape.rows), bottom = std::clamp(area.bottom, 0, landscape.rows);
    if (!before || left >= right || top >= bottom) return;
    int columns = (landscape.columns + tileBlock - 1) / tileBlock, rows = (landscape.rows + tileBlock - 1) / tileBlock;
    if (before->capturedTiles.empty()) before->capturedTiles.resize(size_t(columns) * rows);
    for (int by = top / tileBlock; by <= (bottom - 1) / tileBlock; ++by)
        for (int bx = left / tileBlock; bx <= (right - 1) / tileBlock; ++bx) {
            auto index = size_t(by) * columns + bx;
            if (before->capturedTiles[index]) continue;
            before->capturedTiles[index] = 1;
            TilePatch patch{bx * tileBlock, by * tileBlock, std::min(tileBlock, landscape.columns - bx * tileBlock), std::min(tileBlock, landscape.rows - by * tileBlock), {}};
            patch.values.resize(size_t(patch.width) * patch.height);
            for (int y = 0; y < patch.height; ++y)
                std::copy_n(landscape.tiles.begin() + size_t(patch.y + y) * landscape.columns + patch.x, patch.width, patch.values.begin() + size_t(y) * patch.width);
            before->tiles.push_back(std::move(patch));
        }
    if (!samples) return;
    int stride = landscape.columns * WorldMap::resolution + 1, height = landscape.rows * WorldMap::resolution + 1;
    columns = (stride + sampleBlock - 1) / sampleBlock; rows = (height + sampleBlock - 1) / sampleBlock;
    if (before->capturedSamples.empty()) before->capturedSamples.resize(size_t(columns) * rows);
    for (int by = top * WorldMap::resolution / sampleBlock; by <= bottom * WorldMap::resolution / sampleBlock; ++by)
        for (int bx = left * WorldMap::resolution / sampleBlock; bx <= right * WorldMap::resolution / sampleBlock; ++bx) {
            auto index = size_t(by) * columns + bx;
            if (before->capturedSamples[index]) continue;
            before->capturedSamples[index] = 1;
            SamplePatch patch{bx * sampleBlock, by * sampleBlock, std::min(sampleBlock, stride - bx * sampleBlock), std::min(sampleBlock, height - by * sampleBlock), {}};
            for (int layer = 0; layer < int(Layer::Count); ++layer) {
                patch.values[layer].resize(size_t(patch.width) * patch.height);
                for (int y = 0; y < patch.height; ++y)
                    std::copy_n(landscape.layers[layer].begin() + size_t(patch.y + y) * stride + patch.x, patch.width, patch.values[layer].begin() + size_t(y) * patch.width);
            }
            before->samples.push_back(std::move(patch));
        }
}

void MapDocument::captureSegment(Point from, Point to, float radius, bool samples)
{
    constexpr int block = 16;
    BrushSegment brush(from, to); auto area = brush.bounds(radius);
    int top = std::max(0, area.top) / block * block, bottom = std::min(landscape.rows, area.bottom);
    for (int y = top; y < bottom; y += block) {
        auto [left, right] = brush.columns(float(y), float(y + block), radius);
        capture({int(std::floor(left)), y, int(std::ceil(right)), std::min(y + block, landscape.rows)}, samples);
    }
}

void MapDocument::restore(Snapshot& snapshot)
{
    if (!snapshot.partial) std::swap(landscape, snapshot.map);
    else {
        for (auto& patch : snapshot.tiles)
            for (int y = 0; y < patch.height; ++y)
                for (int x = 0; x < patch.width; ++x)
                    std::swap(landscape.at(patch.x + x, patch.y + y), patch.values[size_t(y) * patch.width + x]);
        int stride = landscape.columns * WorldMap::resolution + 1;
        for (auto& patch : snapshot.samples)
            for (int layer = 0; layer < int(Layer::Count); ++layer)
                for (int y = 0; y < patch.height; ++y)
                    for (int x = 0; x < patch.width; ++x)
                        std::swap(landscape.layers[layer][size_t(patch.y + y) * stride + patch.x + x], patch.values[layer][size_t(y) * patch.width + x]);
        std::swap(landscape.origin, snapshot.map.origin); std::swap(landscape.stream, snapshot.map.stream); std::swap(landscape.sites, snapshot.map.sites);
    }
    std::swap(currentId, snapshot.id);
}
void MapDocument::endStroke()
{
    if (!before) return;
    if (strokeChanged) remember(std::move(*before));
    before.reset(); strokeChanged = false;
}
void MapDocument::cancelStroke()
{
    if (!before) return;
    restore(*before); before.reset(); strokeChanged = false; invalidateAll();
}

bool MapDocument::paint(Point point, float radius, Terrain terrain)
{
    return paintSegment(point, point, radius, terrain);
}

bool MapDocument::paintSegment(Point from, Point to, float radius, Terrain terrain)
{
    if (!landscape.inside(from) || !landscape.inside(to) || !std::isfinite(radius) || radius < .5f || radius > 16 || int(terrain) >= terrainCount) return false;
    bool ownStroke = !stroking(); beginStroke();
    BrushSegment brush(from, to); float radiusSquared = radius * radius, innerSquared = radiusSquared * .75f * .75f;
    // Targets use the same level sets as terrainAt() and the native terrain painter.
    float target[]{.5f, .48f, .45f, 0, .1f, -.2f, .35f};
    switch (terrain) {
    case Terrain::Meadow: target[2] = .22f; break;
    case Terrain::Forest: target[2] = .75f; break;
    case Terrain::Water: target[1] = .14f; break;
    case Terrain::Rock: target[1] = .88f; break;
    case Terrain::Sand: target[0] = .025f; target[4] = .85f; break;
    case Terrain::Sea: target[0] = -.4f; break;
    case Terrain::Mountain: target[1] = .62f; target[5] = .16f; break;
    case Terrain::Ash: target[2] = .22f; target[6] = .85f; break;
    case Terrain::Frost: target[6] = .12f; break;
    case Terrain::Ice: target[1] = .66f; target[6] = .1f; break;
    case Terrain::Lava: target[5] = .05f; target[6] = .9f; break;
    case Terrain::Grass: break;
    }
    auto dirty = brush.bounds(radius + 2);
    TileRegion riverDirty; std::vector<size_t> carved;
    // Replacing a river point also changes terrain along its adjacent segments.
    if (terrain != Terrain::Water)
        for (size_t i = 0; i < landscape.stream.path.size(); ++i) {
            float reach = radius + landscape.stream.width[i] / 2;
            if (landscape.stream.width[i] > 0 && brush.distanceSquared(landscape.stream.path[i]) <= reach * reach) {
                carved.push_back(i);
                for (size_t n = i > 0 ? i - 1 : 0; n <= std::min(i + 1, landscape.stream.path.size() - 1); ++n) {
                    auto p = landscape.stream.path[n]; float reach = std::max(landscape.stream.width[i], landscape.stream.width[n]) + 2;
                    riverDirty.include({int(std::floor(p.x - reach)), int(std::floor(p.y - reach)), int(std::ceil(p.x + reach)), int(std::ceil(p.y + reach))});
                }
            }
        }
    captureSegment(from, to, radius + 2); capture(riverDirty, false); dirty.include(riverDirty);
    bool changed = !carved.empty();
    for (auto i : carved) landscape.stream.width[i] = 0;
    int stride = landscape.columns * WorldMap::resolution + 1;
    auto samples = brush.bounds(radius);
    int top = std::max(0, samples.top * WorldMap::resolution), bottom = std::min(landscape.rows * WorldMap::resolution, samples.bottom * WorldMap::resolution);
    for (int y = top; y <= bottom; ++y) {
        float sampleY = y / float(WorldMap::resolution); auto [low, high] = brush.columns(sampleY, sampleY, radius);
        int left = std::max(0, int(std::floor(low * WorldMap::resolution))), right = std::min(landscape.columns * WorldMap::resolution, int(std::ceil(high * WorldMap::resolution)));
        for (int x = left; x <= right; ++x) {
            float d = brush.distanceSquared({x / float(WorldMap::resolution), sampleY});
            if (d > radiusSquared) continue;
            float weight = d <= innerSquared ? 1 : std::clamp((1 - std::sqrt(d) / radius) / .25f, 0.f, 1.f);
            weight = weight * weight * (3 - 2 * weight);
            for (int layer = 0; layer < int(Layer::Count); ++layer) {
                if (layer == int(Layer::Shade)) continue;
                auto& value = landscape.layers[layer][size_t(y) * stride + x];
                float next = value + (target[layer] - value) * weight;
                if (std::abs(next - value) > .00001f) { value = next; changed = true; }
            }
        }
    }
    int x0 = std::max(0, dirty.left), x1 = std::min(landscape.columns, dirty.right);
    int y0 = std::max(0, dirty.top), y1 = std::min(landscape.rows, dirty.bottom);
    float cacheSquared = (radius + 1) * (radius + 1);
    for (int y = y0; y < y1; ++y)
        for (int x = x0; x < x1; ++x) {
            float d = brush.distanceSquared({x + .5f, y + .5f});
            bool byRiver = x >= riverDirty.left && x < riverDirty.right && y >= riverDirty.top && y < riverDirty.bottom;
            if (d > cacheSquared && !byRiver) continue;
            auto& tile = landscape.at(x, y);
            auto next = landscape.terrainAt({x + .5f, y + .5f});
            changed |= tile.terrain != next; tile.terrain = next;
            if (d > radiusSquared) continue;
            if (tile.quarried) { tile.quarried = false; changed = true; }
            uint8_t trees = tile.terrain == terrain ? wildTrees(landscape, x, y) : 0;
            if (tile.trees != trees || tile.wild != trees) { tile.trees = tile.wild = trees; changed = true; }
        }
    if (changed) touch(dirty);
    if (ownStroke) endStroke();
    return changed;
}

bool MapDocument::clearTrees(Point point, float radius)
{
    return clearTreesSegment(point, point, radius);
}

bool MapDocument::clearTreesSegment(Point from, Point to, float radius)
{
    if (!landscape.inside(from) || !landscape.inside(to) || !std::isfinite(radius) || radius < .5f || radius > 16) return false;
    bool ownStroke = !stroking(); beginStroke(); bool changed = false;
    BrushSegment brush(from, to); auto dirty = brush.bounds(radius + 1); float squared = radius * radius;
    captureSegment(from, to, radius + 1, false);
    for (int y = std::max(0, dirty.top); y < std::min(landscape.rows, dirty.bottom); ++y)
        for (int x = std::max(0, dirty.left); x < std::min(landscape.columns, dirty.right); ++x) {
            auto& tile = landscape.at(x, y);
            if (brush.distanceSquared({x + .5f, y + .5f}) <= squared && (tile.trees || tile.wild)) { tile.trees = tile.wild = 0; changed = true; }
        }
    if (changed) touch(dirty);
    if (ownStroke) endStroke();
    return changed;
}

void MapDocument::indexDungeons()
{
    capture({0, 0, landscape.columns, landscape.rows}, false);
    for (auto& tile : landscape.tiles) tile.dungeon = -1;
    for (size_t i = 0; i < landscape.sites.size(); ++i) {
        auto at = landscape.sites[i].origin;
        for (int y = at.y; y < at.y + 2; ++y) for (int x = at.x; x < at.x + 2; ++x) landscape.at(x, y).dungeon = int8_t(i);
    }
}
bool MapDocument::setStart(Point point)
{
    if (!landscape.inside(point)) return false;
    TileCoord next{int(point.x), int(point.y)};
    if (!clearing(landscape, next, 2)) return false;
    beginStroke(); bool moved = !(next == landscape.origin); landscape.origin = next;
    bool cleared = clearTrees(landscape.camp(), 3.6f);
    if (moved) touch({next.x - 4, next.y - 4, next.x + 5, next.y + 5});
    endStroke(); return moved || cleared;
}
bool MapDocument::addDungeon(Point point, DungeonKind kind)
{
    if (!landscape.inside(point) || int(kind) > int(DungeonKind::Ruin) || landscape.sites.size() >= 64) return false;
    TileCoord at{int(point.x), int(point.y)};
    if (!landscape.inside(at.x + 1, at.y + 1) || distance(landscape.camp(), {at.x + 1.f, at.y + 1.f}) < 4) return false;
    for (int y = at.y; y < at.y + 2; ++y) for (int x = at.x; x < at.x + 2; ++x)
        if (!dungeonGround(landscape.terrainAt({x + .5f, y + .5f})) || landscape.at(x, y).dungeon >= 0) return false;
    if (!doorstep(landscape, at)) return false;
    const char* names[]{"Cave", "Crypt", "Portal", "Ruin"};
    beginStroke(); landscape.sites.push_back({std::string(names[int(kind)]) + " " + std::to_string(landscape.sites.size() + 1), kind, at, false});
    indexDungeons(); clearTrees({at.x + 1.f, at.y + 1.f}, 2); touch({at.x - 2, at.y - 2, at.x + 4, at.y + 4}); endStroke(); return true;
}
bool MapDocument::removeDungeon(Point point)
{
    auto tile = landscape.cell(point);
    if (!tile || tile->dungeon < 0) return false;
    int id = tile->dungeon; auto at = landscape.sites[size_t(id)].origin;
    beginStroke(); landscape.sites.erase(landscape.sites.begin() + id); indexDungeons(); touch({at.x - 2, at.y - 2, at.x + 4, at.y + 4}); endStroke(); return true;
}
bool MapDocument::regenerate(uint32_t seed, int size)
{
    if (!validSize(size)) return false;
    endStroke(); MapDocument next(WorldMap::generate(seed, size, size));
    auto hasHome = [&](Point at) {
        return std::any_of(next.map().dungeons().begin(), next.map().dungeons().end(), [&](const Dungeon& site) {
            return distance(at, {site.origin.x + 1.f, site.origin.y + 1.f}) <= 12;
        });
    };
    // Small islands can lack the generator's larger inland clearing.
    if (!clearing(next.map(), next.map().start(), 2) || !hasHome(next.map().camp())) {
        Point best = next.map().camp(); float nearest = std::numeric_limits<float>::max(); bool found = false;
        for (int y = 3; y < size - 3; ++y) for (int x = 3; x < size - 3; ++x) {
            Point at{x + .5f, y + .5f}; float gap = distance(at, next.map().camp());
            if (gap >= nearest || !hasHome(at) || !clearing(next.map(), {x, y}, 2)) continue;
            nearest = gap; best = at; found = true;
        }
        if (!found) next.paint(best, 5, Terrain::Grass);
        next.setStart(best);
        if (!hasHome(next.map().camp())) {
            Point home{best.x + (best.x < size / 2.f ? 8.f : -8.f), best.y};
            next.paint(home, 3, Terrain::Grass); next.addDungeon(home, DungeonKind::Ruin);
        }
    }
    remember({std::move(landscape), currentId}); landscape = std::move(next.landscape); invalidateAll(); return true;
}
void MapDocument::undo()
{
    endStroke(); if (past.empty()) return;
    restore(past.back()); future.push_back(std::move(past.back())); past.pop_back(); invalidateAll();
}
void MapDocument::redo()
{
    endStroke(); if (future.empty()) return;
    restore(future.back()); past.push_back(std::move(future.back())); future.pop_back(); invalidateAll();
}
std::string MapDocument::validation() const
{
    if (!clearing(landscape, landscape.origin, 2)) return "Start needs a dry, level 5 x 5 clearing.";
    for (int y = landscape.origin.y - 2; y <= landscape.origin.y + 2; ++y)
        for (int x = landscape.origin.x - 2; x <= landscape.origin.x + 2; ++x)
            if (landscape.at(x, y).trees) return "Clear the trees around the start before playing.";
    bool nearby = false;
    for (const auto& site : landscape.sites) {
        auto at = site.origin;
        for (int y = at.y; y < at.y + 2; ++y) for (int x = at.x; x < at.x + 2; ++x)
            if (!dungeonGround(landscape.terrainAt({x + .5f, y + .5f}))) return "Dungeon entrances need dry ground away from mountains, ice and lava.";
        if (!doorstep(landscape, at)) return "Dungeon doorsteps (south of the entrance) need ground delvers can walk.";
        nearby |= distance(landscape.camp(), {at.x + 1.f, at.y + 1.f}) <= 12;
    }
    return nearby ? "" : "Place a dungeon within 12 tiles of the start.";
}
WorldMap MapDocument::gameMap() const
{
    auto map = landscape; map.seen.clear();
    for (auto& tile : map.tiles) tile.revealed = false;
    for (auto& site : map.sites) site.discovered = false;
    if (!map.sites.empty()) {
        auto nearest = std::min_element(map.sites.begin(), map.sites.end(), [&](const auto& a, const auto& b) {
            return distance(map.camp(), {a.origin.x + 1.f, a.origin.y + 1.f}) < distance(map.camp(), {b.origin.x + 1.f, b.origin.y + 1.f});
        });
        std::iter_swap(map.sites.begin(), nearest); map.sites.front().discovered = true;
        for (auto& tile : map.tiles) tile.dungeon = -1;
        for (size_t i = 0; i < map.sites.size(); ++i) for (int y = 0; y < 2; ++y) for (int x = 0; x < 2; ++x)
            map.at(map.sites[i].origin.x + x, map.sites[i].origin.y + y).dungeon = int8_t(i);
    }
    map.revealStart(); map.discover(); return map;
}
WorldMap MapDocument::previewMap() const
{
    auto map = landscape;
    map.seen = {{{map.width() / 2.f, map.height() / 2.f}, float(map.width() + map.height())}};
    for (auto& tile : map.tiles) tile.revealed = true;
    for (auto& site : map.sites) site.discovered = true;
    return map;
}

void MapDocument::updatePreview(WorldMap& map, TileRegion area) const
{
    if (map.width() != landscape.width() || map.height() != landscape.height() || map.seed() != landscape.seed()) {
        map = previewMap(); return;
    }
    int left = std::clamp(area.left, 0, landscape.width()), right = std::clamp(area.right, 0, landscape.width());
    int top = std::clamp(area.top, 0, landscape.height()), bottom = std::clamp(area.bottom, 0, landscape.height());
    if (left < right && top < bottom) {
        for (int y = top; y < bottom; ++y) {
            auto offset = size_t(y) * landscape.columns + left;
            std::copy_n(landscape.tiles.begin() + offset, right - left, map.tiles.begin() + offset);
            for (int x = left; x < right; ++x) map.at(x, y).revealed = true;
        }
        // Tile edges share one sample; include the final row and column as well.
        int stride = landscape.columns * WorldMap::resolution + 1;
        int sampleLeft = left * WorldMap::resolution, count = (right - left) * WorldMap::resolution + 1;
        for (int layer = 0; layer < int(Layer::Count); ++layer)
            for (int y = top * WorldMap::resolution; y <= bottom * WorldMap::resolution; ++y) {
                auto offset = size_t(y) * stride + sampleLeft;
                std::copy_n(landscape.layers[layer].begin() + offset, count, map.layers[layer].begin() + offset);
            }
    }
    map.origin = landscape.origin;
    map.stream = landscape.stream;
    map.ymir = landscape.ymir;
    map.fire = landscape.fire;
    // Removing one dungeon reindexes the others, including entrances outside the dirty area.
    for (const auto& site : map.sites)
        for (int y = site.origin.y; y < site.origin.y + 2; ++y)
            for (int x = site.origin.x; x < site.origin.x + 2; ++x) map.at(x, y).dungeon = -1;
    map.sites = landscape.sites;
    for (size_t i = 0; i < map.sites.size(); ++i) {
        auto& site = map.sites[i]; site.discovered = true;
        for (int y = site.origin.y; y < site.origin.y + 2; ++y)
            for (int x = site.origin.x; x < site.origin.x + 2; ++x) map.at(x, y).dungeon = int8_t(i);
    }
}

bool MapDocument::save(const std::filesystem::path& path, std::string& error)
{
    endStroke(); error.clear();
    if (path.empty()) { error = "Enter a map file path."; return false; }
    std::ostringstream out; out.imbue(std::locale::classic()); out << std::setprecision(std::numeric_limits<float>::max_digits10);
    auto giant = landscape.ymir ? landscape.ymir->origin : TileCoord{-1, -1};
    out << "hearthold-map 4\n" << landscape.mapSeed << ' ' << landscape.columns << ' ' << landscape.rows << ' ' << landscape.origin.x << ' ' << landscape.origin.y << ' ' << int(landscape.laidOut) << ' ' << giant.x << ' ' << giant.y << '\n';
    for (const auto& layer : landscape.layers) { for (auto value : layer) out << value << ' '; out << '\n'; }
    for (const auto& tile : landscape.tiles) out << int(tile.trees) << ' ' << int(tile.wild) << ' ' << int(tile.quarried) << ' ';
    out << '\n' << landscape.stream.path.size() << '\n';
    for (size_t i = 0; i < landscape.stream.path.size(); ++i) out << landscape.stream.path[i].x << ' ' << landscape.stream.path[i].y << ' ' << landscape.stream.width[i] << '\n';
    out << landscape.sites.size() << '\n';
    for (const auto& site : landscape.sites) out << std::quoted(site.name) << ' ' << int(site.kind) << ' ' << site.origin.x << ' ' << site.origin.y << '\n';
    std::error_code ec; if (path.has_parent_path()) std::filesystem::create_directories(path.parent_path(), ec);
    if (ec) { error = ec.message(); return false; }
    auto baseline = te::io::load(path, {true, maxMapBytes});
    if (!baseline) { error = baseline.error.message; return false; }
    auto result = te::io::save(path, out.str(), {{}, baseline.value.stamp, maxMapBytes});
    if (!result) { error = result.error.message; return false; }
    savedId = currentId; return true;
}

bool MapDocument::read(const std::filesystem::path& path, WorldMap& output, std::string& error)
{
    auto data = te::io::load(path, {false, maxMapBytes});
    if (!data) { error = data.error.message; return false; }
    std::istringstream in(data.value.text); in.imbue(std::locale::classic());
    std::string magic; int version = 0; WorldMap map;
    auto bad = [&] { error = "Invalid or incomplete Hearthold map file."; return false; };
    if (!(in >> magic >> version) || magic != "hearthold-map" || version < 1 || version > 4) return bad();
    if (!(in >> map.mapSeed >> map.columns >> map.rows >> map.origin.x >> map.origin.y) || !validSize(map.columns) || !validSize(map.rows) || !map.inside(map.origin.x, map.origin.y)) return bad();
    // Whether the land was laid out for Midgard's regions (an old map re-saved was not), then where Ymir sits.
    int regions = 0;
    if (version >= 2 && (!(in >> regions) || regions < 0 || regions > 1)) return bad();
    // Version 2 was laid out for nine realms that are gone: its ground stays, its regions do not.
    map.laidOut = regions == 1 && version >= 3;
    if (map.laidOut) map.fire = Volcano::around(map.fireMountain());
    if (version >= 3) {
        TileCoord giant;
        if (!(in >> giant.x >> giant.y)) return bad();
        if (giant.x != -1 || giant.y != -1) {
            if (!map.inside(giant.x, giant.y) || !map.inside(giant.x + Giant::size - 1, giant.y + Giant::size - 1)) return bad();
            map.ymir = Giant{giant};
        }
    }
    size_t count = size_t(map.columns * 2 + 1) * (map.rows * 2 + 1);
    for (auto& layer : map.layers) { layer.resize(count); for (auto& value : layer) if (!(in >> value) || !std::isfinite(value) || std::abs(value) > 8) return bad(); }
    if (version == 1) {
        // Saved before the regions, when heat was plain noise and only its hot, dry spots were desert: keep
        // those as ash and everything else temperate, with no frost, ice or lava, and no regions.
        auto& heat = map.layers[size_t(Layer::Heat)];
        const auto& moisture = map.layers[size_t(Layer::Moisture)];
        for (size_t i = 0; i < count; ++i) heat[i] = moisture[i] < .45f ? std::clamp(heat[i] + .02f, .3f, lavaFloor - .01f) : std::clamp(heat[i], .3f, .62f);
        map.laidOut = false;
    }
    map.tiles.resize(size_t(map.columns) * map.rows);
    for (auto& tile : map.tiles) {
        int trees, wild, quarried = 0;
        if (!(in >> trees >> wild) || trees < 0 || trees > 3 || wild < 0 || wild > 3) return bad();
        if (version >= 4 && (!(in >> quarried) || quarried < 0 || quarried > 1)) return bad();
        tile.trees = uint8_t(trees); tile.wild = uint8_t(wild); tile.quarried = quarried != 0;
    }
    size_t rivers = 0; if (!(in >> rivers) || rivers > 4096) return bad();
    for (size_t i = 0; i < rivers; ++i) { Point p; float width; if (!(in >> p.x >> p.y >> width) || !std::isfinite(p.x) || !std::isfinite(p.y) || !std::isfinite(width) || p.x < 0 || p.y < 0 || p.x > map.width() || p.y > map.height() || width < 0 || width > 16) return bad(); map.stream.path.push_back(p); map.stream.width.push_back(width); }
    size_t sites = 0; if (!(in >> sites) || sites > 64) return bad();
    for (size_t i = 0; i < sites; ++i) {
        Dungeon site; int kind;
        if (!(in >> std::quoted(site.name) >> kind >> site.origin.x >> site.origin.y) || !nameValid(site.name) || kind < 0 || kind > 3 || !map.inside(site.origin.x, site.origin.y) || !map.inside(site.origin.x + 1, site.origin.y + 1)) return bad();
        site.kind = DungeonKind(kind); map.sites.push_back(std::move(site));
    }
    in >> std::ws; if (!in.eof()) return bad();
    for (int y = 0; y < map.height(); ++y) for (int x = 0; x < map.width(); ++x) {
        auto& tile = map.at(x, y); tile.terrain = map.terrainAt({x + .5f, y + .5f}); tile.shade = uint8_t(std::clamp(map.value(Layer::Shade, {x + .5f, y + .5f}) * 4, 0.f, 3.f));
    }
    for (size_t i = 0; i < map.sites.size(); ++i) for (int y = 0; y < 2; ++y) for (int x = 0; x < 2; ++x) {
        auto& tile = map.at(map.sites[i].origin.x + x, map.sites[i].origin.y + y); if (tile.dungeon >= 0) return bad(); tile.dungeon = int8_t(i);
    }
    output = std::move(map); error.clear(); return true;
}
bool MapDocument::load(const std::filesystem::path& path, std::string& error)
{
    WorldMap next; if (!read(path, next, error)) return false;
    endStroke(); remember({std::move(landscape), currentId}); landscape = std::move(next); savedId = currentId; invalidateAll(); return true;
}
}  // namespace hearthold

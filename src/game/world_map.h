#pragma once

#include "iso_projection.h"
#include <GameEngine/GameFramework/coordinate_hash.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace hearthold
{
// Ash keeps the old desert's value, so saved maps' hot, dry country reads as ash.
enum class Terrain : uint8_t { Grass, Meadow, Forest, Water, Rock, Sand, Sea, Mountain, Ash, Frost, Ice, Lava };
inline constexpr int terrainCount = int(Terrain::Lava) + 1;

inline bool isWater(Terrain terrain) { return terrain == Terrain::Water || terrain == Terrain::Sea; }
// Bare stone nobody builds on: rocky ground (slow to cross) and mountain ranges (impassable).
inline bool isStone(Terrain terrain) { return terrain == Terrain::Rock || terrain == Terrain::Mountain; }
// Ground no one crosses or builds on: mountain ranges, glaciers and lava.
inline bool impassable(Terrain terrain) { return terrain == Terrain::Mountain || terrain == Terrain::Ice || terrain == Terrain::Lava; }

// A burning range's crest, standing above the lava that pours down its flanks.
inline constexpr float crestRidge = .085f;
inline bool volcanicCrest(float land, float heat, float ridge) { return land > .1f && heat > .62f && ridge > crestRidge; }
// Below this heat nothing is molten, however high the ridge.
inline constexpr float lavaFloor = .67f;
// Molten where positive, from the land, heat and ridge fields: it narrows to the crests as the ground cools and
// tapers out instead of stopping on a line. It keeps off the shore but where it runs hottest, which pours into the sea.
inline float lavaLevel(float land, float heat, float ridge)
{
    return std::min({land - .1f + .1f * std::clamp(heat - 1, 0.f, 1.f), ridge + .08f - std::max(0.f, .75f - heat) * 3, (heat - lavaFloor) * 4});
}

// Coarse per-cell bookkeeping: trees, fog and dungeon entrances. Terrain itself is continuous.
struct Tile
{
    Terrain terrain = Terrain::Grass;  // terrainAt() of the cell centre.
    uint8_t shade = 0;  // 0..3 colour variation picked from noise.
    uint8_t trees = 0;
    uint8_t wild = 0;  // Trees the wilds grow back to.
    bool revealed = false;
    int8_t dungeon = -1;  // Index into WorldMap::dungeons().
    bool quarried = false;
};

struct TileCoord
{
    int x = 0, y = 0;
    bool operator==(const TileCoord& other) const { return x == other.x && y == other.y; }
};

struct TileRegion
{
    int left = 0, top = 0, right = 0, bottom = 0;
    bool empty() const { return left >= right || top >= bottom; }
    bool intersects(TileRegion other) const { return left < other.right && right > other.left && top < other.bottom && bottom > other.top; }
    void include(TileRegion other)
    {
        if (other.empty()) return;
        if (empty()) { *this = other; return; }
        left = std::min(left, other.left); top = std::min(top, other.top);
        right = std::max(right, other.right); bottom = std::max(bottom, other.bottom);
    }
};

enum class DungeonKind : uint8_t { Cave, Crypt, Portal, Ruin };

// A 2x2 dungeon entrance hidden in the wilds. Only its terrain exists for now.
struct Dungeon
{
    std::string name;
    DungeonKind kind;
    TileCoord origin;
    bool discovered = false;
};

// Smooth noise layers sampled every half unit; terrain classes are their level sets.
enum class Layer : uint8_t { Land, Elevation, Moisture, Shade, Beach, Ridge, Heat, Count };

struct River
{
    std::vector<Point> path;
    std::vector<float> width;
};

struct Sight
{
    Point center;
    float radius;
};

// Midgard, the continent, runs in three regions: ice in the north, fire in the south, the mild heart between.
enum class Region : uint8_t { North, Middle, South, Count };

// The other worlds of the tree, each reached from Midgard only through a dungeon.
enum class World : uint8_t { Asgard, Vanaheim, Alfheim, Jotunheim, Svartalfheim, Niflheim, Muspelheim, Helheim, Count };
const char* worldName(World);

// Ymir, the first giant, sits turned to stone at the heart of the world: a square no one crosses or builds on.
struct Giant
{
    static constexpr int size = 6;
    TileCoord origin;  // The footprint's north corner.
    bool covers(Point p) const { return p.x >= origin.x && p.y >= origin.y && p.x < origin.x + size && p.y < origin.y + size; }
    Point center() const { return {origin.x + size / 2.f, origin.y + size / 2.f}; }
    // Ground the founders know from the start: his own circle, and one behind him where his head stands against
    // the land on screen. Sight thins towards a circle's rim, so the second reaches past his crown.
    std::array<Sight, 2> sights() const
    {
        auto c = center();
        return {{{c, 13}, {{c.x - 9.9f, c.y - 9.9f}, 10}}};
    }
    // His figure as it stands against the land on screen, from his dais back to his crown: where the fog is drawn
    // clear so he always shows, though it is no one's sight.
    std::array<Sight, 8> figure() const
    {
        auto c = center();
        std::array<Sight, 8> out{};
        for (int i = 0; i < 8; ++i) out[size_t(i)] = {{c.x + 1 - 2.f * i, c.y + 1 - 2.f * i}, 4};
        return out;
    }
};

// The volcano of the south, greater than Ymir: its cone a square no one crosses or builds on.
struct Volcano
{
    static constexpr int size = 12;
    TileCoord origin;  // The footprint's north corner.
    static Volcano around(Point center) { return {{int(std::lround(center.x)) - size / 2, int(std::lround(center.y)) - size / 2}}; }
    bool covers(Point p) const { return p.x >= origin.x && p.y >= origin.y && p.x < origin.x + size && p.y < origin.y + size; }
    Point center() const { return {origin.x + size / 2.f, origin.y + size / 2.f}; }
    // Ground known once it is found, so no fog cuts it off: round its cone, and behind it, where its crater
    // and smoke stand against the land on screen.
    std::array<Sight, 2> sights() const
    {
        auto c = center();
        return {{{c, 14}, {{c.x - 13, c.y - 13}, 13}}};
    }
};
// How far the foot of the volcano's cone lies from its centre, in tiles: the cone stands far wider than the square
// it is built on.
inline constexpr float volcanoFoot = 12.4f;
// The compass bearing, in radians from +x towards +y, of the `k`th of the three flows of lava that run from the
// foot of the volcano's cone towards the near shore, fed by the streams down its face.
float lavaBearing(uint32_t seed, int k);

// Deterministic per-seed world: Midgard, a continent drawn on the ThorVG bolt and ringed by sea, its icy top
// stroke, mild middle and burning blade; Ymir stands in the crescent bay between the first two, and a volcano
// burns in the blade. The spring Hvergelmir feeds two rivers to the sea.
class WorldMap
{
public:
    static WorldMap generate(uint32_t seed, int width = 176, int height = 176);
    static constexpr int resolution = 2;  // Layer samples per unit.

    int width() const { return columns; }
    int height() const { return rows; }
    uint32_t seed() const { return mapSeed; }
    bool inside(int x, int y) const { return x >= 0 && y >= 0 && x < columns && y < rows; }
    bool inside(Point p) const { return p.x >= 0 && p.y >= 0 && p.x < columns && p.y < rows; }
    Tile& at(int x, int y) { return tiles[size_t(y) * columns + x]; }
    const Tile& at(int x, int y) const { return tiles[size_t(y) * columns + x]; }
    const Tile* cell(Point) const;
    // Where the founders wake, at Ymir's feet.
    TileCoord start() const { return origin; }
    Point camp() const { return {origin.x + .5f, origin.y + .5f}; }
    // True when anything new became visible.
    bool reveal(float cx, float cy, float radius);
    // What the founders know at first: the ground round the start, and Ymir and his surroundings.
    void revealStart();
    bool revealed(Point) const;
    // Seen with at least `margin` of sight to spare.
    bool revealedWithin(Point, float margin) const;
    const std::vector<Sight>& sights() const { return seen; }
    const std::vector<Dungeon>& dungeons() const { return sites; }
    // Marks dungeons with a revealed tile as discovered and returns the newly found ones.
    std::vector<int> discover();

    // Layer sample (i, j) at point (i, j) / resolution; off the grid is open sea.
    // Contour builders sample every cell corner; keep this leaf inline and nonthrowing.
    float sample(Layer layer, int i, int j) const noexcept
    {
        int stride = columns * resolution + 1;
        if (i < 0 || j < 0 || i >= stride || j > rows * resolution) return layer == Layer::Land ? -1 : 0;
        return layers[size_t(layer)][size_t(j) * stride + i];
    }
    float value(Layer, Point) const noexcept;
    Terrain terrainAt(Point) const;
    const River& river() const { return stream; }
    Region regionAt(Point) const;
    // A point well inside a region.
    Point regionCenter(Region) const;
    // False for maps saved before the three regions, whose land was not laid out for them.
    bool hasRegions() const { return laidOut; }
    const std::optional<Giant>& giant() const { return ymir; }
    // The spring in the north that never freezes, and the fire mountain in the south where the volcano stands.
    Point hvergelmir() const;
    Point fireMountain() const;
    const std::optional<Volcano>& volcano() const { return fire; }
    // Where Midgard's name is lettered: in the mild heart west of Ymir, or the nearest land within ten tiles.
    std::optional<Point> nameLabel() const;
    // The world a dungeon leads to, by its kind and the region it opens in.
    World destination(const Dungeon&) const;
    // Land mask shorthand used by the coast painter.
    float coast(int i, int j) const noexcept { return sample(Layer::Land, i, j); }

private:
    friend class SaveArchive;
    friend class MapDocument;
    int columns = 0, rows = 0;
    uint32_t mapSeed = 0;
    TileCoord origin;
    std::vector<Tile> tiles;
    std::vector<float> layers[size_t(Layer::Count)];
    River stream;
    std::vector<Sight> seen;
    std::vector<Dungeon> sites;
    std::optional<Giant> ymir;
    std::optional<Volcano> fire;
    bool laidOut = true;
};

// The trees the wilds grow on a cell: woods where the ground is moist, snow-laden spruce on moist frost and a
// dead snag here and there on the ash.
uint8_t wildTrees(const WorldMap&, int x, int y);
Point treePosition(const WorldMap&, int x, int y, int index);

// Stable hash in [0, 1) for decorations that must not change between rebuilds.
using gameframework::hash01;
// Smooth fractal noise in [0, 1].
float fractalNoise(uint32_t seed, float x, float y);
}  // namespace hearthold

#pragma once

#include "world_map.h"
#include <filesystem>
#include <optional>
#include <utility>

namespace hearthold
{
class MapDocument
{
public:
    explicit MapDocument(WorldMap);
    const WorldMap& map() const { return landscape; }
    WorldMap gameMap() const;
    WorldMap previewMap() const;
    // Refresh a retained, fully revealed editor map without copying remote terrain samples.
    void updatePreview(WorldMap&, TileRegion) const;
    uint64_t revision() const { return visualRevision; }
    bool changed() const { return currentId != savedId || strokeChanged; }
    bool canUndo() const { return !past.empty(); }
    bool canRedo() const { return !future.empty(); }
    bool stroking() const { return before.has_value(); }
    TileRegion takeDirtyArea() { auto area = dirtyArea; dirtyArea = {}; return area; }
    void beginStroke();
    bool paint(Point, float radius, Terrain);
    // A continuous capsule with the same soft edge as a click; samples are visited once.
    bool paintSegment(Point from, Point to, float radius, Terrain);
    bool clearTrees(Point, float radius);
    bool clearTreesSegment(Point from, Point to, float radius);
    void endStroke();
    void cancelStroke();
    bool setStart(Point);
    bool addDungeon(Point, DungeonKind);
    bool removeDungeon(Point);
    bool regenerate(uint32_t seed, int size);
    void undo();
    void redo();
    std::string validation() const;
    bool save(const std::filesystem::path&, std::string& error);
    bool load(const std::filesystem::path&, std::string& error);
    static bool read(const std::filesystem::path&, WorldMap&, std::string& error);
    static bool validSize(int value) { return value >= 32 && value <= 256; }

private:
    struct TilePatch { int x, y, width, height; std::vector<Tile> values; };
    struct SamplePatch { int x, y, width, height; std::vector<float> values[size_t(Layer::Count)]; };
    struct Snapshot
    {
        Snapshot() = default;
        Snapshot(WorldMap value, uint64_t id) : map(std::move(value)), id(id) {}
        WorldMap map;
        uint64_t id = 0;
        bool partial = false;
        std::vector<TilePatch> tiles;
        std::vector<SamplePatch> samples;
        std::vector<uint8_t> capturedTiles, capturedSamples;
    };
    void remember(Snapshot);
    void capture(TileRegion, bool samples = true);
    void captureSegment(Point from, Point to, float radius, bool samples = true);
    void restore(Snapshot&);
    void touch(TileRegion);
    void invalidateAll();
    void indexDungeons();
    WorldMap landscape;
    std::vector<Snapshot> past, future;
    std::optional<Snapshot> before;
    uint64_t nextId = 1, currentId = 0, savedId = 0, visualRevision = 1;
    bool strokeChanged = false;
    TileRegion dirtyArea;
};
}  // namespace hearthold

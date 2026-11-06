#pragma once

#include <game/map_document.h>
#include <game/world_renderer.h>
#include <core/io/path.h>
#include <ui/ui.h>
#include <algorithm>

namespace hearthold
{
class MapEditor
{
public:
    explicit MapEditor(WorldMap);
    void render(ui::Context&, ui::Rect viewport, std::function<void(bool)> close);
    void pointerDown(ui::Context&, Point, bool secondary);
    void pointerMove(ui::Context&, Point);
    void pointerUp(ui::Context&, Point, bool secondary);
    void wheel(ui::Context&, Point, float amount);
    void undo();
    void redo();
    bool save();
    bool load();
    void fit();
    void home();
    // Tools: a brush per terrain, clearing trees, then the sites (the start, a dungeon per kind, removal).
    static constexpr int clearTool = terrainCount, startTool = clearTool + 1, firstDungeonTool = startTool + 1, removeTool = firstDungeonTool + 4;
    void choose(int value) { tool = std::clamp(value, 0, removeTool); category = tool >= startTool ? 1 : 0; }
    void resizeBrush(int delta) { radius = std::clamp(radius + delta, 1.f, 12.f); }
    void setPath(const std::filesystem::path& value) { auto filename = te::io::pathToUtf8(value); path = {filename, filename.size()}; }
    MapDocument& document() { return doc; }
    const MapDocument& document() const { return doc; }
    Camera& view() { return camera; }
    ui::Rect canvasBounds() const { return canvas; }
    bool textFocused(const ui::Context& c) const { return c.focused() == "map-path" || c.focused() == "map-seed"; }
    bool dragging() const { return lastPaint.has_value() || panFrom.has_value(); }

private:
    Point worldAt(Point) const;
    Point screenAt(Point) const;
    void stamp(Point);
    void finishStroke();
    void regenerate();
    void syncSettings();
    void minimap(ui::Context&, ui::Rect);
    MapDocument doc;
    std::unique_ptr<Town> preview;
    Traffic traffic;
    WorldRenderer renderer;
    Camera camera;
    ui::Rect canvas;
    ui::TextInput path, seed;
    std::optional<Point> lastPaint, panFrom;
    Point mouse{-1, -1};
    float radius = 3;
    int tool = 0, category = 0, sizeIndex = 3;
    uint64_t shownRevision = 0;
    std::string feedback;
    bool failed = false;
    bool fitPending = false;
};
}  // namespace hearthold

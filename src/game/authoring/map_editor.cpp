#include "map_editor.h"
#include <game/terrain_painter.h>
#include <core/io/path.h>
#include <algorithm>
#include <charconv>
#include <cmath>

namespace hearthold
{
namespace
{
constexpr int sizes[]{64, 96, 128, 176, 256};
constexpr const char* terrains[]{"Grass", "Meadow", "Forest", "Water", "Rock", "Sand", "Sea", "Mountain", "Ash", "Frost", "Ice", "Lava", "Clear trees"};
constexpr const char* sites[]{"Start position", "Cave", "Crypt", "Portal", "Ruin", "Remove dungeon"};
ui::State editorButton(ui::Context& c, std::string_view id, ui::Rect r, std::string_view text, std::function<void()> action, ui::ButtonStyle style = ui::ButtonStyle::Default, bool enabled = true)
{
    ui::Appearance a; a.focusRing = true;
    return ui::button(c, id, r, text, std::move(action), style, enabled, ui::Icon::None, false, a);
}
}  // namespace

MapEditor::MapEditor(WorldMap map) : doc(std::move(map)), traffic(doc.map().seed())
{
    syncSettings();
    std::string filename = "maps/untitled.hearthmap"; path = {filename, filename.size()};
    renderer.setEditorView(true); home();
}
void MapEditor::syncSettings()
{
    auto text = std::to_string(doc.map().seed()); seed = {text, text.size()};
    for (int i = 0; i < 5; ++i) if (sizes[i] == doc.map().width()) sizeIndex = i;
}
Point MapEditor::worldAt(Point screen) const
{
    auto point = camera.toWorld({screen.x - canvas.x, screen.y - canvas.y}, canvas.w, canvas.h); return unproject(point.x, point.y);
}
Point MapEditor::screenAt(Point world) const
{
    auto point = camera.toScreen(project(world.x, world.y), canvas.w, canvas.h); return {point.x + canvas.x, point.y + canvas.y};
}
void MapEditor::home() { fitPending = false; auto at = project(doc.map().camp().x, doc.map().camp().y); camera = {at.x, at.y, .7f}; }
void MapEditor::fit()
{
    if (canvas.w <= 0) { fitPending = true; return; }
    fitPending = false;
    auto at = project(doc.map().width() / 2.f, doc.map().height() / 2.f);
    float zoom = std::min(std::max(100.f, canvas.w - 32) / (32.f * (doc.map().width() + doc.map().height())), std::max(100.f, canvas.h - 48) / (16.f * (doc.map().width() + doc.map().height())));
    camera = {at.x, at.y, std::clamp(zoom, .025f, 3.f)};
}
void MapEditor::finishStroke() { doc.endStroke(); lastPaint.reset(); renderer.finishTerrainEdits(); }
void MapEditor::undo() { finishStroke(); doc.undo(); syncSettings(); }
void MapEditor::redo() { finishStroke(); doc.redo(); syncSettings(); }
bool MapEditor::save()
{
    finishStroke(); failed = !doc.save(te::io::pathFromUtf8(path.value), feedback);
    if (!failed) feedback = "Map saved.";
    return !failed;
}
bool MapEditor::load()
{
    finishStroke(); failed = !doc.load(te::io::pathFromUtf8(path.value), feedback);
    if (!failed) { syncSettings(); feedback = "Map loaded."; fit(); }
    return !failed;
}
void MapEditor::regenerate()
{
    uint32_t value = 0; auto parsed = std::from_chars(seed.value.data(), seed.value.data() + seed.value.size(), value);
    if (parsed.ec != std::errc{} || parsed.ptr != seed.value.data() + seed.value.size()) { failed = true; feedback = "Enter a seed from 0 to 4294967295."; return; }
    finishStroke(); doc.regenerate(value, sizes[sizeIndex]); fit(); failed = false; feedback = "New island generated. Undo restores the previous map.";
}
void MapEditor::stamp(Point at)
{
    if (tool < terrainCount) doc.paint(at, radius, Terrain(tool));
    else if (tool == clearTool) doc.clearTrees(at, radius);
}
void MapEditor::pointerDown(ui::Context& c, Point point, bool secondary)
{
    mouse = point; c.pointerMove(point.x, point.y);
    if (!canvas.contains(point.x, point.y)) { if (!secondary) c.pointerDown(point.x, point.y); return; }
    c.focus("");
    if (secondary) { panFrom = point; return; }
    auto at = worldAt(point); if (!doc.map().inside(at)) return;
    if (tool < startTool) { doc.beginStroke(); lastPaint = at; stamp(at); return; }
    bool changed = tool == startTool ? doc.setStart(at) : tool == removeTool ? doc.removeDungeon(at) : doc.addDungeon(at, DungeonKind(tool - firstDungeonTool));
    failed = !changed;
    feedback = changed ? "Placement updated." : tool == startTool ? "Choose a dry, level 5 x 5 clearing." : tool == removeTool ? "Click a dungeon entrance to remove it." : "Choose a free, dry 2 x 2 area away from the start.";
}
void MapEditor::pointerMove(ui::Context& c, Point point)
{
    mouse = point; c.pointerMove(point.x, point.y);
    if (panFrom) { camera.x -= (point.x - panFrom->x) / camera.zoom; camera.y -= (point.y - panFrom->y) / camera.zoom; panFrom = point; }
    if (!lastPaint || !canvas.contains(point.x, point.y)) return;
    auto at = worldAt(point); if (!doc.map().inside(at)) return;
    if (distance(*lastPaint, at) < .01f) return;
    if (tool < terrainCount) doc.paintSegment(*lastPaint, at, radius, Terrain(tool));
    else if (tool == clearTool) doc.clearTreesSegment(*lastPaint, at, radius);
    lastPaint = at;
}
void MapEditor::pointerUp(ui::Context& c, Point point, bool secondary)
{
    if (secondary) { panFrom.reset(); return; }
    if (lastPaint) {
        pointerMove(c, point);
        if (canvas.contains(point.x, point.y)) { auto at = worldAt(point); if (doc.map().inside(at) && distance(*lastPaint, at) > .01f) stamp(at); }
        finishStroke(); return;
    }
    c.pointerUp(point.x, point.y);
}
void MapEditor::wheel(ui::Context& c, Point point, float amount)
{
    if (!canvas.contains(point.x, point.y)) { c.pointerMove(point.x, point.y); c.wheel(amount); return; }
    auto before = worldAt(point); camera.zoom = std::clamp(camera.zoom * std::pow(1.15f, amount), .025f, 4.f);
    auto after = worldAt(point); auto delta = project(before.x - after.x, before.y - after.y); camera.x += delta.x; camera.y += delta.y; mouse = point;
}

void MapEditor::minimap(ui::Context& c, ui::Rect r)
{
    const auto& map = doc.map(); const auto& t = c.theme();
    c.rect(r, t.background, t.radius, t.border);
    c.paint("map-mini" + std::to_string(doc.revision()) + ui::paintKey(r), [&] {
        auto root = tvg::Scene::gen(); Climate climate;
        for (int kind = 0; kind < terrainCount; ++kind) {
            auto shape = tvg::Shape::gen();
            for (int y = 0; y < map.height(); y += 3) for (int x = 0; x < map.width(); x += 3)
                if (int(map.at(x, y).terrain) == kind) shape->appendRect(r.x + r.w * x / map.width(), r.y + r.h * y / map.height(), r.w * std::min(3, map.width() - x) / map.width() + .1f, r.h * std::min(3, map.height() - y) / map.height() + .1f);
            fill(shape, opaque(groundColor(Terrain(kind), 1, climate))); root->add(shape);
        }
        return root;
    });
    auto dot = [&](Point p, ui::Color color, float radius) { c.rect({r.x + r.w * p.x / map.width() - radius, r.y + r.h * p.y / map.height() - radius, radius * 2, radius * 2}, color, radius); };
    dot(map.camp(), t.accent, 4);
    for (const auto& site : map.dungeons()) dot({site.origin.x + 1.f, site.origin.y + 1.f}, t.text, 2);
    auto center = unproject(camera.x, camera.y);
    dot({std::clamp(center.x, 0.f, float(map.width())), std::clamp(center.y, 0.f, float(map.height()))}, t.success, 3);
    c.control("map-minimap", r, [this, r](const ui::Event& e) {
        if (e.type != ui::EventType::Press && e.type != ui::EventType::Drag) return;
        auto point = project(std::clamp((e.x - r.x) / r.w, 0.f, 1.f) * doc.map().width(), std::clamp((e.y - r.y) / r.h, 0.f, 1.f) * doc.map().height()); camera.x = point.x; camera.y = point.y;
    }, true, false, false, true);
}

void MapEditor::render(ui::Context& c, ui::Rect viewport, std::function<void(bool)> close)
{
    const auto& t = c.theme();
    canvas = {216, 94, std::max(120.f, viewport.w - 516), std::max(120.f, viewport.h - 188)};
    if (fitPending) fit();
    if (shownRevision != doc.revision()) {
        auto area = doc.takeDirtyArea();
        if (!preview || preview->map().width() != doc.map().width() || preview->map().height() != doc.map().height() || preview->map().seed() != doc.map().seed()) {
            renderer.invalidateMap(); preview = std::make_unique<Town>(doc.previewMap(), Town::MapPreview{});
        } else {
            renderer.invalidateTerrain(area); preview->updateMapPreview(doc, area);
        }
        shownRevision = doc.revision();
    }
    renderer.update(*preview, traffic, camera, canvas.w, canvas.h, c.time(), {}, {});
    ui::setTransform(renderer.scene(), {1, 0, canvas.x, 0, 1, canvas.y, 0, 0, 1});
    c.rect(viewport, t.background);
    c.clip(canvas, [&] { c.add(renderer.scene()); });
    c.control("map-canvas", canvas, {}, true, false);
    c.text({24, 18, 400, 18}, "HEARTHOLD  /  CREATOR TOOLS", t.muted, 11, true);
    c.text({24, 39, 380, 32}, "Map Editor", t.text, 24, true);
    c.text({290, 42, 240, 24}, doc.changed() ? "Unsaved changes" : "Landscape draft", t.muted, 12);
    editorButton(c, "map-undo", {viewport.w - 408, 32, 80, 32}, "Undo", [this] { undo(); }, ui::ButtonStyle::Default, doc.canUndo());
    editorButton(c, "map-redo", {viewport.w - 320, 32, 80, 32}, "Redo", [this] { redo(); }, ui::ButtonStyle::Default, doc.canRedo());
    editorButton(c, "map-cancel", {viewport.w - 224, 32, 88, 32}, "Cancel", [close] { close(false); }, ui::ButtonStyle::Quiet);
    auto issue = doc.validation();
    editorButton(c, "map-play", {viewport.w - 128, 32, 104, 32}, "Play map", [close] { close(true); }, ui::ButtonStyle::Primary, issue.empty());
    c.line(16, 80, viewport.w - 16, 80, t.border);
    c.rect({16, 94, 188, canvas.h}, t.surface, t.radius, t.border);
    for (int i = 0; i < 2; ++i) editorButton(c, "map-tab-" + std::to_string(i), {24.f + i * 88, 104, 84, 30}, i ? "Sites" : "Terrain", [this, i] { if (category != i) choose(i ? startTool : 0); }, category == i ? ui::ButtonStyle::Primary : ui::ButtonStyle::Quiet);
    int count = category ? removeTool - startTool + 1 : clearTool + 1;
    for (int i = 0; i < count; ++i) {
        int index = category ? startTool + i : i;
        std::string label = category ? sites[i] : terrains[i];
        if (!category && i < 9) label = std::to_string(i + 1) + "  " + label;
        editorButton(c, "map-tool-" + std::to_string(index), {24, 146.f + i * 30, 172, 26}, label, [this, index] { tool = index; }, tool == index ? ui::ButtonStyle::Primary : ui::ButtonStyle::Quiet);
    }
    if (!category) {
        float y = 146.f + (clearTool + 1) * 30 + 12;
        c.text({28, y, 164, 22}, "Brush radius", t.muted, 12);
        editorButton(c, "map-radius-down", {28, y + 28, 32, 30}, "-", [this] { resizeBrush(-1); });
        c.text({64, y + 28, 88, 30}, std::to_string(int(radius)) + " tiles", t.text, 13, false, ui::Align::Center);
        editorButton(c, "map-radius-up", {156, y + 28, 32, 30}, "+", [this] { resizeBrush(1); });
        c.text({28, y + 70, 164, 36}, "Drag to paint.\nWater can form rivers.", t.muted, 11);
    } else {
        c.text({28, 358, 164, 66}, "Click to place a site.\nA start clears its trees.\nDungeons use 2 x 2 tiles.", t.muted, 11);
    }
    float right = viewport.w - 284;
    c.rect({right, 94, 268, canvas.h}, t.surface, t.radius, t.border);
    c.text({right + 16, 106, 236, 22}, "OVERVIEW", t.muted, 11, true);
    minimap(c, {right + 14, 138, 240, 158});
    editorButton(c, "map-fit", {right + 14, 308, 116, 30}, "Fit island", [this] { fit(); });
    editorButton(c, "map-home", {right + 138, 308, 116, 30}, "Go to start", [this] { home(); });
    c.text({right + 16, 352, 236, 22}, "ISLAND", t.muted, 11, true);
    c.text({right + 16, 380, 58, 26}, "Seed", t.muted, 12);
    ui::textField(c, "map-seed", {right + 70, 378, 182, 30}, seed, "0", true, [this](ui::Key key) { if (key != ui::Key::Enter) return false; regenerate(); return true; }, ui::Icon::None);
    editorButton(c, "map-size-prev", {right + 14, 422, 32, 28}, "<", [this] { sizeIndex = (sizeIndex + 4) % 5; });
    c.text({right + 48, 422, 158, 28}, std::to_string(sizes[sizeIndex]) + " x " + std::to_string(sizes[sizeIndex]), t.text, 13, false, ui::Align::Center);
    editorButton(c, "map-size-next", {right + 220, 422, 32, 28}, ">", [this] { sizeIndex = (sizeIndex + 1) % 5; });
    editorButton(c, "map-generate", {right + 14, 462, 238, 32}, "Generate island", [this] { regenerate(); });
    c.text({right + 16, 506, 236, 22}, std::to_string(doc.map().width()) + " x " + std::to_string(doc.map().height()) + " tiles / " + std::to_string(doc.map().dungeons().size()) + " dungeons", t.muted, 12);
    std::string guidance = issue.empty() ? "Ready to play.\nPlay map starts a new settlement." : issue;
    if (!issue.empty()) {
        size_t split = issue.size();
        while (split != std::string::npos && c.textWidth(issue.substr(0, split), 12) > 232) split = issue.rfind(' ', split - 1);
        if (split != std::string::npos && split < issue.size()) guidance[split] = '\n';
    }
    c.text({right + 16, 540, 236, 60}, guidance, issue.empty() ? t.success : t.danger, 12);
    if (canvas.contains(mouse.x, mouse.y)) {
        auto at = worldAt(mouse);
        if (doc.map().inside(at)) {
            auto color = t.accent;
            c.clip(canvas, [&] {
                c.paint(ui::paintKey("map-brush", at, radius, tool, camera.x, camera.y, camera.zoom, canvas), [&] {
                    auto shape = tvg::Shape::gen();
                    for (int i = 0; i <= 40; ++i) {
                        float a = i * 6.2831853f / 40; auto p = screenAt(at + Point{std::cos(a), std::sin(a)} * (tool < startTool ? radius : 1.4f));
                        if (!i) shape->moveTo(p.x, p.y); else shape->lineTo(p.x, p.y);
                    }
                    shape->close(); shape->fill(color.r, color.g, color.b, 24); shape->strokeWidth(1.5f); shape->strokeFill(color.r, color.g, color.b); return shape;
                });
            });
        }
    }
    auto marker = [&](Point p, std::string_view label, ui::Color color) {
        auto screen = screenAt(p); if (!canvas.contains(screen.x, screen.y)) return;
        c.rect({screen.x - 4, screen.y - 4, 8, 8}, color, 4);
        c.text({screen.x - 64, screen.y - 28, 128, 22}, label, color, 12, true, ui::Align::Center);
    };
    c.clip(canvas, [&] { marker(doc.map().camp(), "START", t.accent); });
    float footer = viewport.h - 78;
    c.text({24, footer, 56, 30}, "MAP FILE", t.muted, 11, true);
    ui::textField(c, "map-path", {94, footer, viewport.w - 294, 30}, path, "maps/my-island.hearthmap", true, [this](ui::Key key) { if (key != ui::Key::Enter) return false; save(); return true; }, ui::Icon::Folder);
    editorButton(c, "map-load", {viewport.w - 184, footer, 72, 30}, "Load", [this] { load(); });
    editorButton(c, "map-save", {viewport.w - 104, footer, 80, 30}, "Save", [this] { save(); });
    std::string message = feedback.empty() ? "Paint: left drag / Pan: right drag / Zoom: wheel / " + ui::platform::shortcutLabel("Mod+Z") + ": undo / " + ui::platform::shortcutLabel("Mod+S") + ": save / Esc: cancel draft" : feedback;
    c.text({24, viewport.h - 38, viewport.w - 48, 24}, c.elideText(message, viewport.w - 48, 12), failed ? t.danger : t.muted, 12);
}
}  // namespace hearthold

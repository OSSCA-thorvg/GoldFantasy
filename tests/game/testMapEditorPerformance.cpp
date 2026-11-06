#include <test/test.h>
#include <game/map_document.h>
#include <game/town.h>
#if HEARTHOLD_WITH_EDITOR
#include <game/authoring/map_editor.h>
#include <test/graphics.h>
#endif

namespace
{
using namespace hearthold;
// Ymir's stone stays stone under any brush.
// Ymir's stone and the volcano's cone, which no brush wears away.
bool onYmir(const WorldMap& map, Point at) { return (map.giant() && map.giant()->covers(at)) || (map.volcano() && map.volcano()->covers(at)); }

void sameMap(const WorldMap& a, const WorldMap& b)
{
    CHECK_EQ(a.width(), b.width()); CHECK_EQ(a.height(), b.height()); CHECK_EQ(a.seed(), b.seed());
    CHECK(a.start() == b.start()); CHECK(a.river().path == b.river().path); CHECK(a.river().width == b.river().width);
    for (int layer = 0; layer < int(Layer::Count); ++layer)
        for (int y = 0; y <= a.height() * WorldMap::resolution; ++y)
            for (int x = 0; x <= a.width() * WorldMap::resolution; ++x)
                CHECK_EQ(a.sample(Layer(layer), x, y), b.sample(Layer(layer), x, y));
    for (int y = 0; y < a.height(); ++y) for (int x = 0; x < a.width(); ++x) {
        const auto& p = a.at(x, y); const auto& q = b.at(x, y);
        CHECK(p.terrain == q.terrain); CHECK_EQ(p.shade, q.shade); CHECK_EQ(p.trees, q.trees);
        CHECK_EQ(p.wild, q.wild); CHECK_EQ(p.revealed, q.revealed); CHECK_EQ(p.dungeon, q.dungeon);
    }
    CHECK_EQ(a.dungeons().size(), b.dungeons().size());
    for (size_t i = 0; i < a.dungeons().size(); ++i) {
        const auto& p = a.dungeons()[i]; const auto& q = b.dungeons()[i];
        CHECK_EQ(p.name, q.name); CHECK(p.kind == q.kind); CHECK(p.origin == q.origin); CHECK_EQ(p.discovered, q.discovered);
    }
}
}  // namespace

TEST(game_map_local_undo_blocks_restore_sample_boundaries_overlaps_and_cancel)
{
    MapDocument doc(WorldMap::generate(5, 64, 64)); auto original = doc.map();
    doc.beginStroke();
    for (Point at : {Point{.25f, .25f}, Point{15.5f, 16.f}, Point{16.f, 16.5f}, Point{63.75f, 63.75f}})
        CHECK(doc.paint(at, 3, Terrain::Forest));
    CHECK(doc.clearTrees({16.f, 16.f}, 2));
    doc.endStroke(); auto painted = doc.map();
    doc.undo(); sameMap(original, doc.map());
    doc.redo(); sameMap(painted, doc.map());
    doc.beginStroke(); doc.paint({32.f, 32.f}, 12, Terrain::Water); doc.cancelStroke(); sameMap(painted, doc.map());
    // A map replacement and local block edits share the same undo/redo stack.
    CHECK(doc.regenerate(7, 96)); auto regenerated = doc.map();
    doc.paint({32.f, 32.f}, 3, Terrain::Forest); auto regeneratedPainted = doc.map();
    doc.undo(); sameMap(regenerated, doc.map());
    doc.undo(); sameMap(painted, doc.map());
    doc.undo(); sameMap(original, doc.map());
    doc.redo(); sameMap(painted, doc.map());
    doc.redo(); sameMap(regenerated, doc.map());
    doc.redo(); sameMap(regeneratedPainted, doc.map());
}

TEST(game_map_retained_preview_matches_a_full_copy_after_brushes_rivers_and_undo)
{
    MapDocument doc(WorldMap::generate(5, 256, 256));
    Town preview(doc.previewMap(), Town::MapPreview{}); doc.takeDirtyArea();
    CHECK(preview.people().empty()); CHECK(!preview.walking().walkable(preview.map().camp()));
    auto refresh = [&] { preview.updateMapPreview(doc, doc.takeDirtyArea()); sameMap(doc.previewMap(), preview.map()); };
    auto remoteTile = &preview.map().at(250, 250);
    doc.beginStroke();
    for (int i = 0; i < 6; ++i) {
        doc.paint({60.f + i * 7, 80.f}, 12, i % 2 ? Terrain::Water : Terrain::Forest); refresh();
    }
    doc.endStroke();
    auto river = doc.map().river(); CHECK(!river.path.empty());
    if (!river.path.empty()) { doc.paint(river.path[river.path.size() / 2], 3, Terrain::Grass); refresh(); }
    CHECK(&preview.map().at(250, 250) == remoteTile);
    doc.undo(); refresh(); doc.undo(); refresh(); doc.redo(); refresh();
    CHECK(doc.regenerate(7, 96)); refresh();
}

TEST(game_map_retained_preview_reindexes_remote_dungeons_after_removal)
{
    MapDocument doc(WorldMap::generate(5, 96, 96));
    while (!doc.map().dungeons().empty()) {
        auto at = doc.map().dungeons().front().origin; doc.removeDungeon({at.x + .5f, at.y + .5f});
    }
    doc.paint({30.f, 30.f}, 8, Terrain::Grass); doc.paint({65.f, 65.f}, 8, Terrain::Grass);
    CHECK(doc.addDungeon({30.f, 30.f}, DungeonKind::Cave)); CHECK(doc.addDungeon({65.f, 65.f}, DungeonKind::Crypt));
    Town preview(doc.previewMap(), Town::MapPreview{}); doc.takeDirtyArea(); auto original = doc.map();
    CHECK(doc.removeDungeon({30.5f, 30.5f})); auto removed = doc.map();
    preview.updateMapPreview(doc, doc.takeDirtyArea()); sameMap(doc.previewMap(), preview.map());
    CHECK_EQ(int(preview.map().at(65, 65).dungeon), 0);
    doc.undo(); sameMap(original, doc.map());
    preview.updateMapPreview(doc, doc.takeDirtyArea()); sameMap(doc.previewMap(), preview.map());
    doc.redo(); sameMap(removed, doc.map());
}

TEST(game_map_segment_brush_covers_fast_diagonal_drags_endpoints_and_preserves_remote_samples)
{
    MapDocument doc(WorldMap::generate(5, 256, 256)); auto original = doc.map(); doc.takeDirtyArea();
    Point from{2.5f, 4.5f}, to{250.5f, 248.5f}; float radius = 3;
    auto revision = doc.revision(); CHECK(doc.paintSegment(from, to, radius, Terrain::Water));
    CHECK_EQ(doc.revision(), revision + 1); auto dirty = doc.takeDirtyArea();
    for (int i = 0; i <= 512; ++i) CHECK(onYmir(doc.map(), lerp(from, to, i / 512.f)) || doc.map().terrainAt(lerp(from, to, i / 512.f)) == Terrain::Water);
    for (int y = 0; y <= 512; ++y) for (int x = 0; x <= 512; ++x) {
        Point at{x / 2.f, y / 2.f}; float d = segmentDistance(at, from, to);
        CHECK_EQ(original.sample(Layer::Shade, x, y), doc.map().sample(Layer::Shade, x, y));
        for (int layer = 0; layer < int(Layer::Count); ++layer) {
            auto before = original.sample(Layer(layer), x, y), after = doc.map().sample(Layer(layer), x, y);
            if (d > radius + .001f) CHECK_EQ(before, after);
            if (before != after) CHECK(at.x >= dirty.left && at.x <= dirty.right && at.y >= dirty.top && at.y <= dirty.bottom);
        }
    }
    for (int y = 0; y < 256; ++y) for (int x = 0; x < 256; ++x)
        CHECK(doc.map().at(x, y).terrain == doc.map().terrainAt({x + .5f, y + .5f}));
    auto painted = doc.map(); doc.undo(); sameMap(original, doc.map()); doc.redo(); sameMap(painted, doc.map());
    doc.takeDirtyArea(); revision = doc.revision();
    CHECK(!doc.paintSegment(from, {-1, -1}, radius, Terrain::Grass)); CHECK_EQ(doc.revision(), revision); CHECK(doc.takeDirtyArea().empty());
}

TEST(game_map_segment_brush_restores_river_neighbors_and_tree_eraser_as_one_undo_step)
{
    MapDocument doc(WorldMap::generate(5, 64, 64)); auto original = doc.map();
    auto river = original.river(); Point from = river.path[river.path.size() / 4], to = river.path[river.path.size() * 3 / 4];
    CHECK(doc.paintSegment(from, to, 6, Terrain::Forest)); bool carved = false;
    for (size_t i = 0; i < river.path.size(); ++i) {
        if (segmentDistance(river.path[i], from, to) <= 6 + river.width[i] / 2) {
            CHECK_EQ(doc.map().river().width[i], 0.f); carved = true;
        }
    }
    CHECK(carved);
    for (int y = 0; y < 64; ++y) for (int x = 0; x < 64; ++x)
        CHECK(doc.map().at(x, y).terrain == doc.map().terrainAt({x + .5f, y + .5f}));
    auto forest = doc.map(); CHECK(doc.clearTreesSegment(from, to, 2));
    for (int y = 0; y < 64; ++y) for (int x = 0; x < 64; ++x)
        if (segmentDistance({x + .5f, y + .5f}, from, to) < 1.99f) CHECK_EQ(int(doc.map().at(x, y).trees), 0);
    doc.undo(); sameMap(forest, doc.map()); doc.undo(); sameMap(original, doc.map());
    doc.beginStroke(); doc.paintSegment(from, to, 12, Terrain::Sea); doc.clearTreesSegment({1, 1}, {63, 63}, 8); doc.cancelStroke();
    sameMap(original, doc.map());
    for (auto endpoints : {std::pair{Point{4.5f, 8.5f}, Point{58.5f, 8.5f}},
                           std::pair{Point{8.5f, 58.5f}, Point{8.5f, 4.5f}},
                           std::pair{Point{58.5f, 4.5f}, Point{4.5f, 58.5f}},
                           std::pair{Point{20.5f, 44.5f}, Point{20.5f, 44.5f}}}) {
        CHECK(doc.paintSegment(endpoints.first, endpoints.second, 2, Terrain::Water));
        for (int i = 0; i <= 128; ++i) {
            auto at = lerp(endpoints.first, endpoints.second, i / 128.f);
            CHECK(onYmir(doc.map(), at) || doc.map().terrainAt(at) == Terrain::Water);
        }
        doc.undo(); sameMap(original, doc.map());
    }
}

#if HEARTHOLD_WITH_EDITOR
TEST(game_map_editor_fast_zoomed_drag_batches_one_document_update_per_pointer_event)
{
    te::test::Graphics graphics; MapEditor editor(WorldMap::generate(5, 256, 256)); ui::Context context;
    auto theme = ui::Theme::dark(); context.begin(theme, {0, 0, 1280, 800}, 0); editor.render(context, {0, 0, 1280, 800}, {}); context.end();
    auto center = project(128, 128); editor.view() = {center.x, center.y, .04f}; editor.choose(3); editor.resizeBrush(9);
    auto screen = [&](Point at) { auto r = editor.canvasBounds(); auto p = editor.view().toScreen(project(at.x, at.y), r.w, r.h); return p + Point{r.x, r.y}; };
    auto from = screen({16, 16}), to = screen({240, 240}); editor.pointerDown(context, from, false);
    auto revision = editor.document().revision(); editor.pointerMove(context, to);
    CHECK_EQ(editor.document().revision(), revision + 1); editor.pointerUp(context, to, false);
    for (int i = 0; i <= 256; ++i) {
        auto at = lerp(Point{16, 16}, Point{240, 240}, i / 256.f);
        CHECK(onYmir(editor.document().map(), at) || editor.document().map().terrainAt(at) == Terrain::Water);
    }
}
#endif

#include <test/test.h>
#include <test/graphics.h>
#include <test/directory.h>
#include <game/game_app.h>
#include <game/map_document.h>
#include <core/io/io.h>
#include <algorithm>
#include <cmath>
#include <fstream>
#include <memory>
#include <unordered_set>

namespace
{
using namespace hearthold;

// A grassy start with a cave beside it, well clear of Ymir at the map's heart.
MapDocument island()
{
    MapDocument doc(WorldMap::generate(5, 96, 96));
    while (!doc.map().dungeons().empty()) {
        auto at = doc.map().dungeons().front().origin;
        doc.removeDungeon({at.x + .5f, at.y + .5f});
    }
    doc.paint({32.5f, 32.5f}, 14, Terrain::Grass);
    doc.setStart({32.5f, 32.5f});
    CHECK(doc.addDungeon({40.5f, 32.5f}, DungeonKind::Cave));
    CHECK(doc.validation().empty());
    return doc;
}

bool sameLandscape(const WorldMap& a, const WorldMap& b)
{
    if (a.width() != b.width() || a.height() != b.height() || a.seed() != b.seed() || !(a.start() == b.start()) || a.river().path != b.river().path || a.river().width != b.river().width || a.dungeons().size() != b.dungeons().size()) return false;
    for (int l = 0; l < int(Layer::Count); ++l)
        for (int y = 0; y <= a.height() * 2; ++y) for (int x = 0; x <= a.width() * 2; ++x)
            if (a.sample(Layer(l), x, y) != b.sample(Layer(l), x, y)) return false;
    for (int y = 0; y < a.height(); ++y) for (int x = 0; x < a.width(); ++x) {
        const auto& p = a.at(x, y); const auto& q = b.at(x, y);
        if (p.terrain != q.terrain || p.shade != q.shade || p.trees != q.trees || p.wild != q.wild || p.dungeon != q.dungeon) return false;
    }
    for (size_t i = 0; i < a.dungeons().size(); ++i) {
        const auto& p = a.dungeons()[i]; const auto& q = b.dungeons()[i];
        if (p.name != q.name || p.kind != q.kind || !(p.origin == q.origin)) return false;
    }
    return true;
}

void write(const std::filesystem::path& path, std::string_view data)
{
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    out.write(data.data(), std::streamsize(data.size())); CHECK(bool(out));
}
#if HEARTHOLD_WITH_EDITOR
Point screenAt(const MapEditor& editor, Camera camera, Point p)
{
    auto r = editor.canvasBounds(); auto screen = camera.toScreen(project(p.x, p.y), r.w, r.h);
    return {screen.x + r.x, screen.y + r.y};
}

void shapes(tvg::Paint* paint, std::vector<tvg::Paint*>& output)
{
    if (paint->type() == tvg::Type::Shape) output.push_back(paint);
    if (paint->type() == tvg::Type::Scene)
        for (auto child : static_cast<tvg::Scene*>(paint)->paints()) shapes(child, output);
}
struct RetainedShapes
{
    std::vector<tvg::Paint*> paints;
    explicit RetainedShapes(tvg::Paint* root) { shapes(root, paints); for (auto paint : paints) paint->ref(); }
    ~RetainedShapes() { for (auto paint : paints) paint->unref(); }
};
#endif
}  // namespace

TEST(game_map_brushes_paint_all_terrain_and_tree_erasing_prevents_regrowth)
{
    auto doc = island();
    Point at{20.5f, 20.5f}; auto remote = doc.map().terrainAt({55.5f, 55.5f});
    for (int kind = 0; kind < terrainCount; ++kind) {
        CHECK(doc.paint(at, 3, Terrain(kind)));
        CHECK(doc.map().terrainAt(at) == Terrain(kind));
        CHECK(doc.map().cell(at)->terrain == Terrain(kind));
        if (kind == int(Terrain::Forest)) CHECK(doc.map().cell(at)->trees > 0);
    }
    CHECK(doc.map().terrainAt({55.5f, 55.5f}) == remote);
    CHECK(doc.paint(at, 3, Terrain::Forest));
    CHECK(doc.clearTrees(at, 3));
    CHECK_EQ(int(doc.map().cell(at)->trees), 0);
    CHECK_EQ(int(doc.map().cell(at)->wild), 0);
    CHECK(doc.map().terrainAt(at) == Terrain::Forest);
    doc.undo(); CHECK(doc.map().cell(at)->trees > 0);
}

TEST(game_map_paint_can_replace_the_generated_river_and_keeps_terrain_cache_consistent)
{
    auto doc = island(); auto river = doc.map().river();
    // A stretch of river still flowing over land after the island's start was cleared.
    size_t live = 0;
    while (live + 1 < river.path.size() && (river.width[live] <= 0 || doc.map().value(Layer::Land, river.path[live]) < .1f)) ++live;
    CHECK(river.width[live] > 0);
    Point at = river.path[live];
    CHECK(doc.paint(at, 4, Terrain::Grass));
    CHECK(doc.map().terrainAt(at) == Terrain::Grass);
    CHECK(doc.map().river().width != river.width);
    for (int y = 0; y < doc.map().height(); ++y) for (int x = 0; x < doc.map().width(); ++x)
        CHECK(doc.map().at(x, y).terrain == doc.map().terrainAt({x + .5f, y + .5f}));
    doc.undo(); CHECK(doc.map().river().width == river.width);
    doc.redo(); CHECK(doc.map().terrainAt(at) == Terrain::Grass);
}

TEST(game_map_drag_is_one_undo_step_and_cancel_restores_all_terrain)
{
    auto doc = island(); auto original = doc.map();
    doc.beginStroke();
    for (int i = 0; i < 8; ++i) doc.paint({20.5f + i, 20.5f}, 2, Terrain::Water);
    doc.endStroke(); auto painted = doc.map();
    doc.undo(); CHECK(sameLandscape(original, doc.map()));
    doc.redo(); CHECK(sameLandscape(painted, doc.map()));
    doc.beginStroke(); doc.paint({22, 22}, 4, Terrain::Forest); doc.cancelStroke();
    CHECK(sameLandscape(painted, doc.map()));
    auto revision = doc.revision();
    CHECK(!doc.paint({-10, -10}, 2, Terrain::Sea));
    CHECK(!doc.paint({20, 20}, 100, Terrain::Sea));
    CHECK_EQ(doc.revision(), revision);
}

TEST(game_map_dirty_area_covers_changed_samples_and_collects_a_drag_without_invalidating_the_whole_island)
{
    auto doc = island(); auto original = doc.map();
    doc.takeDirtyArea(); CHECK(doc.takeDirtyArea().empty());
    doc.beginStroke(); doc.paint({20.5f, 20.5f}, 2, Terrain::Forest); doc.paint({24.5f, 20.5f}, 2, Terrain::Water); doc.endStroke();
    auto area = doc.takeDirtyArea(); CHECK(!area.empty());
    CHECK(area.right - area.left < doc.map().width());
    CHECK(area.bottom - area.top < doc.map().height());
    for (int l = 0; l < int(Layer::Count); ++l)
        for (int y = 0; y <= original.height() * 2; ++y) for (int x = 0; x <= original.width() * 2; ++x) {
            if (original.sample(Layer(l), x, y) == doc.map().sample(Layer(l), x, y)) continue;
            CHECK(x / 2.f >= area.left && x / 2.f <= area.right && y / 2.f >= area.top && y / 2.f <= area.bottom);
        }
    CHECK(doc.takeDirtyArea().empty());
    doc.undo(); CHECK(sameLandscape(original, doc.map()));
    area = doc.takeDirtyArea(); CHECK(area.left <= 0 && area.top <= 0 && area.right >= original.width() && area.bottom >= original.height());
    CHECK(!doc.paint({-1, -1}, 2, Terrain::Grass)); CHECK(doc.takeDirtyArea().empty());
}

TEST(game_map_start_and_dungeon_tools_reject_invalid_sites_and_reindex_after_removal)
{
    auto doc = island();
    CHECK(!doc.setStart({1, 1}));
    CHECK(!doc.addDungeon(doc.map().camp(), DungeonKind::Crypt));
    CHECK(!doc.addDungeon({40.5f, 32.5f}, DungeonKind::Portal));
    CHECK(doc.addDungeon({32.5f, 40.5f}, DungeonKind::Ruin));
    CHECK(doc.removeDungeon({40.5f, 32.5f}));
    CHECK_EQ(doc.map().dungeons().size(), size_t(1));
    CHECK_EQ(int(doc.map().at(33, 41).dungeon), 0);
    CHECK_EQ(int(doc.map().at(40, 32).dungeon), -1);
    CHECK(doc.paint(doc.map().camp(), 4, Terrain::Forest));
    CHECK(!doc.validation().empty());
    CHECK(doc.setStart(doc.map().camp()));
    CHECK(doc.validation().empty());
    CHECK(doc.paint({32.5f, 40.5f}, 3, Terrain::Water));
    CHECK(!doc.validation().empty());
    doc.undo(); CHECK(doc.validation().empty());
    CHECK(doc.removeDungeon({32.5f, 40.5f}));
    CHECK(!doc.validation().empty());
}

TEST(game_map_save_and_load_preserve_the_authored_landscape_and_clean_undo_checkpoint)
{
    te::test::Directory directory;
    auto path = directory.path / std::filesystem::path(u8"★-map.hearthmap");
    auto doc = island(); std::string error;
    doc.paint({20.5f, 20.5f}, 3, Terrain::Forest);
    doc.paint({24.5f, 20.5f}, 2, Terrain::Water);
    CHECK(doc.save(path, error)); CHECK(error.empty()); CHECK(!doc.changed());
    auto saved = doc.map();
    doc.paint({20.5f, 20.5f}, 3, Terrain::Sea); CHECK(doc.changed());
    doc.undo(); CHECK(!doc.changed());
    doc.redo(); CHECK(doc.changed());
    CHECK(doc.load(path, error)); CHECK(!doc.changed());
    CHECK(sameLandscape(saved, doc.map()));
    auto bytes = te::io::load(path); CHECK(bool(bytes)); if (!bytes) return;
    auto text = bytes.value.text; auto name = text.find("\"Cave 1\""); CHECK(name != std::string::npos);
    if (name != std::string::npos) text.replace(name, 8, "\"Old ★ Cave\"");
    write(path, text); CHECK(doc.load(path, error));
    CHECK_EQ(doc.map().dungeons().front().name, std::string("Old ★ Cave"));
    doc.undo(); CHECK(sameLandscape(saved, doc.map()));
}

TEST(game_map_invalid_files_leave_the_current_draft_unchanged)
{
    te::test::Directory directory; auto path = directory.path / "bad.hearthmap";
    auto doc = island(); auto original = doc.map(); std::string error;
    CHECK(doc.save(path, error));
    auto bytes = te::io::load(path); CHECK(bool(bytes)); if (!bytes) return;
    auto valid = bytes.value.text;
    std::vector<std::string> invalid{
        "hearthold-map 99\n", "hearthold-map 1\n5 99999 64 32 32\n",
        "hearthold-map 1\n5 64 64 -1 32\n", valid.substr(0, valid.size() / 2), valid + "trailing data"
    };
    auto nonfinite = valid; auto first = nonfinite.find('\n', nonfinite.find('\n') + 1) + 1;
    nonfinite.replace(first, nonfinite.find(' ', first) - first, "nan"); invalid.push_back(nonfinite);
    for (const auto& data : invalid) {
        write(path, data); CHECK(!doc.load(path, error)); CHECK(!error.empty());
        CHECK(sameLandscape(original, doc.map())); CHECK(!doc.changed());
    }
}

TEST(game_map_play_starts_two_founders_with_local_fog_and_a_buildable_camp)
{
    auto doc = island(); auto preview = doc.previewMap();
    CHECK(preview.revealed({0, 0}));
    auto map = doc.gameMap(); CHECK(!map.revealed({0, 0}));
    CHECK(map.revealed(map.camp())); CHECK(map.dungeons().front().discovered);
    Town town(std::move(map)); CHECK_EQ(town.people().size(), size_t(2));
    CHECK(town.canPlace(Structure::Camp, town.map().camp(), 0).ok);
    CHECK(town.place(Structure::Camp, town.map().camp(), 0));
    for (const auto& p : town.people()) CHECK(distance(p.position, town.map().camp()) < 1.5f);
    Town empty(doc.previewMap(), false); CHECK(empty.people().empty());
}

TEST(game_map_generation_offers_playable_starts_at_every_editor_size)
{
    auto doc = island();
    for (int size : {64, 96, 128, 176, 256}) {
        CHECK(doc.regenerate(5, size)); CHECK_EQ(doc.validation(), std::string{});
        Town town(doc.gameMap());
        CHECK(town.canPlace(Structure::Camp, town.map().camp(), 0).ok);
    }
    CHECK(doc.regenerate(0, 64)); CHECK_EQ(doc.validation(), std::string{});
    Town town(doc.gameMap()); CHECK(town.canPlace(Structure::Camp, town.map().camp(), 0).ok);
}

#if HEARTHOLD_WITH_EDITOR
TEST(game_map_editor_routes_canvas_strokes_zoom_and_undo_without_editing_the_running_game)
{
    te::test::Graphics graphics; GameApp game(5);
    game.render(1280, 800, 0); auto original = game.state().map(); auto time = game.state().clock();
    game.openMapEditor(); game.render(1280, 800, 100);
    CHECK_EQ(game.worldScene()->opacity(), uint8_t(0));
    auto editor = game.mapEditor(); CHECK(editor); if (!editor) return;
    auto at = original.camp(); editor->choose(3);
    auto point = screenAt(*editor, editor->view(), at);
    game.pointerDown(point.x, point.y, PointerButton::Primary);
    auto revision = editor->document().revision();
    game.pointerMove(point.x + 1, point.y); CHECK(editor->document().revision() > revision);
    game.pointerMove(point.x + 40, point.y);
    game.pointerUp(point.x + 40, point.y, PointerButton::Primary);
    CHECK(editor->document().map().terrainAt(at) == Terrain::Water);
    auto before = editor->view().toWorld({point.x - editor->canvasBounds().x, point.y - editor->canvasBounds().y}, editor->canvasBounds().w, editor->canvasBounds().h);
    game.wheel(point.x, point.y, 2);
    auto after = editor->view().toWorld({point.x - editor->canvasBounds().x, point.y - editor->canvasBounds().y}, editor->canvasBounds().w, editor->canvasBounds().h);
    CHECK(distance(before, after) < .01f);
    game.render(1280, 800, 150);
    game.closeMapEditor(true); game.render(1280, 800, 151); CHECK(game.mapEditor());
    game.pointerDown(910, 48, PointerButton::Primary); game.pointerUp(910, 48, PointerButton::Primary);
    CHECK(sameLandscape(original, editor->document().map()));
    game.render(1280, 800, 200); CHECK_EQ(game.state().clock(), time);
    game.mapKey(ui::Key::Escape); game.render(1280, 800, 300);
    CHECK(!game.mapEditor()); CHECK(sameLandscape(original, game.state().map()));
    CHECK_EQ(game.worldScene()->opacity(), uint8_t(255));
    CHECK_EQ(game.state().clock(), time);
}
#endif

#if HEARTHOLD_WITH_EDITOR
TEST(game_map_editor_applies_new_map_sizes_to_the_retained_game_scene_and_renders_again)
{
    te::test::Graphics graphics; GameApp game(5);
    CHECK(game.state().place(Structure::Camp, game.state().map().camp(), 0));
    game.state().completeConstruction();
    game.render(1120, 720, 0); auto world = game.worldScene();
    std::vector<uint32_t> pixels(1120 * 720);
    std::unique_ptr<tvg::SwCanvas> canvas(tvg::SwCanvas::gen(tvg::EngineOption::Default));
    CHECK(canvas->target(pixels.data(), 1120, 1120, 720, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
    CHECK(canvas->add(game.worldScene()) == tvg::Result::Success);
    CHECK(canvas->add(game.hudScene()) == tvg::Result::Success);
    for (int size : {64, 96}) {
        canvas->sync(); game.openMapEditor(); game.render(1120, 720, size);
        CHECK(game.mapEditor()); if (!game.mapEditor()) return;
        game.mapEditor()->document().regenerate(5, size);
        CHECK(game.mapEditor()->document().validation().empty());
        game.closeMapEditor(true); game.render(1120, 720, size + 1);
        CHECK(!game.mapEditor()); CHECK_EQ(game.state().map().width(), size);
        CHECK(game.worldScene() == world); CHECK_EQ(game.state().people().size(), size_t(2));
        CHECK(game.state().buildings().empty()); CHECK(game.state().roads().roads().empty());
        CHECK(canvas->update() == tvg::Result::Success);
        CHECK(canvas->draw(true) == tvg::Result::Success); CHECK(canvas->sync() == tvg::Result::Success);
        CHECK(std::any_of(pixels.begin(), pixels.end(), [](uint32_t p) { return (p & 0xffffff) != 0; }));
    }
}
#endif

#if HEARTHOLD_WITH_EDITOR
TEST(game_map_editor_retains_unedited_geometry_and_zoomed_edits_match_a_freshly_loaded_map)
{
    te::test::Graphics graphics; te::test::Directory directory;
    GameApp game(5); game.openMapEditor(); game.render(1280, 800, 0);
    auto editor = game.mapEditor(); CHECK(editor); if (!editor) return;
    auto camp = editor->document().map().camp();
    RetainedShapes before(game.hudScene());
    editor->document().paint(camp + Point{6, 2}, 2, Terrain::Water);  // Meadow inland, clear of the shore and trees.
    game.render(1280, 800, 1);
    std::vector<tvg::Paint*> after; shapes(game.hudScene(), after);
    std::unordered_set<tvg::Paint*> current(after.begin(), after.end());
    auto retained = std::count_if(before.paints.begin(), before.paints.end(), [&](auto paint) { return current.count(paint); });
    CHECK(size_t(retained) * 100 > before.paints.size() * 80);
    editor->fit(); game.render(1280, 800, 2);
    editor->document().paint(camp + Point{5, 3}, 2, Terrain::Forest);
    game.render(1280, 800, 3);
    auto path = directory.path / "edited.hearthmap"; std::string error;
    CHECK(editor->document().save(path, error));

    GameApp loaded(5); loaded.openMapEditor(); loaded.mapEditor()->setPath(path);
    CHECK(loaded.mapEditor()->load()); loaded.render(1280, 800, 3);
    CHECK_EQ(loaded.mapEditor()->view().zoom, editor->view().zoom);
    std::unique_ptr<tvg::SwCanvas> canvas(tvg::SwCanvas::gen(tvg::EngineOption::Default));
    auto raster = [&](GameApp& app) {
        std::vector<uint32_t> pixels(1280 * 800);
        CHECK(canvas->target(pixels.data(), 1280, 1280, 800, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
        CHECK(canvas->add(app.hudScene()) == tvg::Result::Success);
        CHECK(canvas->update() == tvg::Result::Success); CHECK(canvas->draw(true) == tvg::Result::Success);
        CHECK(canvas->sync() == tvg::Result::Success); canvas->remove(); return pixels;
    };
    auto compare = [&] {
        auto warm = raster(game), cold = raster(loaded); size_t mismatched = 0; int largestDelta = 0;
        auto r = editor->canvasBounds();
        for (int y = int(r.y); y < r.y + r.h; ++y) for (int x = int(r.x); x < r.x + r.w; ++x) {
            auto a = warm[size_t(y) * 1280 + x], b = cold[size_t(y) * 1280 + x];
            bool different = false;
            for (int shift : {0, 8, 16}) {
                int delta = std::abs(int(a >> shift & 255) - int(b >> shift & 255));
                different |= delta > 2; largestDelta = std::max(largestDelta, delta);
            }
            mismatched += different;
        }
        // Cache partitions can round a few antialiased edge pixels differently, more where a coast's sand, surf
        // and cliff layers and the relief's shading stack on a partition's edge.
        CHECK(largestDelta <= 12); CHECK(mismatched <= size_t(r.w * r.h) / 10000);
    };
    compare();
    editor->home(); loaded.mapEditor()->home(); game.render(1280, 800, 4); loaded.render(1280, 800, 4);
    compare();
}
#endif


#if HEARTHOLD_WITH_EDITOR
TEST(game_map_editor_tools_cover_ice_and_fire_then_trees_and_sites)
{
    te::test::Graphics graphics;
    GameApp game(5);
    game.render(1280, 800, 0);
    game.openMapEditor();
    game.render(1280, 800, 1);
    auto editor = game.mapEditor();
    CHECK(editor);
    if (!editor) return;
    auto click = [&](Point world) {
        auto p = screenAt(*editor, editor->view(), world);
        game.pointerDown(p.x, p.y, PointerButton::Primary);
        game.pointerUp(p.x, p.y, PointerButton::Primary);
    };
    const auto& map = editor->document().map();
    auto camp = map.camp();
    Point spot{camp.x + 6.5f, camp.y + .5f};
    for (auto kind : {Terrain::Ash, Terrain::Frost, Terrain::Ice, Terrain::Lava}) {
        editor->choose(int(kind));
        click(spot);
        CHECK(map.terrainAt(spot) == kind);
    }
    editor->choose(int(Terrain::Forest));
    click(spot);
    CHECK(map.cell(spot)->trees > 0);
    editor->choose(MapEditor::clearTool);
    click(spot);
    CHECK_EQ(int(map.cell(spot)->trees), 0);
    // A fresh clearing for a ruin, then for the start.
    Point ruin{camp.x + 9.5f, camp.y - 7.5f}, start{camp.x - 9.5f, camp.y + 7.5f};
    for (auto at : {ruin, start}) {
        editor->choose(int(Terrain::Grass));
        click(at);
    }
    auto dungeons = map.dungeons().size();
    editor->choose(MapEditor::firstDungeonTool + int(DungeonKind::Ruin));
    click(ruin);
    CHECK_EQ(map.dungeons().size(), dungeons + 1);
    CHECK(map.dungeons().back().kind == DungeonKind::Ruin);
    editor->choose(MapEditor::startTool);
    click(start);
    CHECK(distance(map.camp(), start) < 1.5f);
}
#endif

#include <test/test.h>
#include <test/directory.h>
#include <test/graphics.h>
#include <GameEngine/authoring/building_editor.h>
#include <GameEngine/engine.h>
#include <core/io/io.h>
#include <fstream>

namespace
{
gameframework::BuildingAsset sample()
{
    gameframework::Block block{0, 0, 1, 1, 28, 18, gameframework::RoofShape::GableX, {190, 165, 120}, {145, 120, 85}, {125, 75, 55}, {90, 50, 40}};
    return {"example-building", "Example building", 1, {{{}, {block}}}};
}
void write(const std::filesystem::path& path, const gameframework::BuildingAsset& asset)
{
    std::ofstream out(path); out << gameframework::encodeBuildingAsset(asset);
}
}

TEST(building_editor_edits_validate_and_undo_redo_preserve_all_fields)
{
    engine::BuildingEditor editor(sample());
    CHECK(editor.command("property", "wall=42"));
    CHECK(editor.changed());
    CHECK(editor.current().variants[0].blocks[0].wall == 42);
    CHECK(!editor.command("property", "wall=1e300"));
    CHECK(!editor.command("property", "wallLit.r=256"));
    CHECK(!editor.command("property", "x1=0"));
    CHECK(editor.current().variants[0].blocks[0].wall == 42);
    editor.undo(); CHECK(editor.current() == sample()); CHECK(!editor.changed());
    editor.redo(); CHECK(editor.current().variants[0].blocks[0].wall == 42);
    CHECK(editor.command("property", "accent.g=73"));
    CHECK(editor.command("property", "ornament=2"));
    CHECK(editor.command("selection.duplicate"));
    CHECK(editor.current().variants[0].blocks.size() == 2);
    CHECK(editor.current().variants[0].blocks[1].accent.g == 73);
    CHECK(editor.command("patch.add"));
    CHECK(editor.command("property", "furrows=8"));
    CHECK(editor.current().variants[0].patches[0].furrows == 8);
    CHECK(editor.command("selection.delete"));
    CHECK(editor.current().variants[0].patches.empty());
}

TEST(building_editor_game_restrictions_and_apply_are_transactional)
{
    engine::BuildingEditor editor(sample()); editor.setGameMode(true);
    CHECK(!editor.command("property", "footprint=2"));
    CHECK(!editor.command("property", "id=another-building"));
    CHECK(!editor.command("variant.add"));
    CHECK(editor.current() == sample());
    CHECK(editor.command("property", "roof=22"));
    auto before = editor.current();
    CHECK(!editor.apply([](const auto&, std::string& error) { error = "rejected"; return false; }));
    CHECK(editor.current() == before); CHECK(editor.changed());
    gameframework::BuildingAsset published;
    CHECK(editor.apply([&](const auto& asset, std::string&) { published = asset; return true; }));
    CHECK(published == before); CHECK(editor.changed());
    CHECK(!editor.command("variant.delete"));
}

TEST(building_editor_save_uses_original_load_stamp_and_export_never_overwrites)
{
    te::test::Directory directory;
    auto path = directory.file("asset.json"), exported = directory.file("export.json");
    write(path, sample());
    engine::BuildingEditor editor(sample(), path);
    CHECK(editor.command("property", "wall=42"));
    auto external = sample(); external.name = "External change"; write(path, external);
    CHECK(!editor.save()); CHECK(editor.changed());
    CHECK(!editor.save(directory.path / "." / "asset.json"));
    auto disk = te::io::load(path); CHECK(disk);
    gameframework::BuildingAsset decoded; std::string error;
    CHECK(gameframework::decodeBuildingAsset(disk.value.text, decoded, error)); CHECK(decoded == external);
    CHECK(editor.exportTo(exported)); CHECK(editor.changed());
    CHECK(!editor.exportTo(exported));
    CHECK(!editor.exportTo(path));
    CHECK(editor.save(directory.file("saved-as.json"))); CHECK(!editor.changed());
}

TEST(building_editor_mismatched_constructor_snapshot_cannot_overwrite_disk)
{
    te::test::Directory directory; auto path = directory.file("asset.json");
    auto external = sample(); external.name = "External change"; write(path, external);
    engine::BuildingEditor editor(sample(), path);
    CHECK(editor.command("property", "wall=42")); CHECK(!editor.save());
    CHECK(!editor.load(path)); CHECK(editor.pendingDiscard());
    CHECK(editor.command("keep")); CHECK(editor.current().name == "Example building");
    CHECK(!editor.load(path)); CHECK(editor.command("discard"));
    CHECK(editor.current() == external);
    CHECK(editor.command("property", "wall=42")); CHECK(editor.save());
}

TEST(building_editor_invalid_open_and_dirty_switch_keep_document_until_discard)
{
    te::test::Directory directory; auto path = directory.file("asset.json");
    auto other = sample(); other.id = "another-building"; other.name = "Other"; write(path, other);
    engine::BuildingEditor editor(sample());
    CHECK(editor.command("property", "wall=42"));
    auto draft = editor.current();
    { std::ofstream invalid(directory.file("bad.json")); invalid << "{}"; }
    CHECK(!editor.load(directory.file("bad.json"))); CHECK(editor.current() == draft); CHECK(!editor.pendingDiscard());
    CHECK(!editor.load(path)); CHECK(editor.pendingDiscard()); CHECK(editor.current() == draft);
    CHECK(editor.command("discard")); CHECK(editor.current() == other); CHECK(!editor.changed());
    CHECK(editor.command("property", "wall=35"));
    CHECK(editor.command("close")); CHECK(editor.pendingDiscard()); CHECK(editor.command("keep"));
    CHECK(editor.current().variants[0].blocks[0].wall == 35);
}

TEST(building_editor_renders_standalone_at_responsive_sizes)
{
    te::test::Graphics graphics;
    engine::BuildingEditor editor(sample()); ui::Context context; auto theme = ui::Theme::dark(); theme.radius = 2;
    for (float width : {1280.f, 900.f, 640.f, 360.f}) {
        context.begin(theme, {0, 0, width, 768}, 0);
        editor.render(context, {0, 0, width, 768}, {}, [] {});
        context.end(); CHECK(context.scene() != nullptr);
    }
}

TEST(building_editor_catalog_switch_preserves_accepted_and_saved_revisions)
{
    te::test::Directory directory; auto aPath = directory.file("a.json"), bPath = directory.file("b.json");
    auto a = sample(), b = sample(); b.id = "another-building"; b.name = "Other";
    write(aPath, a); write(bPath, b);
    engine::BuildingEditor editor(a, aPath); editor.setChoices({{a, aPath}, {b, bPath}});
    CHECK(editor.command("property", "wall=42"));
    CHECK(editor.apply({})); CHECK(editor.save());
    CHECK(editor.command("asset.choice", "1")); CHECK(editor.current().id == b.id);
    CHECK(editor.command("asset.choice", "0")); CHECK(editor.current().variants[0].blocks[0].wall == 42);
    CHECK(editor.command("property", "wall=48")); CHECK(editor.save());
    CHECK(!editor.command("asset.choice", "1")); CHECK(editor.pendingDiscard());
    CHECK(editor.command("discard")); CHECK(editor.command("asset.choice", "0"));
    CHECK(editor.current().variants[0].blocks[0].wall == 48);
    CHECK(editor.document().accepted->variants[0].blocks[0].wall == 42);
    CHECK(editor.document().source->asset.variants[0].blocks[0].wall == 48);
}

TEST(building_editor_flushes_text_before_actions_and_preserves_invalid_buffers)
{
    te::test::Graphics graphics; te::test::Directory directory;
    auto path = directory.file("buffered.json"); write(path, sample());
    engine::BuildingEditor editor(sample(), path); ui::Context context; auto theme = ui::Theme::dark();
    auto render = [&] { context.begin(theme, {0, 0, 1280, 800}, 0); editor.render(context, {0, 0, 1280, 800}, {}, [] {}); context.end(); };
    auto type = [&](const char* field, const char* text) { context.focus(std::string("building/field/") + field); context.key(ui::Key::Home); render(); for (int i = 0; i < 40; ++i) context.key(ui::Key::Delete); context.textInput(text); };
    render(); type("name", "Saved without Enter");
    CHECK(editor.save()); CHECK(editor.current().name == "Saved without Enter");
    render(); type("wall", "999");
    CHECK(!editor.apply({})); CHECK(editor.current().variants[0].blocks[0].wall == 28);
    render(); context.key(ui::Key::Backspace);
    CHECK(editor.apply({})); CHECK(editor.current().variants[0].blocks[0].wall == 99);
    render(); type("name", "Close without Enter");
    CHECK(editor.command("close")); CHECK(editor.pendingDiscard());
    CHECK(editor.command("keep")); CHECK(editor.current().name == "Close without Enter");
}

TEST(building_editor_reopened_applied_document_retains_original_stamp_and_saved_state)
{
    te::test::Directory directory; auto path = directory.file("asset.json"); write(path, sample());
    engine::BuildingEditor editor(sample(), path);
    CHECK(editor.command("property", "wall=42")); CHECK(editor.apply({}));
    auto retained = editor.document();
    CHECK(retained.source->asset == sample()); CHECK(retained.accepted->variants[0].blocks[0].wall == 42);
    engine::BuildingEditor reopened(retained); CHECK(reopened.changed()); CHECK(reopened.save());
    CHECK(reopened.command("property", "wall=48")); CHECK(reopened.apply({}));
    retained = reopened.document();
    auto external = sample(); external.name = "External"; write(path, external);
    engine::BuildingEditor conflicted(retained); CHECK(!conflicted.save());
    CHECK(conflicted.current().variants[0].blocks[0].wall == 48);
}

TEST(building_editor_rejects_invalid_public_accepted_snapshot)
{
    auto invalid = sample(); invalid.variants.clear();
    bool rejected = false;
    try { engine::BuildingEditor editor(engine::BuildingEditorEntry{sample(), {}, {}, invalid}); }
    catch (const std::invalid_argument&) { rejected = true; }
    CHECK(rejected);
}

TEST(building_editor_same_id_files_keep_separate_save_baselines)
{
    te::test::Directory directory; auto first = directory.file("first.json"), second = directory.file("second.json");
    auto a = sample(), b = sample(); b.name = "Second file"; write(first, a); write(second, b);
    engine::BuildingEditor editor(a, first); editor.setChoices({{a, first}, {b, second}});
    CHECK(editor.command("property", "wall=42")); CHECK(editor.save());
    CHECK(!editor.command("asset.choice", "1")); CHECK(editor.command("discard"));
    CHECK(editor.current().name == "Second file"); CHECK(editor.current().variants[0].blocks[0].wall == 28);
    CHECK(editor.document().path == second);
    CHECK(editor.command("property", "wall=46")); CHECK(editor.save());
    auto source = te::io::load(first); gameframework::BuildingAsset decoded; std::string error;
    CHECK(source); CHECK(gameframework::decodeBuildingAsset(source.value.text, decoded, error));
    CHECK(decoded.variants[0].blocks[0].wall == 42);
}

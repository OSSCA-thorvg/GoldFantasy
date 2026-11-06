#include <test/test.h>
#include <test/graphics.h>
#include <test/directory.h>
#include <fstream>
#include <game/game_app.h>
#include <game/building_assets.h>

using namespace hearthold;

TEST(building_studio_pauses_world_and_isolates_pointer_camera_and_other_editors)
{
    te::test::Graphics graphics;
    GameApp game(5); game.render(1280, 800, 0);
    double clock = game.state().clock(); auto camera = game.view();
    game.setPan(1, 1);
    CHECK(game.openBuildingEditor());
    CHECK(game.buildingEditor() != nullptr);
    CHECK(game.buildingEditor()->current().id == "cottage");
    game.render(1280, 800, 100);
    game.wheel(500, 300, 2);
    game.pointerDown(500, 300, PointerButton::Secondary);
    game.pointerMove(700, 500); game.pointerUp(700, 500, PointerButton::Secondary);
    game.openMapEditor(); game.openCharacterEditor();
    CHECK(game.mapEditor() == nullptr); CHECK(game.characterEditor() == nullptr);
    game.render(1280, 800, 200);
    CHECK(game.state().clock() == clock);
    CHECK(game.view().x == camera.x); CHECK(game.view().y == camera.y); CHECK(game.view().zoom == camera.zoom);
    CHECK(game.buildingCommand("asset.choice", std::to_string(int(Structure::Castle))));
    CHECK(game.buildingEditor()->current().id == "castle");
    CHECK(game.buildingCommand("close"));
    game.render(1280, 800, 201); game.render(1280, 800, 202);
    CHECK(game.buildingEditor() == nullptr); CHECK(game.state().clock() == clock);
}

TEST(building_studio_dirty_close_and_invalid_file_keep_draft_without_publishing)
{
    te::test::Graphics graphics;
    GameApp game(5); CHECK(game.openBuildingEditor());
    auto revision = buildingAppearanceRevision(Structure::Cottage);
    CHECK(game.buildingCommand("property", "name=Edited cottage"));
    CHECK(game.buildingCommand("close")); CHECK(game.buildingEditor()->pendingDiscard());
    CHECK(game.buildingCommand("keep"));
    CHECK(game.buildingEditor()->current().name == "Edited cottage");
    CHECK(!game.openBuildingEditor("/no-such-building-asset.json"));
    CHECK(game.buildingEditor()->current().name == "Edited cottage");
    CHECK(buildingAppearanceRevision(Structure::Cottage) == revision);
    CHECK(game.buildingCommand("close")); CHECK(game.buildingCommand("discard"));
    game.render(1280, 800, 0); game.render(1280, 800, 1);
    CHECK(game.buildingEditor() == nullptr);
    CHECK(buildingAppearanceRevision(Structure::Cottage) == revision);
}

TEST(building_studio_apply_close_reopen_keeps_disk_baseline_and_external_conflicts)
{
    te::test::Graphics graphics; te::test::Directory directory;
    struct Restore { ~Restore() { std::string error; loadDefaultBuildingAssets({}, error); } } restore;
    std::string error; CHECK(loadDefaultBuildingAssets({}, error));
    for (int i = 0; i < int(Structure::Count); ++i) {
        auto asset = buildingAsset(Structure(i)); std::ofstream file(directory.path / (asset.id + ".json")); file << gameframework::encodeBuildingAsset(asset);
    }
    CHECK(loadBuildingAssets(directory.path, error));
    GameApp game(5); CHECK(game.openBuildingEditor());
    game.render(1280, 800, 0);
    CHECK(game.buildingCommand("property", "name=Applied cottage"));
    CHECK(game.buildingCommand("apply"));
    CHECK(game.buildingCommand("close")); CHECK(game.buildingCommand("discard"));
    game.render(1280, 800, 0); game.render(1280, 800, 1);
    CHECK(game.openBuildingEditor()); CHECK(game.buildingEditor()->changed());
    CHECK(game.buildingEditor()->save());
    CHECK(buildingAssetFile(Structure::Cottage).asset.name == "Applied cottage");
    auto otherPath = directory.path / "opened-cottage.json";
    auto opened = buildingAsset(Structure::Cottage); opened.name = "Opened cottage";
    { std::ofstream file(otherPath); file << gameframework::encodeBuildingAsset(opened); }
    CHECK(game.openBuildingEditor(otherPath)); game.render(1280, 800, 1.1);
    CHECK(game.buildingCommand("apply"));
    CHECK(buildingAssetFile(Structure::Cottage).path == otherPath);
    CHECK(game.buildingCommand("property", "name=Applied again"));
    CHECK(game.buildingCommand("apply"));
    CHECK(game.buildingCommand("close")); CHECK(game.buildingCommand("discard"));
    game.render(1280, 800, 2); game.render(1280, 800, 3);
    auto external = buildingAsset(Structure::Cottage); external.name = "External change";
    { std::ofstream file(otherPath); file << gameframework::encodeBuildingAsset(external); }
    CHECK(game.openBuildingEditor()); CHECK(!game.buildingEditor()->save());
    CHECK(game.buildingEditor()->current().name == "Applied again");
    CHECK(buildingAsset(Structure::Cottage).name == "Applied again");
}

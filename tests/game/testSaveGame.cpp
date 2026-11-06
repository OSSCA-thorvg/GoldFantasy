#include <test/test.h>
#include <test/graphics.h>
#include <test/directory.h>
#include <game/town.h>
#include <game/map_document.h>
#include <game/application.h>
#include <ui/render.h>
#include <core/io/path.h>
#include <fstream>

namespace
{
hearthold::Town settlement()
{
    using namespace hearthold;
    MapDocument document(WorldMap::generate(5, 64, 64));
    auto camp = document.map().camp();
    document.beginStroke(); document.paint(camp, 14, Terrain::Grass); document.endStroke();
    Town town{document.gameMap()}; town.scout(camp.x, camp.y, 15);
    CHECK(town.place(Structure::Camp, camp, 0)); town.completeConstruction();
    CHECK(town.buildRoad({RoadAnchor::sharp(camp + Point{1.2f, 0}), RoadAnchor::sharp(camp + Point{8, 0})}));
    town.completeConstruction();
    auto spot = town.fit(Structure::Tent, camp + Point{4, -1.4f}, 0);
    CHECK(town.place(Structure::Tent, spot.center, spot.angle));
    town.orderMove({town.people().front().id}, camp + Point{5, 3});
    return town;
}
}

TEST(game_save_roundtrip_preserves_world_settlement_people_and_orders)
{
    te::test::Directory temp;
    auto town = settlement();
    std::string error;
    CHECK(town.saveGame(temp.file("save.goldfantasy"), error)); CHECK(error.empty());
    auto loaded = hearthold::Town::loadGame(temp.file("save.goldfantasy"), error);
    CHECK(loaded.has_value()); if (!loaded) { CHECK(error.empty()); return; }
    CHECK_EQ(loaded->clock(), town.clock()); CHECK_EQ(loaded->gold(), town.gold());
    CHECK_EQ(loaded->buildings().size(), town.buildings().size());
    CHECK_EQ(loaded->roads().roads().size(), town.roads().roads().size());
    CHECK_EQ(loaded->buildings().back().progress, town.buildings().back().progress);
    CHECK_EQ(loaded->people().size(), town.people().size());
    const auto& before = town.people().front(); const auto& after = loaded->people().front();
    CHECK_EQ(after.name, before.name); CHECK_EQ(after.home, before.home); CHECK_EQ(after.job, before.job);
    CHECK(after.task == before.task); CHECK(after.path == before.path); CHECK(after.position == before.position);
    CHECK(after.customLook.has_value()); CHECK_EQ(after.customLook->faceAsset, before.customLook->faceAsset);
    CHECK_EQ(loaded->map().sights().size(), town.map().sights().size());
    loaded->advance(1); town.advance(1);
    CHECK_EQ(loaded->clock(), town.clock()); CHECK_EQ(loaded->gold(), town.gold());
    CHECK(loaded->people().front().position == town.people().front().position);
    CHECK(loaded->saveGame(temp.file("save.goldfantasy"), error));
    CHECK(hearthold::Town::loadGame(temp.file("save.goldfantasy"), error).has_value());
}

TEST(game_save_rejects_corruption_without_replacing_live_world)
{
    te::test::Directory temp; auto town = settlement(); std::string error;
    auto path = temp.file("save.goldfantasy"); CHECK(town.saveGame(path, error));
    std::ofstream corrupt(path, std::ios::trunc); corrupt << "GoldFantasy-save\n00"; corrupt.close();
    CHECK(!hearthold::Town::loadGame(path, error)); CHECK(!error.empty());
    CHECK_EQ(town.buildings().size(), size_t(2));
}

TEST(game_title_scene_starts_saves_continues_and_keeps_editors_separate)
{
    te::test::Graphics graphics; te::test::Directory temp;
    hearthold::LaunchOptions options; options.titleScreen = true; options.saveFile = te::io::pathToUtf8(temp.file("continue.goldfantasy"));
    auto app = hearthold::createApplication(options);
    app->render(1280, 800, 0); CHECK(app->command("scene.is-title"));
    CHECK(app->command("scene.new")); app->render(1280, 800, 1); CHECK(app->command("scene.is-game"));
    CHECK(app->property("world.hour", 13.25));
    CHECK(app->command("session.save")); CHECK(std::filesystem::exists(temp.file("continue.goldfantasy")));
    CHECK(app->command("scene.title")); app->render(1280, 800, 2); CHECK(app->command("scene.is-title"));
#if HEARTHOLD_WITH_EDITOR
    CHECK(app->command("edit.character")); app->render(1280, 800, 3); CHECK(app->command("session.authoring"));
    CHECK(app->command("scene.title")); app->render(1280, 800, 4);
    CHECK(app->command("edit.map")); app->render(1280, 800, 5); CHECK(app->command("session.authoring"));
    CHECK(app->command("scene.title")); app->render(1280, 800, 6);
#endif
    app.reset(); app = hearthold::createApplication(options); app->render(1280, 800, 7);
    CHECK(app->command("scene.continue")); app->render(1280, 800, 8); CHECK(app->command("scene.is-game"));
    for (auto property : app->properties()) if (property.id == "world.hour") CHECK_EQ(property.value, 13.25);
}

TEST(game_title_scene_can_render_without_opening_a_window)
{
    te::test::Graphics graphics;
    hearthold::LaunchOptions options; options.titleScreen = true;
    auto app = hearthold::createApplication(options); app->render(1280, 800, 0);
    ui::Renderer renderer(ui::RenderBackend::Cpu); std::vector<uint32_t> pixels(1280 * 800);
    CHECK(renderer.target(pixels, 1280, 800)); CHECK(renderer.attach(app->scene()));
    CHECK(renderer.draw()); CHECK(renderer.sync());
    // Optional export used for visual verification; no desktop surfaces are opened.
    if (const char* output = std::getenv("GOLDFANTASY_TITLE_CAPTURE")) {
        std::ofstream image(output, std::ios::binary); image << "P6\n1280 800\n255\n";
        for (uint32_t pixel : pixels) { char rgb[] = {char(pixel >> 16), char(pixel >> 8), char(pixel)}; image.write(rgb, 3); }
    }
}

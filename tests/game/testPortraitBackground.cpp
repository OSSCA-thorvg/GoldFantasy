#include <test/test.h>
#include <test/graphics.h>
#include <game/game_app.h>
#include <game/character_preset.h>
#include <game/person_portrait.h>
#include <game/character_assets.h>
#include <game/terrain_painter.h>
#include <array>
#include <memory>

namespace
{
using namespace hearthold;

std::vector<uint32_t> raster(tvg::Paint* paint, int width = 320, int height = 320)
{
    std::vector<uint32_t> pixels(size_t(width) * height);
    std::unique_ptr<tvg::SwCanvas> canvas(tvg::SwCanvas::gen());
    CHECK(canvas->target(pixels.data(), width, width, height, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
    CHECK(canvas->add(paint) == tvg::Result::Success);
    CHECK(canvas->draw(true) == tvg::Result::Success);
    CHECK(canvas->sync() == tvg::Result::Success);
    return pixels;
}

std::vector<uint32_t> crop(tvg::Paint* paint, ui::Rect r)
{
    auto pixels = raster(paint, 1280, 800);
    std::vector<uint32_t> result;
    for (int y = int(r.y); y < int(r.y + r.h); ++y)
        for (int x = int(r.x); x < int(r.x + r.w); ++x) result.push_back(pixels[size_t(y) * 1280 + x]);
    return result;
}

Point terrainPoint(const WorldMap& map, Terrain terrain)
{
    for (int y = 0; y < map.height(); ++y) for (int x = 0; x < map.width(); ++x) {
        Point p{x + .5f, y + .5f};
        if (map.terrainAt(p) == terrain) return p;
    }
    CHECK(false);
    return {};
}
}  // namespace

TEST(game_portrait_background_samples_the_map_and_follows_snow_and_night)
{
    auto map = WorldMap::generate(5);
    for (auto terrain : {Terrain::Grass, Terrain::Forest, Terrain::Sand, Terrain::Frost, Terrain::Ash, Terrain::Sea}) {
        auto at = terrainPoint(map, terrain);
        auto background = portraitBackdrop(map, at, {});
        auto expected = groundColor(terrain, map.cell(at)->shade, {});
        CHECK(ui::paintKey(background.ground) == ui::paintKey(expected));
    }
    auto grass = terrainPoint(map, Terrain::Grass);
    auto day = portraitBackdrop(map, grass, {});
    Climate winter; winter.snow = 1;
    auto snowy = portraitBackdrop(map, grass, winter);
    CHECK(snowy.ground.b > day.ground.b);
    Climate night; night.night = 1;
    auto dark = portraitBackdrop(map, grass, night);
    CHECK(dark.ground.g < day.ground.g);
    // A shoulder sample can extend beyond a coast or the map boundary safely.
    auto sea = portraitBackdrop(map, {-2, -2}, {});
    CHECK(ui::paintKey(sea.ground) == ui::paintKey(groundColor(Terrain::Sea, 1, {})));
}

TEST(game_portrait_background_changes_every_terrain_without_recolouring_the_head)
{
    te::test::Graphics runtime;
    Person owner{7, "Rowan", Role::Resident, Calling::Mage, Race::Human, 4242, {}, {}};
    std::vector<uint32_t> head, previous;
    for (int i = 0; i < terrainCount; ++i) {
        auto portrait = personPortrait(owner, Mood::Content, 320, 320, portraitBackdrop(Terrain(i)));
        auto face = characterHead(appearanceOf(owner));
        face->scale(12); face->translate(160, 160);
        auto currentHead = raster(face);
        if (i) CHECK(head == currentHead);
        head = std::move(currentHead);
        auto current = raster(portrait);
        if (i) CHECK(previous != current);
        // Away from the character, terrain fills the card instead of a white paper panel.
        auto corner = current[16 * 320 + 16];
        CHECK((corner >> 24) == 255);
        CHECK((corner & 0xffffffu) != 0xf4f0e5u);
        previous = std::move(current);
    }
}

TEST(game_portrait_background_refreshes_cached_single_and_group_cards_when_a_unit_moves)
{
    te::test::Graphics runtime;
    GameApp game(5); game.togglePause();
    int id = game.state().people().front().id;
    auto& owner = const_cast<Person&>(*game.state().person(id));
    auto first = terrainPoint(game.state().map(), Terrain::Grass);
    auto second = terrainPoint(game.state().map(), Terrain::Sand);
    auto appearance = encodeCharacter(characterPreset(owner));
    double wall = 0;
    auto frame = [&] { game.render(1280, 800, wall); };
    for (bool group : {false, true}) {
        game.selectPeople(group ? std::vector<int>{id, game.state().people().back().id} : std::vector<int>{id});
        owner.position = first; frame(); wall += .5; frame();
        // The unit card now lives in the responsive context dock. Sample its
        // actual portrait corner after the dock transition has settled.
        auto panel = game.contextPanelBounds();
        ui::Rect corner{panel.x + 17, panel.y + (group ? 43 : 17), 6, 6};
        auto green = crop(game.hudScene()->duplicate(), corner);
        frame();
        CHECK(green == crop(game.hudScene()->duplicate(), corner));
        owner.position = second; frame();
        CHECK(green != crop(game.hudScene()->duplicate(), corner));
        owner.position = first; frame();
        CHECK(green == crop(game.hudScene()->duplicate(), corner));
    }
    CHECK_EQ(encodeCharacter(characterPreset(owner)), appearance);
#if HEARTHOLD_WITH_EDITOR
    game.openCharacterEditor();
    owner.position = first; frame();
    // Actual Character Studio bounds, outside the face and inside the portrait crop.
    ui::Rect studioCorner{196, 174, 12, 12};
    auto green = crop(game.hudScene()->duplicate(), studioCorner);
    owner.position = second; frame();
    CHECK(green != crop(game.hudScene()->duplicate(), studioCorner));
    CHECK_EQ(encodeCharacter(game.characterEditor()->current()), appearance);
#endif
}

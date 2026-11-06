#include "common/hud_text.h"
#include "common/legacy_map.h"
#include <test/test.h>
#include <test/graphics.h>
#include <game/ymir_born.h>
#include <game/map_document.h>
#include <test/directory.h>
#include <game/game_app.h>
#include <game/town.h>
#include <fstream>
#include <iterator>
#include <set>
#include <string>
#include <utility>

namespace
{
using namespace hearthold;
}

TEST(game_only_askr_and_embla_start_the_settlement)
{
    Town town(5);
    const char* names[] = {"Askr", "Embla"};
    const char* pasts[] = {"Born under Ymir's left arm", "Woke under Ymir's arm beside Askr"};
    CHECK_EQ(town.population(), 2);
    CHECK_EQ(town.people().size(), size_t(2));
    if (town.people().size() != 2) return;
    for (size_t i = 0; i < 2; ++i) {
        const auto& p = town.people()[i];
        CHECK_EQ(p.name, std::string(names[i]));
        CHECK_EQ(p.past, std::string(pasts[i]));
        CHECK(p.race == Race::Human);
        CHECK(p.calling == Calling::Settler);
        CHECK(p.role == Role::Resident);
        CHECK(distance(p.position, town.map().camp()) < 1.5f);  // Gathered at his feet.
    }
    CHECK(appearanceOf(town.people()[0]).bodyType == BodyType::Male);
    CHECK(appearanceOf(town.people()[1]).bodyType == BodyType::Female);
}

TEST(game_the_founding_notice_tells_of_ymir)
{
    Town town(5);
    CHECK_EQ(town.takeNotice(), std::string("Askr and Embla wake at Ymir's feet, born of the giant's stone"));
    Town empty(WorldMap::generate(5), false);
    CHECK_EQ(empty.takeNotice(), std::string());
}

TEST(game_people_who_come_later_have_no_birth_told)
{
    Town town(5);
    town.recruit(Role::Resident, Calling::Settler, 3);
    CHECK_EQ(town.people().size(), size_t(5));
    for (size_t i = 2; i < town.people().size(); ++i) CHECK(town.people()[i].past.empty());
}

TEST(game_seed_five_rolls_the_same_founders_and_recruits)
{
    // Golden values: the founders take the dice exactly as random settlers did before them.
    Town town(5);
    const uint32_t looks[] = {499096, 899504, 834509, 80202};
    CHECK_EQ(town.people().size(), size_t(2));
    for (size_t i = 0; i < town.people().size() && i < 2; ++i) CHECK_EQ(town.people()[i].look, looks[i]);
    town.recruit(Role::Resident, Calling::Settler, 2);
    CHECK_EQ(town.people().size(), size_t(4));
    for (size_t i = 2; i < town.people().size() && i < 4; ++i) CHECK_EQ(town.people()[i].look, looks[i]);
}

TEST(game_hud_shows_the_realm_and_the_founders_past)
{
    te::test::Graphics graphics;
    for (auto [width, height] : {std::pair{1280.f, 800.f}, std::pair{960.f, 600.f}}) {
        GameApp game(5);
        game.selectPeople({game.state().people().front().id});
        game.render(width, height, 0);
        game.render(width, height, .1);
        auto renown = test::textBounds(game.hudScene(), "Midgard  -  Renown 50 / 100");
        auto past = test::textBounds(game.hudScene(), "Born under Ymir's left arm");
        auto commands = test::textBounds(game.hudScene(), "Move  M");
        CHECK_EQ(renown.size(), size_t(1));
        CHECK_EQ(past.size(), size_t(1));
        CHECK(!commands.empty());
        if (renown.empty() || past.empty() || commands.empty()) continue;
        CHECK(renown[0].x + renown[0].w <= 16 + 420);  // Inside the realm panel.
        CHECK(past[0].y + past[0].h <= commands[0].y);  // Clear of the command buttons.
    }
}

TEST(game_hud_names_midgard_on_any_map)
{
    te::test::Graphics graphics;
    // A map file from before the regions: version 1, which knows nothing of them or of Ymir. It is Midgard all the same.
    MapDocument doc(WorldMap::generate(5, 64, 64));
    te::test::Directory directory;
    auto path = directory.file("old.hearthmap");
    std::string error;
    CHECK(doc.save(path, error));
    std::string text;
    {
        std::ifstream in(path);
        text.assign(std::istreambuf_iterator<char>(in), {});
    }
    test::removeStoneColumn(text);
    auto second = text.find('\n') + 1, end = text.find('\n', second);
    for (int i = 0; i < 3; ++i) {
        auto field = text.rfind(' ', end);
        text.erase(field, end - field);
        end = field;
    }
    text.replace(0, std::string("hearthold-map 3").size(), "hearthold-map 1");
    std::ofstream(path, std::ios::trunc) << text;
    GameApp game(5);
    CHECK(game.loadMapFile(path, error));
    game.render(1280, 800, 0);
    game.render(1280, 800, .1);
    CHECK_EQ(test::textBounds(game.hudScene(), "Midgard  -  Renown 50 / 100").size(), size_t(1));
}

TEST(game_dungeon_names_follow_the_worlds_they_lead_to)
{
    const std::set<std::string> names[] = {
        {"Tower of Ravens", "The Broken Hall", "Bifrost's Foot", "Valgrind"},
        {"The Green Door", "The Vanir Well", "The Golden Glade", "Njord's Gate"},
        {"The Bright Gate", "Freyr's Glade", "The Elfhame Door", "Glimmering Rift"},
        {"Ironwood Den", "Wargmaw", "The Howling Cleft", "Greyfang Hollow"},
        {"Dvalin's Door", "The Deep Delving", "Brokk's Stair", "The Forge Below"},
        {"The Mist Gate", "Rime Rift", "The Frozen Throat", "The Weeping Gate"},
        {"Surt's Door", "The Burning Hall", "The Ember Gate", "The Cinder Rift"},
        {"Barrow of Kings", "The Drowned Howe", "Draugmound", "Gjallar Crossing"},
    };
    int checked = 0;
    for (uint32_t seed : {3u, 5u, 11u}) {
        auto map = WorldMap::generate(seed);
        for (const auto& site : map.dungeons()) {
            CHECK_EQ(names[int(map.destination(site))].count(site.name), size_t(1));
            ++checked;
        }
    }
    CHECK(checked > 0);
}

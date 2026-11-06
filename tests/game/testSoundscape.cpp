#include <test/test.h>
#include <test/graphics.h>
#include <game/game_app.h>
#include <game/map_document.h>
#include <game/person_look.h>
#include <game/character_assets.h>
#include <game/music_director.h>
#include <game/thunderstorm.h>
#include <game/town.h>
#include <game/traffic.h>
#include <game/world_renderer.h>
#include <algorithm>
#include <map>
#include <memory>
#include <set>
#include <string>
#include <vector>

using namespace hearthold;

TEST(game_music_plays_now_and_then_at_the_turns_of_the_day)
{
    // Daybreak, nightfall and a building finished each may bring a track for the moment;
    // never two at once, and a long quiet after each.
    MusicDirector director(5);
    CHECK(director.moment(Moment::Dawn, 0).empty());  // Not before the game has had a moment's quiet.
    std::string first;
    double at = 40;
    for (; at < 400 && first.empty(); at += 37) first = std::string(director.moment(Moment::Dawn, at));
    CHECK(first.starts_with("music/dawn/"));
    CHECK(director.playing(at));
    CHECK(director.moment(Moment::Dusk, at + 10).empty());  // Still playing.
    CHECK(director.moment(Moment::Build, at + 80).empty());   // Then resting.
    // Over a long game the music keeps to well under half the time, and each moment draws its own tracks.
    MusicDirector longer(9);
    double heard = 0;
    std::map<std::string, std::set<std::string>> tracks;
    for (double t = 60; t < 6 * 3600; t += 45) {
        auto moment = Moment(int(t / 45) % 4 == 2 ? int(Moment::Build) : int(t / 45) % 2 ? int(Moment::Dusk) : int(Moment::Dawn));
        auto track = std::string(longer.moment(moment, t));
        if (track.empty()) continue;
        heard += 72;
        tracks[track.substr(0, track.find('/', 6))].insert(track);
    }
    CHECK(heard / (6 * 3600) < .4);
    CHECK(heard / (6 * 3600) > .1);
    CHECK(tracks["music/dawn"].size() >= 3);
    CHECK(tracks["music/dusk"].size() >= 3);
    CHECK(tracks["music/build"].size() >= 2);
}

TEST(game_battle_music_is_disabled_without_interrupting_other_music)
{
    MusicDirector director(3);
    std::string calm; double at = 40;
    for (; calm.empty() && at < 2000; at += 13) calm = std::string(director.moment(Moment::Dawn, at));
    CHECK(!calm.empty());
    for (double t = at; t < 2000; t += 30) CHECK(director.moment(Moment::Battle, t).empty());
}

TEST(game_raids_do_not_start_the_war_horn_or_battle_music)
{
    te::test::Graphics graphics; GameApp game(5); auto& town = game.state(); auto at = town.map().camp();
    CHECK(town.place(Structure::Camp, at, 0)); town.completeConstruction(); game.render(1280, 800, 0); game.takeCues();
    town.summonRaid(); CHECK(town.raiding()); game.render(1280, 800, .1);
    auto cues = game.takeCues();
    CHECK(std::none_of(cues.begin(), cues.end(), [](const Sound& cue) { return cue.cue == Cue::Alarm || cue.cue == Cue::Music; }));
}

TEST(game_lightning_strikes_now_and_then_in_wet_weather)
{
    // Never in fair weather; in a storm about every half minute, often near; in rain rarely, and mostly far off,
    // heard seconds after the flash.
    auto count = [](Weather weather, float intensity, uint32_t seed) {
        Thunderstorm sky(seed);
        std::map<Strike::Reach, int> reaches;
        int strikes = 0;
        double lastAt = -1;
        bool ordered = true;
        for (double t = 0; t < 3600; t += .1) {
            auto strike = sky.update(t, weather, intensity);
            if (!strike) continue;
            ++strikes;
            ++reaches[strike->reach];
            ordered = ordered && strike->at > lastAt && strike->brightness > 0 && strike->brightness <= 1;
            lastAt = strike->at;
            if (strike->reach == Strike::Reach::Far) CHECK(strike->delay > 2.5f);
            if (strike->reach == Strike::Reach::Overhead) CHECK(strike->delay < .2f);
            bool inView = strike->across >= 0 && strike->across <= 1;
            if (strike->reach == Strike::Reach::Overhead || strike->reach == Strike::Reach::Near) CHECK(inView);
            if (strike->reach == Strike::Reach::Far) CHECK(!inView);
        }
        CHECK(ordered);
        return std::pair{strikes, reaches};
    };
    CHECK_EQ(count(Weather::Clear, 0, 1).first, 0);
    CHECK_EQ(count(Weather::Snow, 1, 1).first, 0);
    auto [storm, stormReach] = count(Weather::Storm, 1, 2);
    CHECK(storm > 70);
    CHECK(storm < 260);
    CHECK(stormReach[Strike::Reach::Near] + stormReach[Strike::Reach::Overhead] > 10);
    auto [rain, rainReach] = count(Weather::Rain, .7f, 3);
    CHECK(rain > 15);
    CHECK(rain < storm / 2);
    CHECK(rainReach[Strike::Reach::Far] > rain / 2);
    CHECK_EQ(rainReach[Strike::Reach::Overhead], 0);
}

namespace
{
// A daylit view of the founders' camp, drawn by one canvas frame after frame.
struct View
{
    static constexpr int width = 320, height = 240;
    std::vector<uint32_t> pixels = std::vector<uint32_t>(width * height);
    std::unique_ptr<tvg::SwCanvas> canvas{tvg::SwCanvas::gen()};
    explicit View(WorldRenderer& renderer)
    {
        CHECK(canvas->target(pixels.data(), width, width, height, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
        CHECK(canvas->add(renderer.scene()) == tvg::Result::Success);
    }
    std::vector<uint32_t> frame(WorldRenderer& renderer, const Town& town, const Traffic& traffic, double seconds)
    {
        auto at = project(town.map().camp().x, town.map().camp().y);
        CHECK(canvas->sync() == tvg::Result::Success);
        renderer.update(town, traffic, {at.x, at.y, 1}, width, height, seconds, {});
        CHECK(canvas->update() == tvg::Result::Success);
        CHECK(canvas->draw(true) == tvg::Result::Success);
        CHECK(canvas->sync() == tvg::Result::Success);
        return pixels;
    }
};

float brightness(const std::vector<uint32_t>& pixels, int x0, int x1)
{
    double sum = 0;
    int count = 0;
    for (size_t i = 0; i < pixels.size(); ++i) {
        int x = int(i % 320);
        if (x < x0 || x >= x1) continue;
        auto p = pixels[i];
        sum += .3 * double(p >> 16 & 255) + .59 * double(p >> 8 & 255) + .11 * double(p & 255);
        ++count;
    }
    return float(sum / std::max(1, count));
}

int white(const std::vector<uint32_t>& pixels)
{
    return int(std::count_if(pixels.begin(), pixels.end(), [](uint32_t p) { return std::min({p >> 16 & 255, p >> 8 & 255, p & 255}) > 238; }));
}
}  // namespace

TEST(game_lightning_lights_the_land_and_a_near_bolt_comes_down)
{
    te::test::Graphics graphics(false);
    Town town(WorldMap::generate(5));
    Traffic traffic(5);
    traffic.update(town, 0);
    WorldRenderer renderer;
    View view(renderer);
    auto frame = [&](WorldRenderer& drawn, const Town& place, const Traffic& people, double seconds) { return view.frame(drawn, place, people, seconds); };
    frame(renderer, town, traffic, 1);
    auto before = frame(renderer, town, traffic, 1.95);
    // A near strike in the middle of the view: the land flashes and its bolt comes down from above.
    Strike near;
    near.reach = Strike::Reach::Near;
    near.at = 2;
    near.brightness = .8f;
    near.across = .5f;
    near.down = .6f;
    near.seed = 11;
    renderer.lightning(near);
    auto flash = frame(renderer, town, traffic, 2.02);
    CHECK(brightness(flash, 0, 320) > brightness(before, 0, 320) + 12);
    CHECK(white(flash) > white(before) + 40);
    auto after = frame(renderer, town, traffic, 3.5);
    CHECK(std::abs(brightness(after, 0, 320) - brightness(before, 0, 320)) < 3);
    // A far one beyond the left of the view lights that side more than the other, and shows no bolt.
    Strike far = near;
    far.reach = Strike::Reach::Far;
    far.at = 5;
    far.brightness = .5f;
    far.across = -.4f;
    renderer.lightning(far);
    auto distant = frame(renderer, town, traffic, 5.02), calm = frame(renderer, town, traffic, 7);
    CHECK(brightness(distant, 0, 100) - brightness(calm, 0, 100) > brightness(distant, 220, 320) - brightness(calm, 220, 320) + 3);
    CHECK(white(distant) <= white(calm) + 5);
}

TEST(game_notices_sound_like_what_they_tell)
{
    // Gold jingles, a settlement growing stacks its pieces, a newly found gate wakes like a runestone and an opened
    // one grinds like a stone door; anything else bubbles as notices do.
    CHECK(noticeCue("A monster is slain (+12 gold)") == Cue::Coins);
    CHECK(noticeCue("Eir bought their Cottage for 40 gold") == Cue::Coins);
    CHECK(noticeCue("Tent grew into a Cottage") == Cue::Growth);
    CHECK(noticeCue("Four townhouses merged into a manor") == Cue::Growth);
    CHECK(noticeCue("Discovered The Howling Cleft, a way to Jotunheim") == Cue::Discover);
    CHECK(noticeCue("The Howling Cleft is open to adventurers") == Cue::Unseal);
    CHECK(noticeCue("Harvest: +40 food") == Cue::Notice);
    CHECK(noticeCue("Goldwin settles down here") == Cue::Notice);
}

TEST(game_woodcutters_at_work_are_heard_without_being_picked_out)
{
    // An axe biting into a trunk near the middle of the view is heard though nobody is selected; picking the
    // woodcutter out makes it louder.
    te::test::Graphics graphics(false);
    MapDocument document(WorldMap::generate(5, 64, 64));
    auto camp = document.map().camp();
    document.beginStroke(); document.paint(camp, 12, Terrain::Grass); document.endStroke();
    auto lot = document.gameMap();
    for (int y = 0; y < lot.height(); ++y)
        for (int x = 0; x < lot.width(); ++x) lot.at(x, y).trees = lot.at(x, y).wild = 0;
    auto tree = camp + Point{3, 3};
    lot.at(int(tree.x), int(tree.y)).trees = 3;  // Work enough for both listens.
    GameApp game(5);
    game.state() = Town(std::move(lot));
    auto& town = game.state();
    town.scout(camp.x, camp.y, 14);
    CHECK(town.place(Structure::Camp, camp, 0));
    town.completeConstruction();
    town.advance(.01);
    int worker = town.people().front().id;
    for (const auto& person : town.people()) {
        auto& p = const_cast<Person&>(person);  // As the woodcutting tests do: hold everyone but the worker.
        p.path.clear(); p.inside = false; p.doorway = 0; p.food = p.rest = 1;
        p.activity = person.id == worker ? Activity::Idle : Activity::Holding;
        p.until = person.id == worker ? 0 : town.clock() + 1000;
        p.ordered = false; p.task = Activity::Idle;
    }
    auto at = project(tree.x, tree.y);
    game.view() = {at.x, at.y, 1.2f};
    auto listen = [&](std::vector<int> picked, double from) {
        game.selectPeople(std::move(picked));
        float loudest = 0;
        for (int frame = 0; frame < 120; ++frame) {
            game.render(640, 400, from + frame * .25);
            for (const auto& sound : game.takeCues())
                if (sound.cue == Cue::Chop) loudest = std::max(loudest, sound.gain);
        }
        return loudest;
    };
    float unpicked = listen({}, 0), picked = listen({worker}, 100);
    CHECK(unpicked > 0);
    CHECK(picked > unpicked);
}

TEST(game_the_hammers_knock_with_recorded_strikes)
{
    // The construction recording's three strikes are found where each begins, so a knock can play one of them.
    auto hammer = sounds::clip("sfx/hammer_", 0);
    auto strikes = onsets(hammer, .5f, .25);
    CHECK_EQ(strikes.size(), size_t(3));
    if (strikes.size() == 3) {
        CHECK(strikes[0] < .03);
        CHECK(std::abs(strikes[1] - .47) < .04);
        CHECK(std::abs(strikes[2] - .95) < .04);
    }
    CHECK(onsets({}, .5f, .25).empty());
}

TEST(game_people_keep_their_gendered_voice_with_independent_appearance_assets)
{
    // Appearance parts are sampled independently; the voice follows the chosen body.
    // The founders keep the myth's: Askr a man, Embla a woman.
    Town town(WorldMap::generate(5));
    town.recruit(Role::Resident, Calling::Settler, 40);
    int women = 0, men = 0;
    for (const auto& person : town.people()) {
        auto look = appearanceOf(person);
        CHECK(look.faceAsset < faceBaseCount); CHECK(look.hairAsset < hairAssetCount); CHECK(look.earAsset < earAssetCount);
        bool high = voiceKind(look.bodyType, person.look, person.id) >= VoiceKind::Maiden;
        CHECK(high == (look.bodyType == BodyType::Female));
        (look.bodyType == BodyType::Female ? women : men) += 1;
    }
    CHECK(women > 5);
    CHECK(men > 5);
    const auto& askr = town.people()[0];
    const auto& embla = town.people()[1];
    CHECK(askr.name == "Askr");
    CHECK(embla.name == "Embla");
    CHECK(appearanceOf(askr).bodyType == BodyType::Male);
    CHECK(headBody(appearanceOf(askr).hairAsset) == BodyType::Male);
    CHECK(appearanceOf(embla).bodyType == BodyType::Female);
    CHECK(headBody(appearanceOf(embla).hairAsset) == BodyType::Female);
    // Read by name, so the art can be reordered.
    CHECK(headBody(1) == BodyType::Female);  // Long waves.
    CHECK(headBody(7) == BodyType::Male);    // Spiky crop.
}

TEST(game_picking_a_building_taps_softly_and_letting_it_go_is_quiet)
{
    te::test::Graphics graphics(false);
    GameApp game(5);
    auto& town = game.state();
    auto camp = town.map().camp();
    CHECK(town.place(Structure::Camp, camp, 0));
    game.render(640, 400, 0);
    game.takeCues();
    game.selectBuilding(town.buildings().back().id);
    game.render(640, 400, .1);
    auto picked = game.takeCues();
    auto taps = std::count_if(picked.begin(), picked.end(), [](const Sound& sound) { return sound.cue == Cue::Open; });
    CHECK_EQ(taps, 1);
    for (const auto& sound : picked)
        if (sound.cue == Cue::Open) CHECK(sound.gain < .8f);
    game.selectPeople({});
    game.render(640, 400, .2);
    auto released = game.takeCues();
    CHECK(std::none_of(released.begin(), released.end(), [](const Sound& sound) { return sound.cue == Cue::Open; }));
}

TEST(game_road_crews_knock_while_laying_without_being_picked_out)
{
    // The user: laying a road wants the hammers' knock too, heard though nobody is picked out.
    te::test::Graphics graphics(false);
    MapDocument document(WorldMap::generate(5, 64, 64));
    auto camp = document.map().camp();
    document.beginStroke(); document.paint(camp, 14, Terrain::Grass); document.endStroke();
    auto lot = document.gameMap();
    for (int y = 0; y < lot.height(); ++y)
        for (int x = 0; x < lot.width(); ++x) lot.at(x, y).trees = lot.at(x, y).wild = 0;
    GameApp game(5);
    game.state() = Town(std::move(lot));
    auto& town = game.state();
    town.scout(camp.x, camp.y, 16);
    CHECK(town.place(Structure::Camp, camp, 0));
    town.completeConstruction();
    town.advance(.01);
    for (const auto& person : town.people()) {
        town.orderStop({person.id});
        auto& p = const_cast<Person&>(person); p.food = p.rest = p.health = 1; p.stress = 0;
    }
    int worker = town.people().front().id;
    CHECK(town.buildRoad({RoadAnchor::sharp(camp + Point{1.2f, 0}), RoadAnchor::sharp(camp + Point{9, 0})}));
    int road = town.roads().roads().back().id;
    CHECK(town.orderRoadwork({worker}, road));
    auto middle = project(camp.x + 5, camp.y);
    game.view() = {middle.x, middle.y, 1.2f};
    game.selectPeople({});
    float loudest = 0;
    for (int frame = 0; frame < 160 && town.roads().road(road)->built < 1; ++frame) {
        game.render(640, 400, frame * .25);
        game.takeCues();
        if (town.roads().road(road)->built > 0) loudest = std::max(loudest, game.ambience().hammering);
    }
    CHECK(town.roads().road(road)->built > 0);
    CHECK(loudest > 0);
}

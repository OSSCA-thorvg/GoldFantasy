#include "common/hud_text.h"
#include <test/test.h>
#include <test/graphics.h>
#include <game/game_app.h>
#include <game/person_portrait.h>
#include <game/sound_board.h>
#include <algorithm>
#include <cmath>
#include <memory>
#include <set>

namespace
{
using namespace hearthold;
struct GameCanvas
{
    GameApp game{5};
    std::vector<uint32_t> pixels = std::vector<uint32_t>(1280 * 800);
    std::unique_ptr<tvg::SwCanvas> canvas{tvg::SwCanvas::gen(tvg::EngineOption::Default)};
    int id;
    GameCanvas() : id(game.state().people().front().id)
    {
        game.togglePause(); game.selectPeople({id});
        auto p = game.state().person(id)->position;
        auto focus = project(p.x, p.y); game.view() = {focus.x, focus.y, 6};
        game.render(1280, 800, 0);
        CHECK(canvas->target(pixels.data(), 1280, 1280, 800, tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
        CHECK(canvas->add(game.hudScene()) == tvg::Result::Success);
    }
    void frame(double seconds)
    {
        canvas->sync(); game.render(1280, 800, seconds);
        CHECK(canvas->update() == tvg::Result::Success);
        CHECK(canvas->draw(true) == tvg::Result::Success);
        CHECK(canvas->sync() == tvg::Result::Success);
    }
    std::vector<ui::Rect> find(std::string_view text) { return hearthold::test::textBounds(game.hudScene(), text); }
};
}  // namespace

TEST(game_world_speech_bubble_is_above_the_actor_and_tracks_pan_and_zoom)
{
    te::test::Graphics graphics;
    GameCanvas surface;
    CHECK(surface.game.sayPerson(surface.id, "Attack!"));
    surface.frame(0);
    auto events = surface.game.takeCues();
    CHECK_EQ(std::count_if(events.begin(), events.end(), [](const Sound& s) { return s.cue == Cue::Speech; }), 1);
    const auto* speech = surface.game.personSpeech(surface.id);
    CHECK(speech);
    double time = speech->duration() + .05;
    surface.frame(time);
    auto first = surface.find("Attack!");
    CHECK_EQ(first.size(), size_t(1));
    if (first.empty()) return;
    CHECK(first[0].y + first[0].h < 580);
    CHECK(std::abs(first[0].x + first[0].w / 2 - 640) < 8);
    surface.game.view().x += 5;
    surface.frame(time);
    auto moved = surface.find("Attack!");
    CHECK_EQ(moved.size(), size_t(1));
    if (moved.empty()) return;
    CHECK(std::abs(moved[0].x - first[0].x + 30) < 1);
    surface.game.view().zoom = 3;
    surface.frame(time);
    auto zoomed = surface.find("Attack!");
    CHECK_EQ(zoomed.size(), size_t(1));
    if (!zoomed.empty()) CHECK(zoomed[0].y > moved[0].y + 30);
    auto later = surface.game.takeCues();
    CHECK(std::none_of(later.begin(), later.end(), [](const Sound& s) { return s.cue == Cue::Speech; }));
}

TEST(game_unselected_world_speech_plays_nearby_audio_and_culls_it_offscreen)
{
    te::test::Graphics graphics;
    GameCanvas surface;
    surface.game.selectPeople({});
    CHECK(surface.game.sayPerson(surface.id, "Hut."));
    surface.frame(0);
    auto start = surface.game.takeCues();
    CHECK(std::any_of(start.begin(), start.end(), [&](const Sound& s) { return s.cue == Cue::Speech && s.speaker == surface.id && s.speechChannel == SpeechChannel::Nearby; }));
    double endTime = surface.game.personSpeech(surface.id)->duration() + .05;
    surface.frame(endTime);
    CHECK_EQ(surface.find("Hut.").size(), size_t(1));
    surface.game.view().x += 10000;
    surface.frame(endTime + .05);
    CHECK(surface.find("Hut.").empty());
    auto stopped = surface.game.takeCues();
    CHECK(std::none_of(stopped.begin(), stopped.end(), [](const Sound& s) { return s.cue == Cue::Speech; }));
    CHECK(!surface.game.sayPerson(-999, "Ahh."));
}

TEST(game_unselected_residents_generate_at_most_two_automatic_voices)
{
    te::test::Graphics graphics;
    GameCanvas surface;
    surface.game.selectPeople({});
    surface.game.state().recruit(Role::Resident, Calling::Settler, 100 - int(surface.game.state().people().size()));
    CHECK_EQ(surface.game.state().people().size(), size_t(100));
    std::set<int> heard;
    int starts = 0;
    for (int frame = 1; frame <= 350; ++frame) {
        double seconds = frame / 10.0;
        surface.game.render(1280, 800, seconds);
        int active = 0;
        for (const auto& person : surface.game.state().people()) {
            auto speech = surface.game.personSpeech(person.id);
            active += speech && speech->playing(seconds);
        }
        CHECK(active <= 2);
        for (const auto& sound : surface.game.takeCues()) if (sound.cue == Cue::Speech) {
            CHECK(sound.gain > 0 && sound.pan >= -1 && sound.pan <= 1);
            CHECK(sound.delay >= 0 && sound.offset >= 0 && sound.duration > 0);
            heard.insert(sound.speaker); ++starts;
        }
    }
    CHECK(starts >= 5 && starts < 80);
    CHECK(heard.size() >= 2);
}

TEST(game_deselecting_a_unit_releases_its_selected_voice_channel)
{
    te::test::Graphics graphics;
    GameCanvas surface;
    CHECK(surface.game.sayPerson(surface.id, "Attack!"));
    surface.frame(0);
    surface.game.selectPeople({});
    auto cues = surface.game.takeCues();
    CHECK(std::none_of(cues.begin(), cues.end(), [](const Sound& s) { return s.cue == Cue::Speech; }));
    CHECK(std::any_of(cues.begin(), cues.end(), [&](const Sound& s) { return s.cue == Cue::SpeechStop && s.speaker == surface.id; }));
    surface.frame(0);
    cues = surface.game.takeCues();
    CHECK(std::any_of(cues.begin(), cues.end(), [&](const Sound& s) { return s.cue == Cue::Speech && s.speaker == surface.id && s.speechChannel == SpeechChannel::Nearby; }));
}

TEST(game_one_selected_resident_and_two_nearby_residents_can_speak_together)
{
    te::test::Graphics graphics;
    GameCanvas surface;
    surface.game.state().recruit(Role::Resident, Calling::Settler, 100 - int(surface.game.state().people().size()));
    auto at = surface.game.state().person(surface.id)->position;
    for (const auto& p : surface.game.state().people()) CHECK(surface.game.state().editPerson(p.id, at, 1));
    auto selected = surface.game.state().people().back().id;
    surface.game.selectPeople({selected});
    for (const auto& p : surface.game.state().people()) CHECK(surface.game.sayPerson(p.id, "Attack!"));
    surface.frame(0);
    SoundBoard mixer(false);
    for (auto sound : surface.game.takeCues()) mixer.play(sound);
    CHECK_EQ(mixer.effectStatistics().selectedSpeech, size_t(1));
    CHECK_EQ(mixer.effectStatistics().nearbySpeech, size_t(2));
    CHECK_EQ(mixer.effectStatistics().speech, size_t(3));
    surface.game.selectPeople({});
    for (auto sound : surface.game.takeCues()) mixer.play(sound);
    CHECK_EQ(mixer.effectStatistics().speech, size_t(2));
}

TEST(game_work_audio_is_heard_about_the_view_and_louder_for_those_picked_out)
{
    // Hammers knock wherever someone builds or lays road near the middle of the view, picked out or not (the user:
    // no hammering unless selected felt wrong); picking the worker out makes it louder, and idle hands are silent.
    te::test::Graphics graphics;
    GameCanvas surface;
    auto& worker = const_cast<Person&>(*surface.game.state().person(surface.id));
    worker.path.clear(); worker.inside = false; worker.doorway = 0;
    for (auto activity : {Activity::Building, Activity::Roadwork}) {
        worker.activity = activity;
        surface.game.selectPeople({surface.id});
        auto selected = surface.game.ambience();
        surface.game.selectPeople({});
        auto unselected = surface.game.ambience();
        CHECK(unselected.hammering > 0);
        CHECK(selected.hammering > unselected.hammering);
        CHECK_EQ(unselected.chopping, 0.f);
    }
    worker.activity = Activity::Idle;
    CHECK_EQ(surface.game.ambience().hammering, 0.f);
}

TEST(game_combat_audio_is_heard_about_the_view_louder_for_those_picked_out_and_never_replays_old_hits)
{
    // Blows ring out wherever a fight is near the middle of the view, picked out or not (the user: hearing a fight
    // only with someone selected was a bug); a fighter picked out is louder, far fights are not heard, and old
    // blows never replay.
    te::test::Graphics graphics;
    GameCanvas surface;
    auto at = surface.game.state().person(surface.id)->position;
    auto other = surface.game.state().people().back().id;
    auto& hits = const_cast<std::vector<Hit>&>(surface.game.state().hits());
    auto loudest = [&] {
        float gain = 0;
        for (const auto& s : surface.game.takeCues())
            if (s.cue == Cue::Clash || s.cue == Cue::Arrow || s.cue == Cue::Bite) gain = std::max(gain, s.gain);
        return gain;
    };
    hits.push_back({1, at, at, 1, false, false, 0, other});
    surface.frame(0);
    float unpicked = loudest();
    CHECK(unpicked > 0);
    hits.push_back({2, at, at, 1, false, false, 0, surface.id});
    surface.frame(0);
    CHECK(loudest() > unpicked);
    surface.game.selectPeople({});
    hits.push_back({3, at, at, 1, true, false, 0, surface.id});
    surface.frame(0);
    CHECK(loudest() > 0);
    auto far = at + Point{40, 0};
    hits.push_back({4, far, far, 1, false, false, 0, other});
    surface.frame(0);
    CHECK_EQ(loudest(), 0.f);
    surface.game.selectPeople({surface.id});
    surface.frame(0);
    CHECK_EQ(loudest(), 0.f);
}

#if HEARTHOLD_WITH_EDITOR
TEST(game_static_character_studio_suppresses_world_voice_preview)
{
    te::test::Graphics graphics;GameApp game(5);game.openCharacterEditor();
    game.render(1280,800,0);game.takeCues();game.render(1280,800,20);
    auto cues=game.takeCues();CHECK(std::none_of(cues.begin(),cues.end(),[](const Sound& s){return s.cue==Cue::Speech;}));
}
#endif

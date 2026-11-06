#include <test/test.h>
#include <game/effect_manager.h>
#include <game/game_app.h>

namespace
{
using namespace hearthold;
Sound speech(int speaker)
{
    Sound sound{Cue::Speech, .4f, 0};
    sound.speaker = speaker; sound.line = VoiceLine::Hmm; sound.duration = .5f;
    return sound;
}
}

TEST(game_effect_manager_caps_effects_and_reserves_a_single_speech_channel)
{
    EffectManager effects;
    for (auto cue : {Cue::Place, Cue::Demolish, Cue::Click, Cue::Notice, Cue::Clash, Cue::Bite, Cue::Arrow, Cue::Complete})
        CHECK(effects.request({cue}) != 0);
    CHECK_EQ(effects.statistics().effects, EffectManager::maxEffects);
    auto voice = effects.request(speech(1)); CHECK(voice != 0);
    for (int i = 2; i <= 100; ++i) CHECK_EQ(effects.request(speech(i)), uint64_t(0));
    CHECK_EQ(effects.statistics().speech, size_t(1));
    CHECK(effects.active(voice));
    auto alarm = effects.request({Cue::Alarm}); CHECK(alarm != 0);
    CHECK_EQ(effects.statistics().effects, EffectManager::maxEffects);
    CHECK(effects.active(voice));
    CHECK_EQ(effects.statistics().replaced, uint64_t(1));
}

TEST(game_effect_manager_cooldowns_drop_bursts_and_never_replay_them_later)
{
    EffectManager effects;
    auto first = effects.request({Cue::Complete}); CHECK(first != 0);
    for (int i = 0; i < 100; ++i) CHECK_EQ(effects.request({Cue::Complete}), uint64_t(0));
    CHECK_EQ(effects.statistics().effects, size_t(1));
    effects.advance(.31);
    auto second = effects.request({Cue::Complete}); CHECK(second != 0);
    effects.advance(.31);
    CHECK_EQ(effects.request({Cue::Complete}), uint64_t(0));
    effects.finish(first); effects.finish(second); effects.advance(3);
    CHECK_EQ(effects.statistics().effects, size_t(0));
    CHECK(effects.request({Cue::Complete}) != 0);
}

TEST(game_effect_manager_stopping_and_replacing_speech_invalidates_old_tokens)
{
    EffectManager effects;
    auto old = effects.request(speech(1)); CHECK(old != 0);
    auto current = effects.request(speech(1)); CHECK(current != 0);
    CHECK(!effects.active(old)); CHECK(effects.active(current));
    effects.stopSpeech(2); CHECK(effects.active(current));
    effects.stopSpeech(1); CHECK(!effects.active(current));
    auto next = effects.request(speech(2)); CHECK(next != 0);
    effects.clear();
    auto fresh = effects.request(speech(2)); CHECK(fresh != 0);
    CHECK(!effects.active(next)); CHECK(fresh != next);
}

TEST(game_effect_manager_reserves_one_selected_voice_alongside_two_nearby_voices)
{
    EffectManager effects;
    auto nearby = speech(1); nearby.speechChannel = SpeechChannel::Nearby;
    CHECK(effects.request(nearby) != 0);
    nearby.speaker = 2; CHECK(effects.request(nearby) != 0);
    for (int id = 3; id <= 100; ++id) { nearby.speaker = id; CHECK_EQ(effects.request(nearby), uint64_t(0)); }
    auto selected = effects.request(speech(101)); CHECK(selected != 0);
    CHECK_EQ(effects.statistics().speech, size_t(3));
    CHECK_EQ(effects.statistics().nearbySpeech, size_t(2));
    CHECK_EQ(effects.statistics().selectedSpeech, size_t(1));
    effects.stopSpeech(1);
    CHECK_EQ(effects.statistics().speech, size_t(2)); CHECK(effects.active(selected));
    effects.stopSpeech(); CHECK_EQ(effects.statistics().speech, size_t(0));
    effects.advance(10); CHECK_EQ(effects.statistics().speech, size_t(0));
}

TEST(game_effect_manager_changing_voice_channel_never_duplicates_a_speaker)
{
    EffectManager effects;
    auto sound = speech(7); sound.speechChannel = SpeechChannel::Nearby;
    auto nearby = effects.request(sound); CHECK(nearby != 0);
    sound.speechChannel = SpeechChannel::Selected;
    auto selected = effects.request(sound); CHECK(selected != 0);
    CHECK(!effects.active(nearby)); CHECK(effects.active(selected));
    CHECK_EQ(effects.statistics().speech, size_t(1));
    CHECK_EQ(effects.statistics().selectedSpeech, size_t(1));
    CHECK_EQ(effects.statistics().nearbySpeech, size_t(0));
}

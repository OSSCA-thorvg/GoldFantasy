#include <test/test.h>
#include <game/sound_library.h>
#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

using namespace hearthold;

TEST(game_sound_library_holds_every_cue_and_decodes_its_clips)
{
    // The interface, effects, weather and the raven: short mono clips, decoded when first asked for.
    for (auto cue : {"ui/click_", "ui/confirm_", "ui/error_", "ui/notify_", "ui/complete_", "ui/growth_", "sfx/clash_", "sfx/block_", "sfx/chop_",
                     "sfx/hammer_", "sfx/horn_", "sfx/coins_", "sfx/tree_fall_", "weather/crack_", "weather/strike_", "weather/clap_", "weather/rumble_", "wildlife/raven_"}) {
        CHECK(sounds::count(cue) >= 1);
        auto clip = sounds::clip(cue, 0);
        CHECK(clip.frames > 1000);
        CHECK_EQ(clip.rate, 22050);
        CHECK(clip.duration() < 12);
        CHECK(clip.at(clip.duration() + 1) == 0);
    }
    CHECK_EQ(sounds::count("weather/rumble_"), 3);
    // Five voices, each saying every villager and battle line in more than one take.
    for (auto voice : {"young", "berserker", "maiden", "huntress", "veteran"})
        for (auto line : {"select", "ack", "work", "hum", "mumble", "yawn", "sleep", "sigh", "happy", "complain", "thanks", "alarm", "attack", "hurt", "death"}) {
            auto prefix = std::string("voice/") + voice + "/" + line + "_";
            CHECK(sounds::count(prefix) >= 2);
            CHECK(sounds::clip(prefix, 1).frames > 2000);
        }
    CHECK(sounds::caption("voice/huntress/alarm_01") == "To arms!");
    CHECK(sounds::caption("voice/berserker/ack_04") == "It will be done.");
    CHECK(sounds::caption("voice/veteran/hum_02") == "Hmm.");
    CHECK(sounds::caption("voice/nobody/hum_02").empty());
    // Four moments of music, four tracks each, streamed as they play.
    for (auto moment : {"music/dawn/", "music/dusk/", "music/battle/", "music/build/"}) {
        CHECK_EQ(sounds::count(moment), 4);
        MusicStream track(sounds::encoded(sounds::name(moment, 3)));
        CHECK(track.valid());
        CHECK(track.duration() > 60);
        std::vector<float> frames(2 * 44100);
        CHECK_EQ(track.read(frames.data(), 44100), 44100);
        CHECK(std::any_of(frames.begin(), frames.end(), [](float sample) { return std::abs(sample) > .01f; }));
    }
    CHECK_EQ(sounds::count("nothing/"), 0);
    CHECK_EQ(sounds::clip("nothing/", 0).frames, size_t(0));
    CHECK(!MusicStream(sounds::encoded("nothing")).valid());
}

TEST(game_no_voice_is_the_chief_or_calls_anyone_chief)
{
    // The user asked for the chief gone: no chief voice, and nobody answers "Chief?" when picked out.
    CHECK_EQ(sounds::count("voice/chief/"), 0);
    int voiced = sounds::count("voice/");
    CHECK(voiced > 200);
    for (int i = 0; i < voiced; ++i) {
        std::string words(sounds::caption(sounds::name("voice/", i)));
        std::transform(words.begin(), words.end(), words.begin(), [](unsigned char c) { return char(std::tolower(c)); });
        CHECK(words.find("chief") == std::string::npos);
    }
    for (auto voice : {"young", "berserker", "maiden", "huntress", "veteran"}) CHECK(sounds::count(std::string("voice/") + voice + "/select_") >= 3);
}

#include <test/test.h>
#include <game/person_speech.h>
#include <game/sound_board.h>
#include <algorithm>
#include <cmath>
#include <set>
#include <vector>

namespace
{
using namespace hearthold;
constexpr int rate = 44100;

std::vector<float> mix(SoundBoard& board, int frames)
{
    std::vector<float> out(size_t(frames) * 2);
    board.render(out.data(), frames);
    return out;
}

// Mean square loudness of a stretch of a stereo mix.
double power(const std::vector<float>& samples, double from, double to)
{
    size_t first = size_t(from * rate) * 2, last = std::min(samples.size(), size_t(to * rate) * 2);
    double sum = 0;
    for (size_t i = first; i < last; ++i) sum += double(samples[i]) * samples[i];
    return last > first ? sum / double(last - first) : 0;
}
}  // namespace

TEST(game_audio_cue_clips_play_to_their_end_and_fall_silent)
{
    // The alarm's horn rings for seconds, long past where drawn cues are cut, the same however SDL slices its
    // requests, and ends faded rather than on a click.
    SoundBoard whole(false), split(false);
    for (auto* board : {&whole, &split}) board->play({Cue::Alarm, .5f, .3f});
    constexpr int frames = rate * 10;
    std::vector<float> one(size_t(frames) * 2), many(one.size());
    whole.render(one.data(), frames);
    for (int at = 0; at < frames; at += 383) split.render(many.data() + at * 2, std::min(383, frames - at));
    CHECK(one == many);
    int last = frames - 1;
    while (last > 0 && one[size_t(last) * 2] == 0 && one[size_t(last) * 2 + 1] == 0) --last;
    CHECK(last > rate * 6);
    CHECK(last < rate * 9);
    CHECK(std::abs(one[size_t(last) * 2]) < 1e-3f);
    CHECK(power(one, 1, 3) > 1e-5);
}

TEST(game_audio_cues_vary_between_plays)
{
    // A handful of coins never jingles the same twice running: another take, or the same a little higher or lower.
    SoundBoard board(false);
    std::vector<std::vector<float>> plays;
    for (int i = 0; i < 6; ++i) {
        board.play({Cue::Coins, .5f});
        plays.push_back(mix(board, rate * 2));
    }
    for (size_t i = 1; i < plays.size(); ++i) CHECK(plays[i] != plays[i - 1]);
    for (const auto& play : plays) CHECK(power(play, 0, 1) > 1e-6);
}

TEST(game_audio_thunder_rolls_in_after_its_delay)
{
    SoundBoard board(false);
    Sound thunder{Cue::ThunderClap, .8f};
    thunder.delay = 1.2f;  // Far off: the sound comes well after the flash.
    board.play(thunder);
    auto heard = mix(board, rate * 5);
    CHECK(power(heard, 0, 1.15) == 0);
    CHECK(power(heard, 1.25, 4) > 1e-5);
}

TEST(game_audio_music_swells_in_crossfades_and_fades_away)
{
    SoundBoard board(false);
    CHECK(!board.musicPlaying());
    Sound dawn{Cue::Music};
    dawn.track = sounds::name("music/dawn/", 0);
    board.play(dawn);
    CHECK(board.musicPlaying());
    auto start = mix(board, rate * 5);
    CHECK(power(start, 3.5, 5) > 1e-4);
    // It swells in over its first seconds rather than starting at full: well under the track as it was made.
    MusicStream made(sounds::encoded(dawn.track));
    std::vector<float> opening(size_t(rate) * 3 * 2);
    CHECK_EQ(made.read(opening.data(), rate * 3), rate * 3);
    double full = 0;
    for (float sample : opening) full += double(sample) * sample;
    full /= double(opening.size());
    CHECK(full > 1e-5);
    CHECK(power(start, 0, 3) < full * .25 * .6);
    Sound battle{Cue::Music};
    battle.track = sounds::name("music/battle/", 1);
    board.play(battle);
    auto crossing = mix(board, rate * 4);
    CHECK(power(crossing, 0, 4) > 1e-4);  // No gap between them.
    board.play({Cue::Music});  // No track: let it fade.
    auto ending = mix(board, rate * 4);
    CHECK(power(ending, 3, 4) == 0);
    CHECK(!board.musicPlaying());
    // A track that does not exist leaves the music silent.
    Sound missing{Cue::Music};
    missing.track = "music/nowhere/tune";
    board.play(missing);
    CHECK(power(mix(board, rate), 0, 1) == 0);
}

TEST(game_people_speak_in_five_voices_by_body_and_looks)
{
    std::set<VoiceKind> men, women;
    for (int id = 0; id < 60; ++id) {
        men.insert(voiceKind(BodyType::Male, uint32_t(id * 7919), id));
        women.insert(voiceKind(BodyType::Female, uint32_t(id * 7919), id));
    }
    const std::set<VoiceKind> low{VoiceKind::Young, VoiceKind::Berserker};
    const std::set<VoiceKind> high{VoiceKind::Maiden, VoiceKind::Huntress, VoiceKind::Veteran};
    CHECK(men == low);
    CHECK(women == high);
    // Each voice is its own recording, not one voice pitched about.
    auto young = voiceSample(VoiceLine::Alarm, VoiceKind::Young, 0), maiden = voiceSample(VoiceLine::Alarm, VoiceKind::Maiden, 0);
    CHECK(young.frames > 0);
    CHECK(maiden.frames > 0);
    CHECK(young.pcm != maiden.pcm);
    CHECK(std::abs(characterVoicePitch(1, 2) - 1) <= .03f);
}

TEST(game_people_say_the_words_of_the_take_they_voice)
{
    // A raised alarm reads what the voice cries; lines whose takes have no words read a usual one.
    PersonSpeech speech;
    CHECK(speech.say(VoiceLine::Alarm, 0, 1, VoiceKind::Huntress, 0));
    CHECK(speech.text() == "To arms!");
    CHECK(speech.voice() == VoiceLine::Alarm);
    CHECK(speech.voiceKind() == VoiceKind::Huntress);
    CHECK(std::abs(speech.voiceDuration() - voiceSample(VoiceLine::Alarm, VoiceKind::Huntress, 0).duration()) < 1e-6);
    CHECK(speech.say(VoiceLine::Ack, 5, 1, VoiceKind::Berserker, 3));
    CHECK(speech.text() == "It will be done.");
    CHECK(speech.say(VoiceLine::Mumble, 9, 1, VoiceKind::Veteran));
    CHECK(speech.text().find("hammer") != std::string::npos);
    CHECK(!speech.say(VoiceLine::None, 12, 1, VoiceKind::Young));
}

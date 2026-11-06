#include <test/test.h>
#include <game/person_speech.h>
#include <game/sound_board.h>
#include <algorithm>
#include <cmath>
#include <limits>

namespace
{
using namespace hearthold;
Sound bark(VoiceLine line, int speaker = 7)
{
    Sound sound{Cue::Speech, .6f, 0};
    sound.line = line; sound.speaker = speaker;
    sound.duration = float(voiceSample(line).duration());
    return sound;
}
std::vector<float> mix(SoundBoard& board, int frames)
{
    std::vector<float> result(size_t(frames) * 2);
    board.render(result.data(), frames);
    return result;
}
double energy(const std::vector<float>& a, const std::vector<float>& b, int channel)
{
    double sum = 0;
    for (size_t i = size_t(channel); i < a.size(); i += 2) sum += std::pow(a[i] - b[i], 2);
    return sum;
}
}  // namespace

TEST(game_spoken_voice_assets_are_bounded_pcm_and_cover_every_bark)
{
    for (auto line : {VoiceLine::Hmm, VoiceLine::Ahh, VoiceLine::Attack, VoiceLine::Hut, VoiceLine::Phew}) {
        auto sample = voiceSample(line);
        CHECK(sample.frames > 2000);
        CHECK(sample.duration() > .1 && sample.duration() < 1.6);
        double sum = 0;
        int peak = 0;
        for (size_t i = 0; i < sample.frames; ++i) { sum += std::pow(sample.pcm[i] / 32768.0, 2); peak = std::max(peak, std::abs(int(sample.pcm[i]))); }
        CHECK(std::sqrt(sum / sample.frames) > .02);
        CHECK(peak < 30000);
        CHECK_EQ(voiceSampleAt(line, -1), 0.f);
        CHECK_EQ(voiceSampleAt(line, sample.duration() + 1), 0.f);
    }
    CHECK(voiceLine("Hmm...") == VoiceLine::Hmm);
    CHECK(voiceLine("Hm.") == VoiceLine::Hmm);
    CHECK(voiceLine("Ahh.") == VoiceLine::Ahh);
    CHECK(voiceLine("Attack!") == VoiceLine::Attack);
    CHECK(voiceLine("Hut!") == VoiceLine::Hut);
    CHECK(voiceLine("Phew...") == VoiceLine::Phew);
    CHECK(voiceLine("Custom preview") == VoiceLine::Murmur);
    CHECK(voiceLine("123") == VoiceLine::Murmur);
    CHECK(voiceLine(" ... ") == VoiceLine::None);
    CHECK_EQ(voiceSampleAt(VoiceLine::Hmm, std::numeric_limits<double>::quiet_NaN()), 0.f);
}

TEST(game_speech_mixer_respects_delay_and_stop_without_replaying_the_voice)
{
    SoundBoard board(false), silent(false);
    auto sound = bark(VoiceLine::Attack); sound.delay = .05f;
    board.play(sound);
    CHECK(mix(board, 1000) == mix(silent, 1000));
    auto voice = mix(board, 7000), baseline = mix(silent, 7000);
    CHECK(energy(voice, baseline, 0) + energy(voice, baseline, 1) > .1);
    for (auto sample : voice) CHECK(std::isfinite(sample) && std::abs(sample) <= 1);
    Sound stop{Cue::SpeechStop}; stop.speaker = sound.speaker;
    board.play(stop);
    CHECK(mix(board, 2000) == mix(silent, 2000));
    CHECK(mix(board, 2000) == mix(silent, 2000));
}

TEST(game_audio_same_effect_bursts_are_coalesced_without_a_delayed_backlog)
{
    SoundBoard once(false), burst(false);
    once.play({Cue::Complete, .05f, 0});
    for (int i = 0; i < 100; ++i) burst.play({Cue::Complete, .05f, 0});
    CHECK(mix(once, 44100 * 2) == mix(burst, 44100 * 2));
}

TEST(game_audio_axe_and_pickaxe_hits_release_their_budget_before_the_next_stroke)
{
    for (auto cue : {Cue::Chop, Cue::Mine}) {
        SoundBoard board(false);
        for (int stroke = 0; stroke < 6; ++stroke) {
            board.play({cue, .3f});
            auto samples = mix(board, 11025);
            CHECK(std::any_of(samples.begin(), samples.end(), [](float s) { return std::abs(s) > 1e-4f; }));
            CHECK_EQ(board.effectStatistics().effects, size_t(0));
        }
        CHECK_EQ(board.effectStatistics().accepted, uint64_t(6));
        board.playback(SoundBoard::Playback::Stopped);
        board.play({cue}); board.play({Cue::TreeFall});
        auto silence = mix(board, 8820);
        CHECK(std::all_of(silence.begin(), silence.end(), [](float s) { return s == 0; }));
    }
}

TEST(game_audio_allows_only_one_selected_character_voice_at_a_time)
{
    SoundBoard once(false), crowd(false);
    auto first = bark(VoiceLine::Attack, 0); first.gain = .05f;
    once.play(first);
    for (int id = 0; id < 100; ++id) { auto voice = first; voice.speaker = id; crowd.play(voice); }
    CHECK(mix(once, 44100) == mix(crowd, 44100));
}

TEST(game_audio_nearby_voice_bursts_preserve_two_voices_and_the_selected_voice)
{
    SoundBoard reference(false), crowd(false);
    auto nearby = bark(VoiceLine::Attack, 0); nearby.gain = .05f; nearby.speechChannel = SpeechChannel::Nearby;
    reference.play(nearby); nearby.speaker = 1; reference.play(nearby);
    for (int id = 0; id < 100; ++id) { nearby.speaker = id; crowd.play(nearby); }
    auto selected = bark(VoiceLine::Hmm, 101); selected.gain = .05f;
    reference.play(selected); crowd.play(selected);
    CHECK_EQ(crowd.effectStatistics().speech, size_t(3));
    CHECK(mix(reference, 44100 * 2) == mix(crowd, 44100 * 2));
    CHECK_EQ(crowd.effectStatistics().speech, size_t(0));
}

TEST(game_mixer_is_silent_before_play_and_discards_cues_from_editor_preview)
{
    SoundBoard board(false);
    board.playback(SoundBoard::Playback::Stopped);
    Ambience land;
    land.water = land.wind = land.birds = land.music = 1;
    board.setAmbience(land);
    board.play(bark(VoiceLine::Attack));
    auto samples = mix(board, 44100);
    CHECK(std::all_of(samples.begin(), samples.end(), [](float s) { return s == 0; }));
    board.setAmbience({});
    board.playback(SoundBoard::Playback::Playing);
    samples = mix(board, 10000);
    CHECK(std::all_of(samples.begin(), samples.end(), [](float s) { return s == 0; }));
    board.play(bark(VoiceLine::Attack));
    samples = mix(board, 10000);
    CHECK(std::any_of(samples.begin(), samples.end(), [](float s) { return s != 0; }));
}

TEST(game_mixer_pause_freezes_music_ambience_and_voices_and_stop_clears_them)
{
    SoundBoard board(false), reference(false);
    Ambience land;
    land.water = land.music = 1;
    for (auto* mixer : {&board, &reference}) {
        mixer->setAmbience(land);
        mixer->play(bark(VoiceLine::Ahh));
    }
    CHECK(mix(board, 3000) == mix(reference, 3000));
    board.playback(SoundBoard::Playback::Paused);
    board.play(bark(VoiceLine::Attack, 8));  // Preview events must not queue up.
    for (int i = 0; i < 3; ++i) {
        auto silence = mix(board, 10000);
        CHECK(std::all_of(silence.begin(), silence.end(), [](float s) { return s == 0; }));
    }
    board.playback(SoundBoard::Playback::Playing);
    CHECK(mix(board, 10000) == mix(reference, 10000));
    board.playback(SoundBoard::Playback::Stopped);
    auto silence = mix(board, 10000);
    CHECK(std::all_of(silence.begin(), silence.end(), [](float s) { return s == 0; }));
    board.playback(SoundBoard::Playback::Playing);
    silence = mix(board, 10000);
    CHECK(std::all_of(silence.begin(), silence.end(), [](float s) { return s == 0; }));
}

TEST(game_mixer_plays_the_score_only_for_a_bard_and_lets_the_land_fill_the_quiet)
{
    constexpr int second = 44100;
    SoundBoard quiet(false), bard(false);
    Ambience music;
    music.music = 1;
    bard.setAmbience(music);
    auto hush = mix(quiet, second * 4), tune = mix(bard, second * 4);
    CHECK(std::all_of(hush.begin(), hush.end(), [](float s) { return s == 0; }));  // No bard, no music.
    CHECK(energy(tune, hush, 0) + energy(tune, hush, 1) > 1);
    // Each sound of the land carries on its own, and none is harsh.
    std::vector<Ambience> lands(5);
    lands[0].water = 1;
    lands[1].woods = 1;
    lands[2].chopping = 1;
    lands[3].night = 1, lands[3].woods = 1;  // Crickets, and an owl.
    lands[4].birds = 1;
    for (const auto& land : lands) {
        SoundBoard board(false);
        board.setAmbience(land);
        auto heard = mix(board, second * 6);
        double sum = 0;
        float peak = 0;
        for (float s : heard) sum += double(s) * s, peak = std::max(peak, std::abs(s));
        CHECK(std::sqrt(sum / double(heard.size())) > 3e-4);
        CHECK(peak < .2f);
    }
    // A pack's howl rings out, and is gone in under a second and a half.
    SoundBoard wild(false);
    wild.play({Cue::Howl, 1, 0});
    auto howl = mix(wild, second * 2);
    constexpr int ringing = second * 28 / 10, after = second * 29 / 10;  // 1.4 s and 1.45 s of stereo.
    float loudest = 0;
    for (auto at = howl.begin(); at != howl.begin() + ringing; ++at) loudest = std::max(loudest, std::abs(*at));
    CHECK(loudest > .03f && loudest < .2f);
    CHECK(std::all_of(howl.begin() + after, howl.end(), [](float s) { return s == 0; }));
}

TEST(game_speech_mixer_pans_character_voices_and_replaces_the_same_speaker)
{
    SoundBoard left(false), right(false), silent(false);
    auto a = bark(VoiceLine::Ahh); a.pan = -1;
    auto b = a; b.pan = 1;
    left.play(a); right.play(b);
    auto l = mix(left, 10000), r = mix(right, 10000), base = mix(silent, 10000);
    CHECK(energy(l, base, 0) > 100 * energy(l, base, 1));
    CHECK(energy(r, base, 1) > 100 * energy(r, base, 0));
    SoundBoard twice(false), once(false);
    a = bark(VoiceLine::Hmm);
    twice.play(bark(VoiceLine::Attack));
    twice.play(a); once.play(a);
    CHECK(mix(twice, 10000) == mix(once, 10000));
}

TEST(game_speech_timing_follows_embedded_voice_duration_and_character_pitch)
{
    for (auto text : {"Hmm...", "Ahh.", "Attack!", "Hut.", "Phew..."}) {
        for (float pitch : {.9f, 1.1f}) {
            PersonSpeech speech;
            CHECK(speech.say(text, 2, pitch));
            CHECK_EQ(speech.voicePitch(), pitch);
            CHECK(std::abs(speech.voiceDuration() - voiceSample(voiceLine(text), speech.voiceKind(), speech.voiceTake()).duration() / pitch) < .00001);
            CHECK(speech.duration() >= .16 + speech.voiceDuration());
            CHECK(!speech.playing(2 + speech.duration() + .21));
            auto serial = speech.sequence();
            CHECK(!speech.say(text, 3, 0));
            CHECK_EQ(speech.sequence(), serial);
        }
    }
    CHECK(characterVoicePitch(4242, 7) != characterVoicePitch(4242, 8));
}

#include <test/test.h>
#include <game/sound_board.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <vector>

namespace
{
using namespace hearthold;
constexpr int rate = 44100;
}

TEST(game_audio_effect_tails_are_independent_of_callback_buffer_boundaries)
{
    // A clip beside cues still drawn from tones and noise, whose tails run until they are cut at 1.6 s.
    SoundBoard whole(false), split(false);
    for (auto* board : {&whole, &split}) {
        board->play({Cue::Complete, .6f, .2f});
        board->play({Cue::Bite, .3f, -.3f});
        board->play({Cue::Arrow, .2f, 0});
    }
    constexpr int frames = rate * 2;
    std::vector<float> one(size_t(frames) * 2), many(one.size());
    whole.render(one.data(), frames);
    for (int at = 0; at < frames; at += 257) split.render(many.data() + at * 2, std::min(257, frames - at));
    CHECK(one == many);
    // An effect's remaining tail fades to silence instead of being cut by SDL's next request.
    int last = frames - 1;
    while (last > 0 && one[size_t(last) * 2] == 0 && one[size_t(last) * 2 + 1] == 0) --last;
    CHECK(last > int(rate * 1.58));
    CHECK(last < int(rate * 1.61));
    CHECK(std::abs(one[size_t(last) * 2]) < 1e-4f);
    CHECK(std::abs(one[size_t(last) * 2 + 1]) < 1e-4f);
}

TEST(game_night_audio_keeps_sample_precision_after_minutes_of_play)
{
    SoundBoard board(false);
    Ambience land;
    land.night = 1;
    board.setAmbience(land);
    std::array<float, 2048> samples{};
    float previous = 0, largestStep = 0;
    // At 256 seconds a float absolute clock has a step larger than one 44.1 kHz sample.
    constexpr int warm = rate * 256, total = warm + rate * 2;
    for (int at = 0; at < total; at += 1024) {
        int count = std::min(1024, total - at);
        board.render(samples.data(), count);
        for (int i = 0; i < count; ++i) {
            float value = samples[size_t(i) * 2];
            if (at + i >= warm) largestStep = std::max(largestStep, std::abs(value - previous));
            previous = value;
        }
    }
    // The 4.4 kHz chirp's amplitude/envelope permit < .008 of change per sample.
    CHECK(largestStep > .004f);
    CHECK(largestStep < .009f);
}

#ifndef __EMSCRIPTEN__
#include <atomic>
#include <thread>

TEST(game_audio_cue_limit_includes_voices_currently_mixing_on_another_thread)
{
    constexpr float gain = .001f;
    SoundBoard reference(false), board(false);
    reference.play({Cue::Complete, gain, -1});
    std::array<float, 1024> samples{};
    float singlePeak = 0;
    for (int i = 0; i < 160; ++i) {
        reference.render(samples.data(), 512);
        for (float value : samples) singlePeak = std::max(singlePeak, std::abs(value));
    }
    for (int i = 0; i < 24; ++i) board.play({Cue::Complete, gain, -1});
    std::atomic<bool> started = false, finished = false;
    float peak = 0;
    std::thread mixer([&] {
        std::array<float, 1024> block{};
        started.store(true, std::memory_order_release);
        for (int i = 0; i < 32; ++i) {
            board.render(block.data(), 512);
            for (float value : block) peak = std::max(peak, std::abs(value));
        }
        finished.store(true, std::memory_order_release);
    });
    while (!started.load(std::memory_order_acquire)) std::this_thread::yield();
    size_t queued = 0;
    while (!finished.load(std::memory_order_acquire)) {
        board.play({Cue::Complete, gain, -1});
        if (++queued % 128 == 0) std::this_thread::yield();
    }
    mixer.join();
    CHECK(singlePeak > 0);
    CHECK(peak <= singlePeak * EffectManager::maxEffects + 1e-5f);
}
#endif

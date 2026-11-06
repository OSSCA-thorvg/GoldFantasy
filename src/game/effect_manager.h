#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

namespace hearthold
{
enum class Cue : uint8_t;
struct Sound;

// Admission and cancellation are serialized by SoundBoard's audio lock.
class EffectManager
{
public:
    static constexpr size_t maxEffects = 8, maxSelectedSpeech = 1, maxNearbySpeech = 2;
    static constexpr size_t maxSpeech = maxSelectedSpeech + maxNearbySpeech, maxConcurrent = maxEffects + maxSpeech;
    struct Statistics
    {
        size_t effects = 0, speech = 0, selectedSpeech = 0, nearbySpeech = 0;
        uint64_t accepted = 0, dropped = 0, replaced = 0;
    };

    uint64_t request(const Sound&);
    bool active(uint64_t token) const;
    void finish(uint64_t token);
    void stopSpeech(int speaker = -2);
    void advance(double seconds);
    void clear();
    Statistics statistics() const;

private:
    struct Slot { uint64_t token = 0; Cue cue{}; int speaker = -2, priority = 0; };
    std::array<Slot, maxConcurrent> slots{};
    std::array<double, 256> nextAllowed{};
    std::array<double, maxSpeech> nextSpeechAllowed{};
    double now = 0;
    uint64_t serial = 1;
    Statistics totals;
};
}

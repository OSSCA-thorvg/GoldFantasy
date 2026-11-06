#pragma once

#include "iso_projection.h"
#include <algorithm>
#include <cmath>
#include <cstdint>

namespace hearthold
{
namespace woodcutting
{
inline constexpr double cutSeconds = 6, swingSeconds = .7, impactSeconds = .52, fallSeconds = .8;
inline constexpr float searchRadius = 5;
inline constexpr int logsPerTree = 3;

inline float axeAngle(double elapsed)
{
    float phase = float(std::fmod(std::max(0., elapsed), swingSeconds));
    auto ease = [](float t) { t = std::clamp(t, 0.f, 1.f); return t * t * (3 - 2 * t); };
    if (phase < .32f) return -1.35f * ease(phase / .32f);
    if (phase < impactSeconds) return -1.35f + 1.57f * ease((phase - .32f) / float(impactSeconds - .32));
    return .22f * (1 - ease((phase - float(impactSeconds)) / float(swingSeconds - impactSeconds)));
}
}

struct TreeWorkEvent
{
    enum class Kind : uint8_t { Chop, Fall, Mine, Shatter };
    uint64_t serial;
    Kind kind;
    int person, cell, index;
    Point worker;
    double at;
};
}  // namespace hearthold

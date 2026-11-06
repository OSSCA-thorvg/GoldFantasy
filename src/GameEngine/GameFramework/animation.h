#pragma once

#include <algorithm>

namespace gameframework
{
inline float smoothstep(float t)
{
    t = std::clamp(t, 0.f, 1.f);
    return t * t * (3 - 2 * t);
}

inline float outCubic(float t)
{
    t = 1 - std::clamp(t, 0.f, 1.f);
    return 1 - t * t * t;
}
}  // namespace gameframework

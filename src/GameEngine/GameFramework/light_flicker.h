#pragma once

#include "geometry.h"
#include <cstdint>

namespace gameframework
{
// How a light moves: a fire leaps and leans, a lamp's flame wavers, a hearth behind shutters glows
// unevenly, and magic swells and ebbs slowly.
enum class Flicker : uint8_t { Fire, Flame, Hearth, Magic };

// A light at one moment against its resting look: how bright it burns, how far its light reaches,
// and how far its flame leans, in screen units.
struct Flare
{
    float brightness = 1, reach = 1;
    Point sway;
};

// No light flares past this, so whatever draws one can keep that much headroom in its alpha.
constexpr float brightest = 1.25f;

// Smooth from moment to moment and out of step with every other light, each keyed by where it stands.
Flare flare(Flicker, Point at, double seconds);
}  // namespace gameframework

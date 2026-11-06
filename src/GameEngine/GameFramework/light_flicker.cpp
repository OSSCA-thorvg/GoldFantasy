#include "light_flicker.h"
#include "coordinate_hash.h"
#include <cmath>

namespace gameframework
{
namespace
{
// Smooth noise in [-1, 1] easing to a fresh value `rate` times a second; `voice` keeps a light's
// layers apart.
float wander(Point at, double seconds, double rate, uint32_t voice)
{
    double x = seconds * rate, whole = std::floor(x);
    float t = float(x - whole);
    t = t * t * (3 - 2 * t);
    auto value = [&](int64_t step) { return 2 * hash01(voice, int(at.x), int(at.y), uint32_t(step)) - 1; };
    float a = value(int64_t(whole)), b = value(int64_t(whole) + 1);
    return a + (b - a) * t;
}
}  // namespace

Flare flare(Flicker kind, Point at, double seconds)
{
    auto layer = [&](double rate, uint32_t voice) { return wander(at, seconds, rate, voice); };
    Flare f;
    // Each light's layers weigh 1 in all and none swings past .25, so none passes `brightest`.
    switch (kind) {
    case Flicker::Fire:
        f.brightness = 1 + .25f * (.55f * layer(2.1, 1) + .3f * layer(4.7, 2) + .15f * layer(7.9, 3));
        f.sway = {2.4f * layer(1.3, 4), .8f * layer(1.7, 5)};
        break;
    case Flicker::Flame: f.brightness = 1 + .17f * (.65f * layer(1.6, 1) + .35f * layer(6.2, 2)); break;
    case Flicker::Hearth: f.brightness = 1 + .11f * (.7f * layer(.9, 1) + .3f * layer(3.7, 2)); break;
    case Flicker::Magic: {
        double phase = 6.2832 * hash01(6, int(at.x), int(at.y));
        f.brightness = 1 + .14f * (.75f * float(std::sin(seconds * 2 + phase)) + .25f * layer(2.4, 1));
        break;
    }
    }
    // Light thins with the square of distance, so a flame twice as bright lights ground √2 as far.
    f.reach = std::sqrt(f.brightness);
    return f;
}
}  // namespace gameframework

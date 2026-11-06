#include "thunderstorm.h"

namespace hearthold
{
Thunderstorm::Thunderstorm(uint32_t seed) : state(seed * 2246822519u + 0x165667b1u) {}

float Thunderstorm::roll()
{
    state = state * 1664525u + 1013904223u;
    return float(state >> 8) / float(1u << 24);
}

std::optional<Strike> Thunderstorm::update(double seconds, Weather weather, float intensity)
{
    bool storm = weather == Weather::Storm;
    if (!storm && weather != Weather::Rain) {
        next = -1;
        return std::nullopt;
    }
    // A storm flashes every half minute or so; heavy rain now and then, light rain seldom.
    auto gap = [&] { return storm ? 9 + 26 * roll() : intensity > .55f ? 40 + 70 * roll() : 90 + 110 * roll(); };
    if (next < 0) next = seconds + gap() * .5;  // The first a little while after the weather turns.
    if (seconds < next) return std::nullopt;
    next = seconds + gap();
    using Reach = Strike::Reach;
    Strike strike;
    strike.at = seconds;
    float pick = roll();
    // Rain's lightning stays off over the hills; a storm's comes close, now and then right overhead.
    strike.reach = storm ? (pick < .08f ? Reach::Overhead : pick < .3f ? Reach::Near : pick < .65f ? Reach::Middle : Reach::Far)
                         : (pick < .05f ? Reach::Near : pick < .3f ? Reach::Middle : Reach::Far);
    // Sound covers about a third of a kilometre a second: the further off, the longer the wait for the thunder.
    switch (strike.reach) {
    case Reach::Overhead: strike.delay = .05f * roll(); strike.brightness = 1; break;
    case Reach::Near: strike.delay = .25f + .35f * roll(); strike.brightness = .8f; break;
    case Reach::Middle: strike.delay = 1.2f + 1.2f * roll(); strike.brightness = .45f; break;
    case Reach::Far: strike.delay = 3 + 2.5f * roll(); strike.brightness = .22f; break;
    }
    // Near strikes come down in view; middling ones about its edges; far ones light the sky from beyond it.
    float side = roll();
    if (strike.reach == Reach::Far) strike.across = side < .5f ? -.25f - .4f * roll() : 1.25f + .4f * roll();
    else if (strike.reach == Reach::Middle) strike.across = -.2f + 1.4f * side;
    else strike.across = .15f + .7f * side;
    strike.down = .3f + .5f * roll();
    strike.seed = state;
    return strike;
}
}  // namespace hearthold

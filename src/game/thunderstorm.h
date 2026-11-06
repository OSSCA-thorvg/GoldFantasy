#pragma once

#include "climate.h"
#include <cstdint>
#include <optional>

namespace hearthold
{
// A flash of lightning and the thunder that follows it.
struct Strike
{
    // How far off, from right overhead to beyond the hills: the thunder cues run in the same order.
    enum class Reach : uint8_t { Overhead, Near, Middle, Far } reach = Reach::Far;
    double at = 0;               // When it flashes, on the window's clock.
    float delay = 0;             // Seconds until its thunder arrives.
    float brightness = 0;        // How strongly it lights the land, 0..1.
    float across = 0, down = 0;  // Where it strikes, as shares of the view; off screen outside 0..1.
    uint32_t seed = 0;           // Shapes its bolt.
};

// Lightning in wet weather: now and then a strike, more often and nearer the harder it storms. Each lights the sky
// at once and is heard after it, the later the further off.
class Thunderstorm
{
public:
    explicit Thunderstorm(uint32_t seed = 7);
    // The strike due by `seconds`, if any.
    std::optional<Strike> update(double seconds, Weather, float intensity);

private:
    float roll();
    uint32_t state;
    double next = -1;
};
}  // namespace hearthold

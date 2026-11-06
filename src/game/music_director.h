#pragma once

#include <array>
#include <cstdint>
#include <string_view>

namespace hearthold
{
// The moments that may bring a track of music.
enum class Moment : uint8_t { Dawn, Dusk, Battle, Build };

// Occasional tracks for daybreak, nightfall and completed buildings, with a long quiet after each.
// Battle music is disabled.
class MusicDirector
{
public:
    explicit MusicDirector(uint32_t seed = 1);
    // The track to start for a moment at `seconds` on the window's clock, or none.
    std::string_view moment(Moment, double seconds);
    bool playing(double seconds) const { return seconds < until; }

private:
    float roll();
    uint32_t state;
    double until = -1, quietUntil = 30;
    std::array<int, 4> last{-1, -1, -1, -1};
};
}  // namespace hearthold

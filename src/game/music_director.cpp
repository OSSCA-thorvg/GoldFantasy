#include "music_director.h"
#include "sound_library.h"

namespace hearthold
{
namespace
{
constexpr std::string_view folders[] = {"music/dawn/", "music/dusk/", "music/battle/", "music/build/"};
// Most daybreaks and nightfalls, and under half of the buildings finished, may bring a tune after quiet.
constexpr float chances[] = {.75f, .75f, 0, .45f};
}  // namespace

MusicDirector::MusicDirector(uint32_t seed) : state(seed * 2654435761u + 0x9e3779b9u) {}

float MusicDirector::roll()
{
    state = state * 1664525u + 1013904223u;
    return float(state >> 8) / float(1u << 24);
}

std::string_view MusicDirector::moment(Moment moment, double seconds)
{
    auto kind = size_t(moment);
    if (kind >= std::size(folders)) return {};
    if (moment == Moment::Battle) return {};
    if (playing(seconds) || seconds < quietUntil || roll() >= chances[kind]) {
        return {};
    }
    int tracks = sounds::count(folders[kind]);
    if (!tracks) return {};
    int pick = int(roll() * float(tracks)) % tracks;
    if (tracks > 1 && pick == last[kind]) pick = (pick + 1) % tracks;
    last[kind] = pick;
    auto track = sounds::name(folders[kind], pick);
    MusicStream stream(sounds::encoded(track));
    until = seconds + (stream.valid() ? stream.duration() : 72);
    quietUntil = until + 100 + 140 * roll();
    return track;
}
}  // namespace hearthold

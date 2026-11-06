#pragma once

#include <cstddef>
#include <cstdint>
#include <span>
#include <string_view>
#include <vector>

struct stb_vorbis;

namespace hearthold
{
// A decoded mono clip.
struct Clip
{
    const int16_t* pcm = nullptr;
    size_t frames = 0;
    int rate = 22050;
    double duration() const { return rate > 0 ? double(frames) / rate : 0; }
    // The clip's level `seconds` in, played `pitch` times as fast, between its samples; 0 outside it.
    float at(double seconds, float pitch = 1) const;
};

// Where each hit in a clip begins, in seconds: wherever it rises past `threshold` of full scale after at least `gap`
// seconds below it.
std::vector<double> onsets(const Clip&, float threshold, double gap);

// The game's embedded sounds, by name: `ui/click_01`, `voice/huntress/attack_02`, `music/dawn/day_workers_morning`.
// A cue's variants share a prefix such as `ui/click_` and a moment's tracks one such as `music/dawn/`. Short clips
// decode the first time they are asked for and stay; music stays encoded and decodes as it plays.
namespace sounds
{
// How many sounds have names starting with `prefix`, and the name of the `index`th of them in order.
int count(std::string_view prefix);
std::string_view name(std::string_view prefix, int index);
// The `index`th clip under `prefix`, decoded the first time; empty if there is none. Safe from any thread.
Clip clip(std::string_view prefix, int index);
// What a voice clip says, when its words are known.
std::string_view caption(std::string_view name);
// A sound's encoded bytes, for streaming music.
std::span<const unsigned char> encoded(std::string_view name);
}  // namespace sounds

// A stereo music track at 44.1 kHz, decoded as it plays.
class MusicStream
{
public:
    explicit MusicStream(std::span<const unsigned char> encoded);
    ~MusicStream();
    MusicStream(const MusicStream&) = delete;
    MusicStream& operator=(const MusicStream&) = delete;
    bool valid() const { return decoder != nullptr; }
    double duration() const { return seconds; }
    // Fills up to `frames` interleaved stereo frames; returns how many it filled before the track ran out.
    int read(float* stereo, int frames);
    double played() const { return double(done) / 44100; }

private:
    stb_vorbis* decoder = nullptr;
    double seconds = 0;
    size_t done = 0;
};
}  // namespace hearthold

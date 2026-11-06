#include "sound_library.h"
#include "game_audio_data.h"
#include <stb_vorbis.c>
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <iterator>
#include <memory>
#include <mutex>
#include <vector>

namespace hearthold
{
namespace
{
using audio_data::entries;

// The entries whose names start with `prefix`: a run, since they are sorted by name.
std::span<const audio_data::Entry> under(std::string_view prefix)
{
    auto first = std::lower_bound(std::begin(entries), std::end(entries), prefix, [](const audio_data::Entry& entry, std::string_view key) { return entry.name < key; });
    auto last = first;
    while (last != std::end(entries) && last->name.starts_with(prefix)) ++last;
    return {first, last};
}

struct Decoded
{
    std::vector<int16_t> pcm;
    int rate = 0;
};

std::mutex decoding;
std::vector<std::unique_ptr<Decoded>> decoded(std::size(entries));
}  // namespace

float Clip::at(double seconds, float pitch) const
{
    if (!pcm || !std::isfinite(seconds) || !std::isfinite(pitch) || seconds < 0 || pitch <= 0) return 0;
    double frame = seconds * rate * pitch;
    if (frame >= double(frames) - 1) return 0;
    auto index = size_t(frame);
    float fraction = float(frame - double(index));
    return (pcm[index] + (pcm[index + 1] - pcm[index]) * fraction) / 32768.f;
}

std::vector<double> onsets(const Clip& clip, float threshold, double gap)
{
    std::vector<double> found;
    if (!clip.pcm || clip.rate <= 0) return found;
    int limit = int(threshold * 32767), quiet = int(gap * clip.rate), below = quiet;
    for (size_t i = 0; i < clip.frames; ++i) {
        if (std::abs(int(clip.pcm[i])) < limit) { ++below; continue; }
        if (below >= quiet) found.push_back(double(i) / clip.rate);
        below = 0;
    }
    return found;
}

namespace sounds
{
int count(std::string_view prefix) { return int(under(prefix).size()); }

std::string_view name(std::string_view prefix, int index)
{
    auto run = under(prefix);
    return index >= 0 && size_t(index) < run.size() ? run[size_t(index)].name : std::string_view{};
}

Clip clip(std::string_view prefix, int index)
{
    auto run = under(prefix);
    if (index < 0 || size_t(index) >= run.size()) return {};
    const auto& entry = run[size_t(index)];
    auto slot = size_t(&entry - std::begin(entries));
    std::lock_guard<std::mutex> guard(decoding);
    if (!decoded[slot]) {
        int channels = 0, rate = 0;
        short* samples = nullptr;
        int frames = stb_vorbis_decode_memory(entry.bytes, int(entry.size), &channels, &rate, &samples);
        auto clip = std::make_unique<Decoded>();
        if (frames > 0 && channels > 0 && samples) {
            // Mixed down to one channel: the board places every clip in the stereo field itself.
            clip->rate = rate;
            clip->pcm.resize(size_t(frames));
            for (int i = 0; i < frames; ++i) {
                int sum = 0;
                for (int c = 0; c < channels; ++c) sum += samples[size_t(i) * size_t(channels) + size_t(c)];
                clip->pcm[size_t(i)] = int16_t(sum / channels);
            }
        }
        std::free(samples);
        decoded[slot] = std::move(clip);
    }
    const auto& clip = *decoded[slot];
    return clip.pcm.empty() ? Clip{} : Clip{clip.pcm.data(), clip.pcm.size(), clip.rate};
}

std::string_view caption(std::string_view name)
{
    using audio_data::captions;
    auto found = std::lower_bound(std::begin(captions), std::end(captions), name, [](const audio_data::Caption& caption, std::string_view key) { return caption.name < key; });
    return found != std::end(captions) && found->name == name ? found->words : std::string_view{};
}

std::span<const unsigned char> encoded(std::string_view name)
{
    auto run = under(name);
    return !run.empty() && run.front().name == name ? std::span<const unsigned char>(run.front().bytes, run.front().size) : std::span<const unsigned char>{};
}
}  // namespace sounds

MusicStream::MusicStream(std::span<const unsigned char> encoded)
{
    if (encoded.empty()) return;
    int error = 0;
    decoder = stb_vorbis_open_memory(encoded.data(), int(encoded.size()), &error, nullptr);
    if (!decoder) return;
    auto info = stb_vorbis_get_info(decoder);
    if (info.sample_rate != 44100 || info.channels < 1 || info.channels > 2) {
        stb_vorbis_close(decoder);
        decoder = nullptr;
        return;
    }
    seconds = stb_vorbis_stream_length_in_seconds(decoder);
}

MusicStream::~MusicStream()
{
    if (decoder) stb_vorbis_close(decoder);
}

int MusicStream::read(float* stereo, int frames)
{
    if (!decoder || frames <= 0) return 0;
    int filled = 0;
    while (filled < frames) {
        int got = stb_vorbis_get_samples_float_interleaved(decoder, 2, stereo + 2 * filled, 2 * (frames - filled));
        if (got <= 0) break;
        filled += got;
    }
    done += size_t(filled);
    return filled;
}
}  // namespace hearthold

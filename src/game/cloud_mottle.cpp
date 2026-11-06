#include "cloud_mottle.h"
#include "world_map.h"
#include <algorithm>
#include <cmath>

namespace hearthold
{
namespace
{
// Value noise on a lattice that wraps every `period` cells, so the texture tiles without seams.
float wrappedNoise(float x, float y, int period, uint32_t seed)
{
    int x0 = int(std::floor(x)), y0 = int(std::floor(y));
    float fx = x - x0, fy = y - y0;
    auto at = [&](int cx, int cy) { return hash01(seed, ((cx % period) + period) % period, ((cy % period) + period) % period); };
    float sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    float top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    float bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return top + (bottom - top) * sy;
}
}  // namespace

std::vector<uint32_t> cloudMottle(int size, uint32_t seed)
{
    std::vector<uint32_t> pixels(size_t(size) * size);
    for (int y = 0; y < size; ++y)
        for (int x = 0; x < size; ++x) {
            float n = 0, weight = 0, amplitude = 1;
            for (int octave = 0, period = 6; octave < 4; ++octave, period *= 2, amplitude *= .5f) {
                float scale = float(period) / size;
                n += wrappedNoise(x * scale, y * scale, period, seed + uint32_t(octave)) * amplitude;
                weight += amplitude;
            }
            n /= weight;
            // Threshold the fBm into blotches with soft, ragged edges and clear gaps between.
            float t = std::clamp((n - .5f) / .18f, 0.f, 1.f);
            auto alpha = uint32_t(std::lround(255 * t * t * (3 - 2 * t)));
            pixels[size_t(y) * size + x] = alpha << 24 | 8u << 16 | 14u << 8 | 24u;
        }
    return pixels;
}
}  // namespace hearthold

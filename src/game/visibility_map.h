#pragma once

#include "world_map.h"
#include <span>

namespace hearthold
{
// A bounded world-space union of sight circles. History can be stamped once;
// current sight can be replaced without retaining past positions or easing in.
class VisibilityMap
{
public:
    struct Bounds { float x = 0, y = 0, w = 0, h = 0; };
    // Accumulated texel bounds; right and bottom are exclusive.
    struct Region
    {
        unsigned left = 0, top = 0, right = 0, bottom = 0;
        bool empty() const { return left >= right || top >= bottom; }
        void include(Region);
    };

    // The longest texture side has maxDimension texels, capped at 1024. Equal
    // arguments produce equal grids so current/explored coverage can be combined.
    void reset(int width, int height, float padding = 16, unsigned maxDimension = 512);
    bool clear();
    bool stamp(const Sight& sight);
    bool stamp(const Sight& sight, Region& changed);
    bool append(std::span<const Sight> sights);
    bool assign(std::span<const Sight> sights);
    bool assign(std::span<const Sight> sights, Region& changed);

    // Alpha is 255 through 70% of Sight.radius, 110 at 86%, and 0 at the radius,
    // matching sightDisc. Overlapping sources use max, so duplicates never grow
    // visibility. sample() uses the same bilinear texel-centre mapping as a mask.
    uint8_t sample(Point position) const;
    std::span<const uint8_t> coverage() const { return mask; }
    unsigned columns() const { return cols; }
    unsigned rows() const { return lines; }
    Bounds bounds() const { return area; }
    uint64_t revision() const { return version; }

private:
    Region extent(const Sight&) const;
    bool rasterize(std::vector<uint8_t>& target, const Sight&, Region clip, Region* changed = nullptr) const;
    std::vector<uint8_t> mask, scratch;
    std::vector<Sight> assignedSources;
    Bounds area;
    unsigned cols = 0, lines = 0;
    uint64_t version = 0;
    bool assigned = false;
};
}  // namespace hearthold

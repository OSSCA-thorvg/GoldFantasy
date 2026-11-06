#pragma once

#include "climate.h"
#include "vector_paint.h"
#include "world_map.h"
#include <array>
#include <optional>
#include <vector>

namespace hearthold
{
// Whether a range rises as bare dark basalt rather than a peak with a white head: where the land burns.
bool volcanicPeak(const WorldMap&, Point foot);

struct Peak
{
    Point foot;            // Where it stands, in tiles.
    float rise = 0;        // 0 for a low hill of a range, 1 for its highest.
    bool volcanic = false;
    float lean = 0;        // How far its top sits east of its foot, as a share of its half width (-.2 to .2).
};

// The peak standing on cell (x, y) of a range, if one does; none stand on Ymir or the volcano.
std::optional<Peak> peakAt(const WorldMap&, int x, int y);

// Peaks batched into a few shapes, lit from the west: grey stone with snow on the heights (and on every peak in
// winter), or bare dark basalt where the land burns.
class PeakBatch
{
public:
    explicit PeakBatch(const Climate&);
    PeakBatch(const PeakBatch&) = delete;
    PeakBatch& operator=(const PeakBatch&) = delete;
    ~PeakBatch();
    void add(const Peak&);
    // Hands over the shapes that hold anything, in drawing order, shaded for a row whose ground line lies at
    // screen y `base` at zoom 1.
    std::vector<tvg::Shape*> finish(float base);

private:
    enum Part { Lit, Shade, CapLit, CapShade, BasaltLit, BasaltShade, Parts };
    bool snowy;
    std::array<tvg::Shape*, Parts> parts{};
};
}  // namespace hearthold

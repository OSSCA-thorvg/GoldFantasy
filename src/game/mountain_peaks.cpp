#include "mountain_peaks.h"
#include <algorithm>

namespace hearthold
{
bool volcanicPeak(const WorldMap& map, Point foot) { return map.value(Layer::Heat, foot) > .62f; }

std::optional<Peak> peakAt(const WorldMap& map, int x, int y)
{
    Point middle{x + .5f, y + .5f};
    if (map.at(x, y).terrain != Terrain::Mountain || hash01(map.seed(), x, y, 62) >= .55f) return std::nullopt;
    if ((map.giant() && map.giant()->covers(middle)) || (map.volcano() && map.volcano()->covers(middle))) return std::nullopt;
    Peak peak;
    peak.foot = {x + .3f + hash01(map.seed(), x, y, 63) * .4f, y + .3f + hash01(map.seed(), x, y, 64) * .4f};
    peak.rise = std::clamp(map.value(Layer::Ridge, peak.foot) * 7, 0.f, 1.f);
    peak.volcanic = volcanicPeak(map, peak.foot);
    peak.lean = (hash01(map.seed(), x, y, 65) - .5f) * .4f;
    return peak;
}

PeakBatch::PeakBatch(const Climate& climate) : snowy(climate.snow > .3f)
{
    for (auto*& part : parts) part = tvg::Shape::gen();
}

PeakBatch::~PeakBatch()
{
    for (auto* part : parts)
        if (part) tvg::Paint::rel(part);
}

void PeakBatch::add(const Peak& peak)
{
    auto b = project(peak.foot.x, peak.foot.y);
    float w = 20 + 20 * peak.rise, top = 30 + 80 * peak.rise;
    Point left{b.x - w, b.y}, right{b.x + w, b.y}, front{b.x + w * .1f, b.y + w * .26f};
    // Two lit and shaded faces meeting at a ridge line, higher where the range is higher; in the burning south
    // bare dark basalt with a ragged shoulder, no snow and no fire: only the great volcano burns.
    Point apex{b.x + peak.lean * w, b.y - top};
    if (peak.volcanic) {
        auto shoulder = lerp(apex, right, .38f) + Point{-w * .04f, -top * .06f};
        appendPolygon(parts[BasaltLit], {left, apex, front});
        appendPolygon(parts[BasaltShade], {front, apex, shoulder, right});
        return;
    }
    appendPolygon(parts[Lit], {left, apex, front});
    appendPolygon(parts[Shade], {front, apex, right});
    if (peak.rise <= .35f && !snowy) return;
    float k = snowy ? .42f : .3f;
    auto along = [&](Point to, float t) { return Point{apex.x + (to.x - apex.x) * t, apex.y + (to.y - apex.y) * t}; };
    auto jag = lerp(along(left, k), along(front, k), .5f);
    jag.y -= top * .05f;
    appendPolygon(parts[CapLit], {apex, along(left, k), jag, along(front, k * 1.1f)});
    auto jag2 = lerp(along(front, k * 1.1f), along(right, k), .5f);
    jag2.y -= top * .06f;
    appendPolygon(parts[CapShade], {apex, along(front, k * 1.1f), jag2, along(right, k)});
}

std::vector<tvg::Shape*> PeakBatch::finish(float base)
{
    verticalShade(parts[Lit], {90, 88, 100}, base - 130, base + 10, 1.3f, .7f);
    verticalShade(parts[Shade], {56, 54, 68}, base - 130, base + 10, 1.3f, .7f);
    fill(parts[CapLit], opaque(Rgb{208, 214, 226}));
    fill(parts[CapShade], opaque(Rgb{146, 154, 174}));
    verticalShade(parts[BasaltLit], {82, 68, 64}, base - 130, base + 10, 1.25f, .75f);
    verticalShade(parts[BasaltShade], {48, 40, 42}, base - 130, base + 10, 1.25f, .75f);
    std::vector<tvg::Shape*> drawn;
    for (auto*& part : parts) {
        const tvg::Point* points = nullptr;
        uint32_t count = 0;
        part->path(nullptr, nullptr, &points, &count);
        if (count) drawn.push_back(part);
        else tvg::Paint::rel(part);
        part = nullptr;
    }
    return drawn;
}
}  // namespace hearthold

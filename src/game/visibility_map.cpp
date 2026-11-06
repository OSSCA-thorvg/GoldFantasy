#include "visibility_map.h"
#include <algorithm>
#include <cmath>
#include <limits>

namespace hearthold
{
namespace
{
bool sameSight(const Sight& a, const Sight& b)
{
    return a.center == b.center && a.radius == b.radius;
}
}

void VisibilityMap::Region::include(Region other)
{
    if (other.empty()) return;
    if (empty()) { *this = other; return; }
    left = std::min(left, other.left); top = std::min(top, other.top);
    right = std::max(right, other.right); bottom = std::max(bottom, other.bottom);
}

void VisibilityMap::reset(int width, int height, float padding, unsigned maxDimension)
{
    assigned = false;
    assignedSources.clear();
    padding = std::isfinite(padding) ? std::max(0.f, padding) : 0.f;
    const float spanWidth = width + padding * 2, spanHeight = height + padding * 2;
    if (width <= 0 || height <= 0 || !std::isfinite(spanWidth) || !std::isfinite(spanHeight)) {
        cols = lines = 0;
        area = {};
        mask.clear(); scratch.clear();
    } else {
        area = {-padding, -padding, spanWidth, spanHeight};
        maxDimension = std::clamp(maxDimension, 1u, 1024u);
        float longest = std::max(area.w, area.h);
        cols = std::clamp(unsigned(std::ceil(maxDimension * (area.w / longest))), 1u, maxDimension);
        lines = std::clamp(unsigned(std::ceil(maxDimension * (area.h / longest))), 1u, maxDimension);
        mask.assign(size_t(cols) * lines, 0);
        scratch.resize(mask.size());
    }
    ++version;
}

bool VisibilityMap::clear()
{
    assigned = false;
    assignedSources.clear();
    if (std::ranges::none_of(mask, [](uint8_t alpha) { return alpha != 0; })) return false;
    std::fill(mask.begin(), mask.end(), 0);
    ++version;
    return true;
}

VisibilityMap::Region VisibilityMap::extent(const Sight& sight) const
{
    if (!cols || !lines || !std::isfinite(sight.center.x) || !std::isfinite(sight.center.y) ||
        !std::isfinite(sight.radius) || sight.radius <= 0) return {};

    // Clamp in double before converting to int: an off-map or huge valid sight
    // must not overflow the index conversion or make work exceed the fixed grid.
    const double scaleX = cols / double(area.w), scaleY = lines / double(area.h);
    auto first = [](double coordinate, unsigned count) { return int(std::clamp(std::floor(coordinate), 0., double(count))); };
    auto last = [](double coordinate, unsigned count) { return int(std::clamp(std::ceil(coordinate), -1., double(count) - 1)); };
    return {unsigned(first((double(sight.center.x) - sight.radius - area.x) * scaleX, cols)),
            unsigned(first((double(sight.center.y) - sight.radius - area.y) * scaleY, lines)),
            unsigned(last((double(sight.center.x) + sight.radius - area.x) * scaleX, cols) + 1),
            unsigned(last((double(sight.center.y) + sight.radius - area.y) * scaleY, lines) + 1)};
}

bool VisibilityMap::rasterize(std::vector<uint8_t>& target, const Sight& sight, Region clip, Region* updates) const
{
    auto region = extent(sight);
    region.left = std::max(region.left, clip.left); region.top = std::max(region.top, clip.top);
    region.right = std::min(region.right, clip.right); region.bottom = std::min(region.bottom, clip.bottom);
    if (target.empty() || region.empty()) return false;
    const float stepX = area.w / cols, stepY = area.h / lines;
    const float inverseRadius = 1.f / std::max(sight.radius, std::numeric_limits<float>::min());
    bool changed = false;
    for (unsigned y = region.top; y < region.bottom; ++y) {
        const float dy = (area.y + (y + .5f) * stepY - sight.center.y) * inverseRadius;
        const float dy2 = dy * dy;
        if (dy2 >= 1) continue;
        auto* row = target.data() + size_t(y) * cols;
        for (unsigned x = region.left; x < region.right; ++x) {
            if (row[x] == 255) continue;
            const float dx = (area.x + (x + .5f) * stepX - sight.center.x) * inverseRadius;
            const float distance2 = dx * dx + dy2;
            if (distance2 >= 1) continue;
            uint8_t alpha = 255;
            if (distance2 > .7f * .7f) {
                const float t = std::sqrt(distance2);
                const float value = t < .86f ? 255 - (t - .7f) * (145 / .16f) : 110 - (t - .86f) * (110 / .14f);
                alpha = uint8_t(std::clamp(value + .5f, 0.f, 255.f));
            }
            if (alpha > row[x]) { row[x] = alpha; changed = true; }
        }
    }
    if (changed && updates) updates->include(region);
    return changed;
}

bool VisibilityMap::stamp(const Sight& sight)
{
    Region ignored;
    return stamp(sight, ignored);
}

bool VisibilityMap::stamp(const Sight& sight, Region& updates)
{
    assigned = false;
    bool changed = rasterize(mask, sight, {0, 0, cols, lines}, &updates);
    if (changed) ++version;
    return changed;
}

bool VisibilityMap::append(std::span<const Sight> sights)
{
    assigned = false;
    bool changed = false;
    for (const auto& sight : sights) changed |= rasterize(mask, sight, {0, 0, cols, lines});
    if (changed) ++version;
    return changed;
}

bool VisibilityMap::assign(std::span<const Sight> sights)
{
    Region ignored;
    return assign(sights, ignored);
}

bool VisibilityMap::assign(std::span<const Sight> sights, Region& updates)
{
    if (assigned && std::equal(sights.begin(), sights.end(), assignedSources.begin(), assignedSources.end(), sameSight)) return false;
    Region dirty;
    if (!assigned) dirty = {0, 0, cols, lines};
    else {
        // Removed and old positions must be cleared as well as newly visible positions.
        for (size_t i = 0; i < std::max(sights.size(), assignedSources.size()); ++i) {
            if (i < sights.size() && i < assignedSources.size() && sameSight(sights[i], assignedSources[i])) continue;
            if (i < sights.size()) dirty.include(extent(sights[i]));
            if (i < assignedSources.size()) dirty.include(extent(assignedSources[i]));
        }
    }
    bool changed = false;
    if (!dirty.empty()) {
        for (unsigned y = dirty.top; y < dirty.bottom; ++y)
            std::fill(scratch.begin() + size_t(y) * cols + dirty.left, scratch.begin() + size_t(y) * cols + dirty.right, 0);
        for (const auto& sight : sights) rasterize(scratch, sight, dirty);
        for (unsigned y = dirty.top; y < dirty.bottom; ++y) {
            auto first = size_t(y) * cols + dirty.left, last = size_t(y) * cols + dirty.right;
            if (std::equal(mask.begin() + first, mask.begin() + last, scratch.begin() + first)) continue;
            std::copy(scratch.begin() + first, scratch.begin() + last, mask.begin() + first);
            changed = true;
        }
    }
    if (changed) { ++version; updates.include(dirty); }
    assignedSources.assign(sights.begin(), sights.end());
    assigned = true;
    return changed;
}

uint8_t VisibilityMap::sample(Point position) const
{
    if (mask.empty() || !std::isfinite(position.x) || !std::isfinite(position.y) ||
        position.x < area.x || position.y < area.y || position.x >= area.x + area.w || position.y >= area.y + area.h) return 0;
    float x = std::clamp((position.x - area.x) / area.w * cols - .5f, 0.f, float(cols - 1));
    float y = std::clamp((position.y - area.y) / area.h * lines - .5f, 0.f, float(lines - 1));
    unsigned x0 = unsigned(x), y0 = unsigned(y);
    unsigned x1 = std::min(x0 + 1, cols - 1), y1 = std::min(y0 + 1, lines - 1);
    float tx = x - x0, ty = y - y0;
    float top = mask[size_t(y0) * cols + x0] * (1 - tx) + mask[size_t(y0) * cols + x1] * tx;
    float bottom = mask[size_t(y1) * cols + x0] * (1 - tx) + mask[size_t(y1) * cols + x1] * tx;
    return uint8_t(top * (1 - ty) + bottom * ty + .5f);
}
}  // namespace hearthold

#pragma once

#include <ui/text/text.h>
#include <algorithm>
#include <set>

namespace ui::platform
{
struct FontCoverage
{
    std::set<uint32_t> checked;
    std::vector<te::FontId> fallback;

    std::vector<uint32_t> pending(te::FontDatabase& fonts, te::FontId preferred, std::string_view text)
    {
        te::Codepoints points;
        points.add(text);
        std::vector<uint32_t> result;
        for (auto cp : points.values()) {
            if (!checked.insert(cp).second || fonts.glyph(preferred, cp)) continue;
            if (std::none_of(fallback.begin(), fallback.end(), [&](auto id) { return fonts.glyph(id, cp); })) result.push_back(cp);
        }
        return result;
    }
    void add(te::FontId id)
    {
        if (id && std::find(fallback.begin(), fallback.end(), id) == fallback.end()) fallback.push_back(id);
    }
    te::FontId best(te::FontDatabase& fonts, te::FontId preferred, std::string_view text) const
    {
        te::Codepoints points;
        points.add(text);
        const auto& values = points.values();
        auto missing = [&](auto id) {
            return std::count_if(values.begin(), values.end(), [&](auto cp) { return !fonts.glyph(id, cp); });
        };
        auto best = preferred;
        auto count = missing(best);
        for (auto id : fallback) {
            if (!count) break;
            auto next = missing(id);
            if (next < count) { best = id; count = next; }
        }
        return best;
    }
};
}  // namespace ui::platform

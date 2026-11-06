#include "internal.h"
#include "unicode_data.h"
#include <algorithm>

namespace te::detail
{
namespace
{
template<size_t Count>
uint8_t property(const PropertyRange (&ranges)[Count], uint32_t cp)
{
    auto found = std::upper_bound(ranges, ranges + Count, cp, [](uint32_t point, const auto& range) { return point < range.begin; });
    if (found == ranges || cp > (found - 1)->end) return 0;
    return (found - 1)->value;
}

template<typename Visit>
bool decode(std::string_view text, Visit visit)
{
    for (size_t i = 0; i < text.size();) {
        auto first = uint8_t(text[i]);
        size_t count = first < 0x80 ? 1 : first >= 0xc2 && first <= 0xdf ? 2
            : first >= 0xe0 && first <= 0xef                             ? 3
            : first >= 0xf0 && first <= 0xf4                             ? 4
                                                                         : 0;
        if (!count || count > text.size() - i) return false;
        uint32_t cp = first & (count == 1 ? 0x7f : count == 2 ? 0x1f
                                   : count == 3               ? 0xf
                                                              : 7);
        for (size_t j = 1; j < count; ++j) {
            auto next = uint8_t(text[i + j]);
            if ((next & 0xc0) != 0x80) return false;
            cp = (cp << 6) | (next & 63);
        }
        if ((count == 2 && cp < 0x80) || (count == 3 && cp < 0x800) || (count == 4 && cp < 0x10000)
            || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return false;
        visit(cp);
        i += count;
    }
    return true;
}
}  // namespace

bool ignorable(uint32_t cp)
{
    return property(defaultIgnorable, cp) != 0;
}
}  // namespace te::detail

namespace te
{
bool Codepoints::add(std::string_view text)
{
    return detail::decode(text, [&](uint32_t cp) {
        if (cp < 128) {
            auto bit = uint64_t(1) << (cp % 64);
            if (ascii[cp / 64] & bit) return;
            ascii[cp / 64] |= bit;
        } else {
            auto found = std::lower_bound(seen.begin(), seen.end(), cp);
            if (found != seen.end() && *found == cp) return;
            seen.insert(found, cp);
        }
        if (cp >= 32 && !detail::ignorable(cp)) list.push_back(cp);
    });
}
}  // namespace te

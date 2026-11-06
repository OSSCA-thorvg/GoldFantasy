#pragma once

#include <string_view>

namespace te::utf8
{
inline size_t sequenceLength(unsigned char first)
{
    return first < 0x80 ? 1 : first >= 0xc2 && first <= 0xdf ? 2
        : first >= 0xe0 && first <= 0xef ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 0;
}

inline bool validSequence(std::string_view bytes)
{
    if (bytes.empty()) return false;
    auto first = static_cast<unsigned char>(bytes[0]);
    if (sequenceLength(first) != bytes.size()) return false;
    for (size_t i = 1; i < bytes.size(); ++i)
        if ((static_cast<unsigned char>(bytes[i]) & 0xc0) != 0x80) return false;
    if (bytes.size() < 3) return true;
    auto second = static_cast<unsigned char>(bytes[1]);
    return !((first == 0xe0 && second < 0xa0) || (first == 0xed && second >= 0xa0) ||
             (first == 0xf0 && second < 0x90) || (first == 0xf4 && second >= 0x90));
}
}  // namespace te::utf8

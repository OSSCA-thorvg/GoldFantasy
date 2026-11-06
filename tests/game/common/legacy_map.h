#pragma once

#include <game/world_map.h>
#include <sstream>
#include <string>

namespace hearthold::test
{
inline void removeStoneColumn(std::string& map)
{
    size_t start = 0;
    for (size_t line = 0; line < 2 + size_t(Layer::Count); ++line) start = map.find('\n', start) + 1;
    auto end = map.find('\n', start);
    std::istringstream in(map.substr(start, end - start)); std::ostringstream out;
    int trees, wild, quarried;
    while (in >> trees >> wild >> quarried) out << trees << ' ' << wild << ' ';
    map.replace(start, end - start, out.str());
}
}  // namespace hearthold::test

#pragma once

#include <ui/text/text.h>
#include <thorvg.h>
#include <filesystem>
#include <memory>
#include <unordered_map>
#include <array>

namespace te::detail
{
struct Face
{
    struct Backend;
    std::unique_ptr<Backend> backend;
    std::vector<unsigned char> bytes;
    FontInfo info;
    float unitsPerEm = 1000;
    mutable std::unordered_map<uint32_t, uint32_t> cmap;
    mutable std::array<uint64_t, 1024> coverage{}, known{};
    static std::unique_ptr<Face> make(std::vector<unsigned char> bytes, unsigned index, std::string name, std::string& error);
    ~Face();
    uint32_t glyph(uint32_t codepoint) const;
    std::vector<unsigned char> textData() const;
    float textKerning(uint32_t left, uint32_t right) const;
};
bool ignorable(uint32_t codepoint);
}  // namespace te::detail

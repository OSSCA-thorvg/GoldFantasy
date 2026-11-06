#include "internal.h"
#include <algorithm>
#include <cstring>
#include <limits>

#if defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wunused-function"
#endif
#define STBTT_STATIC
#define STB_TRUETYPE_IMPLEMENTATION
#include <stb_truetype.h>
#if defined(__GNUC__)
#pragma GCC diagnostic pop
#endif

namespace te::detail
{
struct Face::Backend
{
    stbtt_fontinfo font{};
};
namespace
{
uint16_t u16(const unsigned char* p)
{
    return uint16_t(p[0]) << 8 | p[1];
}
uint32_t u32(const unsigned char* p)
{
    return uint32_t(p[0]) << 24 | uint32_t(p[1]) << 16 | uint32_t(p[2]) << 8 | p[3];
}
size_t table(const std::vector<unsigned char>& bytes, size_t offset, const char* tag)
{
    auto count = u16(bytes.data() + offset + 4);
    for (size_t i = 0; i < count; ++i) {
        auto record = bytes.data() + offset + 12 + i * 16;
        if (!std::memcmp(record, tag, 4)) return u32(record + 8);
    }
    return 0;
}
bool validDirectory(const std::vector<unsigned char>& bytes, size_t offset)
{
    if (offset > bytes.size() || bytes.size() - offset < 12) return false;
    auto count = u16(bytes.data() + offset + 4);
    if (!count || count > (bytes.size() - offset - 12) / 16) return false;
    for (size_t i = 0; i < count; ++i) {
        auto record = bytes.data() + offset + 12 + i * 16;
        size_t start = u32(record + 8), size = u32(record + 12);
        if (start > bytes.size() || size > bytes.size() - start) return false;
        if ((!std::memcmp(record, "head", 4) && size < 54) || (!std::memcmp(record, "hhea", 4) && size < 36)
            || (!std::memcmp(record, "maxp", 4) && size < 6) || (!std::memcmp(record, "cmap", 4) && size < 4)) return false;
    }
    return table(bytes, offset, "head") && table(bytes, offset, "hhea") && table(bytes, offset, "maxp") && table(bytes, offset, "cmap");
}
void utf8(std::string& result, uint32_t cp)
{
    if (cp < 0x80) result += char(cp);
    else if (cp < 0x800) {
        result += char(0xc0 | cp >> 6);
        result += char(0x80 | (cp & 63));
    } else if (cp < 0x10000) {
        result += char(0xe0 | cp >> 12);
        result += char(0x80 | ((cp >> 6) & 63));
        result += char(0x80 | (cp & 63));
    } else {
        result += char(0xf0 | cp >> 18);
        result += char(0x80 | ((cp >> 12) & 63));
        result += char(0x80 | ((cp >> 6) & 63));
        result += char(0x80 | (cp & 63));
    }
}
std::string name(const stbtt_fontinfo& font, int id)
{
    int size = 0;
    auto value = stbtt_GetFontNameString(&font, &size, 3, 1, 0x409, id);
    if (!value) value = stbtt_GetFontNameString(&font, &size, 0, 3, 0, id);
    if (!value && id == 6) {
        // PostScript names are ASCII, including in Macintosh Roman records.
        value = stbtt_GetFontNameString(&font, &size, 1, 0, 0, id);
        if (value && std::all_of(value, value + size, [](unsigned char ch) { return ch >= 32 && ch < 127; })) return {value, size_t(size)};
        return {};
    }
    if (!value) return {};
    std::string result;
    for (int i = 0; i + 1 < size; i += 2) {
        uint32_t cp = u16(reinterpret_cast<const unsigned char*>(value + i));
        if (cp >= 0xd800 && cp <= 0xdbff && i + 3 < size) {
            auto low = u16(reinterpret_cast<const unsigned char*>(value + i + 2));
            if (low < 0xdc00 || low > 0xdfff) continue;
            cp = 0x10000 + ((cp - 0xd800) << 10) + low - 0xdc00;
            i += 2;
        }
        if (cp >= 0xd800 && cp <= 0xdfff) continue;
        utf8(result, cp);
    }
    return result;
}
}  // namespace

std::unique_ptr<Face> Face::make(std::vector<unsigned char> bytes, unsigned index, std::string requestedName, std::string& error)
{
    if (bytes.size() < 12 || bytes.size() > size_t(std::numeric_limits<int>::max()) || index > unsigned(std::numeric_limits<int>::max())) {
        error = "invalid font size or face index";
        return {};
    }
    size_t offset = 0;
    if (!std::memcmp(bytes.data(), "ttcf", 4)) {
        auto count = u32(bytes.data() + 8);
        if (count > (bytes.size() - 12) / 4 || index >= count) {
            error = "invalid font collection";
            return {};
        }
        offset = u32(bytes.data() + 12 + size_t(index) * 4);
    } else if (index) {
        error = "face index is outside the font";
        return {};
    }
    if (!validDirectory(bytes, offset)) {
        error = "invalid font table directory";
        return {};
    }
    auto face = std::unique_ptr<Face>(new Face);
    face->bytes = std::move(bytes);
    face->backend = std::make_unique<Backend>();
    auto& font = face->backend->font;
    if (!stbtt_InitFont(&font, face->bytes.data(), int(offset))) {
        error = "unsupported font outlines";
        return {};
    }
    auto head = table(face->bytes, offset, "head");
    face->unitsPerEm = u16(face->bytes.data() + head + 18);
    if (!face->unitsPerEm || font.numGlyphs < 1) {
        error = "invalid font metrics";
        return {};
    }
    face->info.family = name(font, 1);
    face->info.name = requestedName.empty() ? name(font, 6) : std::move(requestedName);
    if (face->info.name.empty()) face->info.name = face->info.family;
    auto flags = u16(face->bytes.data() + head + 44);
    face->info.weight = flags & 1 ? 700 : 400;
    face->info.italic = (flags & 2) != 0;
    face->info.index = index;
    return face;
}
Face::~Face() = default;

std::vector<unsigned char> Face::textData() const
{
    if (std::memcmp(bytes.data(), "ttcf", 4)) return bytes;
    // Text::load has no collection index. Supply the selected face as a
    // standalone SFNT, with its table offsets and checksum adjusted.
    size_t offset = size_t(backend->font.fontstart);
    auto count = u16(bytes.data() + offset + 4);
    std::vector<unsigned char> result(bytes.begin() + offset, bytes.begin() + offset + 12 + size_t(count) * 16);
    auto put32 = [&](size_t at, uint32_t value) {
        for (unsigned i = 0; i < 4; ++i) result[at + i] = uint8_t(value >> (24 - i * 8));
    };
    size_t head = 0;
    for (size_t i = 0; i < count; ++i) {
        auto record = bytes.data() + offset + 12 + i * 16;
        size_t start = u32(record + 8), size = u32(record + 12);
        result.resize((result.size() + 3) & ~size_t(3), 0);
        size_t target = result.size();
        put32(12 + i * 16 + 8, uint32_t(target));
        result.insert(result.end(), bytes.begin() + start, bytes.begin() + start + size);
        if (!std::memcmp(record, "head", 4)) {
            head = target;
            put32(head + 8, 0);
        }
    }
    result.resize((result.size() + 3) & ~size_t(3), 0);
    if (head) {
        uint32_t sum = 0;
        for (size_t i = 0; i < result.size(); i += 4) sum += u32(result.data() + i);
        put32(head + 8, 0xb1b0afba - sum);
    }
    return result;
}

uint32_t Face::glyph(uint32_t codepoint) const
{
    if (codepoint > 0x10ffff || (codepoint >= 0xd800 && codepoint <= 0xdfff)) return 0;
    if (codepoint < 0x10000) {
        auto bit = uint64_t(1) << (codepoint % 64);
        if ((known[codepoint / 64] & bit) && !(coverage[codepoint / 64] & bit)) return 0;
    }
    auto found = cmap.find(codepoint);
    if (found != cmap.end()) return found->second;
    auto id = uint32_t(stbtt_FindGlyphIndex(&backend->font, int(codepoint)));
    if (codepoint < 0x10000) {
        known[codepoint / 64] |= uint64_t(1) << (codepoint % 64);
        if (id) coverage[codepoint / 64] |= uint64_t(1) << (codepoint % 64);
    }
    if (id) cmap.emplace(codepoint, id);
    return id;
}
float Face::textKerning(uint32_t left, uint32_t right) const
{
    if (left >= unsigned(backend->font.numGlyphs) || right >= unsigned(backend->font.numGlyphs)) return 0;
    if (!backend->font.glyf || !backend->font.kern) return 0;
    // ThorVG's native SFNT Text path applies the legacy kern table.
    auto font = backend->font;
    font.gpos = 0;
    return float(stbtt_GetGlyphKernAdvance(&font, int(left), int(right)));
}
}  // namespace te::detail

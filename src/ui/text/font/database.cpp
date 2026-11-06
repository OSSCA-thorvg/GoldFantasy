#include "internal.h"
#include <core/io/path.h>
#include <algorithm>
#include <cctype>
#include <fstream>
#include <limits>

namespace te
{
struct FontDatabase::Impl
{
    std::vector<std::unique_ptr<detail::Face>> faces;
    std::vector<FontInfo> infos;
    std::vector<FontId> fallback;
    uint64_t generation = 1;
    std::string error;
    std::unordered_map<FontId, std::string> textFonts;
    detail::Face* face(FontId id) const { return id && id <= faces.size() ? faces[id - 1].get() : nullptr; }
};
namespace
{
std::string key(std::string_view name)
{
    std::string result;
    for (unsigned char ch : name)
        if (ch != ' ' && ch != '-' && ch != '_') result += char(ch < 128 ? std::tolower(ch) : ch);
    return result;
}
}  // namespace
FontDatabase::FontDatabase() : impl(new Impl) {}
FontDatabase::~FontDatabase()
{
    for (const auto& entry : impl->textFonts) tvg::Text::unload(entry.second.c_str());
    delete impl;
}
FontDatabase* FontDatabase::gen()
{
    return new FontDatabase;
}

FontId FontDatabase::load(const char* utf8Path, unsigned index)
{
    if (!utf8Path || !*utf8Path) {
        impl->error = "empty font path";
        return 0;
    }
    std::error_code ec;
    auto path = std::filesystem::canonical(io::pathFromUtf8(utf8Path), ec);
    if (ec) {
        impl->error = "cannot resolve font path";
        return 0;
    }
    auto pathText = io::pathToUtf8(path);
    for (const auto& info : impl->infos)
        if (info.path == pathText && info.index == index) return info.id;
    std::ifstream input(path, std::ios::binary | std::ios::ate);
    auto size = input.tellg();
    if (!input || size < 12) {
        impl->error = "cannot read font";
        return 0;
    }
    if (size > std::numeric_limits<int>::max()) {
        impl->error = "font exceeds parser address range";
        return 0;
    }
    std::vector<unsigned char> bytes(size_t(size), 0);
    input.seekg(0);
    input.read(reinterpret_cast<char*>(bytes.data()), size);
    if (!input) {
        impl->error = "cannot read complete font";
        return 0;
    }
    auto face = detail::Face::make(std::move(bytes), index, {}, impl->error);
    if (!face) return 0;
    face->info.id = FontId(impl->faces.size() + 1);
    face->info.path = std::move(pathText);
    impl->infos.push_back(face->info);
    impl->faces.push_back(std::move(face));
    ++impl->generation;
    impl->error.clear();
    return impl->infos.back().id;
}
FontId FontDatabase::load(const char* name, const void* bytes, size_t size, unsigned index)
{
    if (!bytes || size < 12 || size > size_t(std::numeric_limits<int>::max())) {
        impl->error = "invalid font bytes";
        return 0;
    }
    auto begin = static_cast<const unsigned char*>(bytes);
    auto face = detail::Face::make({begin, begin + size}, index, name ? name : "", impl->error);
    if (!face) return 0;
    face->info.id = FontId(impl->faces.size() + 1);
    impl->infos.push_back(face->info);
    impl->faces.push_back(std::move(face));
    ++impl->generation;
    impl->error.clear();
    return impl->infos.back().id;
}
FontId FontDatabase::find(std::string_view name, unsigned weight, bool italic) const
{
    auto target = key(name);
    FontId best = 0;
    unsigned distance = ~0u;
    for (const auto& info : impl->infos) {
        if (key(info.name) != target && key(info.family) != target && key(io::pathToUtf8(io::pathFromUtf8(info.path).stem())) != target) continue;
        auto score = unsigned(std::abs(int(info.weight) - int(weight))) + (info.italic != italic ? 1000u : 0u);
        if (score < distance) {
            distance = score;
            best = info.id;
        }
    }
    return best;
}
const std::vector<FontInfo>& FontDatabase::fonts() const
{
    return impl->infos;
}
float FontDatabase::unitsPerEm(FontId font) const
{
    auto face = impl->face(font);
    return face ? face->unitsPerEm : 1000;
}
uint32_t FontDatabase::glyph(FontId font, uint32_t codepoint) const
{
    auto face = impl->face(font);
    return face ? face->glyph(codepoint) : 0;
}
const char* FontDatabase::textFont(FontId font)
{
    auto found = impl->textFonts.find(font);
    if (found != impl->textFonts.end()) return found->second.c_str();
    auto face = impl->face(font);
    if (!face) return nullptr;
    auto bytes = face->textData();
    auto name = "textengine-" + std::to_string(reinterpret_cast<uintptr_t>(this)) + "-" + std::to_string(font);
    if (tvg::Text::load(name.c_str(), reinterpret_cast<const char*>(bytes.data()), uint32_t(bytes.size()), "ttf", true) != tvg::Result::Success) {
        impl->error = "ThorVG Text cannot load this font face";
        return nullptr;
    }
    return impl->textFonts.emplace(font, std::move(name)).first->second.c_str();
}
FontId FontDatabase::textFontFor(FontId preferred, std::string_view text) const
{
    Codepoints codepoints;
    return codepoints.add(text) ? textFontFor(preferred, codepoints) : preferred;
}
FontId FontDatabase::textFontFor(FontId preferred, const Codepoints& set) const
{
    const auto& codepoints = set.values();
    auto missing = [&](FontId font) {
        return size_t(std::count_if(codepoints.begin(), codepoints.end(), [&](uint32_t cp) { return glyph(font, cp) == 0; }));
    };
    FontId best = preferred;
    auto count = missing(best);
    if (!count) return best;
    for (auto font : impl->fallback) {
        auto value = missing(font);
        if (value < count) { best = font; count = value; }
        if (!count) break;
    }
    return best;
}
float FontDatabase::textKerning(FontId font, uint32_t left, uint32_t right) const
{
    auto face = impl->face(font);
    return face ? face->textKerning(left, right) : 0;
}
void FontDatabase::fallbacks(std::vector<FontId> fonts)
{
    fonts.erase(std::remove_if(fonts.begin(), fonts.end(), [&](auto id) { return !impl->face(id); }), fonts.end());
    if (fonts != impl->fallback) {
        impl->fallback = std::move(fonts);
        ++impl->generation;
    }
}
uint64_t FontDatabase::generation() const
{
    return impl->generation;
}
const std::string& FontDatabase::error() const
{
    return impl->error;
}
}  // namespace te

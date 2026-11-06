#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace te
{

using FontId = uint32_t;

// Distinct codepoints that need a glyph; controls and default-ignorable characters are skipped.
class Codepoints
{
public:
    // False on invalid UTF-8; codepoints before the error are kept.
    bool add(std::string_view utf8);
    const std::vector<uint32_t>& values() const { return list; }

private:
    uint64_t ascii[2] = {};
    std::vector<uint32_t> seen, list;  // seen: sorted non-ASCII codepoints
};

struct FontInfo
{
    FontId id = 0;
    std::string family, name, path;
    unsigned index = 0, weight = 400;
    bool italic = false;
};
// One database per host/engine. IDs and face bytes live until database destruction.
// Access on its owning thread; text rendering must not outlive the database.
class FontDatabase
{
public:
    static FontDatabase* gen();
    ~FontDatabase();
    FontDatabase(const FontDatabase&) = delete;
    FontDatabase& operator=(const FontDatabase&) = delete;
    FontId load(const char* utf8Path, unsigned index = 0);
    FontId load(const char* name, const void* bytes, size_t size, unsigned index = 0);
    FontId find(std::string_view name, unsigned weight = 400, bool italic = false) const;
    const std::vector<FontInfo>& fonts() const;
    // Font design units per em, used to scale textKerning() to the text size.
    float unitsPerEm(FontId font) const;
    uint32_t glyph(FontId font, uint32_t codepoint) const;
    // Lazily register this face with ThorVG Text. The returned name lives with
    // the database; ThorVG must be initialized when this method is called.
    const char* textFont(FontId font);
    // Choose one configured face for the whole string; prefer the requested
    // face when coverage is equal, then use the ordered fallback stack.
    FontId textFontFor(FontId preferred, std::string_view text) const;
    FontId textFontFor(FontId preferred, const Codepoints& codepoints) const;
    float textKerning(FontId font, uint32_t left, uint32_t right) const;
    void fallbacks(std::vector<FontId> fonts);
    uint64_t generation() const;
    const std::string& error() const;

private:
    FontDatabase();
    struct Impl;
    Impl* impl;
};

}  // namespace te

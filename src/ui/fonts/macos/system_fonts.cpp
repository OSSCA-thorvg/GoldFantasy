#include <ui/fonts/system_fonts.h>
#include <ui/fonts/font_coverage.h>
#include <algorithm>
#include <unordered_map>
#include <CoreText/CoreText.h>

namespace ui
{
namespace
{
std::string utf8(CFStringRef value)
{
    if (!value) return {};
    std::string result(size_t(CFStringGetMaximumSizeForEncoding(CFStringGetLength(value), kCFStringEncodingUTF8)) + 1, '\0');
    if (!CFStringGetCString(value, result.data(), result.size(), kCFStringEncodingUTF8)) return {};
    result.resize(std::char_traits<char>::length(result.c_str()));
    return result;
}
void u16(std::vector<unsigned char>& bytes, size_t at, uint16_t value)
{
    bytes[at] = value >> 8;
    bytes[at + 1] = value & 255;
}
void u32(std::vector<unsigned char>& bytes, size_t at, uint32_t value)
{
    u16(bytes, at, value >> 16);
    u16(bytes, at + 2, value & 65535);
}
uint32_t checksum(const std::vector<unsigned char>& bytes)
{
    uint32_t result = 0;
    for (size_t i = 0; i < bytes.size(); i += 4) {
        uint32_t word = 0;
        for (size_t j = 0; j < 4; ++j)
            word = (word << 8) | (i + j < bytes.size() ? bytes[i + j] : 0);
        result += word;
    }
    return result;
}
// Copy only the selected face's tables. A system TTC can contain hundreds of MiB
// of unrelated faces; no system-font filename or collection index is assumed.
std::vector<unsigned char> fontData(CTFontRef font)
{
    struct Table
    {
        CTFontTableTag tag;
        std::vector<unsigned char> bytes;
    };
    std::vector<Table> tables;
    for (auto tag : {kCTFontTableHead, kCTFontTableHhea, kCTFontTableMaxp, kCTFontTableHmtx, kCTFontTableCmap,
                     kCTFontTableLoca, kCTFontTableGlyf, kCTFontTableCFF, kCTFontTableName, kCTFontTableKern,
                     kCTFontTableGPOS, kCTFontTableOS2, kCTFontTablePost}) {
        auto data = CTFontCopyTable(font, tag, kCTFontTableOptionNoOptions);
        if (!data) continue;
        auto length = CFDataGetLength(data);
        if (!length) {
            CFRelease(data);
            continue;
        }
        auto begin = CFDataGetBytePtr(data);
        tables.push_back({tag, {begin, begin + length}});
        CFRelease(data);
        if (tag == kCTFontTableHead && tables.back().bytes.size() >= 12) u32(tables.back().bytes, 8, 0);
    }
    if (std::none_of(tables.begin(), tables.end(), [](const auto& table) { return table.tag == kCTFontTableGlyf || table.tag == kCTFontTableCFF; })) return {};
    std::sort(tables.begin(), tables.end(), [](const auto& a, const auto& b) { return a.tag < b.tag; });
    std::vector<unsigned char> bytes(12 + tables.size() * 16);
    bool cff = std::any_of(tables.begin(), tables.end(), [](const auto& table) { return table.tag == kCTFontTableCFF; });
    u32(bytes, 0, cff ? 0x4f54544f : 0x00010000);
    u16(bytes, 4, uint16_t(tables.size()));
    uint16_t power = 1, selector = 0;
    while (power * 2 <= tables.size()) {
        power *= 2;
        ++selector;
    }
    u16(bytes, 6, power * 16);
    u16(bytes, 8, selector);
    u16(bytes, 10, uint16_t(tables.size() * 16 - power * 16));
    size_t head = 0;
    for (size_t i = 0; i < tables.size(); ++i) {
        auto& table = tables[i];
        auto offset = bytes.size();
        u32(bytes, 12 + i * 16, table.tag);
        u32(bytes, 16 + i * 16, checksum(table.bytes));
        u32(bytes, 20 + i * 16, uint32_t(offset));
        u32(bytes, 24 + i * 16, uint32_t(table.bytes.size()));
        if (table.tag == kCTFontTableHead && table.bytes.size() >= 12) head = offset;
        bytes.insert(bytes.end(), table.bytes.begin(), table.bytes.end());
        bytes.resize((bytes.size() + 3) & ~size_t(3), 0);
    }
    if (head) u32(bytes, head + 8, 0xb1b0afba - checksum(bytes));
    return bytes;
}
}  // namespace

struct SystemFonts::Impl
{
    te::FontDatabase& fonts;
    explicit Impl(te::FontDatabase& value) : fonts(value) {}
    CTFontRef system = CTFontCreateUIFontForLanguage(kCTFontUIFontSystem, 16, nullptr);
    CTFontRef emphasized = CTFontCreateUIFontForLanguage(kCTFontUIFontEmphasizedSystem, 16, nullptr);
    CTFontRef document = CTFontCreateUIFontForLanguage(kCTFontUIFontUser, 16, nullptr);
    te::FontId primary = 0, boldPrimary = 0;
    platform::FontCoverage uiCoverage[2];
    std::unordered_map<std::string, te::FontId> loaded;
    ~Impl()
    {
        if (system) CFRelease(system);
        if (emphasized) CFRelease(emphasized);
        if (document) CFRelease(document);
    }
    te::FontId load(CTFontRef font)
    {
        if (!font) return 0;
        auto name = CTFontCopyPostScriptName(font);
        auto key = utf8(name);
        if (name) CFRelease(name);
        auto found = loaded.find(key);
        if (found != loaded.end()) return found->second;
        auto bytes = fontData(font);
        auto id = bytes.empty() ? 0 : fonts.load(key.c_str(), bytes.data(), bytes.size());
        loaded.emplace(std::move(key), id);
        return id;
    }
    te::FontId substitute(CTFontRef base, CFStringRef string, CFRange range)
    {
        auto face = CTFontCreateForStringWithLanguage(base, string, range, nullptr);
        auto id = load(face);
        if (face) CFRelease(face);
        // Private UI outlines may need a public document-font alternative.
        if (!id && document) {
            face = CTFontCreateForStringWithLanguage(document, string, range, nullptr);
            id = load(face);
            if (face) CFRelease(face);
        }
        return id;
    }
};

SystemFonts::SystemFonts(te::FontDatabase& fonts) : impl(std::make_unique<Impl>(fonts)) {}
SystemFonts::~SystemFonts() = default;
te::FontId SystemFonts::defaultFont(bool bold)
{
    if (bold) {
        if (!impl->boldPrimary) impl->boldPrimary = impl->load(impl->emphasized);
        return impl->boldPrimary;
    }
    if (!impl->primary) impl->primary = impl->load(impl->system);
    return impl->primary;
}

te::FontId SystemFonts::uiFont(std::string_view text, bool bold)
{
    auto primary = defaultFont(bold);
    if (!primary) return 0;
    auto& coverage = impl->uiCoverage[bold ? 1 : 0];
    for (auto cp : coverage.pending(impl->fonts, primary, text)) {
        UniChar characters[2];
        CFIndex count = 1;
        if (cp < 0x10000) characters[0] = UniChar(cp);
        else {
            characters[0] = UniChar(0xd800 + ((cp - 0x10000) >> 10));
            characters[1] = UniChar(0xdc00 + ((cp - 0x10000) & 0x3ff));
            count = 2;
        }
        auto string = CFStringCreateWithCharacters(nullptr, characters, count);
        if (!string) continue;
        coverage.add(impl->substitute(bold ? impl->emphasized : impl->system, string, CFRangeMake(0, count)));
        CFRelease(string);
    }
    return coverage.best(impl->fonts, primary, text);
}

}  // namespace ui

#include <test/test.h>
#include <test/graphics.h>
#include <ui/fonts/system_fonts.h>
#ifdef __linux__
#include <fontconfig/fontconfig.h>
#endif
#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <dwrite.h>
#include <wrl/client.h>
#endif

namespace
{
bool cjkAvailable()
{
#ifdef __linux__
    auto pattern = FcPatternCreate();
    auto charset = FcCharSetCreate();
    FcCharSetAddChar(charset, 0x4e2d);
    FcPatternAddCharSet(pattern, FC_CHARSET, charset);
    FcConfigSubstitute(nullptr, pattern, FcMatchPattern);
    FcDefaultSubstitute(pattern);
    FcResult status;
    auto match = FcFontMatch(nullptr, pattern, &status);
    FcCharSet* supported = nullptr;
    bool available = match && FcPatternGetCharSet(match, FC_CHARSET, 0, &supported) == FcResultMatch && FcCharSetHasChar(supported, 0x4e2d);
    if (match) FcPatternDestroy(match);
    FcCharSetDestroy(charset);
    FcPatternDestroy(pattern);
    return available;
#elif defined(_WIN32)
    using Microsoft::WRL::ComPtr;
    ComPtr<IDWriteFactory> factory;
    ComPtr<IDWriteFontCollection> collection;
    if (FAILED(DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED, __uuidof(IDWriteFactory), reinterpret_cast<IUnknown**>(factory.GetAddressOf()))) ||
        FAILED(factory->GetSystemFontCollection(collection.GetAddressOf()))) return false;
    for (UINT32 i = 0; i < collection->GetFontFamilyCount(); ++i) {
        ComPtr<IDWriteFontFamily> family;
        ComPtr<IDWriteFont> font;
        BOOL supported = FALSE;
        if (SUCCEEDED(collection->GetFontFamily(i, family.GetAddressOf())) &&
            SUCCEEDED(family->GetFirstMatchingFont(DWRITE_FONT_WEIGHT_NORMAL, DWRITE_FONT_STRETCH_NORMAL, DWRITE_FONT_STYLE_NORMAL, font.GetAddressOf())) &&
            SUCCEEDED(font->HasCharacter(0x4e2d, &supported)) && supported) return true;
    }
    return false;
#else
    return true;
#endif
}
}


TEST(hearthold_system_fonts_resolve_regular_and_bold_text)
{
    te::test::Graphics graphics;
    std::unique_ptr<te::FontDatabase> fonts(te::FontDatabase::gen());
    ui::SystemFonts system(*fonts);
    auto regular = system.uiFont("English text", false);
    auto bold = system.uiFont("English text", true);
#if defined(__APPLE__) || defined(_WIN32) || defined(__linux__)
    if (!regular) { te::test::skip("No usable system font is installed"); return; }
    CHECK(bold);
    CHECK(fonts->textFont(regular) && fonts->textFont(bold));
    CHECK(fonts->glyph(regular, 'E') && fonts->glyph(bold, 'E'));
    auto generation = fonts->generation();
    CHECK_EQ(system.uiFont("English text", false), regular);
    CHECK_EQ(system.uiFont("English text", true), bold);
    CHECK_EQ(fonts->generation(), generation);
#else
    CHECK_EQ(regular, te::FontId(0));
    CHECK_EQ(bold, te::FontId(0));
#endif
}

TEST(hearthold_system_fonts_cover_cjk_and_cache_fallbacks)
{
    te::test::Graphics graphics;
    std::unique_ptr<te::FontDatabase> fonts(te::FontDatabase::gen());
    ui::SystemFonts system(*fonts);
    if (!system.uiFont("English text") || !cjkAvailable()) {
        te::test::skip("No CJK system font is installed");
        return;
    }
    const char* text = "A中文B";
    auto cjk = system.uiFont(text);
    CHECK(cjk);
    for (auto cp : {0x41, 0x4e2d, 0x6587, 0x42}) CHECK(fonts->glyph(cjk, cp));
    auto generation = fonts->generation();
    auto count = fonts->fonts().size();
    CHECK_EQ(system.uiFont(text), cjk);
    CHECK_EQ(fonts->generation(), generation);
    CHECK_EQ(fonts->fonts().size(), count);
}

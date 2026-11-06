#include <ui/fonts/system_fonts.h>
#include <ui/fonts/font_coverage.h>
#include <fontconfig/fontconfig.h>
#include <map>

namespace ui
{
namespace
{
using Pattern = std::unique_ptr<FcPattern, decltype(&FcPatternDestroy)>;
using FontSet = std::unique_ptr<FcFontSet, decltype(&FcFontSetDestroy)>;
using CharSet = std::unique_ptr<FcCharSet, decltype(&FcCharSetDestroy)>;
}

struct SystemFonts::Impl
{
    te::FontDatabase& fonts;
    std::unique_ptr<FcConfig, decltype(&FcConfigDestroy)> config{FcInitLoadConfigAndFonts(), FcConfigDestroy};
    te::FontId primary[2]{};
    bool attempted[2]{};
    std::map<te::FontId, platform::FontCoverage> coverage;
    explicit Impl(te::FontDatabase& value) : fonts(value) {}

    Pattern pattern(te::FontId preferred, bool bold, FcCharSet* characters = nullptr)
    {
        Pattern result(FcPatternCreate(), FcPatternDestroy);
        if (!result) return result;
        auto family = "sans-serif";
        auto weight = bold ? FC_WEIGHT_BOLD : FC_WEIGHT_REGULAR;
        auto slant = FC_SLANT_ROMAN;
        if (preferred && preferred <= fonts.fonts().size()) {
            const auto& info = fonts.fonts()[preferred - 1];
            if (!info.family.empty()) family = info.family.c_str();
            weight = FcWeightFromOpenType(int(info.weight));
            slant = info.italic ? FC_SLANT_ITALIC : FC_SLANT_ROMAN;
        }
        FcPatternAddString(result.get(), FC_FAMILY, reinterpret_cast<const FcChar8*>(family));
        FcPatternAddInteger(result.get(), FC_WEIGHT, weight);
        FcPatternAddInteger(result.get(), FC_SLANT, slant);
        FcPatternAddBool(result.get(), FC_SCALABLE, FcTrue);
        if (characters) FcPatternAddCharSet(result.get(), FC_CHARSET, characters);
        FcConfigSubstitute(config.get(), result.get(), FcMatchPattern);
        FcDefaultSubstitute(result.get());
        return result;
    }
    te::FontId load(FcPattern* face)
    {
        FcChar8* file = nullptr;
        int index = 0;
        if (FcPatternGetString(face, FC_FILE, 0, &file) != FcResultMatch) return 0;
        FcPatternGetInteger(face, FC_INDEX, 0, &index);
        if (index < 0) return 0;
        return fonts.load(reinterpret_cast<const char*>(file), unsigned(index));
    }
    platform::FontCoverage& prepare(te::FontId preferred, std::string_view text)
    {
        auto& state = coverage[preferred];
        auto missing = state.pending(fonts, preferred, text);
        if (!config || missing.empty()) return state;
        CharSet characters(FcCharSetCreate(), FcCharSetDestroy);
        if (!characters) return state;
        for (auto cp : missing) FcCharSetAddChar(characters.get(), cp);
        auto query = pattern(preferred, false, characters.get());
        if (!query) return state;
        FcResult result;
        FontSet matches(FcFontSort(config.get(), query.get(), FcFalse, nullptr, &result), FcFontSetDestroy);
        if (!matches) return state;
        for (int i = 0; i < matches->nfont && !missing.empty(); ++i) {
            FcCharSet* supported = nullptr;
            auto face = matches->fonts[i];
            if (FcPatternGetCharSet(face, FC_CHARSET, 0, &supported) != FcResultMatch ||
                std::none_of(missing.begin(), missing.end(), [&](auto cp) { return FcCharSetHasChar(supported, cp); })) continue;
            auto id = load(face);
            if (!id || id == preferred) continue;
            auto end = std::remove_if(missing.begin(), missing.end(), [&](auto cp) { return fonts.glyph(id, cp); });
            if (end != missing.end()) state.add(id);
            missing.erase(end, missing.end());
        }
        return state;
    }
};

SystemFonts::SystemFonts(te::FontDatabase& fonts) : impl(std::make_unique<Impl>(fonts)) {}
SystemFonts::~SystemFonts() = default;
te::FontId SystemFonts::defaultFont(bool bold)
{
    auto index = bold ? 1 : 0;
    if (impl->attempted[index] || !impl->config) return impl->primary[index];
    impl->attempted[index] = true;
    auto query = impl->pattern(0, bold);
    if (!query) return 0;
    FcResult result;
    FontSet matches(FcFontSort(impl->config.get(), query.get(), FcFalse, nullptr, &result), FcFontSetDestroy);
    if (matches) for (int i = 0; i < matches->nfont && !impl->primary[index]; ++i) impl->primary[index] = impl->load(matches->fonts[i]);
    return impl->primary[index];
}
te::FontId SystemFonts::uiFont(std::string_view text, bool bold)
{
    auto preferred = defaultFont(bold);
    if (!preferred) return 0;
    return impl->prepare(preferred, text).best(impl->fonts, preferred, text);
}
}  // namespace ui

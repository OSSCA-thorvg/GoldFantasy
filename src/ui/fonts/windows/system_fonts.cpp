#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <dwrite_2.h>
#include <wrl/client.h>
#include <ui/fonts/system_fonts.h>
#include <ui/fonts/font_coverage.h>
#include <core/io/path.h>
#include <atomic>
#include <filesystem>
#include <map>

namespace ui
{
namespace
{
using Microsoft::WRL::ComPtr;

std::wstring wide(std::string_view text)
{
    auto size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), int(text.size()), nullptr, 0);
    std::wstring result(size, L'\0');
    if (size) MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), int(text.size()), result.data(), size);
    return result;
}

class FontText final : public IDWriteTextAnalysisSource
{
public:
    std::wstring text, locale;
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id, void** output) override
    {
        if (!output) return E_POINTER;
        *output = nullptr;
        if (id != __uuidof(IUnknown) && id != __uuidof(IDWriteTextAnalysisSource)) return E_NOINTERFACE;
        *output = static_cast<IDWriteTextAnalysisSource*>(this);
        AddRef();
        return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return ++references; }
    ULONG STDMETHODCALLTYPE Release() override
    {
        auto count = --references;
        if (!count) delete this;
        return count;
    }
    HRESULT STDMETHODCALLTYPE GetTextAtPosition(UINT32 position, WCHAR const** value, UINT32* length) override
    {
        *length = position < text.size() ? UINT32(text.size() - position) : 0;
        *value = *length ? text.data() + position : nullptr;
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE GetTextBeforePosition(UINT32 position, WCHAR const** value, UINT32* length) override
    {
        *length = std::min(position, UINT32(text.size()));
        *value = *length ? text.data() : nullptr;
        return S_OK;
    }
    DWRITE_READING_DIRECTION STDMETHODCALLTYPE GetParagraphReadingDirection() override { return DWRITE_READING_DIRECTION_LEFT_TO_RIGHT; }
    HRESULT STDMETHODCALLTYPE GetLocaleName(UINT32 position, UINT32* length, WCHAR const** value) override
    {
        *length = UINT32(text.size()) - std::min(position, UINT32(text.size()));
        *value = locale.c_str();
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE GetNumberSubstitution(UINT32 position, UINT32* length, IDWriteNumberSubstitution** value) override
    {
        *length = UINT32(text.size()) - std::min(position, UINT32(text.size()));
        *value = nullptr;
        return S_OK;
    }
private:
    std::atomic<ULONG> references{1};
};
}

struct SystemFonts::Impl
{
    te::FontDatabase& fonts;
    ComPtr<IDWriteFactory> factory;
    ComPtr<IDWriteFontFallback> fallback;
    ComPtr<IDWriteGdiInterop> interop;
    LOGFONTW logical{};
    std::wstring locale;
    te::FontId primary[2]{};
    bool attempted[2]{};
    std::map<te::FontId, platform::FontCoverage> coverage;

    explicit Impl(te::FontDatabase& value) : fonts(value)
    {
        wchar_t language[LOCALE_NAME_MAX_LENGTH]{};
        if (GetUserDefaultLocaleName(language, LOCALE_NAME_MAX_LENGTH)) locale = language;
        NONCLIENTMETRICSW metrics{};
        metrics.cbSize = sizeof(metrics);
        if (SystemParametersInfoW(SPI_GETNONCLIENTMETRICS, sizeof(metrics), &metrics, 0)) logical = metrics.lfMessageFont;
        if (FAILED(DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED, __uuidof(IDWriteFactory), reinterpret_cast<IUnknown**>(factory.GetAddressOf())))) return;
        factory->GetGdiInterop(interop.GetAddressOf());
        ComPtr<IDWriteFactory2> extended;
        if (SUCCEEDED(factory.As(&extended))) extended->GetSystemFontFallback(fallback.GetAddressOf());
    }
    te::FontId load(IDWriteFont* font)
    {
        if (!font) return 0;
        ComPtr<IDWriteFontFace> face;
        if (FAILED(font->CreateFontFace(face.GetAddressOf()))) return 0;
        UINT32 count = 0;
        if (FAILED(face->GetFiles(&count, nullptr)) || count != 1) return 0;
        ComPtr<IDWriteFontFile> file;
        if (FAILED(face->GetFiles(&count, file.GetAddressOf()))) return 0;
        const void* key = nullptr;
        UINT32 keySize = 0;
        ComPtr<IDWriteFontFileLoader> loader;
        ComPtr<IDWriteLocalFontFileLoader> local;
        if (FAILED(file->GetReferenceKey(&key, &keySize)) || FAILED(file->GetLoader(loader.GetAddressOf())) || FAILED(loader.As(&local))) return 0;
        UINT32 length = 0;
        if (FAILED(local->GetFilePathLengthFromKey(key, keySize, &length))) return 0;
        std::wstring path(size_t(length) + 1, L'\0');
        if (FAILED(local->GetFilePathFromKey(key, keySize, path.data(), length + 1))) return 0;
        path.resize(length);
        return fonts.load(te::io::pathToUtf8(std::filesystem::path(path)).c_str(), face->GetIndex());
    }
    platform::FontCoverage& prepare(te::FontId preferred, std::string_view text)
    {
        auto& state = coverage[preferred];
        auto missing = state.pending(fonts, preferred, text);
        if (!fallback || missing.empty()) return state;
        ComPtr<FontText> source;
        source.Attach(new FontText);
        source->locale = locale;
        for (auto cp : missing) {
            if (cp < 0x10000) source->text.push_back(wchar_t(cp));
            else {
                source->text.push_back(wchar_t(0xd800 + ((cp - 0x10000) >> 10)));
                source->text.push_back(wchar_t(0xdc00 + ((cp - 0x10000) & 0x3ff)));
            }
        }
        auto family = std::wstring(logical.lfFaceName);
        auto weight = DWRITE_FONT_WEIGHT_NORMAL;
        auto style = DWRITE_FONT_STYLE_NORMAL;
        if (preferred && preferred <= fonts.fonts().size()) {
            const auto& info = fonts.fonts()[preferred - 1];
            if (!info.family.empty()) family = wide(info.family);
            weight = DWRITE_FONT_WEIGHT(info.weight);
            style = info.italic ? DWRITE_FONT_STYLE_ITALIC : DWRITE_FONT_STYLE_NORMAL;
        }
        for (UINT32 at = 0; at < source->text.size();) {
            UINT32 count = 0;
            float scale = 1;
            ComPtr<IDWriteFont> font;
            if (FAILED(fallback->MapCharacters(source.Get(), at, UINT32(source->text.size()) - at, nullptr,
                family.empty() ? nullptr : family.c_str(), weight, style, DWRITE_FONT_STRETCH_NORMAL, &count, font.GetAddressOf(), &scale)) || !count) break;
            auto id = load(font.Get());
            if (id != preferred) state.add(id);
            at += count;
        }
        return state;
    }
};

SystemFonts::SystemFonts(te::FontDatabase& fonts) : impl(std::make_unique<Impl>(fonts)) {}
SystemFonts::~SystemFonts() = default;
te::FontId SystemFonts::defaultFont(bool bold)
{
    auto index = bold ? 1 : 0;
    if (impl->attempted[index]) return impl->primary[index];
    impl->attempted[index] = true;
    if (!impl->interop || !impl->logical.lfFaceName[0]) return 0;
    auto logical = impl->logical;
    if (bold) logical.lfWeight = FW_BOLD;
    ComPtr<IDWriteFont> font;
    if (SUCCEEDED(impl->interop->CreateFontFromLOGFONT(&logical, font.GetAddressOf()))) impl->primary[index] = impl->load(font.Get());
    return impl->primary[index];
}
te::FontId SystemFonts::uiFont(std::string_view text, bool bold)
{
    auto preferred = defaultFont(bold);
    if (!preferred) return 0;
    return impl->prepare(preferred, text).best(impl->fonts, preferred, text);
}
}  // namespace ui

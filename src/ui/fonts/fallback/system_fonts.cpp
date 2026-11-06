#include <ui/fonts/system_fonts.h>

namespace ui
{
struct SystemFonts::Impl {};

SystemFonts::SystemFonts(te::FontDatabase&) : impl(std::make_unique<Impl>()) {}
SystemFonts::~SystemFonts() = default;
te::FontId SystemFonts::uiFont(std::string_view, bool)
{
    return 0;
}
}  // namespace ui

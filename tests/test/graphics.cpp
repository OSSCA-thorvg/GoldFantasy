#include "graphics.h"
#include <thorvg.h>
#include <stdexcept>

namespace te::test
{
Graphics::Graphics(bool loadFonts) : fonts(loadFonts)
{
    if (tvg::Initializer::init(0) != tvg::Result::Success) throw std::runtime_error("cannot initialize ThorVG for tests");
    if (fonts && (tvg::Text::load(UI_FONT_PATH) != tvg::Result::Success || tvg::Text::load(UI_BOLD_FONT_PATH) != tvg::Result::Success)) {
        tvg::Text::unload(UI_BOLD_FONT_PATH);
        tvg::Text::unload(UI_FONT_PATH);
        tvg::Initializer::term();
        throw std::runtime_error("cannot load test fonts");
    }
}
Graphics::~Graphics()
{
    if (fonts) {
        tvg::Text::unload(UI_BOLD_FONT_PATH);
        tvg::Text::unload(UI_FONT_PATH);
    }
    tvg::Initializer::term();
}
}  // namespace te::test

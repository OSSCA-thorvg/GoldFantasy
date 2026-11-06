#include <ui/ui.h>

namespace ui
{

Color resolve(const std::optional<StyleColor>& color, const Theme& theme, Color fallback)
{
    return color ? color->resolve(theme) : fallback;
}

}  // namespace ui

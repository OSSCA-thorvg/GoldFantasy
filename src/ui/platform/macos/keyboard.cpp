#include <ui/ui.h>

namespace ui::platform
{
EditorModifiers editorModifiers(KeyModifiers modifiers)
{
    return {modifiers.shift, modifiers.meta, modifiers.alt};
}

std::string shortcutLabel(std::string value)
{
    if (value.compare(0, 4, "Mod+") == 0) {
        value.replace(0, 4, "⌘");
        auto shift = value.find("Shift+");
        if (shift != std::string::npos) value.replace(shift, 6, "⇧");
    }
    return value;
}
}  // namespace ui::platform

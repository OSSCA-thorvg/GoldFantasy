#include <ui/ui.h>

namespace ui::platform
{
EditorModifiers editorModifiers(KeyModifiers modifiers)
{
    return {modifiers.shift, modifiers.control, modifiers.control};
}

std::string shortcutLabel(std::string value)
{
    if (value.compare(0, 4, "Mod+") == 0) value.replace(0, 4, "Ctrl+");
    return value;
}
}  // namespace ui::platform

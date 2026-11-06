#include <test/test.h>
#include <ui/ui.h>

TEST(keyboard_shortcut_labels_match_the_native_modifier)
{
#ifdef __APPLE__
    CHECK_EQ(ui::platform::shortcutLabel("Mod+Shift+P"), "⌘⇧P");
    CHECK_EQ(ui::platform::shortcutLabel("Mod+S"), "⌘S");
#else
    CHECK_EQ(ui::platform::shortcutLabel("Mod+Shift+P"), "Ctrl+Shift+P");
    CHECK_EQ(ui::platform::shortcutLabel("Mod+S"), "Ctrl+S");
#endif
    CHECK_EQ(ui::platform::shortcutLabel("F1"), "F1");
    CHECK_EQ(ui::platform::shortcutLabel(""), "");
}

TEST(keyboard_game_modifiers_follow_the_platform)
{
    auto modifiers = ui::platform::editorModifiers({true, true, false, false});
    CHECK(modifiers.shift);
#ifdef __APPLE__
    CHECK(!modifiers.primary && !modifiers.word);
    modifiers = ui::platform::editorModifiers({false, false, true, true});
    CHECK(modifiers.primary && modifiers.word);
#else
    CHECK(modifiers.primary && modifiers.word);
    modifiers = ui::platform::editorModifiers({false, false, true, true});
    CHECK(!modifiers.primary && !modifiers.word);
#endif
    CHECK(!modifiers.shift);
}

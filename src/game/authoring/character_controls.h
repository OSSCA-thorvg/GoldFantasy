#pragma once

#include <game/person_appearance.h>
#include <ui/ui.h>

namespace hearthold
{
ui::State characterButton(ui::Context&, const std::string& id, ui::Rect, std::string_view label, std::function<void()> activate,
                          ui::ButtonStyle style = ui::ButtonStyle::Default, bool enabled = true, ui::Icon icon = ui::Icon::None, bool active = false);
void characterChoice(ui::Context&, const std::string& id, ui::Rect, const char* label, const std::vector<std::string>&,
                     int value, std::function<void(int)> change);
void characterSlider(ui::Context&, const std::string& id, ui::Rect, const char* label, float value, float minimum, float maximum,
                     std::function<void()> begin, std::function<void(float)> change);
void characterColor(ui::Context&, ui::Rect, Rgb, std::function<void()> begin, std::function<void(Rgb)> change);
}  // namespace hearthold

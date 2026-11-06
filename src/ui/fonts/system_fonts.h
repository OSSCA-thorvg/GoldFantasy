#pragma once

#include <ui/text/text.h>
#include <memory>

namespace ui
{
// The font database outlives this adapter and its UI consumers.
class SystemFonts
{
public:
    explicit SystemFonts(te::FontDatabase&);
    ~SystemFonts();
    // Returns 0 when no native face is available, leaving the bundled font in use.
    te::FontId uiFont(std::string_view utf8, bool bold = false);

private:
    te::FontId defaultFont(bool bold);
    struct Impl;
    std::unique_ptr<Impl> impl;
};
}  // namespace ui

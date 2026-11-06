#pragma once

#include <test/test.h>
#include <ui/ui.h>
#include <thorvg.h>
#include <string_view>
#include <vector>

namespace hearthold::test
{
// Bounds of every text paint under `paint` that reads exactly `words`.
inline void textBounds(tvg::Paint* paint, std::string_view words, std::vector<ui::Rect>& result)
{
    if (paint->type() == tvg::Type::Text) {
        auto text = static_cast<tvg::Text*>(paint)->text();
        if (text && words == text) {
            ui::Rect box;
            CHECK(paint->bounds(&box.x, &box.y, &box.w, &box.h) == tvg::Result::Success);
            result.push_back(box);
        }
    }
    if (paint->type() == tvg::Type::Scene)
        for (auto child : static_cast<tvg::Scene*>(paint)->paints()) textBounds(child, words, result);
}

inline std::vector<ui::Rect> textBounds(tvg::Paint* paint, std::string_view words)
{
    std::vector<ui::Rect> result;
    textBounds(paint, words, result);
    return result;
}
}  // namespace hearthold::test

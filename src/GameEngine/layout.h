#pragma once

#include <ui/ui.h>

namespace engine
{
inline constexpr float moduleWidth = 1280;
inline constexpr float moduleHeight = 800;
inline constexpr float defaultInspectorWidth = 280, minimumInspectorWidth = 240, minimumViewportWidth = 360;

inline float clampInspectorWidth(float workspaceWidth, float requested)
{
    return std::clamp(std::isfinite(requested) ? requested : defaultInspectorWidth, minimumInspectorWidth,
                      std::max(minimumInspectorWidth, workspaceWidth - minimumViewportWidth - 1));
}

enum class InspectorSide { Left, Right };

struct Layout
{
    ui::Rect toolbar, project, viewportHeader, viewport, preview, inspector, footer;
    ui::Rect play, pause, stop, timeBar, step, timeMinus, timeValue, timePlus;
    ui::Rect inspectorHandle, inspectorMove, inspectorLoad, inspectorSave;
    ui::Rect inspectorResize;
    ui::Rect dockLeft, dockRight;
    float moduleScale = 1;
    bool inspectorVisible = false;
    InspectorSide inspectorSide = InspectorSide::Right;
};

inline Layout layout(float width, float height, bool module, std::optional<bool> inspector = {}, InspectorSide inspectorSide = InspectorSide::Right,
                     float preferredInspectorWidth = defaultInspectorWidth)
{
    width = std::max(0.f, width);
    height = std::max(0.f, height);
    Layout out;
    out.toolbar = {0, 0, width, std::min(44.f, height)};
    out.project = {0, out.toolbar.h, width, std::min(36.f, std::max(0.f, height - out.toolbar.h))};
    float top = out.project.y + out.project.h;
    float bottom = std::max(top, height - 26);
    out.footer = {0, bottom, width, height - bottom};
    out.inspectorVisible = inspector.value_or(width >= 1100);
    out.inspectorSide = inspectorSide;
    float side = out.inspectorVisible ? (width < 840 ? width : clampInspectorWidth(width, preferredInspectorWidth)) : 0;
    out.inspector = {inspectorSide == InspectorSide::Left ? 0 : width - side, top, side, bottom - top};
    out.inspectorHandle = {out.inspector.x + 6, top + 2, std::max(0.f, side - 150), 28};
    out.inspectorMove = {out.inspector.x + side - 140, top + 2, 28, 28};
    out.inspectorLoad = {out.inspector.x + side - 106, top + 2, 44, 28};
    out.inspectorSave = {out.inspector.x + side - 56, top + 2, 44, 28};
    float divider = side > 0 && side < width ? 1.f : 0.f;
    if (divider > 0) out.inspectorResize = {inspectorSide == InspectorSide::Left ? side - 3 : width - side - 4, top, 7, bottom - top};
    float canvasX = inspectorSide == InspectorSide::Left && divider > 0 ? side + divider : 0;
    float canvasWidth = std::max(0.f, width - side - divider);
    out.dockLeft = {0, top, std::min(160.f, width / 3), bottom - top};
    out.dockRight = {width - out.dockLeft.w, top, out.dockLeft.w, bottom - top};
    out.viewportHeader = {canvasX, top, canvasWidth, std::min(44.f, bottom - top)};
    float playWidth = canvasWidth < 600 ? 60.f : 76.f;
    float pauseWidth = canvasWidth < 600 ? 66.f : 82.f;
    float stopWidth = canvasWidth < 600 ? 60.f : 72.f;
    float transportWidth = playWidth + pauseWidth + stopWidth + 12;
    float scale = std::min(1.f, std::max(0.f, canvasWidth - 16) / transportWidth);
    float x = canvasX + (canvasWidth - transportWidth * scale) / 2;
    float y = top + (out.viewportHeader.h - std::min(28.f, out.viewportHeader.h)) / 2;
    out.play = {x, y, playWidth * scale, std::min(28.f, out.viewportHeader.h)};
    out.pause = {x + (playWidth + 6) * scale, y, pauseWidth * scale, out.play.h};
    out.stop = {out.pause.x + (pauseWidth + 6) * scale, y, stopWidth * scale, out.play.h};
    float timeY = top + out.viewportHeader.h;
    out.timeBar = {canvasX, timeY, canvasWidth, std::min(36.f, std::max(0.f, bottom - timeY))};
    out.step = {canvasX + 100, timeY + 4, 52, 28};
    out.timeMinus = {canvasX + canvasWidth - 156, timeY + 4, 24, 28};
    out.timeValue = {out.timeMinus.x + 28, timeY + 4, 64, 28};
    out.timePlus = {out.timeValue.x + 68, timeY + 4, 24, 28};
    out.viewport = {canvasX, timeY + out.timeBar.h, canvasWidth, std::max(0.f, bottom - timeY - out.timeBar.h)};
    float pad = width >= 1000 ? 16.f : 8.f;
    ui::Rect space{canvasX + pad, out.viewport.y + pad, std::max(0.f, canvasWidth - 2 * pad), std::max(0.f, out.viewport.h - 2 * pad)};
    out.preview = space;
    if (module) {
        out.moduleScale = std::min(space.w / moduleWidth, space.h / moduleHeight);
        out.preview = {space.x + (space.w - moduleWidth * out.moduleScale) / 2,
                       space.y + (space.h - moduleHeight * out.moduleScale) / 2,
                       moduleWidth * out.moduleScale, moduleHeight * out.moduleScale};
    }
    return out;
}
}  // namespace engine

#include "game_app.h"
#include <cstdlib>
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
EM_JS(int, hearthold_dock_reduced_motion, (), {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 0;
});
#endif

namespace hearthold
{
namespace
{
std::shared_ptr<tvg::Paint> retained(tvg::Paint* paint)
{
    if (!paint) return {};
    paint->ref();
    return {paint, [](tvg::Paint* value) { value->unref(); }};
}

ui::Rect padded(ui::Rect r, float amount)
{
    if (r.w <= 0 || r.h <= 0) return {};
    return {r.x - amount, r.y - amount, r.w + 2 * amount, r.h + 2 * amount};
}
float ease(float t) { return 1 - (1 - t) * (1 - t) * (1 - t); }
bool reducedMotion()
{
#ifdef __EMSCRIPTEN__
    return hearthold_dock_reduced_motion() != 0;
#else
    const char* value = std::getenv("HEARTHOLD_REDUCED_MOTION");
    return value && value[0] && value[0] != '0';
#endif
}
}  // namespace

void GameApp::dismissBuildDrawer()
{
    card = globalCard = -1; drawerOpen = drawerPinned = false; drawerSuppressed = true;
    drawerBridge = {};
}

void GameApp::updateContextDock(float width, float height)
{
    double now = context.time();
    auto advance = [&] {
        dockProgress = dockStarted < 0 ? 1.f : float(std::clamp((now - dockStarted) / dockDuration, 0., 1.));
        float t = ease(dockProgress);
        dockBounds.w = std::min(std::lerp(dockFrom.w, dockTarget.w, t), std::max(1.f, width - 24));
        dockBounds.h = std::lerp(dockFrom.h, dockTarget.h, t);
        dockBounds.x = (width - dockBounds.w) / 2; dockBounds.y = height - 12 - dockBounds.h;
    };
    if (!dockKey.empty()) advance();
    ui::Rect handle{(width - 152) / 2, height - 30, 152, 26};
    bool atHandle = handle.contains(mouse.x, mouse.y);
    if (!atHandle) drawerSuppressed = false;
    bool eligible = pending == Order::None && !roadPress && !boxFrom && !fieldFrom && !panFrom;
    if (!eligible) { card = globalCard = -1; drawerOpen = drawerPinned = false; }
    auto menu = buildMenuBounds(width, height, true);
    bool inMenu = padded(dockBounds, 8).contains(mouse.x, mouse.y) ||
                  (drawerOpen && (padded(menu, 8).contains(mouse.x, mouse.y) || padded(drawerBridge, 8).contains(mouse.x, mouse.y)));
    if (drawerOpen && dockProgress == 1 && menu.contains(mouse.x, mouse.y)) { drawerPinned = false; drawerBridge = {}; }
    bool vacant = chosen.empty() && selected < 0 && selectedDungeon < 0 && selectedTree < 0 && selectedRock < 0;
    bool global = vacant && eligible && !drawerSuppressed && (drawerPinned || atHandle || (globalCard >= 0 && inMenu));
    if (global && globalCard < 0) globalCard = 0;
    DockView next = DockView::Handle;
    if (eligible && ((!chosen.empty() && card >= 0) || global)) next = DockView::Build;
    else if (!chosen.empty()) next = DockView::Unit;
    else if (selected >= 0 || selectedDungeon >= 0) next = DockView::Inspector;
    else if (selectedTree >= 0 || selectedRock >= 0) next = DockView::Resource;
    else if (tool != Tool::Select) next = DockView::Placement;

    ui::Rect target{(width - 112) / 2, height - 20, 112, 8};
    std::string key = std::to_string(int(next));
    if (next == DockView::Build) {
        bool shared = chosen.empty(); target = buildMenuBounds(width, height, shared);
        key += ":" + std::to_string(shared ? globalCard : card);
        for (int id : chosen) key += ":" + std::to_string(id);
    } else if (next == DockView::Unit) {
        target = personPanelBounds(width, height, residentSelection());
        for (int id : chosen) key += ":" + std::to_string(id);
    } else if (next == DockView::Inspector) {
        target.w = std::min(620.f, width - 24); target.h = std::min(inspector({0, 0, target.w, 0}, false), std::max(120.f, height - 180));
        key += ":" + std::to_string(selected) + ":" + std::to_string(selectedDungeon) + ":" + std::to_string(residentPage);
    } else if (next == DockView::Resource) {
        target.w = std::min(276.f, width - 24); target.h = 108;
        key += ":" + std::to_string(selectedTree) + ":" + std::to_string(selectedRock);
    } else if (next == DockView::Placement) {
        target = placementPanelBounds(width, height); key += ":" + std::to_string(int(tool));
    }
    target.x = (width - target.w) / 2; target.y = height - 12 - target.h;
    if (key != dockKey || target.w != dockTarget.w || target.h != dockTarget.h) {
        if (!dockKey.empty()) {
            if (key != dockKey) {
                dockGhost = dockContent ? retained(dockContent->duplicate()) : nullptr; dockGhostBounds = dockBounds;
            } else dockGhost.reset();
            if (dockView == DockView::Build && next == DockView::Build) drawerBridge = dockBounds;
            if (key != dockKey) context.cancelPointer();
            dockFrom = dockBounds; dockStarted = now;
        } else { dockFrom = target; dockStarted = -1; }
        dockKey = std::move(key); dockView = next; dockTarget = target;
        dockDuration = next == DockView::Handle ? .18f : .24f;
        if (reducedMotion()) dockStarted = -1;
        advance();
    }
    drawerOpen = dockView == DockView::Build;
    if (animatingUi()) context.requestAnimationFrame();
    else { dockGhost.reset(); if (dockView == DockView::Handle) globalCard = -1; }
}

void GameApp::renderDockContent(ui::Rect panel)
{
    switch (dockView) {
    case DockView::Handle:
        context.rect({panel.x + panel.w / 2 - 22, panel.y + panel.h / 2 - 1, 44, 2}, theme.muted, 1);
        context.control("build-handle", {panel.x - 20, panel.y - 10, panel.w + 40, panel.h + 20}, [this](const ui::Event& e) {
            if (e.type == ui::EventType::Activate) { globalCard = 0; drawerPinned = true; drawerSuppressed = false; }
        });
        break;
    case DockView::Build: commandCard(panel, 1, chosen.empty(), true); break;
    case DockView::Unit: personPanel(panel); break;
    case DockView::Inspector: inspector(panel); break;
    case DockView::Placement: placementPanel(panel); break;
    case DockView::Resource: {
        bool stone = selectedRock >= 0;
        context.text({panel.x + 12, panel.y + 10, panel.w - 24, 22}, stone ? "Stone" : "Tree", theme.text, 16, true);
        context.text({panel.x + 12, panel.y + 36, panel.w - 24, 18}, stone ? "Mine, carry, store +3 stone" : "Chop, carry, store +3 wood", theme.muted, 12);
        ui::button(context, "resource-work", {panel.x + 12, panel.y + 66, panel.w - 24, 30}, stone ? "Mine  A" : "Chop  A", [this] { prepare(Order::Attack); });
        break;
    }
    }
}

void GameApp::taskbar(float width, float height)
{
    context.rect(dockBounds, theme.surface, std::min(theme.radius + 2, dockBounds.h / 2), theme.border);
    context.control("context-dock", dockBounds, [](const ui::Event&) {}, true, false);
    auto layer = context.layer(dockBounds.inset(1), [&] {
        if (dockGhost && dockProgress < .55f) {
            context.add(dockGhost.get());
            float dx = dockBounds.x + dockBounds.w / 2 - dockGhostBounds.x - dockGhostBounds.w / 2;
            float dy = dockBounds.y + dockBounds.h - dockGhostBounds.y - dockGhostBounds.h - 6 * ease(dockProgress);
            ui::setTransform(dockGhost.get(), {1, 0, dx, 0, 1, dy, 0, 0, 1});
            dockGhost->opacity(uint8_t(255 * (1 - ease(std::clamp(dockProgress / .55f, 0.f, 1.f)))));
        }
        float reveal = dockGhost ? ease(std::clamp((dockProgress - .1f) / .9f, 0.f, 1.f)) : 1.f;
        if (reveal > .01f || dockProgress == 1) {
            auto body = dockTarget; body.x = (width - body.w) / 2; body.y = height - 12 - body.h + 8 * (1 - reveal);
            context.layer(dockBounds.inset(1), [&] { renderDockContent(body); }, uint8_t(255 * reveal));
        }
    });
    if (layer != dockContent.get()) dockContent = retained(layer);
}
}  // namespace hearthold

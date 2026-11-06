#include <ui/ui.h>
#include <algorithm>
#include <cmath>
#include <memory>

namespace ui
{

namespace
{
// ThorVG's FontLoader multiplies point sizes by 96/72 in local scene coordinates.
// This converts our nominal em size in logical pixels; output/display scaling is separate.
constexpr float fontPointsPerLogicalPixel = 72.0f / 96.0f;
}  // namespace

bool Rect::contains(float px, float py) const
{
    return w > 0 && h > 0 && px >= x && py >= y && px < x + w && py < y + h;
}

Rect Rect::inset(float amount) const
{
    return {x + amount, y + amount, std::max(0.0f, w - amount * 2), std::max(0.0f, h - amount * 2)};
}

Rect Rect::intersect(Rect other) const
{
    auto left = std::max(x, other.x), top = std::max(y, other.y);
    return {left, top, std::max(0.0f, std::min(x + w, other.x + other.w) - left), std::max(0.0f, std::min(y + h, other.y + other.h) - top)};
}

void setTransform(tvg::Paint* paint, const tvg::Matrix& matrix)
{
    const auto current = paint->transform();
    if (current.e11 == matrix.e11 && current.e12 == matrix.e12 && current.e13 == matrix.e13 &&
        current.e21 == matrix.e21 && current.e22 == matrix.e22 && current.e23 == matrix.e23 &&
        current.e31 == matrix.e31 && current.e32 == matrix.e32 && current.e33 == matrix.e33) return;
    paint->transform(matrix);
}

struct Context::Layer
{
    tvg::Scene* scene = tvg::Scene::gen();
    Rect bounds;
    std::vector<tvg::Paint*> pending;
    // Keep membership nodes for retained paints instead of allocating them every frame.
    std::unordered_map<tvg::Paint*, uint64_t> queued;
    uint64_t generation = 0;
    std::vector<std::unique_ptr<Layer>> clips;
    std::vector<std::pair<std::string, tvg::Paint*>> drawn;
    size_t usedClips = 0, usedDrawn = 0;

    Layer() { scene->ref(); }
    ~Layer()
    {
        for (auto paint : pending) paint->unref();
        for (auto& entry : drawn) entry.second->unref();
        scene->unref();
    }
    void begin()
    {
        for (auto paint : pending) paint->unref();
        pending.clear();
        if (++generation == 0) { queued.clear(); ++generation; }
        usedClips = usedDrawn = 0;
    }
};

Context::Context() : rootLayer(std::make_unique<Layer>()), root(rootLayer->scene), target(rootLayer.get()) {}
Context::~Context() = default;

void Context::discardLayer(Layer& layer)
{
    for (auto paint : layer.scene->paints()) paintLayers.erase(paint);
    for (auto& clip : layer.clips) discardLayer(*clip);
    layer.scene->remove();
}

void Context::finishLayer(Layer& layer)
{
    const auto& attached = layer.scene->paints();
    for (auto it = attached.begin(); it != attached.end();) {
        auto paint = *it++;
        auto queued = layer.queued.find(paint);
        if (queued != layer.queued.end() && queued->second == layer.generation) continue;
        paintLayers.erase(paint);
        // ThorVG damages a removed paint only while another reference keeps it alive.
        paint->ref();
        layer.scene->remove(paint);
        paint->unref();
    }
    auto next = attached.begin();
    for (auto paint : layer.pending) {
        if (next != attached.end() && *next == paint) ++next;
        else {
            auto found = paintLayers.find(paint);
            if (found != paintLayers.end()) found->second->scene->remove(paint);
            layer.scene->add(paint, next == attached.end() ? nullptr : *next);
        }
        paintLayers[paint] = &layer;
        paint->unref();
    }
    layer.pending.clear();
    for (auto it = layer.queued.begin(); it != layer.queued.end();) {
        if (it->second != layer.generation) it = layer.queued.erase(it);
        else ++it;
    }
    for (size_t i = layer.usedDrawn; i < layer.drawn.size(); ++i) layer.drawn[i].second->unref();
    layer.drawn.resize(layer.usedDrawn);
    for (size_t i = layer.usedClips; i < layer.clips.size(); ++i) discardLayer(*layer.clips[i]);
    layer.clips.resize(layer.usedClips);
}

void Context::begin(const Theme& theme, Rect viewport, double seconds)
{
    rootLayer->begin();
    target = rootLayer.get();
    if (!std::isfinite(seconds) || seconds < 0)
        seconds = frameTime();
    this->seconds = seconds;
    frames.clear();
    iconRenderer.begin(seconds);
    iconSequence = 0;
    tokens = &theme;
    clipBounds = viewport;
    controls.clear();
    modalFrame = false;
}

void Context::end()
{
    finishLayer(*rootLayer);
    iconRenderer.end();
    if (iconsAnimating()) requestAnimationFrame();
    if (modalActive && !modalFrame) focusId = savedFocus;
    modalActive = modalFrame;
    if (!modalActive) dismissModal = {};
    auto focusedControl = find(focusId);
    if (!focusedControl || !focusedControl->enabled || !focusedControl->focusable) focusId.clear();
    auto pressedControl = find(pressedId);
    if (!pressedControl || !pressedControl->enabled) pressedId.clear();
}

void Context::modal(std::string_view initialFocus, std::function<void()> dismiss)
{
    if (!modalActive) cancelPointer();
    controls.clear();
    dismissModal = std::move(dismiss);
    if (!modalActive) {
        savedFocus = focusId;
        focus(initialFocus);
    }
    modalFrame = true;
}

Context::Control* Context::find(std::string_view id)
{
    for (auto& control : controls) {
        if (control.id == id) return &control;
    }
    return nullptr;
}

Context::Control* Context::hit(float x, float y)
{
    for (auto it = controls.rbegin(); it != controls.rend(); ++it) {
        if (it->bounds.contains(x, y)) return &*it;
    }
    return nullptr;
}

bool Context::controlAt(float x, float y) const
{
    return std::any_of(controls.begin(), controls.end(), [&](const auto& control) { return control.bounds.contains(x, y); });
}

State Context::control(std::string_view id, Rect bounds, Handler handler, bool enabled, bool focusable, bool scrollable, bool captureRelease, Cursor cursor)
{
    bounds = bounds.intersect(clipBounds);
    controls.push_back({std::string(id), bounds, std::move(handler), enabled, focusable, scrollable, captureRelease, cursor});
    return {enabled && bounds.contains(pointerX, pointerY), enabled && pressedId == id, enabled && focusId == id};
}

void Context::focus(std::string_view id)
{
    focusId = id;
}

Cursor Context::cursor() const
{
    for (const auto& control : controls) {
        if (control.id == pressedId && control.enabled && control.cursor != Cursor::Default)
            return control.cursor;
    }
    for (auto it = controls.rbegin(); it != controls.rend(); ++it) {
        if (it->bounds.contains(pointerX, pointerY)) return it->enabled ? it->cursor : Cursor::Default;
    }
    return Cursor::Default;
}

bool Context::focusedWithin(Rect bounds) const
{
    for (const auto& control : controls) {
        if (control.id == focusId && control.enabled && control.focusable && control.bounds.w > 0 && control.bounds.h > 0)
            return bounds.contains(control.bounds.x + control.bounds.w / 2, control.bounds.y + control.bounds.h / 2);
    }
    return false;
}

void Context::cancelPointer()
{
    auto id = pressedId;
    pressedId.clear();
    auto target = find(id);
    if (target && target->captureRelease) send(id, {EventType::Cancel, pointerX, pointerY});
}

void Context::send(std::string_view id, const Event& event)
{
    auto target = find(id);
    if (!target || !target->enabled || !target->handler) return;
    // Callbacks may change the model or invalidate a contribution. Never retain a control reference across a callback.
    auto handler = target->handler;
    handler(event);
}

void Context::setPointerPosition(float x, float y)
{
    pointerX = x;
    pointerY = y;
}

void Context::contextMenu(float x, float y)
{
    setPointerPosition(x, y);
    auto target = hit(x, y);
    if (target && target->enabled) send(target->id, {EventType::ContextMenu, x, y});
}

void Context::pointerMove(float x, float y)
{
    setPointerPosition(x, y);
    if (!pressedId.empty()) send(pressedId, {EventType::Drag, x, y});
}

void Context::pointerDown(float x, float y)
{
    cancelPointer();
    setPointerPosition(x, y);
    auto target = hit(x, y);
    if (!target || !target->enabled) {
        focusId.clear();
        return;
    }
    pressedId = target->id;
    if (target->focusable) focusId = target->id;
    send(pressedId, {EventType::Press, x, y});
}

void Context::pointerUp(float x, float y)
{
    setPointerPosition(x, y);
    auto id = pressedId;
    pressedId.clear();
    auto captured = find(id);
    bool release = captured && captured->captureRelease;
    auto target = hit(x, y);
    bool activate = target && target->id == id;
    if (release) send(id, {EventType::Release, x, y});
    if (activate) send(id, {EventType::Activate, x, y});
}

void Context::key(Key key, bool shift)
{
    auto captured = find(pressedId);
    if (key == Key::Escape && captured && captured->captureRelease) {
        cancelPointer();
        return;
    }
    if (key == Key::Escape && modalActive && dismissModal) {
        auto dismiss = dismissModal;
        dismiss();
        return;
    }
    if (key == Key::Tab) {
        std::vector<std::string> order;
        for (const auto& control : controls) {
            if (control.enabled && control.focusable && control.bounds.w > 0 && control.bounds.h > 0) order.push_back(control.id);
        }
        if (order.empty()) return;
        auto found = std::find(order.begin(), order.end(), focusId);
        auto index = found == order.end() ? (shift ? 0 : -1) : int(found - order.begin());
        focusId = order[(index + (shift ? int(order.size()) - 1 : 1)) % int(order.size())];
        return;
    }
    send(focusId, {EventType::Key, 0, 0, key, shift});
}

void Context::textInput(std::string_view text)
{
    send(focusId, {EventType::Text, 0, 0, Key::Unknown, false, std::string(text)});
}

bool Context::wheel(float vertical, float horizontal)
{
    if (vertical == 0 && horizontal == 0) return false;
    for (auto it = controls.rbegin(); it != controls.rend(); ++it) {
        if (!it->enabled || !it->scrollable || !it->bounds.contains(pointerX, pointerY)) continue;
        auto id = it->id;
        send(id, {EventType::Scroll, horizontal, vertical});
        return true;
    }
    return false;
}

void Context::clip(Rect bounds, const std::function<void()>& render)
{
    layer(bounds, render);
}

tvg::Scene* Context::layer(Rect bounds, const std::function<void()>& render, uint8_t opacity)
{
    bounds = bounds.intersect(clipBounds);
    if (bounds.w <= 0 || bounds.h <= 0) return nullptr;
    auto previousTarget = target;
    auto previousBounds = clipBounds;
    auto index = target->usedClips++;
    if (index == target->clips.size()) target->clips.push_back(std::make_unique<Layer>());
    auto& layer = *target->clips[index];
    if (!layer.scene->clip() || layer.bounds.x != bounds.x || layer.bounds.y != bounds.y || layer.bounds.w != bounds.w || layer.bounds.h != bounds.h) {
        auto shape = tvg::Shape::gen();
        shape->appendRect(bounds.x, bounds.y, bounds.w, bounds.h);
        shape->fill(255, 255, 255);
        layer.scene->clip(shape);
        // Fast-track clip changes need fresh coverage for retained children.
        layer.scene->transform(layer.scene->transform());
        layer.bounds = bounds;
    }
    add(layer.scene);
    if (layer.scene->opacity() != opacity) layer.scene->opacity(opacity);
    layer.begin();
    target = &layer;
    clipBounds = bounds;
    render();
    finishLayer(layer);
    target = previousTarget;
    clipBounds = previousBounds;
    return layer.scene;
}

void Context::add(tvg::Paint* paint)
{
    if (!paint) return;
    auto [queued, inserted] = target->queued.try_emplace(paint, target->generation);
    if (!inserted && queued->second == target->generation) return;
    queued->second = target->generation;
    paint->ref();
    auto found = paintLayers.find(paint);
    if (found != paintLayers.end() && found->second != target) {
        found->second->scene->remove(paint);
        paintLayers.erase(found);
    }
    target->pending.push_back(paint);
}

void Context::paint(std::string key, const std::function<tvg::Paint*()>& make)
{
    auto& drawn = target->drawn;
    if (target->usedDrawn == drawn.size()) drawn.emplace_back();
    auto& entry = drawn[target->usedDrawn++];
    if (!entry.second || entry.first != key) {
        auto paint = make();
        if (!paint) return;
        paint->ref();
        // The scene keeps a replaced paint until finishLayer() removes it.
        if (entry.second) entry.second->unref();
        entry = {std::move(key), paint};
    }
    add(entry.second);
}

void Context::rect(Rect bounds, Color fill, float radius, Color border, float stroke)
{
    if (bounds.w <= 0 || bounds.h <= 0) return;
    paint(paintKey('R', bounds, fill, radius, border, stroke), [&] {
        auto shape = tvg::Shape::gen();
        shape->appendRect(bounds.x, bounds.y, bounds.w, bounds.h, radius, radius);
        shape->fill(fill.r, fill.g, fill.b, fill.a);
        if (border.a) {
            shape->strokeWidth(stroke);
            shape->strokeFill(border.r, border.g, border.b, border.a);
        }
        return shape;
    });
}

void Context::line(float x1, float y1, float x2, float y2, Color color, float width)
{
    paint(paintKey('L', x1, y1, x2, y2, color, width), [&] {
        auto shape = tvg::Shape::gen();
        shape->moveTo(x1, y1);
        shape->lineTo(x2, y2);
        shape->strokeWidth(width);
        shape->strokeCap(tvg::StrokeCap::Round);
        shape->strokeFill(color.r, color.g, color.b, color.a);
        return shape;
    });
}

void Context::text(Rect bounds, std::string_view value, Color color, float size, bool bold, Align align, float horizontalOffset)
{
    if (bounds.w <= 0 || bounds.h <= 0 || value.empty()) return;
    auto font = fontFor ? fontFor(value, bold) : nullptr;
    if (!font) font = bold ? tokens->boldFont.c_str() : tokens->font.c_str();
    size = (size > 0 ? size : tokens->fontSize) * fontPointsPerLogicalPixel;
    paint(paintKey('T', bounds, color, size, align, horizontalOffset) + font + '\0' + std::string(value), [&] {
        auto label = tvg::Text::gen();
        label->font(font);
        label->size(size);
        label->text(std::string(value).c_str());
        label->fill(color.r, color.g, color.b);
        label->opacity(color.a);
        float x = 0, y = 0, w = 0, h = 0;
        label->bounds(&x, &y, &w, &h);
        tvg::TextMetrics metrics{};
        label->metrics(metrics);
        float offset = align == Align::Center ? (bounds.w - w) / 2 : align == Align::End ? bounds.w - w : 0;
        label->translate(bounds.x + offset - x - horizontalOffset, bounds.y + (bounds.h - (metrics.ascent - metrics.descent)) / 2);
        auto clip = tvg::Shape::gen();
        clip->appendRect(bounds.x, bounds.y, bounds.w, bounds.h);
        clip->fill(255, 255, 255);
        auto group = tvg::Scene::gen();
        group->add(label);
        group->clip(clip);
        return group;
    });
}

float Context::textWidth(std::string_view value, float size, bool bold, std::string_view fontContext) const
{
    if (value.empty()) return 0;
    std::unique_ptr<tvg::Text> label(tvg::Text::gen());
    auto font = fontFor ? fontFor(fontContext.empty() ? value : fontContext, bold) : nullptr;
    label->font(font ? font : bold ? tokens->boldFont.c_str() : tokens->font.c_str());
    label->size((size > 0 ? size : tokens->fontSize) * fontPointsPerLogicalPixel);
    label->text(std::string(value).c_str());
    float x = 0, y = 0, w = 0, h = 0;
    label->bounds(&x, &y, &w, &h);
    return w;
}

std::string Context::elideText(std::string_view value, float width, float size, bool bold, std::string_view suffix) const
{
    if (width <= 0 || value.empty()) return {};
    std::string full(value);
    full += suffix;
    if (textWidth(full, size, bold) <= width) return full;
    std::vector<size_t> ends;
    for (size_t end = 0; end < value.size();) {
        ++end;
        while (end < value.size() && (static_cast<unsigned char>(value[end]) & 0xc0) == 0x80) ++end;
        if (end < value.size()) ends.push_back(end);
    }
    auto shortened = [&](size_t end) {
        std::string text(value.substr(0, end));
        text += "…";
        text += suffix;
        return text;
    };
    size_t low = 0, high = ends.size();
    while (low < high) {
        size_t middle = low + (high - low) / 2;
        if (textWidth(shortened(ends[middle]), size, bold) <= width) low = middle + 1;
        else high = middle;
    }
    return low ? shortened(ends[low - 1]) : std::string{};
}

void Context::icon(Rect bounds, Icon icon, Color color)
{
    this->icon("icon/" + std::to_string(iconSequence++), bounds, icon, color);
}

void Context::icon(std::string_view instance, Rect bounds, Icon icon, Color color, IconState state, float size)
{
    if (icon != Icon::None) this->icon(instance, bounds, iconName(icon), color, state, size);
}

void Context::icon(std::string_view instance, Rect bounds, std::string_view name, Color color, IconState state, float size)
{
    if (bounds.w <= 0 || bounds.h <= 0 || !std::isfinite(size) || size <= 0 || name.empty()) return;
    auto picture = iconRenderer.picture(instance, name, state, color, [this](tvg::Picture* paint) { add(paint); });
    if (!picture) return;
    float width = 0, height = 0;
    if (picture->size(&width, &height) != tvg::Result::Success || width <= 0 || height <= 0) return;
    float scale = size / std::max(width, height);
    setTransform(picture, {scale, 0, bounds.x + (bounds.w - width * scale) / 2,
                          0, scale, bounds.y + (bounds.h - height * scale) / 2, 0, 0, 1});
}

bool Context::setIcons(std::vector<IconAsset> assets, std::string& error)
{
    return iconRenderer.replace(std::move(assets), error);
}

bool Context::iconsAnimating() const
{
    return iconRenderer.animating();
}

void Context::focusRing(Rect bounds)
{
    rect(bounds.inset(-3), {0, 0, 0, 0}, tokens->radius + 3, tokens->accent, 1.5f);
}

}  // namespace ui

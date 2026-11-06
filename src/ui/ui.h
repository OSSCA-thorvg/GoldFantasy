#pragma once

#include <thorvg.h>
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <limits>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <type_traits>
#include <unordered_map>
#include <utility>
#include <vector>

// Theme
namespace ui
{

struct Color
{
    uint8_t r, g, b, a = 255;
};

// Semantic tokens for game controls. Font loading belongs to the host.
struct Theme
{
    Color background, surface, raised, border, text, muted;
    Color accent, accentText, selection, success, danger;
    float radius = 7;
    float fontSize = 13;  // Nominal em in logical px, independent of font-point and output-pixel units.
    float rowHeight = 32;
    std::string font = "DejaVuSans";
    std::string boldFont = "DejaVuSans-Bold";

    static Theme dark();
    static Theme light();
};

}  // namespace ui

// Frame scheduling
namespace ui
{
inline double frameTime()
{
    using Clock = std::chrono::steady_clock;
    static const auto epoch = Clock::now();
    return std::chrono::duration<double>(Clock::now() - epoch).count();
}

class FrameRequest
{
public:
    void clear() { next.reset(); }
    void requestAt(double seconds)
    {
        if (std::isfinite(seconds) && seconds >= 0 && (!next || seconds < *next)) next = seconds;
    }
    const std::optional<double>& deadline() const { return next; }
    bool due(double seconds) const { return next && seconds >= *next; }
    // -1 lets a host wait for input when no component needs another frame.
    int delay(double seconds) const
    {
        if (!next) return -1;
        auto milliseconds = std::ceil(std::max(0.0, (*next - seconds) * 1000 - 1e-6));
        return int(std::min(milliseconds, double(std::numeric_limits<int>::max())));
    }

private:
    std::optional<double> next;
};
}  // namespace ui

// Icons
namespace ui
{

enum class Icon
{
    None, Folder, Check, Chevron, ChevronLeft, Count
};

struct IconState
{
    bool hovered = false, pressed = false, active = false;
    bool enabled = true, focused = false;
};

struct IconAsset
{
    std::string name, data, mime;
    bool tint = true;
    float duration = .16f;
    // Hover, active and focus may also author an optional <marker>-overshoot pose.
    std::array<std::string, 6> markers{"idle", "hover", "pressed", "active", "disabled", "focused"};
};

// Missing standard pose names fall back to idle/frame zero; custom aliases must exist.
bool validateIcon(const IconAsset& asset, std::string& error);
const char* iconName(Icon icon);
bool iconFromName(std::string_view name, Icon& icon);

class Icons
{
public:
    Icons();
    ~Icons();
    Icons(const Icons&) = delete;
    Icons& operator=(const Icons&) = delete;

    // Only user assets are replaced, after every candidate has passed validation.
    bool replace(std::vector<IconAsset> assets, std::string& error);
    bool contains(std::string_view name) const;
    void begin(double seconds);
    // Reparent a retained picture before animation or color changes invalidate its last drawn bounds.
    tvg::Picture* picture(std::string_view instance, std::string_view name, const IconState& state, Color tint,
                          const std::function<void(tvg::Picture*)>& prepare = {});
    void end();
    bool animating() const;

private:
    struct Impl;
    std::unique_ptr<Impl> impl;
};

}  // namespace ui

// Drawing and input
namespace ui
{

struct Rect
{
    float x = 0, y = 0, w = 0, h = 0;
    bool contains(float px, float py) const;
    Rect inset(float amount) const;
    Rect intersect(Rect other) const;
};

// ThorVG invalidates geometry even when transform() receives the same matrix.
void setTransform(tvg::Paint* paint, const tvg::Matrix& matrix);

enum class Key
{
    Unknown,
    Tab,
    Enter,
    Space,
    Escape,
    Left,
    Right,
    Up,
    Down,
    Home,
    End,
    Backspace,
    Delete
};
enum class EventType
{
    Press,
    Drag,
    Activate,
    Key,
    Text,
    Scroll,
    Release,
    Cancel,
    ContextMenu
};

enum class Cursor { Default, Text, ResizeHorizontal, ResizeVertical };

struct Event
{
    EventType type;
    float x = 0, y = 0;
    Key key = Key::Unknown;
    bool shift = false;
    std::string text = {};
};

struct State
{
    bool hovered, pressed, focused;
};

enum class Align
{
    Start,
    Center,
    End
};

struct StyleColor
{
    Color value{0, 0, 0, 0};
    Color Theme::* token = nullptr;
    Color resolve(const Theme& theme) const { return token ? theme.*token : value; }
};

// Missing values inherit the component's normal appearance. Colors may refer to live theme tokens.
struct Appearance
{
    std::optional<StyleColor> fill, border, text;
    std::optional<StyleColor> hoverFill, pressedFill, activeFill, disabledFill;
    float radius = -1, borderWidth = 1, fontSize = 0;
    bool bold = false;
    std::optional<Align> textAlign;
    bool focusRing = false;
};

Color resolve(const std::optional<StyleColor>& color, const Theme&, Color fallback);

// Concatenates the bytes of trivially copyable drawing inputs into a Context::paint() key.
template<typename... T>
std::string paintKey(const T&... values)
{
    static_assert((std::is_trivially_copyable<T>::value && ...), "paint keys hold raw bytes");
    std::string key;
    key.reserve((sizeof(T) + ... + size_t(0)));
    (key.append(reinterpret_cast<const char*>(&values), sizeof(values)), ...);
    return key;
}

// UI coordinates are logical pixels. The host owns window events, scaling and frame scheduling.
// Submit a frame between begin()/end(); retained paints and clips keep their parent when possible.
// Drawing calls reuse the previous frame's paint at the same call position while their inputs are
// unchanged, so a steady frame leaves the canvas without dirty regions.
// Callbacks and their captured model must survive until the next begin().
// Synchronize the canvas before rebuilding a scene that has been drawn.
class Context
{
public:
    using Handler = std::function<void(const Event&)>;

    Context();
    ~Context();
    Context(const Context&) = delete;
    Context& operator=(const Context&) = delete;

    void begin(const Theme& theme, Rect viewport, double seconds = -1);
    void end();
    double time() const { return seconds; }
    void requestFrameAt(double when) { frames.requestAt(when); }
    void requestAnimationFrame() { requestFrameAt(seconds + 1.0 / 60); }
    const FrameRequest& frameRequest() const { return frames; }
    void modal(std::string_view initialFocus, std::function<void()> dismiss = {});
    tvg::Scene* scene() const { return root; }
    const Theme& theme() const { return *tokens; }
    // The host keeps returned font names and their loaded data alive.
    std::function<const char*(std::string_view text, bool bold)> fontFor;

    // captureRelease delivers Release outside the bounds and Cancel from cancelPointer().
    State control(std::string_view id, Rect bounds, Handler handler, bool enabled = true, bool focusable = true, bool scrollable = false, bool captureRelease = false, Cursor cursor = Cursor::Default);
    void focus(std::string_view id);
    const std::string& focused() const { return focusId; }
    bool focusedWithin(Rect) const;
    // Includes disabled controls; the host must keep their bounds out of window drag regions.
    bool controlAt(float x, float y) const;
    void cancelPointer();
    Cursor cursor() const;
    // Refresh hover after host scrolling/scaling without generating a drag event.
    void setPointerPosition(float x, float y);
    void pointerMove(float x, float y);
    void pointerDown(float x, float y);
    void pointerUp(float x, float y);
    void contextMenu(float x, float y);
    void key(Key key, bool shift = false);
    void textInput(std::string_view text);
    bool wheel(float vertical, float horizontal = 0);

    void clip(Rect bounds, const std::function<void()>& render);
    // Borrowed retained scene; duplicate it before reusing the layer for a content transition.
    tvg::Scene* layer(Rect bounds, const std::function<void()>& render, uint8_t opacity = 255);
    Rect clip() const { return clipBounds; }
    // Queue reusable component scenes before updating them so reparenting uses their last drawn bounds.
    void add(tvg::Paint* paint);
    // Add make()'s paint, or reuse the one this call position drew last frame when key is unchanged.
    void paint(std::string key, const std::function<tvg::Paint*()>& make);

    void rect(Rect bounds, Color fill, float radius = 0, Color border = {0, 0, 0, 0}, float stroke = 1);
    void line(float x1, float y1, float x2, float y2, Color color, float width = 1);
    // size is a nominal em in logical px; 0 inherits Theme::fontSize. Glyph bounds and line height depend on the font.
    void text(Rect bounds, std::string_view value, Color color, float size = 0, bool bold = false, Align align = Align::Start, float horizontalOffset = 0);
    // fontContext keeps partial-label measurements on the full label's face.
    float textWidth(std::string_view value, float size = 0, bool bold = false, std::string_view fontContext = {}) const;
    // Keep the suffix when shortening; hide labels that cannot fit one character and an ellipsis.
    std::string elideText(std::string_view value, float width, float size = 0, bool bold = false, std::string_view suffix = {}) const;
    void icon(Rect bounds, Icon icon, Color color);
    // size is the asset viewport; built-ins contain a 16px outline in a 24px viewport.
    void icon(std::string_view instance, Rect bounds, Icon icon, Color color, IconState state = {}, float size = 24);
    void icon(std::string_view instance, Rect bounds, std::string_view name, Color color, IconState state = {}, float size = 24);
    bool setIcons(std::vector<IconAsset> assets, std::string& error);
    bool iconsAnimating() const;
    void focusRing(Rect bounds);

private:
    struct Control
    {
        std::string id;
        Rect bounds;
        Handler handler;
        bool enabled, focusable, scrollable, captureRelease;
        Cursor cursor;
    };

    Control* find(std::string_view id);
    Control* hit(float x, float y);
    void send(std::string_view id, const Event& event);
    struct Layer;
    void finishLayer(Layer& layer);
    void discardLayer(Layer& layer);

    std::unique_ptr<Layer> rootLayer;
    tvg::Scene* root;
    Layer* target;
    std::unordered_map<tvg::Paint*, Layer*> paintLayers;
    Icons iconRenderer;
    size_t iconSequence = 0;
    double seconds = 0;
    FrameRequest frames;
    const Theme* tokens = nullptr;
    Rect clipBounds;
    std::vector<Control> controls;
    std::string focusId, pressedId, savedFocus;
    float pointerX = -1, pointerY = -1;
    bool modalActive = false, modalFrame = false;
    std::function<void()> dismissModal;
};

}  // namespace ui

// Controls
namespace ui
{

enum class ButtonStyle
{
    Default,
    Primary,
    Quiet
};

State button(Context& context, std::string_view id, Rect bounds, std::string_view label, std::function<void()> activate, ButtonStyle style = ButtonStyle::Default, bool enabled = true, Icon icon = Icon::None, bool active = false, const Appearance& appearance = {});
State button(Context& context, std::string_view id, Rect bounds, std::string_view label, std::function<void()> activate, ButtonStyle style, bool enabled, std::string_view icon, bool active = false, const Appearance& appearance = {});
void checkbox(Context& context, std::string_view id, Rect bounds, std::string_view label, bool value, std::function<void(bool)> change, bool enabled = true);

// A small, single-line UI value, independent of document editing and text layout engines.
// Cursor offsets are UTF-8 byte boundaries; selection, grapheme navigation and IME preedit are not implemented.
struct TextInput
{
    std::string value;
    size_t cursor = 0;

    void insert(std::string_view text);
    void edit(Key key);
};

void textField(Context& context, std::string_view id, Rect bounds, TextInput& input, std::string_view placeholder, bool enabled = true, std::function<bool(Key)> keyHandler = {}, Icon leadingIcon = Icon::None, const Appearance& appearance = {});

}  // namespace ui

// Platform keyboard
namespace ui
{
struct EditorModifiers { bool shift = false, primary = false, word = false; };
}

namespace ui::platform
{
struct KeyModifiers
{
    bool shift = false, control = false, alt = false, meta = false;
};

EditorModifiers editorModifiers(KeyModifiers);
std::string shortcutLabel(std::string value);
}  // namespace ui::platform

#pragma once

#include <ui/ui.h>
#include <string>
#include <vector>

namespace ui
{
struct AppEvent
{
    enum class Type { PointerDown, PointerUp, PointerMove, Wheel, KeyDown, KeyUp, Text, PointerCancel } type;
    float x = 0, y = 0, delta = 0;
    int button = 1;
    Key key = Key::Unknown;
    std::string text;  // Text input, or the lowercase SDL key name for key events.
    bool shift = false, control = false, alt = false, meta = false;
};

struct Property
{
    std::string id, label;
    double value = 0, minimum = 0, maximum = 100, step = 1;
    bool readOnly = false;
    bool operator==(const Property&) const = default;
};

struct Action { std::string id, label; };
struct SceneObject { std::string id, name, type; };

class Application
{
public:
    virtual ~Application() = default;
    virtual std::string title() const = 0;
    virtual void render(float width, float height, double seconds) = 0;
    virtual tvg::Scene* scene() const = 0;
    virtual void event(const AppEvent&) = 0;
    virtual std::vector<Property> properties() const { return {}; }
    virtual bool property(std::string_view, double) { return false; }
    virtual std::vector<Action> actions() const { return {}; }
    // A host can query "ui.cursor" with "text", "resize-horizontal" or
    // "resize-vertical". Return true for the current cursor, false otherwise.
    virtual bool command(std::string_view, std::string_view = {}) { return false; }
    virtual std::vector<SceneObject> sceneObjects() const { return {}; }
    virtual std::string sceneSelection() const { return {}; }
    virtual bool selectSceneObject(std::string_view) { return false; }
    virtual std::vector<Property> sceneProperties() const { return {}; }
    virtual bool sceneProperty(std::string_view, double) { return false; }
};

inline constexpr unsigned moduleApiVersion = 2;
using ModuleVersion = unsigned (*)();
using ModuleCreate = Application* (*)();
using ModuleDestroy = void (*)(Application*);
}  // namespace ui

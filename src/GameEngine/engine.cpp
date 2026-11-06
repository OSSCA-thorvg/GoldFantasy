#include "engine.h"
#include "layout.h"
#include "authoring/building_editor.h"
#include <ui/script.h>
#include <core/io/io.h>
#include <core/io/path.h>
#include <core/json/json.h>
#include <fstream>
#include <iomanip>
#include <set>
#include <sstream>

namespace engine
{
namespace
{
std::string number(double value)
{
    std::ostringstream out;
    out << std::setprecision(7) << value;
    return out.str();
}

class GameEngine final : public ui::Application
{
    enum class Playback { Stopped, Playing, Paused };
    std::shared_ptr<ui::Application> module;
    ui::Script script;
    std::unique_ptr<ui::Script> playScript;
    ui::Context scriptPreview;
    std::vector<ui::Property> previewProperties;
    float previewWidth = -1, previewHeight = -1;
    double previewClock = -1;
    bool previewPaused = false;
    uint64_t sourceRevision = 0, previewRevision = ~uint64_t(0);
    bool sceneModule = false, inspectScript = false;
    std::unique_ptr<BuildingEditor> buildings;
    std::filesystem::path buildingExample;
    bool buildingClose = false;
    ui::Context context;
    ui::Theme theme = ui::Theme::dark();
    ui::Appearance compact;
    std::filesystem::path scriptPath, activeScriptPath;
    ui::TextInput pathInput;
    ui::TextInput timeInput;
    std::map<std::string, ui::TextInput> fields;
    std::set<std::string> moduleKeys;
    std::filesystem::file_time_type modified{};
    uintmax_t fileSize = 0;
    Layout panels;
    float pointerX = -1, pointerY = -1;
    ui::Rect capturedPreview;
    std::optional<bool> inspectorPreference;
    InspectorSide inspectorSide = InspectorSide::Right;
    std::optional<InspectorSide> inspectorDrop;
    bool inspectorDragging = false, inspectorDragMoved = false;
    float inspectorDragX = 0, inspectorDragY = 0;
    float inspectorWidth = defaultInspectorWidth;
    float resizeStartX = 0, resizeStartWidth = 0, resizeSavedWidth = 0;
    bool inspectorResizing = false;
    Playback playback = Playback::Stopped;
    std::optional<Playback> modulePlayback;
    double clock = 0, previous = -1, nextPoll = 0;
    double timeScale = 1, pendingStep = 0;
    float propertyScroll = 0, propertyHeight = 0;
    float objectScroll = 0;
    ui::Rect objectListBounds;
    float capturedScale = 1;
    bool modulePointer = false, moduleFocus = false, failed = false;
    std::string status;

    ui::Script& activeScript() { return playScript ? *playScript : script; }
    const ui::Script& activeScript() const { return playScript ? *playScript : script; }

    void syncPlayback()
    {
        auto state = failed && playback == Playback::Playing ? Playback::Paused : playback;
        if (!module || modulePlayback == state) return;
        module->command("runtime.playback", state == Playback::Playing ? "playing" : state == Playback::Paused ? "paused" : "stopped");
        modulePlayback = state;
    }

    void dragInspector(const ui::Event& event)
    {
        auto updateTarget = [&] {
            inspectorDragMoved |= std::hypot(event.x - inspectorDragX, event.y - inspectorDragY) >= 6;
            inspectorDrop.reset();
            if (inspectorDragMoved) {
                if (panels.dockLeft.contains(event.x, event.y)) inspectorDrop = InspectorSide::Left;
                else if (panels.dockRight.contains(event.x, event.y)) inspectorDrop = InspectorSide::Right;
            }
        };
        if (event.type == ui::EventType::Press) {
            inspectorDragging = true; inspectorDragMoved = false; inspectorDrop.reset();
            inspectorDragX = event.x; inspectorDragY = event.y;
        } else if (event.type == ui::EventType::Drag && inspectorDragging) {
            updateTarget();
        } else if (event.type == ui::EventType::Release && inspectorDragging) {
            updateTarget();
            auto target = inspectorDrop;
            inspectorDragging = false; inspectorDrop.reset();
            if (inspectorDragMoved && target) command("inspector-side", *target == InspectorSide::Left ? "left" : "right");
        } else if (event.type == ui::EventType::Cancel) {
            inspectorDragging = false; inspectorDrop.reset();
        }
    }

    void resizeInspector(const ui::Event& event)
    {
        auto move = [&](float delta) {
            inspectorWidth = clampInspectorWidth(panels.toolbar.w,
                resizeStartWidth + (inspectorSide == InspectorSide::Left ? delta : -delta));
        };
        if (event.type == ui::EventType::Press) {
            inspectorResizing = true;
            resizeStartX = event.x; resizeStartWidth = panels.inspector.w; resizeSavedWidth = inspectorWidth;
        } else if ((event.type == ui::EventType::Drag || event.type == ui::EventType::Release) && inspectorResizing) {
            move(event.x - resizeStartX);
            if (event.type == ui::EventType::Release) inspectorResizing = false;
        } else if (event.type == ui::EventType::Cancel && inspectorResizing) {
            inspectorWidth = resizeSavedWidth; inspectorResizing = false;
        } else if (event.type == ui::EventType::Key) {
            if (event.key == ui::Key::Home) inspectorWidth = defaultInspectorWidth;
            else if (event.key == ui::Key::Left || event.key == ui::Key::Right) {
                float delta = (event.key == ui::Key::Right ? 1.f : -1.f) * (event.shift ? 40.f : 10.f);
                inspectorWidth = clampInspectorWidth(panels.toolbar.w,
                    panels.inspector.w + (inspectorSide == InspectorSide::Left ? delta : -delta));
            }
        }
    }

    bool openBuildings(const std::filesystem::path& path)
    {
        if (buildings) return path.empty() || buildings->load(path);
        auto source = path.empty() ? buildingExample : path;
        auto loaded = te::io::load(source, {false, 4 * 1024 * 1024});
        if (!loaded) { status = loaded.error.message; return false; }
        gameframework::BuildingAsset asset;
        if (!gameframework::decodeBuildingAsset(loaded.value.text, asset, status)) return false;
        auto draft = std::make_unique<BuildingEditor>(asset, source);
        // Keep the document and its conflict baseline from the same explicit file read.
        if (!draft->load(source)) { status = draft->message(); return false; }
        if (module && modulePointer) module->event({ui::AppEvent::Type::PointerCancel});
        modulePointer = moduleFocus = false; context.cancelPointer(); context.focus("");
        buildings = std::move(draft); buildingClose = false;
        if (playback == Playback::Playing) command("pause");
        return true;
    }
    bool load(bool force)
    {
        if (scriptPath.empty()) return false;
        std::error_code error;
        auto time = std::filesystem::last_write_time(scriptPath, error);
        if (error) { status = "Cannot read project: " + error.message(); return false; }
        auto size = std::filesystem::file_size(scriptPath, error);
        if (error || size > 1024 * 1024) { status = "Project must be a readable Lua file under 1 MiB."; return false; }
        if (!force && time == modified && size == fileSize) return false;
        modified = time; fileSize = size;
        std::ifstream file(scriptPath, std::ios::binary);
        std::string source(size_t(size), '\0');
        if (!file || (!source.empty() && !file.read(source.data(), std::streamsize(source.size())))) {
            status = "Cannot read project: " + te::io::pathToUtf8(scriptPath);
            return false;
        }
        bool sameProject = activeScriptPath == scriptPath;
        if (!script.load(source, te::io::pathToUtf8(scriptPath), sameProject)) { status = script.error(); return false; }
        ++sourceRevision;
        if (playScript) {
            if (sameProject) playScript->load(source, te::io::pathToUtf8(scriptPath), true);
            else playScript = script.fork();
            if (playScript) playScript->onCommand = [this](std::string_view id) { command(id); };
        }
        if (!sameProject && !module) clock = 0;
        activeScriptPath = scriptPath;
        failed = false;
        status = "Reloaded " + te::io::pathToUtf8(scriptPath.filename()) + "; state and edited properties kept.";
        fields.clear();
        syncPlayback();
        return true;
    }
    std::filesystem::path propertiesPath() const
    {
        if (scriptPath.empty()) return "engine.properties";
        auto path = scriptPath;
        path += ".properties";
        return path;
    }
    bool saveProperties()
    {
        auto path = propertiesPath();
        auto baseline = te::io::load(path, {true, 1024 * 1024});
        if (!baseline) { status = baseline.error.message; return false; }
        std::ostringstream out;
        out << "engine-properties 2\n" << std::setprecision(17);
        for (const auto& item : activeScript().properties()) if (!item.readOnly) out << "script " << std::quoted(item.id) << ' ' << item.value << '\n';
        if (module) for (const auto& item : module->properties()) if (!item.readOnly) out << "module " << std::quoted(item.id) << ' ' << item.value << '\n';
        if (module && sceneModule) {
            auto selection = module->sceneSelection();
            for (const auto& object : module->sceneObjects()) {
                if (!module->selectSceneObject(object.id)) continue;
                for (const auto& item : module->sceneProperties()) if (!item.readOnly)
                    out << "object " << std::quoted(object.id) << ' ' << std::quoted(item.id) << ' ' << item.value << '\n';
            }
            module->selectSceneObject(selection);
        }
        auto saved = te::io::save(path, out.str(), {{}, baseline.value.stamp, 1024 * 1024});
        if (!saved) { status = "Could not save properties: " + saved.error.message; return false; }
        status = "Saved properties to " + te::io::pathToUtf8(path);
        return true;
    }
    bool inspectScene(std::string_view destination)
    {
        if (destination.empty()) return false;
        try {
            using Json = te::json::Value;
            auto describe = [](const std::vector<ui::Property>& fields) {
                Json::Array result;
                for (const auto& field : fields) result.emplace_back(Json::Object{
                    {"id", field.id}, {"name", field.label}, {"value", field.value}, {"minimum", field.minimum},
                    {"maximum", field.maximum}, {"step", field.step}, {"readOnly", field.readOnly}});
                return result;
            };
            Json::Array objects;
            auto selection = module ? module->sceneSelection() : "";
            for (const auto& object : sceneObjects()) {
                std::vector<ui::Property> fields;
                if (object.id == "lua:project") fields = activeScript().properties();
                else if (module && module->selectSceneObject(object.id)) fields = module->sceneProperties();
                objects.emplace_back(Json::Object{{"id", object.id}, {"name", object.name}, {"type", object.type}, {"properties", describe(fields)}});
            }
            if (module && !selection.empty()) module->selectSceneObject(selection);
            auto document = te::json::stringify(Json::Object{{"version", 1}, {"mode", playback == Playback::Stopped ? "edit" : playback == Playback::Playing ? "playing" : "paused"},
                {"elapsed", clock}, {"timeScale", timeScale}, {"selection", sceneSelection()}, {"properties", describe(properties())}, {"objects", std::move(objects)}});
            auto path = te::io::pathFromUtf8(destination);
            auto baseline = te::io::load(path, {true, 4 * 1024 * 1024});
            if (!baseline) { status = baseline.error.message; return false; }
            auto saved = te::io::save(path, document, {{}, baseline.value.stamp, 4 * 1024 * 1024});
            if (!saved) { status = saved.error.message; return false; }
            return true;
        } catch (const std::exception& error) { status = error.what(); return false; }
    }
    bool loadProperties()
    {
        auto path = propertiesPath();
        auto loaded = te::io::load(path, {false, 1024 * 1024});
        if (!loaded) { status = loaded.error.message; return false; }
        std::istringstream in(loaded.value.text);
        std::string magic, kind, id;
        int version = 0;
        if (!(in >> magic >> version) || magic != "engine-properties" || (version != 1 && version != 2)) { status = "Invalid or missing properties file: " + te::io::pathToUtf8(path); return false; }
        struct Entry { std::string kind, id, object; double value; };
        std::vector<Entry> entries;
        double value = 0;
        while (in >> kind) {
            std::string object;
            if (kind == "object" && version == 2 && !(in >> std::quoted(object))) { status = "Invalid object properties."; return false; }
            if (!(in >> std::quoted(id) >> value) || !std::isfinite(value) ||
                (kind != "script" && kind != "module" && (kind != "object" || version != 2)) || entries.size() >= 8192) {
                status = "Invalid properties file."; return false;
            }
            entries.push_back({kind, id, object, value});
        }
        if (!in.eof()) { status = "Cannot read properties file."; return false; }
        auto selection = module ? module->sceneSelection() : "";
        for (const auto& entry : entries) {
            if (entry.kind == "script") activeScript().property(entry.id, entry.value);
            else if (module && entry.kind == "module") module->property(entry.id, entry.value);
            else if (module && module->selectSceneObject(entry.object)) module->sceneProperty(entry.id, entry.value);
        }
        if (module && !selection.empty()) module->selectSceneObject(selection);
        fields.clear();
        status = "Loaded properties from " + te::io::pathToUtf8(path);
        return true;
    }
    void route(ui::AppEvent event)
    {
        bool captured = modulePointer && (event.type == ui::AppEvent::Type::PointerDown || event.type == ui::AppEvent::Type::PointerMove || event.type == ui::AppEvent::Type::PointerUp);
        float scale = captured ? capturedScale : panels.moduleScale > 0 ? panels.moduleScale : 1;
        auto bounds = captured ? capturedPreview : panels.preview;
        event.x = (event.x - bounds.x) / scale;
        event.y = (event.y - bounds.y) / scale;
        module->event(event);
    }
    bool needsInspectorRow(ui::Rect bounds, std::string_view id) const
    {
        auto visible = bounds.intersect(context.clip());
        if (visible.w > 0 && visible.h > 0) return true;
        std::string_view focused = context.focused();
        // Keep an edited field alive when scrolling it out of view.
        return focused == id || (focused.starts_with(id) && focused.size() > id.size() && focused[id.size()] == '/');
    }
    void propertiesPanel(const std::vector<ui::Property>& properties, std::string_view prefix, float& y,
                         const std::function<bool(std::string_view, double)>& change)
    {
        for (const auto& item : properties) {
            auto inspector = panels.inspector;
            auto id = std::string(prefix) + item.id;
            if (!needsInspectorRow({inspector.x, y, inspector.w, 36}, id)) { y += 36; continue; }
            auto& input = fields[id];
            if (context.focused() != id) { input.value = number(item.value); input.cursor = input.value.size(); }
            float values = inspector.x + inspector.w - 148;
            auto label = context.elideText(item.label, std::max(0.f, inspector.w - 172), 12);
            context.text({inspector.x + 12, y, std::max(0.f, inspector.w - 172), 32}, label, theme.text, 12);
            auto adjust = [this, change, item](double delta) {
                change(item.id, std::clamp(item.value + delta, item.minimum, item.maximum));
                status = "Updated " + item.label + " during preview.";
            };
            ui::button(context, id + "/minus", {values, y + 2, 24, 28}, "−", [adjust, item] { adjust(-item.step); }, ui::ButtonStyle::Quiet, !item.readOnly, ui::Icon::None, false, compact);
            ui::button(context, id + "/plus", {values + 112, y + 2, 24, 28}, "+", [adjust, item] { adjust(item.step); }, ui::ButtonStyle::Quiet, !item.readOnly, ui::Icon::None, false, compact);
            ui::textField(context, id, {values + 28, y + 2, 80, 28}, input, "Value", !item.readOnly,
                [this, id, change, item](ui::Key key) {
                    if (key != ui::Key::Enter) return false;
                    try {
                        size_t used = 0;
                        auto value = std::stod(fields.at(id).value, &used);
                        if (used != fields.at(id).value.size() || !std::isfinite(value)) throw std::invalid_argument("number");
                        change(item.id, std::clamp(value, item.minimum, item.maximum));
                        status = "Updated " + item.label + ".";
                        context.focus("");
                    } catch (const std::exception&) { status = "Enter a finite numeric value."; }
                    return true;
                }, ui::Icon::None, compact);
            context.rect({inspector.x + 12, y + 35, std::max(0.f, inspector.w - 24), 1}, theme.border);
            y += 36;
        }
    }

public:
    GameEngine(std::shared_ptr<ui::Application> module, std::filesystem::path path, std::filesystem::path example)
        : module(std::move(module)), buildingExample(std::move(example)), scriptPath(std::move(path))
    {
        if (buildingExample.empty()) {
#ifdef ENGINE_BUILDING_PATH
            buildingExample = ENGINE_BUILDING_PATH;
#endif
        }
        theme.radius = 2;
        theme.fontSize = 12;
        theme.rowHeight = 28;
        compact.radius = 2;
        compact.fontSize = 12;
        compact.border = ui::StyleColor{{}, &ui::Theme::border};
        compact.focusRing = true;
        pathInput.value = te::io::pathToUtf8(scriptPath); pathInput.cursor = pathInput.value.size();
        sceneModule = this->module && !this->module->sceneObjects().empty();
        inspectScript = !this->module;
        script.onCommand = [this](std::string_view id) { command(id); };
        if (!scriptPath.empty()) load(true);
        else status = this->module ? "Module ready. Edit properties before or during play." : "Enter a Lua project path and choose Open.";
        syncPlayback();
    }
    ~GameEngine() override { if (module) module->command("runtime.playback", "stopped"); }
    std::string title() const override { return "GameEngine — " + (module ? module->title() : script.title()); }
    tvg::Scene* scene() const override { return context.scene(); }
    std::vector<ui::Property> properties() const override
    {
        auto result = module ? module->properties() : activeScript().properties();
        result.push_back({"engine.time-scale", "Time scale", timeScale, .1, 8, .25});
        result.push_back({"engine.time", "Elapsed time", clock, 0, 1e12, 1, true});
        return result;
    }
    bool property(std::string_view id, double value) override
    {
        if (!std::isfinite(value)) return false;
        if (id == "engine.time-scale") { timeScale = std::clamp(value, .1, 8.0); return true; }
        if (id == "engine.time") return false;
        return module ? module->property(id, value) : activeScript().property(id, value);
    }
    std::vector<ui::SceneObject> sceneObjects() const override
    {
        auto result = module ? module->sceneObjects() : std::vector<ui::SceneObject>{};
        if (script.ready()) result.push_back({"lua:project", script.title(), "Lua Script"});
        return result;
    }
    std::string sceneSelection() const override { return inspectScript ? "lua:project" : module ? module->sceneSelection() : ""; }
    bool selectSceneObject(std::string_view id) override
    {
        if (id == "lua:project" && script.ready()) { inspectScript = true; fields.clear(); return true; }
        if (module && module->selectSceneObject(id)) { inspectScript = false; fields.clear(); return true; }
        return false;
    }
    std::vector<ui::Property> sceneProperties() const override { return inspectScript ? activeScript().properties() : module ? module->sceneProperties() : std::vector<ui::Property>{}; }
    bool sceneProperty(std::string_view id, double value) override { return inspectScript ? activeScript().property(id, value) : module && module->sceneProperty(id, value); }
    std::vector<ui::Action> actions() const override { return {{"play", "Play"}, {"pause", "Pause"}, {"stop", "Stop"}, {"reload", "Reload Lua"}, {"asset.editor", "Buildings"}}; }
    bool command(std::string_view id, std::string_view argument = {}) override
    {
        if (id == "ui.cursor") {
            auto cursor = context.cursor();
            return (argument == "resize-horizontal" && cursor == ui::Cursor::ResizeHorizontal) ||
                   (argument == "resize-vertical" && cursor == ui::Cursor::ResizeVertical) ||
                   (argument == "text" && cursor == ui::Cursor::Text) ||
                   (argument == "crosshair" && module && !buildings && panels.preview.contains(pointerX, pointerY) && module->command(id, argument));
        }
        if (id == "asset.available") return true;
        if (id == "asset.editor" || id == "asset.open") return openBuildings(argument.empty() ? std::filesystem::path{} : te::io::pathFromUtf8(argument));
        if (id == "asset.save" || id == "asset.export") return buildings ? buildings->command(id, argument) : module && module->command(id, argument);
        if (id.starts_with("building.")) return buildings && buildings->command(id.substr(9), argument);
        if (id == "play") {
            if (failed || buildings) return false;
            if (playback == Playback::Stopped && script.ready()) {
                playScript = script.fork();
                if (!playScript) return false;
                playScript->onCommand = [this](std::string_view id) { command(id); };
            }
            fields.clear();
            playback = Playback::Playing; syncPlayback();
            status = "Playing. Properties and Lua reload remain editable."; return true;
        }
        if (id == "pause") {
            if (playback != Playback::Playing) return true;
            playback = Playback::Paused; syncPlayback();
            status = "Paused. Edits update the preview immediately."; return true;
        }
        if (id == "stop") {
            playback = Playback::Stopped; clock = 0; pendingStep = 0;
            syncPlayback();
            playScript.reset(); fields.clear();
            if (module && !sceneModule) {
                auto authored = module->properties();
                module->command("reset");
                for (const auto& item : authored) module->property(item.id, item.value);
            }
            failed = false; status = "Edit mode. Runtime discarded; authored scene restored.";
            return true;
        }
        if (id == "time-scale") {
            try {
                size_t used = 0; auto value = std::stod(std::string(argument), &used);
                if (used != argument.size() || !std::isfinite(value) || value < .1 || value > 8) return false;
                timeScale = value; return true;
            } catch (const std::exception&) { return false; }
        }
        if (id == "step") {
            if (failed || buildings || (!module && !script.ready())) return false;
            if (playback == Playback::Stopped && !command("play")) return false;
            command("pause"); pendingStep += 1.0 / 60;
            status = "Paused. Advanced one simulation frame.";
            return true;
        }
        if (id == "scene-select") return selectSceneObject(argument);
        if (id == "scene.inspect") return inspectScene(argument);
        if (id == "reload") return load(true);
        if (id == "open") {
            auto path = argument.empty() ? pathInput.value : std::string(argument);
            if (path.empty()) { status = "Enter a Lua project path."; return false; }
            scriptPath = te::io::pathFromUtf8(path); pathInput.value = path;
            modified = {}; fileSize = 0;
            return load(true);
        }
        if (id == "save-properties") return saveProperties();
        if (id == "load-properties") return loadProperties();
        if (id == "inspector-side") {
            if (argument != "left" && argument != "right") return false;
            if (inspectorDragging || inspectorResizing) context.cancelPointer();
            inspectorSide = argument == "left" ? InspectorSide::Left : InspectorSide::Right;
            return true;
        }
        if (id == "toggle-inspector") {
            if (inspectorDragging || inspectorResizing) context.cancelPointer();
            inspectorPreference = !inspectorPreference.value_or(panels.inspectorVisible);
            if (!*inspectorPreference && (context.focusedWithin(panels.inspector) || context.focused() == "engine/inspector-resize")) context.focus("");
            return true;
        }
        return module && module->command(id, argument);
    }
    void render(float width, float height, double seconds) override
    {
        if (buildingClose) { buildings.reset(); buildingClose = false; previous = seconds; }
        if (buildings) {
            previous = seconds;
            context.begin(theme, {0, 0, width, height}, seconds);
            BuildingEditor::Apply apply;
            if (module) apply = [this](const auto& asset, std::string& error) {
                if (module->command("asset.apply", gameframework::encodeBuildingAsset(asset))) return true;
                error = "The loaded module rejected this asset. Check its ID, footprint and variant count."; return false;
            };
            buildings->render(context, {0, 0, width, height}, apply, [this] { buildingClose = true; });
            context.end(); return;
        }
        auto dt = previous < 0 ? 0 : std::clamp(seconds - previous, 0.0, .25);
        previous = seconds;
        if (seconds >= nextPoll) { nextPoll = seconds + .25; load(false); }
        double advance = !failed ? (playback == Playback::Playing ? dt * timeScale : 0) + pendingStep : 0;
        pendingStep = 0;
        if (advance > 0) {
            clock += advance;
            if (playScript && !playScript->update(advance)) { failed = true; status = playScript->error(); }
            if (module && sceneModule && playback == Playback::Paused) module->command("runtime.step");
        }
        syncPlayback();
        if (inspectorResizing && width != panels.toolbar.w) context.cancelPointer();
        panels = layout(width, height, bool(module), inspectorPreference, inspectorSide, inspectorWidth);
        if (inspectorDragging && !panels.inspectorVisible) context.cancelPointer();
        auto preview = panels.preview;
        auto inspector = panels.inspector;
        context.begin(theme, {0, 0, width, height}, seconds);
        context.rect({0, 0, width, height}, theme.background);
        if (module) module->render(moduleWidth, moduleHeight, clock);
        if (preview.w > 0 && preview.h > 0) {
            context.rect(preview, theme.surface, 0, theme.border);
            context.clip(preview, [&] {
                if (module) {
                    auto root = module->scene();
                    ui::setTransform(root, {panels.moduleScale, 0, preview.x, 0, panels.moduleScale, preview.y, 0, 0, 1});
                    context.add(root);
                }
                if (script.ready()) {
                    if (playback != Playback::Playing) {
                        auto values = activeScript().properties();
                        bool paused = playback == Playback::Paused;
                        if (previewWidth != preview.w || previewHeight != preview.h || previewRevision != sourceRevision || previewProperties != values || previewClock != clock || previewPaused != paused) {
                            auto isolated = activeScript().fork();
                            scriptPreview.begin(theme, {0, 0, preview.w, preview.h}, 0);
                            if (!isolated || !isolated->render(scriptPreview, {0, 0, preview.w, preview.h})) {
                                failed = true; status = isolated ? isolated->error() : "Cannot create script preview.";
                            }
                            scriptPreview.end();
                            previewWidth = preview.w; previewHeight = preview.h;
                            previewRevision = sourceRevision; previewProperties = std::move(values);
                            previewClock = clock; previewPaused = paused;
                        }
                        auto root = scriptPreview.scene();
                        ui::setTransform(root, {1, 0, preview.x, 0, 1, preview.y, 0, 0, 1});
                        context.add(root);
                    } else if (playScript && !playScript->render(context, preview)) { failed = true; status = playScript->error(); }
                }
                if (!module && !script.ready()) {
                    context.text({preview.x + 20, preview.y + preview.h / 2 - 30, std::max(0.f, preview.w - 40), 28},
                                 "Open a Lua project to begin", theme.text, 15, true, ui::Align::Center);
                    context.text({preview.x + 20, preview.y + preview.h / 2 + 4, std::max(0.f, preview.w - 40), 24},
                                 "Source changes reload automatically", theme.muted, 12, false, ui::Align::Center);
                }
            });
        }
        context.rect(panels.toolbar, theme.surface);
        context.rect(panels.project, theme.surface);
        context.rect({0, 43, width, 1}, theme.border);
        context.rect({0, 79, width, 1}, theme.border);
        bool narrow = width < 720;
        float inspectWidth = narrow ? 92.f : 104.f;
        float controlsX = width - 12 - inspectWidth;
        if (controlsX >= 138) context.text({12, 8, 114, 28}, "GameEngine", theme.text, 14, true);
        auto projectTitle = module ? module->title() : script.title();
        if (controlsX > 220) {
            context.rect({136, 13, 1, 18}, theme.border);
            auto name = context.elideText(projectTitle, controlsX - 160, 12);
            context.text({148, 8, controlsX - 160, 28}, name, theme.muted, 12);
        }
        ui::button(context, "engine/inspector", {controlsX, 8, inspectWidth, 28}, "Inspector", [this] { command("toggle-inspector"); }, ui::ButtonStyle::Quiet, true, ui::Icon::None, panels.inspectorVisible, compact);
        ui::button(context, "engine/buildings", {12, 48, 86, 28}, "Buildings", [this] { command("asset.editor"); }, ui::ButtonStyle::Quiet, true, ui::Icon::None, false, compact);
        ui::textField(context, "engine/path", {104, 49, std::max(0.f, width - 256), 26}, pathInput,
            module ? "Optional Lua overlay path" : "Lua project path", true,
            [this](ui::Key key) { if (key != ui::Key::Enter) return false; command("open"); return true; }, ui::Icon::None, compact);
        ui::button(context, "engine/open", {width - 146, 48, 60, 28}, "Open", [this] { command("open"); }, ui::ButtonStyle::Quiet, true, ui::Icon::None, false, compact);
        ui::button(context, "engine/reload", {width - 80, 48, 68, 28}, "Reload", [this] { command("reload"); }, ui::ButtonStyle::Quiet, !scriptPath.empty(), ui::Icon::None, false, compact);
        if (panels.viewportHeader.w > 0) {
            auto header = panels.viewportHeader;
            context.rect(header, theme.surface);
            if (panels.play.x - header.x >= 112) context.text({header.x + 12, header.y + 8, 90, 28}, playback == Playback::Stopped ? "Scene" : "Game", theme.text, 12, true);
            bool compactTransport = header.w < 600;
            ui::button(context, "engine/play", panels.play, compactTransport ? "Play" : "Play  F5", [this] { command("play"); }, ui::ButtonStyle::Primary, !failed, ui::Icon::None, playback == Playback::Playing, compact);
            ui::button(context, "engine/pause", panels.pause, compactTransport ? "Pause" : "Pause  F6", [this] { command("pause"); }, ui::ButtonStyle::Quiet, playback == Playback::Playing && !failed, ui::Icon::None, playback == Playback::Paused, compact);
            ui::button(context, "engine/stop", panels.stop, compactTransport ? "Stop" : "Stop  F7", [this] { command("stop"); }, ui::ButtonStyle::Quiet, playback != Playback::Stopped || failed, ui::Icon::None, false, compact);
            auto resolution = module ? "1280 × 800  ·  Fit " + std::to_string(int(std::lround(panels.moduleScale * 100))) + "%" : "Responsive Lua preview";
            float infoX = panels.stop.x + panels.stop.w + 16;
            if (header.x + header.w - infoX >= 190) context.text({infoX, header.y + 8, header.x + header.w - infoX - 12, 28}, resolution, theme.muted, 11, false, ui::Align::End);
            context.rect({header.x, header.y + header.h - 1, header.w, 1}, theme.border);
        }
        if (panels.timeBar.w > 0) {
            auto bar = panels.timeBar;
            context.rect(bar, theme.surface);
            context.text({bar.x + 12, bar.y + 4, 82, 28}, number(clock) + " s", theme.muted, 11);
            if (bar.w >= 340) ui::button(context, "engine/step", panels.step, "Step", [this] { command("step"); }, ui::ButtonStyle::Quiet, !failed && (module || script.ready()), ui::Icon::None, false, compact);
            if (bar.w >= 260) {
                if (bar.w >= 500) context.text({panels.timeMinus.x - 86, bar.y + 4, 80, 28}, "Time scale", theme.muted, 11, false, ui::Align::End);
                if (context.focused() != "engine/time-scale") { timeInput.value = number(timeScale); timeInput.cursor = timeInput.value.size(); }
                ui::button(context, "engine/time-minus", panels.timeMinus, "−", [this] { property("engine.time-scale", timeScale - .25); }, ui::ButtonStyle::Quiet, true, ui::Icon::None, false, compact);
                ui::textField(context, "engine/time-scale", panels.timeValue, timeInput, "Speed", true, [this](ui::Key key) {
                    if (key != ui::Key::Enter) return false;
                    if (command("time-scale", timeInput.value)) context.focus("");
                    else status = "Time scale must be between 0.1 and 8.";
                    return true;
                }, ui::Icon::None, compact);
                ui::button(context, "engine/time-plus", panels.timePlus, "+", [this] { property("engine.time-scale", timeScale + .25); }, ui::ButtonStyle::Quiet, true, ui::Icon::None, false, compact);
                context.text({panels.timePlus.x + 28, bar.y + 4, 16, 28}, "×", theme.muted, 12);
            }
            context.rect({bar.x, bar.y + bar.h - 1, bar.w, 1}, theme.border);
        }
        if (panels.inspectorVisible) {
            context.rect(inspector, theme.surface);
            if (inspector.w < width) context.rect({inspectorSide == InspectorSide::Left ? inspector.w : inspector.x - 1, inspector.y, 1, inspector.h}, theme.border);
            auto handle = context.control("engine/inspector-handle", panels.inspectorHandle,
                [this](const ui::Event& event) { dragInspector(event); }, true, false, false, true);
            auto grip = handle.hovered || inspectorDragging ? theme.accent : theme.muted;
            for (int row = 0; row < 3; ++row) for (int column = 0; column < 2; ++column)
                context.rect({inspector.x + 12 + column * 4.f, inspector.y + 11 + row * 4.f, 2, 2}, grip);
            context.text({inspector.x + 26, inspector.y + 2, std::max(0.f, inspector.w - 174), 28}, "Inspector", theme.text, 12, true);
            ui::button(context, "engine/inspector-side", panels.inspectorMove, inspectorSide == InspectorSide::Right ? "←" : "→",
                [this] { command("inspector-side", inspectorSide == InspectorSide::Right ? "left" : "right"); }, ui::ButtonStyle::Quiet, true, ui::Icon::None, false, compact);
            ui::button(context, "engine/load-properties", panels.inspectorLoad, "Load", [this] { command("load-properties"); }, ui::ButtonStyle::Quiet, true, ui::Icon::None, false, compact);
            ui::button(context, "engine/save-properties", panels.inspectorSave, "Save", [this] { command("save-properties"); }, ui::ButtonStyle::Quiet, true, ui::Icon::None, false, compact);
            context.rect({inspector.x, inspector.y + 31, inspector.w, 1}, theme.border);
            ui::Rect items{inspector.x, inspector.y + 40, inspector.w, std::max(0.f, inspector.h - 72)};
            propertyScroll = std::clamp(propertyScroll, 0.f, std::max(0.f, propertyHeight - items.h));
            float y = items.y - propertyScroll;
            context.clip(items, [&] {
                auto section = [&](const char* label) {
                    context.text({inspector.x + 12, y, inspector.w - 24, 24}, label, theme.muted, 11, true);
                    y += 28;
                };
                bool hierarchy = sceneModule || (!module && script.ready());
                if (hierarchy) {
                    auto objects = sceneObjects();
                    section("SCENE OBJECTS");
                    float listHeight = std::min(156.f, float(objects.size()) * 26);
                    objectListBounds = {inspector.x + 8, y, inspector.w - 16, listHeight};
                    objectScroll = std::clamp(objectScroll, 0.f, std::max(0.f, float(objects.size()) * 26 - listHeight));
                    context.control("engine/objects", objectListBounds, [this](const ui::Event& event) {
                        if (event.type == ui::EventType::Scroll) objectScroll -= event.y * 26;
                    }, true, false, true);
                    auto selection = sceneSelection();
                    context.clip(objectListBounds, [&] {
                        float row = y - objectScroll;
                        for (const auto& object : objects) {
                            auto id = "engine/object/" + object.id;
                            if (!needsInspectorRow({inspector.x + 12, row, inspector.w - 24, 24}, id)) { row += 26; continue; }
                            auto label = context.elideText(object.type == "World" ? object.name : object.type + " · " + object.name, inspector.w - 40, 12);
                            ui::button(context, id, {inspector.x + 12, row, inspector.w - 24, 24}, label,
                                [this, id = object.id] { selectSceneObject(id); }, ui::ButtonStyle::Quiet, true, ui::Icon::None, selection == object.id, compact);
                            row += 26;
                        }
                    });
                    y += listHeight + 12;
                    auto selected = std::find_if(objects.begin(), objects.end(), [&](const auto& object) { return object.id == selection; });
                    if (selected != objects.end()) {
                        auto label = context.elideText(selected->name + " · " + selected->type, inspector.w - 24, 11);
                        section(label.c_str());
                        propertiesPanel(sceneProperties(), "scene/", y, [this](std::string_view id, double value) { return sceneProperty(id, value); });
                        y += 12;
                    }
                }
                if (module) {
                    section(sceneModule ? "CAMERA" : "APPLICATION");
                    auto properties = module->properties();
                    if (sceneModule) std::erase_if(properties, [](const auto& item) { return item.id != "zoom" && !item.id.starts_with("camera."); });
                    propertiesPanel(properties, "module/", y, [this](std::string_view id, double value) { return module->property(id, value); });
                    y += 12;
                }
                auto properties = activeScript().properties();
                if (!hierarchy && !properties.empty()) {
                    section("LUA PROPERTIES");
                    propertiesPanel(properties, "project/", y, [this](std::string_view id, double value) { return activeScript().property(id, value); });
                    y += 12;
                }
                if (module) {
                    auto actions = module->actions();
                    if (!actions.empty()) section("ACTIONS");
                    for (const auto& action : actions) {
                        if (sceneModule && playback == Playback::Stopped && action.id == "reset") continue;
                        ui::button(context, "module/action/" + action.id, {inspector.x + 12, y, inspector.w - 24, 28}, action.label,
                                   [this, id = action.id] { module->command(id); }, ui::ButtonStyle::Quiet, true, ui::Icon::None, false, compact);
                        y += 34;
                    }
                }
                if (!module && properties.empty()) context.text({inspector.x + 12, y, inspector.w - 24, 28}, "No project properties", theme.muted, 12);
            });
            propertyHeight = y + propertyScroll - items.y;
            context.rect({inspector.x, inspector.y + inspector.h - 30, inspector.w, 1}, theme.border);
            context.text({inspector.x + 12, inspector.y + inspector.h - 28, inspector.w - 24, 26}, "Properties stay editable during play", theme.muted, 11);
        }
        if (panels.inspectorResize.w > 0 && panels.inspectorResize.h > 0) {
            auto resize = context.control("engine/inspector-resize", panels.inspectorResize,
                [this](const ui::Event& event) { resizeInspector(event); }, true, true, false, true, ui::Cursor::ResizeHorizontal);
            bool active = resize.hovered || resize.focused || inspectorResizing;
            float edge = panels.inspectorResize.x + 3;
            if (active) {
                auto tint = theme.accent; tint.a = 40;
                context.rect(panels.inspectorResize, tint);
                context.rect({edge, inspector.y, 1, inspector.h}, theme.accent);
            }
            context.rect({edge, inspector.y + std::max(0.f, (inspector.h - 28) / 2), 1, std::min(28.f, inspector.h)}, active ? theme.accent : theme.muted);
        }
        if (inspectorDragging && inspectorDragMoved) {
            auto target = [&](ui::Rect zone, InspectorSide side, const char* label) {
                bool selected = inspectorDrop == side;
                if (selected) {
                    auto tint = theme.accent; tint.a = 35;
                    context.rect(zone, tint, 0, theme.accent);
                }
                ui::Rect hint{zone.x + 12, zone.y + std::max(0.f, (zone.h - 48) / 2), std::max(0.f, zone.w - 24), std::min(48.f, zone.h)};
                context.rect(hint, selected ? theme.accent : theme.raised, 2, theme.border);
                context.text(hint, label, selected ? theme.accentText : theme.text, 12, true, ui::Align::Center);
            };
            target(panels.dockLeft, InspectorSide::Left, "Dock left");
            target(panels.dockRight, InspectorSide::Right, "Dock right");
        }
        context.rect(panels.footer, theme.surface);
        context.rect({0, panels.footer.y, width, 1}, theme.border);
        context.rect({12, panels.footer.y + 10, 5, 5}, failed ? theme.danger : playback == Playback::Playing ? theme.success : theme.muted, 1);
        auto message = context.elideText(status, std::max(0.f, width - 222), 11);
        context.text({24, panels.footer.y + 1, std::max(0.f, width - 222), 24}, message, failed ? theme.danger : theme.muted, 11);
        auto mode = playback == Playback::Playing ? "Playing" : playback == Playback::Paused ? "Paused" : "Edit";
        context.text({width - 188, panels.footer.y + 1, 176, 24}, std::string(mode) + "  ·  " + number(clock) + " s", theme.muted, 11, false, ui::Align::End);
        syncPlayback();
        context.end();
    }
    void event(const ui::AppEvent& event) override
    {
        using Type = ui::AppEvent::Type;
        if (event.type == Type::PointerMove || event.type == Type::PointerDown || event.type == Type::PointerUp || event.type == Type::Wheel) {
            pointerX = event.x; pointerY = event.y;
        }
        if (event.type == Type::KeyUp && module && moduleKeys.erase(event.text)) { route(event); return; }
        if (buildings) {
            switch (event.type) {
                case Type::PointerDown: if (event.button == 1) context.pointerDown(event.x, event.y); break;
                case Type::PointerUp: if (event.button == 1) context.pointerUp(event.x, event.y); break;
                case Type::PointerMove: context.pointerMove(event.x, event.y); break;
                case Type::PointerCancel: context.cancelPointer(); break;
                case Type::Wheel: context.pointerMove(event.x, event.y); context.wheel(event.delta); break;
                case Type::Text: context.textInput(event.text); break;
                case Type::KeyDown:
                    if ((event.control || event.meta) && event.text == "s") buildings->save();
                    else if ((event.control || event.meta) && event.text == "z") { if (event.shift) buildings->redo(); else buildings->undo(); }
                    else buildings->key(context, event.key, event.control || event.meta, event.shift);
                    break;
                case Type::KeyUp: break;
            }
            return;
        }
        if (inspectorDragging || inspectorResizing) {
            if (event.type == Type::PointerMove) context.pointerMove(event.x, event.y);
            else if (event.type == Type::PointerUp && event.button == 1) context.pointerUp(event.x, event.y);
            else if (event.type == Type::PointerCancel || event.type == Type::PointerDown ||
                     (event.type == Type::KeyDown && event.key == ui::Key::Escape)) context.cancelPointer();
            return;
        }
        switch (event.type) {
            case Type::PointerDown:
                modulePointer = module && panels.preview.contains(event.x, event.y) && !context.controlAt(event.x, event.y);
                moduleFocus = modulePointer;
                if (modulePointer) { capturedPreview = panels.preview; capturedScale = panels.moduleScale; }
                if (event.button == 1) context.pointerDown(event.x, event.y);
                if (modulePointer) route(event);
                break;
            case Type::PointerMove:
                context.pointerMove(event.x, event.y);
                if (module && (modulePointer || panels.preview.contains(event.x, event.y))) route(event);
                break;
            case Type::PointerUp:
                if (event.button == 1) context.pointerUp(event.x, event.y);
                if (modulePointer) route(event);
                modulePointer = false;
                break;
            case Type::PointerCancel:
                context.cancelPointer();
                if (module && modulePointer) module->event(event);
                modulePointer = false;
                break;
            case Type::Wheel:
                if (module && panels.preview.contains(event.x, event.y)) route(event);
                else {
                    context.pointerMove(event.x, event.y);
                    if (!context.wheel(event.delta) && panels.inspector.contains(event.x, event.y)) propertyScroll -= event.delta * 32;
                }
                break;
            case Type::KeyDown:
                if (event.text == "f5") command("play");
                else if (event.text == "f6") command("pause");
                else if (event.text == "f7") command("stop");
                else if ((event.control || event.meta) && event.text == "s") command("save-properties");
                else if ((event.control || event.meta) && event.text == "r") command("reload");
                else if (module && panels.preview.w > 0 && panels.preview.h > 0 && moduleFocus && context.focused().empty()) {
                    moduleKeys.insert(event.text);
                    route(event);
                }
                else context.key(event.key, event.shift);
                break;
            case Type::KeyUp:
                if (module && moduleKeys.erase(event.text)) route(event);
                break;
            case Type::Text:
                if (module && panels.preview.w > 0 && panels.preview.h > 0 && moduleFocus && context.focused().empty()) route(event);
                else context.textInput(event.text);
                break;
        }
    }
};
}  // namespace

std::unique_ptr<ui::Application> create(std::shared_ptr<ui::Application> module, std::filesystem::path script, std::filesystem::path buildingExample)
{
    return std::make_unique<GameEngine>(std::move(module), std::move(script), std::move(buildingExample));
}
}  // namespace engine

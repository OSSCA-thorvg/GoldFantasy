#include "application.h"
#include "game_app.h"
#include "sound_board.h"
#include "building_assets.h"
#include "ymir_born.h"
#include <core/io/path.h>
#include <ui/script.h>
#include <ui/metadata.h>
#include <charconv>
#include <numbers>
#include <random>
#include <SDL3/SDL.h>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <set>

namespace hearthold
{
namespace
{
const auto personFields = std::array{
    ui::metadata::field<Person, &Person::position, &Point::x>("position.x", "Position X", 0, 16384, .25),
    ui::metadata::field<Person, &Person::position, &Point::y>("position.y", "Position Y", 0, 16384, .25),
    ui::metadata::field<Person, &Person::health>("health", "Health", 0, 1, .05)
};
const auto buildingFields = std::array{
    ui::metadata::field<Building, &Building::center, &Point::x>("position.x", "Position X", 0, 16384, .25),
    ui::metadata::field<Building, &Building::center, &Point::y>("position.y", "Position Y", 0, 16384, .25),
    ui::metadata::field<Building, &Building::angle>("rotation", "Rotation (deg)", -360, 360, 5, 180 / std::numbers::pi),
    ui::metadata::field<Building, &Building::progress>("progress", "Construction", 0, 1, .05),
    ui::metadata::field<Building, &Building::health>("health", "Health", 0, 1, .05)
};

std::optional<int> objectId(std::string_view object, std::string_view prefix)
{
    if (!object.starts_with(prefix)) return {};
    object.remove_prefix(prefix.size());
    int id = -1;
    auto [end, error] = std::from_chars(object.data(), object.data() + object.size(), id);
    if (error != std::errc{} || end != object.data() + object.size() || id < 0) return {};
    return id;
}

class Application final : public ui::Application
{
public:
    explicit Application(LaunchOptions value) : options(std::move(value))
    {
        root->ref();
        try {
            std::string error;
            auto base = SDL_GetBasePath();
            auto installed = te::io::pathFromUtf8(base ? base : ".") / "../share/hearthold/assets/buildings";
            bool loaded = options.buildingAssets.empty() ? loadDefaultBuildingAssets(installed, error)
                : loadBuildingAssets(te::io::pathFromUtf8(options.buildingAssets), error);
            if (!loaded) throw std::runtime_error("Cannot load building assets: " + error);
            if (!buildingAssetsWarning().empty()) std::cerr << "Building assets warning: " << buildingAssetsWarning() << '\n';
            SDL_InitSubSystem(SDL_INIT_AUDIO);
            sound = std::make_unique<SoundBoard>();
            reset();
            if (!options.uiScript.empty()) {
                std::ifstream input(te::io::pathFromUtf8(options.uiScript));
                std::string source{std::istreambuf_iterator<char>(input), {}};
                if (!input || !script.load(source, options.uiScript)) throw std::runtime_error("Cannot load UI script: " + script.error());
                script.onCommand = [this](std::string_view name) { command(name, {}); };
            }
        } catch (...) {
            root->remove();
            root->unref();
            throw;
        }
    }
    ~Application() override { root->remove(); root->unref(); }
    std::string title() const override { return "GoldFantasy"; }
    tvg::Scene* scene() const override { return root; }
    void render(float width, float height, double seconds) override
    {
        if (remount) {
            root->remove(); mount(); retiredGames.clear(); remount = false;
        }
        if (pendingReset) {
            auto authored = properties();
            reset();
            for (const auto& item : authored) property(item.id, item.value);
            pendingReset = false;
        }
        bool authoring = authoringTool();
        if (editorAttached && playback == Playback::Stopped && !authoring) {
            if (dirty || width != lastWidth || height != lastHeight) {
                game->renderScene(width, height);
                scriptContext.begin(scriptTheme, {0, 0, width, height}, 0); scriptContext.end();
            }
            dirty = false; lastWidth = width; lastHeight = height;
            lastTime = 0;
            return;
        }
        double dt = lastTime < 0 ? 0 : std::max(0.0, seconds - lastTime);
        bool simulate = !editorAttached || (dt > 0 && (playback == Playback::Playing || singleStep));
        if (resumeFrame) { simulate = false; resumeFrame = false; }
        singleStep = false;
        if (editorAttached && playback == Playback::Paused && !simulate && !dirty && !game->animatingUi() && width == lastWidth && height == lastHeight) { lastTime = seconds; return; }
        if (editorAttached && !authoring && dt == 0 && !dirty && !game->animatingUi() && width == lastWidth && height == lastHeight) return;
        if (authoring && editorAttached) game->render(width, height, ui::frameTime(), false);
        else game->render(width, height, seconds, simulate, editorAttached ? 2.0 : .25, ui::frameTime());
        sound->setAmbience(game->ambience());
        for (auto cue : game->takeCues()) sound->play(cue);
        auto& activeScript = runtimeScript ? *runtimeScript : script;
        bool showScript = activeScript.ready() && (!editorAttached || playback != Playback::Stopped);
#if HEARTHOLD_WITH_EDITOR
        showScript = showScript && !game->buildingEditor();
#endif
        if (showScript) {
            if (simulate && (!editorAttached || dt > 0)) activeScript.update(dt);
            scriptContext.begin(scriptTheme, {0, 0, width, height}, seconds);
            if (editorAttached && !simulate) {
                auto preview = activeScript.fork();
                if (preview) preview->render(scriptContext, {0, 0, width, height});
            } else activeScript.render(scriptContext, {0, 0, width, height});
            scriptContext.end();
        } else if (script.ready()) {
            scriptContext.begin(scriptTheme, {0, 0, width, height}, seconds);
            scriptContext.end();
        }
        lastTime = seconds;
        dirty = authoring; lastWidth = width; lastHeight = height;
    }
    void event(const ui::AppEvent& e) override
    {
        using Type = ui::AppEvent::Type;
        if (editorAttached && playback != Playback::Playing && !authoringTool()) {
            bool openTool = e.type == Type::KeyDown && (e.text == "f2" || e.text == "f3" || e.text == "f4");
            if (!openTool) {
                if (playback == Playback::Stopped) {
                    dirty |= game->sceneEvent(e);
                    if (e.type == Type::PointerDown && e.button == 1) {
                        inspected = game->selectedBuilding() >= 0 ? "building:" + std::to_string(game->selectedBuilding()) :
                            game->selectedPeople().size() == 1 ? "unit:" + std::to_string(game->selectedPeople().front()) : "world";
                    }
                }
                return;
            }
        }
        dirty = true;
        auto button = e.button == 1 ? PointerButton::Primary : PointerButton::Secondary;
        if (e.type == Type::PointerCancel) {
            scriptContext.cancelPointer();
            scriptPointer = false;
            game->cancelPointer();
            return;
        }
#if HEARTHOLD_WITH_EDITOR
        if (e.type == Type::KeyDown && e.text == "f4" && !game->buildingEditor()
            && !game->mapEditor() && !game->characterEditor()) {
            command("edit.building", {});
            return;
        }
#endif
        bool useScript = script.ready();
#if HEARTHOLD_WITH_EDITOR
        useScript = useScript && !game->buildingEditor();
#endif
        if (useScript) {
            if (e.type == Type::PointerMove) {
                scriptContext.pointerMove(e.x, e.y);
                if (scriptPointer) return;
            }
            if (e.type == Type::KeyDown && (e.key == ui::Key::Tab || !scriptContext.focused().empty())) {
                scriptContext.key(e.key, e.shift);
                return;
            }
            if (e.type == Type::Text && !scriptContext.focused().empty()) {
                scriptContext.textInput(e.text);
                return;
            }
            if (e.type == Type::PointerDown && e.button == 1) {
                scriptPointer = scriptContext.controlAt(e.x, e.y);
                scriptContext.pointerDown(e.x, e.y);
                if (scriptPointer) return;
            }
            if (e.type == Type::PointerUp && e.button == 1) {
                scriptContext.pointerUp(e.x, e.y);
                if (scriptPointer) { scriptPointer = false; return; }
            }
        }
        if (e.type == Type::PointerDown) game->pointerDown(e.x, e.y, button);
        else if (e.type == Type::PointerUp) game->pointerUp(e.x, e.y, button);
        else if (e.type == Type::PointerMove) game->pointerMove(e.x, e.y);
        else if (e.type == Type::Wheel) game->wheel(e.x, e.y, e.delta);
#if HEARTHOLD_WITH_EDITOR
        else if (e.type == Type::Text) {
            if (game->buildingEditor()) game->buildingTextInput(e.text);
            else if (game->mapEditor()) game->mapTextInput(e.text); else game->characterTextInput(e.text);
        }
#endif
        else if (e.type == Type::KeyDown) {
#if HEARTHOLD_WITH_EDITOR
            auto mod = ui::platform::editorModifiers({e.shift, e.control, e.alt, e.meta});
            if (auto editor = game->buildingEditor()) {
                if (mod.primary && e.text == "s") editor->save();
                else if (mod.primary && e.text == "z") { if (mod.shift) editor->redo(); else editor->undo(); }
                else if (mod.primary && e.text == "y") editor->redo();
                else game->buildingKey(e.key, mod.primary, mod.shift);
                return;
            }
            if (auto editor = game->mapEditor()) {
                if (mod.primary && e.text == "s") editor->save();
                else if (mod.primary && e.text == "o") editor->load();
                else if (mod.primary && e.text == "z") { if (mod.shift) editor->redo(); else editor->undo(); }
                else if (mod.primary && e.text == "y") editor->redo();
                else if (!game->mapTextFocused() && e.text == "f") editor->fit();
                else if (!game->mapTextFocused() && e.text == "home") editor->home();
                else if (!game->mapTextFocused() && e.text.size() == 1 && e.text[0] >= '1' && e.text[0] <= '9') editor->choose(e.text[0] - '1');
                else if (!game->mapTextFocused() && e.text == "[") editor->resizeBrush(-1);
                else if (!game->mapTextFocused() && e.text == "]") editor->resizeBrush(1);
                else game->mapKey(e.key, mod.shift);
                return;
            }
            if (auto editor = game->characterEditor()) {
                if (mod.primary && e.text == "s") editor->save();
                else if (mod.primary && e.text == "o") editor->load();
                else if (mod.primary && e.text == "z") { if (mod.shift) editor->redo(); else editor->undo(); }
                else if (mod.primary && e.text == "y") editor->redo();
                else game->characterKey(e.key, mod.shift);
                return;
            }
            if (e.text == "f2" || e.text == "f3") return;
            else
#endif
            if (e.control || e.meta || e.alt) return;
            if (e.text == "space") game->togglePause();
            else if (e.text == "tab") game->cycleSpeed();
            else if (e.text == "escape") game->cancel();
            else if (e.text == "return") game->finish();
            else if (e.text == "backspace") game->undoPoint();
            else if (e.text == "r") game->rotate((e.shift ? -1.f : 1.f) * .2618f);
            else if (e.text == "m") game->prepare(GameApp::Order::Move);
            else if (e.text == "a") game->prepare(GameApp::Order::Attack);
            else if (e.text == "w" && (!game->selectedPeople().empty() || game->selectedTreeCell() >= 0 || game->selectedRockCell() >= 0)) game->prepare(GameApp::Order::Work);
            else if (e.text == "s") game->stopSelected();
            else if (e.text == "t") game->toggleAuto();
            else if (e.text == "b" && !game->selectedPeople().empty()) game->openUnitBuild();
            else if (e.text == "l") game->toggleLedger();
            else {
                static const std::map<std::string, Tool> tools{{"q",Tool::Select},{"1",Tool::Road},{"2",Tool::Field},{"p",Tool::Pave},{"c",Tool::Camp},{"3",Tool::Tent},{"4",Tool::Farm},{"5",Tool::Lumberyard},{"6",Tool::Quarry},{"w",Tool::Well},{"j",Tool::Storehouse},{"7",Tool::Market},{"8",Tool::Tavern},{"9",Tool::Inn},{"0",Tool::Guild},{"h",Tool::Shrine},{"k",Tool::MageTower},{"v",Tool::Portal},{"g",Tool::Chapel},{"b",Tool::Weaponsmith},{"n",Tool::Armorer},{"o",Tool::Apothecary},{"x",Tool::Demolish}};
                if (auto found = tools.find(e.text); found != tools.end()) game->selectTool(found->second, !game->selectedPeople().empty());
            }
            keys.insert(e.text);
        } else if (e.type == Type::KeyUp) keys.erase(e.text);
        game->setPan(float(keys.contains("right")) - float(keys.contains("left")), float(keys.contains("down")) - float(keys.contains("up")));
    }
    bool takesTyping() const
    {
#if HEARTHOLD_WITH_EDITOR
        if (game->buildingEditor() || game->mapEditor() || game->characterEditor()) return true;
#endif
        return editorAttached || !scriptContext.focused().empty();
    }
    std::vector<ui::Property> properties() const override
    {
        return {{"speed", "Simulation speed", double(game->gameSpeed()), 0, 5, 1},
                {"zoom", "Camera zoom", game->view().zoom, .1, GameApp::maxZoom, .1},
                {"camera.x", "Camera X", game->view().x, -20000, 20000, 10},
                {"camera.y", "Camera Y", game->view().y, -20000, 20000, 10},
                {"world.clock", "World clock (s)", game->state().clock(), 0, 1e12, 1, true},
                {"world.hour", "Time of day", game->state().dayFraction() * 24, 0, 23.99, .25, editorAttached && playback != Playback::Stopped}};
    }
    bool property(std::string_view id, double value) override
    {
        if (!std::isfinite(value)) return false;
        dirty = true;
        if (id == "world.hour") return (!editorAttached || playback == Playback::Stopped) && game->state().editHour(value);
        if (id == "speed") {
            int speed = int(std::clamp(value, 0.0, 5.0));
            if (!speed) { if (game->gameSpeed()) game->togglePause(); }
            else game->setSpeed(speed);
        } else if (id == "zoom") game->view().zoom = float(std::clamp(value, .1, double(GameApp::maxZoom)));
        else if (id == "camera.x") game->view().x = float(std::clamp(value, -20000.0, 20000.0));
        else if (id == "camera.y") game->view().y = float(std::clamp(value, -20000.0, 20000.0));
        else return false;
        return true;
    }
    std::vector<ui::Action> actions() const override
    {
#if HEARTHOLD_WITH_EDITOR
        return {{"edit.map", "Map Editor"}, {"edit.character", "Character Studio"}, {"edit.building", "Building Studio"}, {"reset", "Restart game"}};
#else
        return {{"reset", "Restart game"}};
#endif
    }
    bool command(std::string_view id, std::string_view argument) override
    {
        if (id == "session.suspend") {
            sound->playback(SoundBoard::Playback::Paused); keys.clear(); game->setPan(0, 0); lastTime = -1; return true;
        }
        if (id == "session.resume") {
            sound->playback(SoundBoard::Playback::Playing); lastTime = -1; resumeFrame = true; return true;
        }
        if (id == "session.save") {
            std::string error;
            return game->state().saveGame(te::io::pathFromUtf8(argument), error);
        }
        if (id == "session.load") {
            std::string error;
            auto loaded = Town::loadGame(te::io::pathFromUtf8(argument), error);
            if (!loaded) return false;
            game->state() = std::move(*loaded);
            auto p = game->state().map().camp(); auto at = project(p.x, p.y);
            game->view() = {at.x, at.y, 1}; dirty = true; lastTime = -1;
            return true;
        }
        if (id == "session.authoring") return authoringTool();
        if (id == "ui.cursor") return argument == "crosshair" && game->targetingCursor();
        // Off while nothing takes typing: an input method left on swallows the letter keys orders use.
        if (id == "ui.text-input") return argument == "off" && !takesTyping();
        if (id == "runtime.step") {
            if (!editorAttached || playback != Playback::Paused) return false;
            singleStep = true; return true;
        }
        if (id == "runtime.playback") {
            if (argument != "playing" && argument != "paused" && argument != "stopped") return false;
            if (!editorAttached) { game->selectPeople({}); editorAttached = true; }
            if (argument != "stopped" && !authoredGame) {
                auto next = std::make_unique<GameApp>(*game);
                if (script.ready()) {
                    runtimeScript = script.fork();
                    if (!runtimeScript) return false;
                    runtimeScript->onCommand = [this](std::string_view name) { command(name, {}); };
                }
                authoredSelection = inspected;
                authoredGame = std::move(game); game = std::move(next);
                remount = true; lastTime = 0;
            }
            if (argument == "stopped" && authoredGame) {
                retiredGames.push_back(std::move(game)); game = std::move(authoredGame);
                inspected = authoredSelection;
                runtimeScript.reset(); remount = true; lastTime = 0;
            }
            playback = argument == "playing" ? Playback::Playing : argument == "paused" ? Playback::Paused : Playback::Stopped;
            keys.clear(); game->setPan(0, 0); game->cancelPointer();
            scriptContext.cancelPointer(); scriptPointer = false; dirty = true;
            if (argument == "playing") sound->playback(SoundBoard::Playback::Playing);
            else if (argument == "paused") sound->playback(SoundBoard::Playback::Paused);
            else if (argument == "stopped") sound->playback(SoundBoard::Playback::Stopped);
            else return false;
            return true;
        }
        if (id == "reset") { pendingReset = true; return true; }
        if (id == "pause") { game->togglePause(); return true; }
        if (id == "speed") { game->cycleSpeed(); return true; }
        if (id == "asset.apply") {
            std::string error;
            bool accepted = applyBuildingAsset(argument, error);
            dirty |= accepted;
            if (!accepted) std::cerr << "Building asset rejected: " << error << '\n';
            return accepted;
        }
#if HEARTHOLD_WITH_EDITOR
        if (id == "asset.available") return true;
        if (id == "edit.building" || id == "asset.editor" || id == "asset.open" || id == "asset.save" || id == "asset.export") {
            keys.clear(); game->setPan(0, 0);
            scriptContext.cancelPointer(); scriptPointer = false;
            return game->buildingCommand(id == "edit.building" ? "asset.editor" : id, argument);
        }
        if (id == "edit.map") { game->openMapEditor(); return true; }
        if (id == "edit.character") { game->openCharacterEditor(); return true; }
#endif
        return false;
    }
private:
    bool authoringTool() const
    {
#if HEARTHOLD_WITH_EDITOR
        return game->buildingEditor() || game->mapEditor() || game->characterEditor();
#else
        return false;
#endif
    }
    void mount() { root->add(game->worldScene()); root->add(game->hudScene()); root->add(scriptContext.scene()); }
    void reset()
    {
        root->remove();
        game = std::make_unique<GameApp>(worldSeed(options));
        std::string error;
        if (!options.mapFile.empty() && !game->loadMapFile(te::io::pathFromUtf8(options.mapFile), error)) throw std::runtime_error(error);
        if (options.demo) buildDemo(*game, options.days);
        if (options.raid) game->state().summonRaid();
        if (!options.weather.empty()) {
            auto kind = options.weather == "snow" ? Weather::Snow : options.weather == "storm" ? Weather::Storm : options.weather == "clear" ? Weather::Clear : Weather::Rain;
            game->state().weather().force(kind, kind == Weather::Clear ? 0 : 1);
        }
#if HEARTHOLD_WITH_EDITOR
        if (options.mapEditor) game->openMapEditor();
        if ((options.buildingStudio || !options.buildingFile.empty()) && !game->openBuildingEditor(te::io::pathFromUtf8(options.buildingFile)))
            throw std::runtime_error("Cannot open building asset: " + options.buildingFile);
        if (options.studio || !options.characterFile.empty()) {
            game->openCharacterEditor();
            if (!options.characterFile.empty()) {
                CharacterPreset preset;
                if (!loadCharacter(te::io::pathFromUtf8(options.characterFile), preset, error)) throw std::runtime_error(error);
                game->characterEditor()->setPreset(preset);
                game->characterEditor()->setPresetPath(te::io::pathFromUtf8(options.characterFile));
            }
        }
#endif
        mount(); dirty = true;
        keys.clear(); lastTime = -1;
    }
    LaunchOptions options;
    tvg::Scene* root = tvg::Scene::gen();
    std::unique_ptr<GameApp> game;
    std::unique_ptr<GameApp> authoredGame;
    std::vector<std::unique_ptr<GameApp>> retiredGames;
    std::unique_ptr<SoundBoard> sound;
    ui::Script script;
    std::unique_ptr<ui::Script> runtimeScript;
    ui::Context scriptContext;
    ui::Theme scriptTheme = ui::Theme::dark();
    std::set<std::string> keys;
    double lastTime = -1;
    bool scriptPointer = false, pendingReset = false, resumeFrame = false;
    enum class Playback { Stopped, Playing, Paused };
    Playback playback = Playback::Playing;
    bool editorAttached = false, dirty = true, remount = false, singleStep = false;
    float lastWidth = 0, lastHeight = 0;
    std::string inspected = "world", authoredSelection = "world";

public:
    std::vector<ui::SceneObject> sceneObjects() const override
    {
        std::vector<ui::SceneObject> objects{{"world", "World", "World"}};
        for (const auto& person : game->state().people()) objects.push_back({"unit:" + std::to_string(person.id), person.name, "Unit"});
        for (const auto& building : game->state().buildings()) objects.push_back({"building:" + std::to_string(building.id), structureSpec(building.kind).name, "Building"});
        if (script.ready()) objects.push_back({"script:hud", script.title(), "Lua Script"});
        return objects;
    }
    std::string sceneSelection() const override { return inspected; }
    bool selectSceneObject(std::string_view id) override
    {
        bool editing = !editorAttached || playback == Playback::Stopped;
        if (id == "world" || (id == "script:hud" && script.ready())) { if (editing) game->selectPeople({}); }
        else if (auto unit = objectId(id, "unit:"); unit && game->state().person(*unit)) { if (editing) game->selectPeople({*unit}); }
        else if (auto building = objectId(id, "building:"); building && game->state().building(*building)) { if (editing) game->selectBuilding(*building); }
        else return false;
        inspected = id; dirty = true; return true;
    }
    std::vector<ui::Property> sceneProperties() const override
    {
        std::vector<ui::Property> result;
        if (auto unit = objectId(inspected, "unit:")) {
            if (const auto* person = game->state().person(*unit)) for (const auto& field : personFields) result.push_back(field.describe(*person));
        } else if (auto id = objectId(inspected, "building:")) {
            if (const auto* building = game->state().building(*id)) for (const auto& field : buildingFields) result.push_back(field.describe(*building));
        } else if (inspected == "script:hud") return runtimeScript ? runtimeScript->properties() : script.properties();
        else {
            result = {{"world.hour", "Time of day", game->state().dayFraction() * 24, 0, 23.99, .25, editorAttached && playback != Playback::Stopped},
                {"map.width", "Map width", double(game->state().map().width()), 0, 16384, 1, true},
                {"map.height", "Map height", double(game->state().map().height()), 0, 16384, 1, true},
                {"world.clock", "World clock (s)", game->state().clock(), 0, 1e12, 1, true}};
        }
        for (auto& field : result) {
            if (field.id == "position.x") field.maximum = game->state().map().width() - .01;
            if (field.id == "position.y") field.maximum = game->state().map().height() - .01;
        }
        return result;
    }
    bool sceneProperty(std::string_view id, double value) override
    {
        if (!std::isfinite(value)) return false;
        bool accepted = false;
        if (auto unit = objectId(inspected, "unit:")) {
            if (const auto* person = game->state().person(*unit)) {
                auto draft = *person;
                for (const auto& field : personFields) if (field.schema.id == id && field.apply(draft, value))
                    accepted = game->state().editPerson(*unit, draft.position, draft.health);
            }
        } else if (auto building = objectId(inspected, "building:")) {
            if (const auto* source = game->state().building(*building)) {
                auto draft = *source;
                for (const auto& field : buildingFields) if (field.schema.id == id && field.apply(draft, value))
                    accepted = game->state().editBuilding(*building, draft.center, draft.angle, draft.progress, draft.health);
            }
        } else if (inspected == "script:hud") accepted = (runtimeScript ? *runtimeScript : script).property(id, value);
        else if (id == "world.hour") accepted = property(id, value);
        dirty |= accepted;
        return accepted;
    }
};
}
uint32_t worldSeed(const LaunchOptions& options)
{
    if (options.world == WorldMode::Designed) return designedWorldSeed;
    return options.seed ? *options.seed : std::random_device{}();
}

std::unique_ptr<ui::Application> createApplication(const LaunchOptions& options)
{
    if (options.titleScreen) return createSceneApplication(options);
    return std::make_unique<Application>(options);
}
}

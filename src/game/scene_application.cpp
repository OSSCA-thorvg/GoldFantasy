#include "application.h"
#include <SDL3/SDL.h>
#include <core/io/path.h>
#include <algorithm>
#include <fstream>
#include <optional>
#include <ui/fonts/system_fonts.h>
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif

namespace hearthold
{
namespace
{
enum class SceneId { Title, Game, CharacterStudio, MapEditor };

// Scene ownership lives here. Editors never run inside the player's game session.
class SceneApplication final : public ui::Application
{
public:
    explicit SceneApplication(LaunchOptions value) : options(std::move(value))
    {
        root->ref();
        overlay.fontFor = [this](std::string_view text, bool bold) -> const char* {
            if (std::all_of(text.begin(), text.end(), [](unsigned char c) { return c < 128; })) return nullptr;
            auto id = systemFonts.uiFont(text, bold);
            return id ? fonts->textFont(id) : nullptr;
        };
        options.titleScreen = false;
        if (!options.saveFile.empty()) savePath = te::io::pathFromUtf8(options.saveFile);
        else {
            char* pref = SDL_GetPrefPath("GoldFantasy", "GoldFantasy");
            savePath = te::io::pathFromUtf8(pref ? pref : ".") / "continue.goldfantasy";
            SDL_free(pref);
        }
        #ifdef __EMSCRIPTEN__
        if (options.saveFile.empty()) savePath = "/data/continue.goldfantasy";
        #endif
        loadLandscape();
        if (options.studio || !options.characterFile.empty()) requested = SceneId::CharacterStudio;
        else if (options.mapEditor) requested = SceneId::MapEditor;
        else if (options.demo || options.buildingStudio || !options.buildingFile.empty()) requested = SceneId::Game;
    }
    ~SceneApplication() override { root->remove(); root->unref(); }
    std::string title() const override { return "GoldFantasy"; }
    tvg::Scene* scene() const override { return root; }
    void render(float width, float height, double seconds) override
    {
        if (requested) { transition(*requested); requested.reset(); }
        ui::Theme theme = current == SceneId::Title ? ui::Theme::light() : ui::Theme::dark();
        theme.accent = {210, 184, 113, 255};
        if (current == SceneId::Title) {
            theme.surface = {244, 248, 240, 235}; theme.raised = {237, 244, 233, 245};
            theme.text = {46, 67, 62, 255}; theme.accentText = {46, 53, 37, 255};
            theme.border = {153, 174, 156, 180}; theme.radius = 5;
        }
        overlay.begin(theme, {0, 0, width, height}, seconds);
        if (current == SceneId::Title) {
            overlay.rect({0, 0, width, height}, {235, 246, 252, 255});
            if (!landscape.empty()) {
                float scale = std::max(width / imageWidth, height * .42f / imageHeight);
                float imageH = imageHeight * scale;
                overlay.paint("title-landscape-" + std::to_string(width) + "-" + std::to_string(height), [&]() -> tvg::Paint* {
                    auto picture = tvg::Picture::gen();
                    picture->load(landscape.data(), imageWidth, imageHeight, tvg::ColorSpace::ABGR8888, true);
                    picture->scale(scale); picture->translate((width - imageWidth * scale) / 2, height - imageH);
                    return picture;
                });
            }
            overlay.text({0, height * .105f, width, 28}, "A WORLD WAITING FOR YOUR STORY", {93, 119, 119, 255}, 12, true, ui::Align::Center);
            overlay.text({0, height * .155f, width, 90}, "GoldFantasy", {46, 67, 62, 255}, std::min(72.f, width / 12), true, ui::Align::Center);
            float bw = std::min(300.f, width - 48), left = (width - bw) / 2, top = height * .34f;
            ui::button(overlay, "new-game", {left, top, bw, 44}, "Start Game", [this] { newGame = true; requested = SceneId::Game; }, ui::ButtonStyle::Primary);
            ui::button(overlay, "continue", {left, top + 53, bw, 44}, "Continue", [this] { continueGame = true; requested = SceneId::Game; }, ui::ButtonStyle::Default, gameSession || std::filesystem::exists(savePath));
#if HEARTHOLD_WITH_EDITOR
            ui::button(overlay, "studio", {left, top + 106, bw, 40}, "Character Studio", [this] { requested = SceneId::CharacterStudio; });
            ui::button(overlay, "map-editor", {left, top + 155, bw, 40}, "Map Editor", [this] { requested = SceneId::MapEditor; });
#endif
            if (!message.empty()) overlay.text({24, top + 209, width - 48, 42}, message, {110, 54, 42, 255}, 14, false, ui::Align::Center);
        } else {
            auto* session = active();
            session->render(width, height, seconds);
            if (current != SceneId::Game && !session->command("session.authoring")) {
                if (current == SceneId::MapEditor) { gameSession = std::move(editorSession); requested = SceneId::Game; }
                else requested = SceneId::Title;
            }
            ui::button(overlay, "title", {width - 150, 12, 134, 32}, "Back to Title", [this] { requested = SceneId::Title; });
            if (current == SceneId::Game) {
                ui::button(overlay, "save-game", {width - 150, 52, 134, 32}, "Save", [this] { save(); });
                if (!message.empty()) overlay.text({width - 430, 93, 410, 30}, message, theme.text, 14, false, ui::Align::End);
            }
        }
        overlay.end();
    }
    void event(const ui::AppEvent& event) override
    {
        using Type = ui::AppEvent::Type;
        if (event.type == Type::PointerCancel) { overlay.cancelPointer(); if (active()) active()->event(event); return; }
        if (event.type == Type::KeyDown && (event.control || event.meta) && event.text == "s" && current == SceneId::Game) { save(); return; }
        if (event.type == Type::KeyDown && event.text == "escape" && current != SceneId::Game) { requested = SceneId::Title; return; }
        if (event.type == Type::PointerMove) overlay.pointerMove(event.x, event.y);
        if (event.type == Type::PointerDown && event.button == 1) {
            overlayPointer = overlay.controlAt(event.x, event.y);
            if (overlayPointer) { overlay.pointerDown(event.x, event.y); return; }
        }
        if (event.type == Type::PointerUp && event.button == 1 && overlayPointer) {
            overlay.pointerUp(event.x, event.y); overlayPointer = false; return;
        }
        if (current == SceneId::Title) {
            if (event.type == Type::KeyDown) {
                overlay.key(event.key, event.shift);
                if (event.text == "return" && overlay.focused().empty()) { newGame = true; requested = SceneId::Game; }
            }
            return;
        }
        // Editor launch shortcuts belong to the title, never the live settlement.
        if (current == SceneId::Game && event.type == Type::KeyDown && (event.text == "f2" || event.text == "f3")) return;
        if (!overlayPointer && active()) active()->event(event);
    }
    bool command(std::string_view id, std::string_view argument) override
    {
        if (id == "scene.title") { requested = SceneId::Title; return true; }
        if (id == "scene.new") { newGame = true; requested = SceneId::Game; return true; }
        if (id == "scene.continue") { continueGame = true; requested = SceneId::Game; return true; }
        if (id == "scene.is-title") return current == SceneId::Title;
        if (id == "scene.is-game") return current == SceneId::Game;
        if (id == "session.save") return save();
#if HEARTHOLD_WITH_EDITOR
        if (id == "edit.character") { if (current != SceneId::Title) return false; requested = SceneId::CharacterStudio; return true; }
        if (id == "edit.map") { if (current != SceneId::Title) return false; requested = SceneId::MapEditor; return true; }
#endif
        return active() && active()->command(id, argument);
    }
    std::vector<ui::Property> properties() const override { return active() ? active()->properties() : std::vector<ui::Property>{}; }
    bool property(std::string_view id, double value) override { return active() && active()->property(id, value); }
    std::vector<ui::Action> actions() const override { return {{"scene.title", "Back to Title"}, {"session.save", "Save"}}; }
private:
    ui::Application* active() const { return current == SceneId::Game ? gameSession.get() : current == SceneId::Title ? nullptr : editorSession.get(); }
    void transition(SceneId next)
    {
        root->remove(); overlay.cancelPointer(); overlayPointer = false;
        if (active()) {
            ui::AppEvent cancel{}; cancel.type = ui::AppEvent::Type::PointerCancel;
            active()->event(cancel); active()->command("session.suspend");
        }
        message.clear();
        if (next == SceneId::Game) {
            if (newGame || !gameSession) {
                auto launch = options; launch.studio = launch.mapEditor = false; launch.characterFile.clear();
                auto candidate = createApplication(launch);
                if (continueGame && !candidate->command("session.load", te::io::pathToUtf8(savePath))) {
                    message = "Could not load the saved game."; next = SceneId::Title;
                } else gameSession = std::move(candidate);
            }
            newGame = continueGame = false;
        } else if (next != SceneId::Title) {
            auto launch = options; launch.demo = launch.raid = launch.buildingStudio = false; launch.buildingFile.clear();
            launch.studio = next == SceneId::CharacterStudio; launch.mapEditor = next == SceneId::MapEditor;
            if (!launch.studio) launch.characterFile.clear();
            editorSession = createApplication(launch);
        }
        current = next;
        if (active()) { active()->command("session.resume"); root->add(active()->scene()); }
        root->add(overlay.scene());
        if (current == SceneId::Title) editorSession.reset();
    }
    bool save()
    {
        if (current != SceneId::Game || !gameSession) return false;
        bool ok = gameSession->command("session.save", te::io::pathToUtf8(savePath));
#ifdef __EMSCRIPTEN__
        if (ok) EM_ASM({ FS.syncfs(false, function(error) { if (error) console.error(error); }); });
#endif
        message = ok ? "Game saved." : "Could not save the game."; return ok;
    }
    void loadLandscape()
    {
        auto path = te::io::pathFromUtf8(TITLE_ASSET_PATH);
        if (!std::filesystem::exists(path) && std::filesystem::exists("/assets/title/landscape.rgba")) path = "/assets/title/landscape.rgba";
        if (!std::filesystem::exists(path)) path = te::io::pathFromUtf8(SDL_GetBasePath()) / "../share/hearthold/assets/title/landscape.rgba";
        std::ifstream in(path, std::ios::binary);
        if (!in.read(reinterpret_cast<char*>(&imageWidth), 4) || !in.read(reinterpret_cast<char*>(&imageHeight), 4) || imageWidth > 4096 || imageHeight > 4096) return;
        landscape.resize(size_t(imageWidth) * imageHeight);
        if (!in.read(reinterpret_cast<char*>(landscape.data()), std::streamsize(landscape.size() * 4))) landscape.clear();
    }
    LaunchOptions options;
    SceneId current = SceneId::Title;
    std::optional<SceneId> requested = SceneId::Title;
    std::unique_ptr<ui::Application> gameSession, editorSession;
    tvg::Scene* root = tvg::Scene::gen();
    std::unique_ptr<te::FontDatabase> fonts{te::FontDatabase::gen()};
    ui::SystemFonts systemFonts{*fonts};
    ui::Context overlay;
    bool newGame = false, continueGame = false, overlayPointer = false;
    std::filesystem::path savePath;
    std::string message;
    uint32_t imageWidth = 0, imageHeight = 0;
    std::vector<uint32_t> landscape;
};
}
std::unique_ptr<ui::Application> createSceneApplication(const LaunchOptions& options) { return std::make_unique<SceneApplication>(options); }
}

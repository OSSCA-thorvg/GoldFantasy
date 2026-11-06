#pragma once

#include "town.h"
#include "traffic.h"
#include "world_renderer.h"
#include "world_sprites.h"
#include "person_speech.h"
#include "music_director.h"
#include "thunderstorm.h"
#if HEARTHOLD_WITH_EDITOR
#include "authoring/character_editor.h"
#include "authoring/map_editor.h"
#include <GameEngine/authoring/building_editor.h>
#endif
#include <ui/fonts/system_fonts.h>
#include <ui/ui.h>
#include <ui/application.h>
#include <array>
#include <optional>
#include <filesystem>
#include <memory>
#include <unordered_map>

namespace hearthold
{
enum class Tool { Select, Road, Pave, Field, Camp, Tent, Farm, Lumberyard, Quarry, Well, Storehouse, Market, Tavern, Inn, Guild, Chapel, Weaponsmith, Armorer, Apothecary, Shrine, MageTower, Portal, Demolish, Count };

enum class PointerButton { Primary, Secondary };

// One-shot sounds the game asks for; the window layer plays them. Thunder comes in four distances, from right
// overhead to beyond the hills; Music starts a track, or with none lets the music fade.
enum class Cue : uint8_t {
    Place, Demolish, Click, Notice, Alarm, Order, Clash, Bite, Arrow, Complete, Speech, SpeechStop, Howl, Chop, TreeFall,
    Refuse, Open, Growth, Coins, Raven, ThunderCrack, ThunderStrike, ThunderClap, ThunderRumble, Discover, Unseal, Mine, Music
};
enum class SpeechChannel : uint8_t { Selected, Nearby };

// A cue placed in the stereo field: louder near the middle of the view, panned to where it happened.
struct Sound
{
    Cue cue;
    float gain = 1, pan = 0;  // pan -1 left .. 1 right.
    VoiceLine line = VoiceLine::None;
    VoiceKind voice = VoiceKind::Huntress;
    int8_t take = 0;  // Which take of the line is said.
    float pitch = 1, delay = 0, offset = 0, duration = 0;
    int speaker = -2;  // -1 is the studio preview; -2 stops every speech voice.
    SpeechChannel speechChannel = SpeechChannel::Selected;
    std::string_view track = {};  // Music: the embedded track to play.
};

// Ambient sound levels, 0..1, for the current view; pans say where the loudest source sits.
struct Ambience
{
    float rain = 0, wind = 0, night = 0, birds = 0, hammering = 0, fire = 0;
    float hammerPan = 0, firePan = 0;
    float water = 0, waterPan = 0;    // Shore and stream within earshot.
    float woods = 0;                  // Trees about: leaves in the wind, owls at night.
    float chopping = 0, chopPan = 0;  // Woodcutters at their axes.
    float music = 0;  // A bard in town: the score plays.
    float raid = 0;   // Music turns to war drums.
    // For choosing the music: the hour (0 noon .. 1 midnight), winter, and a wet sky.
    float dark = 0, winter = 0, gloom = 0;
};

// The structure a placement tool builds.
std::optional<Structure> toolStructure(Tool);
// How a notice sounds, from what it tells.
Cue noticeCue(std::string_view text);

// Window-independent game: input in logical pixels, a world scene and a ui::Context HUD.
class GameApp
{
public:
    explicit GameApp(uint32_t seed);
    // Independent world and render state for Play; no editor input/UI is shared.
    GameApp(const GameApp&);

    void render(float width, float height, double seconds, bool simulate = true, double maxDelta = .25, double uiSeconds = -1);
    bool animatingUi() const { return dockProgress < 1; }
    ui::Rect contextPanelBounds() const { return dockBounds; }
    void renderScene(float width, float height);
    bool sceneEvent(const ui::AppEvent&);
    tvg::Scene* worldScene() const { return renderer.scene(); }
    tvg::Scene* hudScene() const { return context.scene(); }
    // Continuous frames while buildings rise or the camera glides; ambient life otherwise.
    double nextFrameDelay() const;

    void pointerDown(float x, float y, PointerButton);
    void pointerMove(float x, float y);
    void pointerUp(float x, float y, PointerButton);
    void cancelStroke();
    void cancelPointer();
    void wheel(float x, float y, float amount);
    void selectTool(Tool, bool useSelection = false);
    bool loadMapFile(const std::filesystem::path&, std::string& error);
#if HEARTHOLD_WITH_EDITOR
    bool openBuildingEditor(const std::filesystem::path& = {});
    engine::BuildingEditor* buildingEditor() { return buildings.get(); }
    const engine::BuildingEditor* buildingEditor() const { return buildings.get(); }
    bool buildingCommand(std::string_view id, std::string_view argument = {});
    void buildingKey(ui::Key, bool primary = false, bool shift = false);
    void buildingTextInput(std::string_view text) { if (buildings) context.textInput(text); }
    void buildingWheel(float amount) { if (buildings) context.wheel(amount); }
    void openCharacterEditor();
    void closeCharacterEditor(bool apply);
    void openMapEditor();
    void closeMapEditor(bool play);
    MapEditor* mapEditor() { return atlas ? &*atlas : nullptr; }
    const MapEditor* mapEditor() const { return atlas ? &*atlas : nullptr; }
    void mapKey(ui::Key key, bool shift = false);
    void mapTextInput(std::string_view text) { if (atlas) context.textInput(text); }
    bool mapTextFocused() const { return atlas && atlas->textFocused(context); }
    CharacterEditor* characterEditor() { return editor ? &*editor : nullptr; }
    const CharacterEditor* characterEditor() const { return editor ? &*editor : nullptr; }
    void characterKey(ui::Key key, bool shift = false) { if (editor) context.key(key, shift); }
    void characterTextInput(std::string_view text) { if (editor) context.textInput(text); }
#endif
    // Esc: drop the drawing in progress, then the selection, then the tool.
    void cancel();
    // Enter: finish the field outline being drawn.
    void finish();
    // Backspace: cancel a road stroke or drop the last field corner.
    void undoPoint();
    // M and A with units selected: the next click moves them, or attack-moves them (or attacks a monster).
    enum class Order { None, Move, Attack, Work };
    void prepare(Order order);
    Order pendingOrder() const { return pending; }
    bool targetingCursor() const;
    void toggleAuto();
    void stopSelected();
    void openUnitBuild();
    int selectedTreeCell() const { return selectedTree; }
    int selectedRockCell() const { return selectedRock; }
    // R: turn the building about to be placed.
    void rotate(float radians) { freeAngle += radians; }
    // Space pauses; Tab steps through 1x to 5x.
    static constexpr int maxSpeed = 5;
    // L opens and closes the finances panel.
    void toggleLedger() { ledgerOpen = !ledgerOpen; }
    void togglePause() { paused = !paused; }
    void cycleSpeed() { speed = speed >= maxSpeed ? 1 : speed + 1; paused = false; }
    void setSpeed(int value) { speed = value; paused = false; }
    int gameSpeed() const { return paused ? 0 : speed; }
    // Sounds since the last call, oldest first.
    std::vector<Sound> takeCues();
    bool sayPerson(int id, std::string_view text);
    const PersonSpeech* personSpeech(int id) const;
    Ambience ambience() const;
    void setPan(float dx, float dy) { pan = {dx, dy}; }
    // Close enough to read faces on the street.
    static constexpr float maxZoom = 6;
    void zoomBy(float factor, Point screen);

    Town& state() { return town; }
    Camera& view() { return camera; }
    int selectedBuilding() const { return selected; }
    const std::vector<int>& selectedPeople() const { return chosen; }
    void selectPeople(std::vector<int> ids) { selectTool(Tool::Select); chosen = std::move(ids); selected = selectedDungeon = selectedTree = selectedRock = -1; }
    void selectBuilding(int id) { selectTool(Tool::Select); selected = id; residentPage = 0; selectedDungeon = selectedTree = selectedRock = -1; chosen.clear(); }

private:
    void initFonts();
    std::optional<Point> scenePanAt, sceneDragAt, sceneDragOrigin;
    void startMap(WorldMap);
#if HEARTHOLD_WITH_EDITOR
    std::unique_ptr<engine::BuildingEditor> buildings;
    bool buildingClose = false;
    std::optional<MapEditor> atlas;
    std::optional<bool> mapDecision;
#endif
    struct Plan
    {
        Preview preview;
        std::string problem;
        Resources cost;
    };

    void cue(Cue sound)
    {
        if (cues.size() < 32) cues.push_back({sound});
    }
    // A cue from somewhere in the world, placed by the camera.
    void cueAt(Cue, Point world);
    void updateSpeech(double seconds);
    void speechBubbles(float width, float height);
    void speechAudio(const PersonSpeech&, int speaker, Sound placement, double seconds, uint64_t& heard, bool audible);
    Sound spatial(Cue, Point world) const;
    void hud(float width, float height);
    float inspector(ui::Rect panel, bool draw = true);
    void ledgerPanel(ui::Rect below);
    void personPanel(ui::Rect panel);
    ui::Rect personPanelBounds(float width, float height, bool commands) const;
    bool residentSelection() const;
    bool shelteredSelection() const;
    void leaveSelected();
    // Unit commands: Build opens categories, then their buildings.
    void commandCard(ui::Rect area, float scale, bool global = false, bool buildMenu = false);
    ui::Rect buildMenuBounds(float width, float height, bool global) const;
    void updateContextDock(float width, float height);
    void renderDockContent(ui::Rect panel);
    ui::Rect placementPanelBounds(float width, float height) const;
    void placementPanel(ui::Rect panel);
    void dismissBuildDrawer();
    void taskbar(float width, float height);
    void commandOverlay();
    void queueWork(Activity, int target);
    void dispatchWork(bool force = false);
    void issueOrder(Order);
    int treeAtScreen(Point) const;
    int rockAtScreen(Point) const;
    // The building drawn under a screen point, or the one whose footprint lies there.
    int buildingAtScreen(Point) const;
    // Person under the pointer, or -1.
    int personAt(Point screen) const;
    // Right click with people selected: build, work, relax or walk where clicked.
    void command();
    Outline fieldRectangle(Point from, Point to) const;
    Plan plan() const;
    std::optional<Structure> toolStructure() const { return hearthold::toolStructure(tool); }
    Point toScreen(Point world) const;
    bool nearOnScreen(Point world, float pixels = 9) const;
    // Cursor snapped onto a nearby road so new roads join it.
    Point roadPoint() const;
    int hoveredRoad() const;
    void sampleRoad();
    RoadPath roadDraft() const;
    void finishRoad();
    void press();
    void select();

    Town town;
    Traffic traffic;
    WorldRenderer renderer;
    std::unique_ptr<te::FontDatabase> fonts{te::FontDatabase::gen()};
    ui::SystemFonts systemFonts{*fonts};
    ui::Context context;
    ui::Theme theme;
    Camera camera;
    Tool tool = Tool::Select;
    Point mouse{-1, -1}, cursor{-1, -1};
    Point pan;
    std::vector<Point> roadStroke;
    Point roadStart;
    std::optional<Point> roadPress;
    bool roadMoved = false;
    Outline outline;
    float freeAngle = 0;
    std::optional<Point> panFrom, pressAt;
    std::optional<Point> boxFrom;      // Screen point where a selection box started.
    std::optional<Point> fieldFrom;    // World point where a field drag started.
    std::vector<int> chosen;           // Selected people.
    int speed = 1;
    bool paused = false;
    bool ledgerOpen = false;  // The finances panel under the realm summary.
    int card = -1;      // Unit card commands: -1 orders, 0 build categories, n the n-th category.
    int globalCard = -1;
    bool drawerOpen = false, drawerPinned = false, drawerSuppressed = false;
    enum class DockView { Handle, Build, Unit, Inspector, Resource, Placement };
    DockView dockView = DockView::Handle;
    std::string dockKey;
    ui::Rect dockBounds{}, dockFrom{}, dockTarget{}, dockGhostBounds{}, drawerBridge{};
    double dockStarted = -1;
    float dockProgress = 1, dockDuration = .24f;
    std::shared_ptr<tvg::Paint> dockContent, dockGhost;
    struct DockPortrait { std::string key; std::shared_ptr<tvg::Paint> paint; };
    std::unordered_map<int, DockPortrait> dockPortraits;
    size_t residentPage = 0;
    Order pending = Order::None;
    std::vector<int> crew;  // Units who build what is placed next, picked from their card.
    std::vector<Sound> cues;
    // The soundscape (game_soundscape.cpp): a tune for the moment now and then, thunder and ravens, and people
    // answering when picked out, given orders, hurt or alarmed.
    void soundscape(double seconds);
    void playMoment(Moment, double seconds);
    void raiseAlarm(double seconds);
    void grunt(int id);
    bool sayLine(int id, VoiceLine);
    MusicDirector director;
    Thunderstorm storm;
    std::vector<int> heardChosen;
    int heardSelected = -1;
    std::string heardStatus;
    bool wasDark = false, soundscaping = false;
    double nextRaven = 30;
    int heardRaids = 0;
    uint64_t heardBlow = 0;
    uint64_t heardTree = 0;
    std::vector<int> finished;  // Buildings already announced as complete.
    bool heardFinished = false;
    bool hudPointer = false;
    int selected = -1, selectedDungeon = -1;
    int selectedTree = -1;
    int selectedRock = -1;
    struct QueuedWork { Activity activity; int target; uint64_t serial; };
    std::vector<QueuedWork> workQueue;
    std::map<int, uint64_t> stoppedWork;
    uint64_t workSerial = 0;
    double lastDispatch = -1;
    float viewWidth = 1, viewHeight = 1;
    double last = -1;
    Plan current;
    std::string status, notice;
#if HEARTHOLD_WITH_EDITOR
    std::optional<CharacterEditor> editor;
    std::optional<bool> editorDecision;
#endif
    struct SpeakerState { PersonSpeech speech; uint64_t heard = 0; SpeechChannel heardChannel = SpeechChannel::Selected; };
    std::map<int, SpeakerState> speakers;
    std::array<double, 2> nextSpeechAt{};
    double noticeUntil = 0;
};
}  // namespace hearthold

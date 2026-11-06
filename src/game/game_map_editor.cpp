#include "game_app.h"
#include "map_document.h"

namespace hearthold
{
#if HEARTHOLD_WITH_EDITOR
void GameApp::openMapEditor()
{
    if (editor || atlas || buildings) return;
    for (auto& entry : speakers) { entry.second.speech.stop(); entry.second.heard = 0; }
    cues.push_back({Cue::SpeechStop});
    pan = {}; panFrom.reset(); pressAt.reset(); boxFrom.reset(); fieldFrom.reset(); roadStroke.clear(); roadPress.reset(); roadMoved = false; hudPointer = false;
    renderer.scene()->opacity(0);
    atlas.emplace(town.map());
}

void GameApp::closeMapEditor(bool play)
{
    if (!atlas || (play && !atlas->document().validation().empty())) return;
    atlas->document().endStroke(); mapDecision = play;
}

void GameApp::mapKey(ui::Key key, bool shift)
{
    if (!atlas) return;
    if (key == ui::Key::Escape) closeMapEditor(false);
    else context.key(key, shift);
}

#endif
void GameApp::startMap(WorldMap map)
{
    uint32_t seed = map.seed();
    town = Town(std::move(map)); traffic = Traffic(seed); renderer.invalidateMap();
    speakers.clear(); chosen.clear();
    for (const auto& person : town.people()) chosen.push_back(person.id);
    auto at = project(town.map().camp().x, town.map().camp().y); camera = {at.x, at.y, 1.4f};
    dismissBuildDrawer();
    tool = Tool::Select; speed = 1; paused = false; pending = Order::None; card = -1; ledgerOpen = false;
    selected = selectedDungeon = selectedTree = selectedRock = -1; workQueue.clear(); stoppedWork.clear(); workSerial = 0; lastDispatch = -1; globalCard = -1; pan = {}; mouse = cursor = {-1, -1};
    roadStroke.clear(); roadPress.reset(); roadMoved = false; outline.clear(); crew.clear();
    fieldFrom.reset(); boxFrom.reset(); panFrom.reset(); pressAt.reset(); hudPointer = false;
    notice.clear(); status.clear(); finished.clear(); heardFinished = false; heardBlow = heardTree = 0; heardRaids = 0;
    nextSpeechAt = {}; cues.push_back({Cue::SpeechStop}); current = {};
#if HEARTHOLD_WITH_EDITOR
#endif
}

bool GameApp::loadMapFile(const std::filesystem::path& path, std::string& error)
{
    WorldMap map; if (!MapDocument::read(path, map, error)) return false;
    MapDocument doc(std::move(map)); error = doc.validation(); if (!error.empty()) return false;
    startMap(doc.gameMap()); return true;
}
}  // namespace hearthold

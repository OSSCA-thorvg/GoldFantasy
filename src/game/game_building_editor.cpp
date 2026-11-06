#include "game_app.h"
#include "building_assets.h"
#include <core/io/path.h>

namespace hearthold
{
bool GameApp::openBuildingEditor(const std::filesystem::path& path)
{
    if (buildings) return path.empty() || buildings->load(path);
    if (editor || atlas) return false;
    Structure kind = Structure::Cottage;
    uint32_t variant = 0;
    if (auto building = town.building(selected)) { kind = building->kind; variant = building->variant; }
    auto entry = [](Structure type) {
        auto file = buildingAssetFile(type);
        return engine::BuildingEditorEntry{buildingAsset(type), file.path, engine::BuildingEditorSource{file.asset, file.stamp, file.format}, buildingAsset(type)};
    };
    auto candidate = std::make_unique<engine::BuildingEditor>(entry(kind));
    candidate->onSaved([](const engine::BuildingEditorEntry& document) {
        if (document.source) rememberBuildingAssetFile({document.source->asset, document.path, document.source->stamp, document.source->format});
    });
    std::vector<engine::BuildingEditorEntry> choices;
    for (int i = 0; i < int(Structure::Count); ++i) choices.push_back(entry(Structure(i)));
    candidate->setChoices(std::move(choices)); candidate->setGameMode(true);
    candidate->setVariant(variant % candidate->current().variants.size());
    if (!path.empty() && !candidate->load(path) && !candidate->pendingDiscard()) { status = candidate->message(); return false; }
    cancelPointer(); pan = {};
    for (auto& [id, state] : speakers) { state.speech.stop(); state.heard = 0; }
    cues.push_back({Cue::SpeechStop});
    buildings = std::move(candidate); buildingClose = false;
    renderer.scene()->opacity(0);
    return true;
}
bool GameApp::buildingCommand(std::string_view id, std::string_view argument)
{
    if (id == "asset.available") return true;
    if (id == "asset.editor") return openBuildingEditor(argument.empty() ? std::filesystem::path{} : te::io::pathFromUtf8(argument));
    if (id == "asset.open" && !buildings) return openBuildingEditor(te::io::pathFromUtf8(argument));
    if (!buildings) return false;
    return buildings->command(id, argument);
}
void GameApp::buildingKey(ui::Key key, bool primary, bool shift)
{
    if (buildings) buildings->key(context, key, primary, shift);
}
}  // namespace hearthold

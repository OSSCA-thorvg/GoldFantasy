#pragma once

#include <GameEngine/GameFramework/building_asset.h>
#include <ui/ui.h>
#include <core/io/io.h>
#include <filesystem>
#include <memory>

namespace engine
{
struct BuildingEditorSource
{
    gameframework::BuildingAsset asset;
    te::io::DiskStamp stamp;
    te::io::FileFormat format;
};
struct BuildingEditorEntry
{
    gameframework::BuildingAsset asset;
    std::filesystem::path path;
    std::optional<BuildingEditorSource> source = {};
    std::optional<gameframework::BuildingAsset> accepted = {};
};

// A transactional authoring document and contextless UI, independent of the game and window host.
class BuildingEditor
{
public:
    using Apply = std::function<bool(const gameframework::BuildingAsset&, std::string&)>;
    BuildingEditor(gameframework::BuildingAsset, std::filesystem::path = {});
    explicit BuildingEditor(BuildingEditorEntry);
    ~BuildingEditor();
    void onSaved(std::function<void(const BuildingEditorEntry&)>);
    BuildingEditorEntry document() const;
    BuildingEditor(const BuildingEditor&) = delete;
    BuildingEditor& operator=(const BuildingEditor&) = delete;
    void setChoices(std::vector<BuildingEditorEntry>);
    void setGameMode(bool value);
    void setVariant(size_t);
    void render(ui::Context&, ui::Rect, const Apply&, const std::function<void()>& close);
    const gameframework::BuildingAsset& current() const;
    bool setAsset(const gameframework::BuildingAsset&, const std::filesystem::path&, std::string&);
    bool load(const std::filesystem::path&);
    bool save(const std::filesystem::path& = {});
    bool exportTo(const std::filesystem::path&);
    bool command(std::string_view id, std::string_view argument = {});
    bool apply(const Apply&);
    void undo();
    void redo();
    bool changed() const;
    bool animating() const;
    bool pendingDiscard() const;
    const std::string& message() const;
    void wheel(float);
    void key(ui::Context&, ui::Key, bool primary = false, bool shift = false);
    bool textFocused(const ui::Context&) const;
private:
    bool setEntry(BuildingEditorEntry, std::string&);
    struct Impl;
    std::unique_ptr<Impl> impl;
};
}  // namespace engine

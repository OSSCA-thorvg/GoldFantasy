#pragma once

#include <game/character_preset.h>
#include <game/world_sprites.h>
#include <game/character_assets.h>
#include <game/portrait_background.h>
#include <core/io/path.h>
#include <ui/ui.h>

namespace hearthold
{
class CharacterEditor
{
public:
    explicit CharacterEditor(const Person&, std::filesystem::path directory = "characters");
    void render(ui::Context&, ui::Rect, std::function<void(bool)> close);
    CharacterPreset current() const;
    void setPreset(const CharacterPreset&);
    void setBackdrop(const PortraitBackdrop& value) { backdrop = value; }
    void randomize();
    void reset();
    void undo();
    void redo();
    bool save();
    bool load();
    void setPresetPath(const std::filesystem::path& value) { auto filename = te::io::pathToUtf8(value); path = {filename, filename.size()}; }
    bool changed() const;
    int personId() const { return original.id; }
    const std::string& message() const { return feedback; }

private:
    void remember();
    void restore(const CharacterPreset&);
    void regenerate();
    void controls(ui::Context&, ui::Rect);
    void previews(ui::Context&, ui::Rect);

    Person original;
    CharacterPreset preset;
    ui::TextInput name, path;
    std::vector<CharacterPreset> past, future;
    PortraitBackdrop backdrop = portraitBackdrop();
    bool showFitGuides = false;
    int category = 0, colorTarget = 0, faceRegion = 0, eyeRegion = 0, hairGroup = 0, referenceGroup = 0, genderFilter = 0;
    bool compare = false, failed = false;
    std::string feedback;
};
}  // namespace hearthold

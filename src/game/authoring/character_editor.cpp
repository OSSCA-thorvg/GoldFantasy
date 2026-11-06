#include "character_editor.h"
#include "character_controls.h"
#include <game/person_portrait.h>
#include <core/io/path.h>
#include <algorithm>
#include <cmath>

namespace hearthold
{
namespace
{
constexpr const char* categories[]{"Character", "Face", "Eyes & mouth", "Hair", "Outfit", "Colors"};

}  // namespace

CharacterEditor::CharacterEditor(const Person& person, std::filesystem::path directory) : original(person), preset(characterPreset(person))
{
    name = {preset.name, preset.name.size()};
    hairGroup=referenceGroup=int(characterAssetGroup(preset.look.hairAsset));
    auto filename = te::io::pathToUtf8(directory / ("character-" + std::to_string(person.id) + ".character"));
    path = {filename, filename.size()};
}

CharacterPreset CharacterEditor::current() const
{
    auto value = preset;
    value.name = name.value;
    return value;
}

bool CharacterEditor::changed() const { return encodeCharacter(current()) != encodeCharacter(characterPreset(original)); }

void CharacterEditor::remember()
{
    auto value = current();
    if (past.empty() || encodeCharacter(past.back()) != encodeCharacter(value)) past.push_back(std::move(value));
    if (past.size() > 64) past.erase(past.begin());
    future.clear();
    feedback.clear();
}

void CharacterEditor::restore(const CharacterPreset& value)
{
    preset = value;
    resolveCharacterAssets(preset.look);
    name = {value.name, value.name.size()};
    hairGroup=referenceGroup=int(characterAssetGroup(preset.look.hairAsset));
}

void CharacterEditor::setPreset(const CharacterPreset& value)
{
    if (!validCharacter(value)) return;
    remember();
    restore(value);
}

void CharacterEditor::regenerate()
{
    auto& a=preset.look;
    auto ref=randomCharacterReference(preset.seed,a.bodyType);
    useCharacterReference(a,ref);
    hairGroup=referenceGroup=int(characterAssetGroup(ref));
    a.seed=preset.seed;
}

void CharacterEditor::randomize()
{
    remember();
    preset.seed=preset.seed*1664525u+1013904223u;
    regenerate();
}

void CharacterEditor::reset() { remember(); restore(characterPreset(original)); }

void CharacterEditor::undo()
{
    if (past.empty()) return;
    future.push_back(current());
    restore(past.back());
    past.pop_back();
    feedback.clear();
}

void CharacterEditor::redo()
{
    if (future.empty()) return;
    past.push_back(current());
    restore(future.back());
    future.pop_back();
    feedback.clear();
}

bool CharacterEditor::save()
{
    failed = !saveCharacter(te::io::pathFromUtf8(path.value), current(), feedback);
    if (!failed) feedback = "Preset saved.";
    return !failed;
}

bool CharacterEditor::load()
{
    auto value = current();
    failed = !loadCharacter(te::io::pathFromUtf8(path.value), value, feedback);
    if (failed) return false;
    setPreset(value);
    feedback = "Preset loaded. Apply to use it in the game.";
    return true;
}

void CharacterEditor::previews(ui::Context& c, ui::Rect r)
{
    const auto& t=c.theme();
    auto person=original;
    if(!compare)applyCharacter(person,current());
    auto look=appearanceOf(person);
    auto key=encodeCharacter(characterPreset(person))+ui::paintKey(backdrop);
    c.rect(r,t.background,t.radius,t.border);
    c.text({r.x+16,r.y+10,r.w-32,20},compare?"ORIGINAL":"STATIC PREVIEW",t.muted,11,true);
    float portraitW=std::min(300.f,(r.w-48)*.5f);
    ui::Rect portrait{r.x+16,r.y+56,portraitW,r.h-106};
    ui::Rect body{portrait.x+portrait.w+16,portrait.y,r.w-portrait.w-48,portrait.h};
    c.text({portrait.x,r.y+33,portrait.w,18},"PORTRAIT",t.text,11,true);
    c.text({body.x,r.y+33,body.w,18},"WHOLE OUTFIT",t.text,11,true);
    c.paint("studio-portrait"+key+ui::paintKey(portrait),[person,portrait,this]{
        auto face=personPortrait(person,Mood::Content,portrait.w,portrait.h,backdrop);
        face->translate(portrait.x,portrait.y);return face;
    });
    c.paint("studio-body"+key+ui::paintKey(body),[look,body,this]{
        auto frame=tvg::Scene::gen();frame->add(portraitBackground(backdrop,body.w,body.h));
        auto figure=characterFigure(look);auto placement=characterFigurePlacement(look,body.w,body.h);
        figure->scale(placement.scale);figure->translate(placement.origin.x,placement.origin.y);frame->add(figure);
        auto clip=tvg::Shape::gen();clip->appendRect(0,0,body.w,body.h,4,4);frame->clip(clip);
        auto holder=tvg::Scene::gen();holder->add(frame);holder->translate(body.x,body.y);return holder;
    });
    if(showFitGuides) {
        auto placement=characterPortraitPlacement(portrait.w,portrait.h);
        float scale=placement.scale;
        auto anchors=hairFitAnchors(look);
        for(size_t i=0;i<anchors.size();++i){
            auto p=anchors[i].target;
            float x=portrait.x+placement.origin.x+p.x*scale,y=portrait.y+placement.origin.y+p.y*scale;
            c.line(x-3,y,x+3,y,t.accent,1);c.line(x,y-3,x,y+3,t.accent,1);
        }
    }
    c.text({r.x+16,r.y+r.h-38,r.w-32,26},"Face and hair edits preserve the selected outfit.",t.muted,12);
}

void CharacterEditor::render(ui::Context& c, ui::Rect viewport, std::function<void(bool)> close)
{
    if (name.value != preset.name) {
        auto previous = preset;
        if (past.empty() || encodeCharacter(past.back()) != encodeCharacter(previous)) past.push_back(previous);
        if (past.size() > 64) past.erase(past.begin());
        future.clear();
        preset.name = name.value;
    }
    const auto& t = c.theme();
    c.rect(viewport, {t.background.r, t.background.g, t.background.b, 225});
    c.modal("studio-name", [close] { close(false); });
    c.control("studio-backdrop", viewport, [](const ui::Event&) {}, true, false);
    auto panel = viewport.inset(16);
    c.rect(panel, {t.surface.r, t.surface.g, t.surface.b, 255}, t.radius, t.border);
    c.text({panel.x + 20, panel.y + 12, 300, 18}, "HEARTHOLD  /  CREATOR TOOLS", t.muted, 11, true);
    c.text({panel.x + 20, panel.y + 32, 400, 34}, "Character Studio", t.text, 24, true);
    c.text({panel.x + 400, panel.y + 34, panel.w - 670, 28}, changed() ? "Unapplied changes" : "Editing " + original.name, t.muted, 12, false, ui::Align::End);
    characterButton(c, "studio-random", {panel.x + panel.w - 248, panel.y + 28, 120, 32}, "Vary face", [this] { randomize(); });
    characterButton(c, "studio-compare", {panel.x + panel.w - 116, panel.y + 28, 96, 32}, "Original", [this] { compare = !compare; }, ui::ButtonStyle::Default, true, ui::Icon::None, compare);
    c.line(panel.x, panel.y + 78, panel.x + panel.w, panel.y + 78, t.border);
    float top = panel.y + 94, contentH = panel.h - 226;
    c.text({panel.x + 20, top, 120, 20}, "CUSTOMIZE", t.muted, 11, true);
    for (int i = 0; i < 6; ++i)
        characterButton(c, "studio-tab-" + std::to_string(i), {panel.x + 12, top + 32 + i * 38, 132, 32}, categories[i],
                   [this, i] { category = i; colorTarget = 0; }, ui::ButtonStyle::Quiet, true, ui::Icon::None, category == i);
    characterButton(c, "studio-undo", {panel.x + 12, top + contentH - 112, 62, 30}, "Undo", [this] { undo(); }, ui::ButtonStyle::Default, !past.empty());
    characterButton(c, "studio-redo", {panel.x + 82, top + contentH - 112, 62, 30}, "Redo", [this] { redo(); }, ui::ButtonStyle::Default, !future.empty());
    characterButton(c, "studio-reset", {panel.x + 12, top + contentH - 70, 132, 32}, "Reset to original", [this] { reset(); }, ui::ButtonStyle::Quiet, changed());
    c.text({panel.x + 20, top + contentH - 26, 120, 18}, "Seed " + std::to_string(preset.seed), t.muted, 11);
    float right = panel.x + panel.w - 324;
    previews(c, {panel.x + 160, top, right - panel.x - 180, contentH});
    controls(c, {right, top, 304, contentH});
    float footer = panel.y + panel.h - 112;
    c.line(panel.x, footer - 8, panel.x + panel.w, footer - 8, t.border);
    c.text({panel.x + 20, footer, 200, 18}, "PRESET FILE", t.muted, 11, true);
    float fileW = panel.w - 460;
    ui::textField(c, "studio-path", {panel.x + 20, footer + 24, fileW, 32}, path, "characters/my-character.character", true, {}, ui::Icon::Folder);
    characterButton(c, "studio-load", {panel.x + 32 + fileW, footer + 24, 76, 32}, "Load", [this] { load(); });
    characterButton(c, "studio-save", {panel.x + 116 + fileW, footer + 24, 76, 32}, "Save", [this] { save(); }, ui::ButtonStyle::Default, validCharacter(current()));
    characterButton(c, "studio-cancel", {panel.x + panel.w - 240, footer + 24, 88, 32}, "Cancel", [close] { close(false); }, ui::ButtonStyle::Quiet);
    characterButton(c, "studio-apply", {panel.x + panel.w - 140, footer + 24, 120, 32}, "Apply to game", [close] { close(true); }, ui::ButtonStyle::Primary, validCharacter(current()));
    auto message = !validCharacter(current()) ? "Enter a name of 1 to 96 bytes." : feedback.empty() ? "Save keeps this head and outfit. Apply updates the character." : feedback;
    c.text({panel.x + 20, footer + 67, panel.w - 40, 22}, c.elideText(message, panel.w - 40, 12), failed || !validCharacter(current()) ? t.danger : t.muted, 12);
}
}  // namespace hearthold

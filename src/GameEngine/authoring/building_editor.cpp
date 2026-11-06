#include "building_editor.h"
#include <GameEngine/GameFramework/building_animation.h>
#include <core/io/io.h>
#include <core/io/path.h>
#include <algorithm>
#include <cmath>
#include <iomanip>
#include <map>
#include <limits>
#include <numbers>
#include <sstream>
#include <stdexcept>

namespace engine
{
using namespace gameframework;
namespace
{
constexpr size_t maximumBytes = 4 * 1024 * 1024;
std::string number(double value) { std::ostringstream out; out << std::setprecision(6) << value; return out.str(); }
bool numeric(std::string_view text, double& value)
{
    try { size_t end = 0; value = std::stod(std::string(text), &end); return end == text.size() && std::isfinite(value); }
    catch (...) { return false; }
}
bool sameDestination(const std::filesystem::path& a, const std::filesystem::path& b)
{
    if (a.empty() || b.empty()) return false;
    if (a == b) return true;
    std::error_code firstError, secondError;
    auto first = std::filesystem::weakly_canonical(a, firstError);
    auto second = std::filesystem::weakly_canonical(b, secondError);
    return !firstError && !secondError && first == second;
}
Block defaultBlock() { return {0, 0, 1, 1, 28, 18, RoofShape::GableX, {190, 165, 120}, {145, 120, 85}, {125, 75, 55}, {90, 50, 40}}; }
Patch defaultPatch() { return {0, 0, 1, 1, {105, 120, 75}}; }
}

struct BuildingEditor::Impl
{
    BuildingAsset draft, saved, accepted;
    std::filesystem::path path;
    te::io::DiskStamp stamp;
    te::io::FileFormat format;
    bool baseline = false, gameMode = false, patch = false, playing = false, closeReady = false, previewFailed = false;
    size_t variant = 0, selected = 0;
    uint64_t revision = 0, acceptedRevision = 0;
    std::vector<BuildingAsset> past, future;
    std::vector<BuildingEditorEntry> choices;
    std::optional<size_t> choiceIndex;
    std::map<std::string, ui::TextInput> fields;
    std::map<std::string, std::string> fieldValues;
    ui::TextInput pathInput;
    std::string message = "Edit a primitive, then Save or Apply the draft.";
    struct Pending { BuildingAsset asset; std::filesystem::path path; te::io::DiskStamp stamp; te::io::FileFormat format; bool baseline = false, close = false; std::optional<BuildingAsset> saved = {}, accepted = {}; };
    std::optional<Pending> pending;
    Apply callback;
    std::function<void(const BuildingEditorEntry&)> savedCallback;
    float angle = 0, zoom = 1, frame = 0, scroll = 0, listScroll = 0;
    float contentHeight = 0, inspectorHeight = 0;
    int tab = 0, mode = 0, narrowPanel = 0, picker = 0;
    float pickerScroll = 0;
    double previous = -1;
    std::string animationKey;
    RiseAnimation layout;
    std::unique_ptr<tvg::Animation> animation;

    BuildingEditorEntry document() const
    {
        BuildingEditorEntry entry{draft, path};
        if (baseline) entry.source = BuildingEditorSource{saved, stamp, format};
        entry.accepted = accepted;
        return entry;
    }
    bool prepare(BuildingEditorEntry entry, Pending& next, std::string& error)
    {
        if (!validateBuildingAsset(entry.asset, error)) return false;
        if (entry.accepted && !validateBuildingAsset(*entry.accepted, error)) return false;
        next.asset = std::move(entry.asset); next.path = std::move(entry.path); next.accepted = std::move(entry.accepted);
        if (entry.source) {
            if (!validateBuildingAsset(entry.source->asset, error)) return false;
            next.saved = std::move(entry.source->asset); next.stamp = entry.source->stamp; next.format = entry.source->format; next.baseline = true;
        } else if (!next.path.empty()) {
            auto loaded = te::io::load(next.path, {true, maximumBytes});
            if (!loaded) { error = loaded.error.message; return false; }
            BuildingAsset disk; std::string ignored;
            if (!loaded.value.stamp.exists() || (decodeBuildingAsset(loaded.value.text, disk, ignored) && disk == next.asset)) {
                next.stamp = loaded.value.stamp; next.format = loaded.value.format; next.baseline = true;
            }
        }
        return true;
    }
    void findChoice()
    {
        choiceIndex.reset();
        for (size_t i = 0; i < choices.size(); ++i) if (choices[i].asset.id == draft.id && (choices[i].path == path || sameDestination(choices[i].path, path))) { choiceIndex = i; break; }
    }
    void rememberChoice()
    {
        if (choiceIndex && *choiceIndex < choices.size()) choices[*choiceIndex] = document();
    }
    bool buffered() const
    {
        for (const auto& [key, input] : fields) { auto value = fieldValues.find(key); if (value != fieldValues.end() && input.value != value->second) return true; }
        return false;
    }
    bool flush()
    {
        std::vector<std::pair<std::string, std::string>> edits;
        for (const auto& [key, input] : fields) { auto value = fieldValues.find(key); if (value != fieldValues.end() && input.value != value->second) edits.emplace_back(key, input.value); }
        for (const auto& [key, text] : edits) {
            if (!property(key, text)) return false;
            fieldValues[key] = text;
        }
        return true;
    }
    bool dirty() const { return draft != saved || buffered(); }
    bool unsettled() const { return dirty() || draft != accepted; }
    Model& model() { return draft.variants[variant]; }
    const Model& model() const { return draft.variants[variant]; }
    void clampSelection()
    {
        variant = std::min(variant, draft.variants.size() - 1);
        if (patch && model().patches.empty()) patch = false;
        if (!patch && model().blocks.empty()) patch = true;
        auto count = patch ? model().patches.size() : model().blocks.size();
        selected = count ? std::min(selected, count - 1) : 0;
    }
    void history(BuildingAsset before)
    {
        if (past.size() == 64) past.erase(past.begin());
        past.push_back(std::move(before)); future.clear(); clampSelection(); ++revision;
    }
    bool edit(const std::function<void(BuildingAsset&)>& change)
    {
        auto candidate = draft;
        change(candidate);
        std::string error;
        if (!validateBuildingAsset(candidate, error)) { message = error; return false; }
        if (gameMode && (candidate.id != draft.id || candidate.footprint != draft.footprint || candidate.variants.size() != draft.variants.size())) {
            message = "Game assets retain their ID, footprint and variant slots."; return false;
        }
        if (candidate != draft) { auto before = std::move(draft); draft = std::move(candidate); history(std::move(before)); }
        message = "Draft updated. Apply publishes it; Save writes the JSON.";
        return true;
    }
    void install(Pending next)
    {
        draft = std::move(next.asset); saved = next.saved.value_or(draft); accepted = next.accepted.value_or(draft); ++revision; ++acceptedRevision; path = std::move(next.path);
        stamp = next.stamp; format = next.format; baseline = next.baseline; findChoice();
        pathInput.value = te::io::pathToUtf8(path); pathInput.cursor = pathInput.value.size();
        variant = selected = 0; patch = model().blocks.empty(); past.clear(); future.clear(); fields.clear(); fieldValues.clear(); pending.reset();
        frame = 0; scroll = listScroll = 0; animationKey.clear(); previewFailed = false; message = "Asset opened as a draft. Apply publishes changes.";
    }
    bool stage(Pending next)
    {
        if (unsettled()) { pending = std::move(next); message = "Unsaved or unapplied changes. Discard them or keep editing."; return false; }
        install(std::move(next)); return true;
    }
    bool property(std::string_view key, std::string_view text)
    {
        double value = 0;
        if (key == "name" || key == "id") return edit([&](BuildingAsset& asset) { (key == "name" ? asset.name : asset.id) = text; });
        if (!numeric(text, value) || std::abs(value) > std::numeric_limits<float>::max()) { message = "Enter a finite numeric value."; return false; }
        bool known = true;
        auto result = edit([&](BuildingAsset& asset) {
            if (key == "footprint") { asset.footprint = float(value); return; }
            auto& variantModel = asset.variants[variant];
            auto assign = [&](auto& item) {
                if (key == "x0") item.x0 = float(value); else if (key == "y0") item.y0 = float(value);
                else if (key == "x1") item.x1 = float(value); else if (key == "y1") item.y1 = float(value);
                else if (key == "delay") item.delay = float(value);
                else return false;
                return true;
            };
            auto color = [&](std::string_view name, Rgb& rgb) {
                if (!key.starts_with(std::string(name) + ".")) return false;
                if (value < 0 || value > 255 || std::floor(value) != value) { known = false; return true; }
                auto channel = key.substr(name.size() + 1);
                if (channel == "r") rgb.r = uint8_t(value); else if (channel == "g") rgb.g = uint8_t(value); else if (channel == "b") rgb.b = uint8_t(value); else known = false;
                return true;
            };
            if (patch) {
                auto& item = variantModel.patches[selected];
                if (assign(item)) return;
                if (key == "furrows") { if (value >= 0 && value <= 32 && value == std::floor(value)) item.furrows = int(value); else known = false; }
                else if (!color("color", item.color) && !color("furrow", item.furrow)) known = false;
            } else {
                auto& item = variantModel.blocks[selected];
                if (assign(item)) return;
                if (key == "wall") item.wall = float(value); else if (key == "roof") item.roof = float(value); else if (key == "base") item.base = float(value);
                else if (key == "windows") { if (value >= 0 && value <= 8 && value == std::floor(value)) item.windows = int(value); else known = false; }
                else if (key == "door") { if (value == 0 || value == 1) item.door = value != 0; else known = false; }
                else if (key == "shape") { if (value >= 0 && value <= 3 && value == std::floor(value)) item.shape = RoofShape(int(value)); else known = false; }
                else if (key == "trim") { if (value >= 0 && value <= 3 && value == std::floor(value)) item.trim = Trim(int(value)); else known = false; }
                else if (key == "ornament") { if (value >= 0 && value <= 2 && value == std::floor(value)) item.ornament = Ornament(int(value)); else known = false; }
                else if (!color("wallLit", item.wallLit) && !color("wallShade", item.wallShade) && !color("roofLit", item.roofLit) && !color("roofShade", item.roofShade) && !color("glass", item.glass) && !color("accent", item.accent)) known = false;
            }
        });
        if (!known) message = "Unknown field or value outside its allowed range: " + std::string(key);
        return result && known;
    }
};

BuildingEditor::BuildingEditor(BuildingAsset asset, std::filesystem::path path)
    : BuildingEditor(BuildingEditorEntry{std::move(asset), std::move(path)}) {}
BuildingEditor::BuildingEditor(BuildingEditorEntry entry) : impl(std::make_unique<Impl>())
{
    std::string error; Impl::Pending initial;
    if (!impl->prepare(std::move(entry), initial, error)) throw std::invalid_argument(error);
    impl->install(std::move(initial));
}
BuildingEditor::~BuildingEditor() = default;
void BuildingEditor::onSaved(std::function<void(const BuildingEditorEntry&)> callback) { impl->savedCallback = std::move(callback); }
BuildingEditorEntry BuildingEditor::document() const { return impl->document(); }
void BuildingEditor::setChoices(std::vector<BuildingEditorEntry> choices)
{
    impl->choices = std::move(choices);
    impl->findChoice(); impl->rememberChoice();
}
void BuildingEditor::setGameMode(bool value) { impl->gameMode = value; }
void BuildingEditor::setVariant(size_t value) { if (!impl->flush()) return; impl->variant = std::min(value, impl->draft.variants.size() - 1); impl->clampSelection(); impl->fields.clear(); impl->fieldValues.clear(); }
const BuildingAsset& BuildingEditor::current() const { return impl->draft; }
bool BuildingEditor::changed() const { return impl->dirty(); }
bool BuildingEditor::animating() const { return impl->playing && !impl->pending; }
bool BuildingEditor::pendingDiscard() const { return impl->pending.has_value(); }
const std::string& BuildingEditor::message() const { return impl->message; }
void BuildingEditor::wheel(float delta) { impl->scroll = std::clamp(impl->scroll - delta * 32, 0.f, std::max(0.f, impl->contentHeight - impl->inspectorHeight)); }
bool BuildingEditor::textFocused(const ui::Context& context) const { return context.focused().starts_with("building/field/") || context.focused() == "building/path"; }
void BuildingEditor::key(ui::Context& context, ui::Key key, bool, bool shift)
{
    if (impl->pending && key != ui::Key::Escape) { context.key(key, shift); return; }
    if (key == ui::Key::Escape && impl->picker) { impl->picker = 0; return; }
    if (key == ui::Key::Escape) { command(impl->pending ? "keep" : "close"); return; }
    if (key == ui::Key::Delete && !textFocused(context)) { command("selection.delete"); return; }
    context.key(key, shift);
}
void BuildingEditor::undo()
{
    auto& s = *impl; if (s.pending || !s.flush() || s.past.empty()) return;
    s.future.push_back(std::move(s.draft)); s.draft = std::move(s.past.back()); s.past.pop_back(); ++s.revision; s.clampSelection(); s.fields.clear(); s.fieldValues.clear(); s.message = "Undo";
}
void BuildingEditor::redo()
{
    auto& s = *impl; if (s.pending || !s.flush() || s.future.empty()) return;
    s.past.push_back(std::move(s.draft)); s.draft = std::move(s.future.back()); s.future.pop_back(); ++s.revision; s.clampSelection(); s.fields.clear(); s.fieldValues.clear(); s.message = "Redo";
}
bool BuildingEditor::setAsset(const BuildingAsset& asset, const std::filesystem::path& path, std::string& error)
{
    return setEntry({asset, path}, error);
}
bool BuildingEditor::setEntry(BuildingEditorEntry entry, std::string& error)
{
    Impl::Pending next;
    if (!impl->prepare(std::move(entry), next, error)) { impl->message = error; return false; }
    bool result = impl->stage(std::move(next));
    if (!result) error = impl->message;
    return result;
}
bool BuildingEditor::load(const std::filesystem::path& path)
{
    auto loaded = te::io::load(path, {false, maximumBytes});
    if (!loaded) { impl->message = loaded.error.message; return false; }
    BuildingAsset asset; std::string error;
    if (!decodeBuildingAsset(loaded.value.text, asset, error)) { impl->message = error; return false; }
    if (impl->gameMode) {
        auto it = std::find_if(impl->choices.begin(), impl->choices.end(), [&](const auto& choice) { return choice.asset.id == asset.id; });
        if (it == impl->choices.end() || it->asset.footprint != asset.footprint || it->asset.variants.size() != asset.variants.size()) {
            impl->message = "Game assets must retain a known ID, footprint and variant slots."; return false;
        }
    }
    Impl::Pending next{asset, path, loaded.value.stamp, loaded.value.format, true};
    if (asset.id == impl->draft.id) next.accepted = impl->accepted;
    else for (const auto& choice : impl->choices) if (choice.asset.id == asset.id) next.accepted = choice.accepted.value_or(choice.asset);
    return impl->stage(std::move(next));
}
bool BuildingEditor::save(const std::filesystem::path& destination)
{
    if (!impl->flush()) return false;
    auto& s = *impl; auto path = destination.empty() ? s.path : destination;
    if (path.empty()) { s.message = "Enter a destination path before saving."; return false; }
    std::string error; if (!validateBuildingAsset(s.draft, error)) { s.message = error; return false; }
    auto stamp = s.stamp; auto format = s.format;
    if (!sameDestination(path, s.path)) {
        auto loaded = te::io::load(path, {true, maximumBytes});
        if (!loaded) { s.message = loaded.error.message; return false; }
        stamp = loaded.value.stamp; format = loaded.value.format;
    } else if (!s.baseline) { s.message = "No disk baseline for this path. Open it first or Save As to a new path."; return false; }
    if (format.ending == te::io::LineEnding::Mixed) format.ending = te::io::LineEnding::Lf;
    auto result = te::io::save(path, encodeBuildingAsset(s.draft), {format, stamp, maximumBytes});
    if (result.state != te::io::SaveState::NotWritten) {
        s.path = path; s.stamp = result.stamp; s.format = format; s.baseline = true; s.saved = s.draft;
        s.rememberChoice();
        if (s.savedCallback) s.savedCallback(s.document());
        s.pathInput.value = te::io::pathToUtf8(path); s.pathInput.cursor = s.pathInput.value.size();
    }
    s.message = result ? "Saved JSON. Apply publishes the draft separately." : result.state == te::io::SaveState::CommittedDurabilityUnknown ? "JSON was committed, but durability could not be confirmed: " + result.error.message : "Save failed: " + result.error.message;
    return bool(result);
}
bool BuildingEditor::exportTo(const std::filesystem::path& path)
{
    if (!impl->flush()) return false;
    auto& s = *impl;
    if (path.empty()) { s.message = "Enter an export destination."; return false; }
    std::string error;
    if (!validateBuildingAsset(s.draft, error)) { s.message = error; return false; }
    // Export is create-only. Save is the explicit operation for replacing an existing document.
    auto result = te::io::save(path, encodeBuildingAsset(s.draft), {{}, {}, maximumBytes});
    s.message = result ? "Exported JSON; draft and active path retained." : result.state == te::io::SaveState::CommittedDurabilityUnknown ? "Export committed; durability uncertain: " + result.error.message : "Export failed: " + result.error.message;
    return bool(result);
}
bool BuildingEditor::apply(const Apply& callback)
{
    if (!impl->flush()) return false;
    if (impl->pending) { impl->message = "Resolve the pending discard decision first."; return false; }
    if (impl->previewFailed) { impl->message = "The preview must render successfully before this draft can be applied."; return false; }
    std::string error;
    if (!validateBuildingAsset(impl->draft, error) || (callback && !callback(impl->draft, error))) { impl->message = error.empty() ? "The application rejected this asset." : error; return false; }
    impl->accepted = impl->draft; ++impl->acceptedRevision;
    for (auto& choice : impl->choices) if (choice.asset.id == impl->draft.id) choice.accepted = impl->accepted;
    impl->rememberChoice();
    impl->message = callback ? "Draft applied. Save separately to keep the JSON." : "Draft accepted locally. Save or Export to use it in a project.";
    return true;
}
bool BuildingEditor::command(std::string_view id, std::string_view argument)
{
    auto& s = *impl;
    if (id == "asset.open" || id == "open" || id == "reload") return load(id == "reload" ? s.path : te::io::pathFromUtf8(argument));
    if (id == "asset.save" || id == "save") return save(argument.empty() ? std::filesystem::path{} : te::io::pathFromUtf8(argument));
    if (id == "asset.export" || id == "export") return exportTo(te::io::pathFromUtf8(argument));
    if (id == "apply") return apply(s.callback);
    if (id == "undo") { undo(); return true; }
    if (id == "redo") { redo(); return true; }
    if (id == "reset") { s.fields.clear(); s.fieldValues.clear(); return s.edit([&](BuildingAsset& asset) { asset = s.saved; }); }
    if (id == "close") { bool valid = s.flush(); if (!valid || s.unsettled()) { s.pending = Impl::Pending{}; s.pending->close = true; } else s.closeReady = true; return true; }
    if (id == "keep") { s.pending.reset(); return true; }
    if (id == "discard") {
        if (!s.pending) return false;
        if (s.pending->close) { s.pending.reset(); s.closeReady = true; }
        else s.install(std::move(*s.pending));
        return true;
    }
    if (s.pending) { s.message = "Resolve the pending discard decision first."; return false; }
    if (!s.flush()) return false;
    double value = 0;
    if (id == "variant" || id == "select.block" || id == "select.patch" || id == "asset.choice") {
        if (!numeric(argument, value) || value < 0 || std::floor(value) != value) return false;
        size_t count = id == "variant" ? s.draft.variants.size() : id == "asset.choice" ? s.choices.size() : id == "select.patch" ? s.model().patches.size() : s.model().blocks.size();
        if (value >= double(count)) return false;
        auto index = size_t(value);
        if (id == "variant") { if (index >= s.draft.variants.size()) return false; setVariant(index); return true; }
        if (id == "asset.choice") { if (index >= s.choices.size()) return false; std::string error; return setEntry(s.choices[index], error); }

        s.patch = id == "select.patch"; s.selected = index; s.fields.clear(); s.fieldValues.clear(); return true;
    }
    if (id == "property") { auto split = argument.find('='); return split != std::string_view::npos && s.property(argument.substr(0, split), argument.substr(split + 1)); }
    if (id == "block.add" || id == "patch.add" || id == "selection.duplicate" || id == "selection.delete" || id == "variant.add" || id == "variant.delete") {
        bool patch = id == "patch.add" || (id != "block.add" && s.patch);
        auto index = s.selected;
        bool result = s.edit([&](BuildingAsset& asset) {
            if (id == "variant.add") { asset.variants.push_back(asset.variants[s.variant]); return; }
            if (id == "variant.delete") { asset.variants.erase(asset.variants.begin() + s.variant); return; }
            auto& model = asset.variants[s.variant];
            if (id == "block.add") model.blocks.push_back(defaultBlock());
            else if (id == "patch.add") model.patches.push_back(defaultPatch());
            else if (patch) { if (id == "selection.delete") model.patches.erase(model.patches.begin() + index); else model.patches.push_back(model.patches[index]); }
            else { if (id == "selection.delete") model.blocks.erase(model.blocks.begin() + index); else model.blocks.push_back(model.blocks[index]); }
        });
        if (result && (id.ends_with(".add") || id == "selection.duplicate")) {
            if (id == "variant.add") setVariant(s.draft.variants.size() - 1);
            else { s.patch = patch; s.selected = (patch ? s.model().patches.size() : s.model().blocks.size()) - 1; }
        }
        return result;
    }
    return false;
}

void BuildingEditor::render(ui::Context& context, ui::Rect bounds, const Apply& applyCallback, const std::function<void()>& close)
{
    auto& s = *impl; s.callback = applyCallback;
    if (s.closeReady) { s.closeReady = false; close(); return; }
    auto& theme = context.theme();
    ui::Appearance compact; compact.radius = 2; compact.fontSize = 12;
    compact.border = ui::StyleColor{{}, &ui::Theme::border}; compact.focusRing = true;
    auto button = [&](std::string id, ui::Rect box, std::string label, std::function<void()> action, bool enabled = true, bool active = false) {
        ui::button(context, "building/" + id, box, label, [this, id, action = std::move(action)] { if (id == "close" || id == "keep" || id == "discard" || id == "reset" || id == "picker-close" || impl->flush()) action(); }, ui::ButtonStyle::Quiet, enabled, ui::Icon::None, active, compact);
    };
    auto action = [&](std::string id, ui::Rect box, std::string label, bool enabled = true) {
        button(id, box, label, [this, id] { command(id); }, enabled);
    };
    float x = bounds.x, y = bounds.y, w = bounds.w, h = bounds.h;
    if (s.pending) {
        if (context.focused() != "building/keep" && context.focused() != "building/discard") context.focus("building/keep");
        context.rect(bounds, ui::Color{theme.background.r, theme.background.g, theme.background.b, 232});
        context.control("building/discard-barrier", bounds, [](const ui::Event&) {}, true, false);
        float dialogW = std::min(440.f, w - 24), dialogX = x + (w - dialogW) / 2, dialogY = y + h / 2 - 68;
        context.rect({dialogX, dialogY, dialogW, 136}, theme.surface, 2, theme.border);
        context.text({dialogX + 16, dialogY + 12, dialogW - 32, 28}, "Discard draft changes?", theme.text, 15, true);
        context.text({dialogX + 16, dialogY + 44, dialogW - 32, 24}, "Saved JSON and published assets stay unchanged.", theme.muted, 11);
        button("discard", {dialogX + 16, dialogY + 90, 104, 28}, "Discard", [this] { command("discard"); });
        button("keep", {dialogX + dialogW - 136, dialogY + 90, 120, 28}, "Keep Editing", [this] { command("keep"); });
        return;
    }
    if (s.picker) {
        context.rect(bounds, theme.background);
        context.text({x + 16, y + 10, w - 112, 28}, s.picker == 1 ? "Building catalog" : "Choose variant", theme.text, 15, true);
        button("picker-close", {x + w - 88, y + 10, 72, 28}, "Return", [&s] { s.picker = 0; });
        context.rect({x, y + 47, w, 1}, theme.border);
        ui::Rect items{x + 12, y + 58, std::max(0.f, w - 24), std::max(0.f, h - 74)};
        int columns = w >= 900 ? 3 : w >= 600 ? 2 : 1;
        size_t count = s.picker == 1 ? s.choices.size() : s.draft.variants.size();
        float rowHeight = 40, cellWidth = (items.w - (columns - 1) * 8) / columns;
        float content = float((count + columns - 1) / columns) * rowHeight;
        s.pickerScroll = std::clamp(s.pickerScroll, 0.f, std::max(0.f, content - items.h));
        context.control("building/picker-scroll", items, [&s](const ui::Event& event) { if (event.type == ui::EventType::Scroll) s.pickerScroll -= event.y * 40; }, true, false, true);
        context.clip(items, [&] {
            for (size_t i = 0; i < count; ++i) {
                bool assets = s.picker == 1;
                auto label = assets ? s.choices[i].asset.name : "Variant " + std::to_string(i + 1);
                bool active = assets ? s.choices[i].asset.id == s.draft.id : i == s.variant;
                button("picker-" + std::to_string(i), {items.x + float(i % columns) * (cellWidth + 8), items.y + float(i / columns) * rowHeight - s.pickerScroll, cellWidth, 32}, label,
                    [this, i, assets] { impl->picker = 0; command(assets ? "asset.choice" : "variant", std::to_string(i)); }, true, active);
            }
        });
        return;
    }
    bool narrow = w < 860;
    context.rect(bounds, theme.background);
    context.rect({x, y, w, 40}, theme.surface);
    context.text({x + 12, y + 5, std::max(0.f, w - 260), 28}, w < 480 ? "Buildings" : "Building Studio", theme.text, 14, true);
    action("undo", {x + w - 244, y + 6, 54, 28}, "Undo", !s.past.empty());
    action("redo", {x + w - 184, y + 6, 54, 28}, "Redo", !s.future.empty());
    action("reset", {x + w - 124, y + 6, 54, 28}, "Reset", s.dirty());
    action("close", {x + w - 64, y + 6, 52, 28}, "Close");
    context.rect({x, y + 39, w, 1}, theme.border);
    // Asset and variant selection remain available in the narrow single-panel layout.
    float variantWidth = narrow ? 124.f : 168.f;
    float assetWidth = std::max(40.f, w - 30 - variantWidth - (s.gameMode ? 0.f : 64.f));
    if (!s.choices.empty()) {
        button("asset", {x + 12, y + 46, assetWidth, 28}, s.draft.name + "  ▾", [&s] { s.picker = 1; s.pickerScroll = 0; s.playing = false; });
    } else context.text({x + 12, y + 46, assetWidth, 28}, context.elideText(s.draft.name, assetWidth, 12), theme.text, 12, true);
    float variantX = x + 18 + assetWidth;
    button("variant", {variantX, y + 46, variantWidth, 28}, "Variant " + std::to_string(s.variant + 1) + " / " + std::to_string(s.draft.variants.size()) + "  ▸", [&s] { s.picker = 2; s.pickerScroll = 0; s.playing = false; });
    if (!s.gameMode) {
        action("variant.add", {variantX + variantWidth + 6, y + 46, 26, 28}, "+", s.draft.variants.size() < 32);
        action("variant.delete", {variantX + variantWidth + 36, y + 46, 26, 28}, "−", s.draft.variants.size() > 1);
    }
    float bodyY = y + 84, bodyH = std::max(0.f, h - 164);
    if (narrow) {
        float width = (w - 32) / 3;
        const char* names[] = {"Preview", "Primitives", "Properties"};
        for (int i = 0; i < 3; ++i) button("panel" + std::to_string(i), {x + 12 + i * (width + 4), bodyY, width, 28}, names[i], [&s, i] { s.narrowPanel = i; if (i != 0) s.playing = false; }, true, s.narrowPanel == i);
        bodyY += 36; bodyH = std::max(0.f, bodyH - 36);
    }
    float listW = narrow ? w : 178;
    float inspectW = narrow ? w : 292;
    ui::Rect list{x, bodyY, listW, bodyH};
    ui::Rect inspect{narrow ? x : x + w - inspectW, bodyY, inspectW, bodyH};
    ui::Rect preview{narrow ? x : x + listW + 1, bodyY, narrow ? w : w - listW - inspectW - 2, bodyH};
    if (!narrow || s.narrowPanel == 1) {
        context.rect(list, theme.surface);
        context.text({list.x + 12, list.y, list.w - 24, 26}, "PRIMITIVES", theme.muted, 11, true);
        float half = (list.w - 28) / 2;
        action("block.add", {list.x + 12, list.y + 28, half, 28}, "+ Block", s.model().blocks.size() < 64);
        action("patch.add", {list.x + 16 + half, list.y + 28, half, 28}, "+ Patch", s.model().patches.size() < 32);
        ui::Rect items{list.x, list.y + 64, list.w, std::max(0.f, list.h - 102)};
        float total = float(s.model().blocks.size() + s.model().patches.size()) * 32;
        s.listScroll = std::clamp(s.listScroll, 0.f, std::max(0.f, total - items.h));
        context.control("building/list", items, [&s](const ui::Event& event) { if (event.type == ui::EventType::Scroll) s.listScroll -= event.y * 32; }, true, false, true);
        context.clip(items, [&] {
            float row = items.y - s.listScroll;
            auto primitives = [&](bool patches, size_t count) {
                for (size_t i = 0; i < count; ++i) {
                    std::string id = patches ? "select.patch" : "select.block";
                    button(id + std::to_string(i), {list.x + 12, row, list.w - 24, 28}, std::string(patches ? "Patch " : "Block ") + std::to_string(i + 1), [this, id, i] { command(id, std::to_string(i)); }, true, s.patch == patches && s.selected == i);
                    row += 32;
                }
            };
            primitives(false, s.model().blocks.size()); primitives(true, s.model().patches.size());
        });
        action("selection.duplicate", {list.x + 12, list.y + list.h - 32, half, 28}, "Copy");
        action("selection.delete", {list.x + 16 + half, list.y + list.h - 32, half, 28}, "Delete", s.model().blocks.size() + s.model().patches.size() > 1);
    }
    if (!narrow || s.narrowPanel == 2) {
        context.rect(inspect, theme.surface);
        const char* names[] = {"Geometry", "Details", "Colors"};
        float tabW = (inspect.w - 24) / 3;
        for (int i = 0; i < 3; ++i) button("tab" + std::to_string(i), {inspect.x + 12 + i * tabW, inspect.y, tabW, 28}, names[i], [&s, i] { s.tab = i; s.scroll = 0; }, true, s.tab == i);
        ui::Rect area{inspect.x, inspect.y + 36, inspect.w, std::max(0.f, inspect.h - 36)};
        s.inspectorHeight = area.h;
        s.scroll = std::clamp(s.scroll, 0.f, std::max(0.f, s.contentHeight - area.h));
        context.control("building/inspector", area, [this](const ui::Event& event) { if (event.type == ui::EventType::Scroll) wheel(event.y); }, true, false, true);
        float row = area.y - s.scroll;
        context.clip(area, [&] {
            auto field = [&](std::string key, std::string label, std::string value, bool enabled, double step = 0) {
                std::string id = "building/field/" + key;
                auto& input = s.fields[key];
                auto previous = s.fieldValues.find(key);
                if (previous == s.fieldValues.end()) { input.value = value; input.cursor = value.size(); s.fieldValues[key] = value; }
                else if (input.value == previous->second) {
                    if (input.value != value) { input.value = value; input.cursor = std::min(input.cursor, value.size()); }
                    previous->second = value;
                }
                float start = inspect.x + inspect.w - 150;
                context.text({inspect.x + 12, row, inspect.w - 170, 28}, label, theme.text, 12);
                ui::textField(context, id, {start + (step ? 25 : 0), row, step ? 86.f : 138.f, 28}, input, label, enabled,
                    [this, &context, key](ui::Key event) { if (event != ui::Key::Enter) return false; bool ok = impl->flush(); if (ok) context.focus(""); return true; }, ui::Icon::None, compact);
                if (step) {
                    auto change = [this, key, value](double delta) { double current = 0; auto found = impl->fields.find(key); auto text = found == impl->fields.end() ? value : found->second.value; if (numeric(text, current)) impl->property(key, number(current + delta)); };
                    button("minus/" + key, {start, row, 23, 28}, "−", [change, step] { change(-step); }, enabled);
                    button("plus/" + key, {start + 113, row, 25, 28}, "+", [change, step] { change(step); }, enabled);
                }
                row += 34;
            };
            auto numericField = [&](std::string key, std::string label, double value, double step = 1, bool enabled = true) { field(key, label, number(value), enabled, step); };
            auto choice = [&](std::string key, std::string label, int value, std::vector<std::string> labels) {
                context.text({inspect.x + 12, row, inspect.w - 170, 28}, label, theme.text, 12);
                button("choice/" + key, {inspect.x + inspect.w - 150, row, 138, 28}, labels[size_t(value)] + "  ▸", [this, key, value, count = labels.size()] { impl->property(key, std::to_string((value + 1) % count)); }); row += 34;
            };
            auto color = [&](std::string key, std::string label, Rgb rgb) {
                context.rect({inspect.x + 12, row + 6, 16, 16}, {rgb.r, rgb.g, rgb.b, 255}, 2, theme.border);
                context.text({inspect.x + 36, row, inspect.w - 48, 28}, label, theme.muted, 12, true); row += 30;
                numericField(key + ".r", "Red", rgb.r); numericField(key + ".g", "Green", rgb.g); numericField(key + ".b", "Blue", rgb.b); row += 6;
            };
            if (s.tab == 0) {
                field("name", "Asset name", s.draft.name, true);
                field("id", "Asset ID", s.draft.id, !s.gameMode);
                numericField("footprint", "Footprint", s.draft.footprint, .25, !s.gameMode);
                if (s.patch) {
                    auto p = s.model().patches[s.selected];
                    numericField("x0", "Left X", p.x0, .05); numericField("y0", "Back Y", p.y0, .05);
                    numericField("x1", "Right X", p.x1, .05); numericField("y1", "Front Y", p.y1, .05);
                } else {
                    auto b = s.model().blocks[s.selected];
                    numericField("x0", "Left X", b.x0, .05); numericField("y0", "Back Y", b.y0, .05);
                    numericField("x1", "Right X", b.x1, .05); numericField("y1", "Front Y", b.y1, .05);
                    numericField("base", "Base height", b.base); numericField("wall", "Wall height", b.wall); numericField("roof", "Roof height", b.roof);
                    choice("shape", "Roof", int(b.shape), {"Flat", "Gable X", "Gable Y", "Pyramid"});
                }
            } else if (s.tab == 1) {
                if (s.patch) { auto p = s.model().patches[s.selected]; numericField("furrows", "Furrows", p.furrows); numericField("delay", "Delay / frames", p.delay); }
                else {
                    auto b = s.model().blocks[s.selected];
                    numericField("delay", "Delay / frames", b.delay); numericField("windows", "Windows", b.windows);
                    choice("door", "Door", b.door, {"No", "Yes"}); choice("trim", "Trim", int(b.trim), {"None", "Timber", "Crenels", "Stakes"}); choice("ornament", "Ornament", int(b.ornament), {"None", "Banner", "Crystal"});
                }
            } else if (s.patch) { auto p = s.model().patches[s.selected]; color("color", "Ground", p.color); color("furrow", "Furrows", p.furrow); }
            else { auto b = s.model().blocks[s.selected]; color("wallLit", "Wall / light", b.wallLit); color("wallShade", "Wall / shade", b.wallShade); color("roofLit", "Roof / light", b.roofLit); color("roofShade", "Roof / shade", b.roofShade); color("glass", "Window glass", b.glass); color("accent", "Accent", b.accent); }
        });
        s.contentHeight = row + s.scroll - area.y;
        if (s.contentHeight > area.h && area.h > 0) {
            float thumb = std::max(20.f, area.h * area.h / s.contentHeight);
            context.rect({area.x + area.w - 4, area.y, 2, area.h}, theme.border);
            context.rect({area.x + area.w - 4, area.y + (area.h - thumb) * s.scroll / (s.contentHeight - area.h), 2, thumb}, theme.muted, 1);
        }
    }
    if (!narrow) { context.rect({list.x + list.w, bodyY, 1, bodyH}, theme.border); context.rect({inspect.x - 1, bodyY, 1, bodyH}, theme.border); }
    if ((!narrow || s.narrowPanel == 0) && preview.w > 0 && preview.h > 100) {
        context.rect(preview, theme.background);
        float controlW = (preview.w - 32) / 3;
        const char* names[] = {"Still", "Construction", "Upgrade"};
        for (int i = 0; i < 3; ++i) button("mode" + std::to_string(i), {preview.x + 12 + i * (controlW + 4), preview.y, controlW, 28}, names[i], [&s, i] { s.mode = i; s.frame = 0; s.playing = i != 0; }, true, s.mode == i);
        ui::Rect art{preview.x + 12, preview.y + 38, preview.w - 24, std::max(1.f, preview.h - 154)};
        auto key = std::to_string(s.revision) + ":" + std::to_string(s.variant) + ":" + number(s.angle) + ":" + std::to_string(s.mode);
        if (s.mode == 2) key += ":" + std::to_string(s.acceptedRevision);
        if (key != s.animationKey) {
            try {
                std::vector<BuildingStage> old;
                if (s.mode == 2) old.push_back({s.accepted.variants[std::min(s.variant, s.accepted.variants.size() - 1)], s.accepted.footprint});
                auto layout = s.mode == 0 ? buildingStillAnimation(s.model(), s.draft.footprint, s.angle)
                                          : buildingRiseAnimation(s.model(), s.draft.footprint, old, s.angle);
                auto animation = std::unique_ptr<tvg::Animation>(tvg::Animation::gen());
                if (!animation || animation->picture()->load(layout.json.data(), uint32_t(layout.json.size()), "lottie+json", nullptr, true) != tvg::Result::Success)
                    throw std::runtime_error("Could not load the building preview.");
                std::string{}.swap(layout.json);
                s.animation = std::move(animation); s.layout = std::move(layout);
                if (s.previewFailed) s.message = "Preview updated. Save or Apply the draft.";
                s.previewFailed = false;
            } catch (const std::exception& error) {
                s.message = std::string("Could not render the building preview: ") + error.what();
                s.previewFailed = true; s.playing = false;
            }
            s.animationKey = std::move(key);
        }
        double now = context.time(); double elapsed = s.previous < 0 ? 0 : std::clamp(now - s.previous, 0.0, .25); s.previous = now;
        if (s.playing && s.mode != 0) { s.frame += float(elapsed * s.layout.frameRate); if (s.frame >= (s.layout.frames - 1)) { s.frame = std::max(0.f, (s.layout.frames - 1)); s.playing = false; } }
        if (s.animation) {
            float scale = std::min(art.w / std::max(1.f, s.layout.width), art.h / std::max(1.f, s.layout.height)) * .88f * s.zoom;
            float tx = art.x + (art.w - s.layout.width * scale) / 2, ty = art.y + (art.h - s.layout.height * scale) / 2;
            s.animation->frame(s.mode == 0 ? std::max(0.f, (s.layout.frames - 1)) : std::clamp(s.frame, 0.f, std::max(0.f, (s.layout.frames - 1))));
            context.clip(art, [&] {
                auto picture = s.animation->picture();
                context.add(picture); ui::setTransform(picture, {scale, 0, tx, 0, scale, ty, 0, 0, 1});
                auto project = [&](float px, float py, float z) {
                    float center = s.draft.footprint / 2, a = px - center, b = py - center;
                    float rx = center + a * std::cos(s.angle) - b * std::sin(s.angle), ry = center + a * std::sin(s.angle) + b * std::cos(s.angle);
                    auto p = BuildingProjection{}.project(rx, ry, z);
                    return Point{tx + (p.x + s.layout.originX) * scale, ty + (p.y + s.layout.originY) * scale};
                };
                auto outline = [&](float x0, float y0, float x1, float y1, float z, ui::Color color) {
                    Point p[] = {project(x0, y0, z), project(x1, y0, z), project(x1, y1, z), project(x0, y1, z)};
                    for (int i = 0; i < 4; ++i) context.line(p[i].x, p[i].y, p[(i + 1) % 4].x, p[(i + 1) % 4].y, color, 1);
                };
                outline(0, 0, s.draft.footprint, s.draft.footprint, 0, theme.muted);
                if (s.patch) { const auto& p = s.model().patches[s.selected]; outline(p.x0, p.y0, p.x1, p.y1, 0, theme.accent); }
                else { const auto& b = s.model().blocks[s.selected]; outline(b.x0, b.y0, b.x1, b.y1, b.base + b.wall, theme.accent); }
            });
        }
        float row = preview.y + preview.h - 108;
        float q = (preview.w - 36) / 4;
        button("rotate-left", {preview.x + 12, row, q, 28}, "−90°", [&s] { s.angle -= std::numbers::pi_v<float> / 2; });
        button("rotate-right", {preview.x + 16 + q, row, q, 28}, "+90°", [&s] { s.angle += std::numbers::pi_v<float> / 2; });
        button("zoom", {preview.x + 20 + q * 2, row, q, 28}, "Zoom +", [&s] { s.zoom = std::min(4.f, s.zoom * 1.25f); });
        button("fit", {preview.x + 24 + q * 3, row, q, 28}, "Fit", [&s] { s.zoom = 1; });
        ui::Rect rotation{preview.x + 12, row + 36, preview.w - 24, 20};
        context.rect(rotation, theme.surface, 2, theme.border);
        context.text(rotation, "Angle " + number(s.angle * 180 / std::numbers::pi_v<float>) + "°  ·  drag", theme.muted, 11, false, ui::Align::Center);
        context.control("building/rotation", rotation, [&s, rotation](const ui::Event& event) { if (event.type == ui::EventType::Press || event.type == ui::EventType::Drag) s.angle = (std::clamp((event.x - rotation.x) / rotation.w, 0.f, 1.f) * 2 - 1) * std::numbers::pi_v<float>; }, true, false, false, true);
        button("play", {preview.x + 12, row + 64, 64, 28}, s.playing ? "Pause" : "Play", [&s] { if (s.mode == 0) s.mode = 1; if (s.frame >= (s.layout.frames - 1)) s.frame = 0; s.playing = !s.playing; });
        button("restart", {preview.x + 80, row + 64, 64, 28}, "Restart", [&s] { if (s.mode == 0) s.mode = 1; s.frame = 0; s.playing = true; });
        ui::Rect scrub{preview.x + 152, row + 68, std::max(0.f, preview.w - 164), 20};
        context.rect(scrub, theme.surface, 2, theme.border);
        float progress = s.mode == 0 ? 1 : s.frame / std::max(1.f, (s.layout.frames - 1));
        context.rect({scrub.x, scrub.y, scrub.w * progress, scrub.h}, ui::Color{theme.accent.r, theme.accent.g, theme.accent.b, 75}, 2);
        context.text(scrub, "Frame " + std::to_string(int(s.mode == 0 ? (s.layout.frames - 1) : s.frame)), theme.text, 11, false, ui::Align::Center);
        context.control("building/scrub", scrub, [&s, scrub](const ui::Event& event) { if ((event.type == ui::EventType::Press || event.type == ui::EventType::Drag) && scrub.w > 0) { if (s.mode == 0) s.mode = 1; s.playing = false; s.frame = std::clamp((event.x - scrub.x) / scrub.w, 0.f, 1.f) * std::max(0.f, (s.layout.frames - 1)); } }, true, false, false, true);
    }
    float footer = y + h - 72;
    context.rect({x, footer - 8, w, 80}, theme.surface);
    context.rect({x, footer - 8, w, 1}, theme.border);
    ui::textField(context, "building/path", {x + 12, footer, std::max(0.f, w - 256), 28}, s.pathInput, "JSON file path", true, {}, ui::Icon::None, compact);
    button("open", {x + w - 238, footer, 66, 28}, "Open", [this] { load(te::io::pathFromUtf8(impl->pathInput.value)); });
    button("save", {x + w - 168, footer, 64, 28}, "Save", [this] { save(te::io::pathFromUtf8(impl->pathInput.value)); });
    button("apply", {x + w - 100, footer, 88, 28}, applyCallback ? "Apply" : "Accept", [this] { apply(impl->callback); });
    button("reload", {x + 12, footer + 34, 64, 28}, "Reload", [this] { command("reload"); }, !s.path.empty());
    button("export", {x + 80, footer + 34, 64, 28}, "Export", [this] { exportTo(te::io::pathFromUtf8(impl->pathInput.value)); });
    auto status = std::string(s.dirty() ? "● " : "") + s.message;
    context.text({x + 156, footer + 34, std::max(0.f, w - 168), 28}, context.elideText(status, std::max(0.f, w - 168), 11), theme.muted, 11);

}
}  // namespace engine

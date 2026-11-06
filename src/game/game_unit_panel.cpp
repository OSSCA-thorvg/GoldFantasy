#include "game_app.h"
#include "person_portrait.h"

namespace hearthold
{
namespace
{
struct Badge { Condition condition; ui::Rect box; };

std::vector<Badge> badges(const ui::Context& context, const std::vector<Condition>& conditions, float width)
{
    std::vector<Badge> result; float x = 0, y = 0;
    for (auto condition : conditions) {
        float w = std::min(width, context.textWidth(conditionName(condition), 11) + 12);
        if (x > 0 && x + w > width) { x = 0; y += 20; }
        result.push_back({condition, {x, y, w, 18}}); x += w + 4;
    }
    return result;
}
}  // namespace

bool GameApp::residentSelection() const
{
    return std::any_of(chosen.begin(), chosen.end(), [&](int id) { auto p = town.person(id); return p && p->role == Role::Resident; });
}

bool GameApp::shelteredSelection() const
{
    return std::any_of(chosen.begin(), chosen.end(), [&](int id) {
        auto p = town.person(id); return p && (p->inside || p->crossingDoorway() || p->task == Activity::Sleeping);
    });
}

ui::Rect GameApp::personPanelBounds(float width, float height, bool commands) const
{
    float count = commands ? (shelteredSelection() ? 8.f : 7.f) : 0;
    float w = std::max(chosen.size() == 1 ? 600.f : 360.f, count * 72 + std::max(0.f, count - 1) * 6 + 24);
    float h = 108;
    if (chosen.size() == 1) {
        if (auto p = town.person(chosen.front())) {
            auto tags = badges(context, town.conditions(*p), w - 24);
            if (!tags.empty()) h += tags.back().box.y + 22;
            if (!p->past.empty()) h += 20;
        }
    } else h = 38 + std::ceil(std::min(size_t(20), chosen.size()) / float(std::max(1, int((w - 24) / 60)))) * 60;
    h += commands ? 44 : 12;
    float scale = std::min(1.f, std::max(1.f, width - 24) / w);
    return {(width - w * scale) / 2, height - 12 - h * scale, w * scale, h * scale};
}

void GameApp::personPanel(ui::Rect panel)
{
    const auto& t = theme; bool commands = residentSelection();
    float logicalWidth = std::max(chosen.size() == 1 ? 600.f : 360.f,
        commands ? (shelteredSelection() ? 8 * 72 + 7 * 6 + 24.f : 7 * 72 + 6 * 6 + 24.f) : 0.f);
    float scale = panel.w / logicalWidth;
    auto box = [&](ui::Rect r) { return ui::Rect{panel.x + r.x * scale, panel.y + r.y * scale, r.w * scale, r.h * scale}; };
    auto text = [&](ui::Rect r, std::string_view value, ui::Color color, float size = 12, bool bold = false) {
        context.text(box(r), context.elideText(value, r.w * scale, size * scale, bold), color, size * scale, bold);
    };
    auto portrait = [&](const Person& p, ui::Rect frame) {
        context.rect(frame, t.raised, t.radius, t.border);
        auto mood = moodOf(p); auto backdrop = portraitBackdrop(town.map(), p.position, town.climate());
        auto key = ui::paintKey(p.look, p.race, p.lookRevision, p.calling, frame.w, frame.h, mood, injuryOf(p), backdrop);
        auto& entry = dockPortraits[p.id];
        if (entry.key != key || !entry.paint) {
            auto face = personPortrait(p, mood, frame.w - 2, frame.h - 2, backdrop);
            face->ref(); entry.paint = {face, [](tvg::Paint* value) { value->unref(); }}; entry.key = std::move(key);
        }
        context.add(entry.paint.get());
        ui::setTransform(entry.paint.get(), {1, 0, frame.x + 1, 0, 1, frame.y + 1, 0, 0, 1});
    };
    if (chosen.size() == 1) {
        const auto* p = town.person(chosen.front()); if (!p) return;
        portrait(*p, box({12, 12, 80, 84}));
        text({104, 10, logicalWidth - 226, 22}, p->name, t.text, 17, true);
        text({104, 34, 252, 18}, std::string(raceName(p->race)) + " " + callingName(p->calling) + (p->role == Role::Guest ? " · guest" : " · resident"), t.accent);
        std::string action = p->autoMode && !p->ordered && p->job < 0 && p->activity == Activity::Idle && p->moving() ? "Looking for work" :
            std::string(p->moving() ? "on the way: " : "") + activityName(p->activity);
        text({104, 53, 252, 18}, "Action: " + action, t.text);
        const auto* home = town.building(p->role == Role::Resident ? p->home : p->bed);
        text({104, 73, 252, 16}, std::string(p->role == Role::Resident ? "Home: " : "Bed: ") + (home ? structureSpec(home->kind).name : "none"), t.muted, 11);
        const auto* job = town.building(p->job);
        text({104, 90, 252, 16}, "Purse " + std::to_string(p->purse) + " gold · " + (job ? structureSpec(job->kind).name : "no job"), t.muted, 11);
        auto bar = [&](float y, const char* label, float value, bool good) {
            float x = 374, w = logicalWidth - x - 12;
            text({x, y, 46, 16}, label, t.muted, 11);
            context.rect(box({x + 46, y + 5, w - 46, 6}), t.raised, 3 * scale);
            context.rect(box({x + 46, y + 5, std::max(2.f, (w - 46) * value), 6}), (good ? value : 1 - value) < .3f ? t.danger : t.success, 3 * scale);
        };
        bar(38, "Food", p->food, true); bar(55, "Rest", p->rest, true);
        bar(72, "Health", p->health, true); bar(89, "Stress", p->stress, false);
        auto tags = badges(context, town.conditions(*p), logicalWidth - 24);
        for (const auto& tag : tags) {
            auto r = tag.box; r.x += 12; r.y += 110;
            auto color = positiveCondition(tag.condition) ? t.success : t.accent;
            if (tag.condition == Condition::Starving || tag.condition == Condition::Wounded || tag.condition == Condition::Distressed) color = t.danger;
            context.rect(box(r), t.raised, 3 * scale);
            text({r.x + 6, r.y, r.w - 12, r.h}, conditionName(tag.condition), color, 11);
        }
        float after = tags.empty() ? 110 : 132 + tags.back().box.y;
        if (!p->past.empty()) text({12, after, logicalWidth - 24, 18}, p->past, t.muted, 11);
    } else {
        text({12, 10, logicalWidth - 144, 22}, std::to_string(chosen.size()) + " units selected", t.text, 15, true);
        int columns = std::max(1, int((logicalWidth - 24) / 60)), shown = 0;
        for (int id : chosen) {
            const auto* p = town.person(id); if (!p || shown >= 20) continue;
            float x = 12 + (shown % columns) * 60, y = 38 + (shown / columns) * 60;
            portrait(*p, box({x, y, 52, 54}));
            context.rect(box({x + 3, y + 47, 46, 4}), t.raised, 2 * scale);
            context.rect(box({x + 3, y + 47, std::max(2.f, 46 * p->health), 4}), p->health < .35f ? t.danger : t.success, 2 * scale);
            context.control("pick-person-" + std::to_string(id), box({x, y, 52, 54}), [this, id](const ui::Event& e) {
                if (e.type == ui::EventType::Activate) selectPeople({id});
            }, true, false);
            ++shown;
        }
    }
    if (commands) {
        bool allAuto = std::all_of(chosen.begin(), chosen.end(), [&](int id) { auto p = town.person(id); return p && p->autoMode; });
        ui::Appearance appearance; appearance.fontSize = 11 * scale;
        ui::button(context, "unit-auto", box({logicalWidth - 112, 10, 100, 24}), allAuto ? "Auto ON  T" : "Auto OFF  T", [this] { toggleAuto(); },
            allAuto ? ui::ButtonStyle::Primary : ui::ButtonStyle::Default, true, ui::Icon::None, false, appearance);
        commandCard({panel.x + 12 * scale, panel.y + panel.h - 42 * scale, panel.w - 24 * scale, 30 * scale}, scale);
    }
    for (auto it = dockPortraits.begin(); it != dockPortraits.end();) {
        if (std::find(chosen.begin(), chosen.end(), it->first) == chosen.end()) it = dockPortraits.erase(it);
        else ++it;
    }
}
}  // namespace hearthold

#include "game_app.h"
#include "building_assets.h"
#include "person_portrait.h"
#include "structure_icon.h"
#include <cmath>
#include <cstdio>
#include <algorithm>
#include <functional>
#include <iterator>

namespace hearthold
{
namespace
{
struct ToolInfo
{
    const char* label;
    const char* key;
    const char* hint;
};
constexpr ToolInfo tools[] = {
    {"Select", "Q", "Click or drag to select units. Right-click their own housing with units selected to rest. Right-click gives a contextual order."},
    {"Road", "1", "Hold and draw a road in one stroke. Release to build; Esc cancels."},
    {"Pave", "P", "Click a laid road to pave it with stone: people walk faster on cobbles."},
    {"Fields", "2", "Drag a rectangle beside a road near a farmhouse, or click corners to outline any shape."},
    {"Camp", "C", ""},
    {"Tent", "3", ""},
    {"Farm", "4", ""},
    {"Wood", "5", ""},
    {"Quarry", "6", ""},
    {"Well", "W", ""},
    {"Store", "J", ""},
    {"Market", "7", ""},
    {"Tavern", "8", ""},
    {"Inn", "9", ""},
    {"Guild", "0", ""},
    {"Chapel", "G", ""},
    {"Smith", "B", ""},
    {"Armor", "N", ""},
    {"Potion", "O", ""},
    {"Shrine", "H", ""},
    {"Mage", "K", ""},
    {"Portal", "V", ""},
    {"Clear", "X", "Demolish a building, a field or a road."},
};
static_assert(std::size(tools) == size_t(Tool::Count), "One row per tool, in the enum's order.");

struct Group
{
    const char* name;
    std::vector<Tool> tools;
};

// Building categories in the Build menu.
const std::vector<Group>& buildGroups()
{
    static const std::vector<Group> groups{
        {"Roads", {Tool::Road, Tool::Pave}},
        {"Housing", {Tool::Camp, Tool::Tent}},
        {"Food & materials", {Tool::Farm, Tool::Field, Tool::Lumberyard, Tool::Quarry}},
        {"Water & storage", {Tool::Well, Tool::Storehouse}},
        {"Trade & outfitters", {Tool::Market, Tool::Weaponsmith, Tool::Armorer, Tool::Apothecary}},
        {"Lodging & leisure", {Tool::Inn, Tool::Tavern, Tool::Guild}},
        {"Faith & arcane", {Tool::Chapel, Tool::Shrine, Tool::MageTower, Tool::Portal}},
    };
    return groups;
}

const char* dungeonKind(DungeonKind kind)
{
    switch (kind) {
    case DungeonKind::Cave: return "Cave";
    case DungeonKind::Crypt: return "Crypt";
    case DungeonKind::Portal: return "Rift portal";
    case DungeonKind::Ruin: return "Ruined tower";
    }
    return "";
}

// Greedy word wrap into at most `lines` rows.
std::vector<std::string> wrap(const ui::Context& context, const std::string& text, float width, float size, size_t lines = 3)
{
    std::vector<std::string> rows;
    std::string row, word;
    auto flush = [&] {
        auto candidate = row.empty() ? word : row + " " + word;
        if (!row.empty() && context.textWidth(candidate, size) > width) {
            rows.push_back(row);
            row = word;
        } else row = candidate;
        word.clear();
    };
    for (char c : text) {
        if (c == ' ') flush();
        else word += c;
    }
    flush();
    if (!row.empty()) rows.push_back(row);
    if (rows.size() > lines) rows.resize(lines);
    return rows;
}

}  // namespace

void GameApp::hud(float width, float height)
{
    updateContextDock(width, height);
    const auto& t = theme;
    auto calendar = town.calendar();
    const auto& stock = town.stock();
    // Top centre: what the realm holds, gold with its expected daily change, then the game speed.
    auto room = town.capacity();
    auto plan = town.forecast();
    auto signedText = [](int value) { return (value >= 0 ? "+" : "") + std::to_string(value); };
    struct Holding
    {
        std::string text;
        ui::Color color;
        float width = 0;
    };
    auto kept = [&](const char* name, int have, int limit) {
        return Holding{std::string(name) + " " + std::to_string(have) + "/" + std::to_string(limit), have >= limit ? t.danger : t.text};
    };
    Holding holdings[] = {
        {"Gold " + std::to_string(stock.gold) + " (" + signedText(plan.net()) + "/day)", plan.net() < 0 ? t.danger : t.accent},
        kept("Wood", stock.wood, room.wood), kept("Stone", stock.stone, room.stone), kept("Food", stock.food, room.food), kept("Water", stock.water, room.water),
        {"Mana " + std::to_string(stock.mana), t.text},
    };
    float gap = 22, total = 0;
    for (auto& h : holdings) {
        h.width = context.textWidth(h.text, 14, true);
        total += h.width + gap;
    }
    float speedWidth = (maxSpeed + 1) * 40.f;
    ui::Rect bank{(width - (total + 8 + 10 + speedWidth)) / 2, 12, total + 8, 34};
    context.rect(bank, t.surface, t.radius, t.border);
    float x = bank.x + 15;
    for (const auto& h : holdings) {
        context.text({x, bank.y, h.width + 4, bank.h}, h.text, h.color, 14, true);
        x += h.width + gap;
    }
    const char* speeds[] = {"||", "1x", "2x", "3x", "4x", "5x"};
    for (int i = 0; i <= maxSpeed; ++i) {
        ui::Rect bounds{bank.x + bank.w + 10 + i * 40.f, bank.y + 2, 36, 30};
        ui::button(context, std::string("speed-") + speeds[i], bounds, speeds[i], [this, i] { if (i) setSpeed(i); else togglePause(); },
                   gameSpeed() == i ? ui::ButtonStyle::Primary : ui::ButtonStyle::Default);
    }

    // Top left: the date, the sky, the people, and the finances button.
    ui::Rect panel{16, 60, 420, 80};
    context.rect(panel, t.surface, t.radius, t.border);
    const auto& sky = town.climate();
    int minutes = int(town.dayFraction() * 24 * 60);
    char clock[64];
    std::snprintf(clock, sizeof clock, "%02d:%02d   %s, %d\u00b0C", minutes / 60, minutes % 60, weatherName(sky.weather), int(std::lround(sky.temperature)));
    std::string weatherLine = clock;
    if (sky.snow > .05f) weatherLine += "  snow " + std::to_string(int(sky.snow * 100)) + "%";
    std::string date = std::string(seasonName(calendar.season)) + "  -  Day " + std::to_string(calendar.day) + ", Month " + std::to_string(calendar.month) + ", Year " + std::to_string(calendar.year);
    context.text({panel.x + 14, panel.y + 6, panel.w - 28, 22}, date, t.accent, 13, true);
    context.text({panel.x + 14, panel.y + 6, panel.w - 28, 22}, weatherLine, t.muted, 13, false, ui::Align::End);
    std::string people = "Residents " + std::to_string(town.population()) + " / " + std::to_string(town.housing()) + "   Guests " + std::to_string(town.guests()) + " / " +
                         std::to_string(town.guestBeds()) + " beds   Idle " + std::to_string(town.idle());
    context.text({panel.x + 14, panel.y + 30, panel.w - 28, 22}, people, t.text, 13);
    if (town.raiding()) context.text({panel.x + 14, panel.y + 52, panel.w - 130, 22}, "Raid! Auto units defend the settlement", t.danger, 13, true);
    else {
        context.text({panel.x + 14, panel.y + 52, panel.w - 130, 22}, "Midgard  -  Renown " + std::to_string(town.renown()) + " / 100", t.muted, 13);
    }
    ui::button(context, "ledger", {panel.x + panel.w - 112, panel.y + 48, 100, 26}, "Finances (L)", [this] { toggleLedger(); },
               ledgerOpen ? ui::ButtonStyle::Primary : ui::ButtonStyle::Default);
    if (ledgerOpen) ledgerPanel({panel.x, panel.y + panel.h + 8, panel.w, 0});

    if (!status.empty() || !current.problem.empty()) {
        float y = dockBounds.y - 28;
        context.text({16, y, width - 32, 22}, !status.empty() ? status : current.problem, t.danger, 13, true, ui::Align::Center);
    }
    if (!ledgerOpen) context.text({16, 146, 760, 20}, "M move  -  A attack  -  W work  -  S stop  -  T Auto  -  B unit build  -  Right-drag/arrows pan, wheel zoom", t.muted, 12);
    if (pending != Order::None) context.text({width / 2 - 200, dockBounds.y - 34, 400, 22}, pending == Order::Move ? "Move: choose a destination" : pending == Order::Work ? "Work: choose a resource, building or road" : "Attack: choose an enemy, resource or destination", t.accent, 13, true, ui::Align::Center);
    if (!town.camp() && !town.map().dungeons().empty()) {
        // Point the way to the dungeon the settlers came for.
        const auto& lair = town.map().dungeons().front().origin;
        auto start = town.map().camp();
        auto toward = project(lair.x + 1.f, lair.y + 1.f) - project(start.x, start.y);
        float angle = std::atan2(toward.y, toward.x) * 57.3f;
        const char* ways[] = {"east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"};
        const char* way = ways[int(std::lround((angle < 0 ? angle + 360 : angle) / 45)) % 8];
        context.text({16, 166, 760, 20}, std::string("Lead your settlers ") + way + " to " + town.map().dungeons().front().name + " and found a camp (C) within 12 paces of it.", t.accent, 13, true);
    }

    taskbar(width, height);
    if (!notice.empty() && context.time() < noticeUntil) {
        float w = std::max(360.f, context.textWidth(notice, 14, true) + 48);
        ui::Rect toast{(width - w) / 2, 124, w, 36};
        context.rect(toast, t.raised, t.radius, t.accent);
        context.text(toast, notice, t.text, 14, true, ui::Align::Center);
        context.requestFrameAt(noticeUntil);
    }
}

void GameApp::ledgerPanel(ui::Rect below)
{
    const auto& t = theme;
    auto plan = town.forecast();
    const auto& books = town.ledger();
    const auto& stock = town.stock();
    float y = below.y + 12, left = below.x + 16, inner = below.w - 32;
    std::vector<std::function<void()>> rows;
    auto heading = [&](const std::string& text) {
        float at = y + 4;
        rows.push_back([=, this] { context.text({left, at, inner, 20}, text, t.accent, 13, true); });
        y += 26;
    };
    // A label on the left and its amount on the right.
    auto line = [&](const std::string& label, const std::string& amount, ui::Color color) {
        float at = y;
        rows.push_back([=, this] {
            context.text({left, at, inner, 18}, label, t.muted, 12);
            context.text({left, at, inner, 18}, amount, color, 12, true, ui::Align::End);
        });
        y += 19;
    };
    auto money = [&](int value) { return (value > 0 ? "+" : value < 0 ? "-" : "") + std::to_string(std::abs(value)) + " gold"; };
    auto tone = [&](int value) { return value < 0 ? t.danger : value > 0 ? t.success : t.muted; };
    heading("Gold each day, expected");
    line("Wages for workers", money(-plan.wages), tone(-plan.wages));
    line("Rent from let homes", money(plan.rent), tone(plan.rent));
    line("Guests (as yesterday)", money(plan.guests), tone(plan.guests));
    if (plan.made.gold) line("Market trade", money(plan.made.gold), tone(plan.made.gold));
    if (plan.bounty) line("Bounties (as yesterday)", money(plan.bounty), tone(plan.bounty));
    line("Net", money(plan.net()) + " a day", tone(plan.net()));
    if (plan.net() < 0) line("The treasury lasts", "about " + std::to_string(stock.gold / -plan.net()) + " days", t.danger);
    heading("Yesterday");
    line("Wages paid", money(-books.wages), tone(-books.wages));
    line("Rent collected", money(books.rent), tone(books.rent));
    line("Guests paid", money(books.guests), tone(books.guests));
    if (books.sales) line("Homes sold", money(books.sales), tone(books.sales));
    if (books.bounty) line("Bounties", money(books.bounty), tone(books.bounty));
    heading("Goods each day: made, used");
    auto goods = [&](const char* name, int made, int used, int have) {
        if (!made && !used) return;
        int net = made - used;
        std::string amount = "+" + std::to_string(made) + "  -" + std::to_string(used) + "  =  " + (net >= 0 ? "+" : "") + std::to_string(net);
        if (net < 0) amount += "  (" + std::to_string(have / -net) + " days left)";
        line(name, amount, net < 0 ? t.danger : t.text);
    };
    goods("Food", plan.made.food, plan.used.food, stock.food);
    goods("Water", plan.made.water, plan.used.water, stock.water);
    goods("Wood", plan.made.wood, 0, stock.wood);
    goods("Stone", plan.made.stone, 0, stock.stone);
    goods("Mana", plan.made.mana, 0, stock.mana);
    ui::Rect panel{below.x, below.y, below.w, y - below.y + 10};
    context.rect(panel, t.surface, t.radius, t.border);
    context.control("ledger-panel", panel, [](const ui::Event&) {}, true, false);
    for (auto& row : rows) row();
}

float GameApp::inspector(ui::Rect panel, bool draw)
{
    const auto& t = theme;
    const auto* building = selected >= 0 ? town.building(selected) : nullptr;
    if (!building && selectedDungeon < 0) return 0;
    // Bottom centre, like the unit card: the building's picture, then what it does and needs.
    // Rows are laid out from 0 and drawn once the height, and so the top, is known.
    float y = 12, left = panel.x + 112, inner = panel.w - 128, top = panel.y;
    std::vector<std::function<void()>> rows;
    auto textRow = [&](std::string text, ui::Color color, float size = 13, bool bold = false) {
        float at = y;
        rows.push_back([=, this, &top] { context.text({left, top + at, inner, size + 8}, text, color, size, bold); });
        y += size + 9;
    };
    if (building) {
        const auto& spec = structureSpec(building->kind);
        textRow(spec.name, t.text, 17, true);
        if (building->built() && building->health < 1) textRow("Damaged: " + std::to_string(int(building->health * 100)) + "%  -  builders will mend it", t.danger, 12, true);
        for (auto& line : wrap(context, spec.description, inner, 12)) textRow(line, t.muted, 12);
        y += 4;
        if (!building->built()) textRow("Under construction: " + std::to_string(int(building->progress * 100)) + "%", t.accent, 13, true);
        if (spec.residents) textRow("Homes " + std::to_string(spec.residents) + " people", t.text);
        if (rentOf(building->kind)) {
            const auto* owner = town.person(building->owner);
            textRow(owner ? "Owned by " + owner->name : "Let for " + std::to_string(rentOf(building->kind)) + " gold a day per resident; sells for " + std::to_string(priceOf(building->kind)), owner ? t.accent : t.muted, 12);
        }
        if (spec.beds) textRow("Beds for " + std::to_string(spec.beds) + " guests", t.text);
        if (building->built() && (isHome(building->kind) || isLodging(building->kind))) {
            auto residents = town.occupants(building->id);
            constexpr size_t pageSize = 6;
            size_t pages = std::max(size_t(1), (residents.size() + pageSize - 1) / pageSize);
            residentPage = std::min(residentPage, pages - 1);
            textRow(std::string(isLodging(building->kind) ? "Guests " : "Residents ") + std::to_string(residents.size()) +
                    (isLodging(building->kind) ? "  -  click a name to inspect" : "  -  click a name to control"), t.accent, 12, true);
            size_t last = std::min(residents.size(), (residentPage + 1) * pageSize);
            for (size_t i = residentPage * pageSize; i < last; ++i) {
                int id = residents[i]; float at = y;
                rows.push_back([=, this, &top] {
                    const auto* p = town.person(id); if (!p) return;
                    bool resting = p->task == Activity::Sleeping && p->taskSite == building->id;
                    bool present = town.shelterOf(*p) == building->id;
                    const char* state = present ? (p->inside ? (p->activity == Activity::Sleeping ? "Resting" : "Inside") : "Leaving") : resting ? "On the way" : "Away";
                    ui::button(context, "resident-" + std::to_string(id), {left, top + at, inner - 174, 28}, p->name,
                               [this, id] { selectPeople({id}); }, ui::ButtonStyle::Quiet);
                    context.text({left + inner - 168, top + at, 88, 28}, state, present ? t.success : t.muted, 11);
                    ui::button(context, "resident-leave-" + std::to_string(id), {left + inner - 74, top + at, 74, 28}, "Leave",
                               [this, id] { selectPeople({id}); leaveSelected(); }, ui::ButtonStyle::Default, p->role == Role::Resident && (present || resting));
                });
                y += 32;
            }
            if (pages > 1) {
                float at = y; size_t page = residentPage;
                rows.push_back([=, this, &top] {
                    ui::button(context, "residents-prev", {left, top + at, 80, 26}, "Previous", [this] { --residentPage; }, ui::ButtonStyle::Quiet, page > 0);
                    context.text({left + 88, top + at, 80, 26}, std::to_string(page + 1) + " / " + std::to_string(pages), t.muted, 12);
                    ui::button(context, "residents-next", {left + 174, top + at, 80, 26}, "Next", [this] { ++residentPage; }, ui::ButtonStyle::Quiet, page + 1 < pages);
                });
                y += 30;
            }
        }
        if (spec.storage) textRow("Keeps " + std::to_string(spec.storage) + " more of wood, stone, food and water", t.text);
        if (isLodging(building->kind) || building->kind == Structure::Tavern || isOutfitter(building->kind))
            textRow("Earned " + std::to_string(building->earned) + " gold from guests", t.muted, 12);
        if (building->kind == Structure::Guild || building->kind == Structure::GuildHall) textRow(std::to_string(building->registered) + " adventurers on the rolls", t.muted, 12);
        if (building->kind == Structure::Chapel && building->built()) {
            static constexpr const char* peoples[] = {"humans", "elves", "dwarves", "beastfolk"};
            textRow(std::string(faithName(building->faith)) + ": draws " + peoples[int(building->faith)], t.accent, 12, true);
            float at = y;
            int id = building->id;
            Faith current = building->faith;
            rows.push_back([=, this, &top] {
                const char* tabs[] = {"Dawn", "Grove", "Forge", "Moon"};
                float w = std::min(90.f, (inner - 9) / 4);
                for (int i = 0; i < 4; ++i)
                    ui::button(context, std::string("faith-") + tabs[i], {left + i * (w + 3), top + at, w, 26}, tabs[i], [this, id, i] { town.setFaith(id, Faith(i)); },
                               int(current) == i ? ui::ButtonStyle::Primary : ui::ButtonStyle::Default);
            });
            y += 32;
        }
        if (spec.jobs) {
            float at = y;
            int id = building->id, workers = building->workers;
            // With nobody idle, + borrows a hand from the busiest or best-stocked workplace.
            bool hands = town.idle() > 0 || town.employed() > workers;
            rows.push_back([=, this, &top] {
                context.text({left, top + at, 200, 26}, "Workers " + std::to_string(workers) + " / " + std::to_string(spec.jobs), t.text, 13);
                ui::button(context, "workers-less", {left + 200, top + at, 30, 26}, "-", [this, id, workers] { town.setWorkers(id, workers - 1); }, ui::ButtonStyle::Default, workers > 0);
                ui::button(context, "workers-more", {left + 234, top + at, 30, 26}, "+", [this, id, workers] { town.setWorkers(id, workers + 1); },
                           ui::ButtonStyle::Default, workers < spec.jobs && hands);
            });
            y += 32;
            auto output = town.dailyOutput(*building);
            if (building->kind == Structure::Farm)
                textRow("Fields tended " + std::to_string(town.tendedFieldAcres()) + " of " + std::to_string(town.fieldAcres()) + " acres", t.muted, 12);
            else if (spec.product == Product::Wood) {
                int standing = 0;
                const auto& map = town.map();
                for (int y = int(building->center.y) - 5; y <= int(building->center.y) + 5; ++y)
                    for (int x = int(building->center.x) - 5; x <= int(building->center.x) + 5; ++x)
                        if (map.inside(x, y) && distance({x + .5f, y + .5f}, building->center) < 4.6f) standing += map.at(x, y).trees;
                textRow(standing ? "Fells nearby trees: " + std::to_string(standing) + " left in reach" : "No trees left in reach; they grow back slowly", standing ? t.success : t.danger, 12);
            } else if (spec.product != Product::None) textRow(output.empty() ? "No output" : "Makes " + describe(output) + " a day", output.empty() ? t.danger : t.success, 12);
        }
        auto growth = town.growthStatus(*building);
        if (growth.grows) {
            y += 4;
            textRow("Grows into " + growth.next, t.accent, 13, true);
            float at = y, fraction = growth.needed ? float(growth.days) / growth.needed : 0;
            rows.push_back([=, this, &top] {
                context.rect({left, top + at + 4, inner, 8}, t.raised, 4);
                context.rect({left, top + at + 4, std::max(8.f, inner * fraction), 8}, t.accent, 4);
            });
            y += 18;
            textRow(std::to_string(growth.days) + " / " + std::to_string(growth.needed) + " days", t.muted, 12);
            if (!growth.reason.empty()) for (auto& line : wrap(context, growth.reason, inner, 12, 2)) textRow(line, growth.ready ? t.muted : t.danger, 12);
        }
    } else {
        const auto& site = town.map().dungeons()[size_t(selectedDungeon)];
        textRow(site.name, t.text, 16, true);
        textRow(std::string(dungeonKind(site.kind)) + "  -  a way to " + worldName(town.map().destination(site)), t.accent, 13);
        auto about = town.opened(selectedDungeon) ? "Open to adventurers. Guests delve it by day and pay the guild a share of their loot. Select residents and right-click it to send an expedition."
                                                  : "Monsters lurk inside and come out to raid by night. Build an adventurers' guild within 10 paces to open it, or send an expedition: select residents and right-click it.";
        for (auto& line : wrap(context, about, inner, 12)) textRow(line, town.opened(selectedDungeon) ? t.success : t.muted, 12);
    }
    panel.h = std::max(126.f, y + 10);
    if (!draw) return panel.h;
    ui::Rect frame{panel.x + 12, panel.y + 12, 84, 94};
    context.rect(frame, t.raised, t.radius, t.border);
    if (building) {
        ui::Rect art{frame.x + 10, frame.y + 10, frame.w - 20, frame.h - 20};
        Structure kind = building->kind;
        context.paint("inspect-" + std::to_string(buildingAppearanceRevision(kind)) + "-" + std::to_string(int(kind)) + "-" + std::to_string(int(art.x)) + "-" + std::to_string(int(art.y)), [=] {
            auto holder = tvg::Scene::gen();
            holder->add(structureIcon(kind, art.w, art.h));
            holder->translate(art.x, art.y);
            return holder;
        });
    }
    for (auto& row : rows) row();
    return panel.h;
}
}  // namespace hearthold

namespace hearthold
{
ui::Rect GameApp::buildMenuBounds(float width, float height, bool global) const
{
    const auto& groups = buildGroups(); int page = std::max(0, global ? globalCard : card);
    size_t count = page == 0 ? groups.size() : groups[size_t(page - 1)].tools.size();
    float cell = page == 0 ? 78.f : 86.f, available = std::max(160.f, width - 24);
    int columns = std::max(1, std::min(int(count), int((available - 18) / (cell + 6))));
    float w = std::min(available, std::max(244.f, columns * cell + (columns - 1) * 6 + 24));
    int rows = (int(count) + columns - 1) / columns;
    float h = 48 + rows * (page == 0 ? 32 : 64) + (rows - 1) * 6 + (page == 0 ? 6 : 30);
    return {(width - w) / 2, height - 12 - h, w, h};
}

void GameApp::commandCard(ui::Rect area, float scale, bool global, bool buildMenu)
{
    const auto& t = theme;
    ui::Appearance appearance; appearance.fontSize = 12 * scale; appearance.radius = t.radius * scale;
    auto button = [&](std::string_view id, ui::Rect bounds, std::string_view label, std::function<void()> activate,
                      ui::ButtonStyle style = ui::ButtonStyle::Default, bool enabled = true) {
        return ui::button(context, std::string(global ? "global/" : "unit/") + std::string(id), bounds, label, std::move(activate),
            style, enabled, ui::Icon::None, false, appearance);
    };
    if (!buildMenu) {
        bool leave = shelteredSelection(); int count = leave ? 8 : 7; float gap = 6 * scale, w = (area.w - (count - 1) * gap) / count;
        auto cell = [&](int i) { return ui::Rect{area.x + i * (w + gap), area.y, w, area.h}; };
        button("card-build", cell(0), "Build", [this] { openUnitBuild(); });
        button("card-move", cell(1), "Move  M", [this] { prepare(Order::Move); }, pending == Order::Move ? ui::ButtonStyle::Primary : ui::ButtonStyle::Default);
        button("card-attack", cell(2), "Attack  A", [this] { prepare(Order::Attack); }, pending == Order::Attack ? ui::ButtonStyle::Primary : ui::ButtonStyle::Default);
        button("card-work", cell(3), "Work  W", [this] { prepare(Order::Work); }, pending == Order::Work ? ui::ButtonStyle::Primary : ui::ButtonStyle::Default);
        button("card-stop", cell(4), "Stop  S", [this] { stopSelected(); });
        button("card-clear", cell(5), "Clear  X", [this] { selectTool(Tool::Demolish); }, tool == Tool::Demolish ? ui::ButtonStyle::Primary : ui::ButtonStyle::Default);
        button("card-select", cell(6), "Select  Q", [this] { selectTool(Tool::Select); }, tool == Tool::Select ? ui::ButtonStyle::Primary : ui::ButtonStyle::Default);
        if (leave) button("card-leave", cell(7), "Leave", [this] { leaveSelected(); });
        return;
    }
    const auto& groups = buildGroups(); int page = std::max(0, global ? globalCard : card);
    auto setPage = [this, global](int next) { drawerBridge = dockBounds; (global ? globalCard : card) = next; };
    button("card-back", {area.x + 10, area.y + 9, 46, 24}, "Back", [this, setPage, page] {
        if (page > 0) setPage(0); else dismissBuildDrawer();
    }, ui::ButtonStyle::Quiet);
    std::string title = page == 0 ? "Build" : groups[size_t(page - 1)].name;
    if (!global && chosen.size() == 1) if (auto p = town.person(chosen.front())) title += " · " + p->name;
    context.text({area.x + 64, area.y + 10, area.w - 76, 22}, context.elideText(title, area.w - 76, 13, true), t.text, 13, true);
    int count = int(page == 0 ? groups.size() : groups[size_t(page - 1)].tools.size());
    float preferred = page == 0 ? 78.f : 86.f;
    int columns = std::max(1, std::min(count, int((area.w - 18) / (preferred + 6))));
    float w = (area.w - 24 - (columns - 1) * 6) / columns, h = page == 0 ? 32.f : 64.f;
    auto cell = [&](int i) { return ui::Rect{area.x + 12 + (i % columns) * (w + 6), area.y + 40 + (i / columns) * (h + 6), w, h}; };
    if (page == 0) {
        for (int i = 0; i < count; ++i) {
            std::string name = groups[size_t(i)].name;
            button("card-group-" + name, cell(i), name.substr(0, name.find(' ')), [setPage, i] { setPage(i + 1); });
        }
        return;
    }
    std::string detail = "Choose a building"; auto detailColor = t.muted;
    const auto& group = groups[size_t(page - 1)];
    for (int i = 0; i < count; ++i) {
        auto id = group.tools[size_t(i)]; auto bounds = cell(i); auto kind = hearthold::toolStructure(id);
        std::string why;
        if (id == Tool::Camp && town.camp()) why = "Already founded";
        else if (id != Tool::Camp && !town.camp()) why = "Found the camp first";
        else if (kind && town.population() < structureSpec(*kind).requiredPopulation) why = "Needs " + std::to_string(structureSpec(*kind).requiredPopulation) + " people";
        auto state = button(std::string("card-pick-") + tools[int(id)].label, bounds, kind ? "" : tools[int(id)].label,
            [this, id, global] { selectTool(id, !global); }, tool == id ? ui::ButtonStyle::Primary : ui::ButtonStyle::Default, why.empty());
        if (kind) {
            auto structure = *kind; bool dim = !why.empty();
            ui::Rect art{bounds.x + 6, bounds.y + 3, bounds.w - 12, bounds.h - 23};
            context.paint("card-icon-" + std::to_string(buildingAppearanceRevision(structure)) + ui::paintKey(structure, art, dim), [=] {
                auto holder = tvg::Scene::gen(); holder->add(structureIcon(structure, art.w, art.h)); holder->translate(art.x, art.y);
                if (dim) holder->opacity(90);
                return holder;
            });
            context.text({bounds.x + 3, bounds.y + bounds.h - 20, bounds.w - 6, 18}, tools[int(id)].label, dim ? t.muted : t.text, 11, false, ui::Align::Center);
        }
        if (bounds.contains(mouse.x, mouse.y)) {
            detail = why.empty() ? (kind ? describe(structureSpec(*kind).cost) + " · " + tools[int(id)].key : tools[int(id)].hint) : why;
            detailColor = why.empty() ? t.muted : t.accent;
        }
        (void)state;
    }
    context.text({area.x + 12, area.y + area.h - 26, area.w - 24, 18}, context.elideText(detail, area.w - 24, 11), detailColor, 11);
}

ui::Rect GameApp::placementPanelBounds(float width, float height) const
{
    float w = std::min(460.f, width - 24); return {(width - w) / 2, height - 82, w, 70};
}

void GameApp::placementPanel(ui::Rect panel)
{
    const auto& t = theme;
    context.text({panel.x + 12, panel.y + 9, panel.w - 172, 22}, tools[int(tool)].label, t.text, 14, true);
    auto kind = toolStructure(); auto detail = kind ? describe(structureSpec(*kind).cost) + " · R rotates" : tools[int(tool)].hint;
    context.text({panel.x + 12, panel.y + 36, panel.w - 24, 18}, context.elideText(detail, panel.w - 24, 11), t.muted, 11);
    ui::button(context, "placement-build", {panel.x + panel.w - 156, panel.y + 9, 68, 24}, "Build", [this] {
        globalCard = 0; card = -1; drawerPinned = true; drawerSuppressed = false;
    }, ui::ButtonStyle::Quiet);
    ui::button(context, "placement-cancel", {panel.x + panel.w - 82, panel.y + 9, 70, 24}, "Cancel", [this] { selectTool(Tool::Select); }, ui::ButtonStyle::Quiet);
}
}  // namespace hearthold

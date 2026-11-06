#include "town.h"
#include <algorithm>
#include <cmath>

namespace hearthold
{
namespace
{
constexpr int monthsPerYear = 12;
constexpr int harvestMonth = 9;  // Last month of autumn.
bool isShrine(Structure kind) { return kind == Structure::Shrine; }
}  // namespace

const char* seasonName(Season season)
{
    switch (season) {
    case Season::Spring: return "Spring";
    case Season::Summer: return "Summer";
    case Season::Autumn: return "Autumn";
    case Season::Winter: return "Winter";
    }
    return "";
}

float Town::dayFraction() const { return float(std::fmod(time, secondsPerDay) / secondsPerDay); }

float Town::yearFraction() const { return float(std::fmod(time / secondsPerDay, double(daysPerMonth * monthsPerYear)) / (daysPerMonth * monthsPerYear)); }

Calendar Town::calendar() const
{
    int month = days / daysPerMonth;
    Calendar value;
    value.day = days % daysPerMonth + 1;
    value.month = month % monthsPerYear + 1;
    value.year = month / monthsPerYear + 1;
    value.season = Season((value.month - 1) / 3);
    return value;
}

int Town::fieldAcres() const
{
    int total = 0;
    for (const auto& field : farmland) total += field.acres();
    return total;
}

int Town::tendedFieldAcres() const
{
    float capacity = 0;
    for (const auto& item : placed)
        if (item.kind == Structure::Farm && item.built()) capacity += item.workers * item.attendance * structureSpec(item.kind).perWorker;
    return std::min(int(std::lround(capacity)), fieldAcres());
}

Resources Town::dailyOutput(const Building& item) const
{
    const auto& spec = structureSpec(item.kind);
    Resources out;
    if (!item.built()) return out;
    int amount = int(std::lround(item.workers * item.attendance * spec.perWorker));
    switch (spec.product) {
    case Product::Wood: break;  // Woodcutters fell real trees and carry the logs in; see Activity::Felling.
    case Product::Stone:
        break;  // Quarriers mine deposits and deliver actual stone.
    case Product::Goods:
        if (amount > 0) {
            int homes = 0;
            for (const auto& other : placed)
                if (isHome(other.kind) && distance(other.center, item.center) <= 8) ++homes;
            out.gold = amount + homes / 2;
        }
        break;
    case Product::Mana: out.mana = amount; break;
    case Product::Water:
        // A well beside a lake or river draws twice as much.
        out.water = amount * (nearbyTiles(item.center, 4, [](const Tile& t) { return t.terrain == Terrain::Water; }) ? 2 : 1);
        break;
    case Product::Food: {
        // Growing fields yield a little every summer and autumn day; the harvest brings the rest.
        auto season = calendar().season;
        if (season == Season::Summer || season == Season::Autumn) {
            int share = fieldAcres() ? tendedFieldAcres() * std::min(amount, fieldAcres()) / std::max(1, fieldAcres()) : 0;
            out.food = share / 2;
        } else out.food = int(std::lround(item.workers * item.attendance * 2));  // Foraging and hunting off-season.
        break;
    }
    case Product::None: break;
    }
    return out;
}

bool Town::advance(double seconds)
{
    constexpr double step = .1;
    bool newDayBegan = false;
    for (double left = seconds; left > 1e-9; left -= step) {
        double dt = std::min(step, left);
        time += dt;
        sky.advance(dt, secondsPerDay, yearFraction(), dayFraction());
        tick(dt);
        while (time >= (days + 1) * secondsPerDay) {
            newDay();
            newDayBegan = true;
        }
    }
    return newDayBegan;
}

void Town::newDay()
{
    auto before = calendar();
    ++days;
    auto date = calendar();
    // Output follows how much of the working day the workers actually spent at work.
    constexpr float shift = float(secondsPerDay) * .4f;
    for (auto& item : placed) {
        item.attendance = item.workers ? std::min(1.f, item.workedSeconds / (shift * item.workers)) : 0;
        item.workedSeconds = 0;
    }
    for (const auto& item : placed) store(dailyOutput(item));
    // Everyone drinks; a dry store means thirst.
    treasury.water -= int(folk.size());
    today.drunk += int(folk.size());
    thirst = treasury.water < 0;
    if (thirst) {
        treasury.water = 0;
        notify("The water has run out: people grow thirsty");
    }
    settleAccounts();
    for (auto& person : folk) ++person.days;
    // Fields count for how well they were tended across the growing season, not on its last day.
    if (before.season == Season::Summer || before.season == Season::Autumn) {
        growingTended += float(tendedFieldAcres());
        ++growingDays;
    }
    if (before.month == harvestMonth && date.month != harvestMonth) {
        int harvest = growingDays ? int(std::lround(growingTended / growingDays * 10)) : 0;
        growingTended = 0;
        growingDays = 0;
        store({0, 0, 0, harvest});
        notify(harvest ? "Harvest: +" + std::to_string(harvest) + " food" : "Autumn ends with no harvest");
    }
    if (before.season != date.season) notify(std::string(seasonName(date.season)) + (date.season == Season::Spring ? " of year " + std::to_string(date.year) : "") + " begins");
    regrow();
    settleGuests();
    assignHomes();
    staff();
    grow();
    ++changes;  // Fields, attendance and the inspector.
}

Resources Town::capacity() const
{
    int room = 120;
    if (const auto* seat = camp()) room += seat->kind == Structure::Palisade ? 80 : seat->kind == Structure::Keep ? 160 : seat->kind == Structure::Castle ? 240 : 0;
    for (const auto& item : placed)
        if (item.built()) room += structureSpec(item.kind).storage;
    return {0, room, room, room, 0, room};
}

void Town::store(const Resources& gain)
{
    auto room = capacity();
    bool spoiled = false;
    auto keep = [&](int& stock, int add, int limit) {
        int before = stock;
        stock = std::max(before, std::min(before + add, limit));  // Never lose what is already kept.
        spoiled |= add > 0 && stock < before + add;
    };
    treasury.gold += gain.gold;
    treasury.mana += gain.mana;
    keep(treasury.wood, gain.wood, room.wood);
    keep(treasury.stone, gain.stone, room.stone);
    keep(treasury.food, gain.food, room.food);
    keep(treasury.water, gain.water, room.water);
    if (spoiled && spoiledDay != days) {
        spoiledDay = days;
        notify("The stores are full: build a storehouse");
    }
}

int Town::wageOf(const Person&) const { return 3; }

Town::Forecast Town::forecast() const
{
    Forecast day;
    for (const auto& p : folk) {
        if (p.role != Role::Resident) continue;
        // Those with a job or a watch draw a wage; renters of the settlement's homes pay rent.
        if (p.job >= 0) day.wages += wageOf(p);
        const auto* home = building(p.home);
        if (home && home->owner < 0) day.rent += rentOf(home->kind);
    }
    // Guests and bounties vary; yesterday's are the best guess.
    day.guests = yesterday.guests;
    day.bounty = yesterday.bounty;
    for (const auto& item : placed) day.made += dailyOutput(item);
    // About one and a half meals each a day until a day's eating has been seen.
    day.used.food = yesterday.eaten ? yesterday.eaten : int(std::lround(folk.size() * 1.4));
    day.used.water = int(folk.size());
    return day;
}

void Town::settleAccounts()
{
    constexpr float shift = float(secondsPerDay) * .12f;  // A share of the day that counts as a day's work.
    for (auto& p : folk) {
        if (p.role != Role::Resident) continue;
        p.unpaid = false;
        if (p.worked >= shift) {
            int wage = wageOf(p);
            if (treasury.gold >= wage) {
                treasury.gold -= wage;
                p.purse += wage;
                today.wages += wage;
            } else p.unpaid = true;
        }
        p.worked = 0;
        auto* home = site(p.home);
        if (!home || home->owner >= 0) continue;
        int rent = rentOf(home->kind);
        if (p.purse >= rent) {
            p.purse -= rent;
            treasury.gold += rent;
            today.rent += rent;
        } else p.unpaid = true;
        // Thrifty and settled residents buy their home; the settlement stops letting it.
        int price = priceOf(home->kind);
        if (price > 0 && p.purse >= price + 10 && p.stress < .6f) {
            p.purse -= price;
            treasury.gold += price;
            today.sales += price;
            home->owner = p.id;
            notify(p.name + " bought their " + structureSpec(home->kind).name + " for " + std::to_string(price) + " gold");
        }
    }
    yesterday = today;
    today = {};
}

bool Town::needMet(const Building& item, std::string& reason) const
{
    const auto& spec = structureSpec(item.kind);
    switch (spec.need) {
    case GrowthNeed::Food:
        reason = "Needs food in store";
        return treasury.food > 0;
    case GrowthNeed::Market:
        reason = "Needs a market within 8 paces";
        return near(item.center, 8, isMarket);
    case GrowthNeed::Workers:
        reason = "Needs " + std::to_string(spec.needAmount) + " workers";
        return item.workers >= spec.needAmount;
    case GrowthNeed::Population:
        reason = "Needs " + std::to_string(spec.needAmount) + " people";
        return population() >= spec.needAmount;
    case GrowthNeed::Merge:
        reason = "In a town of " + std::to_string(spec.needAmount) + ", merges with 3 mature townhouses huddled beside it";
        return population() >= spec.needAmount;
    case GrowthNeed::Occupancy: {
        int living = int(std::count_if(folk.begin(), folk.end(), [&](const Person& p) { return p.role == Role::Resident && p.home == item.id; }));
        reason = "Needs a full house (" + std::to_string(living) + "/" + std::to_string(spec.residents) + ") in a town of " + std::to_string(spec.needAmount);
        return living >= spec.residents && population() >= spec.needAmount;
    }
    case GrowthNeed::Income:
        reason = "Needs " + std::to_string(spec.needAmount) + " gold from guests (" + std::to_string(item.earned) + " so far)";
        return item.earned >= spec.needAmount;
    case GrowthNeed::Registry:
        reason = "Needs " + std::to_string(spec.needAmount) + " adventurers on its rolls (" + std::to_string(item.registered) + " so far)";
        return item.registered >= spec.needAmount;
    case GrowthNeed::None: return true;
    }
    return true;
}

GrowthStatus Town::growthStatus(const Building& item) const
{
    const auto& spec = structureSpec(item.kind);
    GrowthStatus status;
    if (spec.next == Structure::Count) return status;
    status.grows = true;
    status.next = structureSpec(spec.next).name;
    status.days = item.growth;
    status.needed = spec.growthDays;
    status.ready = needMet(item, status.reason);
    bool mature = item.growth >= spec.growthDays;
    if (status.ready && !roomToGrow(item, spec.next)) {
        status.ready = false;
        status.reason = "Needs clear ground around it to grow";
    } else if (status.ready && mature && !treasury.covers(spec.upgradeCost)) {
        status.ready = false;
        status.reason = "Waiting for " + describe(spec.upgradeCost);
    } else if (status.ready && !(mature && spec.need == GrowthNeed::Merge)) status.reason.clear();
    return status;
}

void Town::grow()
{
    std::vector<int> ids;
    for (const auto& item : placed) ids.push_back(item.id);
    for (int id : ids) {
        auto found = std::find_if(placed.begin(), placed.end(), [&](const Building& b) { return b.id == id; });
        if (found == placed.end()) continue;  // Merged away earlier this day.
        auto& item = *found;
        const auto& spec = structureSpec(item.kind);
        std::string reason;
        if (spec.next == Structure::Count || !item.built() || !needMet(item, reason)) continue;
        bool blessed = isHome(item.kind) && near(item.center, 6, isShrine);
        item.growth = std::min(spec.growthDays, item.growth + (blessed ? 2 : 1));
        if (item.growth < spec.growthDays || !treasury.covers(spec.upgradeCost)) continue;
        if (spec.need == GrowthNeed::Merge) {
            mergeManor(item);
            continue;
        }
        if (!roomToGrow(item, spec.next)) continue;
        treasury -= spec.upgradeCost;
        // A bigger stage keeps the same centre, so the old one sinks in the middle of the new footprint.
        float shift = (structureSpec(spec.next).size - spec.size) / 2.f;
        item.replaced = {{item.kind, item.variant, shift, shift}};
        item.kind = spec.next;
        item.growth = 0;
        item.earned = 0;
        ++item.version;
        item.workers = std::min(item.workers, structureSpec(item.kind).jobs);
        notify(std::string(spec.name) + " grew into a " + structureSpec(item.kind).name);
        ++changes;
    }
}

bool Town::mergeManor(const Building& seed)
{
    constexpr float huddle = 2.f;  // Largest gap between two of the four centres.
    const auto& spec = structureSpec(Structure::Townhouse);
    std::vector<const Building*> group{&seed};
    std::vector<const Building*> others;
    for (const auto& other : placed)
        if (&other != &seed && other.kind == Structure::Townhouse && other.growth >= spec.growthDays && distance(other.center, seed.center) <= huddle) others.push_back(&other);
    std::sort(others.begin(), others.end(), [&](const Building* a, const Building* b) { return distance(a->center, seed.center) < distance(b->center, seed.center); });
    for (const auto* other : others)
        if (group.size() < 4 && std::all_of(group.begin(), group.end(), [&](const Building* g) { return distance(g->center, other->center) <= huddle; })) group.push_back(other);
    if (group.size() < 4) return false;
    Point middle;
    for (const auto* item : group) middle = middle + item->center * .25f;
    float angle = seed.angle;
    float half = structureSpec(Structure::Manor).size / 2.f;
    Building manor{nextId++, Structure::Manor, middle, angle, uint32_t(hash01(world.seed(), int(middle.x * 8), int(middle.y * 8), 43) * 1e6f), 0, -1, 0, 0, {}, 1};
    std::vector<int> ids;
    for (const auto* item : group) {
        // Each old house sinks where it stood, in the manor's unturned frame.
        auto local = rotated(item->center - middle, -angle);
        manor.replaced.push_back({Structure::Townhouse, item->variant, local.x + half - .5f, local.y + half - .5f});
        ids.push_back(item->id);
    }
    placed.erase(std::remove_if(placed.begin(), placed.end(), [&](const Building& b) { return std::find(ids.begin(), ids.end(), b.id) != ids.end(); }), placed.end());
    for (auto& person : folk) {
        if (std::find(ids.begin(), ids.end(), person.home) != ids.end()) person.home = manor.id;
        if ((person.inside || person.doorway > 0) && person.activity != Activity::Exploring && person.activity != Activity::Expedition &&
            std::find(ids.begin(), ids.end(), person.target) != ids.end()) person.target = manor.id;
    }
    treasury -= spec.upgradeCost;
    placed.push_back(manor);
    notify("Four townhouses merged into a manor");
    ++changes;
    return true;
}
}  // namespace hearthold

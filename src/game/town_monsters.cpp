#include "town.h"
#include <algorithm>
#include <cmath>

namespace hearthold
{
namespace
{
Point lairOf(const Dungeon& site) { return {site.origin.x + 1.f, site.origin.y + 1.f}; }
Point entrance(const Dungeon& site) { return {site.origin.x + 1.f, site.origin.y + 2.3f}; }
// What comes out of each kind of lair: wolves are quick, skeletons tough, imps vicious, goblins in between.
struct Breed
{
    float health, bite, speed, pause;
};
Breed breedOf(DungeonKind kind)
{
    switch (kind) {
    case DungeonKind::Cave: return {4.5f, .055f, 1.45f, 1};
    case DungeonKind::Crypt: return {7, .045f, .9f, 1.3f};
    case DungeonKind::Portal: return {3.5f, .08f, 1.25f, .9f};
    case DungeonKind::Ruin: return {5.5f, .05f, 1.1f, 1};
    }
    return {6, .08f, 1, 1};
}

// The living do not stray onto a range, a glacier or lava, where they would be stranded; ground counts by
// tile, as the walk grid counts it. Raiders are left to cross what they must.
bool steps(const WorldMap& map, Point to)
{
    const auto* tile = map.cell(to);
    return tile && !impassable(tile->terrain);
}

float reachOf(const Person& p) { return p.calling == Calling::Ranger ? 3.f : p.calling == Calling::Mage ? 2.5f : .9f; }
float blowOf(const Person& p)
{
    switch (p.calling) {
    case Calling::Warrior: return 1.5f;
    case Calling::Mage: return 1.2f;
    case Calling::Ranger: return .9f;
    default: return 1.f;
    }
}
}  // namespace

float Town::power(const Person& p) const
{
    float base = 1;
    switch (p.calling) {
    case Calling::Warrior: base = 3; break;
    case Calling::Ranger: case Calling::Mage: base = 2.5f; break;
    case Calling::Cleric: base = 2; break;
    default: break;
    }
    float kit = 1 + .25f * p.gear;
    if (p.role == Role::Resident) kit *= (staffed(Structure::Weaponsmith) ? 1.2f : 1) * (staffed(Structure::Armorer) ? 1.1f : 1);
    return base * kit * (.4f + .6f * std::max(0.f, p.health)) * (1 - .5f * p.stress);
}

bool Town::raiding() const { return std::any_of(beasts.begin(), beasts.end(), [](const Monster& m) { return m.raider; }); }

void Town::summonRaid()
{
    const auto* fire = camp();
    if (!fire) return;
    int lair = -1;
    for (size_t d = 0; d < world.dungeons().size(); ++d)
        if (world.dungeons()[d].discovered && (lair < 0 || distance(lairOf(world.dungeons()[d]), fire->center) < distance(lairOf(world.dungeons()[size_t(lair)]), fire->center))) lair = int(d);
    if (lair < 0) return;
    const auto& site = world.dungeons()[size_t(lair)];
    // Raids grow with the settlement's age: more of them, and hardier.
    int prowling = int(std::count_if(beasts.begin(), beasts.end(), [](const Monster& m) { return m.raider; }));
    int count = std::min({10, 2 + days / 8, maxRaiders - prowling});
    if (count <= 0) return;
    for (int i = 0; i < count; ++i) {
        Monster beast{nextMonster++, lair, grid.nearestWalkable(entrance(site) + rotated({.6f, 0}, i * 1.3f)), {}};
        beast.raider = true;
        beast.health = breedOf(site.kind).health * (1 + days / 80.f);
        beast.path = grid.path(beast.position, fire->door());
        beasts.push_back(std::move(beast));
    }
    ++raidCount;
    notify("Monsters from " + site.name + " raid the settlement!");
}

bool Town::sendExpedition(const std::vector<int>& ids, int dungeon)
{
    if (!canSendExpedition(ids, dungeon).ok) return false;
    Expedition party{dungeon, {}};
    for (auto& p : folk) {
        if (p.role != Role::Resident || p.activity == Activity::Expedition || std::find(ids.begin(), ids.end(), p.id) == ids.end()) continue;
        if (!walkTo(p, entrance(world.dungeons()[size_t(dungeon)]))) continue;
        p.activity = Activity::Expedition;
        p.target = dungeon;
        p.ordered = false;
        p.task = Activity::Idle;
        party.members.push_back(p.id);
    }
    if (party.members.empty()) return false;
    parties.push_back(party);
    notify(std::to_string(party.members.size()) + " set out for " + world.dungeons()[size_t(dungeon)].name);
    ++changes;
    return true;
}

Check Town::canSendExpedition(const std::vector<int>& ids, int dungeon) const
{
    Check check;
    if (dungeon < 0 || size_t(dungeon) >= world.dungeons().size() || !world.dungeons()[size_t(dungeon)].discovered) {
        check.reason = "No known dungeon there";
        return check;
    }
    bool any = std::any_of(folk.begin(), folk.end(), [&](const Person& p) {
        return p.role == Role::Resident && p.activity != Activity::Expedition && std::find(ids.begin(), ids.end(), p.id) != ids.end();
    });
    if (!any) {
        check.reason = "Select residents to send";
        return check;
    }
    check.ok = true;
    return check;
}

void Town::returnFrom(Expedition& party)
{
    const auto& site = world.dungeons()[size_t(party.dungeon)];
    if (depth.size() < world.dungeons().size()) depth.resize(world.dungeons().size(), 0);
    float danger = 5 + float(site.kind) + depth[size_t(party.dungeon)] * 2;
    if (const auto* fire = camp()) danger += distance(lairOf(site), fire->center) / 25;
    float strength = 0;
    for (int id : party.members)
        if (const auto* p = person(id)) strength += power(*p);
    bool won = strength * (.6f + roll() * .8f) >= danger;
    std::string outcome;
    if (won) {
        Resources loot{int(12 * danger), 0, int(2 * danger), 0, site.kind == DungeonKind::Portal || site.kind == DungeonKind::Crypt ? int(3 * danger) : 0};
        treasury += loot;
        ++depth[size_t(party.dungeon)];
        outcome = "The expedition returns from " + site.name + " with " + describe(loot);
    } else outcome = "The expedition is driven out of " + site.name;
    notify(outcome);
    for (auto& p : folk) {
        if (std::find(party.members.begin(), party.members.end(), p.id) == party.members.end()) continue;
        p.health -= (won ? roll() * .25f : .3f + roll() * .4f) * (staffed(Structure::Apothecary) ? .6f : 1);
        p.stress = std::min(1.f, p.stress + (won ? .05f : .25f));
        p.inside = false;
        p.activity = Activity::Idle;
        p.until = time;
        if (p.health <= 0) {
            notify(p.name + " fell in " + site.name);
            p.activity = Activity::Leaving;
            p.health = -1;
        }
    }
    party.members.clear();
}

int Town::monsterAt(Point p, float reach) const
{
    int best = -1;
    for (const auto& beast : beasts)
        if (distance(beast.position, p) <= reach && (best < 0 || distance(beast.position, p) < distance(beasts[size_t(best)].position, p))) best = int(&beast - &beasts[0]);
    return best < 0 ? -1 : beasts[size_t(best)].id;
}

void Town::strike(Person& p, Monster& foe)
{
    float blow = blowOf(p) * (1 + .25f * p.gear);
    if (p.role == Role::Resident && staffed(Structure::Weaponsmith)) blow *= 1.4f;
    foe.health -= blow;
    if (!foe.raider) foe.angry = true;  // A struck prowler fights back.
    p.ready = time + 1;
    bool ranged = p.calling == Calling::Ranger || p.calling == Calling::Mage;
    blows.push_back({nextBlow++, p.position, foe.position, int(std::lround(blow * 10)), false, ranged, time, p.id});
}

void Town::fight(Person& p, double dt)
{
    if (p.activity == Activity::Expedition || p.activity == Activity::Leaving || p.crossingDoorway()) return;
    if (p.approachingOrder) { p.foe = -1; return; }
    const bool commanded = p.ordered || p.task != Activity::Idle;
    if (p.ordered && p.task == Activity::Moving && !p.aggressive) { p.foe = -1; return; }
    if (p.role == Role::Resident && !p.autoMode && !commanded) { p.foe = -1; return; }
    if (p.foe >= 0) {
        auto chosen = std::find_if(beasts.begin(), beasts.end(), [&](const Monster& m) { return m.id == p.foe; });
        if (chosen == beasts.end() || chosen->health <= 0) {
            p.foe = -1;  // Slain or gone; back to normal life.
            p.activity = Activity::Idle;
            p.until = time;
            return;
        }
        float gap = distance(chosen->position, p.position);
        if (gap > reachOf(p)) {
            auto next = p.position + normalized(chosen->position - p.position) * std::min(gap, 1.6f * float(dt));
            if (!steps(world, next)) {
                p.foe = -1;  // No way across: the order lapses.
                p.activity = Activity::Idle;
                p.until = time;
                return;
            }
            p.position = next;
        } else if (time >= p.ready) strike(p, *chosen);
        p.activity = Activity::Fighting;
        return;
    }
    // Adventurers fight on their own. Other residents take up arms alongside fighters, or
    // against a raid small enough to beat; otherwise they bar the doors. Travellers and the weak hide.
    bool raid = raiding();
    bool fighter = commanded || ((p.autoMode || p.role == Role::Guest) && adventurer(p));
    int raiders = int(std::count_if(beasts.begin(), beasts.end(), [](const Monster& m) { return m.raider; }));
    bool backed = std::any_of(folk.begin(), folk.end(), [](const Person& o) { return (o.autoMode || o.role == Role::Guest) && adventurer(o); });
    // Raiders never leave on their own: a town that outnumbers them two to one rallies regardless.
    int able = int(std::count_if(folk.begin(), folk.end(), [](const Person& o) { return o.role == Role::Resident && o.health > .35f && o.stress < .9f; }));
    backed |= raid && able >= 2 * raiders;
    bool armed = fighter || (p.role == Role::Resident && p.health > .35f && p.stress < .9f && (!raid || backed || raiders <= 2));
    // Adventurers turn out for raids; other residents react when raiders come near.
    bool near = std::any_of(beasts.begin(), beasts.end(), [&](const Monster& m) { return m.raider && distance(m.position, p.position) < 10; });
    if (raid && armed && p.inside && (commanded || near)) {
        p.inside = false;  // Out of bed and into the street.
        p.activity = Activity::Idle;
        return;
    }
    if (p.inside) return;
    float notice = commanded ? 6.f : !armed ? 5.f : p.role == Role::Guest ? 8.f : raid ? 10.f : 5.f;
    if (p.aggressive) notice = std::max(notice, 6.f);  // Attack-moving: take on whatever comes near.
    Monster* foe = nullptr;
    for (auto& beast : beasts) {
        float gap = distance(beast.position, p.position);
        bool threat = commanded || beast.raider || beast.angry || gap < 2.5f;
        // Not one across ground nobody can walk: they would only stand at its edge.
        bool approachable = gap <= reachOf(p) || steps(world, p.position + normalized(beast.position - p.position) * std::min(gap, .6f));
        if (beast.health > 0 && world.revealed(beast.position) && threat && approachable && gap <= notice && (!foe || gap < distance(foe->position, p.position))) foe = &beast;
    }
    if (!foe) {
        if (p.activity == Activity::Fighting) {
            p.activity = Activity::Idle;
            p.until = time;
        }
        return;
    }
    if (!armed) {
        if (p.activity == Activity::Sleeping && p.moving()) return;
        const auto* shelter = building(p.role == Role::Resident ? p.home : p.bed);
        if (!shelter) shelter = camp();
        if (shelter && shelter->built()) {
            if (walkTo(p, shelter->door())) {
                p.activity = Activity::Sleeping;
                p.target = shelter->id;
            }
        }
        return;
    }
    p.activity = Activity::Fighting;
    p.path.clear();
    float gap = distance(foe->position, p.position);
    if (gap > reachOf(p)) {
        auto next = p.position + normalized(foe->position - p.position) * std::min(gap, 1.6f * float(dt));
        if (steps(world, next)) p.position = next;
    } else if (time >= p.ready) strike(p, *foe);
}

void Town::releaseMonster(Point at)
{
    int lair = 0;
    for (size_t d = 1; d < world.dungeons().size(); ++d)
        if (distance(lairOf(world.dungeons()[d]), at) < distance(lairOf(world.dungeons()[size_t(lair)]), at)) lair = int(d);
    if (world.dungeons().empty()) return;
    Monster beast{nextMonster++, lair, grid.nearestWalkable(at), {}};
    beast.health = breedOf(world.dungeons()[size_t(lair)].kind).health * (1 + days / 80.f);
    beast.home = beast.position;
    beasts.push_back(std::move(beast));
}

void Town::hurtGuest(const Person& p, bool killed)
{
    if (p.role != Role::Guest) return;
    // Word travels: a guest mauled here is a story told on every road.
    fame = std::max(0.f, fame - (killed ? 8.f : .4f));
    if (killed) notify("A guest was killed: the settlement's renown suffers");
}

void Town::wreck(Monster& beast, double dt)
{
    auto breed = breedOf(world.dungeons()[size_t(beast.lair)].kind);
    // Roads underfoot are torn up as monsters go; cobbles hold out longer.
    int lane = -1;
    if (network.distance(beast.position, nullptr, &lane) < .6f && lane >= 0)
        if (auto* road = network.road(lane); road && road->built >= 1 && road->wear < 1) {
            road->wear = std::min(1.f, road->wear + float(dt) * (road->paved ? .012f : .025f));
            if (road->wear >= 1) {
                notify(road->paved ? "Monsters tore up a paved road" : "Monsters tore up a road");
                roadChanged();
            }
        }
    if (time < beast.ready) return;
    for (auto& item : placed) {
        if (!item.footprint().contains(beast.position, .7f)) continue;
        float blow = breed.bite * .25f;
        beast.ready = time + breed.pause;
        blows.push_back({nextBlow++, beast.position, item.center, std::max(1, int(std::lround(blow * 100))), true, false, time});
        if (!item.built()) {
            item.progress -= blow;
            if (item.progress <= 0) {
                notify(std::string("Monsters wrecked the ") + structureSpec(item.kind).name + " site");
                raze(item.id);
            }
            return;
        }
        item.health -= blow;
        // The seat holds, battered; anything else falls.
        if (isSeat(item.kind) && item.health < .1f) item.health = .1f;
        else if (item.health <= 0) {
            notify(std::string("Monsters destroyed the ") + structureSpec(item.kind).name);
            raze(item.id);
        }
        return;
    }
}

void Town::stir(double dt)
{
    blows.erase(std::remove_if(blows.begin(), blows.end(), [&](const Hit& h) { return time - h.at > 2; }), blows.end());
    const auto* fire = camp();
    // Now and then a monster strays out of the wilds, more as the years go by. Lairs keep theirs
    // inside: what comes out of a dungeon comes as a raid.
    int roaming = int(std::count_if(beasts.begin(), beasts.end(), [](const Monster& m) { return !m.raider; }));
    if (fire && days >= 1 && roaming < std::min(8, 2 + days / 6) && roll() < dt / secondsPerDay * 1.5) {
        for (int attempt = 0; attempt < 12; ++attempt) {
            Point at = fire->center + rotated({16 + roll() * 24, 0}, roll() * 6.2832f);
            int x = int(std::floor(at.x)), y = int(std::floor(at.y));
            if (!world.inside(x, y) || !grid.walkable(at)) continue;
            releaseMonster(at);
            break;
        }
    }
    // Once the camp stands, every nightfall brings a raid, joining any pack still prowling.
    if (fire && fire->built() && dayFraction() > .5f && climate().night > .6f && raidedDay != days) {
        raidedDay = days;
        summonRaid();
    }
    bool raidOn = raiding();
    for (auto& beast : beasts) {
        auto breed = breedOf(world.dungeons()[size_t(beast.lair)].kind);
        // Hunt the nearest person caught outdoors; a raider smells them from far, a wanderer only
        // close by, or further once struck.
        Person* prey = nullptr;
        float scent = beast.raider ? 9 : beast.angry ? 7 : 4;
        for (auto& p : folk)
            if (!p.inside && p.health > 0 && distance(p.position, beast.position) < scent && (!prey || distance(p.position, beast.position) < distance(prey->position, beast.position))) prey = &p;
        if (prey) {
            float gap = distance(prey->position, beast.position);
            beast.path.clear();
            beast.prey = -1;
            if (gap > .7f) {
                auto next = beast.position + normalized(prey->position - beast.position) * std::min(gap, breed.speed * .8f * float(dt));
                // Nothing goes through Ymir, not even a raider in full cry: it edges round his stone.
                auto stone = [&](Point at) { return world.giant() && world.giant()->covers(at); };
                if (beast.raider && stone(next))
                    for (float turn : {.785f, 1.571f, -.785f, -1.571f})
                        if (auto round = beast.position + rotated(next - beast.position, turn); !stone(round)) { next = round; break; }
                if ((beast.raider && !stone(next)) || steps(world, next)) beast.position = next;  // A wanderer holds at the edge.
            }
            else if (time >= beast.ready) {
                float bite = breed.bite * (prey->calling == Calling::Warrior ? .6f : 1);
                if (prey->role == Role::Resident && staffed(Structure::Armorer)) bite *= .6f;
                bite /= 1 + .3f * prey->gear;
                prey->health -= bite;
                blows.push_back({nextBlow++, beast.position, prey->position, std::max(1, int(std::lround(bite * 100))), true, false, time, prey->id});
                prey->stress = std::min(1.f, prey->stress + .03f);
                beast.ready = time + breed.pause;
                hurtGuest(*prey, prey->health <= 0);
                if (prey->health <= 0) {
                    notify(prey->name + " was killed by monsters");
                    prey->activity = Activity::Leaving;
                    prey->health = -1;
                }
            }
            continue;
        }
        beast.angry = false;
        if (beast.raider) {
            // Nobody outdoors: on to the nearest building, to tear it down.
            const Building* target = nullptr;
            for (const auto& item : placed)
                if (!target || distance(item.center, beast.position) < distance(target->center, beast.position)) target = &item;
            if (target && (beast.prey != target->id || beast.path.empty()) && !target->footprint().contains(beast.position, .7f)) {
                beast.prey = target->id;
                beast.path = grid.path(beast.position, target->door());
                if (beast.path.empty()) beast.path = {target->door()};
            }
        } else if (beast.path.empty() && roll() < dt * .3) {
            beast.path = {grid.nearestWalkable(beast.home + rotated({1.5f + roll() * 4, 0}, roll() * 6.2832f))};
        }
        wreck(beast, dt);
        // Walk the path.
        float step = (beast.raider ? breed.speed * .8f : .5f) * float(dt);
        while (step > 0 && !beast.path.empty()) {
            float gap = distance(beast.position, beast.path.front());
            auto next = gap <= step ? beast.path.front() : beast.position + (beast.path.front() - beast.position) * (step / gap);
            if (!beast.raider && !steps(world, next)) {
                beast.path.clear();  // A wanderer's stroll ends at the edge.
                break;
            }
            beast.position = next;
            if (gap <= step) {
                beast.path.erase(beast.path.begin());
                step -= gap;
            } else step = 0;
        }
    }
    // The fallen leave the field, each worth a bounty. Raiders never turn back: the raid ends when the last one falls.
    for (const auto& beast : beasts) {
        if (beast.health > 0) continue;
        int bounty = int(std::lround(breedOf(world.dungeons()[size_t(beast.lair)].kind).health * (beast.raider ? 1.5f : 1.2f)));
        treasury.gold += bounty;
        today.bounty += bounty;
        raidBounty += beast.raider ? bounty : 0;
        if (beast.raider) ++raidKills;
        else notify("A monster is slain (+" + std::to_string(bounty) + " gold)");
    }
    beasts.erase(std::remove_if(beasts.begin(), beasts.end(), [](const Monster& m) { return m.health <= 0; }), beasts.end());
    if (raidOn && !raiding()) {
        notify("The raid is beaten off (" + std::to_string(raidKills) + " slain, +" + std::to_string(raidBounty) + " gold)");
        raidKills = raidBounty = 0;
    }
    // Expeditions come back once the whole party has been inside long enough.
    for (auto& party : parties) {
        party.members.erase(std::remove_if(party.members.begin(), party.members.end(), [&](int id) { return !person(id); }), party.members.end());
        if (party.members.empty()) continue;
        bool inside = std::all_of(party.members.begin(), party.members.end(), [&](int id) { return person(id)->inside; });
        if (inside && party.returnAt < 0) party.returnAt = time + secondsPerDay * .5;
        if (party.returnAt > 0 && time >= party.returnAt) returnFrom(party);
    }
    parties.erase(std::remove_if(parties.begin(), parties.end(), [](const Expedition& e) { return e.members.empty(); }), parties.end());
}
}  // namespace hearthold

#include "town.h"
#include "character_preset.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <limits>

namespace hearthold
{
bool Town::customizePerson(int id, const CharacterPreset& preset)
{
    for (auto& person : folk)
        if (person.id == id) return applyCharacter(person, preset);
    return false;
}

namespace
{
// Where roadwork stands: the end of what is laid or paved, or the middle of a road being mended.
Point workFront(const Road& road)
{
    return road.workPoint();
}

constexpr std::array<const char*, 20> humanNames{{
    "Arnbjorn", "Bera", "Dagny", "Eyvind", "Finna", "Geirmund", "Hauk", "Hallbera", "Hild", "Ingjald",
    "Jorun", "Kolbein", "Ottar", "Orm", "Rannveig", "Sigrid", "Skeggi", "Steinar", "Thorhild", "Vigdis",
}};
constexpr std::array<const char*, 12> godNames{{"Baldr", "Idunn", "Tyr", "Eir", "Vidar", "Sif", "Forseti", "Nanna", "Bragi", "Syn", "Ullr", "Fulla"}};
constexpr float builderLimit = 3;

bool isTavern(const Building& b) { return b.built() && b.kind == Structure::Tavern; }
Point dungeonDoor(const Dungeon& site) { return {site.origin.x + 1.f, site.origin.y + 2.3f}; }

void enter(Person& person, Point threshold)
{
    person.entrance = person.position;
    person.threshold = threshold;
    person.doorway = 0;
    person.inside = true;
}
}  // namespace

const char* callingName(Calling calling)
{
    switch (calling) {
    case Calling::Settler: return "Settler";
    case Calling::Traveller: return "Traveller";
    case Calling::Warrior: return "Warrior";
    case Calling::Ranger: return "Ranger";
    case Calling::Mage: return "Mage";
    case Calling::Cleric: return "Cleric";
    case Calling::Bard: return "Bard";
    }
    return "";
}

const char* activityName(Activity activity)
{
    switch (activity) {
    case Activity::Idle: return "Idle";
    case Activity::Moving: return "Moving on orders";
    case Activity::Holding: return "Holding position";
    case Activity::Building: return "Building";
    case Activity::Roadwork: return "Working on a road";
    case Activity::Working: return "Working";
    case Activity::Eating: return "Eating";
    case Activity::Sleeping: return "Sleeping";
    case Activity::Relaxing: return "Relaxing at the tavern";
    case Activity::Exploring: return "Delving the dungeon";
    case Activity::Brooding: return "Brooding";
    case Activity::Arriving: return "Arriving";
    case Activity::Leaving: return "Leaving";
    case Activity::Guarding: return "On watch";
    case Activity::Praying: return "Praying at the chapel";
    case Activity::Shopping: return "Buying gear";
    case Activity::Hauling: return "Carrying goods";
    case Activity::Felling: return "Felling a tree";
    case Activity::Collecting: return "Collecting resources";
    case Activity::Mining: return "Mining stone";
    case Activity::Fighting: return "Fighting";
    case Activity::Expedition: return "On an expedition";
    }
    return "";
}

float Town::roll()
{
    dice ^= dice << 13;
    dice ^= dice >> 17;
    dice ^= dice << 5;
    return float(dice >> 8) / float(1u << 24);
}

Person Town::makePerson(Role role, Calling calling, Point at)
{
    // Species is world metadata. Faith, calling and visual assets do not select a species.
    Race race = roll() < .08f ? Race::God : Race::Human;
    auto name = [&](const auto& list) { return std::string(list[size_t(roll() * list.size()) % list.size()]); };
    std::string called = race == Race::God ? name(godNames) : name(humanNames);
    Person person{nextPerson++, called, role, calling, race, uint32_t(roll() * 1e6f), at, {}};
    person.faith = Faith(person.look%int(Faith::Count));
    person.purse = 10;
    return person;
}

bool Town::workHours() const
{
    // Daylight, so winter's short days are short working days too.
    return climate().night < .2f;
}

const Building* Town::nearest(Point from, bool (*match)(const Building&)) const
{
    const Building* best = nullptr;
    for (const auto& item : placed)
        if (match(item) && (!best || distance(item.center, from) < distance(best->center, from))) best = &item;
    return best;
}

Building* Town::site(int id)
{
    for (auto& item : placed)
        if (item.id == id) return &item;
    return nullptr;
}

bool Town::walkTo(Person& p, Point to)
{
    refreshShelter(p);
    Point from = p.inside || p.doorway > 0 ? p.entrance : p.position;
    auto path = grid.path(from, to);
    if (path.empty()) return false;
    p.path.assign(path.begin() + 1, path.end());
    p.inside = false;
    return true;
}

void Town::refreshShelter(Person& p)
{
    if (!p.inside || p.doorway < 1 || p.activity == Activity::Exploring || p.activity == Activity::Expedition) return;
    if (const auto* place = building(p.target)) {
        p.entrance = place->door();
        p.threshold = p.position = place->threshold();
    }
}

float Town::walkingSpeed(const Person& p) const
{
    float speed = grid.speedAt(p.position);
    speed *= 1 - .35f * climate().snow;
    if (p.health < .4f) speed *= .7f;
    return speed;
}

void Town::walk(Person& p, double dt)
{
    float step = walkingSpeed(p) * float(dt);
    while (step > 0 && !p.path.empty()) {
        auto next = p.path.front();
        float gap = distance(p.position, next);
        if (gap <= step) {
            p.position = next;
            p.path.erase(p.path.begin());
            step -= gap;
        } else {
            p.position = p.position + (next - p.position) * (step / gap);
            step = 0;
        }
    }
}

Point Town::gateway() const
{
    // Newcomers walk in along the road that reaches farthest from the camp, else from the wilds.
    Point from = camp() ? camp()->center : world.camp();
    Point best = from;
    for (const auto& road : network.roads())
        for (auto end : {road.line.front(), road.line.back()})
            if (distance(end, from) > distance(best, from)) best = end;
    if (distance(best, from) > 6) return best;
    // Toward the middle of the map if a walker can get there from the camp, else the first heading
    // round from it that can be reached: Ymir, the rivers and the ranges cut much of the land off.
    Point door = camp() ? camp()->door() : from;
    Point middle{world.width() / 2.f, world.height() / 2.f};
    float heading = std::atan2(middle.y - from.y, middle.x - from.x);
    for (int turn = 0; turn < 12; ++turn) {
        auto at = grid.nearestWalkable(from + rotated({14, 0}, heading + turn * 0.5235988f));
        if (!grid.path(door, at).empty()) return at;
    }
    return door;
}

void Town::assignHomes()
{
    auto accepts = [](Structure kind, Role role) { return role == Role::Resident ? isHome(kind) : isLodging(kind); };
    auto room = [&](const Building& home, Role role) {
        int used = 0;
        for (const auto& p : folk) used += role == Role::Resident ? p.home == home.id : p.bed == home.id;
        return role == Role::Resident ? structureSpec(home.kind).residents - used : structureSpec(home.kind).beds - used;
    };
    for (auto& p : folk) {
        int& slot = p.role == Role::Resident ? p.home : p.bed;
        const auto* current = building(slot);
        // Keep a valid home, including the camp, until it becomes unavailable.
        if (current && current->built() && accepts(current->kind, p.role)) continue;
        const Building* best = nullptr;
        for (const auto& item : placed) {
            if (!item.built() || !accepts(item.kind, p.role) || room(item, p.role) <= 0 || (p.role == Role::Resident && isSeat(item.kind))) continue;
            if (!best || distance(item.center, p.position) < distance(best->center, p.position)) best = &item;
        }
        if (best) slot = best->id;
        else {
            slot = -1;
            if (p.role == Role::Resident)
                if (const auto* seat = camp(); seat && seat->built() && room(*seat, Role::Resident) > 0) slot = seat->id;
        }
    }
}

bool Town::bardPlaying() const
{
    return std::any_of(folk.begin(), folk.end(), [](const Person& p) {
        return p.calling == Calling::Bard && p.health > 0 && p.activity != Activity::Leaving && p.activity != Activity::Expedition;
    });
}

void Town::admitGuests(double dt)
{
    const auto* fire = camp();
    if (!fire || !fire->built() || raiding()) return;
    bool portal = std::any_of(placed.begin(), placed.end(), [](const Building& b) { return b.kind == Structure::Portal && b.built(); });
    const auto* gate = portal ? nearest(fire->center, [](const Building& b) { return b.kind == Structure::Portal && b.built(); }) : nullptr;
    // Word of a tavern without a bard travels fast: one comes within the day, needing no bed for hire.
    if (!nearest(fire->center, isTavern) || bardPlaying()) bardDue = -1;
    else if (bardDue < 0) bardDue = time + secondsPerDay * (.15 + roll() * .2);
    else if (time >= bardDue && int(folk.size()) < maxPeople) {
        bardDue = -1;
        welcome(Calling::Bard, gate);
    }
    arrivalTimer -= dt / secondsPerDay;
    if (arrivalTimer > 0) return;
    bool dungeonOpen = std::any_of(open.begin(), open.end(), [](uint8_t o) { return o != 0; });
    bool hall = std::any_of(placed.begin(), placed.end(), [](const Building& b) { return b.kind == Structure::GuildHall && b.built(); });
    arrivalTimer = dungeonOpen ? (.45 + roll() * .6) * (hall ? .5 : 1) : 1.8 + roll() * 1.6;
    // Renown speeds them up or holds them off; a portal brings folk from far lands besides.
    arrivalTimer *= (1.5 - fame / 100) * (portal ? .55 : 1);
    if (int(folk.size()) >= maxPeople || guests() >= guestBeds() + 2) return;
    // Travellers come only where there are beds for hire; adventurers only where a guild opened a dungeon.
    bool lodging = std::any_of(placed.begin(), placed.end(), [](const Building& b) { return b.built() && isLodging(b.kind); });
    if (!lodging && !dungeonOpen) return;
    Calling calling = Calling::Traveller;
    if (dungeonOpen && (!lodging || roll() < .75f)) calling = Calling(int(Calling::Warrior) + int(roll() * 4) % 4);
    welcome(calling, gate);
}

void Town::welcome(Calling calling, const Building* gate)
{
    auto guest = makePerson(Role::Guest, calling, gate ? gate->door() : gateway());
    if (gate) {
        enter(guest, gate->threshold());
        guest.doorway = 1;
        guest.position = guest.threshold;
    }
    bool fighter = adventurer(guest);
    guest.food = .9f;
    guest.purse = (fighter ? 25 + int(roll() * 25) : 15 + int(roll() * 20)) + (gate ? 10 : 0);
    guest.activity = Activity::Arriving;
    // A toll at the gate: every visitor pays to come in.
    charge(guest, nullptr, fighter ? 5 : 3);
    // A bard makes for the tavern to play; everyone else for a bed.
    const auto* stop = calling == Calling::Bard ? nearest(guest.position, isTavern) : nearest(guest.position, [](const Building& b) { return b.built() && isLodging(b.kind); });
    if (!stop) stop = camp();
    walkTo(guest, stop->door());
    if (fighter)
        for (auto& item : placed)
            if ((item.kind == Structure::Guild || item.kind == Structure::GuildHall) && item.built()) {
                ++item.registered;  // Signs the guild's rolls.
                break;
            }
    std::string what = calling == Calling::Traveller ? "a traveller" : calling == Calling::Bard ? "a bard" : std::string("an adventurer (") + callingName(calling) + ")";
    notify(guest.name + ", " + what + ", arrives" + (gate ? " through the portal" : "") + (calling == Calling::Bard ? " to play at the tavern" : ""));
    folk.push_back(std::move(guest));
    assignHomes();
    ++changes;
}

void Town::settleGuests()
{
    for (auto& p : folk) {
        if (p.role != Role::Guest || p.activity == Activity::Leaving) continue;
        int patience = p.calling == Calling::Traveller ? 2 : 3;
        // Newcomers stay only where a home is free and the granary can feed one more.
        if (p.days < patience || p.stress > .45f || p.health < .5f || population() >= housing() || treasury.food < (population() + 1) * 4) continue;
        int fee = naturalize(p);
        notify(p.name + " the " + callingName(p.calling) + " settles down here" + (fee ? " (+" + std::to_string(fee) + " gold)" : ""));
        assignHomes();
    }
}

int Town::naturalize(Person& p)
{
    // Settling costs a fee for the land and the rolls, out of what they brought.
    int fee = std::min(p.purse, 10);
    charge(p, nullptr, fee);
    p.role = Role::Resident;
    p.bed = -1;
    enforceGuestLodging(p);
    if (p.calling == Calling::Traveller) p.calling = Calling::Settler;  // No longer passing through.
    return fee;
}

void Town::bestow(int id, int gold)
{
    for (auto& p : folk)
        if (p.id == id) p.purse += gold;
}

void Town::recruit(Role role, Calling calling, int count)
{
    Point at = camp() ? camp()->door() : world.camp();
    for (int i = 0; i < count; ++i) folk.push_back(makePerson(role, calling, grid.nearestWalkable(at + rotated({.7f, 0}, i * 1.3f))));
    assignHomes();
    staff();
    ++changes;
}

bool Town::settle(int id)
{
    for (auto& p : folk)
        if (p.id == id && p.role == Role::Guest && population() < housing()) {
            naturalize(p);
            assignHomes();
            ++changes;
            return true;
        }
    return false;
}

void Town::think(Person& p)
{
    if (p.role == Role::Resident && !p.autoMode && p.task == Activity::Idle && !p.ordered) {
        p.activity = Activity::Holding; p.path.clear(); p.until = std::numeric_limits<double>::infinity();
        return;
    }
    p.target = -1;
    p.tree = -1;
    if (p.ordered && (p.task == Activity::Moving || p.task == Activity::Holding) && distance(p.position, p.goal) > .2f) {
        resumeOrder(p); return;
    }
    auto start = [&](Activity activity, const Building* place, Point at) {
        if (!walkTo(p, at)) {
            p.activity = Activity::Idle;
            p.until = time + 3;
            return false;
        }
        p.activity = activity;
        p.target = place ? place->id : -1;
        return true;
    };
    if (p.role == Role::Guest) {
        bool done = p.calling == Calling::Traveller ? p.days >= 4 : p.days >= 8;
        if (p.stress > .9f || p.health < .3f || done) {
            notify(p.name + (done ? " moves on" : " leaves, unhappy"));
            fame = std::clamp(fame + (done ? 1.5f : -2.f), 0.f, 100.f);  // What they tell on the road.
            start(Activity::Leaving, nullptr, gateway());
            return;
        }
    } else if (p.autoMode && p.breaking > .5f) {
        notify(p.name + " could not bear it any longer and left");
        start(Activity::Leaving, nullptr, gateway());
        return;
    }
    if (takeBreak(p)) return;
    if (resumeOrder(p)) return;
    if (p.food < .35f && treasury.food > 0 && eat(p)) return;
    if (p.carrying > 0) {
        if (!haulCargo(p)) { p.activity = Activity::Idle; p.until = time + 2; }
        return;
    }
    // The faithful pray when troubled, at a chapel of their people's faith if there is one.
    if (p.stress > .35f && time - p.prayedAt > secondsPerDay * .5) {
        const Building* chapel = nullptr;
        for (const auto& item : placed)
            if (item.kind == Structure::Chapel && item.built() && (!chapel || (int(item.faith) == int(p.faith) && int(chapel->faith) != int(p.faith)))) chapel = &item;
        if (chapel && (int(chapel->faith) == int(p.faith) || p.stress > .55f) && start(Activity::Praying, chapel, chapel->door())) return;
    }
    // Adventurers spend their loot on kit.
    if (p.role == Role::Guest && adventurer(p) && p.purse >= 12 && p.loot > 0 && p.gear < 3) {
        const Building* shop = nullptr;
        for (const auto& item : placed)
            if (isOutfitter(item.kind) && item.built() && item.workers > 0 && (!shop || distance(item.center, p.position) < distance(shop->center, p.position))) shop = &item;
        if (shop && start(Activity::Shopping, shop, shop->door())) return;
    }
    const auto* tavern = nearest(p.position, [](const Building& b) { return b.built() && b.kind == Structure::Tavern; });
    if (tavern && p.stress > .5f && time - p.relaxedAt > secondsPerDay * .5) {
        start(Activity::Relaxing, tavern, tavern->door());
        return;
    }
    if (p.role == Role::Resident) {
        // Construction comes first: the nearest building site or unfinished road with room for hands.
        Building* best = nullptr;
        for (auto& item : placed) {
            if (item.built() && item.health >= 1) continue;  // Sites, and buildings monsters damaged.
            int builders = int(std::count_if(folk.begin(), folk.end(), [&](const Person& o) { return o.activity == Activity::Building && o.target == item.id; }));
            if (builders < builderLimit && (!best || distance(item.center, p.position) < distance(best->center, p.position))) best = &item;
        }
        const Road* lane = nullptr;
        for (const auto& road : network.roads()) {
            if (road.built >= 1 && road.paving < 0 && road.wear <= 0) continue;
            if (!roadReady(road.id)) continue;
            int crew = int(std::count_if(folk.begin(), folk.end(), [&](const Person& o) { return o.activity == Activity::Roadwork && o.target == road.id; }));
            if (crew < 2 && (!lane || distance(workFront(road), p.position) < distance(workFront(*lane), p.position))) lane = &road;
        }
        auto laneFront = lane ? workFront(*lane) : Point{};
        if (lane && (!best || distance(laneFront, p.position) < distance(best->center, p.position))) {
            p.activity = Activity::Roadwork; p.target = lane->id;
            if (walkTo(p, laneFront)) return;
        }
        const auto* job = building(p.job);
        if (best && (layRoadFirst(p, best->id) || start(Activity::Building, best, best->door()))) return;
        if (job && job->built() && start(Activity::Working, job, job->door())) return;
        if (p.job < 0 && p.task == Activity::Idle && !p.ordered && startHarvest(p, p.position, woodcutting::searchRadius)) return;
    }
    if (p.role == Role::Guest && adventurer(p) && workHours() && p.health > .5f) {
        int pick = -1;
        for (size_t d = 0; d < open.size(); ++d)
            if (open[d] && (pick < 0 || distance(dungeonDoor(world.dungeons()[d]), p.position) < distance(dungeonDoor(world.dungeons()[size_t(pick)]), p.position))) pick = int(d);
        if (pick >= 0) {
            p.activity = Activity::Exploring;
            p.target = pick;
            if (walkTo(p, dungeonDoor(world.dungeons()[size_t(pick)]))) return;
        }
    }
    if (p.role == Role::Guest && tavern && p.stress > .25f && time - p.relaxedAt > secondsPerDay * .5) {
        start(Activity::Relaxing, tavern, tavern->door());
        return;
    }
    if (p.role == Role::Resident) {
        const auto* home = building(p.home);
        auto anchor = home ? home->door() : camp() ? camp()->door() : world.camp();
        p.activity = Activity::Idle; p.path.clear(); p.until = time + 2;
        if (p.job < 0) for (int attempt = 0; attempt < 8; ++attempt) {
            auto goal = p.position + rotated({2 + roll() * 2.5f, 0}, roll() * 6.2831853f);
            if (distance(goal, anchor) > 10) goal = anchor + normalized(goal - anchor) * (4 + roll() * 4);
            goal = grid.nearestWalkable(goal);
            if (distance(goal, p.position) < .8f || !walkTo(p, goal)) continue;
            p.until = time + .8; break;
        }
        return;
    }
    // Loiter around home or the fire; guests keep to their lodging, the tavern or the guild, and a
    // bard to the tavern they play in.
    const Building* anchor = p.calling == Calling::Bard ? tavern : nullptr;
    if (!anchor) anchor = building(p.role == Role::Resident ? p.home : p.bed);
    if (!anchor && p.role == Role::Guest) anchor = nearest(p.position, [](const Building& b) { return b.built() && (b.kind == Structure::Tavern || b.kind == Structure::Guild || isLodging(b.kind)); });
    if (!anchor) anchor = camp();
    Point around = anchor ? anchor->door() : p.position;
    p.activity = Activity::Idle;
    walkTo(p, grid.nearestWalkable(around + Point{roll() * 3 - 1.5f, roll() * 3 - 1.5f}));
    p.until = time + 3 + roll() * 5;
}

void Town::arrive(Person& p)
{
    if (p.approachingOrder) {
        p.approachingOrder = false;
        resumeOrder(p);
        return;
    }
    auto* place = site(p.target);
    bool atBuilding = p.activity == Activity::Eating || p.activity == Activity::Sleeping || p.activity == Activity::Relaxing ||
                      p.activity == Activity::Praying || p.activity == Activity::Shopping || p.activity == Activity::Hauling ||
                      p.activity == Activity::Building || p.activity == Activity::Working;
    if (atBuilding && place && distance(p.position, place->door()) > .02f) {
        if (!walkTo(p, place->door())) {
            p.activity = Activity::Idle;
            p.until = time + 3;
        }
        return;
    }
    switch (p.activity) {
    case Activity::Idle:
        if (p.role == Role::Resident && p.autoMode && p.job < 0) p.until = time + 1 + roll() * 2;
        break;
    case Activity::Moving:
        p.activity = Activity::Holding;
        p.until = p.task != Activity::Idle ? time : time + 10;
        break;
    case Activity::Eating:
        if (treasury.food > 0 && place) {
            treasury.food -= 1;
            ++today.eaten;
            p.food = 1;
            if (p.role == Role::Guest) charge(p, place, 2);
            enter(p, place->threshold());
            p.until = time + 3;
        } else p.activity = Activity::Idle;
        break;
    case Activity::Sleeping:
        if (place) enter(p, place->threshold());
        p.sleptOutside = !place;
        if (place && p.role == Role::Guest && isLodging(place->kind) && !charge(p, place, 2)) p.stress = std::min(1.f, p.stress + .05f);
        break;
    case Activity::Relaxing:
    case Activity::Praying:
        if (!place) { p.activity = Activity::Idle; break; }
        enter(p, place->threshold());
        p.until = time + (p.activity == Activity::Praying ? 5 : 6);
        break;
    case Activity::Shopping:
        if (!place) { p.activity = Activity::Idle; break; }
        enter(p, place->threshold());
        p.until = time + 3;
        break;
    case Activity::Hauling:
        if (p.carrying > 0 && (!place || !place->built())) { p.activity = Activity::Idle; p.until = time; break; }
        p.load = 0;  // Goods delivered; back to work.
        {
            bool stone = p.carriedProduct == Product::Stone;
            int room = stone ? capacity().stone - treasury.stone : capacity().wood - treasury.wood;
            int delivered = std::min(p.carrying, std::max(0, room));
            store({0, stone ? 0 : delivered, stone ? delivered : 0});
            p.carrying -= delivered;
        }
        p.activity = Activity::Idle;
        p.until = time + (p.carrying ? 2 : 0);
        break;
    case Activity::Felling:
        p.until = time + woodcutting::cutSeconds;
        break;
    case Activity::Mining:
        p.until = time + mining::workSeconds;
        break;
    case Activity::Exploring:
        enter(p, p.position + Point{0, -.3f});
        p.until = time + 10 + roll() * 8;
        break;
    case Activity::Leaving: p.health = -1; break;  // Removed by tick().
    case Activity::Arriving: p.activity = Activity::Idle; break;
    case Activity::Building:
    case Activity::Working:
        if (!place) p.activity = Activity::Idle;
        break;
    case Activity::Roadwork:
        if (!network.road(p.target)) p.activity = Activity::Idle;
        break;
    case Activity::Expedition:
        enter(p, p.position + Point{0, -.3f});
        break;
    default: break;
    }
}

void Town::tick(double dt)
{
    std::erase_if(timberEvents, [&](const TreeWorkEvent& event) { return time - event.at > 2; });
    if (walkRevision != changes) {
        walkRevision = changes;
        std::vector<Footprint> walls;
        for (const auto& item : placed) if (item.built()) walls.push_back(item.footprint());
        grid.rebuild(world, network, walls);
    }
    admitGuests(dt);
    stir(dt);
    const auto& sky = climate();
    float days = float(dt / secondsPerDay);
    bool raining = sky.weather == Weather::Rain || sky.weather == Weather::Storm || sky.weather == Weather::Snow;
    bool healers = staffed(Structure::Apothecary);
    for (size_t i = 0; i < folk.size(); ++i) {
        auto& p = folk[i];
        enforceGuestLodging(p);
        refreshShelter(p);
        bool asleep = p.activity == Activity::Sleeping && !p.moving() && !p.crossingDoorway();
        bool sheltered = p.inside;
        // Needs.
        p.food = std::max(0.f, p.food - .9f * days);
        p.rest = std::clamp(p.rest + (asleep ? (sheltered ? 2.4f : 1.4f) : -.75f) * days, 0.f, 1.f);
        float strain = -.1f;
        if (p.food < .2f) strain += .5f;
        if (p.rest < .15f) strain += .3f;
        if (raining && !sheltered) strain += (sky.weather == Weather::Storm ? .35f : .15f) * sky.intensity;
        float chill = !sheltered ? std::max(0.f, 2 - sky.temperature) * .03f : 0;
        strain += std::min(chill, .35f);
        bool working = !p.crossingDoorway() && (p.activity == Activity::Working || p.activity == Activity::Building || p.activity == Activity::Roadwork || p.activity == Activity::Felling || p.activity == Activity::Mining || p.activity == Activity::Collecting);
        if (working) strain += .12f;
        if (!p.crossingDoorway() && (working || p.activity == Activity::Hauling || p.activity == Activity::Guarding || p.activity == Activity::Fighting)) p.worked += float(dt);
        if (p.unpaid) strain += .1f;
        if (asleep && sheltered) strain -= .25f;
        if (p.role == Role::Resident && p.home < 0) strain += .1f;
        p.stress = std::clamp(p.stress + strain * days, 0.f, 1.f);
        p.breaking = p.stress >= .95f ? p.breaking + days : 0;
        if (thirst) {
            p.stress = std::min(1.f, p.stress + .3f * days);
            p.health -= .1f * days;
        }
        if (p.food < .05f) p.health -= .5f * days;
        else if (!sheltered && sky.temperature < -3) p.health -= .15f * days;
        else if (p.food > .4f && p.rest > .3f) p.health = std::min(1.f, p.health + (healers ? .3f : .15f) * days);
        if (p.health <= 0 && p.activity != Activity::Leaving) {
            notify(p.name + (p.food < .05f ? " starved to death" : " died of the cold"));
            p.activity = Activity::Leaving;
            p.health = -1;
        }
        if (p.health < -.5f) continue;  // Gone; erased below.

        if (p.role == Role::Resident && !p.autoMode && p.task == Activity::Idle && !p.ordered && p.activity != Activity::Leaving) {
            p.path.clear(); p.foe = -1; p.activity = Activity::Holding;
            continue;
        }
        if (p.crossingDoorway()) {
            float length = distance(p.entrance, p.threshold);
            float step = walkingSpeed(p) * float(dt) / std::max(.001f, length);
            p.doorway = std::clamp(p.doorway + (p.inside ? step : -step), 0.f, 1.f);
            p.position = lerp(p.entrance, p.threshold, p.doorway);
            continue;
        }
        fight(p, dt);
        if (p.activity == Activity::Fighting || p.crossingDoorway()) continue;
        if (!p.moving() && (p.activity == Activity::Building || p.activity == Activity::Roadwork ||
                            p.activity == Activity::Working || p.activity == Activity::Felling || p.activity == Activity::Mining) && takeBreak(p)) continue;
        // Wherever people go, they see: the map opens up around them.
        if (!p.inside && !world.revealedWithin(p.position, 3.5f)) reveal(p.position.x, p.position.y, 7.5f);
        if (p.moving()) {
            if (p.role == Role::Resident && p.autoMode && p.job < 0 && !p.ordered && p.task == Activity::Idle && p.activity == Activity::Idle && time >= p.until) {
                p.until = time + .8;
                if (startHarvest(p, p.position, woodcutting::searchRadius)) continue;
            }
            walk(p, dt);
            if (!p.moving()) arrive(p);
            continue;
        }
        auto* place = site(p.target);
        switch (p.activity) {
        case Activity::Building:
            if (!place || (place->built() && place->health >= 1)) {
                p.activity = Activity::Idle;
                p.ordered = false;
                break;
            }
            if (layRoadFirst(p, place->id)) break;
            if (distance(p.position, place->door()) > .02f) {
                if (!walkTo(p, place->door())) { p.activity = Activity::Idle; p.until = time + 3; }
                break;
            }
            if (int tree = constructionTree(p, p.activity, p.target); tree >= 0) {
                if (p.task == Activity::Idle) { p.task = Activity::Building; p.taskSite = place->id; }
                if (!fellTree(p, tree)) { p.activity = Activity::Holding; p.until = time + 1; }
                break;
            }
            if (place->built()) {
                // Mending what monsters broke, twice as quick as raising it.
                place->health = std::min(1.f, place->health + 2 * float(dt) / buildWork(place->kind));
                if (place->health >= 1) notify(std::string(structureSpec(place->kind).name) + " is repaired");
            } else place->progress = std::min(1.f, place->progress + float(dt) / buildWork(place->kind));
            if (place->built()) {
                notify(std::string(structureSpec(place->kind).name) + " is finished");
                if (place->kind == Structure::Guild)
                    for (size_t d = 0; d < world.dungeons().size(); ++d) {
                        const auto& dungeon = world.dungeons()[d];
                        if (!open[d] && dungeon.discovered && distance(place->center, {dungeon.origin.x + 1.f, dungeon.origin.y + 1.f}) <= 10) {
                            open[d] = 1;
                            notify(dungeon.name + " is open to adventurers");
                        }
                    }
                assignHomes();
                staff();
                ++changes;
            }
            break;
        case Activity::Roadwork: {
            if (p.task == Activity::Roadwork) {
                int next = roadWorkTarget(p.taskSite);
                if (next < 0) { p.path.clear(); p.activity = Activity::Idle; p.until = time + 1; break; }
                if (next != p.target) { p.target = next; if (!walkTo(p, workFront(*network.road(next)))) p.activity = Activity::Idle; break; }
            }
            auto* road = network.road(p.target);
            if (road && !roadReady(road->id)) { p.activity = Activity::Idle; p.until = time + 1; break; }
            bool paving = road && road->built >= 1;
            if (!road || (paving && road->paving < 0 && road->wear <= 0)) {
                p.activity = Activity::Idle;
                if (p.task != Activity::Building) p.ordered = false;  // A site's road is only its first step.
                break;
            }
            if (road && distance(p.position, workFront(*road)) > .0001f) {
                if (walkTo(p, workFront(*road))) walk(p, dt);
                else { p.activity = Activity::Idle; p.until = time + 3; }
                break;
            }
            if (int tree = constructionTree(p, p.activity, p.target); tree >= 0) {
                if (p.task == Activity::Idle) { p.task = Activity::Roadwork; p.taskSite = road->id; }
                if (!fellTree(p, tree)) { p.activity = Activity::Holding; p.until = time + 1; }
                break;
            }
            if (road && paving && road->paving < 0 && road->wear > 0) {
                // Mending a torn road: filling the ruts along its length.
                bool ruined = road->wear >= 1;
                road->wear = std::max(0.f, road->wear - float(dt) * .5f / std::max(1.f, road->length()));
                if (ruined && road->wear < 1) roadChanged();  // Walkable as a road again.
                if (road->wear <= 0) notify("A road is mended");
                break;
            }
            // Builders lay about a third of a pace a second and walk along with the work.
            float& share = paving ? road->paving : road->built;
            float before = share;
            share = std::min(1.f, share + float(dt) * (paving ? .2f : .32f) / std::max(1.f, road->length()));
            float turn = 1 - road->constructionStart;
            if (!paving && before < turn && share >= turn && turn < 1) {
                share = turn; p.position = road->along(1); walkTo(p, road->workPoint());
            } else p.position = paving ? road->along(share) : road->constructionPoint(share);
            if (share >= 1) {
                if (paving) {
                    road->paved = true;
                    road->paving = -1;
                    notify("A road is paved with stone");
                } else notify("A road is laid");
                roadChanged();
            } else if (int(share * 20) != int(before * 20)) {
                roadChanged();  // Redraw in steps.
                // A site's builder goes back once a laid road reaches it, or on to the next stretch.
                if (p.task == Activity::Building && constructionRoad(p.taskSite) != p.target) { p.activity = Activity::Idle; p.until = time; }
            }
            break;
        }
        case Activity::Felling:
        case Activity::Mining: {
            bool stone = p.activity == Activity::Mining;
            int x = p.tree % world.width(), y = p.tree / world.width();
            const auto* job = building(p.job);
            bool exists = p.tree >= 0 && world.inside(x, y) && (stone ? mining::deposit(world, x, y) : world.at(x, y).trees > 0);
            bool clearing = !stone && (p.task == Activity::Building || p.task == Activity::Roadwork);  // Comes down regardless.
            bool full = stone ? treasury.stone >= capacity().stone : !storageFoundation(p) && !clearing && treasury.wood >= capacity().wood;
            if (!exists || (!p.ordered && job && job->kind != (stone ? Structure::Quarry : Structure::Lumberyard)) || full) {
                p.tree = -1; p.activity = Activity::Idle; p.until = time; break;
            }
            if (place) place->workedSeconds += float(dt);
            double started = p.until - (stone ? mining::workSeconds : woodcutting::cutSeconds);
            auto stroke = [&](double at) { return std::floor((at - started - woodcutting::impactSeconds) / woodcutting::swingSeconds); };
            if (stroke(time) > stroke(time - dt))
                timberEvents.push_back({nextTreeEvent++, stone ? TreeWorkEvent::Kind::Mine : TreeWorkEvent::Kind::Chop, p.id, p.tree, stone ? 0 : int(world.at(x, y).trees) - 1, p.position,
                                       started + woodcutting::impactSeconds + stroke(time) * woodcutting::swingSeconds});
            if (time < p.until) break;
            if (stone) world.at(x, y).quarried = true; else --world.at(x, y).trees;
            timberEvents.push_back({nextTreeEvent++, stone ? TreeWorkEvent::Kind::Shatter : TreeWorkEvent::Kind::Fall, p.id, p.tree, world.at(x, y).trees, p.position, time});
            p.carriedProduct = stone ? Product::Stone : Product::Wood;
            p.carrying += stone ? mining::stonePerRock : woodcutting::logsPerTree;
            p.tree = -1;
            p.activity = Activity::Collecting;
            p.until = time + (stone ? mining::collectSeconds : woodcutting::fallSeconds);
            ++changes;
            break;
        }
        case Activity::Collecting:
            if (time >= p.until && !haulCargo(p)) { p.activity = Activity::Idle; p.until = time + 2; }
            break;
        case Activity::Hauling:
            if (time >= p.until) arrive(p);
            break;
        case Activity::Working:
            if (place && distance(p.position, place->door()) > .02f) {
                if (!walkTo(p, place->door())) { p.activity = Activity::Idle; p.until = time + 3; }
                break;
            }
            if (place) place->workedSeconds += float(dt);
            // Woodcutters go out to the nearest standing tree near their yard.
            if (place && place->kind == Structure::Lumberyard) {
                if (startFelling(p, place->center, 4.6f)) break;
            }
            if (place && place->kind == Structure::Quarry) {
                if (startMining(p, place->center, 4.6f)) break;
            }
            // Producers carry their goods to the store themselves now and then.
            if (place && (place->kind == Structure::Farm || place->kind == Structure::MageTower)) {
                p.load += float(dt);
                const auto* store = nearest(place->center, [](const Building& b) { return b.built() && (b.kind == Structure::Storehouse || isMarket(b.kind) || isSeat(b.kind)); });
                if (p.load > 25 && store && distance(store->center, place->center) > 3) {
                    if (walkTo(p, store->door())) {
                        p.activity = Activity::Hauling;
                        p.target = store->id;
                    }
                    break;
                }
            }
            if (!place || p.job != p.target) p.activity = Activity::Idle;
            break;
        case Activity::Sleeping:
            if (p.task == Activity::Sleeping && p.autoMode && p.food < .25f && treasury.food > 0 && eat(p)) break;
            if (p.rest >= .95f && p.task != Activity::Sleeping) {
                p.activity = Activity::Idle;
                p.inside = false;
                p.until = time;
            }
            break;
        case Activity::Eating:
        case Activity::Relaxing:
        case Activity::Praying:
        case Activity::Shopping:
        case Activity::Exploring:
            if (time < p.until) break;
            if (p.activity == Activity::Praying) {
                bool faithful = place && int(place->faith) == int(p.faith);
                p.stress = std::max(0.f, p.stress - (faithful ? .4f : .2f));
                p.prayedAt = time;
            } else if (p.activity == Activity::Shopping) {
                constexpr int kit = 12;
                if (charge(p, place, kit)) ++p.gear;
                p.loot = 0;
            } else if (p.activity == Activity::Relaxing) {
                p.stress = std::max(0.f, p.stress - .35f);
                p.relaxedAt = time;
                charge(p, place, p.role == Role::Guest ? 3 : 1);
            } else if (p.activity == Activity::Exploring) {
                p.loot = 6 + int(roll() * 18);
                p.health = std::max(.05f, p.health - roll() * .35f);
                // The guild takes its cut, a guild hall more; the rest fills the adventurer's purse.
                bool hall = std::any_of(placed.begin(), placed.end(), [](const Building& b) { return b.kind == Structure::GuildHall && b.built(); });
                int cut = p.loot / (hall ? 2 : 3);
                treasury.gold += cut;
                today.guests += cut;
                p.purse += p.loot - cut;
                p.stress = std::max(0.f, p.stress - .1f);
            }
            if (p.task == Activity::Idle) p.ordered = false;
            p.activity = Activity::Idle;
            p.inside = false;
            p.until = time;
            break;
        case Activity::Holding:
            if (time >= p.until) {
                if (p.task == Activity::Idle) p.ordered = false;
                think(p);
            }
            break;
        case Activity::Idle:
        case Activity::Brooding:
        case Activity::Guarding:
            if (time >= p.until) think(p);
            break;
        case Activity::Expedition:
        case Activity::Fighting:
            break;
        default: p.activity = Activity::Idle; break;
        }
    }
    if (timberEvents.size() > 512) timberEvents.erase(timberEvents.begin(), timberEvents.end() - 512);
    auto before = folk.size();
    folk.erase(std::remove_if(folk.begin(), folk.end(), [](const Person& p) { return p.health < -.5f; }), folk.end());
    if (folk.size() != before) {
        for (auto& item : placed)
            if (item.owner >= 0 && !person(item.owner)) item.owner = -1;  // A home of the departed reverts to the settlement.
        recount();
        assignHomes();
        ++changes;
    }
}

}  // namespace hearthold

#include "town.h"
#include "building_assets.h"
#include "ymir_born.h"
#include "person_look.h"
#include "character_assets.h"
#include "map_document.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <limits>

namespace hearthold
{
namespace
{
constexpr float sampleStep = .25f;

Check refuse(Check check, std::string reason)
{
    check.reason = std::move(reason);
    return check;
}

std::string shortfall(const Resources& have, const Resources& cost)
{
    Resources missing{std::max(0, cost.gold - have.gold), std::max(0, cost.wood - have.wood), std::max(0, cost.stone - have.stone),
                      std::max(0, cost.food - have.food), std::max(0, cost.mana - have.mana)};
    return "Needs " + describe(missing) + " more";
}

std::vector<Point> samples(const Footprint& footprint)
{
    std::vector<Point> out;
    int steps = std::max(1, int(std::ceil(footprint.half * 2 / sampleStep)));
    for (int j = 0; j <= steps; ++j)
        for (int i = 0; i <= steps; ++i) {
            Point local{-footprint.half + footprint.half * 2 * i / steps, -footprint.half + footprint.half * 2 * j / steps};
            out.push_back(footprint.center + rotated(local * .98f, footprint.angle));
        }
    return out;
}

std::vector<Point> samples(const Outline& outline)
{
    std::vector<Point> out(outline.begin(), outline.end());
    if (outline.empty()) return out;
    Point low = outline[0], high = outline[0];
    for (auto p : outline) {
        low = {std::min(low.x, p.x), std::min(low.y, p.y)};
        high = {std::max(high.x, p.x), std::max(high.y, p.y)};
    }
    for (float y = low.y + sampleStep / 2; y < high.y; y += sampleStep)
        for (float x = low.x + sampleStep / 2; x < high.x; x += sampleStep)
            if (contains(outline, {x, y})) out.push_back({x, y});
    return out;
}

// A road segment comes within `margin` of the footprint.
bool touches(const Footprint& footprint, Point a, Point b, float margin)
{
    return footprint.contains(a, margin) || footprint.contains(b, margin) || footprint.contains(lerp(a, b, .5f), margin);
}

struct Entrance
{
    Point local;
    float turn;
};

Entrance entrance(const Building& building)
{
    const float half = structureSpec(building.kind).size / 2.f;
    const auto& model = gameframework::buildingVariant(buildingAsset(building.kind), building.variant);
    Point door{};
    bool found = false;
    for (const auto& block : model.blocks) {
        if (!block.door || std::abs(block.base) > 1e-4f) continue;
        // The authored +y doorway rotates with its building, including to the hidden side.
        // Prefer the frontmost ground-level door in a compound building.
        Point candidate{block.x0 + (block.x1 - block.x0) * .28f - half, block.y1 - half};
        if (!found || candidate.y > door.y) { door = candidate; found = true; }
    }
    return {found ? door : Point{0, half}, building.angle};
}
}  // namespace

Footprint Building::footprint() const { return {center, structureSpec(kind).size / 2.f, angle}; }

bool Town::editPerson(int id, Point position, float health)
{
    if (!std::isfinite(position.x) || !std::isfinite(position.y) || !world.inside(position) || !std::isfinite(health) || health < 0 || health > 1) return false;
    for (auto& person : folk) if (person.id == id) {
        if (!(person.position == position)) {
            person.position = position; person.path.clear(); person.activity = Activity::Idle;
            person.inside = false; person.ordered = false; person.goal = position;
            person.doorway = 0; person.entrance = person.threshold = position;
            reveal(position.x, position.y, 7.5f);
        }
        person.health = health;
        return true;
    }
    return false;
}

bool Town::editBuilding(int id, Point center, float angle, float progress, float health)
{
    if (!std::isfinite(center.x) || !std::isfinite(center.y) || !std::isfinite(angle) || !std::isfinite(progress) ||
        !std::isfinite(health) || progress < 0 || progress > 1 || health < 0 || health > 1) return false;
    for (auto& building : placed) if (building.id == id) {
        auto draft = building;
        draft.center = center; draft.angle = angle; draft.progress = progress; draft.health = health;
        for (auto point : draft.footprint().corners()) if (!world.inside(point)) return false;
        building = std::move(draft); ++building.version; ++changes;
        // Rebuild paths lazily before the next simulation update.
        walkRevision = 0;
        return true;
    }
    return false;
}

bool Town::editHour(double hour)
{
    if (!std::isfinite(hour) || hour < 0 || hour >= 24) return false;
    time = days * secondsPerDay + hour / 24 * secondsPerDay;
    sky.previewTime(yearFraction(), dayFraction());
    return true;
}

Point Building::door() const
{
    auto entry = entrance(*this);
    entry.local.y = std::max(entry.local.y, structureSpec(kind).size / 2.f) + .25f;
    const auto walls = footprint();
    Point point = center + rotated(entry.local, entry.turn);
    // Keep the approach on the door normal, including when the navigation cell's center
    // falls inside a rotated footprint although the exact point is already outside.
    for (int step = 0; step < 20; ++step) {
        Point cell{std::floor(point.x) + .5f, std::floor(point.y) + .5f};
        if (!walls.contains(cell, .05f)) break;
        entry.local.y += .05f;
        point = center + rotated(entry.local, entry.turn);
    }
    return point;
}

Point Building::threshold() const
{
    const auto entry = entrance(*this);
    return center + rotated(entry.local, entry.turn);
}

Point Building::corner() const
{
    float half = structureSpec(kind).size / 2.f;
    return {center.x - half, center.y - half};
}

int Field::acres() const { return int(std::lround(area(outline))); }

Town::Town(uint32_t seed, int mapSize) : Town(WorldMap::generate(seed, mapSize, mapSize)) {}

Town::Town(WorldMap map, MapPreview) : world(std::move(map)), sky(world.seed()), dice(world.seed() * 2246822519u + 7)
{
    open.assign(world.dungeons().size(), 0);
    time = secondsPerDay * .3;  // The first morning.
}

Town::Town(WorldMap map, bool founders) : Town(std::move(map), MapPreview{})
{
    grid.rebuild(world, network, {});
    if (!founders) return;
    // The founding pair, gathered at Ymir's feet.
    auto start = world.camp();
    constexpr auto gathered = std::to_array<Point>({{0, 0}, {.8f, .4f}});
    static_assert(gathered.size() == foundingPeople.size());
    for (size_t i = 0; i < gathered.size(); ++i) {
        // Rolled like anyone else so the dice stay in step; the myth already decided who they are.
        auto founder = makePerson(Role::Resident, Calling::Settler, {start.x + gathered[i].x, start.y + gathered[i].y});
        founder.name = foundingPeople[i].name;
        founder.race = Race::Human;
        founder.past = foundingPeople[i].past;
        auto look = appearanceOf(founder);
        look.bodyType = foundingPeople[i].bodyType;
        // Their head goes with the body the myth gave them: drawn as anyone's is, then the nearest that reads so.
        int head = randomCharacterReference(founder.look, look.bodyType);
        for (int step = 0; step < hairAssetCount && headBody(head) != look.bodyType; ++step) head = (head + 1) % hairAssetCount;
        useCharacterReference(look, head);
        founder.customLook = look;
        folk.push_back(std::move(founder));
    }
    notify(std::string(birthNotice));
}

void Town::updateMapPreview(const MapDocument& document, TileRegion area)
{
    document.updatePreview(world, area);
    open.assign(world.dungeons().size(), 0);
}

const Building* Town::camp() const
{
    for (const auto& item : placed)
        if (isSeat(item.kind)) return &item;
    return nullptr;
}

bool Town::roomToGrow(const Building& item, Structure next) const
{
    float half = structureSpec(next).size / 2.f;
    if (half <= structureSpec(item.kind).size / 2.f) return true;
    Footprint grown{item.center, half, item.angle};
    if (!groundProblem(samples(grown)).empty()) return false;
    for (const auto& other : placed)
        if (other.id != item.id && grown.overlaps(other.footprint())) return false;
    for (const auto& segment : network.segments())
        if (grown.contains(segment.a, -.1f)) return false;
    return true;
}

bool Town::staffed(Structure kind) const
{
    return std::any_of(placed.begin(), placed.end(), [&](const Building& b) { return b.kind == kind && b.built() && b.workers > 0; });
}

bool Town::charge(Person& person, Building* place, int gold)
{
    if (person.purse < gold) return false;
    person.purse -= gold;
    treasury.gold += gold;
    today.guests += person.role == Role::Guest ? gold : 0;
    if (place) place->earned += gold;
    return true;
}

bool Town::setFaith(int id, Faith faith)
{
    for (auto& item : placed)
        if (item.id == id && item.kind == Structure::Chapel && item.faith != faith) {
            item.replaced = {{item.kind, item.variant}};
            item.faith = faith;
            item.variant = (item.variant & ~3u) | uint32_t(faith);
            ++item.version;
            notify(std::string("The chapel now follows the ") + faithName(faith));
            ++changes;
            return true;
        }
    return false;
}

const Person* Town::person(int id) const
{
    for (const auto& item : folk)
        if (item.id == id) return &item;
    return nullptr;
}

int Town::population() const { return int(std::count_if(folk.begin(), folk.end(), [](const Person& p) { return p.role == Role::Resident; })); }

int Town::guests() const { return int(folk.size()) - population(); }

int Town::guestBeds() const
{
    int beds = 0;
    for (const auto& item : placed)
        if (item.built()) beds += structureSpec(item.kind).beds;
    return beds;
}

const Building* Town::building(int id) const
{
    for (const auto& item : placed)
        if (item.id == id) return &item;
    return nullptr;
}

const Field* Town::field(int id) const
{
    for (const auto& item : farmland)
        if (item.id == id) return &item;
    return nullptr;
}

int Town::buildingAt(Point p) const
{
    for (auto it = placed.rbegin(); it != placed.rend(); ++it)
        if (it->footprint().contains(p)) return it->id;
    return -1;
}

int Town::fieldAt(Point p) const
{
    for (const auto& item : farmland)
        if (contains(item.outline, p)) return item.id;
    return -1;
}

std::string Town::groundProblem(const std::vector<Point>& points) const
{
    for (auto p : points) {
        const auto* tile = world.cell(p);
        if (!tile || !world.revealed(p)) return "Unexplored land";
        if (world.giant() && world.giant()->covers(p)) return "Ymir's stone";
        auto terrain = world.terrainAt(p);
        if (isWater(terrain)) return "Water";
        if (terrain == Terrain::Mountain) return "Mountains";
        if (terrain == Terrain::Ice) return "Ice";
        if (terrain == Terrain::Lava) return "Lava";
        if (terrain == Terrain::Rock) return "Rocky ground";
        if (tile->dungeon >= 0) return "A dungeon entrance";
    }
    return {};
}

Placement Town::fit(Structure kind, Point cursor, float freeAngle) const
{
    float half = structureSpec(kind).size / 2.f;
    Point on, tangent;
    float gap = network.distance(cursor, &on, nullptr, -1, &tangent);
    if (gap > half + 1.6f) return {cursor, freeAngle, false};
    Point normal{-tangent.y, tangent.x};
    auto side = cursor - on;
    if (normal.x * side.x + normal.y * side.y < 0) normal = normal * -1;
    // The model's +y wall turns to face the road: rotated (0, 1) == -normal.
    return {on + normal * (roadHalfWidth + .1f + half), std::atan2(normal.x, -normal.y), true};
}

Check Town::canPlace(Structure kind, Point center, float angle) const
{
    const auto& spec = structureSpec(kind);
    Check check;
    check.cost = spec.cost;
    if (!spec.buildable) return refuse(check, "Grows from an earlier stage");
    if (population() < spec.requiredPopulation) return refuse(check, "Needs " + std::to_string(spec.requiredPopulation) + " people");
    bool founding = kind == Structure::Camp;
    if (founding && camp()) return refuse(check, "The camp already stands");
    if (!founding && !camp()) return refuse(check, "Found the camp first");
    auto nearDungeon = [&](float reach) {
        for (const auto& site : world.dungeons())
            if (site.discovered && distance(center, {site.origin.x + 1.f, site.origin.y + 1.f}) <= reach) return true;
        return false;
    };
    if (founding && !nearDungeon(campReach)) return refuse(check, "Must be within 12 paces of a dungeon");
    if (kind == Structure::Guild && !nearDungeon(10)) return refuse(check, "Must be within 10 paces of a dungeon");
    Footprint footprint{center, spec.size / 2.f, angle};
    if (auto problem = groundProblem(samples(footprint)); !problem.empty()) return refuse(check, problem);
    for (const auto& other : placed)
        if (footprint.overlaps(other.footprint())) return refuse(check, "Occupied");
    for (const auto& segment : network.segments())
        if (touches(footprint, segment.a, segment.b, roadHalfWidth)) return refuse(check, "On the road");
    for (const auto& item : farmland)
        if (overlaps(footprint.corners(), item.outline)) return refuse(check, "Fields in the way");
    if (!founding && !roadAccess(footprint)) return refuse(check, "Needs a road beside it");
    if (kind == Structure::Lumberyard && !nearbyTiles(center, 4.5f, [](const Tile& t) { return t.trees > 0; })) return refuse(check, "Needs forest within 4 paces");
    if (kind == Structure::Quarry && !nearbyTiles(center, 3.5f, [](const Tile& t) { return isStone(t.terrain); })) return refuse(check, "Needs rocky ground within 3 paces");
    if (!treasury.covers(spec.cost)) return refuse(check, shortfall(treasury, spec.cost));
    check.ok = true;
    return check;
}

bool Town::place(Structure kind, Point center, float angle)
{
    if (!canPlace(kind, center, angle).ok) return false;
    const auto& spec = structureSpec(kind);
    treasury -= spec.cost;
    uint32_t variant = uint32_t(hash01(world.seed(), int(center.x * 8), int(center.y * 8), 41) * 1e6f);
    if (kind == Structure::Chapel) variant &= ~3u;  // Faith colours: the Dawn first.
    Building item{nextId++, kind, center, angle, variant, 0, -1, 0, 0, {}, 0};
    placed.push_back(item);
    reveal(center.x, center.y, 7.f + spec.size);
    ++changes;
    return true;
}

void Town::completeConstruction()
{
    for (auto& item : placed) item.progress = 1;
    for (const auto& road : network.roads()) {
        auto* lane = network.road(road.id);
        lane->built = 1;
        if (lane->paving >= 0) {
            lane->paved = true;
            lane->paving = -1;
        }
    }
    for (size_t i = 0; i < placed.size(); ++i)
        if (placed[i].kind == Structure::Guild) {
            for (size_t d = 0; d < world.dungeons().size(); ++d) {
                const auto& site = world.dungeons()[d];
                if (site.discovered && distance(placed[i].center, {site.origin.x + 1.f, site.origin.y + 1.f}) <= 10) open[d] = 1;
            }
        }
    for (const auto& item : placed) treasury.wood += clearTrees(samples(item.footprint()));
    for (const auto& road : network.roads()) treasury.wood += clearTrees(flatten(road.path, .2f));
    assignHomes();
    staff();
    ++roadChanges;
    ++changes;
}

Check Town::checkRoad(const RoadPath& path, int ignore, float paid) const
{
    Check check;
    if (!camp()) return refuse(check, "Found the camp first");
    if (path.size() < 2) return refuse(check, "Hold and draw a road");
    float total = pathLength(path);
    if (total < .5f) return refuse(check, "Too short");
    if (total > maxRoadLength) return refuse(check, "Too long");
    auto line = flatten(path, .2f);
    bool connected = touchesSettlement(line.front()) || touchesSettlement(line.back());
    float span = 0, bridged = 0;  // Water under the current bridge, and under all of them.
    for (size_t i = 0; i < line.size(); ++i) {
        auto p = line[i];
        bool end = i == 0 || i + 1 == line.size();  // Ends may run up to a building's wall.
        const auto* tile = world.cell(p);
        if (!tile || !world.revealed(p)) return refuse(check, "Unexplored land");
        auto terrain = world.terrainAt(p);
        if (terrain == Terrain::Sea) return refuse(check, "Cannot bridge the sea");
        if (terrain == Terrain::Water) {
            if (end) return refuse(check, "A bridge needs dry banks");
            float step = distance(p, line[i - 1]);
            span += step;
            bridged += step;
            if (span > maxBridgeSpan) return refuse(check, "Bridge too long (7 paces at most)");
        } else span = 0;
        if (terrain == Terrain::Mountain) return refuse(check, "Mountains");
        if (terrain == Terrain::Ice) return refuse(check, "Ice");
        if (terrain == Terrain::Lava) return refuse(check, "Lava");
        if (terrain == Terrain::Rock) return refuse(check, "Rocky ground");
        if (tile->dungeon >= 0) return refuse(check, "A dungeon entrance");
        for (const auto& item : placed)
            if (item.footprint().contains(p, end ? -.05f : roadHalfWidth - .1f)) return refuse(check, "Building in the way");
        if (fieldAt(p) >= 0) return refuse(check, "Fields in the way");
        connected = connected || network.distance(p, nullptr, nullptr, ignore) < roadHalfWidth;  // Crossing a road.
    }
    // A reshaped road may keep its own connection only through other roads or the camp.
    if (ignore >= 0) {
        connected = false;
        for (auto end : {line.front(), line.back()})
            connected = connected || network.distance(end, nullptr, nullptr, ignore) <= joinReach || buildingAt(end) >= 0 || (camp() && distance(end, camp()->center) <= 1.3f);
        for (auto p : line) connected = connected || network.distance(p, nullptr, nullptr, ignore) < roadHalfWidth;
    }
    if (!connected) return refuse(check, "Must connect to the settlement");
    check.cost.gold = int(std::ceil(std::max(0.f, total - paid)));
    if (bridged > 0) {
        check.cost.gold += int(std::ceil(bridged));
        check.cost.wood = int(std::ceil(bridged * 3));
        check.cost.stone = int(std::ceil(bridged));
    }
    if (!treasury.covers(check.cost)) return refuse(check, shortfall(treasury, check.cost));
    check.ok = true;
    return check;
}

Check Town::canBuildRoad(const RoadPath& path) const { return checkRoad(path, -1, 0); }

bool Town::buildRoad(const RoadPath& path)
{
    auto check = canBuildRoad(path);
    if (!check.ok) return false;
    treasury -= check.cost;
    int id = network.add(path);
    if (!connectRoad(*network.road(id))) { network.remove(id); treasury += check.cost; return false; }
    reveal(path.front().point.x, path.front().point.y, 4);
    reveal(path.back().point.x, path.back().point.y, 4);
    roadChanged(false);
    return true;
}

Check Town::canPave(int id) const
{
    Check check;
    const auto* road = network.road(id);
    if (!road) return refuse(check, "No road there");
    if (road->paved || road->paving >= 0) return refuse(check, "Already paved");
    if (road->built < 1) return refuse(check, "Lay the road first");
    float length = road->length();
    check.cost = {int(std::ceil(length * .3f)), 0, int(std::ceil(length * .8f)), 0, 0};
    if (!treasury.covers(check.cost)) return refuse(check, shortfall(treasury, check.cost));
    check.ok = true;
    return check;
}

bool Town::pave(int id)
{
    auto check = canPave(id);
    if (!check.ok) return false;
    treasury -= check.cost;
    network.road(id)->paving = 0;
    roadChanged();
    return true;
}

Check Town::canReshapeRoad(int id, const RoadPath& path) const
{
    const auto* road = network.road(id);
    if (!road) return refuse({}, "No such road");
    return checkRoad(path, id, pathLength(road->path));
}

bool Town::reshapeRoad(int id, const RoadPath& path)
{
    auto check = canReshapeRoad(id, path);
    if (!check.ok) return false;
    treasury -= check.cost;
    network.reshape(id, path);
    connectRoad(*network.road(id));
    for (const auto& anchor : path) reveal(anchor.point.x, anchor.point.y, 4);
    roadChanged(false);
    return true;
}

Check Town::canPlantField(const Outline& outline) const
{
    Check check;
    if (outline.size() < 3) return refuse(check, "Click to outline a field");
    if (selfIntersects(outline)) return refuse(check, "The outline crosses itself");
    float acres = area(outline);
    if (acres < 1) return refuse(check, "Too small");
    if (acres > maxFieldAcres) return refuse(check, "At most " + std::to_string(maxFieldAcres) + " acres per field");
    if (auto problem = groundProblem(samples(outline)); !problem.empty()) return refuse(check, problem == "Unexplored land" ? problem : "Not arable");
    for (auto p : samples(outline)) {
        auto terrain = world.terrainAt(p);
        if (terrain == Terrain::Ash) return refuse(check, "Too dry for crops");
        if (terrain == Terrain::Frost) return refuse(check, "Too cold for crops");
    }
    for (const auto& item : placed)
        if (overlaps(item.footprint().corners(), outline)) return refuse(check, "Occupied");
    for (const auto& item : farmland)
        if (overlaps(item.outline, outline)) return refuse(check, "Occupied");
    for (const auto& road : network.roads())
        for (auto p : road.line)
            if (outlineDistance(outline, p) < roadHalfWidth) return refuse(check, "Road in the way");
    if (!near(centroid(outline), farmReach + std::sqrt(acres) / 2, [](Structure s) { return s == Structure::Farm; }))
        return refuse(check, "Needs a farmhouse within 6 paces");
    check.ok = true;
    return check;
}

bool Town::plantField(const Outline& outline)
{
    if (!canPlantField(outline).ok) return false;
    farmland.push_back({nextId++, outline});
    treasury.wood += clearTrees(samples(outline));
    ++changes;
    return true;
}

Check Town::canDemolish(Point p) const
{
    Check check;
    if (auto id = buildingAt(p); id >= 0) {
        if (isSeat(building(id)->kind)) return refuse(check, "The seat of the settlement stays");
        check.ok = true;
    } else if (fieldAt(p) >= 0 || network.distance(p) < roadHalfWidth + .15f) check.ok = true;
    else check.reason = "Nothing to clear";
    return check;
}

void Town::raze(int id)
{
    placed.erase(std::remove_if(placed.begin(), placed.end(), [&](const Building& b) { return b.id == id; }), placed.end());
    for (auto& person : folk) {
        if (person.home == id) person.home = -1;
        if (person.job == id) person.job = -1;
        if (person.bed == id) person.bed = -1;
        if (person.task == Activity::Building && person.taskSite == id) person.task = Activity::Idle;
        if (person.target == id && person.activity != Activity::Exploring) {
            person.activity = Activity::Idle;
            person.inside = false;
            person.path.clear();
        }
    }
    recount();
    assignHomes();
    ++changes;
}

bool Town::demolish(Point p)
{
    if (!canDemolish(p).ok) return false;
    if (auto id = buildingAt(p); id >= 0) {
        raze(id);
    } else if (auto field = fieldAt(p); field >= 0) {
        farmland.erase(std::remove_if(farmland.begin(), farmland.end(), [&](const Field& f) { return f.id == field; }), farmland.end());
    } else {
        int road = -1;
        network.distance(p, nullptr, &road);
        network.remove(road);
        ++roadChanges;
        for (auto& person : folk)
            if (person.activity == Activity::Roadwork && person.target == road) person.activity = Activity::Idle;
    }
    ++changes;
    return true;
}

void Town::regrow()
{
    // What stands on the land: roads, buildings and fields keep it clear.
    std::vector<uint8_t> taken(size_t(world.width()) * world.height(), 0);
    auto mark = [&](Point p) {
        int x = int(std::floor(p.x)), y = int(std::floor(p.y));
        if (world.inside(x, y)) taken[size_t(y) * world.width() + x] = 1;
    };
    for (const auto& road : network.roads())
        for (float s = 0; s <= 1; s += .3f / std::max(1.f, road.length())) mark(road.along(s));
    for (const auto& item : placed)
        for (auto p : samples(item.footprint())) mark(p);
    for (const auto& item : farmland)
        for (auto p : samples(item.outline)) mark(p);
    for (int y = 0; y < world.height(); ++y)
        for (int x = 0; x < world.width(); ++x) {
            auto& tile = world.at(x, y);
            if (tile.trees < tile.wild && !taken[size_t(y) * world.width() + x] && hash01(world.seed(), x, y, uint32_t(days)) < .2f) ++tile.trees;
        }
}

bool Town::setWorkers(int id, int workers)
{
    for (auto& item : placed) {
        if (item.id != id) continue;
        int jobs = structureSpec(item.kind).jobs;
        int before = item.workers;
        item.wanted = std::clamp(workers, 0, jobs);
        // Let go of the most recent hires above the cap, then hire up to it.
        for (auto it = folk.rbegin(); it != folk.rend() && item.workers > item.wanted; ++it)
            if (it->job == id) {
                it->job = -1;
                --item.workers;
            }
        staff();
        if (item.workers < item.wanted) borrowWorker(item);
        if (item.workers == before) return false;
        ++changes;  // Field crops show whether they are tended.
        return true;
    }
    return false;
}

void Town::borrowWorker(Building& to)
{
    // Nobody idle: take a hand from the workplace with the most, preferring one whose goods are
    // already piling up in store.
    auto fullness = [&](const Building& b) {
        auto room = capacity();
        switch (structureSpec(b.kind).product) {
        case Product::Food: return float(treasury.food) / std::max(1, room.food);
        case Product::Wood: return float(treasury.wood) / std::max(1, room.wood);
        case Product::Stone: return float(treasury.stone) / std::max(1, room.stone);
        case Product::Water: return float(treasury.water) / std::max(1, room.water);
        default: return 0.f;
        }
    };
    Building* donor = nullptr;
    float best = 0;
    for (auto& item : placed) {
        if (item.id == to.id || item.workers == 0) continue;
        float score = float(item.workers) + 2 * fullness(item);
        if (!donor || score > best) donor = &item, best = score;
    }
    if (!donor) return;
    for (auto it = folk.rbegin(); it != folk.rend(); ++it)
        if (it->job == donor->id && it->role == Role::Resident && it->autoMode && !it->ordered && it->activity != Activity::Expedition) {
            it->job = to.id;
            it->activity = Activity::Idle;
            it->until = time;
            if (donor->wanted > donor->workers - 1) donor->wanted = donor->workers - 1;  // Stays moved.
            notify(it->name + " moves from the " + structureSpec(donor->kind).name + " to the " + structureSpec(to.kind).name);
            recount();
            return;
        }
}

void Town::recount()
{
    for (auto& item : placed) item.workers = 0;
    for (const auto& person : folk)
        if (person.job >= 0)
            for (auto& item : placed)
                if (item.id == person.job) ++item.workers;
}

int Town::housing() const
{
    int total = 0;
    for (const auto& item : placed)
        if (item.built()) total += structureSpec(item.kind).residents;
    return total;
}

int Town::employed() const
{
    int total = 0;
    for (const auto& item : placed) total += item.workers;
    return total;
}

void Town::staff()
{
    recount();
    for (bool farms : {true, false})
        for (auto& item : placed) {
            if ((item.kind == Structure::Farm) != farms || !item.built()) continue;
            int cap = item.wanted < 0 ? structureSpec(item.kind).jobs : item.wanted;
            for (auto& person : folk) {
                if (item.workers >= cap) break;
                if (person.role != Role::Resident || person.job >= 0 || !person.autoMode || person.ordered) continue;
                person.job = item.id;
                ++item.workers;
            }
        }
}

bool Town::roadAccess(const Footprint& footprint) const
{
    for (const auto& segment : network.segments())
        if (touches(footprint, segment.a, segment.b, roadHalfWidth + .7f)) return true;
    return false;
}

int Town::constructionRoad(int id) const
{
    const auto* place = building(id);
    if (!place || place->built() || place->progress > 0) return -1;
    auto footprint = place->footprint();
    float margin = roadHalfWidth + .7f, best = std::numeric_limits<float>::infinity();
    int found = -1;
    for (const auto& road : network.roads()) {
        bool beside = false;
        for (size_t i = 1; i < road.line.size() && !beside; ++i) beside = touches(footprint, road.line[i - 1], road.line[i], margin);
        if (!beside) continue;
        if (roadReady(road.id)) {
            auto laid = road.laidLine();
            for (size_t i = 1; i < laid.size(); ++i)
                if (touches(footprint, laid[i - 1], laid[i], margin)) return -1;
        }
        // The stretch of its chain that can be laid or mended now.
        if (const auto* work = network.road(roadWorkTarget(road.id)); work && (work->built < 1 || work->wear >= 1)) {
            float gap = distance(work->workPoint(), place->center);
            if (gap < best) { best = gap; found = work->id; }
        }
    }
    return found;
}

bool Town::touchesSettlement(Point end) const
{
    if (network.distance(end) <= joinReach || (camp() && distance(end, camp()->center) <= 1.3f)) return true;
    return std::any_of(placed.begin(), placed.end(), [&](const Building& b) { return b.footprint().contains(end, joinReach); });
}

bool Town::near(Point center, float radius, bool (*match)(Structure)) const
{
    return std::any_of(placed.begin(), placed.end(), [&](const Building& b) { return match(b.kind) && distance(b.center, center) <= radius; });
}

int Town::nearbyTiles(Point center, float radius, bool (*match)(const Tile&)) const
{
    int count = 0;
    for (int y = int(center.y - radius) - 1; y <= int(center.y + radius) + 1; ++y)
        for (int x = int(center.x - radius) - 1; x <= int(center.x + radius) + 1; ++x)
            if (world.inside(x, y) && distance({x + .5f, y + .5f}, center) <= radius && match(world.at(x, y))) ++count;
    return count;
}

int Town::clearTrees(const std::vector<Point>& points)
{
    int wood = 0;
    for (auto p : points) {
        int x = int(std::floor(p.x)), y = int(std::floor(p.y));
        if (!world.inside(x, y)) continue;
        auto& cell = world.at(x, y);
        wood += cell.trees * 2;
        cell.trees = 0;
    }
    return wood;
}

void Town::reveal(float x, float y, float radius)
{
    world.reveal(x, y, radius);
    for (auto site : world.discover()) {
        const auto& found = world.dungeons()[size_t(site)];
        notify("Discovered " + found.name + ", a way to " + worldName(world.destination(found)));
    }
}

std::string Town::takeNotice()
{
    if (notices.empty()) return {};
    auto text = std::move(notices.front());
    notices.pop_front();
    int repeats = 1;
    while (!notices.empty() && notices.front() == text) {
        notices.pop_front();
        ++repeats;
    }
    return repeats > 1 ? text + " (x" + std::to_string(repeats) + ")" : text;
}
}  // namespace hearthold

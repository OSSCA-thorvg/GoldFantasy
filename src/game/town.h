#pragma once

#include "building_catalog.h"
#include "climate.h"
#include "person.h"
#include "road_network.h"
#include "walk_paths.h"
#include "world_map.h"
#include "woodcutting.h"
#include "unit_status.h"
#include "mining.h"
#include <cmath>
#include <filesystem>
#include <deque>
#include <string>
#include <vector>

namespace hearthold
{
struct CharacterPreset;
class MapDocument;
struct Building
{
    int id;
    Structure kind;
    Point center;
    float angle;  // Radians about the vertical axis; the model's +y wall is its front.
    uint32_t variant;
    int workers = 0;           // People holding a job here.
    int wanted = -1;           // Player's cap on workers; -1 fills every job.
    int growth = 0;            // Days spent meeting the growth need.
    uint32_t version = 0;      // Bumped when the building turns into its next stage.
    std::vector<Stage> replaced;  // Stages the latest version morphs out of.
    float progress = 1;        // Construction, 0..1; only finished buildings shelter or employ.
    float workedSeconds = 0;   // Worker presence today.
    float attendance = 1;      // Yesterday's presence share, scaling output.
    int earned = 0;            // Gold guests paid here since the last upgrade.
    int registered = 0;        // Adventurers on a guild's rolls.
    Faith faith = Faith::Dawn; // A chapel's creed.
    int owner = -1;            // Resident who bought this home; -1 while the settlement lets it.

    float health = 1;          // Monster damage takes it to 0, when it falls; builders mend it.

    bool built() const { return progress >= 1; }
    Footprint footprint() const;
    // Corner of the unturned footprint, where the model's (0, 0) sits.
    Point corner() const;
    // Exterior approach aligned with the asset's authored doorway.
    Point door() const;
    Point threshold() const;
};

// Freely outlined farmland tended from a nearby farmhouse.
struct Field
{
    int id;
    Outline outline;
    int acres() const;  // Whole square units.
};

// Where a building would go: snapped beside a road when one is near, else free.
struct Placement
{
    Point center;
    float angle = 0;
    bool snapped = false;
};

struct Check
{
    bool ok = false;
    std::string reason;
    Resources cost;
};

enum class Season : uint8_t { Spring, Summer, Autumn, Winter };
const char* seasonName(Season);

struct Calendar
{
    int day = 1, month = 1, year = 1;
    Season season = Season::Spring;
};

// Why a building is or is not maturing, for the inspector.
struct GrowthStatus
{
    bool grows = false;  // Has a next stage at all.
    bool ready = false;  // The need is met today.
    int days = 0, needed = 0;
    std::string next, reason;
};

// Settlement rules: costs, terrain, roads, construction, named people and their needs, guests,
// weather, seasons, growth and the passage of days.
class Town
{
public:
    static constexpr double secondsPerDay = 300;
    static constexpr int daysPerMonth = 5;
    static constexpr float maxRoadLength = 24;
    static constexpr float maxBridgeSpan = 7;  // Water one bridge may cross.
    static constexpr float roadHalfWidth = .3f;
    static constexpr int maxFieldAcres = 48;
    static constexpr float farmReach = 6;
    static constexpr float joinReach = .8f;  // A road end this close to a road or the camp connects.
    static constexpr float campReach = 12;   // The camp must stand this close to a known dungeon.
    static constexpr int maxPeople = 30;     // Residents and guests together.

    bool saveGame(const std::filesystem::path&, std::string& error) const;
    static std::optional<Town> loadGame(const std::filesystem::path&, std::string& error);
    explicit Town(uint32_t seed, int mapSize = 176);
    explicit Town(WorldMap, bool founders = true);
    // Render-only maps do not need a simulation navigation grid or founding settlers.
    struct MapPreview {};
    explicit Town(WorldMap, MapPreview);
    void updateMapPreview(const MapDocument&, TileRegion);

    const WorldMap& map() const { return world; }
    const RoadNetwork& roads() const { return network; }
    const WalkGrid& walking() const { return grid; }
    const std::vector<Building>& buildings() const { return placed; }
    const std::vector<Field>& fields() const { return farmland; }
    const std::vector<Person>& people() const { return folk; }
    const Building* building(int id) const;
    const Person* person(int id) const;
    bool editPerson(int id, Point position, float health);
    bool editBuilding(int id, Point center, float angle, float progress, float health);
    bool editHour(double hour);
    bool customizePerson(int id, const CharacterPreset&);
    const Building* camp() const;
    bool opened(int dungeon) const { return dungeon >= 0 && size_t(dungeon) < open.size() && open[size_t(dungeon)]; }
    // Building or field id under a point, or -1.
    int buildingAt(Point) const;
    int fieldAt(Point) const;
    const Field* field(int id) const;

    // Faces the nearest road within reach of the cursor, else keeps `freeAngle`.
    Placement fit(Structure, Point cursor, float freeAngle) const;
    Check canPlace(Structure, Point center, float angle) const;
    // Lays out a construction site; settlers raise it over time.
    bool place(Structure, Point center, float angle);
    // Finishes every site at once, for the demo and tests.
    void completeConstruction();
    // Adds people at the camp, for the demo and tests.
    void recruit(Role, Calling, int count);
    Check canBuildRoad(const RoadPath&) const;
    bool buildRoad(const RoadPath&);
    // Edits keep the road's id; only added length costs gold.
    Check canReshapeRoad(int id, const RoadPath&) const;
    bool reshapeRoad(int id, const RoadPath&);
    // Upgrading a laid dirt road to cobbles; builders do the paving.
    Check canPave(int road) const;
    bool pave(int road);
    Check canPlantField(const Outline&) const;
    bool plantField(const Outline&);
    Check canDemolish(Point) const;
    bool demolish(Point);
    // Prize from events such as the monthly fair.
    void reward(const Resources& prize) { treasury += prize; }
    // Gold into one person's purse: an inheritance, a lucky find.
    void bestow(int person, int gold);
    // Reveals land around a point, discovering any dungeon in it.
    void scout(float x, float y, float radius) { reveal(x, y, radius); ++changes; }
    // Sets the player's cap and staffs up to it from the residents without a job.
    bool setWorkers(int id, int workers);

    // Direct orders for residents; guests go their own way.
    void orderMove(const std::vector<int>& ids, Point to);
    void approachOrder(const std::vector<int>& ids, Point to);
    bool orderBuild(const std::vector<int>& ids, int site);
    bool assignJob(const std::vector<int>& ids, int building);
    bool orderRelax(const std::vector<int>& ids, int tavern);
    bool orderRest(const std::vector<int>& ids, int home);
    bool orderLeave(const std::vector<int>& ids);
    std::vector<int> occupants(int building) const;
    int shelterOf(const Person&) const;
    bool orderChop(const std::vector<int>& ids, int cell);
    bool orderMine(const std::vector<int>& ids, int cell);
    void orderStop(const std::vector<int>& ids);
    void setAuto(int person, bool enabled);
    // Sends residents to lay or pave a road.
    bool orderRoadwork(const std::vector<int>& ids, int road);
    // Work about a point, as a right click on open ground asks: a building site or damaged building there first,
    // then a road wanting work, then the nearest tree or rock. False when there is none to take up.
    bool orderWorkNear(const std::vector<int>& ids, Point at);
    std::optional<Point> roadWorkPosition(int road) const;
    // Sends the selected people after one monster, guests included.
    bool orderAttack(const std::vector<int>& ids, int monster);
    // Walks residents to a point, fighting any monster met on the way.
    void orderAttackMove(const std::vector<int>& ids, Point to);
    // The monster nearest a point within reach, or -1.
    int monsterAt(Point, float reach) const;
    // Lets a guest settle now if a home is free, for tests.
    bool settle(int id);
    bool setFaith(int chapel, Faith);
    // A staffed workshop of this kind stands; outfitters arm, armour and heal everyone.
    bool staffed(Structure) const;
    // Sends residents into a known dungeon; they return days later with loot, wounds, or not at all.
    Check canSendExpedition(const std::vector<int>& ids, int dungeon) const;
    bool sendExpedition(const std::vector<int>& ids, int dungeon);
    const std::vector<Monster>& monsters() const { return beasts; }
    // Blows struck in the last couple of seconds, oldest first.
    const std::vector<Hit>& hits() const { return blows; }
    const std::vector<TreeWorkEvent>& treeEvents() const { return timberEvents; }
    const std::vector<Expedition>& expeditions() const { return parties; }
    bool raiding() const;
    // Every night brings a raid; packs from earlier nights still prowling cap how many more come.
    static constexpr int maxRaiders = 16;
    // Starts tonight's raid now, for tests and the demo.
    void summonRaid();
    // Raids summoned so far, so each can be heard arriving.
    int raids() const { return raidCount; }
    // A bard is in town, not away or on their way out: the music plays.
    bool bardPlaying() const;
    // Sets a wandering monster loose at a point, for tests and the demo.
    void releaseMonster(Point at);
    // How well guests speak of the settlement, 0..100: hurt guests lower it, content ones raise it,
    // and guests come more often the higher it is.
    int renown() const { return int(std::lround(fame)); }
    // Where newcomers walk in from: the farthest road end, else ground in the wilds the camp can reach.
    Point gateway() const;

    // Advances the clock; true when a new day began.
    bool advance(double seconds);
    double clock() const { return time; }
    Calendar calendar() const;
    float dayFraction() const;   // 0 = midnight.
    float yearFraction() const;  // 0 = first day of spring.
    const Climate& climate() const { return sky.now(); }
    Sky& weather() { return sky; }
    // Discoveries, arrivals, upgrades, harvests and seasons, oldest first; repeats fold into one "(x3)".
    std::string takeNotice();

    const Resources& stock() const { return treasury; }
    // How much wood, stone, food and water the settlement can keep: the seat's yard plus storehouses.
    Resources capacity() const;
    bool parched() const { return thirst; }
    int gold() const { return treasury.gold; }
    int wood() const { return treasury.wood; }
    int population() const;  // Residents.
    int guests() const;
    int guestBeds() const;
    int housing() const;
    int employed() const;
    int idle() const { return population() - employed(); }
    // Field acres the farmhouses' farmers can tend, out of all field acres.
    int tendedFieldAcres() const;
    int fieldAcres() const;
    // Daily output of one building at its current staffing and attendance.
    Resources dailyOutput(const Building&) const;
    GrowthStatus growthStatus(const Building&) const;
    // Yesterday's flow of gold between the treasury and the people.
    struct Ledger
    {
        int wages = 0, rent = 0, sales = 0, guests = 0, bounty = 0;
        int eaten = 0, drunk = 0;  // Food and water used.
    };
    // What a day is expected to bring at today's staffing: gold out and in, goods made and used.
    struct Forecast
    {
        int wages = 0, rent = 0, guests = 0, bounty = 0;
        Resources made, used;
        int net() const { return rent + guests + bounty + made.gold - wages; }  // Markets make gold too.
    };
    Forecast forecast() const;
    const Ledger& ledger() const { return yesterday; }
    int wageOf(const Person&) const;
    // What weighs on or lifts a person, for the status panel.
    std::vector<std::string> thoughts(const Person&) const;
    std::vector<Condition> conditions(const Person&) const;
    // Bumped on every change the renderer must rebuild for.
    uint64_t revision() const { return changes; }
    // Road progress repaints roads and junction lights without rebuilding the settlement.
    uint64_t roadRevision() const { return roadChanges; }
    uint64_t objectRevision() const { return changes - roadOnlyChanges; }

private:
    friend class SaveArchive;
    void roadChanged(bool onlyRoad = true)
    {
        ++changes;
        ++roadChanges;
        if (onlyRoad) ++roadOnlyChanges;
    }
    Check checkRoad(const RoadPath&, int ignore, float paid) const;
    bool connectRoad(Road&) const;
    bool roadReady(int) const;
    int roadWorkTarget(int) const;
    // Why a footprint or outline cannot take this ground, or empty.
    std::string groundProblem(const std::vector<Point>& samples) const;
    bool roadAccess(const Footprint&) const;
    bool touchesSettlement(Point end) const;
    bool near(Point center, float radius, bool (*match)(Structure)) const;
    int nearbyTiles(Point center, float radius, bool (*match)(const Tile&)) const;
    int clearTrees(const std::vector<Point>& samples);
    void reveal(float x, float y, float radius);
    void newDay();
    void grow();
    bool mergeManor(const Building&);
    bool needMet(const Building&, std::string& reason) const;
    // Felled woods slowly grow back where nothing stands.
    void regrow();
    // Wages out of the treasury, rent in, and homes bought by residents who saved enough.
    void settleAccounts();
    // Adds produce, keeping only what fits in storage.
    void store(const Resources& gain);
    // Residents without a job take open jobs, farms first.
    void staff();
    void recount();
    // Moves one worker to this building from the workplace that can best spare them.
    void borrowWorker(Building& to);
    // People simulation, in town_people.cpp.
    void tick(double dt);
    void think(Person&);
    void setOrder(Person&, Activity, int site = -1);
    void moveOrder(const std::vector<int>&, Point, bool attack);
    bool resumeOrder(Person&);
    bool eat(Person&);
    bool takeBreak(Person&);
    void arrive(Person&);
    const Building* cargoStorage(Point) const;
    bool startFelling(Person&, Point around, float reach);
    bool fellTree(Person&, int cell);
    bool startMining(Person&, Point around, float reach);
    bool startHarvest(Person&, Point around, float reach, Product kind = Product::None);
    bool harvest(Person&, int cell, Product);
    bool resourceNearby(Point around, float reach, Product) const;
    bool orderHarvest(const std::vector<int>&, int cell, Product);
    int constructionTree(const Person&, Activity, int target) const;
    // The road an unstarted site waits on until a laid road reaches it, or -1.
    int constructionRoad(int site) const;
    // Sends a builder to lay that road first; false when the site needs none or it cannot be reached.
    bool layRoadFirst(Person&, int site);
    bool storageFoundation(const Person&) const;
    bool haulCargo(Person&);
    bool walkTo(Person&, Point);
    void refreshShelter(Person&);
    float walkingSpeed(const Person&) const;
    void walk(Person&, double dt);
    void admitGuests(double dt);
    // A guest walks in through the gate, or the portal when one stands.
    void welcome(Calling, const Building* gate);
    void settleGuests();
    // Makes a guest a resident; returns the settling fee paid.
    int naturalize(Person&);
    void assignHomes();
    void enforceGuestLodging(Person&);
    const Building* nearest(Point, bool (*match)(const Building&)) const;
    Building* site(int id);
    bool workHours() const;
    Person makePerson(Role, Calling, Point);
    // Monsters and expeditions, in town_monsters.cpp.
    void stir(double dt);
    void fight(Person&, double dt);
    void strike(Person&, Monster&);
    void returnFrom(Expedition&);
    // A monster's blow on a building or the road under it; buildings that fall are razed.
    void wreck(Monster&, double dt);
    void raze(int building);
    void hurtGuest(const Person&, bool killed);
    float power(const Person&) const;
    // Takes gold from a person's purse for a service here; false when they cannot pay.
    bool charge(Person&, Building*, int gold);
    // The bigger footprint an upgrade needs is clear of other buildings and bad ground.
    bool roomToGrow(const Building&, Structure next) const;
    float roll();
    void notify(std::string text) { notices.push_back(std::move(text)); }

    WorldMap world;
    RoadNetwork network;
    std::vector<Building> placed;
    std::vector<Field> farmland;
    std::vector<Person> folk;
    WalkGrid grid;
    Sky sky;
    std::vector<uint8_t> open;  // Dungeons an adventurers' guild has opened.
    std::vector<int> depth;     // Expeditions that came back from each dungeon.
    std::vector<Monster> beasts;
    std::vector<Expedition> parties;
    int nextMonster = 0;
    int raidedDay = -1, raidCount = 0;
    int raidKills = 0, raidBounty = 0;
    float fame = 50;
    Ledger today, yesterday;
    std::vector<Hit> blows;
    uint64_t nextBlow = 0;
    std::vector<TreeWorkEvent> timberEvents;
    uint64_t nextTreeEvent = 0;
    float growingTended = 0;  // Tended acres summed over this year's growing days.
    int growingDays = 0;
    Resources treasury{240, 80, 20, 110, 0, 100};  // Wages, food and water for the founders' first weeks.
    bool thirst = false;      // The water ran out today.
    int spoiledDay = -1;      // Last day produce was lost for want of storage.
    int nextId = 0, nextPerson = 0;
    double time = 0;
    int days = 0;
    double arrivalTimer = 1;  // Days until the next guest may arrive.
    double bardDue = -1;      // Clock time a bard drawn by the tavern arrives; -1 while none is on the way.
    uint64_t walkRevision = 0;
    uint32_t dice;
    std::deque<std::string> notices;
    uint64_t changes = 1, roadChanges = 1, roadOnlyChanges = 0;
};
}  // namespace hearthold

#pragma once

#include "iso_projection.h"
#include "person_appearance.h"
#include "race.h"
#include <algorithm>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace hearthold
{
// Residents live and work here; guests are travellers, bards and adventurers who may settle.
enum class Role : uint8_t { Resident, Guest };
// A bard comes to play at a tavern, and while one is in town the music plays.
enum class Calling : uint8_t { Settler, Traveller, Warrior, Ranger, Mage, Cleric, Bard };
const char* callingName(Calling);

enum class Activity : uint8_t { Idle, Moving, Holding, Building, Roadwork, Working, Eating, Sleeping, Relaxing, Exploring, Brooding, Arriving, Leaving, Guarding, Fighting, Expedition, Praying, Shopping, Hauling, Felling, Collecting, Mining };
const char* activityName(Activity);

// A monster prowling its lair by day, raiding the settlement by night.
struct Monster
{
    int id;
    int lair;  // Dungeon index: where a raider came from, or the kind a wanderer is.
    Point position;
    std::vector<Point> path;
    float health = 3;
    bool raider = false;
    bool angry = false;  // A wanderer provoked into a fight.
    double ready = 0;  // Clock time of its next bite.
    Point home = {};   // Where a wanderer roams.
    int prey = -1;     // Building a raider is making for.
};

// One blow in a fight, kept briefly so the renderer can show it.
struct Hit
{
    uint64_t serial;
    Point from, to;   // Attacker and target.
    int damage;       // In hit points: people have 100, monsters ten per unit of health.
    bool onPerson;    // A monster hurt someone, rather than someone hurting a monster.
    bool ranged;      // Arrow or spell.
    double at;        // Clock time.
    int person = -1;  // Person who struck or received the blow; buildings have no speaker.
};

// Residents sent into a dungeon together.
struct Expedition
{
    int dungeon;
    std::vector<int> members;
    double returnAt = -1;  // Set once the whole party is inside.
};

// One named person. Needs run 0..1 where 1 is satisfied; stress runs 0 (calm) .. 1 (breaking).
struct Person
{
    int id;
    std::string name;
    Role role;
    Calling calling;
    Race race;
    uint32_t look;
    Point position;
    std::vector<Point> path;  // Remaining waypoints, nearest first.
    Activity activity = Activity::Idle;
    int target = -1;       // Building id, road id for roadwork, or dungeon index while exploring.
    double until = 0;      // Clock time the current activity ends.
    bool inside = false;   // Sheltered in a building or a dungeon; doorway motion controls visibility.
    bool ordered = false;  // Following the player's order; needs wait.
    // A building or road the player set them to: resumed after meals and fights, day or night,
    // until it is done or they are exhausted.
    Activity task = Activity::Idle;
    int taskSite = -1;
    float food = .8f, rest = .9f, stress = .15f, health = 1;
    int home = -1, job = -1, bed = -1;
    bool autoMode = true;
    double ready = 0;      // Clock time of the next blow in a fight.
    int foe = -1;          // Monster the player told them to attack.
    int tree = -1;         // Resource cell (y * width + x) being felled or mined.
    int carrying = 0;      // Resources on their back, added to stock on delivery.
    Product carriedProduct = Product::Wood;
    bool aggressive = false;  // Attack-moving: fights what it meets on the way to `goal`.
    bool approachingOrder = false;
    Point goal = {};
    int days = 0;          // Days in the settlement.
    int loot = 0;          // Gold carried back from the dungeon.
    double relaxedAt = -1e9;  // Clock time of the last tavern visit.
    double prayedAt = -1e9;
    float load = 0;           // Seconds of work since goods were last carried off.
    float breaking = 0;       // Days spent at the end of their tether.
    int gear = 0;             // Kit an adventurer has bought: each piece adds to their power.
    int purse = 0;            // Their own gold: wages in, rent and spending out.
    float worked = 0;         // Seconds of paid work today.
    bool unpaid = false;      // Went without wages or behind on rent yesterday.
    bool sleptOutside = false;
    std::optional<Appearance> customLook = {};
    uint64_t lookRevision = 0;
    Point entrance{}, threshold{};
    float doorway = 0;  // 0 at the exterior approach, 1 across the threshold.
    Faith faith = Faith::Dawn;  // Belief belongs to a character, independently of species or appearance.
    std::string past = {};  // How the founders were born of Ymir; empty for those who came later.

    bool moving() const { return !path.empty(); }
    bool crossingDoorway() const { return inside ? doorway < 1 : doorway > 0; }
    float visibility() const
    {
        float length = distance(entrance, threshold);
        float visible = std::clamp((1 - doorway) * length / std::max(.001f, std::min(.35f, length)), 0.f, 1.f);
        if (length < .001f) visible = 1 - doorway;
        return visible * visible * (3 - 2 * visible);
    }
};

// Who fights, delves dungeons and signs a guild's rolls.
inline bool adventurer(const Person& p) { return p.calling == Calling::Warrior || p.calling == Calling::Ranger || p.calling == Calling::Mage || p.calling == Calling::Cleric; }
}  // namespace hearthold

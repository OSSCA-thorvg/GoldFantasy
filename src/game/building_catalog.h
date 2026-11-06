#pragma once

#include <GameEngine/GameFramework/building_model.h>
#include <cstdint>
#include <string>
#include <vector>

namespace hearthold
{
enum class Structure : uint8_t
{
    Camp,
    Tent, Cottage, Townhouse, Manor,        // Homes grow in place; four townhouses merge into a manor.
    MarketStalls, MarketHall, Bazaar,      // Trade.
    Farm, Lumberyard, Quarry,              // Workplaces; a farm is the farmhouse that tends drawn fields.
    Well, Storehouse,                      // Water, and room to keep what is made.
    Shrine, MageTower, Portal,             // Arcane.
    Tavern, Hostel, Inn, GrandInn, Guild, GuildHall,  // Leisure and the dungeon trade; they grow in place.
    Chapel, Weaponsmith, Armorer, Apothecary,         // Faith and the adventurers' outfitters.
    Palisade, Keep, Castle,                // The camp grows into the seat of the realm.
    Count
};

struct Resources
{
    int gold = 0, wood = 0, stone = 0, food = 0, mana = 0, water = 0;

    bool covers(const Resources& cost) const
    {
        return gold >= cost.gold && wood >= cost.wood && stone >= cost.stone && food >= cost.food && mana >= cost.mana && water >= cost.water;
    }
    Resources& operator+=(const Resources& other)
    {
        gold += other.gold, wood += other.wood, stone += other.stone, food += other.food, mana += other.mana, water += other.water;
        return *this;
    }
    Resources& operator-=(const Resources& other)
    {
        gold -= other.gold, wood -= other.wood, stone -= other.stone, food -= other.food, mana -= other.mana, water -= other.water;
        return *this;
    }
    bool empty() const { return !gold && !wood && !stone && !food && !mana && !water; }
};
// "20 gold, 10 wood"; empty costs read "free".
std::string describe(const Resources&);

// What a building waits for before it matures into its next stage.
// Occupancy: the home is full and the settlement has `needAmount` residents. Income: the building
// has earned `needAmount` gold. Registry: `needAmount` adventurers signed up at the guild.
enum class GrowthNeed : uint8_t { None, Food, Market, Workers, Merge, Population, Occupancy, Income, Registry };

// Faiths a chapel may follow; character beliefs are independent of species.
enum class Faith : uint8_t { Dawn, Grove, Forge, Moon, Count };
const char* faithName(Faith);

enum class Product : uint8_t { None, Food, Wood, Stone, Goods, Mana, Water };

struct StructureSpec
{
    const char* name;
    const char* description;
    int size;  // Square footprint in tiles.
    Resources cost;
    int residents, jobs;
    int requiredPopulation;
    bool buildable;
    Product product;
    int perWorker;  // Daily output per assigned worker.
    Structure next = Structure::Count;
    int growthDays = 0;
    GrowthNeed need = GrowthNeed::None;
    int needAmount = 0;  // Workers or population for the need.
    Resources upgradeCost = {};
    int beds = 0;  // Guests an inn can lodge.
    int storage = 0;  // Extra room for each of wood, stone, food and water.
};

const StructureSpec& structureSpec(Structure);
bool isHome(Structure);
bool isMarket(Structure);
bool isLodging(Structure);
// The camp and what it grows into: fort, keep, castle.
bool isSeat(Structure);
bool isOutfitter(Structure);
// Daily rent a resident pays for a home, and what it costs to buy it outright.
int rentOf(Structure);
int priceOf(Structure);
// Seconds of one builder's work to raise it.
float buildWork(Structure);

using gameframework::Rgb;
using gameframework::RoofShape;
using gameframework::Trim;
using gameframework::Ornament;
using gameframework::Block;
using gameframework::Patch;
using gameframework::Model;
using gameframework::orientModel;
using gameframework::splitAngle;

// A stage being replaced by an upgrade or merge, offset in tiles from the new footprint.
struct Stage
{
    Structure kind;
    uint32_t variant;
    float dx = 0, dy = 0;
};

// Variant picks colours, gable orientation and small extras so streets don't look stamped.
Model structureModel(Structure, uint32_t variant);
}  // namespace hearthold

#include "building_catalog.h"
#include <array>

namespace hearthold
{
namespace
{
using S = Structure;
const std::array<StructureSpec, size_t(S::Count)> specs{{
    {"Camp", "The first fire, near a dungeon. Shelters five; with twelve residents it becomes a palisade fort.", 1, {}, 5, 0, 0, true, Product::None, 0,
     S::Palisade, 3, GrowthNeed::Population, 12, {40, 60, 0, 0, 0}},
    {"Tent", "A first shelter for two. Once full, in a settlement of six, it becomes a cottage.", 1, {0, 5, 0, 0, 0}, 2, 0, 0, true, Product::None, 0,
     S::Cottage, 2, GrowthNeed::Occupancy, 6, {0, 5, 0, 0, 0}},
    {"Cottage", "A timber-framed home for four. Once full, in a town of fourteen, it becomes a townhouse.", 1, {}, 4, 0, 0, false, Product::None, 0,
     S::Townhouse, 4, GrowthNeed::Occupancy, 14, {0, 15, 10, 0, 0}},
    {"Townhouse", "Two storeys. In a town of twenty-four, four huddled together merge into a manor.", 1, {}, 6, 0, 0, false, Product::None, 0,
     S::Manor, 5, GrowthNeed::Merge, 24, {30, 0, 30, 0, 0}},
    {"Manor", "A noble household with its own tower.", 2, {}, 28, 0, 0, false, Product::None, 0},
    {"Market stalls", "Traders' tents. Staff them to grow a market hall.", 2, {30, 20, 0, 0, 0}, 0, 2, 4, true, Product::Goods, 3,
     S::MarketHall, 4, GrowthNeed::Workers, 1, {0, 30, 0, 0, 0}},
    {"Market hall", "A covered hall. Fully staffed, it becomes a grand bazaar.", 2, {}, 0, 3, 0, false, Product::Goods, 3,
     S::Bazaar, 8, GrowthNeed::Workers, 3, {60, 0, 40, 0, 10}},
    {"Grand bazaar", "Caravans from distant lands trade here.", 2, {}, 0, 4, 0, false, Product::Goods, 4},
    {"Farmhouse", "Farmers tend fields within 6 paces; each farmer works 6 acres.", 1, {0, 15, 0, 0, 0}, 0, 3, 0, true, Product::Food, 6},
    {"Lumberyard", "Woodcutters fell the trees within 4 paces and carry the logs in. Felled woods grow back slowly.", 1, {10, 5, 0, 0, 0}, 0, 2, 0, true, Product::Wood, 2},
    {"Quarry", "Stonecutters. Needs rocky ground within 3 paces.", 1, {20, 10, 0, 0, 0}, 0, 2, 0, true, Product::Stone, 2},
    {"Well", "Draws water for everyone; each person drinks one a day. Twice as much beside a lake or river.", 1, {5, 10, 10, 0, 0}, 0, 1, 0, true, Product::Water, 7},
    {"Storehouse", "Room for 300 more of each wood, stone, food and water. What does not fit is lost.", 2, {10, 35, 10, 0, 0}, 0, 0, 0, true, Product::None, 0,
     S::Count, 0, GrowthNeed::None, 0, {}, 0, 300},
    {"Shrine", "A rune-carved obelisk. Homes within 6 paces grow twice as fast.", 1, {20, 0, 20, 0, 0}, 0, 0, 4, true, Product::None, 0},
    {"Mage tower", "Draws mana from the ley lines.", 1, {40, 0, 40, 0, 0}, 0, 1, 10, true, Product::Mana, 1},
    {"Portal", "A ring of standing stones humming with mana. Guests of every people step through it, far more often and with fuller purses.", 2, {60, 0, 50, 0, 20}, 0, 0, 8, true, Product::None, 0},
    {"Tavern", "Ale, songs and dice. Settlers and guests shed their stress here; guests pay.", 1, {20, 25, 0, 0, 0}, 0, 1, 0, true, Product::None, 0},
    {"Hostel", "A long tent and a cook shed: three guest beds. Residents use their own homes. Once guests have paid it 40 gold it becomes an inn.", 2, {10, 25, 0, 0, 0}, 0, 1, 0, true, Product::None, 0,
     S::Inn, 1, GrowthNeed::Income, 40, {20, 30, 15, 0, 0}, 3},
    {"Inn", "Six guest beds under a timber roof. Earning 150 gold more makes it a grand inn.", 2, {}, 0, 1, 0, false, Product::None, 0,
     S::GrandInn, 1, GrowthNeed::Income, 150, {60, 40, 40, 0, 0}, 6},
    {"Grand inn", "Ten guest beds, a stable and a hall where adventurers trade tales.", 2, {}, 0, 2, 0, false, Product::None, 0,
     S::Count, 0, GrowthNeed::None, 0, {}, 10},
    {"Adventurers' guild", "Opens a dungeon within 10 paces. With eight adventurers on its rolls it becomes a guild hall.", 2, {40, 30, 20, 0, 0}, 0, 1, 0, true, Product::None, 0,
     S::GuildHall, 1, GrowthNeed::Registry, 8, {40, 0, 40, 0, 0}},
    {"Guild hall", "Renowned across the land: adventurers come twice as often and pay a larger cut.", 2, {}, 0, 2, 0, false, Product::None, 0},
    {"Chapel", "A house of prayer. Choose its faith: each draws more of one people and calms the faithful.", 2, {30, 30, 30, 0, 0}, 0, 1, 0, true, Product::None, 0},
    {"Weaponsmith", "Forges blades: staffed, residents and guards strike harder, and adventurers buy here.", 1, {25, 20, 15, 0, 0}, 0, 1, 0, true, Product::None, 0},
    {"Armorer", "Mail and shields: staffed, monsters wound your people less, and adventurers buy here.", 1, {25, 15, 25, 0, 0}, 0, 1, 0, true, Product::None, 0},
    {"Apothecary", "Potions and salves: staffed, the wounded heal twice as fast, and adventurers buy here.", 1, {20, 15, 0, 0, 5}, 0, 1, 0, true, Product::None, 0},
    {"Palisade fort", "The camp grown into a stockade. With twenty residents it is rebuilt in stone.", 3, {}, 8, 0, 0, false, Product::None, 0,
     S::Keep, 4, GrowthNeed::Population, 20, {0, 0, 60, 0, 0}},
    {"Stone keep", "Walls of stone. With twenty-six residents the realm raises a castle.", 3, {}, 10, 0, 0, false, Product::None, 0,
     S::Castle, 6, GrowthNeed::Population, 26, {100, 0, 60, 0, 20}},
    {"Castle", "The seat of your realm.", 3, {}, 12, 0, 0, false, Product::None, 0},
}};
}  // namespace

const StructureSpec& structureSpec(Structure kind) { return specs[size_t(kind)]; }

bool isHome(Structure kind) { return isSeat(kind) || kind == S::Tent || kind == S::Cottage || kind == S::Townhouse || kind == S::Manor; }

bool isMarket(Structure kind) { return kind == S::MarketStalls || kind == S::MarketHall || kind == S::Bazaar; }

bool isLodging(Structure kind) { return kind == S::Hostel || kind == S::Inn || kind == S::GrandInn; }

bool isSeat(Structure kind) { return kind == S::Camp || kind == S::Palisade || kind == S::Keep || kind == S::Castle; }

bool isOutfitter(Structure kind) { return kind == S::Weaponsmith || kind == S::Armorer || kind == S::Apothecary; }

int rentOf(Structure kind)
{
    switch (kind) {
    case S::Tent: return 1;
    case S::Cottage: return 2;
    case S::Townhouse: return 3;
    case S::Manor: return 6;
    default: return 0;  // The camp and its successors shelter for free.
    }
}

int priceOf(Structure kind)
{
    switch (kind) {
    case S::Tent: return 25;
    case S::Cottage: return 70;
    case S::Townhouse: return 140;
    case S::Manor: return 450;
    default: return 0;
    }
}

const char* faithName(Faith faith)
{
    switch (faith) {
    case Faith::Dawn: return "Order of the Dawn";
    case Faith::Grove: return "Grove Mother";
    case Faith::Forge: return "Forge Father";
    case Faith::Moon: return "Wild Moon";
    case Faith::Count: break;
    }
    return "";
}

float buildWork(Structure kind)
{
    const auto& cost = structureSpec(kind).cost;
    return 8 + (cost.wood + cost.stone + cost.gold / 2.f) * .6f;
}

std::string describe(const Resources& value)
{
    std::string text;
    auto add = [&](int amount, const char* name) {
        if (!amount) return;
        if (!text.empty()) text += ", ";
        text += std::to_string(amount) + " " + name;
    };
    add(value.gold, "gold");
    add(value.wood, "wood");
    add(value.stone, "stone");
    add(value.food, "food");
    add(value.mana, "mana");
    add(value.water, "water");
    return text.empty() ? "free" : text;
}
}  // namespace hearthold

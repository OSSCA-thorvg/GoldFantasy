#include "town.h"
#include <core/io/io.h>
#include <cstring>
#include <stdexcept>
#include <type_traits>
#include <unordered_set>

namespace hearthold
{
// Versioned archive. Derived navigation and rendering caches are rebuilt on load.
class SaveArchive
{
public:
    std::string bytes;
    size_t cursor = 0;
    bool reading = false;
    template<class... T> void fields(T&... values) { (value(values), ...); }
    template<class T> void value(T& v) requires std::is_trivially_copyable_v<T>
    {
        if (reading) {
            if (sizeof(T) > bytes.size() - cursor) throw std::runtime_error("Truncated save");
            std::memcpy(&v, bytes.data() + cursor, sizeof(T)); cursor += sizeof(T);
        } else bytes.append(reinterpret_cast<const char*>(&v), sizeof(T));
    }
    void value(std::string& v)
    {
        uint32_t count = uint32_t(v.size()); value(count);
        if (count > 1048576) throw std::runtime_error("Save string too large");
        if (reading) {
            if (count > bytes.size() - cursor) throw std::runtime_error("Truncated save");
            v.assign(bytes.data() + cursor, count); cursor += count;
        } else bytes.append(v);
    }
    template<class T> void value(std::vector<T>& v)
    {
        uint32_t count = uint32_t(v.size()); value(count);
        if (count > 2000000) throw std::runtime_error("Save collection too large");
        if (reading) v.resize(count);
        for (auto& item : v) value(item);
    }
    template<class T> void value(std::deque<T>& v)
    {
        uint32_t count = uint32_t(v.size()); value(count);
        if (count > 10000) throw std::runtime_error("Too many notices");
        if (reading) v.resize(count);
        for (auto& item : v) value(item);
    }
    template<class T> void value(std::optional<T>& v)
    {
        uint8_t present = v.has_value(); value(present);
        if (present > 1) throw std::runtime_error("Invalid optional");
        if (reading) { if (present) v.emplace(); else v.reset(); }
        if (v) value(*v);
    }
    void value(Dungeon& v) { fields(v.name, v.kind, v.origin, v.discovered); }
    void value(River& v) { fields(v.path, v.width); }
    void value(WorldMap& v)
    {
        fields(v.columns, v.rows, v.mapSeed, v.origin);
        if (v.columns < 32 || v.columns > 256 || v.rows < 32 || v.rows > 256) throw std::runtime_error("Invalid world dimensions");
        value(v.tiles);
        for (auto& layer : v.layers) value(layer);
        fields(v.stream, v.seen, v.sites, v.ymir, v.fire, v.laidOut);
        if (v.tiles.size() != size_t(v.columns * v.rows) || v.stream.path.size() != v.stream.width.size()) throw std::runtime_error("Invalid world data");
        for (auto& layer : v.layers) if (layer.size() != size_t((v.columns * 2 + 1) * (v.rows * 2 + 1))) throw std::runtime_error("Invalid world layers");
    }
    void value(Sky& v) { fields(v.climate, v.timer, v.state); }
    void value(Road& v) { fields(v.id, v.path, v.line, v.built, v.paved, v.paving, v.wear, v.constructionStart, v.parent, v.parentAt); }
    void value(RoadNetwork& v) { fields(v.list, v.nextId); }
    void value(Building& v)
    {
        fields(v.id, v.kind, v.center, v.angle, v.variant, v.workers, v.wanted, v.growth, v.version, v.replaced,
               v.progress, v.workedSeconds, v.attendance, v.earned, v.registered, v.faith, v.owner, v.health);
        if (size_t(v.kind) >= size_t(Structure::Count)) throw std::runtime_error("Invalid building kind");
    }
    void value(Field& v) { fields(v.id, v.outline); }
    void value(Monster& v) { fields(v.id, v.lair, v.position, v.path, v.health, v.raider, v.angry, v.ready, v.home, v.prey); }
    void value(Expedition& v) { fields(v.dungeon, v.members, v.returnAt); }
    void value(Person& v)
    {
        fields(v.id, v.name, v.role, v.calling, v.race, v.look, v.position, v.path, v.activity, v.target, v.until,
               v.inside, v.ordered, v.task, v.taskSite, v.food, v.rest, v.stress, v.health, v.home, v.job, v.bed,
               v.autoMode, v.ready, v.foe, v.tree, v.carrying, v.carriedProduct, v.aggressive, v.approachingOrder,
               v.goal, v.days, v.loot, v.relaxedAt, v.prayedAt, v.load, v.breaking, v.gear, v.purse, v.worked,
               v.unpaid, v.sleptOutside, v.customLook, v.lookRevision, v.entrance, v.threshold, v.doorway, v.faith, v.past);
    }
    void value(Town& v)
    {
        fields(v.world, v.network, v.placed, v.farmland, v.folk, v.sky, v.open, v.depth, v.beasts, v.parties,
               v.nextMonster, v.raidedDay, v.raidCount, v.raidKills, v.raidBounty, v.fame, v.today, v.yesterday,
               v.blows, v.nextBlow, v.timberEvents, v.nextTreeEvent, v.growingTended, v.growingDays, v.treasury,
               v.thirst, v.spoiledDay, v.nextId, v.nextPerson, v.time, v.days, v.arrivalTimer, v.bardDue, v.dice, v.notices);
        if (reading) {
            if (v.open.size() != v.world.sites.size() || v.depth.size() > v.world.sites.size() || !std::isfinite(v.time)) throw std::runtime_error("Invalid settlement");
            std::vector<Footprint> obstacles;
            for (auto& b : v.placed) obstacles.push_back(b.footprint());
            v.grid.rebuild(v.world, v.network, obstacles);
            v.walkRevision = v.changes = 1; v.roadChanges = 1; v.roadOnlyChanges = 0;
            v.recount();
        }
    }
};
namespace
{
constexpr size_t maxSaveBytes = 96 * 1024 * 1024;
uint64_t digest(std::string_view bytes)
{
    uint64_t hash = 14695981039346656037ull;
    for (unsigned char c : bytes) { hash ^= c; hash *= 1099511628211ull; }
    return hash;
}
}
bool Town::saveGame(const std::filesystem::path& path, std::string& error) const
{
    try {
        SaveArchive archive;
        uint32_t version = 1, endian = 0x01020304, appearanceSize = sizeof(Appearance);
        archive.fields(version, endian, appearanceSize);
        archive.value(const_cast<Town&>(*this));
        auto checksum = digest(archive.bytes); archive.value(checksum);
        std::string encoded = "GoldFantasy-save\n";
        constexpr char hex[] = "0123456789abcdef";
        for (unsigned char byte : archive.bytes) { encoded += hex[byte >> 4]; encoded += hex[byte & 15]; }
        std::error_code ec;
        if (path.has_parent_path()) std::filesystem::create_directories(path.parent_path(), ec);
        if (ec) throw std::runtime_error(ec.message());
        auto baseline = te::io::load(path, {true, maxSaveBytes});
        if (!baseline) throw std::runtime_error(baseline.error.message);
        auto saved = te::io::save(path, encoded, {{}, baseline.value.stamp, maxSaveBytes});
        if (!saved) throw std::runtime_error(saved.error.message);
        error.clear(); return true;
    } catch (const std::exception& e) { error = e.what(); return false; }
}
std::optional<Town> Town::loadGame(const std::filesystem::path& path, std::string& error)
{
    try {
        auto file = te::io::load(path, {false, maxSaveBytes});
        if (!file) throw std::runtime_error(file.error.message);
        std::string_view data = file.value.text;
        if (!data.starts_with("GoldFantasy-save\n")) throw std::runtime_error("Not a GoldFantasy save");
        data.remove_prefix(17);
        if (data.size() % 2 || data.size() < 40) throw std::runtime_error("Invalid save length");
        SaveArchive archive; archive.reading = true;
        auto nibble = [](char c) -> unsigned { if (c >= '0' && c <= '9') return c - '0'; if (c >= 'a' && c <= 'f') return c - 'a' + 10; throw std::runtime_error("Invalid save encoding"); };
        for (size_t i = 0; i < data.size(); i += 2) archive.bytes += char(nibble(data[i]) * 16 + nibble(data[i + 1]));
        uint64_t checksum; std::memcpy(&checksum, archive.bytes.data() + archive.bytes.size() - sizeof(checksum), sizeof(checksum));
        archive.bytes.resize(archive.bytes.size() - sizeof(checksum));
        if (digest(archive.bytes) != checksum) throw std::runtime_error("Save checksum mismatch");
        uint32_t version, endian, appearanceSize; archive.fields(version, endian, appearanceSize);
        if (version != 1 || endian != 0x01020304 || appearanceSize != sizeof(Appearance)) throw std::runtime_error("Unsupported save version");
        Town town(WorldMap{}, MapPreview{}); archive.value(town);
        if (archive.cursor != archive.bytes.size()) throw std::runtime_error("Unexpected trailing save data");
        error.clear(); return town;
    } catch (const std::exception& e) { error = e.what(); return {}; }
}
}

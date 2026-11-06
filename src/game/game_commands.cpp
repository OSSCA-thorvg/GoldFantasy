#include "game_app.h"
#include "tree_painter.h"
#include <limits>
#include <tuple>

namespace hearthold
{
namespace
{
// Automatic work a click may take a resident off; meals, rest, fights and journeys keep them.
bool interruptible(Activity activity)
{
    switch (activity) {
    case Activity::Idle: case Activity::Moving: case Activity::Holding: case Activity::Building: case Activity::Roadwork:
    case Activity::Working: case Activity::Hauling: case Activity::Felling: case Activity::Mining: case Activity::Collecting: return true;
    default: return false;
    }
}
}  // namespace

int GameApp::treeAtScreen(Point point) const
{
    auto ground = camera.toWorld(point, viewWidth, viewHeight);
    auto tile = unproject(ground.x, ground.y);
    int found = -1; float best = std::numeric_limits<float>::infinity();
    const auto& map = town.map();
    for (int y = std::max(0, int(tile.y) - 4); y <= std::min(map.height() - 1, int(tile.y) + 4); ++y)
        for (int x = std::max(0, int(tile.x) - 4); x <= std::min(map.width() - 1, int(tile.x) + 4); ++x)
            for (int index = 0; index < map.at(x, y).trees; ++index) {
                auto tree = treeAt(map, x, y, index);
                if (!map.revealed(tree.foot)) continue;
                auto feet = toScreen(tree.foot);
                float height = (5 + 38 * tree.slender) * tree.size * camera.zoom;
                float width = 11 * tree.size * camera.zoom + 3;
                if (point.y < feet.y - height || point.y > feet.y + 3 || std::abs(point.x - feet.x) > width) continue;
                float gap = distance(point, feet);
                if (gap < best) { best = gap; found = y * map.width() + x; }
            }
    return found;
}

int GameApp::rockAtScreen(Point point) const
{
    auto ground = camera.toWorld(point, viewWidth, viewHeight), tile = unproject(ground.x, ground.y);
    const auto& map = town.map(); int found = -1; float best = std::numeric_limits<float>::infinity();
    for (int y = std::max(0, int(tile.y) - 2); y <= std::min(map.height() - 1, int(tile.y) + 2); ++y)
        for (int x = std::max(0, int(tile.x) - 2); x <= std::min(map.width() - 1, int(tile.x) + 2); ++x) {
            auto foot = mining::position(x, y); if (!mining::deposit(map, x, y) || !map.revealed(foot)) continue;
            auto at = toScreen(foot); float size = mining::size(map, x, y) * camera.zoom;
            if (point.x < at.x - size - 3 || point.x > at.x + size + 3 || point.y < at.y - size * 1.1f - 3 || point.y > at.y + 5) continue;
            float gap = distance(point, at); if (gap < best) { best = gap; found = y * map.width() + x; }
        }
    return found;
}

int GameApp::buildingAtScreen(Point point) const
{
    auto at = camera.toWorld(point, viewWidth, viewHeight);
    int id = renderer.buildingDrawnAt(town, at);
    return id >= 0 ? id : town.buildingAt(unproject(at.x, at.y));
}

void GameApp::prepare(Order order)
{
    if (chosen.empty()) {
        if (selectedTree >= 0 && (order == Order::Attack || order == Order::Work)) { queueWork(Activity::Felling, selectedTree); cue(Cue::Order); }
        if (selectedRock >= 0 && (order == Order::Attack || order == Order::Work)) { queueWork(Activity::Mining, selectedRock); cue(Cue::Order); }
        return;
    }
    selectTool(Tool::Select); card = globalCard = -1; pending = order;
}

bool GameApp::targetingCursor() const
{
#if HEARTHOLD_WITH_EDITOR
    if (editor || atlas || buildings) return false;
#endif
    return pending != Order::None && mouse.x >= 0 && mouse.y >= 0 && mouse.x < viewWidth && mouse.y < viewHeight &&
           !panFrom && !context.controlAt(mouse.x, mouse.y);
}

void GameApp::openUnitBuild()
{
    if (chosen.empty()) return;
    selectTool(Tool::Select); card = 0; globalCard = -1; drawerPinned = true; drawerSuppressed = false;
}

void GameApp::toggleAuto()
{
    bool enabled = std::any_of(chosen.begin(), chosen.end(), [&](int id) {
        const auto* person = town.person(id); return person && !person->autoMode;
    });
    for (int id : chosen) { if (enabled) stoppedWork.erase(id); town.setAuto(id, enabled); }
}

void GameApp::stopSelected()
{
    town.orderStop(chosen);
    for (int id : chosen) stoppedWork[id] = workSerial;
    selectTool(Tool::Select); card = globalCard = -1; pending = Order::None; cancelPointer();
}

void GameApp::leaveSelected()
{
    if (!town.orderLeave(chosen)) return;
    for (int id : chosen) stoppedWork[id] = workSerial;
    selectTool(Tool::Select); card = globalCard = -1; pending = Order::None;
    cancelPointer(); cue(Cue::Order);
}

void GameApp::command() { issueOrder(Order::Work); }

void GameApp::issueOrder(Order order)
{
    status.clear();
    int monster = town.monsterAt(cursor, 1.2f), tree = treeAtScreen(mouse), rock = rockAtScreen(mouse);
    if (order == Order::Move) {
        town.orderMove(chosen, cursor);
    } else if (monster >= 0) {
        if (!town.orderAttack(chosen, monster)) town.orderMove(chosen, cursor);
    } else if (tree >= 0) {
        if (!town.orderChop(chosen, tree)) town.orderMove(chosen, cursor);
    } else if (rock >= 0) {
        if (!town.orderMine(chosen, rock)) town.orderMove(chosen, cursor);
    } else if (order == Order::Work) {
        int id = buildingAtScreen(mouse);
        const auto* place = town.building(id);
        if (place && !place->built()) { if (!town.orderBuild(chosen, id)) town.orderMove(chosen, cursor); }
        else if (place && isHome(place->kind)) {
            for (int person : chosen) {
                if (!town.orderRest({person}, id)) town.orderMove({person}, place->door());
            }
        }
        else if (place && structureSpec(place->kind).jobs > 0) { if (!town.assignJob(chosen, id)) town.orderMove(chosen, cursor); }
        else if (place && isLodging(place->kind)) {
            town.orderMove(chosen, place->door());
        }
        else if (const auto* road = town.roads().road(hoveredRoad()); road && (road->built < 1 || road->paving >= 0 || road->wear > 0)) town.orderRoadwork(chosen, road->id);
        else if (const auto* tile = town.map().cell(cursor); tile && tile->dungeon >= 0 && town.map().dungeons()[size_t(tile->dungeon)].discovered) {
            if (!town.sendExpedition(chosen, tile->dungeon)) town.orderMove(chosen, cursor);
        } else if (place || !town.orderWorkNear(chosen, cursor)) town.orderMove(chosen, place ? place->door() : cursor);
    } else if (order == Order::Attack) town.orderAttackMove(chosen, cursor);
    else town.orderMove(chosen, cursor);
    if (status.empty()) {
        if (order != Order::Move) town.approachOrder(chosen, cursor);
        cue(Cue::Order);
    }
}

void GameApp::queueWork(Activity activity, int target)
{
    auto existing = std::find_if(workQueue.begin(), workQueue.end(), [&](const QueuedWork& work) { return work.activity == activity && work.target == target; });
    if (existing == workQueue.end())
        workQueue.push_back({activity, target, ++workSerial});
    else existing->serial = ++workSerial;
    dispatchWork(true);
}

void GameApp::dispatchWork(bool force)
{
    if (!force && town.clock() >= lastDispatch && town.clock() - lastDispatch < .2) return;
    lastDispatch = town.clock();
    for (auto it = workQueue.begin(); it != workQueue.end();) {
        std::optional<Point> where;
        bool done = false;
        if (it->activity == Activity::Building) {
            const auto* place = town.building(it->target);
            done = !place || (place->built() && place->health >= 1);
            if (place) where = place->door();
        } else if (it->activity == Activity::Roadwork) {
            const auto* road = town.roads().road(it->target);
            done = !road || (road->built >= 1 && road->paving < 0 && road->wear <= 0);
            where = town.roadWorkPosition(it->target);
        } else {
            const auto& map = town.map();
            int x = it->target % map.width(), y = it->target / map.width();
            bool stone = it->activity == Activity::Mining;
            done = it->target < 0 || !map.inside(x, y) || (stone ? !mining::deposit(map, x, y) : !map.at(x, y).trees);
            if (!done) where = stone ? mining::position(x, y) : treePosition(map, x, y, map.at(x, y).trees - 1);
        }
        if (done) { it = workQueue.erase(it); continue; }
        bool assigned = std::any_of(town.people().begin(), town.people().end(), [&](const Person& p) {
            return p.health > 0 && p.activity != Activity::Leaving && p.task == it->activity && p.taskSite == it->target;
        });
        // Idle residents first; the request just clicked may also take one off automatic work.
        bool clicked = force && it->serial == workSerial;
        std::vector<std::tuple<bool, float, int>> candidates;
        if (where && !assigned) for (const auto& p : town.people()) {
            auto stopped = stoppedWork.find(p.id);
            if (p.role != Role::Resident || p.health <= 0 || p.ordered || p.task != Activity::Idle ||
                (stopped != stoppedWork.end() && stopped->second >= it->serial)) continue;
            bool idle = !p.moving() && (p.activity == Activity::Idle || p.activity == Activity::Holding);
            if (idle || (clicked && interruptible(p.activity))) candidates.emplace_back(!idle, distance(p.position, *where), p.id);
        }
        std::sort(candidates.begin(), candidates.end());
        for (auto [busy, gap, worker] : candidates) {
            bool started = it->activity == Activity::Building ? town.orderBuild({worker}, it->target) :
                           it->activity == Activity::Roadwork ? town.orderRoadwork({worker}, it->target) :
                           it->activity == Activity::Mining ? town.orderMine({worker}, it->target) : town.orderChop({worker}, it->target);
            if (started) break;
        }
        ++it;
    }
}

void GameApp::commandOverlay()
{
    if (selectedRock >= 0) {
        int x = selectedRock % town.map().width(), y = selectedRock / town.map().width();
        if (!mining::deposit(town.map(), x, y)) selectedRock = -1;
        else {
            auto p = toScreen(mining::position(x, y));
            context.paint(ui::paintKey("selected-rock", p.x, p.y), [&] {
                auto ring = tvg::Shape::gen(); ring->appendCircle(p.x, p.y, 11, 5); ring->fill(0, 0, 0, 0);
                ring->strokeWidth(1.5f); ring->strokeFill(theme.accent.r, theme.accent.g, theme.accent.b); return ring;
            });
        }
    }
    if (selectedTree >= 0) {
        int x = selectedTree % town.map().width(), y = selectedTree / town.map().width();
        if (!town.map().inside(x, y) || !town.map().at(x, y).trees) selectedTree = -1;
        else {
            auto foot = treePosition(town.map(), x, y, town.map().at(x, y).trees - 1);
            auto p = toScreen(foot);
            context.paint(ui::paintKey("selected-tree", p.x, p.y), [&] {
                auto ring = tvg::Shape::gen(); ring->appendCircle(p.x, p.y, 11, 5); ring->fill(0, 0, 0, 0);
                ring->strokeWidth(1.5f); ring->strokeFill(theme.accent.r, theme.accent.g, theme.accent.b); return ring;
            });
        }
    }
    if (!targetingCursor()) return;
    auto p = mouse; auto color = pending == Order::Attack ? theme.danger : pending == Order::Work ? theme.success : theme.accent;
    if (pending == Order::Attack) {
        context.line(p.x - 7, p.y - 7, p.x + 7, p.y + 7, color, 1.5f);
        context.line(p.x + 7, p.y - 7, p.x - 7, p.y + 7, color, 1.5f);
    } else if (pending == Order::Work) {
        context.line(p.x - 5, p.y + 7, p.x + 4, p.y - 7, color, 2);
        context.line(p.x + 1, p.y - 8, p.x + 9, p.y - 3, color, 4);
    } else {
        context.line(p.x - 8, p.y, p.x + 8, p.y, color, 1.5f);
        context.line(p.x, p.y - 8, p.x, p.y + 8, color, 1.5f);
    }
    const char* label = pending == Order::Attack ? "Attack" : pending == Order::Work ? "Work" : "Move";
    context.text({p.x + 13, p.y + 8, 90, 20}, label, color, 12, true);
}
}  // namespace hearthold

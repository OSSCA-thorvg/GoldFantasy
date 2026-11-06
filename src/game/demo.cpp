#include "game_app.h"
#include "application.h"
#include <iostream>

namespace hearthold
{
void buildDemo(hearthold::GameApp& game, double days)
{
    using hearthold::Point;
    using hearthold::RoadAnchor;
    using hearthold::Structure;
    auto& town = game.state();
    auto c = town.map().camp();
    auto at = [&](float x, float y) { return Point{c.x + x, c.y + y}; };
    auto sharp = [&](float x, float y) { return RoadAnchor::sharp(at(x, y)); };
    // An anchor whose handles leave along (hx, hy).
    auto smooth = [&](float x, float y, float hx, float hy) { auto p = at(x, y); return RoadAnchor{p, {p.x - hx, p.y - hy}, {p.x + hx, p.y + hy}}; };
    auto road = [&](hearthold::RoadPath path) {
        auto check = town.canBuildRoad(path);
        if (!town.buildRoad(path)) std::cerr << "demo: road: " << check.reason << '\n';
    };
    auto place = [&](Structure kind, Point cursor) {
        auto spot = town.fit(kind, cursor, 0);
        auto check = town.canPlace(kind, spot.center, spot.angle);
        if (!town.place(kind, spot.center, spot.angle)) std::cerr << "demo: " << hearthold::structureSpec(kind).name << ": " << check.reason << '\n';
    };
    auto field = [&](hearthold::Outline outline) {
        auto check = town.canPlantField(outline);
        if (!town.plantField(outline)) std::cerr << "demo: field: " << check.reason << '\n';
    };
    town.scout(c.x, c.y, 11);  // The settlers have looked around.
    if (!town.map().dungeons().empty()) town.scout(town.map().dungeons().front().origin.x + 1.f, town.map().dungeons().front().origin.y + 1.f, 5);
    place(Structure::Camp, c);
    town.completeConstruction();
    road({sharp(1, 0), smooth(5, .2f, 1.6f, 0), sharp(9, -.6f)});
    road({sharp(1, 0), sharp(1, -3)});
    road({sharp(1, -3), smooth(5, -3.1f, 1.6f, 0), sharp(8.5f, -2.2f)});
    road({{at(4.6f, .2f), at(4.6f, .2f), at(4.6f, 2.4f)}, {at(4.2f, 4.6f), at(5.4f, 3.2f), at(3, 6)}, sharp(3.6f, 8.6f)});
    for (float row : {-1.f, -2.f})
        for (int i = 0; i < 4; ++i) place(Structure::Tent, at(2.2f + i * 1.15f, row));
    place(Structure::Farm, at(6.6f, 1.2f));
    field({at(6.2f, 1.9f), at(9.8f, 1.2f), at(10.6f, 4.4f), at(6.9f, 4.6f)});
    place(Structure::Farm, at(4.6f, 7.2f));
    field({at(5.4f, 5.6f), at(8.6f, 5.9f), at(8.2f, 8.6f), at(5.6f, 8.4f)});
    town.completeConstruction();
    town.advance(hearthold::Town::secondsPerDay * 2);
    town.reward({100, 140, 60, 0, 0});  // A patron's gift and a band of settlers, so the demo can raise its whole street.
    town.recruit(hearthold::Role::Resident, hearthold::Calling::Settler, 6);
    town.recruit(hearthold::Role::Resident, hearthold::Calling::Warrior, 2);
    place(Structure::MarketStalls, at(2.6f, 1.6f));
    place(Structure::Shrine, at(7, -1));
    place(Structure::Tavern, at(8.2f, .5f));
    place(Structure::Hostel, at(10, -2.4f));
    place(Structure::Chapel, at(6.4f, -4.2f));
    // These go wherever they fit near the street: search outward from a spot.
    auto settle = [&](Structure kind, Point around) {
        for (int ring = 0; ring < 40; ++ring) {
            auto spot = town.fit(kind, around + gameframework::rotated({ring * .35f, 0}, ring * 2.4f), 0);
            if (town.place(kind, spot.center, spot.angle)) return;
        }
        std::cerr << "demo: no room for a " << hearthold::structureSpec(kind).name << '\n';
    };
    settle(Structure::Well, at(3, 1));
    settle(Structure::Storehouse, at(7, 1.5f));
    place(Structure::Weaponsmith, at(3.4f, -4.1f));
    place(Structure::Apothecary, at(4.6f, -4.1f));
    // A road out to the home dungeon with the adventurers' guild beside its end.
    if (!town.map().dungeons().empty()) {
        auto origin = town.map().dungeons().front().origin;
        Point lair{origin.x + 1.f, origin.y + 1.f};
        auto toward = gameframework::normalized(lair - c);
        Point from = c + toward * 1.2f, to = lair - toward * 4.5f;
        auto bend = c + (lair - c) * .5f + Point{-toward.y, toward.x} * 1.5f;
        road({RoadAnchor::sharp(from), {bend, bend - toward * 1.5f, bend + toward * 1.5f}, RoadAnchor::sharp(to)});
        auto spot = town.fit(Structure::Guild, to - toward * 1.4f + Point{-toward.y, toward.x} * 1.4f, 0);
        auto check = town.canPlace(Structure::Guild, spot.center, spot.angle);
        if (!town.place(Structure::Guild, spot.center, spot.angle)) std::cerr << "demo: guild: " << check.reason << '\n';
    }
    // A bridge out over the nearest water the settlers can see, if there is one.
    for (int turn = 0, built = 0; turn < 36 && !built; ++turn)
        for (float reach = 4; reach < 20 && !built; reach += 1) {
            auto toward = gameframework::rotated({1, 0}, turn * .1745f);
            hearthold::RoadPath path{RoadAnchor::sharp(c + toward * 1.3f), RoadAnchor::sharp(c + toward * reach)};
            auto check = town.canBuildRoad(path);
            if (check.ok && check.cost.wood > 0 && (built = town.buildRoad(path))) std::cerr << "demo: bridge\n";
        }
    town.completeConstruction();
    town.advance(hearthold::Town::secondsPerDay * days);
    // Show one person's card: a guest if one is about, else a resident.
    int shown = -1;
    for (const auto& person : town.people())
        if (!person.inside && (shown < 0 || person.role == hearthold::Role::Guest)) shown = person.id;
    if (shown >= 0) game.selectPeople({shown});
}

}

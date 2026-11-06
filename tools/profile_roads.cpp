// Reproducible, windowless CPU profiling of production roadwork/update code.
#include <game/map_document.h>
#include <game/road_graph.h>
#include <game/town.h>
#include <game/traffic.h>
#include <game/world_renderer.h>
#include <algorithm>
#include <chrono>
#include <fstream>
#include <iostream>
#include <iterator>
#include <memory>
#include <numeric>
#include <stdexcept>
#include <string>
#if !defined(_MSC_VER) && __has_include(<valgrind/callgrind.h>)
#include <valgrind/callgrind.h>
#endif

namespace
{
using namespace hearthold;
using Clock = std::chrono::steady_clock;
double microseconds(Clock::time_point start) { return std::chrono::duration<double, std::micro>(Clock::now() - start).count(); }
void report(const std::string& name, std::vector<double> samples)
{
    if (samples.empty()) return;
    std::sort(samples.begin(), samples.end());
    std::cout << name << " count=" << samples.size() << " mean_us=" << std::accumulate(samples.begin(), samples.end(), 0.) / samples.size()
              << " p95_us=" << samples[(samples.size() - 1) * 95 / 100] << " max_us=" << samples.back() << '\n';
}
void graphProfile()
{
    for (int roads : {8, 32, 128}) {
        RoadNetwork network;
        for (int i = 0; i < roads; ++i) {
            Point a{float(i % 16) * 2, float(i / 16) * 3};
            Point b = a + (i % 2 ? Point{0, 20} : Point{20, 0});
            network.add({RoadAnchor::sharp(a), RoadAnchor::sharp(b)}, 1);
        }
        auto segments = network.builtSegments();
        std::vector<double> times;
        size_t nodes = 0;
        for (int i = 0; i < 5; ++i) {
            auto start = Clock::now();
            auto graph = RoadGraph::build(segments);
            times.push_back(microseconds(start));
            nodes = graph.nodes().size();
        }
        std::cout << "roads=" << roads << " segments=" << segments.size() << " nodes=" << nodes << ' ';
        report("graph", times);
    }
}
void fogSnapshot(WorldRenderer& renderer, const std::string& filename)
{
    constexpr unsigned size = 256;
    auto* root = renderer.scene();
    auto* world = static_cast<tvg::Scene*>(*std::next(root->paints().begin()));
    auto* fog = *std::next(world->paints().begin(), 14);
    static_cast<tvg::Shape*>(root->paints().front())->fill(255, 255, 255);
    for (auto* paint : root->paints()) if (paint != root->paints().front() && paint != world) paint->opacity(0);
    for (auto* paint : world->paints()) if (paint != fog) paint->opacity(0);
    ui::setTransform(world, {1, 0, 0, 0, 1, 0, 0, 0, 1});
    ui::setTransform(fog, {1, 0, 0, 0, 1, 0, 0, 0, 1});
    std::vector<uint32_t> pixels(size * size);
    std::unique_ptr<tvg::SwCanvas> canvas(tvg::SwCanvas::gen());
    if (!canvas || canvas->target(pixels.data(), size, size, size, tvg::ColorSpace::ARGB8888) != tvg::Result::Success ||
        canvas->add(root) != tvg::Result::Success || canvas->draw(true) != tvg::Result::Success || canvas->sync() != tvg::Result::Success)
        throw std::runtime_error("cannot capture fog pixels");
    std::ofstream out(filename, std::ios::binary);
    out << "P6\n" << size << ' ' << size << "\n255\n";
    for (auto pixel : pixels) { char rgb[] = {char(pixel >> 16), char(pixel >> 8), char(pixel)}; out.write(rgb, 3); }
    if (!out) throw std::runtime_error("cannot write fog snapshot");
}
void roadworkProfile(int roadCount, int workers, int frames, bool paving, const std::string& snapshot)
{
    MapDocument doc(WorldMap::generate(5));
    auto c = doc.map().camp();
    // Editor brushes are limited to radius 16; overlap their flat interiors.
    doc.beginStroke();
    for (int y = -24; y <= 24; y += 12)
        for (int x = -24; x <= 24; x += 12) doc.paint(c + Point{float(x), float(y)}, 16, Terrain::Grass);
    doc.endStroke();
    Town town(doc.gameMap());
    town.scout(c.x, c.y, 32);
    if (!town.place(Structure::Camp, c, 0)) throw std::runtime_error("cannot found profile camp");
    town.completeConstruction();
    town.reward({100000, 100000, 100000, 100000, 100000, 100000});
    town.recruit(Role::Resident, Calling::Settler, workers - 5);
    if (town.people().size() != size_t(workers)) throw std::runtime_error("incorrect profile population");
    // Try evenly dispersed directions; skip any reserved dungeon entrance.
    for (int i = 0; town.roads().roads().size() < size_t(roadCount) && i < roadCount * 4; ++i) {
        float angle = i * 2.3999632f;
        RoadPath path{RoadAnchor::sharp(c + rotated({1.2f, 0}, angle)), RoadAnchor::sharp(c + rotated({21.2f, 0}, angle))};
        town.buildRoad(path);
    }
    if (town.roads().roads().size() != size_t(roadCount)) throw std::runtime_error("cannot place requested profile roads");
    if (paving) {
        town.completeConstruction();
        for (const auto& road : town.roads().roads())
            if (!town.pave(road.id)) throw std::runtime_error("cannot pave profile road");
    }
    // Synchronize the walking grid before issuing player orders.
    town.advance(1. / 60);
    size_t worker = 0;
    auto start = Clock::now();
    for (const auto& p : town.people()) {
        const auto& road = town.roads().roads()[worker++ % size_t(roadCount)];
        if (!town.orderRoadwork({p.id}, road.id)) throw std::runtime_error("worker cannot reach road");
    }
    std::cout << "roads=" << roadCount << " workers=" << workers << " paving=" << paving << " orders_us=" << microseconds(start) << '\n';
    Traffic traffic(5);
    WorldRenderer renderer;
    auto iso = project(c.x, c.y);
    Camera camera{iso.x, iso.y, 1.4f};
    traffic.update(town, 0);
    renderer.update(town, traffic, camera, 1280, 800, 0, {});
    std::vector<double> simulation, cartChanges, cartSteady, sceneChanges, sceneSteady, total;
    size_t assignedMin = size_t(workers), movingSum = 0, workingSum = 0;
#ifdef CALLGRIND_START_INSTRUMENTATION
    CALLGRIND_START_INSTRUMENTATION;
#endif
    for (int frame = 0; frame < frames; ++frame) {
        auto revision = town.revision();
        auto frameStart = Clock::now();
        town.advance(1. / 60);
        simulation.push_back(microseconds(frameStart));
        bool changed = town.revision() != revision;
        start = Clock::now();
        traffic.update(town, 1. / 60);
        (changed ? cartChanges : cartSteady).push_back(microseconds(start));
        start = Clock::now();
        renderer.update(town, traffic, camera, 1280, 800, (frame + 1) / 60., {});
        (changed ? sceneChanges : sceneSteady).push_back(microseconds(start));
        total.push_back(microseconds(frameStart));
        size_t assigned = 0;
        for (const auto& p : town.people()) {
            assigned += p.ordered && p.task == Activity::Roadwork;
            movingSum += p.moving();
            workingSum += p.activity == Activity::Roadwork && !p.moving() && !p.crossingDoorway();
        }
        assignedMin = std::min(assignedMin, assigned);
    }
#ifdef CALLGRIND_STOP_INSTRUMENTATION
    CALLGRIND_STOP_INSTRUMENTATION;
#endif
    std::cout << "people_end=" << town.people().size() << " assigned_min=" << assignedMin
              << " moving_mean=" << double(movingSum) / frames << " roadworking_mean=" << double(workingSum) / frames << '\n';
    report("simulation", simulation);
    report("traffic.changed", cartChanges); report("traffic.steady", cartSteady);
    report("scene.changed", sceneChanges); report("scene.steady", sceneSteady);
    report("cpu.total", total);
    if (!snapshot.empty()) fogSnapshot(renderer, snapshot);
}
}

int main(int argc, char** argv)
{
    int roads = 32, workers = 30, frames = 1200;
    bool paving = false, graphOnly = false;
    std::string snapshot;
    try {
        for (int i = 1; i < argc; ++i) {
            std::string arg = argv[i];
            if (arg == "--pave") paving = true;
            else if (arg == "--graph-only") graphOnly = true;
            else if (arg == "--snapshot" && i + 1 < argc) snapshot = argv[++i];
            else if ((arg == "--roads" || arg == "--workers" || arg == "--frames") && i + 1 < argc) {
                int value = std::stoi(argv[++i]);
                if (value < 1) throw std::runtime_error("profile values must be positive");
                if (arg == "--roads") roads = value;
                else if (arg == "--workers") workers = value;
                else frames = value;
            } else throw std::runtime_error("usage: Hearthold-road-profile [--graph-only] [--roads N] [--workers 5..1000] [--frames N] [--pave] [--snapshot FILE.ppm]");
        }
        if (workers < 5 || workers > 1000) throw std::runtime_error("profile workers must be 5..1000");
        if (graphOnly) { graphProfile(); return 0; }
        if (tvg::Initializer::init(0) != tvg::Result::Success) throw std::runtime_error("cannot initialize ThorVG");
        try { roadworkProfile(roads, workers, frames, paving, snapshot); }
        catch (...) { tvg::Initializer::term(); throw; }
        tvg::Initializer::term();
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}

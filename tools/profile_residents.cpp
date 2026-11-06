// Opt-in native/WebGL workload using the real game, host and audio mixer.
#include <game/game_app.h>
#include <game/building_assets.h>
#include <game/map_document.h>
#include <game/sound_board.h>
#include <core/io/path.h>
#include <ui/host.h>
#include <algorithm>
#include <fstream>
#include <iostream>
#include <stdexcept>

namespace
{
using namespace hearthold;
class ResidentsProfile final : public ui::Application
{
    std::unique_ptr<GameApp> game;
    std::unique_ptr<SoundBoard> mixer;
    tvg::Scene* root = nullptr;
public:
    explicit ResidentsProfile(int workers, bool woodcutting, bool mining)
    {
        std::string error;
        if (!loadDefaultBuildingAssets({}, error)) throw std::runtime_error(error);
        SDL_InitSubSystem(SDL_INIT_AUDIO);
        mixer = std::make_unique<SoundBoard>();
        game = std::make_unique<GameApp>(5);
        auto& town = game->state(); auto center = town.map().camp();
        bool gathering = woodcutting || mining; Point miningFocus = center;
        {
            MapDocument document(town.map());
            if (gathering) { document.beginStroke(); document.paint(center, 12, Terrain::Grass); if (mining) document.paint(center + Point{3, 3}, 1.8f, Terrain::Rock); document.endStroke(); }
            auto map = document.gameMap();
            int radius = gathering ? 7 : 24;
            for (int y = int(center.y) - radius; y <= int(center.y) + radius; ++y)
                for (int x = int(center.x) - radius; x <= int(center.x) + radius; ++x)
                    if (map.inside(x, y)) map.at(x, y).trees = map.at(x, y).wild = 0;
            if (woodcutting) for (auto offset : {Point{3, 2}, Point{3, 3}, Point{2, 3}}) {
                auto at = center + offset; map.at(int(at.x), int(at.y)).trees = 1;
            }
            if (mining) {
                bool kept = false;
                for (int y = 0; y < map.height(); ++y) for (int x = 0; x < map.width(); ++x) {
                    if (!hearthold::mining::deposit(map, x, y)) continue;
                    map.at(x, y).quarried = kept || distance(hearthold::mining::position(x, y), center) > 7;
                    if (!map.at(x, y).quarried) { kept = true; miningFocus = hearthold::mining::position(x, y); }
                }
            }
            town = Town(std::move(map));
        }
        town.scout(center.x, center.y, 32);
        if (!town.place(Structure::Camp, center, 0)) throw std::runtime_error("cannot found workload camp");
        town.completeConstruction();
        town.reward({100000, gathering ? 0 : 100000, gathering ? 0 : 100000, 100000, 100000, 100000});
        town.recruit(Role::Resident, Calling::Settler, workers - int(town.people().size()));
        if (town.people().size() != size_t(workers)) throw std::runtime_error("incorrect workload population");
        for (int i = 0; !gathering && town.roads().roads().size() < 32 && i < 1280; ++i) {
            float angle = i * 2.3999632f;
            town.buildRoad({RoadAnchor::sharp(center + rotated({1.2f, 0}, angle)), RoadAnchor::sharp(center + rotated({21.2f, 0}, angle))});
        }
        if (!gathering && town.roads().roads().size() != 32) throw std::runtime_error("cannot place 32 workload roads");
        town.advance(1. / 60);
        size_t index = 0;
        for (const auto& person : town.people()) {
            if (gathering) { if (person.id != town.people().front().id) town.setAuto(person.id, false); }
            else if (!town.orderRoadwork({person.id}, town.roads().roads()[index++ % 32].id)) throw std::runtime_error("unreachable workload road");
        }
        game->selectPeople({}); game->setSpeed(1); game->view().zoom = 1.4f;
        if (gathering) {
            auto focus = mining ? project(miningFocus.x, miningFocus.y - .5f) : project(center.x + 1.3f, center.y + 1.3f);
            game->view() = {focus.x, focus.y, 4};
            game->selectPeople({town.people().front().id}); game->togglePause();
        }
        root = tvg::Scene::gen(); root->ref(); root->add(game->worldScene()); root->add(game->hudScene());
    }
    ~ResidentsProfile() override { if (root) { root->remove(); root->unref(); } }
    std::string title() const override { return "Hearthold resident workload"; }
    tvg::Scene* scene() const override { return root; }
    void render(float width, float height, double seconds) override
    {
        game->render(width, height, seconds);
        mixer->setAmbience(game->ambience());
        for (const auto& cue : game->takeCues()) mixer->play(cue);
    }
    void event(const ui::AppEvent& event) override
    {
        using Type = ui::AppEvent::Type;
        auto button = event.button == 1 ? PointerButton::Primary : PointerButton::Secondary;
        switch (event.type) {
        case Type::PointerDown: game->pointerDown(event.x, event.y, button); break;
        case Type::PointerUp: game->pointerUp(event.x, event.y, button); break;
        case Type::PointerMove: game->pointerMove(event.x, event.y); break;
        case Type::PointerCancel: game->cancelPointer(); break;
        case Type::Wheel: game->wheel(event.x, event.y, event.delta); break;
        default: break;
        }
    }
    bool command(std::string_view id, std::string_view argument) override
    {
        if (id == "profile.step") {
            auto seconds = std::stod(std::string(argument));
            if (!std::isfinite(seconds) || seconds < 0 || seconds > 30) return false;
            game->state().advance(seconds); return true;
        }
        if (id == "profile.selection") {
            std::vector<int> ids;
            if (argument == "all") for (const auto& p : game->state().people()) ids.push_back(p.id);
            else if (argument == "first") ids.push_back(game->state().people().front().id);
            else if (argument != "none") return false;
            game->selectPeople(std::move(ids)); return true;
        }
        if (id == "profile.speak") {
            for (const auto& p : game->state().people()) game->sayPerson(p.id, "Attack!");
            return true;
        }
        if (id == "profile.effects") {
            for (int i = 0; i < 100; ++i) mixer->play({Cue::Complete, .1f, 0});
            return true;
        }
        if (id == "profile.reset-effects") {
            mixer->playback(SoundBoard::Playback::Stopped); mixer->playback(SoundBoard::Playback::Playing); return true;
        }
        if (id != "profile.state") return false;
        auto effects = mixer->effectStatistics();
        size_t assigned = 0, moving = 0, working = 0, felling = 0, mining = 0, collecting = 0, hauling = 0, carrying = 0;
        for (const auto& p : game->state().people()) {
            assigned += p.ordered && p.task == Activity::Roadwork;
            moving += p.moving();
            working += p.activity == Activity::Roadwork && !p.moving() && !p.crossingDoorway();
            felling += p.activity == Activity::Felling; mining += p.activity == Activity::Mining; collecting += p.activity == Activity::Collecting;
            hauling += p.activity == Activity::Hauling; carrying += p.carrying;
        }
        std::ofstream out(te::io::pathFromUtf8(argument));
        const auto& first = game->state().people().front();
        out << "{\"residents\":" << game->state().people().size() << ",\"assigned\":" << assigned
            << ",\"moving\":" << moving << ",\"working\":" << working << ",\"selected\":" << game->selectedPeople().size()
            << ",\"effects\":" << effects.effects << ",\"speech\":" << effects.speech << ",\"accepted\":" << effects.accepted
            << ",\"selectedSpeech\":" << effects.selectedSpeech << ",\"nearbySpeech\":" << effects.nearbySpeech
            << ",\"dropped\":" << effects.dropped << ",\"replaced\":" << effects.replaced
            << ",\"stone\":" << game->state().stock().stone << ",\"mining\":" << mining << ",\"wood\":" << game->state().wood() << ",\"clock\":" << game->state().clock()
            << ",\"felling\":" << felling << ",\"collecting\":" << collecting << ",\"hauling\":" << hauling << ",\"carrying\":" << carrying
            << ",\"worker\":{\"id\":" << first.id << ",\"activity\":\"" << activityName(first.activity) << "\",\"moving\":" << first.moving()
            << ",\"x\":" << first.position.x << ",\"y\":" << first.position.y << ",\"until\":" << first.until << ",\"tree\":" << first.tree << "}}";
        return bool(out);
    }
};
}

int main(int argc, char** argv)
{
    int workers = 100;
    bool woodcutting = false, mining = false;
    ui::HostOptions host;
#ifndef __EMSCRIPTEN__
    host.hidden = true; host.frames = 300;
#endif
    try {
        for (int i = 1; i < argc; ++i) {
            std::string arg = argv[i];
            auto value = [&]() { if (++i >= argc) throw std::runtime_error("missing value for " + arg); return std::string(argv[i]); };
            if (arg == "--workers") workers = std::stoi(value());
            else if (arg == "--woodcutting") woodcutting = true;
            else if (arg == "--mining") mining = true;
            else if (arg == "--frames") host.frames = unsigned(std::stoul(value()));
            else if (arg == "--renderer") {
                auto renderer = value();
                if (renderer == "gl") host.backend = ui::RenderBackend::OpenGL;
                else if (renderer == "wgpu") host.backend = ui::RenderBackend::WebGPU;
                else throw std::runtime_error("renderer must be gl or wgpu");
            } else throw std::runtime_error("unknown workload option: " + arg);
        }
        if (workers < 5 || workers > 1000) throw std::runtime_error("workload residents must be 5..1000");
        return ui::run([workers, woodcutting, mining] { return std::make_unique<ResidentsProfile>(workers, woodcutting, mining); }, host);
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}

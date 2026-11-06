#include "game_app.h"
#include "building_assets.h"
#include <algorithm>
#include <cmath>

namespace hearthold
{
namespace
{
ui::Theme gameTheme()
{
    auto theme = ui::Theme::dark();
    theme.background = {14, 16, 22};
    theme.surface = {22, 24, 30, 230};
    theme.raised = {34, 36, 44, 240};
    theme.border = {60, 58, 66};
    theme.text = {222, 210, 190};
    theme.muted = {150, 140, 126};
    theme.accent = {196, 132, 58};
    theme.accentText = {24, 18, 12};
    theme.danger = {222, 92, 72};
    theme.success = {124, 192, 132};
    theme.radius = 6;
    return theme;
}

constexpr float strokePixels = 6;
constexpr float samplePixels = 3;
constexpr float roadFitPixels = 5;
constexpr float roadSnapReach = .6f;
constexpr size_t maxRoadSamples = 4096;
}  // namespace

GameApp::GameApp(uint32_t seed) : town(seed), traffic(seed), theme(gameTheme())
{
    initFonts();
    auto focus = project(town.map().camp().x, town.map().camp().y);
    // With Ymir beside them, the opening view stands back so the giant rises over the founders, who stay
    // clear of the command card along the bottom.
    if (town.map().giant()) camera = {focus.x, focus.y - 207, .7f};
    else camera = {focus.x, focus.y, 1.4f};
    for (const auto& person : town.people()) chosen.push_back(person.id);
}

GameApp::GameApp(const GameApp& source)
    : town(source.town), traffic(source.traffic), theme(source.theme), camera(source.camera),
      chosen(source.chosen), speed(source.speed), paused(source.paused), workQueue(source.workQueue),
      stoppedWork(source.stoppedWork), workSerial(source.workSerial)
{
    initFonts();
    last = 0;
}

void GameApp::initFonts()
{
    context.fontFor = [this](std::string_view text, bool bold) -> const char* {
        if (std::all_of(text.begin(), text.end(), [](unsigned char c) { return c < 128; })) return nullptr;
        auto id = systemFonts.uiFont(text, bold);
        return id ? fonts->textFont(id) : nullptr;
    };
}

int GameApp::personAt(Point screen) const
{
    int best = -1;
    float bestGap = 13 * std::max(camera.zoom, .7f);
    for (const auto& person : town.people()) {
        if (person.visibility() <= .05f) continue;
        auto feet = toScreen(person.position);
        float gap = distance(screen, {feet.x, feet.y - 9 * camera.zoom});
        if (gap < bestGap) {
            bestGap = gap;
            best = person.id;
        }
    }
    return best;
}

Outline GameApp::fieldRectangle(Point from, Point to) const
{
    // Square to the nearest road, so fields line up along it like strips.
    Point tangent{1, 0};
    if (town.roads().distance(from, nullptr, nullptr, -1, &tangent) > 6) tangent = {1, 0};
    float angle = std::atan2(tangent.y, tangent.x);
    auto local = rotated(to - from, -angle);
    return {from, from + rotated({local.x, 0}, angle), from + rotated(local, angle), from + rotated({0, local.y}, angle)};
}

std::optional<Structure> toolStructure(Tool tool)
{
    switch (tool) {
    case Tool::Camp: return Structure::Camp;
    case Tool::Tent: return Structure::Tent;
    case Tool::Farm: return Structure::Farm;
    case Tool::Lumberyard: return Structure::Lumberyard;
    case Tool::Quarry: return Structure::Quarry;
    case Tool::Well: return Structure::Well;
    case Tool::Storehouse: return Structure::Storehouse;
    case Tool::Market: return Structure::MarketStalls;
    case Tool::Tavern: return Structure::Tavern;
    case Tool::Inn: return Structure::Hostel;
    case Tool::Guild: return Structure::Guild;
    case Tool::Shrine: return Structure::Shrine;
    case Tool::MageTower: return Structure::MageTower;
    case Tool::Portal: return Structure::Portal;
    case Tool::Chapel: return Structure::Chapel;
    case Tool::Weaponsmith: return Structure::Weaponsmith;
    case Tool::Armorer: return Structure::Armorer;
    case Tool::Apothecary: return Structure::Apothecary;
    default: return std::nullopt;
    }
}

Point GameApp::toScreen(Point world) const { return camera.toScreen(project(world.x, world.y), viewWidth, viewHeight); }

bool GameApp::nearOnScreen(Point world, float pixels) const { return distance(toScreen(world), mouse) <= pixels; }

Point GameApp::roadPoint() const
{
    Point on;
    bool snap = town.roads().distance(cursor, &on) <= roadSnapReach;
    return snap ? on : cursor;
}

int GameApp::hoveredRoad() const
{
    int id = -1;
    return town.roads().distance(cursor, nullptr, &id) <= 1.5f ? id : -1;
}

void GameApp::sampleRoad()
{
    if (!roadPress || !std::isfinite(cursor.x) || !std::isfinite(cursor.y)) return;
    roadMoved |= distance(*roadPress, mouse) >= strokePixels;
    if (!roadMoved) return;
    if (distance(toScreen(roadStroke.back()), mouse) < samplePixels) return;
    if (roadStroke.size() >= maxRoadSamples) {
        cancelStroke();
        status = "Stroke is too detailed; draw a shorter road";
        return;
    }
    roadStroke.push_back(cursor);
}

RoadPath GameApp::roadDraft() const
{
    if (!roadPress || roadStroke.empty()) return {};
    auto points = roadStroke;
    if (points.size() > 1 && distance(toScreen(points.back()), mouse) < samplePixels) points.back() = cursor;
    else if (!(points.back() == cursor)) points.push_back(cursor);
    if (points.size() < 2) return {};

    // Fit in screen space so the same hand tremor is removed at every angle and zoom.
    auto origin = points.front();
    auto screen = [&](Point p) { p = p - origin; return project(p.x, p.y) * camera.zoom; };
    for (auto& point : points) point = screen(point);
    auto startOffset = screen(roadStart) - points.front(), endOffset = screen(roadPoint()) - points.back();
    float total = 0;
    for (size_t i = 1; i < points.size(); ++i) total += distance(points[i - 1], points[i]);
    if (total <= 0) return {};
    // Taper the snap offset instead of drawing a short leg back to the raw pointer.
    float blend = std::min(total, std::max(24.f, 3 * std::max(length(startOffset), length(endOffset))));
    auto weight = [blend](float along) {
        float t = std::clamp(along / blend, 0.f, 1.f);
        return 1 - t * t * (3 - 2 * t);
    };
    float walked = 0;
    auto previous = points.front();
    for (auto& point : points) {
        auto raw = point; walked += distance(previous, raw); previous = raw;
        point = raw + startOffset * weight(walked) + endOffset * weight(total - walked);
    }
    auto path = freehandRoad(points, roadFitPixels);
    for (auto& anchor : path)
        for (auto* point : {&anchor.point, &anchor.in, &anchor.out})
            *point = origin + unproject(point->x / camera.zoom, point->y / camera.zoom);
    return path;
}

void GameApp::finishRoad()
{
    if (!roadPress) return;
    auto path = roadDraft();
    bool moved = roadMoved;
    roadPress.reset();
    roadStroke.clear();
    roadMoved = false;
    if (!moved || path.size() < 2) { status = "Hold and draw a road"; return; }
    auto check = town.canBuildRoad(path);
    if (!town.buildRoad(path)) { status = check.reason; return; }
    if (!crew.empty()) town.orderRoadwork(crew, town.roads().roads().back().id);
    else queueWork(Activity::Roadwork, town.roads().roads().back().id);
    cue(Cue::Place);
    selectTool(Tool::Select);
}

GameApp::Plan GameApp::plan() const
{
    Plan result;
    auto& preview = result.preview;
    preview.zoom = camera.zoom;
    preview.cursor = cursor;
    if (hudPointer || mouse.x < 0 || panFrom || !town.map().inside(cursor)) return result;
    auto take = [&](const Check& check) {
        preview.valid = check.ok;
        result.problem = check.ok ? "" : check.reason;
        result.cost = check.cost;
    };
    switch (tool) {
    case Tool::Select:
        return result;
    case Tool::Road:
        preview.kind = Preview::Kind::Road;
        preview.brush = true;
        preview.cursor = roadPoint();
        if (roadPress) {
            preview.road = roadDraft();
            if (roadMoved && preview.road.size() >= 2) take(town.canBuildRoad(preview.road));
            else preview.valid = true;
        } else preview.valid = true;
        return result;
    case Tool::Pave:
        if (const auto* road = town.roads().road(hoveredRoad())) {
            preview.kind = Preview::Kind::Road;
            preview.road = road->path;
            take(town.canPave(road->id));
        }
        return result;
    case Tool::Field:
        preview.kind = Preview::Kind::Field;
        if (fieldFrom && distance(toScreen(*fieldFrom), mouse) > 8) {
            preview.outline = fieldRectangle(*fieldFrom, cursor);
            take(town.canPlantField(preview.outline));
            if (result.problem.empty()) result.problem = std::to_string(int(std::lround(area(preview.outline)))) + " acres";
            return result;
        }
        preview.outline = outline;
        preview.closed = false;
        if (outline.empty()) {
            preview.valid = true;
            return result;
        }
        if (outline.size() >= 3 && nearOnScreen(outline[0])) {
            preview.active = 0;
            take(town.canPlantField(outline));
        } else {
            auto open = outline;
            open.push_back(cursor);
            take(town.canPlantField(open));
            if (outline.size() < 2) result.problem.clear();
        }
        return result;
    case Tool::Demolish: {
        preview.kind = Preview::Kind::Clear;
        take(town.canDemolish(cursor));
        if (auto id = town.buildingAt(cursor); id >= 0) preview.outline = town.building(id)->footprint().corners();
        else if (auto field = town.fieldAt(cursor); field >= 0) preview.outline = town.field(field)->outline;
        else if (const auto* road = town.roads().road(hoveredRoad()); road && town.roads().distance(cursor) < Town::roadHalfWidth + .15f) preview.road = road->path;
        if (!preview.valid) result.problem = preview.outline.empty() && preview.road.empty() ? "" : result.problem;
        return result;
    }
    default: break;
    }
    if (auto kind = toolStructure()) {
        auto spot = town.fit(*kind, cursor, freeAngle);
        preview.kind = Preview::Kind::Footprint;
        preview.outline = Footprint{spot.center, structureSpec(*kind).size / 2.f, spot.angle}.corners();
        take(town.canPlace(*kind, spot.center, spot.angle));
    }
    return result;
}

void GameApp::renderScene(float width, float height)
{
    viewWidth = width; viewHeight = height; last = 0;
    renderer.setSceneView(true);
    Preview preview; preview.zoom = camera.zoom;
    renderer.update(town, traffic, camera, width, height, 0, preview, chosen);
    context.begin(theme, {0, 0, width, height}, 0);
    context.end();
}

bool GameApp::sceneEvent(const ui::AppEvent& event)
{
    using Type = ui::AppEvent::Type;
    Point screen{event.x, event.y};
    auto projected = camera.toWorld(screen, viewWidth, viewHeight);
    auto world = unproject(projected.x, projected.y);
    if (event.type == Type::PointerCancel) { scenePanAt.reset(); sceneDragAt.reset(); sceneDragOrigin.reset(); return false; }
    if (event.type == Type::PointerDown) {
        if (event.button != 1) { scenePanAt = screen; return false; }
        int person = personAt(screen);
        if (person >= 0) { selectPeople({person}); sceneDragOrigin = town.person(person)->position; }
        else {
            selectBuilding(town.buildingAt(world));
            if (auto building = town.building(selected)) sceneDragOrigin = building->center;
            else sceneDragOrigin.reset();
        }
        sceneDragAt = world;
        return true;
    }
    if (event.type == Type::PointerMove) {
        if (scenePanAt) {
            camera.x -= (screen.x - scenePanAt->x) / camera.zoom;
            camera.y -= (screen.y - scenePanAt->y) / camera.zoom;
            scenePanAt = screen; return true;
        }
        if (sceneDragAt && sceneDragOrigin) {
            Point position = *sceneDragOrigin + world - *sceneDragAt;
            if (chosen.size() == 1) {
                if (const auto* person = town.person(chosen.front())) return town.editPerson(person->id, position, person->health);
            } else if (const auto* building = town.building(selected))
                return town.editBuilding(building->id, position, building->angle, building->progress, building->health);
        }
    }
    if (event.type == Type::PointerUp) { scenePanAt.reset(); sceneDragAt.reset(); sceneDragOrigin.reset(); }
    if (event.type == Type::Wheel) {
        camera.zoom = std::clamp(camera.zoom * std::pow(1.12f, event.delta), .1f, maxZoom);
        auto after = camera.toWorld(screen, viewWidth, viewHeight);
        camera.x += projected.x - after.x; camera.y += projected.y - after.y;
        return true;
    }
    if (event.type == Type::KeyDown) {
        float step = 32 / camera.zoom;
        if (event.key == ui::Key::Left) camera.x -= step;
        else if (event.key == ui::Key::Right) camera.x += step;
        else if (event.key == ui::Key::Up) camera.y -= step;
        else if (event.key == ui::Key::Down) camera.y += step;
        else return false;
        return true;
    }
    return false;
}

void GameApp::render(float width, float height, double seconds, bool simulate, double maxDelta, double uiSeconds)
{
#if HEARTHOLD_WITH_EDITOR
    if (buildingClose) { buildings.reset(); buildingClose = false; renderer.scene()->opacity(255); last = seconds; }
    if (buildings) {
        viewWidth = width; viewHeight = height; last = seconds;
        auto studioTheme = theme; studioTheme.radius = 2;
        context.begin(studioTheme, {0, 0, width, height}, seconds);
        buildings->render(context, {0, 0, width, height}, [this](const auto& asset, std::string& error) {
            if (!applyBuildingAsset(asset, error)) return false;
            auto document = buildings->document();
            if (document.source) rememberBuildingAssetFile({document.source->asset, document.path, document.source->stamp, document.source->format});
            return true;
        }, [this] { buildingClose = true; });
        context.end(); return;
    }
    if (atlas && mapDecision) {
        if (*mapDecision) startMap(atlas->document().gameMap());
        atlas.reset(); mapDecision.reset(); renderer.scene()->opacity(255); last = seconds;
    }
    if (atlas) {
        viewWidth = width; viewHeight = height; last = seconds;
        context.begin(theme, {0, 0, width, height}, uiSeconds >= 0 ? uiSeconds : seconds);
        atlas->render(context, {0, 0, width, height}, [this](bool play) { closeMapEditor(play); });
        context.end(); return;
    }
    if (editor && editorDecision) {
        if (*editorDecision) town.customizePerson(editor->personId(), editor->current());
        editor.reset();
        editorDecision.reset();
        last = seconds;
    }
    const bool editing = editor.has_value();
#else
    constexpr bool editing = false;
#endif
    viewWidth = width;
    viewHeight = height;
    double elapsed = !simulate || last < 0 ? 0 : std::clamp(seconds - last, 0.0, maxDelta);
    last = seconds;
    if (!editing && (pan.x != 0 || pan.y != 0)) {
        float speed = 620 / camera.zoom * float(elapsed);
        camera.x += pan.x * speed;
        camera.y += pan.y * speed;
        if (mouse.x >= 0) pointerMove(mouse.x, mouse.y);
    }
    if (simulate) {
        town.advance(editing ? 0 : elapsed * gameSpeed());
        if (!editing) dispatchWork();
        traffic.update(town, editing ? 0 : elapsed * gameSpeed());
    }
    chosen.erase(std::remove_if(chosen.begin(), chosen.end(), [&](int id) { return !town.person(id); }), chosen.end());
    for (auto it = speakers.begin(); it != speakers.end();) {
        if (!town.person(it->first)) it = speakers.erase(it);
        else ++it;
    }
    if (simulate) {
    if (seconds >= noticeUntil) {
        if (auto text = town.takeNotice(); !text.empty()) {
            notice = text;
            noticeUntil = seconds + 3.5;
            cue(noticeCue(text));
        }
    }
    // Each raid sounds the alarm, and the pack howls out of the dark where it comes from, heard
    // however far off.
    if (town.raids() != heardRaids && town.raiding()) {
        auto howl = spatial(Cue::Howl, town.monsters().back().position);
        howl.gain = std::max(howl.gain, .45f);
        if (cues.size() < 32) cues.push_back(howl);
        raiseAlarm(seconds);
    }
    heardRaids = town.raids();
    // Blows ring out where they land: steel on monsters, bites on people, whistling arrows and spells. Any fight near
    // the middle of the view is heard; a fighter picked out is louder, and only those picked out grunt.
    auto listening = unproject(camera.x, camera.y);
    float earshot = 14 / std::max(camera.zoom, .3f);
    int heard = 0;
    for (const auto& hit : town.hits()) {
        if (hit.serial < heardBlow) continue;
        heardBlow = hit.serial + 1;
        bool picked = std::find(chosen.begin(), chosen.end(), hit.person) != chosen.end();
        if (!picked && (!renderer.visible(hit.to) || distance(hit.to, listening) > earshot)) continue;
        if (hit.onPerson && picked) grunt(hit.person);
        if (heard++ >= 4) continue;
        auto blow = spatial(hit.onPerson ? Cue::Bite : hit.ranged ? Cue::Arrow : Cue::Clash, hit.to);
        blow.gain *= picked ? 1 : .6f;
        if (blow.gain > .03f && cues.size() < 32) cues.push_back(blow);
    }
    // Axes and falling trees are heard about the middle of the view whoever is picked out; a woodcutter picked out
    // is heard louder, and only while still picked out.
    int timberHeard = 0;
    for (const auto& event : town.treeEvents()) {
        if (event.serial < heardTree) continue;
        heardTree = event.serial + 1;
        if (town.clock() - event.at > .25 || timberHeard >= 4) continue;
        bool picked = std::find(chosen.begin(), chosen.end(), event.person) != chosen.end();
        bool stone = event.kind == TreeWorkEvent::Kind::Mine || event.kind == TreeWorkEvent::Kind::Shatter;
        auto at = stone ? mining::position(event.cell % town.map().width(), event.cell / town.map().width()) : treePosition(town.map(), event.cell % town.map().width(), event.cell / town.map().width(), event.index);
        if (!renderer.visible(at) || (!picked && distance(at, listening) > earshot)) continue;
        auto sound = spatial(stone ? Cue::Mine : event.kind == TreeWorkEvent::Kind::Chop ? Cue::Chop : Cue::TreeFall, at);
        sound.gain *= picked ? .55f : .32f;
        if (picked) sound.speaker = event.person;
        cues.push_back(sound); ++timberHeard;
    }
    // A chime where a building is finished, and now and then a tune for it.
    bool completed = false;
    for (const auto& item : town.buildings()) {
        if (!item.built() || std::find(finished.begin(), finished.end(), item.id) != finished.end()) continue;
        finished.push_back(item.id);
        if (heardFinished) cueAt(Cue::Complete, item.center);
        completed = completed || heardFinished;
    }
    if (completed) playMoment(Moment::Build, seconds);
    heardFinished = true;
    soundscape(seconds);
    }
    if (selected >= 0 && !town.building(selected)) selected = -1;
    current = plan();
    renderer.update(town, traffic, camera, width, height, seconds, current.preview, chosen);
    if (simulate) updateSpeech(seconds);
    context.begin(theme, {0, 0, width, height}, uiSeconds >= 0 ? uiSeconds : seconds);
    if (!editing && tool == Tool::Select && boxFrom && !hudPointer && !panFrom && distance(*boxFrom, mouse) > 6) {
        auto fill = theme.success, border = theme.success;
        fill.a = 90; border.a = 230;
        context.rect({std::min(boxFrom->x, mouse.x), std::min(boxFrom->y, mouse.y),
                      std::abs(mouse.x - boxFrom->x), std::abs(mouse.y - boxFrom->y)}, fill, 0, border, 1.5f);
    }
    if (!editing) speechBubbles(width, height);
    hud(width, height);
    if (!editing) commandOverlay();
#if HEARTHOLD_WITH_EDITOR
    if (editor) {
        if (auto person = town.person(editor->personId()))
            editor->setBackdrop(portraitBackdrop(town.map(), person->position, town.climate()));
        editor->render(context, {0, 0, width, height}, [this](bool apply) { closeCharacterEditor(apply); });
    }
#endif
    context.end();
}

#if HEARTHOLD_WITH_EDITOR
void GameApp::openCharacterEditor()
{
    if (editor || atlas || buildings || town.people().empty()) return;
    auto person = chosen.empty() ? &town.people().front() : town.person(chosen.front());
    if (!person) return;
    for (auto& [id, state] : speakers) { state.speech.stop(); state.heard = 0; }
    cues.push_back({Cue::SpeechStop});
    pan = {};
    panFrom.reset();
    pressAt.reset();
    boxFrom.reset();
    cancelStroke();
    hudPointer = false;
    editor.emplace(*person);
}

void GameApp::closeCharacterEditor(bool apply)
{
    if (editor && (!apply || validCharacter(editor->current()))) {
        cues.push_back({Cue::SpeechStop});
        editorDecision = apply;
    }
}

#endif
std::vector<Sound> GameApp::takeCues()
{
    std::vector<Sound> out;
    out.swap(cues);
    std::erase_if(out, [&](const Sound& sound) {
        if ((sound.cue == Cue::Chop || sound.cue == Cue::TreeFall) && sound.speaker >= 0)
            return std::find(chosen.begin(), chosen.end(), sound.speaker) == chosen.end();
        if (sound.cue != Cue::Speech || sound.speaker < 0) return false;
        auto channel = std::find(chosen.begin(), chosen.end(), sound.speaker) != chosen.end() ? SpeechChannel::Selected : SpeechChannel::Nearby;
        return sound.speechChannel != channel;
    });
    for (auto& [id, state] : speakers) {
        auto channel = std::find(chosen.begin(), chosen.end(), id) != chosen.end() ? SpeechChannel::Selected : SpeechChannel::Nearby;
        if (!state.heard || state.heardChannel == channel) continue;
        Sound stop{Cue::SpeechStop}; stop.speaker = id; out.push_back(stop);
        state.heard = 0; state.heardChannel = channel;
    }
    return out;
}

Sound GameApp::spatial(Cue sound, Point world) const
{
    auto at = toScreen(world);
    float pan = std::clamp((at.x - viewWidth / 2) / (viewWidth / 2), -1.f, 1.f);
    // Off screen it fades with distance; zoomed out, the whole world is heard from further away.
    float outside = std::max({0.f, std::abs(at.x - viewWidth / 2) - viewWidth / 2, std::abs(at.y - viewHeight / 2) - viewHeight / 2});
    float zoom = std::clamp(.3f + .7f * (camera.zoom - .2f), .2f, 1.f);
    return {sound, std::exp(-outside / 300) * zoom, pan};
}

void GameApp::cueAt(Cue sound, Point world)
{
    auto placed = spatial(sound, world);
    if (placed.gain > .03f && cues.size() < 32) cues.push_back(placed);
}

Ambience GameApp::ambience() const
{
    const auto& sky = town.climate();
    Ambience mix;
    bool wet = sky.weather == Weather::Rain || sky.weather == Weather::Storm;
    mix.rain = wet ? .35f + .65f * sky.intensity : 0;
    mix.wind = sky.weather == Weather::Storm ? 1 : sky.weather == Weather::Snow ? .5f + .5f * sky.intensity : sky.weather == Weather::Cloudy ? .25f : .1f;
    mix.night = sky.night * (sky.temperature > 4 ? 1 : .3f);  // Crickets want warmth.
    mix.birds = (1 - sky.night) * (wet ? .1f : 1) * (sky.temperature > 3 ? 1 : .2f);
    // Only what is near the middle of the view is heard.
    auto middle = unproject(camera.x, camera.y);
    float earshot = 14 / std::max(camera.zoom, .3f);
    // Hammers knock wherever someone builds within earshot, the louder for those picked out.
    float hammers = 0, hammerX = 0;
    for (const auto& person : town.people()) {
        bool hammering = person.activity == Activity::Building || person.activity == Activity::Roadwork;
        if (!hammering || person.moving() || person.crossingDoorway() || person.inside || distance(person.position, middle) >= earshot) continue;
        float weight = std::find(chosen.begin(), chosen.end(), person.id) != chosen.end() ? 1 : .6f;
        hammers += weight;
        hammerX += spatial(Cue::Place, person.position).pan * weight;
    }
    mix.hammering = std::min(1.f, hammers / 3);
    mix.hammerPan = hammers > 0 ? hammerX / hammers : 0;
    // Water and woods around, the nearer the louder, on a coarse grid that scales with earshot.
    constexpr float steps = 10;  // Whole steps, so the float counters stay exact.
    float heard = 0, shore = 0, shoreX = 0, canopy = 0;
    for (float j = -steps; j <= steps; ++j)
        for (float i = -steps; i <= steps; ++i) {
            float weight = 1 - std::hypot(i, j) / steps;
            Point at = middle + Point{i, j} * (earshot / steps);
            const auto* tile = weight > 0 ? town.map().cell(at) : nullptr;
            if (!tile) continue;
            heard += weight;
            canopy += weight * tile->trees / 3.f;
            if (!isWater(tile->terrain)) continue;
            shore += weight;
            shoreX += weight * spatial(Cue::Place, at).pan;
        }
    if (heard > 0) {
        mix.water = std::min(1.f, 2.5f * shore / heard) * (1 - sky.frost);  // Ice stills it.
        mix.waterPan = shore > 0 ? shoreX / shore : 0;
        mix.woods = std::min(1.f, 2 * canopy / heard);
    }
    if (const auto* fire = town.camp(); fire && fire->built() && fire->kind == Structure::Camp) {
        mix.fire = std::max(0.f, 1 - distance(fire->center, middle) / earshot);
        mix.firePan = spatial(Cue::Place, fire->center).pan;
    }
    mix.music = town.bardPlaying() ? 1 : 0;
    mix.raid = town.raiding() ? 1 : 0;
    mix.dark = sky.night;
    mix.winter = town.calendar().season == Season::Winter ? 1 : 0;
    mix.gloom = wet || sky.weather == Weather::Snow ? 1 : 0;
    float near = std::clamp((camera.zoom - .3f) / .9f, 0.f, 1.f);  // Zoomed far out, the land falls quiet.
    for (float* level : {&mix.birds, &mix.night, &mix.hammering, &mix.fire, &mix.water, &mix.woods, &mix.chopping}) *level *= near;
    return mix;
}

double GameApp::nextFrameDelay() const
{
    if (animatingUi()) return 1.0 / 60;
#if HEARTHOLD_WITH_EDITOR
    if (buildings) return buildings->animating() ? 1.0 / 60 : .1;
    if (atlas) return atlas->dragging() ? 1.0 / 60 : .1;
    if (editor) return .1;
#endif
    if (!chosen.empty()) return 1.0 / 60;
    if (renderer.animating() || pan.x != 0 || pan.y != 0 || panFrom) return 1.0 / 60;
    return 1.0 / 30;  // Travellers, wisps and the campfire.
}

void GameApp::selectTool(Tool value, bool useSelection)
{
    if (tool != value) cue(Cue::Click);
    tool = value;
    dismissBuildDrawer();
    if (value != Tool::Select) selectedTree = selectedRock = -1;
    crew = useSelection ? chosen : std::vector<int>{};
    pending = Order::None;
    roadStroke.clear();
    roadPress.reset();
    roadMoved = false;
    outline.clear();
    fieldFrom.reset();
    boxFrom.reset();
    status.clear();
}

void GameApp::cancel()
{
#if HEARTHOLD_WITH_EDITOR
    if (buildings) { buildings->command("close"); return; }
    if (atlas) { closeMapEditor(false); return; }
    if (editor) { closeCharacterEditor(false); return; }
#endif
    if (roadPress) {
        cancelStroke();
        return;
    }
    if (pending != Order::None) {
        pending = Order::None;
        return;
    }
    if (globalCard >= 0) { if (globalCard > 0) globalCard = 0; else dismissBuildDrawer(); return; }
    if (card >= 0) {
        if (card > 0) card = 0; else dismissBuildDrawer();
        return;
    }
    if (!outline.empty() || fieldFrom) {
        outline.clear();
        fieldFrom.reset();
    } else if (selected >= 0 || selectedDungeon >= 0 || selectedTree >= 0 || selectedRock >= 0 || !chosen.empty()) {
        selected = selectedDungeon = selectedTree = selectedRock = -1;
        chosen.clear();
    }
    else tool = Tool::Select;
    status.clear();
}

void GameApp::finish()
{
    status.clear();
    if (tool == Tool::Field && outline.size() >= 3) {
        auto check = town.canPlantField(outline);
        if (town.plantField(outline)) {
            outline.clear();
            cue(Cue::Place);
        }
        else status = check.reason;
    }
}

void GameApp::undoPoint()
{
    if (tool == Tool::Road && roadPress) cancelStroke();
    else if (tool == Tool::Field && !outline.empty()) outline.pop_back();
}

void GameApp::cancelStroke()
{
    if (roadPress) status = "Road stroke cancelled";
    roadStroke.clear();
    roadPress.reset();
    roadMoved = false;
}

void GameApp::cancelPointer()
{
    cancelStroke();
    fieldFrom.reset();
    boxFrom.reset();
    panFrom.reset();
    pressAt.reset();
    hudPointer = false;
    context.cancelPointer();
}

void GameApp::select()
{
    selected = town.buildingAt(cursor);
    residentPage = 0;
    selectedDungeon = selectedTree = selectedRock = -1;
    if (selected >= 0) return;
    selectedTree = treeAtScreen(mouse);
    if (selectedTree >= 0) return;
    selectedRock = rockAtScreen(mouse);
    if (selectedRock >= 0) return;
    selected = buildingAtScreen(mouse);  // A building's body stands above its footprint.
    if (selected >= 0) return;
    if (const auto* tile = town.map().cell(cursor); tile && tile->dungeon >= 0 && town.map().dungeons()[size_t(tile->dungeon)].discovered) selectedDungeon = tile->dungeon;
}

void GameApp::pointerDown(float x, float y, PointerButton button)
{
#if HEARTHOLD_WITH_EDITOR
    if (buildings) { if (button == PointerButton::Primary) context.pointerDown(x, y); return; }
    if (atlas) { atlas->pointerDown(context, {x, y}, button == PointerButton::Secondary); return; }
    if (editor) {
        if (button == PointerButton::Primary) context.pointerDown(x, y);
        return;
    }
#endif
    pointerMove(x, y);
    if (button == PointerButton::Secondary) {
        if (roadPress) {
            cancelStroke();
            return;
        }
        panFrom = Point{x, y};
        pressAt = Point{x, y};
        return;
    }
    cancelStroke();
    if (context.controlAt(x, y)) {
        hudPointer = true;
        context.pointerDown(x, y);
        return;
    }
    dismissBuildDrawer();
    if (pending != Order::None && !chosen.empty()) return;
    pending = Order::None;
    press();
}

void GameApp::press()
{
    status.clear();
    switch (tool) {
    case Tool::Select: boxFrom = mouse; return;
    case Tool::Road:
        roadStart = roadPoint();
        roadStroke = {cursor};
        roadPress = mouse;
        roadMoved = false;
        return;
    case Tool::Pave: {
        int id = hoveredRoad();
        auto check = town.canPave(id);
        if (!town.pave(id)) status = check.reason;
        else if (!crew.empty()) town.orderRoadwork(crew, id);
        else queueWork(Activity::Roadwork, id);
        return;
    }
    case Tool::Field:
        if (outline.empty()) fieldFrom = cursor;  // A drag lays a rectangle; a click starts an outline.
        else if (outline.size() >= 3 && nearOnScreen(outline[0])) finish();
        else outline.push_back(cursor);
        return;
    case Tool::Demolish: {
        auto check = town.canDemolish(cursor);
        if (town.demolish(cursor)) cueAt(Cue::Demolish, cursor);
        else status = check.reason;
        return;
    }
    default: break;
    }
    if (auto kind = toolStructure()) {
        auto spot = town.fit(*kind, cursor, freeAngle);
        auto check = town.canPlace(*kind, spot.center, spot.angle);
        if (town.place(*kind, spot.center, spot.angle)) {
            selected = town.buildings().back().id;
            if (!crew.empty()) town.orderBuild(crew, selected);
            else queueWork(Activity::Building, selected);
            cueAt(Cue::Place, spot.center);
            selectTool(Tool::Select);  // Placed: back to selecting, as in a strategy game.
            card = -1;
        } else status = check.reason;
    }
}

void GameApp::pointerMove(float x, float y)
{
#if HEARTHOLD_WITH_EDITOR
    if (buildings) { context.pointerMove(x, y); return; }
    if (atlas) { atlas->pointerMove(context, {x, y}); return; }
    if (editor) { context.pointerMove(x, y); return; }
#endif
    if (panFrom) {
        camera.x -= (x - panFrom->x) / camera.zoom;
        camera.y -= (y - panFrom->y) / camera.zoom;
        panFrom = Point{x, y};
    }
    mouse = {x, y};
    auto world = camera.toWorld({x, y}, viewWidth, viewHeight);
    cursor = unproject(world.x, world.y);
    context.pointerMove(x, y);
    sampleRoad();
}

void GameApp::pointerUp(float x, float y, PointerButton button)
{
#if HEARTHOLD_WITH_EDITOR
    if (buildings) { if (button == PointerButton::Primary) context.pointerUp(x, y); return; }
    if (atlas) { atlas->pointerUp(context, {x, y}, button == PointerButton::Secondary); return; }
    if (editor) {
        if (button == PointerButton::Primary) context.pointerUp(x, y);
        return;
    }
#endif
    pointerMove(x, y);
    if (button == PointerButton::Secondary) {
        bool click = pressAt && distance(*pressAt, {x, y}) < 4;
        panFrom.reset();
        pressAt.reset();
        if (click && tool == Tool::Select && !chosen.empty() && !context.controlAt(x, y)) {
            issueOrder(pending == Order::None ? Order::Work : pending);
            pending = Order::None;
        }
        else if (click && tool == Tool::Field) finish();
        return;
    }
    if (hudPointer) {
        context.pointerUp(x, y);
        hudPointer = false;
        return;
    }
    if (boxFrom) {
        auto from = *boxFrom;
        boxFrom.reset();
        if (distance(from, mouse) > 6) {
            float x0 = std::min(from.x, mouse.x), x1 = std::max(from.x, mouse.x), y0 = std::min(from.y, mouse.y), y1 = std::max(from.y, mouse.y);
            chosen.clear();
            for (const auto& person : town.people()) {
                auto s = toScreen(person.position);
                if (person.visibility() > .05f && s.x >= x0 && s.x <= x1 && s.y - 8 >= y0 && s.y - 8 <= y1) chosen.push_back(person.id);
            }
            if (!chosen.empty()) selected = selectedDungeon = -1;
            return;
        }
        if (int id = personAt(mouse); id >= 0) selectPeople({id});
        else { chosen.clear(); select(); }
        return;
    }
    if (fieldFrom) {
        auto from = *fieldFrom;
        fieldFrom.reset();
        if (distance(toScreen(from), mouse) > 8) {
            auto rectangle = fieldRectangle(from, cursor);
            auto check = town.canPlantField(rectangle);
            if (!town.plantField(rectangle)) status = check.reason;
        } else outline.push_back(from);
        return;
    }
    if (tool == Tool::Road) finishRoad();
}

void GameApp::wheel(float x, float y, float amount)
{
#if HEARTHOLD_WITH_EDITOR
    if (buildings) { context.pointerMove(x, y); context.wheel(amount); return; }
    if (atlas) { atlas->wheel(context, {x, y}, amount); return; }
    if (editor) { context.pointerMove(x, y); context.wheel(amount); return; }
#endif
    zoomBy(std::pow(1.12f, amount), {x, y});
}

void GameApp::zoomBy(float factor, Point screen)
{
    auto before = camera.toWorld(screen, viewWidth, viewHeight);
    camera.zoom = std::clamp(camera.zoom * factor, .1f, maxZoom);
    auto after = camera.toWorld(screen, viewWidth, viewHeight);
    camera.x += before.x - after.x;
    camera.y += before.y - after.y;
    pointerMove(screen.x, screen.y);
}
}  // namespace hearthold

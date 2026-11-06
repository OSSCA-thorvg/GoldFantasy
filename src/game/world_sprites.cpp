#include "world_sprites.h"
#include "person_look.h"
#include "person_portrait.h"
#include "character_assets.h"
#include "person_body.h"
#include <ui/ui.h>
#include <array>
#include <cmath>

namespace hearthold
{
namespace
{
constexpr std::array<Rgb, 3> skins{{{186, 150, 120}, {150, 112, 86}, {112, 82, 62}}};
constexpr Rgb wood{110, 82, 56}, ink{30, 26, 30}, arcane{130, 240, 220}, warm{244, 186, 96};

void shadow(tvg::Scene* sprite, float rx) { sprite->add(ellipse({0, 0}, rx, rx * .42f, {0, 0, 0, 110})); }

void figure(tvg::Scene* sprite, Rgb robe, Rgb skin, float height = 11, float width = 4.2f)
{
    shadow(sprite, width + 1.3f);
    sprite->add(polygon({{-width, 0}, {width, 0}, {width * .55f, -height}, {-width * .55f, -height}}, opaque(robe)));
    sprite->add(polygon({{0, 0}, {width, 0}, {width * .55f, -height}, {0, -height}}, opaque(scale(robe, .66f))));
    sprite->add(ellipse({0, -height - 3}, 3.2f, 3.2f, opaque(skin)));
}

// A person's walking figure at its old proportions: boots under the hem, a robe lit on the left,
// sleeves and hands, a belt and collar, then a shaded head with eyes looking the way they walk.
void personFigure(tvg::Scene* sprite, const Appearance& a, Rgb robe, float height, float width, PersonParts& parts)
{
    shadow(sprite, width + 1.3f);
    constexpr Rgb boot{58, 44, 36}, belt{84, 60, 42};
    float foot = width * .55f;
    parts.feet[0] = polygon({{-foot, 0}, {-foot + 1.8f, 0}, {-foot + 1.8f, -1.9f}, {-foot, -1.9f}}, opaque(boot));
    parts.feet[1] = polygon({{foot - 1.8f, 0}, {foot, 0}, {foot, -1.9f}, {foot - 1.8f, -1.9f}}, opaque(scale(boot, .78f)));
    sprite->add(parts.feet[0]);
    sprite->add(parts.feet[1]);
    auto shoulderJoins = tvg::Scene::gen(); sprite->add(shoulderJoins);
    auto body = bodyProportions(a.bodyType);
    float hem = -1.3f, top = -height, shoulder = width * .55f * body.shoulders;
    float waist = -height * .42f, hips = width * body.hips;
    float waistWidth = (hips - (hips - shoulder) * (waist - hem) / (top - hem)) * body.waist;
    sprite->add(polygon({{-hips, hem}, {hips, hem}, {waistWidth, waist}, {shoulder, top}, {-shoulder, top}, {-waistWidth, waist}}, opaque(robe)));
    sprite->add(polygon({{0, hem}, {hips, hem}, {waistWidth, waist}, {shoulder, top}, {0, top}}, opaque(scale(robe, .66f))));
    // Belt across the waist.
    auto halfAt = [&](float y) { return y < waist ? waistWidth + (shoulder - waistWidth) * (y - waist) / (top - waist)
                                                : waistWidth + (hips - waistWidth) * (y - waist) / (hem - waist); };
    sprite->add(polygon({{-halfAt(waist), waist}, {halfAt(waist), waist}, {halfAt(waist - 1), waist - 1}, {-halfAt(waist - 1), waist - 1}}, opaque(belt)));
    sprite->add(ellipse({.7f, waist - .5f}, .45f, .45f, {212, 172, 82}));
    // Sleeves and hands, each arm its own part so it can swing.
    for (int i = 0; i < 2; ++i) {
        float side = i ? 1.f : -1.f;
        Rgb sleeve = side < 0 ? scale(robe, .88f) : scale(robe, .58f);
        float x = side * shoulder, hand = side * (width * .82f);
        auto& arm = parts.arms[size_t(i)];
        arm.shoulder = {x + side * .5f, top + 1};
        arm.wrist = {hand, -height * .36f};
        arm.elbow = lerp(arm.shoulder, arm.wrist, .47f);
        arm.upper = tvg::Scene::gen();
        sprite->add(arm.upper);
        arm.forearm = tvg::Scene::gen();
        arm.hand = tvg::Scene::gen();
        connectArm(arm, shoulderJoins, sleeve, 1.45f, .52f);
        auto skin = opaque(side < 0 ? a.skin : a.skinShade);
        arm.hand->add(ellipse(arm.wrist, .85f, .95f, skin));
        arm.hand->add(ellipse({hand - side * .6f, arm.wrist.y - .2f}, .32f, .42f, skin));
        arm.forearm->add(arm.hand);
    }
    sprite->add(polygon({{-1.3f, top}, {1.3f, top}, {0, top + 1.7f}}, opaque(a.trim)));
}

void bandagedWrist(ArmRig& arm)
{
    auto axis = arm.elbow - arm.wrist;
    float length = std::max(.01f, std::hypot(axis.x, axis.y));
    axis = axis * (1.f / length);
    Point normal{-axis.y, axis.x};
    auto from = arm.wrist - axis * .12f, to = arm.wrist + axis * 1.25f;
    auto cloth = line(from, to, 1.65f, {222, 214, 192});
    arm.forearm->add(cloth);
    for (float t : {.32f, .68f}) {
        auto at = lerp(from, to, t);
        arm.forearm->add(line(at - normal * .73f - axis * .1f, at + normal * .73f + axis * .1f, .06f, {166, 156, 136}));
    }
}

void monster(tvg::Scene* sprite, DungeonKind lair)
{
    Rgb body{58, 48, 66}, eyes{255, 84, 64};
    switch (lair) {
    case DungeonKind::Crypt: body = {150, 146, 132}; eyes = {120, 200, 255}; break;
    case DungeonKind::Portal: body = {72, 42, 96}; eyes = {240, 150, 255}; break;
    case DungeonKind::Ruin: body = {62, 82, 52}; eyes = {250, 220, 90}; break;
    case DungeonKind::Cave: break;
    }
    sprite->add(ellipse({0, 0}, 9, 3.4f, {0, 0, 0, 120}));
    sprite->add(ellipse({0, -6}, 15, 8, opaque(eyes, 30)));
    if (lair == DungeonKind::Cave) {  // Shadow wolf on four legs.
        for (float x : {-6.f, -3.f, 3.f, 6.f}) sprite->add(line({x, 0}, {x, -5}, 1.6f, opaque(body)));
        sprite->add(polygon({{-9, -6}, {-4, -10}, {5, -10}, {8, -6}, {4, -4}, {-7, -4}}, opaque(body)));
        sprite->add(polygon({{6, -9}, {12, -11}, {13, -7}, {8, -6}}, opaque(body)));
        sprite->add(polygon({{8, -10}, {9, -14}, {11, -10.5f}}, opaque(body)));
        sprite->add(ellipse({11, -9}, 3, 3, opaque(eyes, 90)));
        sprite->add(ellipse({11, -9}, 1.2f, 1.2f, opaque(eyes)));
    } else {  // Hunched biped.
        sprite->add(line({-2, 0}, {-2, -5}, 1.8f, opaque(body)));
        sprite->add(line({2, 0}, {2, -5}, 1.8f, opaque(body)));
        sprite->add(polygon({{-5, -5}, {5, -5}, {4, -13}, {-3, -14}}, opaque(body)));
        sprite->add(ellipse({2, -16}, 3.6f, 3.2f, opaque(body)));
        if (lair == DungeonKind::Portal) {
            sprite->add(polygon({{-3, -12}, {-11, -18}, {-8, -10}}, opaque(scale(body, .7f))));
        }
        sprite->add(ellipse({2.3f, -16.5f}, 4, 3, opaque(eyes, 80)));
        sprite->add(ellipse({1, -16.5f}, 1.1f, 1.1f, opaque(eyes)));
        sprite->add(ellipse({3.6f, -16.5f}, 1.1f, 1.1f, opaque(eyes)));
    }
}

Point dungeonCenter(const Dungeon& site) { return project(site.origin.x + 1.f, site.origin.y + 1.f); }

void label(tvg::Scene* objects, Point at, const std::string& text)
{
    auto name = tvg::Text::gen();
    if (name->font("DejaVuSans-Bold") != tvg::Result::Success) {
        delete name;
        return;
    }
    name->size(8);
    name->text(text.c_str());
    name->fill(214, 186, 120);
    float x = 0, y = 0, w = 0, h = 0;
    name->bounds(&x, &y, &w, &h);
    auto plate = polygon({{at.x - w / 2 - 6, at.y - 9}, {at.x + w / 2 + 6, at.y - 9}, {at.x + w / 2 + 6, at.y + 5}, {at.x - w / 2 - 6, at.y + 5}}, {14, 12, 18, 190});
    objects->add(plate);
    name->translate(at.x - w / 2 - x, at.y - 6);
    objects->add(name);
}
}  // namespace

tvg::Scene* agentSprite(const Agent& agent, DungeonKind lair)
{
    auto sprite = tvg::Scene::gen();
    auto skin = skins[(agent.look / 7) % skins.size()];
    switch (agent.kind) {
    case AgentKind::Merchant:
        sprite->add(polygon({{-8, -4}, {-2, -4}, {-2, -15}, {-8, -15}}, {104, 76, 50}));  // Pack.
        figure(sprite, {48, 92, 84}, skin, 12);
        sprite->add(line({4, -7}, {7, -7}, 1, opaque(ink)));
        sprite->add(ellipse({7.5f, -5}, 4.5f, 4.5f, opaque(warm, 60)));
        sprite->add(ellipse({7.5f, -5}, 1.8f, 1.8f, opaque(warm)));
        break;
    case AgentKind::Monster: monster(sprite, lair); break;
    }
    return sprite;
}

namespace
{
// How tall a person's figure stands to the shoulders, and how broad at the hem.
float figureHeight(const Person& person, float* broad = nullptr)
{
    float tall = 11, wide = 4.2f;
    float heightScale = person.customLook ? person.customLook->bodyHeight : 1;
    float widthScale = person.customLook ? person.customLook->bodyWidth : 1;
    if (broad) *broad = wide * widthScale;
    return tall * heightScale;
}

HairStyle streetHairStyle(const Appearance& a)
{
    constexpr std::array styles{HairStyle::Swept,HairStyle::Long,HairStyle::Swept,HairStyle::Wild,
        HairStyle::Wild,HairStyle::Bob,HairStyle::Long,HairStyle::Wild,HairStyle::Bob,HairStyle::TwinTails,
        HairStyle::Crop,HairStyle::Braids,HairStyle::Long,HairStyle::Crop,HairStyle::Wild,
        HairStyle::TwinTails,HairStyle::Bun,HairStyle::Crop,HairStyle::Bun};
    int source=safeCharacterHairAsset(a.hairAsset);
    if(source==baldHairAsset)return HairStyle::Bald;
    return source<int(styles.size())?styles[size_t(source)]:HairStyle::Long;
}

float streetCrownRise(HairStyle style)
{
    return style==HairStyle::Wild?5.5f:style==HairStyle::Bun?5.2f:style==HairStyle::Bald?3.2f:4.5f;
}

// Small world silhouettes have a fixed head frame. Portrait locks, cut-outs
// and face morphs never enter this rig; even long styles end near the shoulders.
void streetHairBehind(tvg::Scene* sprite,const Appearance& a,HairStyle style,Point head)
{
    if(style==HairStyle::Long||style==HairStyle::Bob) {
        float bottom=style==HairStyle::Bob?3.f:5.f;
        auto fall=tvg::Shape::gen();fall->moveTo(head.x-3.3f,head.y-1);
        fall->cubicTo(head.x-4.1f,head.y+1,head.x-4,head.y+bottom,head.x-2.8f,head.y+bottom);
        fall->lineTo(head.x+2.8f,head.y+bottom);
        fall->cubicTo(head.x+4,head.y+bottom,head.x+4.1f,head.y+1,head.x+3.3f,head.y-1);
        fall->close();fill(fall,opaque(a.hairShade));sprite->add(fall);
    } else if(style==HairStyle::Braids) {
        for(float side:{-1.f,1.f})sprite->add(line(head+Point{side*3,.2f},head+Point{side*3.3f,4.8f},1.1f,opaque(a.hair)));
    } else if(style==HairStyle::TwinTails) {
        for(float side:{-1.f,1.f})sprite->add(ellipse(head+Point{side*3.6f,.8f},1.1f,1.6f,opaque(a.hair)));
    }
}

void streetHead(tvg::Scene* sprite,const Appearance& a,HairStyle style,Point head)
{
    sprite->add(ellipse(head,3.2f,3.2f,opaque(a.skin)));
    auto shade=ellipse(head+Point{1.9f,0},1.7f,3.2f,opaque(a.skinShade,170));
    shade->clip(ellipse(head,3.2f,3.2f,opaque(a.skin)));sprite->add(shade);
    for(float x:{.65f,1.95f})sprite->add(ellipse(head+Point{x,.3f},.16f,.24f,opaque(ink)));
    if(style==HairStyle::Bald)return;
    float fringe=style==HairStyle::Swept?.8f:0;
    auto cap=tvg::Shape::gen();cap->moveTo(head.x-3.45f,head.y+1.6f);
    if(style==HairStyle::Wild) {
        // One connected silhouette; small tufts must not float above the cap.
        for(auto p:{Point{-3.5f,-2.2f},Point{-3.2f,-4.6f},Point{-1.9f,-3.5f},
                    Point{-1,-5.2f},Point{0,-3.9f},Point{1.2f,-5.5f},Point{1.7f,-3.5f},
                    Point{2.8f,-4.6f},Point{3.35f,-1.4f}})cap->lineTo(head.x+p.x,head.y+p.y);
    } else cap->cubicTo(head.x-4,head.y-3.6f,head.x+1.2f,head.y-4.9f,head.x+3.35f,head.y-1.4f+fringe);
    cap->cubicTo(head.x+2.2f,head.y-2.4f+fringe,head.x+.6f,head.y-2.5f,head.x-.8f,head.y-1.4f);
    cap->cubicTo(head.x-1.8f,head.y-.4f,head.x-2.4f,head.y+.8f,head.x-3.45f,head.y+1.6f);
    cap->close();fill(cap,opaque(a.hair));sprite->add(cap);
    if(style==HairStyle::Bun)sprite->add(ellipse(head+Point{-1.6f,-3.9f},1.5f,1.3f,opaque(a.hair)));
}

// World walking bodies retain their gameplay rig and their own compact head.
tvg::Scene* figureOf(const Person& person, PersonParts& parts)
{
    auto sprite = tvg::Scene::gen();
    auto selection = ellipse({0,0},9,4,{0,0,0,0});
    selection->strokeWidth(1.6f); selection->strokeFill(240,210,120,230); selection->opacity(0);
    sprite->add(selection); parts.ring=selection;
    auto look=appearanceOf(person);
    float broad=4.2f,height=figureHeight(person,&broad);
    constexpr Rgb steel{150,154,166},leather{92,68,48};
    Point head{0,-height-3};
    auto hair=streetHairStyle(look);streetHairBehind(sprite,look,hair,head);
    if(person.calling==Calling::Traveller) sprite->add(polygon({{-7,-4},{-2,-4},{-2,-13},{-7,-13}},{104,76,50}));
    personFigure(sprite,look,look.cloth,height,broad,parts);
    if(injuryOf(person)==Injury::Bandaged)bandagedWrist(parts.arms[person.look%2]);
    parts.arms[0].free=person.calling!=Calling::Warrior&&person.calling!=Calling::Cleric;
    parts.arms[1].free=person.calling==Calling::Settler||person.calling==Calling::Cleric;
    switch (person.calling) {
    case Calling::Settler: break;
    case Calling::Traveller: sprite->add(line({5, 0}, {5, -18}, 1.2f, opaque(wood))); break;  // Walking stick.
    case Calling::Warrior:
        sprite->add(polygon({{-1.6f, -height + 1}, {1.6f, -height + 1}, {1.9f, -2}, {-1.9f, -2}}, opaque(look.cloth)));  // Tabard.
        sprite->add(polygon({{-6.5f, -4}, {-2, -4}, {-2, -11}, {-6.5f, -11}}, opaque(look.cloth)));  // Shield in the house colours.
        sprite->add(line({-4.25f, -4.6f}, {-4.25f, -10.4f}, .7f, {212, 172, 82}));
        sprite->add(line({4.5f, -4}, {7, -19}, 1.6f, {210, 214, 222}));  // Sword.
        sprite->add(line({3, -8}, {6.5f, -9}, 1.4f, opaque(leather)));
        break;
    case Calling::Ranger: {
        auto bow = tvg::Shape::gen();
        bow->moveTo(5, -2);
        bow->cubicTo(10, -8, 10, -14, 5, -20);
        bow->strokeWidth(1.3f);
        bow->strokeFill(leather.r, leather.g, leather.b);
        sprite->add(bow);
        sprite->add(line({5, -2}, {5, -20}, .6f, {210, 200, 180}));
        break;
    }
    case Calling::Mage:
        sprite->add(line({5, 0}, {5, -21}, 1.2f, opaque(wood)));
        sprite->add(ellipse({5, -22}, 3.6f, 3.6f, opaque(Rgb{196, 146, 250}, 90)));
        sprite->add(ellipse({5, -22}, 1.6f, 1.6f, opaque(Rgb{230, 200, 255})));
        break;
    case Calling::Cleric:
        sprite->add(polygon({{-1, -4}, {1, -4}, {1, -10}, {-1, -10}}, opaque(look.trim)));
        sprite->add(line({-6, -6}, {-6, -15}, 1.4f, opaque(wood)));  // Mace.
        sprite->add(ellipse({-6, -16}, 2.4f, 2.4f, opaque(steel)));
        break;
    case Calling::Bard: {
        // A lute held by its pear-shaped bowl, the pegbox bent back at the top of the neck.
        constexpr Rgb spruce{186, 124, 66}, walnut{104, 68, 40};
        sprite->add(line({5.7f, -6.6f}, {6, -14.2f}, 1.1f, opaque(walnut)));
        sprite->add(line({6, -14.2f}, {7.4f, -15.4f}, 1.2f, opaque(scale(walnut, .8f))));
        sprite->add(ellipse({5.8f, -3.4f}, 2.5f, 2.6f, opaque(spruce)));
        sprite->add(ellipse({5.7f, -5.5f}, 1.7f, 1.6f, opaque(spruce)));
        sprite->add(ellipse({6.6f, -3.3f}, 1.5f, 2.2f, opaque(scale(spruce, .8f))));
        sprite->add(ellipse({5.5f, -4.5f}, .7f, .7f, opaque(scale(walnut, .6f))));
        sprite->add(line({5.75f, -2.4f}, {5.98f, -13.9f}, .25f, opaque(Rgb{232, 220, 188}, 200)));
        break;
    }
    }
    streetHead(sprite,look,hair,head);
    for (const auto& arm : parts.arms) sprite->add(arm.forearm);
    auto hammer = tvg::Scene::gen();
    hammer->add(line({3, -7}, {8, -15}, 1.3f, opaque(wood)));
    hammer->add(polygon({{6, -17}, {10, -14}, {11, -15.5f}, {7, -18.5f}}, {120, 120, 130}));
    hammer->opacity(0);
    sprite->add(hammer);
    parts.hammer = hammer;
    auto axe = tvg::Scene::gen();
    auto wrist = parts.arms[1].wrist;
    axe->add(line(wrist, wrist + Point{6, -8}, 1.4f, opaque(wood)));
    axe->add(polygon({wrist + Point{4.8f, -9}, wrist + Point{9.5f, -7}, wrist + Point{10, -3.7f}, wrist + Point{5.8f, -6}}, opaque(steel)));
    axe->opacity(0);
    parts.arms[1].forearm->add(axe);
    parts.axe = axe;
    auto pickaxe = tvg::Scene::gen();
    pickaxe->add(line(wrist, wrist + Point{6, -8}, 1.4f, opaque(wood)));
    pickaxe->add(polygon({wrist + Point{1, -9}, wrist + Point{5.5f, -11}, wrist + Point{10, -8}, wrist + Point{11, -5},
                         wrist + Point{7, -8}, wrist + Point{5, -9}, wrist + Point{1, -8}}, opaque(steel)));
    pickaxe->opacity(0); parts.arms[1].forearm->add(pickaxe); parts.pickaxe = pickaxe;
    // Loads carried on the back.
    auto sack = tvg::Scene::gen();
    sack->add(ellipse({-4.5f, -11}, 3.6f, 4.2f, {176, 150, 96}));
    sack->opacity(0);
    sprite->add(sack);
    parts.sack = sack;
    auto logs = tvg::Scene::gen();
    for (int i = 0; i < 3; ++i) {
        Point end{-6.f + i * 2.4f, -13.f + (i % 2) * 2};
        logs->add(line(end + Point{-3.5f, -3}, end, 3.5f, {90, 63, 40}));
        logs->add(ellipse(end, 1.8f, 1.8f, {164, 124, 78}));
    }
    logs->opacity(0);
    sprite->add(logs);
    parts.logs = logs;
    auto stones = tvg::Scene::gen();
    stones->add(polygon({{-8, -9}, {-6, -14}, {-2, -13}, {-1, -9}}, {120, 118, 128}));
    stones->opacity(0);
    sprite->add(stones);
    parts.stone = stones;
    auto mark = ellipse({0, -22}, 2.4f, 2.4f, {230, 80, 64, 255});
    mark->opacity(0);
    sprite->add(mark);
    parts.alert = mark;
    return sprite;
}
}  // namespace

tvg::Scene* personSprite(const Person& person, PersonParts& parts)
{
    parts = {};
    return figureOf(person, parts);
}

Point personSpeechAnchor(const Person& person)
{
    auto a = appearanceOf(person);
    float rise = streetCrownRise(streetHairStyle(a));
    return {0, -figureHeight(person) - 3 - rise - 1.5f};
}

tvg::Scene* personCloseup(const Person& person, Mood)
{
    return characterFigure(appearanceOf(person));
}

void stridePose(PersonParts& parts, float stride, bool walking)
{
    // The figure faces the viewer three-quarters on, toward +x: the arm swinging forward reaches
    // that way and shortens toward the eye, the other trails behind. Feet step and lift in turn.
    float swing = walking ? std::sin(stride) : 0;
    for (int i = 0; i < 2; ++i) {
        float phase = (i ? -1.f : 1.f) * swing, forward = std::max(0.f, phase), back = std::max(0.f, -phase);
        float angle = -.5f * forward + .35f * back, squash = 1 - .25f * forward;
        poseArm(parts.arms[size_t(i)], angle, 0, 0, 0, squash);
        float lift = walking ? std::max(0.f, (i ? -1.f : 1.f) * std::cos(stride)) * .55f : 0;
        ui::setTransform(parts.feet[i], {1, 0, (i ? -.75f : .75f) * swing, 0, 1, -lift, 0, 0, 1});
    }
}

tvg::Paint* dungeonSprite(tvg::Scene* objects, tvg::Scene* lights, const Dungeon& site)
{
    auto c = dungeonCenter(site);
    Rgb rock{74, 72, 80}, rockShade{48, 46, 54}, dark{8, 8, 12};
    tvg::Paint* pulse = nullptr;
    switch (site.kind) {
    case DungeonKind::Cave:
        lights->add(glow({c.x - 8, c.y + 8}, 60, 30, {90, 220, 200}, 70));
        objects->add(polygon({{c.x - 56, c.y + 6}, {c.x - 34, c.y - 30}, {c.x - 6, c.y - 46}, {c.x + 4, c.y - 20}, {c.x - 4, c.y + 24}, {c.x - 30, c.y + 22}}, opaque(rock)));
        objects->add(polygon({{c.x - 6, c.y - 46}, {c.x + 26, c.y - 34}, {c.x + 56, c.y + 4}, {c.x + 22, c.y + 22}, {c.x - 4, c.y + 24}, {c.x + 4, c.y - 20}}, opaque(rockShade)));
        objects->add(polygon({{c.x - 24, c.y + 14}, {c.x - 22, c.y - 8}, {c.x - 12, c.y - 18}, {c.x, c.y - 12}, {c.x + 2, c.y + 16}}, opaque(dark)));
        for (int i = 0; i < 4; ++i) objects->add(line({c.x - 30.f + i * 2, c.y - 2.f - i * 6}, {c.x - 27.f + i * 2, c.y - 6.f - i * 6}, 1.4f, opaque({120, 240, 220})));
        pulse = glow({c.x - 11, c.y + 2}, 12, 12, {120, 240, 220}, 120);
        objects->add(pulse);
        break;
    case DungeonKind::Crypt: {
        lights->add(glow(c, 70, 35, {170, 110, 240}, 60));
        Point n = project(site.origin.x + .2f, site.origin.y + .2f), e = project(site.origin.x + 1.8f, site.origin.y + .2f);
        Point s = project(site.origin.x + 1.8f, site.origin.y + 1.8f), w = project(site.origin.x + .2f, site.origin.y + 1.8f);
        objects->add(polygon({w, s, {s.x, s.y + 7}, {w.x, w.y + 7}}, opaque(rockShade)));
        objects->add(polygon({s, e, {e.x, e.y + 7}, {s.x, s.y + 7}}, opaque(scale(rockShade, .7f))));
        objects->add(polygon({n, e, s, w}, opaque(rock)));
        objects->add(polygon({{c.x - 14, c.y + 2}, {c.x + 2, c.y - 6}, {c.x + 16, c.y + 1}, {c.x, c.y + 9}}, opaque(dark)));
        pulse = glow(c, 16, 8, {190, 130, 255}, 140);
        objects->add(pulse);
        for (auto [x, y, h] : {std::array<float, 3>{.35f, .35f, 34}, {1.65f, .35f, 22}, {.35f, 1.65f, 26}, {1.65f, 1.65f, 40}}) {
            auto b = project(site.origin.x + x, site.origin.y + y);
            objects->add(polygon({{b.x - 5, b.y}, {b.x, b.y + 2.5f}, {b.x, b.y - h + 3}, {b.x - 5, b.y - h}}, opaque({96, 94, 104})));
            objects->add(polygon({{b.x, b.y + 2.5f}, {b.x + 5, b.y}, {b.x + 5, b.y - h + 6}, {b.x, b.y - h + 3}}, opaque({62, 60, 70})));
        }
        break;
    }
    case DungeonKind::Portal:
        lights->add(glow(c, 80, 40, {190, 110, 255}, 80));
        for (int i = 0; i < 6; ++i) {
            float a = i * 1.047f + .3f;
            Point b{c.x + std::cos(a) * 46, c.y + std::sin(a) * 23};
            objects->add(polygon({{b.x - 4, b.y}, {b.x + 4, b.y}, {b.x + 3, b.y - 14}, {b.x - 2, b.y - 16}}, opaque(i % 2 ? rock : rockShade)));
        }
        objects->add(polygon({{c.x - 20, c.y + 4}, {c.x - 13, c.y + 4}, {c.x - 13, c.y - 40}, {c.x - 20, c.y - 40}}, opaque(rock)));
        objects->add(polygon({{c.x + 13, c.y + 4}, {c.x + 20, c.y + 4}, {c.x + 20, c.y - 40}, {c.x + 13, c.y - 40}}, opaque(rockShade)));
        objects->add(polygon({{c.x - 24, c.y - 40}, {c.x + 24, c.y - 40}, {c.x + 22, c.y - 48}, {c.x - 22, c.y - 48}}, opaque(rock)));
        {
            auto swirl = tvg::Scene::gen();
            swirl->add(ellipse({0, 0}, 13, 20, {120, 60, 200}));
            swirl->add(ellipse({1, 1}, 9, 15, {170, 110, 250}));
            swirl->add(ellipse({2, 2}, 4, 8, {236, 200, 255}));
            swirl->translate(c.x, c.y - 18);
            pulse = swirl;
            objects->add(swirl);
        }
        break;
    case DungeonKind::Ruin: {
        lights->add(glow(c, 64, 32, {150, 230, 120}, 50));
        Point b = project(site.origin.x + 1.f, site.origin.y + 1.2f);
        objects->add(polygon({{b.x - 22, b.y - 6}, {b.x, b.y + 5}, {b.x, b.y - 46}, {b.x - 6, b.y - 52}, {b.x - 12, b.y - 44}, {b.x - 22, b.y - 58}}, opaque(rock)));
        objects->add(polygon({{b.x, b.y + 5}, {b.x + 22, b.y - 6}, {b.x + 22, b.y - 36}, {b.x + 14, b.y - 30}, {b.x + 8, b.y - 40}, {b.x, b.y - 46}}, opaque(rockShade)));
        objects->add(polygon({{b.x - 14, b.y - 22}, {b.x - 8, b.y - 19}, {b.x - 8, b.y - 30}, {b.x - 14, b.y - 33}}, opaque(dark)));
        for (int i = 0; i < 5; ++i) {
            Point r{c.x + 18.f + i * 7 - (i % 2) * 10, c.y + 8.f + (i % 3) * 4};
            objects->add(polygon({{r.x - 4, r.y}, {r.x, r.y - 4}, {r.x + 4, r.y}, {r.x, r.y + 2}}, opaque(i % 2 ? rock : rockShade)));
        }
        pulse = glow({b.x - 11, b.y - 26}, 10, 10, {170, 250, 130}, 120);
        objects->add(pulse);
        break;
    }
    }
    label(objects, {c.x, c.y - 66}, site.name);
    return pulse;
}

LanternLight lantern(tvg::Scene* objects, tvg::Scene* lights, Point base, bool arcaneLight)
{
    auto light = arcaneLight ? arcane : warm;
    Point flame{base.x + 4, base.y - 14};
    LanternLight lamp{glow(base, 20, 10, light, 45), ellipse(flame, 4, 4, opaque(light, 70)), flame};
    lights->add(lamp.glow);
    objects->add(line(base, {base.x, base.y - 17}, 1.6f, {36, 30, 28}));
    objects->add(line({base.x, base.y - 17}, {base.x + 4, base.y - 17}, 1.2f, {36, 30, 28}));
    objects->add(lamp.halo);
    objects->add(ellipse(flame, 1.8f, 1.8f, opaque(light)));
    return lamp;
}
}  // namespace hearthold

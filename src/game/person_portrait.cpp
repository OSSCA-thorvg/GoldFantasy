#include "person_portrait.h"
#include "person_look.h"
#include "character_assets.h"
#include "world_sprites.h"
#include <algorithm>

namespace hearthold
{
Mood moodOf(const Person& p)
{
    if (p.activity == Activity::Sleeping && !p.moving() && !p.crossingDoorway()) return Mood::Asleep;
    if (p.activity == Activity::Fighting) return Mood::Fierce;
    if (p.health < .35f) return Mood::Hurt;
    if (p.rest < .12f) return Mood::Exhausted;
    if (p.food < .2f) return Mood::Hungry;
    if (p.stress > .65f) return Mood::Stressed;
    if (p.rest < .3f) return Mood::Tired;
    bool easy = p.stress < .2f && p.food > .5f && p.rest > .5f;
    if (easy || p.activity == Activity::Relaxing || p.activity == Activity::Praying) return Mood::Cheerful;
    return Mood::Content;
}

const char* moodName(Mood mood)
{
    switch (mood) {
    case Mood::Content: return "Content";
    case Mood::Cheerful: return "Cheerful";
    case Mood::Tired: return "Tired";
    case Mood::Exhausted: return "Exhausted";
    case Mood::Hungry: return "Hungry";
    case Mood::Stressed: return "Stressed";
    case Mood::Hurt: return "Hurt";
    case Mood::Asleep: return "Asleep";
    case Mood::Fierce: return "Fierce";
    }
    return "";
}

tvg::Scene* personPortrait(const Person& person, Mood, float width, float height, const PortraitBackdrop& backdrop)
{
    auto frame = tvg::Scene::gen();
    frame->add(portraitBackground(backdrop, width, height));
    auto look=appearanceOf(person);
    auto figure=characterFigure(look);
    auto placement=characterPortraitPlacement(width,height);
    figure->scale(placement.scale);
    figure->translate(placement.origin.x,placement.origin.y);
    frame->add(figure);
    auto clipper = tvg::Shape::gen();
    float r = std::min(width, height) * .035f;
    clipper->appendRect(0, 0, width, height, r, r);
    frame->clip(clipper);
    // A clipper ignores its own paint's transform; wrapped, the caller may move the portrait freely.
    auto holder = tvg::Scene::gen();
    holder->add(frame);
    return holder;
}
}  // namespace hearthold

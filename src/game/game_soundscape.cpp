#include "game_app.h"
#include <algorithm>
#include <cmath>

namespace hearthold
{
Cue noticeCue(std::string_view text)
{
    // Gold jingles, a settlement growing stacks its pieces, a newly found gate wakes like a runestone and an opened
    // one grinds like a stone door.
    if (text.find(" gold") != std::string_view::npos) return Cue::Coins;
    if (text.find(" grew into ") != std::string_view::npos || text.find(" merged into ") != std::string_view::npos) return Cue::Growth;
    if (text.starts_with("Discovered ")) return Cue::Discover;
    if (text.ends_with(" is open to adventurers")) return Cue::Unseal;
    return Cue::Notice;
}

bool GameApp::sayLine(int id, VoiceLine line)
{
    const auto* person = town.person(id);
    if (!person) return false;
    auto voice = voiceKind(appearanceOf(*person).bodyType, person->look, person->id);
    return speakers[id].speech.say(line, std::max(0.0, last), characterVoicePitch(person->look, person->id), voice);
}

void GameApp::playMoment(Moment moment, double seconds)
{
    // While a bard plays, the town listens to them.
    if (town.bardPlaying()) return;
    auto track = director.moment(moment, seconds);
    if (track.empty()) return;
    Sound tune{Cue::Music};
    tune.track = track;
    cues.push_back(tune);
}

void GameApp::raiseAlarm(double seconds)
{
    playMoment(Moment::Battle, seconds);
    // Someone cries it: one of those picked out, or whoever stands nearest the middle of the view.
    int crier = chosen.empty() ? -1 : chosen.front();
    if (crier < 0) {
        auto middle = unproject(camera.x, camera.y);
        float best = 1e9f;
        for (const auto& person : town.people()) {
            float gap = distance(person.position, middle);
            if (person.visibility() > .05f && gap < best && renderer.visible(person.position)) {
                best = gap;
                crier = person.id;
            }
        }
    }
    if (crier >= 0) sayLine(crier, VoiceLine::Alarm);
}

void GameApp::grunt(int id)
{
    auto found = speakers.find(id);
    if (found != speakers.end() && found->second.speech.playing(last)) return;
    sayLine(id, VoiceLine::Hut);
}

void GameApp::soundscape(double seconds)
{
    const auto& sky = town.climate();
    bool dark = sky.night > .5f;
    auto roll = [&](int salt) { return hash01(town.map().seed(), int(seconds * 10), salt, 0x4a7eu); };
    if (soundscaping) {
        // Whoever is newly picked out answers; a group answers through one of them.
        auto fresh = std::find_if(chosen.begin(), chosen.end(), [&](int id) { return std::find(heardChosen.begin(), heardChosen.end(), id) == heardChosen.end(); });
        if (fresh != chosen.end()) sayLine(*fresh, VoiceLine::Select);
        // An order that went through is answered by one of those given it.
        bool ordered = std::any_of(cues.begin(), cues.end(), [](const Sound& sound) { return sound.cue == Cue::Order; });
        if (ordered && status.empty() && !chosen.empty()) sayLine(chosen[size_t(roll(1) * float(chosen.size())) % chosen.size()], VoiceLine::Ack);
        // Picking out a building or a gate taps softly; letting it go is quiet. What cannot be done knocks dully.
        int shown = selected >= 0 ? selected : selectedDungeon >= 0 ? 1000000 + selectedDungeon : -1;
        bool placed = std::any_of(cues.begin(), cues.end(), [](const Sound& sound) { return sound.cue == Cue::Place; });
        if (shown != heardSelected && shown >= 0 && !placed) cues.push_back({Cue::Open, .55f});
        if (status != heardStatus && !status.empty()) cue(Cue::Refuse);
        // Daybreak and nightfall may bring a tune.
        if (dark != wasDark) playMoment(dark ? Moment::Dusk : Moment::Dawn, seconds);
    }
    heardChosen = chosen;
    heardSelected = selected >= 0 ? selected : selectedDungeon >= 0 ? 1000000 + selectedDungeon : -1;
    heardStatus = status;
    wasDark = dark;
    // A raven calls now and then over the land by day, from somewhere about the view.
    bool wet = sky.weather == Weather::Rain || sky.weather == Weather::Storm;
    if (seconds >= nextRaven) {
        float near = std::clamp((camera.zoom - .3f) / .9f, 0.f, 1.f), chance = roll(2);
        if (soundscaping && !dark && !wet && near > .2f) cues.push_back({Cue::Raven, (.22f + .2f * chance) * near, chance * 1.6f - .8f});
        nextRaven = seconds + 40 + 80 * chance;
    }
    // Lightning in wet weather: the flash at once, its thunder after, from the side it struck.
    if (gameSpeed() > 0) {
        if (auto strike = storm.update(seconds, sky.weather, sky.intensity)) {
            renderer.lightning(*strike);
            // Softer the further off: a crack overhead is loud, thunder beyond the hills a low roll.
            constexpr float loudness[] = {.9f, .75f, .55f, .4f};
            Sound thunder{Cue(uint8_t(Cue::ThunderCrack) + uint8_t(strike->reach)), loudness[size_t(strike->reach)], std::clamp(strike->across * 2 - 1, -1.f, 1.f) * .8f};
            thunder.delay = strike->delay;
            cues.push_back(thunder);
        }
    }
    soundscaping = true;
}
}  // namespace hearthold

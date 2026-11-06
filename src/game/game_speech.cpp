#include "game_app.h"
#include "person_portrait.h"
#include "effect_manager.h"
#include <algorithm>
#include <cmath>

namespace hearthold
{
bool GameApp::sayPerson(int id, std::string_view text)
{
    const auto* person = town.person(id);
    if (!person) return false;
    return speakers[id].speech.say(text, std::max(0.0, last), characterVoicePitch(person->look, person->id), voiceKind(appearanceOf(*person).bodyType, person->look, person->id));
}

const PersonSpeech* GameApp::personSpeech(int id) const
{
    auto found = speakers.find(id);
    return found == speakers.end() ? nullptr : &found->second.speech;
}

void GameApp::updateSpeech(double seconds)
{
#if HEARTHOLD_WITH_EDITOR
    const bool editing = editor.has_value();
#else
    constexpr bool editing = false;
#endif
    auto audible = [&](const Person& person) {
        auto screen = toScreen(person.position);
        return !editing && !person.inside && !person.crossingDoorway() && screen.x >= -24 && screen.x <= viewWidth + 24 &&
               screen.y >= 0 && screen.y <= viewHeight + 24 && renderer.visible(person.position);
    };
    std::array<int, 2> talking{};
    for (const auto& person : town.people()) {
        auto found = speakers.find(person.id);
        if (found == speakers.end() || !found->second.speech.playing(seconds) || !audible(person)) continue;
        ++talking[std::find(chosen.begin(), chosen.end(), person.id) != chosen.end() ? 0 : 1];
    }
    for (const auto& person : town.people()) {
        bool selectedPerson = std::find(chosen.begin(), chosen.end(), person.id) != chosen.end();
        bool heardHere = audible(person);
        auto found = speakers.find(person.id);
        if (!heardHere && found == speakers.end()) continue;
        auto& state = speakers[person.id];
        auto& speech = state.speech;
        auto channel = selectedPerson ? SpeechChannel::Selected : SpeechChannel::Nearby;
        if (state.heard && state.heardChannel != channel) {
            Sound stop{Cue::SpeechStop}; stop.speaker = person.id; cues.push_back(stop); state.heard = 0;
        }
        state.heardChannel = channel;
        size_t group = selectedPerson ? 0 : 1;
        int limit = int(selectedPerson ? EffectManager::maxSelectedSpeech : EffectManager::maxNearbySpeech);
        bool automatic = heardHere && talking[group] < limit && seconds >= nextSpeechAt[group];
        auto before = speech.sequence();
        speech.update(person, moodOf(person), seconds, automatic);
        if (speech.sequence() != before) { ++talking[group]; nextSpeechAt[group] = seconds + (selectedPerson ? .85 : .35); }
        auto placement = spatial(Cue::Speech, person.position);
        placement.gain *= .6f;
        placement.speechChannel = channel;
        speechAudio(speech, person.id, placement, seconds, state.heard, heardHere);
    }
}

void GameApp::speechAudio(const PersonSpeech& speech, int speaker, Sound placement, double seconds, uint64_t& heard, bool audible)
{
    auto stop = [&] { Sound sound{Cue::SpeechStop}; sound.speaker = speaker; cues.push_back(sound); };
    if (!audible) {
        if (heard) stop();
        heard = 0;
        return;
    }
    if (heard == speech.sequence()) return;
    heard = speech.sequence();
    if (!speech.playing(seconds) || speech.voice() == VoiceLine::None) { stop(); return; }
    double offset = std::max(0.0, seconds - speech.startedAt() - .16);
    if (offset >= speech.voiceDuration() || placement.gain < .03f) return;
    placement.cue = Cue::Speech;
    placement.line = speech.voice(); placement.voice = speech.voiceKind(); placement.take = int8_t(speech.voiceTake());
    placement.pitch = speech.voicePitch(); placement.speaker = speaker;
    placement.delay = float(std::max(0.0, speech.startedAt() + .16 - seconds));
    placement.offset = float(offset); placement.duration = float(speech.voiceDuration());
    auto count = std::count_if(cues.begin(), cues.end(), [&](const Sound& sound) { return sound.cue == Cue::Speech && sound.speechChannel == placement.speechChannel; });
    auto limit = placement.speechChannel == SpeechChannel::Selected ? EffectManager::maxSelectedSpeech : EffectManager::maxNearbySpeech;
    if (size_t(count) < limit) cues.push_back(placement);
}

void GameApp::speechBubbles(float width, float height)
{
    if (width < 96 || height < 96) return;
    struct Bubble { Point anchor; ui::Rect box; std::string text; float alpha; };
    std::vector<Bubble> bubbles;
    for (const auto& person : town.people()) {
        auto found = speakers.find(person.id);
        if (found == speakers.end() || person.visibility() <= 0 || !renderer.visible(person.position)) continue;
        auto caption = found->second.speech.caption(context.time());
        float opacity = found->second.speech.captionOpacity(context.time()) * person.visibility();
        if (caption.empty() || opacity <= 0) continue;
        auto feet = toScreen(person.position), head = personSpeechAnchor(person);
        Point anchor{feet.x + head.x * camera.zoom, feet.y + head.y * camera.zoom};
        if (feet.x < -24 || feet.x > width + 24 || feet.y < 0 || feet.y > height + 24 || anchor.y < 8 || anchor.y > height - 48) continue;
        float w = std::clamp(context.textWidth(caption, 13) + 20, 54.f, std::min(200.f, width - 16));
        ui::Rect box{std::clamp(anchor.x - w / 2, 8.f, width - w - 8), std::max(8.f, anchor.y - 38 - (1 - opacity) * 4), w, 30};
        for (const auto& other : bubbles)
            if (box.x < other.box.x + other.box.w + 4 && box.x + box.w + 4 > other.box.x && box.y < other.box.y + other.box.h + 5 && box.y + box.h + 5 > other.box.y)
                box.y = std::max(8.f, other.box.y - box.h - 7);
        bubbles.push_back({anchor, box, std::string(caption), opacity});
    }
    for (const auto& bubble : bubbles) {
        auto surface = theme.raised, border = theme.border, ink = theme.text;
        surface.a = border.a = ink.a = uint8_t(255 * std::clamp(bubble.alpha, 0.f, 1.f));
        auto box = bubble.box;
        float stem = std::clamp(bubble.anchor.x, box.x + 9, box.x + box.w - 9);
        context.paint(ui::paintKey('b', box, bubble.anchor, surface), [=] {
            auto shape = tvg::Shape::gen();
            shape->moveTo(stem - 5, box.y + box.h - 1);
            shape->lineTo(bubble.anchor.x, bubble.anchor.y);
            shape->lineTo(stem + 5, box.y + box.h - 1);
            shape->close(); shape->fill(surface.r, surface.g, surface.b, surface.a);
            shape->strokeWidth(1); shape->strokeFill(border.r, border.g, border.b, border.a);
            return shape;
        });
        context.rect(box, surface, theme.radius, border);
        auto text = context.elideText(bubble.text, box.w - 16, 13);
        context.text({box.x + 8, box.y + 3, box.w - 16, box.h - 6}, text, ink, 13, false, ui::Align::Center);
        context.requestAnimationFrame();
    }
}
}  // namespace hearthold

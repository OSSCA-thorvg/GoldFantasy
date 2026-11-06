#include "effect_manager.h"
#include "game_app.h"
#include "spoken_voice.h"
#include <algorithm>
#include <cmath>

namespace hearthold
{
namespace
{
int priority(Cue cue)
{
    switch (cue) {
    case Cue::Alarm: return 10;
    case Cue::Click: case Cue::Order: case Cue::Refuse: case Cue::Open: return 8;
    case Cue::Notice: case Cue::Complete: case Cue::Growth: case Cue::Discover: case Cue::Unseal: case Cue::ThunderCrack: case Cue::ThunderStrike: return 6;
    case Cue::Place: case Cue::Demolish: case Cue::Howl: case Cue::TreeFall: case Cue::Coins: case Cue::ThunderClap: case Cue::ThunderRumble: return 4;
    default: return 2;
    }
}
double interval(Cue cue)
{
    switch (cue) {
    case Cue::Click: return .04;
    case Cue::Order: case Cue::Place: case Cue::Open: return .08;
    case Cue::Refuse: return .2;
    case Cue::Notice: case Cue::Complete: return .3;
    case Cue::Growth: case Cue::Coins: case Cue::Discover: case Cue::Unseal: return .5;
    case Cue::Alarm: case Cue::Howl: return 1;
    case Cue::Speech: return .25;
    case Cue::Chop: case Cue::Mine: return .12;
    case Cue::TreeFall: return .4;
    case Cue::Raven: return 4;
    case Cue::ThunderCrack: case Cue::ThunderStrike: case Cue::ThunderClap: case Cue::ThunderRumble: return 1.5;
    default: return .1;
    }
}
bool interaction(Cue cue) { return cue == Cue::Click || cue == Cue::Order || cue == Cue::Place || cue == Cue::Refuse || cue == Cue::Open; }
bool thunder(Cue cue) { return cue >= Cue::ThunderCrack && cue <= Cue::ThunderRumble; }
}

uint64_t EffectManager::request(const Sound& sound)
{
    if (sound.cue == Cue::SpeechStop) { stopSpeech(sound.speaker); return 0; }
    auto reject = [&] { ++totals.dropped; return uint64_t(0); };
    // Music plays on a channel of its own and never takes a slot.
    if (uint8_t(sound.cue) >= uint8_t(Cue::Music) || !std::isfinite(sound.gain) || sound.gain <= 0 || !std::isfinite(sound.pan)) return reject();
    auto key = uint8_t(sound.cue);
    Slot* chosen = nullptr;
    Slot* previous = nullptr;
    if (sound.cue == Cue::Speech) {
        if (sound.speaker < -1 || !voiceSample(sound.line, sound.voice, sound.take).frames || !std::isfinite(sound.pitch) || sound.pitch <= 0 ||
            !std::isfinite(sound.duration) || sound.duration <= 0 || !std::isfinite(sound.offset) || sound.offset < 0 || sound.offset >= sound.duration ||
            !std::isfinite(sound.delay) || sound.delay < 0 ||
            (sound.speechChannel != SpeechChannel::Selected && sound.speechChannel != SpeechChannel::Nearby)) return reject();
        size_t first = maxEffects + (sound.speechChannel == SpeechChannel::Selected ? 0 : maxSelectedSpeech);
        size_t last = first + (sound.speechChannel == SpeechChannel::Selected ? maxSelectedSpeech : maxNearbySpeech);
        for (size_t i = maxEffects; i < maxConcurrent; ++i)
            if (slots[i].token && slots[i].speaker == sound.speaker) previous = &slots[i];
        for (size_t i = first; i < last; ++i) {
            if (&slots[i] == previous) { chosen = previous; break; }
            if (!chosen && !slots[i].token && now + 1e-9 >= nextSpeechAllowed[i - maxEffects]) chosen = &slots[i];
        }
        if (!chosen) return reject();
    } else {
        if (now + 1e-9 < nextAllowed[key]) return reject();
        size_t same = 0;
        Slot* oldest = nullptr;
        for (size_t i = 0; i < maxEffects; ++i) {
            auto& slot = slots[i];
            if (!slot.token && !chosen) chosen = &slot;
            if (slot.token && slot.cue == sound.cue) {
                ++same;
                if (!oldest || slot.token < oldest->token) oldest = &slot;
            }
        }
        size_t limit = interaction(sound.cue) || sound.cue == Cue::Alarm || sound.cue == Cue::Howl || sound.cue == Cue::TreeFall || sound.cue == Cue::Raven || sound.cue == Cue::Growth || thunder(sound.cue) ? 1 : 2;
        if (same >= limit) {
            if (!interaction(sound.cue)) return reject();
            chosen = oldest;
        }
        if (!chosen) {
            auto lowest = std::min_element(slots.begin(), slots.begin() + maxEffects, [](const Slot& a, const Slot& b) {
                return a.priority < b.priority || (a.priority == b.priority && a.token < b.token);
            });
            if (priority(sound.cue) <= lowest->priority) return reject();
            chosen = &*lowest;
        }
    }
    if (chosen->token || previous) ++totals.replaced;
    if (previous && previous != chosen) *previous = {};
    auto token = serial++;
    if (!token) token = serial++;
    *chosen = {token, sound.cue, sound.speaker, priority(sound.cue)};
    if (sound.cue == Cue::Speech) nextSpeechAllowed[size_t(chosen - slots.data()) - maxEffects] = now + interval(sound.cue);
    else nextAllowed[key] = now + interval(sound.cue);
    ++totals.accepted;
    return token;
}

bool EffectManager::active(uint64_t token) const
{
    return token && std::any_of(slots.begin(), slots.end(), [&](const Slot& slot) { return slot.token == token; });
}

void EffectManager::finish(uint64_t token)
{
    for (auto& slot : slots) if (token && slot.token == token) { slot = {}; return; }
}

void EffectManager::stopSpeech(int speaker)
{
    for (size_t i = maxEffects; i < maxConcurrent; ++i) {
        auto& voice = slots[i];
        if (speaker != -2 && voice.speaker != speaker) continue;
        voice = {};
        nextSpeechAllowed[i - maxEffects] = now;
    }
}

void EffectManager::advance(double seconds)
{
    if (std::isfinite(seconds) && seconds > 0) now += seconds;
}

void EffectManager::clear()
{
    slots = {}; nextAllowed = {}; nextSpeechAllowed = {}; now = 0; totals = {};
    // Preserve serials: a voice from an in-flight callback must never become valid again.
}

EffectManager::Statistics EffectManager::statistics() const
{
    auto result = totals;
    for (size_t i = 0; i < maxEffects; ++i) result.effects += slots[i].token != 0;
    for (size_t i = maxEffects; i < maxConcurrent; ++i) {
        if (!slots[i].token) continue;
        ++result.speech;
        if (i < maxEffects + maxSelectedSpeech) ++result.selectedSpeech;
        else ++result.nearbySpeech;
    }
    return result;
}
}

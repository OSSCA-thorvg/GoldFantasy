#include <GameEngine/GameFramework/animation.h>
#include "person_speech.h"
#include "world_map.h"
#include <ui/ui.h>
#include <ui/text/text.h>
#include <algorithm>
#include <cmath>

namespace hearthold
{
namespace
{

float randomDelay(uint32_t seed, double seconds)
{
    return 7 + hash01(seed, int(std::max(0.0, seconds)), 0, 0x501ceu) * 7;
}

// What a line says when its take's words are not known.
std::string_view usualWords(VoiceLine line)
{
    switch (line) {
    case VoiceLine::Hmm: case VoiceLine::Murmur: return "Hmm.";
    case VoiceLine::Ahh: return "Ha, good!";
    case VoiceLine::Attack: return "Hah!";
    case VoiceLine::Hut: return "Ugh!";
    case VoiceLine::Phew: return "Haaah.";
    case VoiceLine::Mumble: return "Hmm, where was I...";
    case VoiceLine::Select: return "Yes?";
    case VoiceLine::Ack: return "Aye!";
    case VoiceLine::Work: return "Hup!";
    case VoiceLine::Yawn: return "Haaah... mmh.";
    case VoiceLine::Sleep: return "Mmm...";
    case VoiceLine::Complain: return "Not again.";
    case VoiceLine::Thanks: return "Thank you!";
    case VoiceLine::Alarm: return "To arms!";
    case VoiceLine::Death: return "Ugh...";
    case VoiceLine::None: case VoiceLine::Count: return {};
    }
    return {};
}
}  // namespace

bool PersonSpeech::say(std::string_view text, double seconds, float rate, VoiceKind voice)
{
    auto line = voiceLine(text);
    int takes = voiceTakes(line, voice);
    return speak(text, line, seconds, rate, voice, takes > 1 ? int(hash01(uint32_t(serial), int(seconds * 1000), 1, 0x7a4eu) * takes) % takes : 0);
}

bool PersonSpeech::say(VoiceLine line, double seconds, float rate, VoiceKind voice, int pick)
{
    int takes = voiceTakes(line, voice);
    if (line <= VoiceLine::None || line >= VoiceLine::Count || !takes) return false;
    if (pick < 0 || pick >= takes) pick = int(hash01(uint32_t(serial), int(seconds * 1000), 2, 0x7a4eu) * takes) % takes;
    auto words = voiceWords(line, voice, pick);
    return speak(words.empty() ? usualWords(line) : words, line, seconds, rate, voice, pick);
}

bool PersonSpeech::speak(std::string_view text, VoiceLine line, double seconds, float rate, VoiceKind voice, int pick)
{
    te::Codepoints valid;
    if (!std::isfinite(seconds) || !std::isfinite(rate) || rate < .5f || rate > 2 || text.empty() || text.size() > maxCharacters * 4 || !valid.add(text)) return false;
    std::vector<Syllable> next;
    double at = .16;
    bool sounded = false;
    for (size_t i = 0; i < text.size();) {
        if (next.size() == maxCharacters) return false;
        auto byte = uint8_t(text[i++]);
        uint32_t cp = byte;
        if (byte >= 0xc0) {
            int more = byte >= 0xf0 ? 3 : byte >= 0xe0 ? 2 : 1;
            cp &= (1u << (6 - more)) - 1;
            for (int n = 0; n < more; ++n) cp = (cp << 6) | (uint8_t(text[i++]) & 63);
        }
        float span = .09f;
        bool soundedUnit = true;
        auto lower = cp >= 'A' && cp <= 'Z' ? cp + ('a' - 'A') : cp;
        if (cp < 32 || cp == 127) return false;
        if (cp == ' ' || cp == '\t') { span = .045f; soundedUnit = false; }
        else if (cp == '.' || cp == ',' || cp == '!' || cp == '?' || cp == 0x2026) {
            span = cp == ',' ? .18f : cp == 0x2026 ? .48f : .28f;
            soundedUnit = false;
        } else {
            sounded = true;
            if (lower == 'a' || lower == 'h' || lower == 'o' || lower == 'u' || lower == 'w') span = .13f;
        }
        next.push_back({at, at + span, i, soundedUnit});
        at += span;
    }
    if (!sounded) return false;
    if (line != VoiceLine::None && line != VoiceLine::Murmur) {
        double voicedEnd = .16;
        for (const auto& unit : next) if (unit.sounded) voicedEnd = unit.end;
        double span = voiceSample(line, voice, pick).duration() / rate;
        double factor = span / std::max(.001, voicedEnd - .16);
        auto remap = [&](double time) { return time <= voicedEnd ? .16 + (time - .16) * factor : time + .16 + span - voicedEnd; };
        for (auto& unit : next) { unit.begin = remap(unit.begin); unit.end = remap(unit.end); }
        at = next.back().end;
    }
    words = text;
    ++serial;
    syllables = std::move(next);
    started = seconds;
    sound = line;
    speaker = voice;
    take = pick;
    pitch = rate;
    length = at;
    nextUtterance = seconds + length + 9;
    return true;
}

void PersonSpeech::stop()
{
    ++serial;
    started = -1;
    words.clear();
    syllables.clear();
    length = 0;
    sound = VoiceLine::None;
}

bool PersonSpeech::playing(double seconds) const { return started >= 0 && seconds >= started && seconds < started + length + .2; }

void PersonSpeech::update(const Person& person, Mood mood, double seconds, bool automatic)
{
    if (!std::isfinite(seconds)) return;
    bool attack = (!observed || previous != Activity::Fighting) && person.activity == Activity::Fighting;
    previous = person.activity;
    observed = true;
    if (nextUtterance < 0) nextUtterance = seconds + randomDelay(person.look, person.id);
    if (!automatic || playing(seconds) || (!attack && seconds < nextUtterance)) return;
    // Something for how they are: cries in a fight, a grunt when hurt, sighs and yawns when worn out, grumbling
    // when hungry or harried, and otherwise a hum, a happy word or a muttered remark. Sleepers only mumble now
    // and then.
    float roll = hash01(person.look, int(seconds), person.id, 0x5a1du);
    VoiceLine line = roll < .45f ? VoiceLine::Hmm : roll < .75f ? VoiceLine::Mumble : VoiceLine::Ahh;
    if (mood == Mood::Fierce) line = VoiceLine::Attack;
    else if (mood == Mood::Hurt) line = VoiceLine::Hut;
    else if (mood == Mood::Tired || mood == Mood::Exhausted) line = roll < .55f ? VoiceLine::Phew : VoiceLine::Yawn;
    else if (mood == Mood::Hungry) line = VoiceLine::Complain;
    else if (mood == Mood::Stressed) line = roll < .5f ? VoiceLine::Phew : VoiceLine::Complain;
    else if (mood == Mood::Cheerful) line = roll < .6f ? VoiceLine::Ahh : VoiceLine::Hmm;
    else if (mood == Mood::Asleep) line = VoiceLine::Sleep;
    auto voice = hearthold::voiceKind(appearanceOf(person).bodyType, person.look, person.id);
    if (say(line, seconds, characterVoicePitch(person.look, person.id), voice))
        nextUtterance = seconds + length + randomDelay(person.look, seconds) * (mood == Mood::Asleep ? 6 : 1);
}

std::string_view PersonSpeech::caption(double seconds) const
{
    if (started < 0 || seconds < started || seconds >= started + length + 1.2) return {};
    size_t bytes = 0;
    double t = seconds - started;
    for (const auto& unit : syllables) {
        if (t < unit.begin) break;
        bytes = unit.bytes;
    }
    return std::string_view(words).substr(0, bytes);
}

float PersonSpeech::captionOpacity(double seconds) const
{
    if (started < 0) return 0;
    float t = float(seconds - started);
    return gameframework::smoothstep(t / .14f) * (1 - gameframework::smoothstep((t - float(length) - .8f) / .4f));
}

}  // namespace hearthold

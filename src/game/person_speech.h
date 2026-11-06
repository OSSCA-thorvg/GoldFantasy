#pragma once

#include "person_look.h"
#include "spoken_voice.h"
#include <algorithm>
#include <string_view>
#include <vector>

namespace hearthold
{
class PersonSpeech
{
public:
    static constexpr size_t maxCharacters = 160;
    // Typed text, voiced by the clip it names (or hummed under) in `voice`.
    bool say(std::string_view text, double seconds, float pitch = 1, VoiceKind voice = VoiceKind::Huntress);
    // A line in `voice`, captioned with the words of the take said: `take` < 0 picks one.
    bool say(VoiceLine, double seconds, float pitch, VoiceKind voice, int take = -1);
    void stop();
    void update(const Person&, Mood, double seconds, bool automatic = true);
    std::string_view caption(double seconds) const;
    bool playing(double seconds) const;
    double duration() const { return length; }
    const std::string& text() const { return words; }
    float captionOpacity(double seconds) const;
    uint64_t sequence() const { return serial; }
    double startedAt() const { return started; }
    VoiceLine voice() const { return sound; }
    VoiceKind voiceKind() const { return speaker; }
    int voiceTake() const { return take; }
    float voicePitch() const { return pitch; }
    double voiceDuration() const { return sound == VoiceLine::Murmur ? std::max(0.0, length - .16) : voiceSample(sound, speaker, take).duration() / pitch; }

private:
    struct Syllable
    {
        double begin, end;
        size_t bytes;
        bool sounded;
    };
    std::string words;
    std::vector<Syllable> syllables;
    double started = -1, length = 0, nextUtterance = -1;
    Activity previous = Activity::Idle;
    bool observed = false;
    uint64_t serial = 0;
    bool speak(std::string_view text, VoiceLine, double seconds, float pitch, VoiceKind voice, int take);
    VoiceLine sound = VoiceLine::None;
    VoiceKind speaker = VoiceKind::Huntress;
    int take = 0;
    float pitch = 1;
};

}  // namespace hearthold

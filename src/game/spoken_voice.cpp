#include "spoken_voice.h"
#include "world_map.h"
#include <algorithm>
#include <cmath>
#include <iterator>
#include <string>

namespace hearthold
{
namespace
{
constexpr std::string_view voices[] = {"young", "berserker", "maiden", "huntress", "veteran"};
// The clips each line is said in, in VoiceLine order; Murmur hums the way Hmm does.
constexpr std::string_view lines[] = {"hum", "happy", "attack", "hurt", "sigh", "hum", "mumble", "select", "ack", "work", "yawn", "sleep", "complain", "thanks", "alarm", "death"};
static_assert(std::size(lines) == size_t(VoiceLine::Count));
static_assert(std::size(voices) == size_t(VoiceKind::Count));

std::string prefix(VoiceLine line, VoiceKind voice)
{
    if (line <= VoiceLine::None || line >= VoiceLine::Count || voice >= VoiceKind::Count) return {};
    return "voice/" + std::string(voices[size_t(voice)]) + "/" + std::string(lines[size_t(line)]) + "_";
}
}  // namespace

VoiceLine voiceLine(std::string_view text)
{
    std::string key;
    for (unsigned char c : text) {
        if (c >= 'A' && c <= 'Z') c += 'a' - 'A';
        if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c >= 128) key += char(c);
    }
    if (key.empty()) return VoiceLine::None;
    if (key == "hmm" || key == "hm") return VoiceLine::Hmm;
    if (key == "ahh" || key == "ah") return VoiceLine::Ahh;
    if (key == "attack") return VoiceLine::Attack;
    if (key == "hut") return VoiceLine::Hut;
    if (key == "phew" || key == "hew") return VoiceLine::Phew;
    return VoiceLine::Murmur;
}

VoiceKind voiceKind(BodyType body, uint32_t look, int id)
{
    int kinds = body == BodyType::Female ? 3 : 2;
    int pick = std::min(kinds - 1, int(hash01(look, id, 0, 0x70ceu) * float(kinds)));
    return VoiceKind((body == BodyType::Female ? int(VoiceKind::Maiden) : 0) + pick);
}

int voiceTakes(VoiceLine line, VoiceKind voice)
{
    auto cue = prefix(line, voice);
    return cue.empty() ? 0 : sounds::count(cue);
}

VoiceSample voiceSample(VoiceLine line, VoiceKind voice, int take)
{
    auto cue = prefix(line, voice);
    return cue.empty() ? VoiceSample{} : sounds::clip(cue, take);
}

std::string_view voiceWords(VoiceLine line, VoiceKind voice, int take)
{
    auto cue = prefix(line, voice);
    return cue.empty() ? std::string_view{} : sounds::caption(sounds::name(cue, take));
}

float characterVoicePitch(uint32_t look, int id) { return .97f + hash01(look, id, 0, 0x701ceu) * .06f; }

float voiceSampleAt(VoiceLine line, double seconds, float pitch, VoiceKind voice, int take) { return voiceSample(line, voice, take).at(seconds, pitch); }
}  // namespace hearthold

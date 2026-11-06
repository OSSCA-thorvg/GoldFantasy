#pragma once

#include "person_appearance.h"
#include "sound_library.h"
#include <cstddef>
#include <cstdint>
#include <string_view>

namespace hearthold
{
// What a person says aloud: short barks and remarks, the lines they give when called on or set to work, and their
// cries in battle. Murmur hums under typed text no clip says; Mumble is a remark of its own.
enum class VoiceLine : int8_t {
    None = -1, Hmm, Ahh, Attack, Hut, Phew, Murmur, Mumble, Select, Ack, Work, Yawn, Sleep, Complain, Thanks, Alarm, Death, Count
};
// Five voices, two low and three high, each saying every line in a few takes.
enum class VoiceKind : uint8_t { Young, Berserker, Maiden, Huntress, Veteran, Count };

using VoiceSample = Clip;

VoiceLine voiceLine(std::string_view text);
// The voice someone speaks in: low or high by their body, then one of three by their looks.
VoiceKind voiceKind(BodyType, uint32_t look, int id);
// How many takes a voice has of a line, one of them decoded, and the words it says, when known.
int voiceTakes(VoiceLine, VoiceKind = VoiceKind::Huntress);
VoiceSample voiceSample(VoiceLine, VoiceKind = VoiceKind::Huntress, int take = 0);
std::string_view voiceWords(VoiceLine, VoiceKind, int take);
// Each person's voice sits a touch higher or lower: little enough to keep it natural.
float characterVoicePitch(uint32_t look, int id);
float voiceSampleAt(VoiceLine, double seconds, float pitch = 1, VoiceKind = VoiceKind::Huntress, int take = 0);
}  // namespace hearthold

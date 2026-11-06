#include "internal.h"
#include <core/utf8.h>
#include <algorithm>

namespace te::io::detail
{
namespace
{
Error invalidUtf8()
{
    return failure(ErrorCode::InvalidUtf8, Stage::Decode, "invalid UTF-8");
}
}  // namespace

Error Decoder::output(std::string_view bytes)
{
    if (limit && bytes.size() > *limit - result.text.size()) return failure(ErrorCode::TooLarge, Stage::Decode, "decoded text exceeds limit");
    result.text.append(bytes);
    return {};
}

Error Decoder::character(std::string_view bytes)
{
    if (bytes[0] == 0) return failure(ErrorCode::BinaryFile, Stage::Decode, "NUL byte in text file");
    if (cr) {
        cr = false;
        if (auto error = output("\n")) return error;
        if (bytes == "\n") {
            crlfSeen = true;
            return {};
        }
        crSeen = true;
    }
    if (bytes == "\r") {
        cr = true;
        return {};
    }
    if (bytes == "\n") lfSeen = true;
    return output(bytes);
}

Error Decoder::consume(std::string_view bytes)
{
    for (size_t i = 0; i < bytes.size(); ++i) {
        auto byte = static_cast<unsigned char>(bytes[i]);
        if (sequence.empty()) {
            auto size = te::utf8::sequenceLength(byte);
            if (!size) return invalidUtf8();
            if (size == 1) {
                char ch = char(byte);
                if (auto error = character({&ch, 1})) return error;
                continue;
            }
            remaining = unsigned(size - 1);
        } else if ((byte & 0xc0) != 0x80) return invalidUtf8();
        else --remaining;
        sequence += char(byte);
        if (remaining == 0) {
            if (!te::utf8::validSequence(sequence)) return invalidUtf8();
            if (auto error = character(sequence)) return error;
            sequence.clear();
        }
    }
    return {};
}

Error Decoder::headerReady()
{
    started = true;
    std::string_view bytes = header;
    if (bytes.substr(0, 2) == "\xff\xfe" || bytes.substr(0, 2) == "\xfe\xff" || bytes.substr(0, 4) == std::string_view("\0\0\xfe\xff", 4))
        return failure(ErrorCode::UnsupportedEncoding, Stage::Decode, "UTF-16/32 is not supported");
    if (bytes.substr(0, 3) == "\xef\xbb\xbf") {
        result.format.bom = true;
        bytes.remove_prefix(3);
    }
    return consume(bytes);
}

Error Decoder::append(std::string_view bytes)
{
    if (error) return error;
    if (!started) {
        auto count = std::min(size_t(4) - header.size(), bytes.size());
        header.append(bytes.substr(0, count));
        bytes.remove_prefix(count);
        if (header.size() < 4) return {};
        error = headerReady();
    }
    if (!error) error = consume(bytes);
    return error;
}

Result<Text> Decoder::finish()
{
    if (!started && !error) error = headerReady();
    if (!error && !sequence.empty()) error = invalidUtf8();
    if (!error && cr) {
        crSeen = true;
        error = output("\n");
    }
    if (error) return {{}, error};
    auto kinds = unsigned(lfSeen) + unsigned(crSeen) + unsigned(crlfSeen);
    result.format.ending = kinds > 1 ? LineEnding::Mixed : crlfSeen ? LineEnding::Crlf
        : crSeen                                                    ? LineEnding::Cr
                                                                    : LineEnding::Lf;
    return {std::move(result), {}};
}

Error validateOutput(std::string_view text, FileFormat format, std::optional<size_t> limit)
{
    if (format.ending == LineEnding::Mixed) return failure(ErrorCode::MixedLineEndings, Stage::Encode, "select a uniform line ending before saving");
    auto available = limit;
    if (available) {
        size_t prefix = format.bom ? 3 : 0;
        if (prefix > *available || text.size() > *available - prefix) return failure(ErrorCode::TooLarge, Stage::Encode, "encoded text exceeds limit");
        *available -= prefix + text.size();
    }
    for (size_t i = 0; i < text.size();) {
        auto length = te::utf8::sequenceLength(static_cast<unsigned char>(text[i]));
        if (!length || length > text.size() - i || !te::utf8::validSequence(text.substr(i, length))) {
            auto error = invalidUtf8();
            error.stage = Stage::Encode;
            return error;
        }
        if (text[i] == 0) return failure(ErrorCode::BinaryFile, Stage::Encode, "NUL byte in text");
        if (text[i] == '\r') return failure(ErrorCode::InvalidText, Stage::Encode, "save requires LF-normalized text");
        if (text[i] == '\n' && format.ending == LineEnding::Crlf && available) {
            if (!*available) return failure(ErrorCode::TooLarge, Stage::Encode, "encoded text exceeds limit");
            --*available;
        }
        i += length;
    }
    return {};
}

Error encodeChunks(std::string_view text, FileFormat format, const Sink& sink)
{
    if (format.bom)
        if (auto error = sink("\xef\xbb\xbf")) return error;
    std::string output;
    output.reserve(64 * 1024);
    for (char ch : text) {
        if (ch == '\n' && format.ending == LineEnding::Crlf) output += '\r';
        output += ch == '\n' && format.ending == LineEnding::Cr ? '\r' : ch;
        if (output.size() >= 64 * 1024) {
            if (auto error = sink(output)) return error;
            output.clear();
        }
    }
    return output.empty() ? Error{} : sink(output);
}
}  // namespace te::io::detail

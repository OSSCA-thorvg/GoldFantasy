#include "common/files.h"
#include <vector>

using namespace te::io;

namespace
{
Result<Text> decodeText(std::string_view bytes, std::optional<size_t> limit = {})
{
    detail::Decoder decoder(limit);
    if (auto error = decoder.append(bytes)) return {{}, error};
    return decoder.finish();
}
Result<std::string> encodeText(std::string_view text, FileFormat format = {}, std::optional<size_t> limit = {})
{
    if (auto error = detail::validateOutput(text, format, limit)) return {{}, error};
    std::string bytes;
    auto error = detail::encodeChunks(text, format, [&](std::string_view chunk) { bytes.append(chunk); return Error{}; });
    return {std::move(bytes), error};
}
}  // namespace

TEST(io_codec_round_trips_utf8_bom_eol_and_final_newline)
{
    for (bool bom : {false, true})
        for (auto ending : {LineEnding::Lf, LineEnding::Crlf, LineEnding::Cr}) {
            for (const auto& text : {std::string("★♪ é 🙂\nsecond"), std::string("first\nsecond\n")}) {
                auto bytes = encodeText(text, {ending, bom});
                CHECK(bytes);
                auto decoded = decodeText(bytes.value);
                CHECK(decoded);
                CHECK_EQ(decoded.value.text, text);
                CHECK(decoded.value.format.ending == ending);
                CHECK_EQ(decoded.value.format.bom, bom);
                auto again = encodeText(decoded.value.text, decoded.value.format);
                CHECK(again);
                CHECK_EQ(again.value, bytes.value);
            }
        }
    CHECK(decodeText("", 0));
    CHECK_EQ(decodeText("\xef\xbb\xbf").value.text, "");
    CHECK(decodeText("\xef\xbb\xbf").value.format.bom);
    CHECK_EQ(encodeText("", {LineEnding::Lf, true}).value, "\xef\xbb\xbf");
}

TEST(io_decoder_preserves_utf8_crlf_and_bom_across_every_split)
{
    const std::string bytes = "\xef\xbb\xbf★🙂\r\n✓\r\n→";
    for (size_t split = 0; split <= bytes.size(); ++split) {
        detail::Decoder decoder(1024);
        CHECK(!decoder.append(std::string_view(bytes).substr(0, split)));
        CHECK(!decoder.append(std::string_view(bytes).substr(split)));
        auto result = decoder.finish();
        CHECK(result);
        CHECK_EQ(result.value.text, "★🙂\n✓\n→");
        CHECK(result.value.format.bom);
        CHECK(result.value.format.ending == LineEnding::Crlf);
    }
    detail::Decoder decoder(1024);
    for (char byte : bytes)
        CHECK(!decoder.append(std::string_view(&byte, 1)));
    CHECK_EQ(decoder.finish().value.text, "★🙂\n✓\n→");
}

TEST(io_codec_requires_explicit_mixed_eol_conversion)
{
    auto mixed = decodeText("one\r\ntwo\nthree\rfour");
    CHECK(mixed);
    CHECK_EQ(mixed.value.text, "one\ntwo\nthree\nfour");
    CHECK(mixed.value.format.ending == LineEnding::Mixed);
    auto blocked = encodeText(mixed.value.text, mixed.value.format);
    CHECK(!blocked);
    CHECK(blocked.error.code == ErrorCode::MixedLineEndings);
    auto explicitFormat = mixed.value.format;
    explicitFormat.ending = LineEnding::Crlf;
    CHECK_EQ(encodeText(mixed.value.text, explicitFormat).value, "one\r\ntwo\r\nthree\r\nfour");
}

TEST(io_codec_rejects_invalid_utf8_and_incomplete_eof_without_partial_text)
{
    for (const auto& bytes : {std::string("\x80"), std::string("\xc0\x80"), std::string("\xe0\x80\xaf"), std::string("\xed\xa0\x80"), std::string("\xf4\x90\x80\x80"), std::string("\xf5\x80\x80\x80"), std::string("ok\xe2\x82"), std::string("\xf0\x90")}) {
        auto result = decodeText(bytes);
        CHECK(!result);
        CHECK(result.error.code == ErrorCode::InvalidUtf8);
        CHECK(result.value.text.empty());
        CHECK(!encodeText(bytes));
    }
    CHECK(!encodeText("valid\r\ntext"));
}

TEST(io_codec_rejects_unsupported_encodings_nul_and_size_overflow)
{
    for (const auto& bytes : {std::string("\xff\xfeX\0", 4), std::string("\xfe\xff\0X", 4), std::string("\0\0\xfe\xff", 4)}) {
        auto result = decodeText(bytes);
        CHECK(!result);
        CHECK(result.error.code == ErrorCode::UnsupportedEncoding);
    }
    auto binary = decodeText(std::string_view("a\0b", 3));
    CHECK(!binary);
    CHECK(binary.error.code == ErrorCode::BinaryFile);
    CHECK(!encodeText(std::string_view("a\0b", 3)));
    CHECK(!decodeText("four", 3));
    CHECK(!encodeText("", {LineEnding::Lf, true}, 2));
}

TEST(io_sha256_matches_short_and_multiblock_known_vectors)
{
    for (const auto& entry : {
             std::pair<std::string, std::string>{"", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"},
             {"abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"},
             {"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq", "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"},
             {std::string(1000000, 'a'), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"}}) {
        detail::Sha256 hash;
        for (size_t i = 0; i < entry.first.size(); i += 17)
            hash.append(std::string_view(entry.first).substr(i, 17));
        CHECK_EQ(test::hex(hash.finish()), entry.second);
    }
}

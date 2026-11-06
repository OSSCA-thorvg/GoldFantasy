#include <test/test.h>
#include <core/json/json.h>
#include <cmath>
#include <limits>
#include <stdexcept>

namespace
{
using te::json::Value;
bool rejects(std::string_view text, te::json::Limits limits = {})
{
    Value value = "unchanged";
    std::string error;
    bool result = te::json::parse(text, value, error, limits);
    CHECK(!result);
    CHECK(!error.empty());
    CHECK(value == Value("unchanged"));
    return !result;
}
}

TEST(json_round_trips_asset_shaped_documents_and_preserves_types)
{
    Value original = Value::Object{{"version", 1}, {"name", "Thatched cottage ★"}, {"door", true}, {"wall", 18.25},
        {"blocks", Value::Array{Value::Object{{"rect", Value::Array{0, .5, 1, 2}}}, nullptr}}, {"empty", Value::Object{}}};
    for (bool pretty : {true, false}) {
        auto text = te::json::stringify(original, pretty);
        Value decoded;
        std::string error;
        CHECK(te::json::parse(text, decoded, error));
        CHECK(decoded == original);
        CHECK(decoded.find("door")->boolean());
        CHECK(!decoded.find("door")->number());
        CHECK(!decoded.find("version")->boolean());
        CHECK(!decoded.find("missing"));
    }
}

TEST(json_decodes_unicode_pairs_escapes_and_embedded_zero)
{
    Value result;
    std::string error;
    CHECK(te::json::parse(R"("\ud83c\udfe0\u03A9\u266A\n\t\"\\\/\b\f\r\u0000")", result, error));
    std::string expected = "🏠Ω♪\n\t\"\\/\b\f\r";
    expected.push_back('\0');
    CHECK(result == Value(expected));
    Value again;
    CHECK(te::json::parse(te::json::stringify(result), again, error));
    CHECK(again == result);
    for (auto text : {R"("\ud800")", R"("\udfff")", R"("\ud800\u0041")", R"("\u12")", R"("\x20")"}) rejects(text);
}

TEST(json_rejects_malformed_utf8_and_unescaped_controls)
{
    for (auto bad : {std::string("\xc0\xaf"), std::string("\xed\xa0\x80"), std::string("\xf4\x90\x80\x80"), std::string("\xe2\x82"), std::string("\x80"), std::string("\n"), std::string(1, '\0')})
        rejects("\"" + bad + "\"");
}

TEST(json_rejects_duplicate_keys_and_invalid_grammar_transactionally)
{
    for (auto text : {"", " ", "{}[]", "{\"x\":1,\"x\":2}", R"({"x":1,"\u0078":2})", "{x:1}", "[1,]", "{\"x\":1,}", "[1 2]", "{\"x\" 2}", "tru", "truefalse", "/*x*/null", "\"unfinished"}) rejects(text);
}

TEST(json_accepts_finite_numbers_and_rejects_invalid_numeric_forms)
{
    Value value;
    std::string error;
    CHECK(te::json::parse("[-0,1.25,-3e2,4E-2,1.7976931348623157e308]", value, error));
    auto array = value.array();
    CHECK(array && array->size() == 5);
    if (!array || array->size() != 5) return;
    CHECK(std::signbit(*(*array)[0].number()));
    CHECK_EQ(*(*array)[2].number(), -300.0);
    CHECK(std::isfinite(*(*array)[4].number()));
    for (auto text : {"+1", "01", "-01", ".5", "1.", "1e", "1e+", "NaN", "Infinity", "1e9999", "--1", "0x10"}) rejects(text);
}

TEST(json_bounds_input_size_depth_and_value_count)
{
    rejects("[0]", {2, 64, 200000});
    rejects("[[[0]]]", {100, 2, 200000});
    rejects("[1,2,3]", {100, 64, 3});
    Value value;
    std::string error;
    CHECK(te::json::parse("[[0]]", value, error, {100, 2, 3}));
}

TEST(json_writer_rejects_invalid_programmatic_values)
{
    for (const auto& value : {Value(std::numeric_limits<double>::infinity()), Value(std::numeric_limits<double>::quiet_NaN()), Value(std::string("\xc0\xaf"))}) {
        bool rejected = false;
        try { (void)te::json::stringify(value); }
        catch (const std::invalid_argument&) { rejected = true; }
        CHECK(rejected);
    }
}

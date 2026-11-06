#include "json.h"
#include <core/utf8.h>
#include <charconv>
#include <cmath>
#include <stdexcept>

namespace te::json
{
namespace
{
struct Invalid : std::runtime_error { using std::runtime_error::runtime_error; };

void appendUtf8(std::string& text, unsigned code)
{
    if (code < 0x80) text += char(code);
    else if (code < 0x800) { text += char(0xc0 | code >> 6); text += char(0x80 | (code & 63)); }
    else if (code < 0x10000) {
        text += char(0xe0 | code >> 12); text += char(0x80 | ((code >> 6) & 63)); text += char(0x80 | (code & 63));
    } else {
        text += char(0xf0 | code >> 18); text += char(0x80 | ((code >> 12) & 63));
        text += char(0x80 | ((code >> 6) & 63)); text += char(0x80 | (code & 63));
    }
}

class Reader
{
    std::string_view text;
    Limits limits;
    size_t at = 0, count = 0;

    [[noreturn]] void fail(const char* reason) const { throw Invalid(std::string(reason) + " at byte " + std::to_string(at)); }
    char peek() const { return at < text.size() ? text[at] : '\0'; }
    void spaces() { while (peek() == ' ' || peek() == '\t' || peek() == '\r' || peek() == '\n') ++at; }
    bool eat(char ch) { if (peek() != ch) return false; ++at; return true; }
    static bool digit(char ch) { return ch >= '0' && ch <= '9'; }
    unsigned hex4()
    {
        unsigned value = 0;
        for (int i = 0; i < 4; ++i) {
            auto ch = peek();
            unsigned digit = ch >= '0' && ch <= '9' ? unsigned(ch - '0') : ch >= 'a' && ch <= 'f' ? unsigned(ch - 'a' + 10) : ch >= 'A' && ch <= 'F' ? unsigned(ch - 'A' + 10) : 16;
            if (digit == 16) fail("Invalid Unicode escape");
            ++at; value = value * 16 + digit;
        }
        return value;
    }
    std::string readString()
    {
        if (!eat('"')) fail("Expected string");
        std::string result;
        while (at < text.size()) {
            auto byte = static_cast<unsigned char>(text[at++]);
            if (byte == '"') return result;
            if (byte < 32) fail("Unescaped control character");
            if (byte == '\\') {
                if (at == text.size()) fail("Unfinished escape");
                switch (text[at++]) {
                case '"': result += '"'; break;
                case '\\': result += '\\'; break;
                case '/': result += '/'; break;
                case 'b': result += '\b'; break;
                case 'f': result += '\f'; break;
                case 'n': result += '\n'; break;
                case 'r': result += '\r'; break;
                case 't': result += '\t'; break;
                case 'u': {
                    unsigned code = hex4();
                    if (code >= 0xd800 && code <= 0xdbff) {
                        if (!eat('\\') || !eat('u')) fail("Missing low surrogate");
                        unsigned low = hex4();
                        if (low < 0xdc00 || low > 0xdfff) fail("Invalid low surrogate");
                        code = 0x10000 + ((code - 0xd800) << 10) + low - 0xdc00;
                    } else if (code >= 0xdc00 && code <= 0xdfff) fail("Unpaired low surrogate");
                    appendUtf8(result, code);
                    break;
                }
                default: fail("Invalid escape");
                }
            } else if (byte < 128) result += char(byte);
            else {
                size_t size = utf8::sequenceLength(byte);
                auto sequence = text.substr(at - 1, size);
                if (!size || !utf8::validSequence(sequence)) fail("Invalid UTF-8");
                result.append(sequence); at += size - 1;
            }
        }
        fail("Unterminated string");
    }
    Value readNumber()
    {
        size_t begin = at;
        eat('-');
        if (!eat('0')) {
            if (!digit(peek())) fail("Expected number");
            while (digit(peek())) ++at;
        }
        if (eat('.')) {
            if (!digit(peek())) fail("Expected fraction");
            while (digit(peek())) ++at;
        }
        if (eat('e') || eat('E')) {
            if (!eat('+')) eat('-');
            if (!digit(peek())) fail("Expected exponent");
            while (digit(peek())) ++at;
        }
        double value = 0;
        auto converted = std::from_chars(text.data() + begin, text.data() + at, value);
        if (converted.ec != std::errc{} || converted.ptr != text.data() + at || !std::isfinite(value)) fail("Number out of range");
        return value;
    }
    Value read(size_t depth)
    {
        if (depth > limits.maxDepth) fail("JSON nesting limit exceeded");
        if (++count > limits.maxValues) fail("JSON value limit exceeded");
        spaces();
        if (peek() == '"') return readString();
        if (eat('{')) {
            Value::Object object;
            spaces();
            if (eat('}')) return object;
            do {
                spaces(); auto key = readString(); spaces();
                if (!eat(':')) fail("Expected colon");
                auto child = read(depth + 1);
                if (!object.emplace(std::move(key), std::move(child)).second) fail("Duplicate object key");
                spaces();
                if (eat('}')) return object;
            } while (eat(','));
            fail("Expected comma or closing brace");
        }
        if (eat('[')) {
            Value::Array array;
            spaces();
            if (eat(']')) return array;
            do {
                array.push_back(read(depth + 1)); spaces();
                if (eat(']')) return array;
            } while (eat(','));
            fail("Expected comma or closing bracket");
        }
        for (auto literal : {std::string_view("true"), std::string_view("false"), std::string_view("null")})
            if (text.substr(at, literal.size()) == literal) {
                at += literal.size();
                if (literal == "null") return nullptr;
                return literal == "true";
            }
        if (peek() == '-' || digit(peek())) return readNumber();
        fail("Expected JSON value");
    }
public:
    Reader(std::string_view text, Limits limits) : text(text), limits(limits) {}
    Value document()
    {
        if (text.size() > limits.maxBytes) fail("JSON byte limit exceeded");
        auto result = read(0); spaces();
        if (at != text.size()) fail("Trailing data");
        return result;
    }
};

class Writer
{
    std::string out;
    bool pretty;
    size_t count = 0;
    Limits limits;
    void indent(size_t depth) { if (pretty) { out += '\n'; out.append(depth * 2, ' '); } }
    void quoted(std::string_view text)
    {
        constexpr char hex[] = "0123456789abcdef";
        out += '"';
        for (size_t i = 0; i < text.size();) {
            auto ch = static_cast<unsigned char>(text[i]);
            if (ch < 32) { out += "\\u00"; out += hex[ch >> 4]; out += hex[ch & 15]; ++i; }
            else if (ch < 128) { if (ch == '"' || ch == '\\') out += '\\'; out += char(ch); ++i; }
            else {
                size_t size = utf8::sequenceLength(ch);
                auto sequence = text.substr(i, size);
                if (!size || !utf8::validSequence(sequence)) throw std::invalid_argument("Invalid UTF-8 in JSON string");
                out.append(sequence); i += size;
            }
            if (out.size() > limits.maxBytes) throw std::invalid_argument("JSON byte limit exceeded");
        }
        out += '"';
    }
    void write(const Value& value, size_t depth)
    {
        if (depth > limits.maxDepth || ++count > limits.maxValues) throw std::invalid_argument("JSON complexity limit exceeded");
        if (auto boolean = value.boolean()) out += *boolean ? "true" : "false";
        else if (auto number = value.number()) {
            if (!std::isfinite(*number)) throw std::invalid_argument("Nonfinite JSON number");
            char buffer[64];
            auto result = std::to_chars(buffer, buffer + sizeof(buffer), *number);
            if (result.ec != std::errc{}) throw std::invalid_argument("Invalid JSON number");
            out.append(buffer, result.ptr);
        } else if (auto string = value.string()) quoted(*string);
        else if (auto array = value.array()) {
            out += '[';
            for (size_t i = 0; i < array->size(); ++i) {
                if (i) out += ',';
                indent(depth + 1); write((*array)[i], depth + 1);
            }
            if (!array->empty()) indent(depth);
            out += ']';
        } else if (auto object = value.object()) {
            out += '{';
            bool first = true;
            for (const auto& [key, child] : *object) {
                if (!first) out += ',';
                first = false;
                indent(depth + 1); quoted(key); out += pretty ? ": " : ":"; write(child, depth + 1);
            }
            if (!object->empty()) indent(depth);
            out += '}';
        } else out += "null";
        if (out.size() > limits.maxBytes) throw std::invalid_argument("JSON byte limit exceeded");
    }
public:
    explicit Writer(bool pretty) : pretty(pretty) {}
    std::string document(const Value& value) { write(value, 0); if (pretty) out += '\n'; return std::move(out); }
};
}  // namespace

bool parse(std::string_view text, Value& result, std::string& error, Limits limits)
{
    try { auto candidate = Reader(text, limits).document(); result = std::move(candidate); error.clear(); return true; }
    catch (const Invalid& failure) { error = failure.what(); return false; }
}

std::string stringify(const Value& value, bool pretty) { return Writer(pretty).document(value); }
}  // namespace te::json

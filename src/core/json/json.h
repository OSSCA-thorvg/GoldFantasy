#pragma once

#include <concepts>
#include <map>
#include <string>
#include <string_view>
#include <utility>
#include <variant>
#include <vector>

namespace te::json
{
struct Value
{
    using Array = std::vector<Value>;
    using Object = std::map<std::string, Value, std::less<>>;
    using Storage = std::variant<std::nullptr_t, bool, double, std::string, Array, Object>;
    Storage data = nullptr;

    Value() = default;
    Value(std::nullptr_t) {}
    Value(bool value) : data(value) {}
    template<typename T> requires (std::integral<T> || std::floating_point<T>)
    Value(T value) : data(double(value)) {}
    Value(std::string value) : data(std::move(value)) {}
    Value(std::string_view value) : data(std::string(value)) {}
    Value(const char* value) : data(std::string(value)) {}
    Value(Array value) : data(std::move(value)) {}
    Value(Object value) : data(std::move(value)) {}

    const bool* boolean() const { return std::get_if<bool>(&data); }
    const double* number() const { return std::get_if<double>(&data); }
    const std::string* string() const { return std::get_if<std::string>(&data); }
    const Array* array() const { return std::get_if<Array>(&data); }
    const Object* object() const { return std::get_if<Object>(&data); }
    const Value* find(std::string_view key) const
    {
        auto fields = object();
        if (!fields) return nullptr;
        auto found = fields->find(key);
        return found == fields->end() ? nullptr : &found->second;
    }
    bool operator==(const Value&) const = default;
};

struct Limits
{
    size_t maxBytes = 4 * 1024 * 1024;
    size_t maxDepth = 64;
    size_t maxValues = 200000;
};

// Failure leaves the destination unchanged; duplicate keys and nonfinite numbers are invalid.
bool parse(std::string_view, Value&, std::string& error, Limits = {});
// Throws std::invalid_argument for nonfinite numbers, invalid UTF-8 or exceeded default limits.
std::string stringify(const Value&, bool pretty = true);
}  // namespace te::json

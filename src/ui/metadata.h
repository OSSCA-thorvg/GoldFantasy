#pragma once

#include "application.h"

namespace ui::metadata
{
// Portable member metadata for editor inspection. A future C++26 generator can
// produce these same descriptors without changing the runtime editor interface.
template<auto Member, auto... Rest, class T>
decltype(auto) member(T& object)
{
    if constexpr (sizeof...(Rest)) return member<Rest...>(object.*Member);
    else return (object.*Member);
}

template<class T>
struct Field
{
    Property schema;
    double (*get)(const T&);
    void (*set)(T&, double);
    double scale = 1;

    Property describe(const T& object) const
    {
        auto result = schema;
        result.value = get(object) * scale;
        return result;
    }
    bool apply(T& object, double value) const
    {
        if (schema.readOnly || !std::isfinite(value)) return false;
        set(object, std::clamp(value, schema.minimum, schema.maximum) / scale);
        return true;
    }
};

template<class T, auto... Members>
Field<T> field(std::string id, std::string label, double minimum, double maximum, double step, double scale = 1)
{
    return {{std::move(id), std::move(label), 0, minimum, maximum, step},
        [](const T& object) { return double(member<Members...>(object)); },
        [](T& object, double value) {
            using Number = std::remove_cvref_t<decltype(member<Members...>(object))>;
            static_assert(std::is_arithmetic_v<Number>);
            member<Members...>(object) = static_cast<Number>(value);
        }, scale};
}
}  // namespace ui::metadata

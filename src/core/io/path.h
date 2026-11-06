#pragma once

#include <filesystem>
#include <string>
#include <string_view>

namespace te::io
{
inline std::filesystem::path pathFromUtf8(std::string_view text)
{
    return std::filesystem::path(std::u8string(text.begin(), text.end()));
}

inline std::string pathToUtf8(const std::filesystem::path& path)
{
    auto text = path.u8string();
    return {text.begin(), text.end()};
}
}  // namespace te::io

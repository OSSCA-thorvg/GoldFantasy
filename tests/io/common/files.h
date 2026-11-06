#pragma once

#include <test/test.h>
#include <test/directory.h>
#include <core/io/io.h>
#include <core/io/internal.h>
#include <fstream>
#include <iterator>
#include <stdexcept>

namespace te::io::test
{
struct Directory : te::test::Directory
{
    size_t entries() const { return size_t(std::distance(std::filesystem::directory_iterator(path), std::filesystem::directory_iterator{})); }
};

inline void write(const Path& path, std::string_view bytes)
{
    std::ofstream file(path, std::ios::binary | std::ios::trunc);
    file.write(bytes.data(), std::streamsize(bytes.size()));
    file.close();
    if (!file) throw std::runtime_error("cannot write fixture");
}
inline std::string read(const Path& path)
{
    std::ifstream file(path, std::ios::binary);
    if (!file) throw std::runtime_error("cannot read fixture");
    return {std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
}
inline SaveOptions options(const LoadedFile& loaded)
{
    return {loaded.format, loaded.stamp};
}
inline std::string hex(const std::array<uint8_t, 32>& digest)
{
    constexpr char chars[] = "0123456789abcdef";
    std::string result;
    for (auto byte : digest) {
        result += chars[byte >> 4];
        result += chars[byte & 15];
    }
    return result;
}
}  // namespace te::io::test

#pragma once

#include <filesystem>

namespace te::test
{
class Directory
{
public:
    Directory();
    ~Directory();
    Directory(const Directory&) = delete;
    Directory& operator=(const Directory&) = delete;
    std::filesystem::path file(const char* name = "sample.txt") const { return path / name; }
    std::filesystem::path path;
};
}  // namespace te::test

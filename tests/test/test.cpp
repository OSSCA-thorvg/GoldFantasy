#include "test.h"
#include <exception>
#include <filesystem>
#include <string_view>

namespace te::test
{
int failures = 0;
namespace { bool skipped = false; }
std::vector<Case>& cases()
{
    static std::vector<Case> registered;
    return registered;
}
Registrar::Registrar(const char* name, const char* file, void (*run)())
{
    cases().push_back({name, file, run});
}
void fail(const char* file, int line, const char* condition)
{
    std::cerr << file << ':' << line << ": CHECK(" << condition << ") failed\n";
    ++failures;
}
void skip(const char* reason)
{
    skipped = true;
    std::cout << "SKIP " << reason << '\n';
}
int run(int argc, char** argv)
{
    std::string_view suite, filter;
    bool list = false;
    for (int i = 1; i < argc; ++i) {
        std::string_view arg(argv[i]);
        if (arg == "--suite" && i + 1 < argc) suite = argv[++i];
        else if (arg == "--filter" && i + 1 < argc) filter = argv[++i];
        else if (arg == "--list") list = true;
        else if (arg == "--help") {
            std::cout << "usage: Hearthold-tests [--suite text|io|ui|framework|engine|game] [--filter name] [--list]\n";
            return 0;
        } else {
            std::cerr << "Unknown or incomplete option: " << arg << '\n';
            return 2;
        }
    }
    size_t count = 0, failed = 0, skippedCount = 0;
    for (const auto& entry : cases()) {
        auto group = std::filesystem::path(entry.file).parent_path().filename().string();
        if ((!suite.empty() && suite != group) || (!filter.empty() && std::string_view(entry.name).find(filter) == std::string_view::npos)) continue;
        ++count;
        if (list) { std::cout << group << '/' << entry.name << '\n'; continue; }
        auto before = failures;
        skipped = false;
        try { entry.run(); }
        catch (const std::exception& error) { fail(entry.file, 0, error.what()); }
        catch (...) { fail(entry.file, 0, "unknown exception"); }
        bool ok = before == failures;
        failed += !ok;
        skippedCount += ok && skipped;
        std::cout << (!ok ? "FAIL " : skipped ? "SKIP " : "PASS ") << group << '/' << entry.name << '\n';
    }
    if (!count) { std::cerr << "No matching tests\n"; return 2; }
    if (!list) std::cout << count << " tests, " << failed << " failed, " << skippedCount << " skipped\n";
    return failed ? 1 : 0;
}
}  // namespace te::test

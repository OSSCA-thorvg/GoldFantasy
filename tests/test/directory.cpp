#include "directory.h"
#include <random>
#include <stdexcept>

namespace te::test
{
Directory::Directory()
{
    std::random_device random;
    for (unsigned attempt = 0; attempt < 32; ++attempt) {
        auto candidate = std::filesystem::temp_directory_path() / ("hearthold-test-" + std::to_string(random()) + "-" + std::to_string(random()));
        if (std::filesystem::create_directory(candidate)) { path = std::filesystem::canonical(candidate); return; }
    }
    throw std::runtime_error("cannot create test directory");
}
Directory::~Directory()
{
    std::error_code ec;
    std::filesystem::remove_all(path, ec);
}
}  // namespace te::test

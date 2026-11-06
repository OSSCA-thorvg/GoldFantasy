#include <core/io/internal.h>
#include <cerrno>
#include <unistd.h>

namespace te::io::detail
{
Error commitNewFile(StagingFile& staging, const Path& target)
{
    auto source = staging.path.filename(), destination = target.filename();
    auto directory = int(staging.directory.handle);
    // linkat creates only when absent; ordinary rename would overwrite a new arrival.
    if (linkat(directory, source.c_str(), directory, destination.c_str(), 0))
        return failure(errno == EEXIST ? ErrorCode::Conflict : ErrorCode::Io, Stage::Commit, "create-only commit failed", {errno, std::generic_category()});
    staging.committed = true;
    if (unlinkat(directory, source.c_str(), 0))
        return failure(ErrorCode::Io, Stage::Commit, "committed but staging cleanup failed", {errno, std::generic_category()});
    return {};
}
}  // namespace te::io::detail

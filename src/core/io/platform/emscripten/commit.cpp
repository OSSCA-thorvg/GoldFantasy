#include <core/io/internal.h>
#include <emscripten.h>
#include <cerrno>

namespace te::io::detail
{
Error commitNewFile(StagingFile& staging, const Path& target)
{
    // MEMFS has no hard links. One main-thread operation keeps check and rename indivisible.
    auto error = MAIN_THREAD_EM_ASM_INT({
        var source = UTF8ToString($0);
        var target = UTF8ToString($1);
        try {
            FS.lstat(target);
            return $2;
        } catch (error) {
            if (error.errno !== $3) return error.errno || $4;
        }
        try {
            FS.rename(source, target);
            return 0;
        } catch (error) {
            return error.errno || $4;
        }
    }, staging.path.c_str(), target.c_str(), EEXIST, ENOENT, EIO);
    if (error) return failure(error == EEXIST ? ErrorCode::Conflict : ErrorCode::Io, Stage::Commit, "create-only commit failed", {error, std::generic_category()});
    staging.committed = true;
    return {};
}
}  // namespace te::io::detail

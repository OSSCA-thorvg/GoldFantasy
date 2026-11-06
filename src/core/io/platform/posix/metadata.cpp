#include <core/io/internal.h>
#include "metadata.h"

namespace te::io::detail
{
void readMetadata(FileInfo& info, const struct stat& st)
{
    info.modified = st.st_mtim.tv_sec;
    info.modifiedNanos = st.st_mtim.tv_nsec;
    info.changed = st.st_ctim.tv_sec;
    info.changedNanos = st.st_ctim.tv_nsec;
}
Error copyExtendedMetadata(int, int)
{
    return failure(ErrorCode::UnsupportedMetadata, Stage::Metadata, "metadata preservation is unavailable on this platform");
}
}  // namespace te::io::detail

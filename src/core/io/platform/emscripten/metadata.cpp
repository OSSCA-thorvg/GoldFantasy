#include <core/io/internal.h>
#include "../posix/metadata.h"

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
    // The virtual filesystem has mode bits but no native extended attributes.
    return {};
}
}  // namespace te::io::detail

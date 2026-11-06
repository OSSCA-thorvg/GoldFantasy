#include <core/io/internal.h>
#include "../posix/metadata.h"
#include <sys/xattr.h>

namespace te::io::detail
{
void readMetadata(FileInfo& info, const struct stat& st)
{
    info.modified = st.st_mtim.tv_sec;
    info.modifiedNanos = st.st_mtim.tv_nsec;
    info.changed = st.st_ctim.tv_sec;
    info.changedNanos = st.st_ctim.tv_nsec;
}

ssize_t listAttributes(int file, char* names, size_t size)
{
    return flistxattr(file, names, size);
}
ssize_t getAttribute(int file, const char* name, void* value, size_t size)
{
    return fgetxattr(file, name, value, size);
}
int removeAttribute(int file, const char* name)
{
    return fremovexattr(file, name);
}
int setAttribute(int file, const char* name, const void* value, size_t size)
{
    return fsetxattr(file, name, value, size, 0);
}

Error copyExtendedMetadata(int source, int output)
{
    return copyAttributes(source, output);
}
}  // namespace te::io::detail

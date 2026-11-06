#pragma once

#include <core/io/platform/file.h>
#include <sys/stat.h>
#include <sys/types.h>

namespace te::io::detail
{
void readMetadata(FileInfo&, const struct stat&);
Error copyExtendedMetadata(int source, int output);
Error copyAttributes(int source, int output);
ssize_t listAttributes(int file, char* names, size_t size);
ssize_t getAttribute(int file, const char* name, void* value, size_t size);
int removeAttribute(int file, const char* name);
int setAttribute(int file, const char* name, const void* value, size_t size);
}  // namespace te::io::detail

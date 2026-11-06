#include <core/io/internal.h>
#include "metadata.h"
#include <cerrno>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

namespace te::io::detail
{
namespace
{
Error systemError(Stage stage, const char* message, ErrorCode code = ErrorCode::Io)
{
    return failure(code, stage, message, {errno, std::generic_category()});
}
int fd(const NativeFile& file)
{
    return int(file.handle);
}
}  // namespace

Error closeHandle(intptr_t handle)
{
    // Do not retry close(EINTR): the descriptor may already have been released.
    return ::close(int(handle)) ? systemError(Stage::Close, "file close failed") : Error{};
}
void discardHandle(intptr_t handle) noexcept
{
    ::close(int(handle));
}

Result<NativeFile> openFile(const Path& path, bool writable)
{
    int handle;
    do {
        handle = ::open(path.c_str(), (writable ? O_WRONLY : O_RDONLY) | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK);
    } while (handle < 0 && errno == EINTR);
    if (handle < 0) return {{}, systemError(Stage::Open, "cannot open file", errno == ENOENT ? ErrorCode::NotFound : writable && (errno == EACCES || errno == EPERM) ? ErrorCode::ReadOnly
                                                                                                                                                                     : ErrorCode::Io)};
    return {NativeFile(handle), {}};
}

Result<FileInfo> fileInfo(const NativeFile& file)
{
    struct stat st;
    if (fstat(fd(file), &st)) return {{}, systemError(Stage::Read, "cannot inspect file")};
    if (!S_ISREG(st.st_mode)) return {{}, failure(ErrorCode::NotRegularFile, Stage::Open, "only regular files are supported")};
    FileInfo info;
    info.device = uint64_t(st.st_dev);
    info.id = uint64_t(st.st_ino);
    info.size = uint64_t(st.st_size);
    info.links = uint64_t(st.st_nlink);
    info.owner = st.st_uid;
    info.group = st.st_gid;
    info.mode = st.st_mode;
    readMetadata(info, st);
    return {info, {}};
}

Result<size_t> readBytes(const NativeFile& file, char* buffer, size_t size)
{
    ssize_t count;
    do {
        count = ::read(fd(file), buffer, size);
    } while (count < 0 && errno == EINTR);
    if (count < 0) return {0, systemError(Stage::Read, "file read failed")};
    return {size_t(count), {}};
}

Result<size_t> writeBytes(const NativeFile& file, std::string_view bytes)
{
    ssize_t count;
    do {
        count = ::write(fd(file), bytes.data(), bytes.size());
    } while (count < 0 && errno == EINTR);
    if (count < 0) return {0, systemError(Stage::Write, "file write failed")};
    return {size_t(count), {}};
}

StagingFile::~StagingFile()
{
    if (!committed && !path.empty() && directory.handle != -1) {
        const auto& native = path.native();
        auto name = native.c_str() + (native.find_last_of('/') + 1);
        unlinkat(fd(directory), name, 0);
    }
}

Error createStaging(StagingFile& staging, const Path& target, bool)
{
    auto directory = ::open(target.parent_path().c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (directory < 0) return systemError(Stage::Create, "cannot open destination directory");
    staging.directory = NativeFile(directory);
    for (unsigned attempt = 0; attempt < 32; ++attempt) {
        auto candidate = target.parent_path() / randomName();
        auto handle = openat(directory, candidate.filename().c_str(), O_RDWR | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
        if (handle >= 0) {
            staging.path = std::move(candidate);
            staging.file = NativeFile(handle);
            return {};
        }
        if (errno != EEXIST) return systemError(Stage::Create, "cannot create sibling staging file");
    }
    return failure(ErrorCode::Io, Stage::Create, "cannot allocate a unique staging file");
}

Error writable(const Path& target, const FileInfo& info)
{
    if (!(info.mode & 0222)) return failure(ErrorCode::ReadOnly, Stage::Verify, "file has no write permission");
    if (info.links != 1) return failure(ErrorCode::UnsupportedMetadata, Stage::Metadata, "hard-linked files require in-place saving");
    if (info.owner != uint64_t(geteuid()) || info.flags != 0)
        return failure(ErrorCode::UnsupportedMetadata, Stage::Metadata, "file ownership or flags cannot be preserved");
    auto handle = openFile(target, true);  // Permission check without truncating or writing.
    if (!handle) return handle.error;
    auto current = fileInfo(handle.value);
    if (!current || !(current.value == info)) return failure(ErrorCode::Conflict, Stage::Verify, "file changed during permission check");
    return {};
}

Error copyMetadata(const NativeFile& source, const NativeFile& output, const FileInfo& info)
{
    struct stat current;
    if (fstat(fd(output), &current)) return systemError(Stage::Metadata, "cannot inspect staging file");
    if ((uint64_t(current.st_uid) != info.owner || uint64_t(current.st_gid) != info.group) && fchown(fd(output), uid_t(info.owner), gid_t(info.group)))
        return systemError(Stage::Metadata, "cannot preserve owner/group", ErrorCode::UnsupportedMetadata);
    if (fchmod(fd(output), mode_t(info.mode & 07777)))
        return systemError(Stage::Metadata, "cannot preserve file mode", ErrorCode::UnsupportedMetadata);
    if (auto error = copyExtendedMetadata(fd(source), fd(output))) return error;
    auto saved = fileInfo(output);
    if (!saved) return saved.error;
    if (saved.value.mode != info.mode || saved.value.owner != info.owner || saved.value.group != info.group)
        return failure(ErrorCode::UnsupportedMetadata, Stage::Metadata, "staging metadata does not match original");
    return {};
}

Error syncFile(const NativeFile& file)
{
    int result;
    do {
        result = fsync(fd(file));
    } while (result && errno == EINTR);
    return result ? systemError(Stage::FileSync, "file sync failed") : Error{};
}

Error commit(StagingFile& staging, const Path& target, bool existing)
{
    struct stat opened, named;
    if (fstat(fd(staging.directory), &opened) || stat(target.parent_path().c_str(), &named))
        return systemError(Stage::Verify, "cannot inspect destination directory");
    if (opened.st_dev != named.st_dev || opened.st_ino != named.st_ino)
        return failure(ErrorCode::Conflict, Stage::Verify, "destination directory changed");
    auto source = staging.path.filename(), destination = target.filename();
    if (existing) {
        if (renameat(fd(staging.directory), source.c_str(), fd(staging.directory), destination.c_str()))
            return systemError(Stage::Commit, "atomic replacement failed");
        staging.committed = true;
    } else return commitNewFile(staging, target);
    return {};
}

Error syncDirectory(const StagingFile& staging)
{
    auto error = syncFile(staging.directory);
    if (error) error.stage = Stage::DirectorySync;
    return error;
}
}  // namespace te::io::detail

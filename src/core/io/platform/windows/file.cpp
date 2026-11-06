#define NOMINMAX
#include <core/io/internal.h>
#include <windows.h>
#include <algorithm>
#include <vector>

namespace te::io::detail
{
namespace
{
HANDLE handle(const NativeFile& file)
{
    return reinterpret_cast<HANDLE>(file.handle);
}
constexpr DWORD sharing = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;
Error systemError(Stage stage, const char* message, ErrorCode code = ErrorCode::Io)
{
    return failure(code, stage, message, {int(GetLastError()), std::system_category()});
}
int64_t ticks(FILETIME time)
{
    return int64_t(uint64_t(time.dwHighDateTime) << 32 | time.dwLowDateTime);
}
Result<std::vector<char>> security(const NativeFile& file)
{
    constexpr auto fields = OWNER_SECURITY_INFORMATION | GROUP_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION;
    DWORD size = 0;
    GetKernelObjectSecurity(handle(file), fields, nullptr, 0, &size);
    if (!size) return {{}, systemError(Stage::Metadata, "cannot inspect file security", ErrorCode::UnsupportedMetadata)};
    std::vector<char> bytes(size, 0);
    if (!GetKernelObjectSecurity(handle(file), fields, reinterpret_cast<PSECURITY_DESCRIPTOR>(bytes.data()), size, &size))
        return {{}, systemError(Stage::Metadata, "cannot read file security", ErrorCode::UnsupportedMetadata)};
    bytes.resize(size);
    return {std::move(bytes), {}};
}
NativeFile openDirectory(const Path& path)
{
    auto value = CreateFileW(path.c_str(), FILE_READ_ATTRIBUTES, sharing, nullptr, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, nullptr);
    return NativeFile(reinterpret_cast<intptr_t>(value));
}
}  // namespace

Error closeHandle(intptr_t value)
{
    return CloseHandle(reinterpret_cast<HANDLE>(value)) ? Error{} : systemError(Stage::Close, "file close failed");
}
void discardHandle(intptr_t value) noexcept
{
    CloseHandle(reinterpret_cast<HANDLE>(value));
}

Result<NativeFile> openFile(const Path& path, bool writable)
{
    auto value = CreateFileW(path.c_str(), writable ? GENERIC_WRITE : GENERIC_READ, sharing, nullptr, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS, nullptr);
    if (value == INVALID_HANDLE_VALUE) {
        auto error = GetLastError();
        return {{}, systemError(Stage::Open, "cannot open file", error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND ? ErrorCode::NotFound : writable && error == ERROR_ACCESS_DENIED ? ErrorCode::ReadOnly
                                                                                                                                                                                                 : ErrorCode::Io)};
    }
    return {NativeFile(reinterpret_cast<intptr_t>(value)), {}};
}

Result<FileInfo> fileInfo(const NativeFile& file)
{
    BY_HANDLE_FILE_INFORMATION native{};
    FILE_BASIC_INFO basic{};
    if (!GetFileInformationByHandle(handle(file), &native) || !GetFileInformationByHandleEx(handle(file), FileBasicInfo, &basic, sizeof(basic)))
        return {{}, systemError(Stage::Read, "cannot inspect file")};
    if (GetFileType(handle(file)) != FILE_TYPE_DISK || (native.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)))
        return {{}, failure(ErrorCode::NotRegularFile, Stage::Open, "only regular files are supported")};
    FileInfo info;
    info.device = native.dwVolumeSerialNumber;
    info.id = uint64_t(native.nFileIndexHigh) << 32 | native.nFileIndexLow;
    info.size = uint64_t(native.nFileSizeHigh) << 32 | native.nFileSizeLow;
    info.links = native.nNumberOfLinks;
    info.flags = native.dwFileAttributes;
    info.modified = ticks(native.ftLastWriteTime);
    info.changed = basic.ChangeTime.QuadPart;
    return {info, {}};
}

Result<size_t> readBytes(const NativeFile& file, char* buffer, size_t size)
{
    DWORD count = 0;
    if (!ReadFile(handle(file), buffer, DWORD(std::min(size, size_t(MAXDWORD))), &count, nullptr))
        return {0, systemError(Stage::Read, "file read failed")};
    return {size_t(count), {}};
}
Result<size_t> writeBytes(const NativeFile& file, std::string_view bytes)
{
    DWORD count = 0;
    if (!WriteFile(handle(file), bytes.data(), DWORD(std::min(bytes.size(), size_t(MAXDWORD))), &count, nullptr))
        return {0, systemError(Stage::Write, "file write failed")};
    return {size_t(count), {}};
}

StagingFile::~StagingFile()
{
    if (file.handle != -1) discardHandle(std::exchange(file.handle, -1));
    if (!committed && !path.empty()) DeleteFileW(path.c_str());
}
Error createStaging(StagingFile& staging, const Path& target, bool existing)
{
    staging.directory = openDirectory(target.parent_path());
    if (staging.directory.handle == -1) return systemError(Stage::Create, "cannot open destination directory");
    for (unsigned attempt = 0; attempt < 32; ++attempt) {
        auto candidate = target.parent_path() / randomName();
        HANDLE value;
        if (existing) {
            // Clone metadata/streams first; only the staging file's main stream is truncated.
            if (!CopyFileW(target.c_str(), candidate.c_str(), TRUE)) {
                auto code = GetLastError();
                if (code == ERROR_FILE_EXISTS || code == ERROR_ALREADY_EXISTS) continue;
                DeleteFileW(candidate.c_str());
                SetLastError(code);
                return systemError(Stage::Create, "cannot clone file metadata");
            }
            staging.path = candidate;
            value = CreateFileW(candidate.c_str(), GENERIC_READ | GENERIC_WRITE, sharing, nullptr, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
        } else {
            value = CreateFileW(candidate.c_str(), GENERIC_READ | GENERIC_WRITE, sharing, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
        }
        if (value == INVALID_HANDLE_VALUE) {
            auto code = GetLastError();
            if (!existing && (code == ERROR_FILE_EXISTS || code == ERROR_ALREADY_EXISTS)) continue;
            return systemError(Stage::Create, "cannot open staging file");
        }
        staging.path = std::move(candidate);
        staging.file = NativeFile(reinterpret_cast<intptr_t>(value));
        if (existing && !SetEndOfFile(value)) return systemError(Stage::Create, "cannot truncate staging file");
        return {};
    }
    return failure(ErrorCode::Io, Stage::Create, "cannot allocate a unique staging file");
}

Error writable(const Path& target, const FileInfo& info)
{
    if (info.flags & FILE_ATTRIBUTE_READONLY) return failure(ErrorCode::ReadOnly, Stage::Verify, "read-only file");
    if (info.links != 1) return failure(ErrorCode::UnsupportedMetadata, Stage::Metadata, "hard-linked files require in-place saving");
    constexpr uint64_t supported = FILE_ATTRIBUTE_ARCHIVE | FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM | FILE_ATTRIBUTE_NORMAL | FILE_ATTRIBUTE_NOT_CONTENT_INDEXED | FILE_ATTRIBUTE_TEMPORARY;
    if (info.flags & ~supported) return failure(ErrorCode::UnsupportedMetadata, Stage::Metadata, "file attributes cannot be preserved");
    auto file = openFile(target, true);
    if (!file) return file.error;
    auto current = fileInfo(file.value);
    if (!current || !(info == current.value)) return failure(ErrorCode::Conflict, Stage::Verify, "file changed during permission check");
    return {};
}

Error copyMetadata(const NativeFile& source, const NativeFile& output, const FileInfo& info)
{
    auto before = security(source), after = security(output);
    if (!before) return before.error;
    if (!after) return after.error;
    if (before.value != after.value) return failure(ErrorCode::UnsupportedMetadata, Stage::Metadata, "owner/group/ACL could not be preserved");
    BY_HANDLE_FILE_INFORMATION original{};
    if (!GetFileInformationByHandle(handle(source), &original)) return systemError(Stage::Metadata, "cannot inspect original metadata");
    FILE_BASIC_INFO basic{};
    basic.CreationTime.QuadPart = ticks(original.ftCreationTime);
    basic.FileAttributes = DWORD(info.flags);
    if (!SetFileInformationByHandle(handle(output), FileBasicInfo, &basic, sizeof(basic)))
        return systemError(Stage::Metadata, "cannot preserve file attributes", ErrorCode::UnsupportedMetadata);
    return {};
}

Error syncFile(const NativeFile& file)
{
    return FlushFileBuffers(handle(file)) ? Error{} : systemError(Stage::FileSync, "file flush failed");
}
Error commit(StagingFile& staging, const Path& target, bool existing)
{
    auto namedDirectory = openDirectory(target.parent_path());
    BY_HANDLE_FILE_INFORMATION opened{}, named{};
    if (!GetFileInformationByHandle(handle(staging.directory), &opened) || !GetFileInformationByHandle(handle(namedDirectory), &named))
        return systemError(Stage::Verify, "cannot inspect destination directory");
    if (opened.dwVolumeSerialNumber != named.dwVolumeSerialNumber || opened.nFileIndexHigh != named.nFileIndexHigh || opened.nFileIndexLow != named.nFileIndexLow)
        return failure(ErrorCode::Conflict, Stage::Verify, "destination directory changed");
    if (!MoveFileExW(staging.path.c_str(), target.c_str(), MOVEFILE_WRITE_THROUGH | (existing ? MOVEFILE_REPLACE_EXISTING : 0))) {
        auto code = GetLastError();
        return systemError(Stage::Commit, "file move failed", code == ERROR_FILE_EXISTS || code == ERROR_ALREADY_EXISTS ? ErrorCode::Conflict : ErrorCode::Io);
    }
    staging.committed = true;
    return {};
}
Error syncDirectory(const StagingFile&)
{
    // Windows exposes file flushing here, not POSIX directory-fsync semantics.
    return {};
}
}  // namespace te::io::detail

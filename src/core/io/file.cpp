#include "internal.h"
#include <algorithm>
#include <random>
#include <tuple>
#include <vector>

namespace te::io::detail
{
Error failure(ErrorCode code, Stage stage, std::string message, std::error_code system)
{
    return {code, stage, system, std::move(message)};
}

bool FileInfo::sameFile(const FileInfo& other) const
{
    return device == other.device && id == other.id;
}
bool FileInfo::operator==(const FileInfo& b) const
{
    return std::tie(device, id, size, links, owner, group, mode, flags, modified, modifiedNanos, changed, changedNanos)
        == std::tie(b.device, b.id, b.size, b.links, b.owner, b.group, b.mode, b.flags, b.modified, b.modifiedNanos, b.changed, b.changedNanos);
}
DiskStamp Access::stamp(StampData data)
{
    DiskStamp result;
    result.data = std::make_shared<const StampData>(std::move(data));
    return result;
}

Error inject(const Hooks* hooks, Stage stage)
{
    if (hooks && hooks->before)
        if (auto error = hooks->before(stage)) return failure(ErrorCode::Io, stage, "injected I/O failure", error);
    return {};
}

NativeFile& NativeFile::operator=(NativeFile&& other) noexcept
{
    if (this != &other) {
        if (handle != -1) discardHandle(handle);
        handle = std::exchange(other.handle, -1);
    }
    return *this;
}
Error NativeFile::close()
{
    return handle == -1 ? Error{} : closeHandle(std::exchange(handle, -1));
}

std::string randomName()
{
    std::random_device random;
    constexpr char hex[] = "0123456789abcdef";
    std::string result = ".engine-";
    for (unsigned i = 0; i < 4; ++i) {
        auto value = random();
        for (unsigned shift = 0; shift < 32; shift += 4)
            result += hex[(value >> shift) & 15];
    }
    return result;
}

Result<Path> resolve(const Path& path, bool allowMissing)
{
    if (path.empty() || path.native().find(Path::value_type(0)) != Path::string_type::npos)
        return {{}, failure(ErrorCode::InvalidPath, Stage::Open, "empty path or embedded NUL")};
    std::error_code ec;
    auto absolute = std::filesystem::absolute(path, ec);
    if (ec) return {{}, failure(ErrorCode::InvalidPath, Stage::Open, "cannot make path absolute", ec)};
    auto target = std::filesystem::canonical(absolute, ec);
    if (!ec) return {std::move(target), {}};
    if (ec != std::errc::no_such_file_or_directory || !allowMissing)
        return {{}, failure(ec == std::errc::no_such_file_or_directory ? ErrorCode::NotFound : ErrorCode::Io, Stage::Open, "cannot resolve file", ec)};
    // A dangling symlink is not a request to replace the link with a new file.
    std::error_code linkError;
    if (std::filesystem::is_symlink(std::filesystem::symlink_status(absolute, linkError)))
        return {{}, failure(ErrorCode::NotFound, Stage::Open, "dangling symbolic link")};
    auto parent = std::filesystem::canonical(absolute.parent_path(), ec);
    if (ec) return {{}, failure(ErrorCode::NotFound, Stage::Open, "parent directory is unavailable", ec)};
    return {parent / absolute.filename(), {}};
}

Result<LoadedFile> loadImpl(const Path& path, LoadOptions options, bool decodeText)
{
    auto target = resolve(path, options.createIfMissing);
    if (!target) return {{}, target.error};
    LoadedFile loaded;
    auto input = openFile(target.value);
    if (!input) {
        if (input.error.code != ErrorCode::NotFound || !options.createIfMissing) return {{}, input.error};
        loaded.stamp = Access::stamp({target.value, {}, {}, false});
        return {std::move(loaded), {}};
    }
    auto before = fileInfo(input.value);
    if (!before) return {{}, before.error};
    if (options.maxBytes && before.value.size > *options.maxBytes) return {{}, failure(ErrorCode::TooLarge, Stage::Read, "file exceeds limit")};
    Sha256 hash;
    Decoder decoder(options.maxBytes);
    std::vector<char> buffer(1024 * 1024);
    uint64_t total = 0;
    for (;;) {
        auto count = readBytes(input.value, buffer.data(), buffer.size());
        if (!count) return {{}, count.error};
        if (!count.value) break;
        if (options.maxBytes && count.value > *options.maxBytes - total) return {{}, failure(ErrorCode::TooLarge, Stage::Read, "file grew beyond limit")};
        if (count.value > before.value.size - total) return {{}, failure(ErrorCode::Conflict, Stage::Read, "file grew while reading")};
        total += count.value;
        std::string_view bytes(buffer.data(), count.value);
        hash.append(bytes);
        if (decodeText)
            if (auto error = decoder.append(bytes)) return {{}, error};
    }
    auto after = fileInfo(input.value);
    if (!after) return {{}, after.error};
    if (!(before.value == after.value) || total != before.value.size)
        return {{}, failure(ErrorCode::Conflict, Stage::Read, "file changed while reading")};
    auto currentTarget = resolve(path, false);
    if (!currentTarget) return {{}, failure(ErrorCode::Conflict, Stage::Read, "file disappeared while reading", currentTarget.error.system)};
    auto current = openFile(currentTarget.value);
    if (!current) return {{}, failure(ErrorCode::Conflict, Stage::Read, "file changed while reading", current.error.system)};
    auto currentInfo = fileInfo(current.value);
    if (!currentInfo || !(currentInfo.value == before.value)) return {{}, failure(ErrorCode::Conflict, Stage::Read, "file replaced while reading")};
    if (auto error = input.value.close()) return {{}, error};
    if (decodeText) {
        auto text = decoder.finish();
        if (!text) return {{}, text.error};
        static_cast<Text&>(loaded) = std::move(text.value);
    }
    loaded.stamp = Access::stamp({target.value, before.value, hash.finish(), true});
    return {std::move(loaded), {}};
}

Error checkImpl(const Path& path, const DiskStamp& expected, std::optional<size_t> limit)
{
    auto current = loadImpl(path, {true, limit}, false);
    if (!current) {
        if (expected.exists() && current.error.code == ErrorCode::NotFound)
            return failure(ErrorCode::Conflict, Stage::Verify, "original file disappeared", current.error.system);
        return current.error;
    }
    auto a = Access::get(expected), b = Access::get(current.value.stamp);
    // OS services may update metadata after a save without changing the file's bytes.
    if (expected.exists() != current.value.stamp.exists()
        || (a && !a->exists && a->target != b->target)
        || (a && a->exists && (!a->info.sameFile(b->info) || a->digest != b->digest)))
        return failure(ErrorCode::Conflict, Stage::Verify, "file differs from the supplied baseline");
    return {};
}

static SaveResult saveOperation(const Path& path, std::string_view text, SaveOptions options, const Hooks* hooks, SaveResult& result, StagingFile& staging)
{
    auto fail = [&](Error error) {
        result.error = std::move(error);
        return result;
    };
    if (auto error = validateOutput(text, options.format, options.maxBytes)) return fail(error);
    auto target = resolve(path, true);
    if (!target) return fail(target.error);
    auto baseline = Access::get(options.expected);
    auto readLimit = options.maxBytes;
    if (readLimit && baseline && baseline->info.size > *readLimit) readLimit = size_t(baseline->info.size);
    if (auto error = checkImpl(path, options.expected, readLimit)) return fail(error);
    NativeFile original;
    FileInfo originalInfo;
    if (options.expected.exists()) {
        auto input = openFile(target.value);
        if (!input) return fail(input.error);
        original = std::move(input.value);
        auto info = fileInfo(original);
        if (!info) return fail(info.error);
        if (auto error = writable(target.value, info.value)) return fail(error);
        originalInfo = info.value;
    }
    if (auto error = inject(hooks, Stage::Create)) return fail(error);
    if (auto error = createStaging(staging, target.value, options.expected.exists())) return fail(error);
    Sha256 hash;
    auto error = encodeChunks(text, options.format, [&](std::string_view bytes) {
        while (!bytes.empty()) {
            if (auto error = inject(hooks, Stage::Write)) return error;
            auto length = std::min(bytes.size(), hooks ? hooks->maxWrite : bytes.size());
            if (!length) return failure(ErrorCode::Io, Stage::Write, "zero write limit");
            auto written = writeBytes(staging.file, bytes.substr(0, length));
            if (!written) return written.error;
            if (!written.value) return failure(ErrorCode::Io, Stage::Write, "zero length write");
            hash.append(bytes.substr(0, written.value));
            bytes.remove_prefix(written.value);
        }
        return Error{};
    });
    if (error) return fail(error);
    if (auto error = inject(hooks, Stage::Metadata)) return fail(error);
    if (options.expected.exists())
        if (auto error = copyMetadata(original, staging.file, originalInfo)) return fail(error);
    if (auto error = inject(hooks, Stage::FileSync)) return fail(error);
    if (auto error = syncFile(staging.file)) return fail(error);
    if (auto error = inject(hooks, Stage::Close)) return fail(error);
    if (auto error = staging.file.close()) return fail(error);
    if (auto error = inject(hooks, Stage::Verify)) return fail(error);
    if (auto error = checkImpl(path, options.expected, readLimit)) return fail(error);
    if (options.expected.exists()) {
        auto info = fileInfo(original);
        if (!info) return fail(info.error);
        if (!(info.value == originalInfo))
            return fail(failure(ErrorCode::Conflict, Stage::Verify, "file metadata changed while saving"));
    }
    // A symlink or parent path may have been redirected while staging was written.
    auto commitTarget = resolve(path, true);
    if (!commitTarget || commitTarget.value != target.value)
        return fail(failure(ErrorCode::Conflict, Stage::Verify, "save target changed"));
    if (auto error = inject(hooks, Stage::Commit)) return fail(error);
    error = commit(staging, target.value, options.expected.exists());
    if (error && !staging.committed) return fail(error);
    result.state = SaveState::CommittedDurabilityUnknown;
    auto syncError = inject(hooks, Stage::DirectorySync);
    if (!syncError) syncError = syncDirectory(staging);
    auto saved = loadImpl(path, {false, options.maxBytes}, false);
    if (!saved || saved.value.stamp.digest() != hash.finish())
        return fail(failure(ErrorCode::Conflict, Stage::Verify, "file changed after commit", saved.error.system));
    result.stamp = saved.value.stamp;
    if (error) return fail(error);
    if (syncError) return fail(syncError);
    result.state = SaveState::Committed;
    return result;
}

SaveResult saveImpl(const Path& path, std::string_view text, SaveOptions options, const Hooks* hooks)
{
    SaveResult result;
    StagingFile staging;
    try {
        return saveOperation(path, text, options, hooks, result, staging);
    } catch (const std::bad_alloc&) {
        result.error = failure(ErrorCode::TooLarge, Stage::None, "out of memory");
    } catch (const std::exception& exception) {
        result.error = failure(ErrorCode::Io, Stage::None, exception.what());
    }
    if (staging.committed) result.state = SaveState::CommittedDurabilityUnknown;
    return result;
}
}  // namespace te::io::detail

namespace te::io
{
bool DiskStamp::exists() const
{
    return data && data->exists;
}
std::array<uint8_t, 32> DiskStamp::digest() const
{
    return data ? data->digest : std::array<uint8_t, 32>{};
}

Result<LoadedFile> load(const Path& path, LoadOptions options)
{
    return detail::loadImpl(path, options, true);
}
Error check(const Path& path, const DiskStamp& expected, std::optional<size_t> maxBytes)
{
    return detail::checkImpl(path, expected, maxBytes);
}
SaveResult save(const Path& path, std::string_view text, SaveOptions options)
{
    return detail::saveImpl(path, text, options);
}
}  // namespace te::io

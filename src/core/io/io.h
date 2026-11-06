#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <system_error>

namespace te::io
{

using Path = std::filesystem::path;

enum class LineEnding
{
    Lf,
    Crlf,
    Cr,
    Mixed
};
struct FileFormat
{
    LineEnding ending = LineEnding::Lf;
    bool bom = false;
};

enum class ErrorCode
{
    None,
    InvalidPath,
    NotFound,
    NotRegularFile,
    ReadOnly,
    InvalidUtf8,
    InvalidText,
    UnsupportedEncoding,
    BinaryFile,
    TooLarge,
    MixedLineEndings,
    Conflict,
    UnsupportedMetadata,
    Io
};
enum class Stage
{
    None,
    Open,
    Read,
    Decode,
    Encode,
    Create,
    Write,
    Metadata,
    FileSync,
    Close,
    Verify,
    Commit,
    DirectorySync
};

struct Error
{
    ErrorCode code = ErrorCode::None;
    Stage stage = Stage::None;
    std::error_code system;
    std::string message;
    explicit operator bool() const { return code != ErrorCode::None; }
};

template<typename T>
struct Result
{
    T value{};
    Error error;
    explicit operator bool() const { return !error; }
};

namespace detail
{
struct StampData;
struct Access;
}  // namespace detail

// A baseline obtained from load(), bound to the resolved target and raw bytes.
// The default stamp requires that the destination does NOT exist (create-only save).
class DiskStamp
{
public:
    bool exists() const;
    std::array<uint8_t, 32> digest() const;

private:
    std::shared_ptr<const detail::StampData> data;
    friend struct detail::Access;
};

struct Text
{
    std::string text;  // Valid UTF-8, LF; no file BOM. Final newline is preserved.
    FileFormat format;
};
struct LoadedFile : Text
{
    DiskStamp stamp;
};
struct LoadOptions
{
    bool createIfMissing = false;
    std::optional<size_t> maxBytes = {};  // No limit unless explicitly requested.
};
struct SaveOptions
{
    FileFormat format;
    DiskStamp expected;
    std::optional<size_t> maxBytes = {};
};

enum class SaveState
{
    NotWritten,
    Committed,
    CommittedDurabilityUnknown
};
struct SaveResult
{
    SaveState state = SaveState::NotWritten;
    DiskStamp stamp;
    Error error;
    explicit operator bool() const { return state == SaveState::Committed && !error; }
};

// Synchronous UTF-8 file operations with conflict detection and atomic replacement.
// Load rejects malformed UTF-8, UTF-16/32 BOMs and NUL bytes. Mixed EOL is
// reported on load; save requires the caller to select a uniform EOL.
Result<LoadedFile> load(const Path& path, LoadOptions options = {});
Error check(const Path& path, const DiskStamp& expected, std::optional<size_t> maxBytes = {});
SaveResult save(const Path& path, std::string_view lfText, SaveOptions options = {});

}  // namespace te::io

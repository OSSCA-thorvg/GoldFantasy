#pragma once

#include <core/io/io.h>
#include "platform/file.h"
#include <limits>
#include <functional>
#include <utility>

namespace te::io::detail
{

using Digest = std::array<uint8_t, 32>;
class Sha256
{
public:
    void append(std::string_view bytes);
    Digest finish();

private:
    void block();
    uint32_t state[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
    uint8_t buffer[64]{};
    size_t used = 0;
    uint64_t length = 0;
};

Error failure(ErrorCode code, Stage stage, std::string message, std::error_code system = {});

class Decoder
{
public:
    explicit Decoder(std::optional<size_t> limit = {}) : limit(limit) {}
    Error append(std::string_view bytes);
    Result<Text> finish();

private:
    Error consume(std::string_view bytes);
    Error character(std::string_view bytes);
    Error output(std::string_view bytes);
    Error headerReady();
    Text result;
    std::string header;
    std::string sequence;
    std::optional<size_t> limit;
    unsigned remaining = 0;
    bool started = false, cr = false;
    bool lfSeen = false, crSeen = false, crlfSeen = false;
    Error error;
};
Error validateOutput(std::string_view text, FileFormat format, std::optional<size_t> limit);
using Sink = std::function<Error(std::string_view)>;
Error encodeChunks(std::string_view text, FileFormat format, const Sink& sink);

struct StampData
{
    Path target;
    FileInfo info;
    Digest digest{};
    bool exists = false;
};
struct Access
{
    static const StampData* get(const DiskStamp& stamp) { return stamp.data.get(); }
    static DiskStamp stamp(StampData data);
};

// Test-only operation boundary injection. Production callers do not receive this API.
struct Hooks
{
    std::function<std::error_code(Stage)> before;
    size_t maxWrite = std::numeric_limits<size_t>::max();
};
Error inject(const Hooks* hooks, Stage stage);

Result<Path> resolve(const Path& path, bool allowMissing);
std::string randomName();

Result<LoadedFile> loadImpl(const Path& path, LoadOptions options, bool decodeText);
Error checkImpl(const Path& path, const DiskStamp& expected, std::optional<size_t> limit);
SaveResult saveImpl(const Path& path, std::string_view text, SaveOptions options, const Hooks* hooks = nullptr);

}  // namespace te::io::detail

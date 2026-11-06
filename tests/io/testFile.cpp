#include "common/files.h"
#include <core/io/path.h>
#if !defined(_WIN32)
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#endif
#if defined(__APPLE__) || defined(__linux__)
#include <sys/xattr.h>
#endif

using namespace te::io;

TEST(io_utf8_paths_preserve_unicode_names)
{
    auto path = pathFromUtf8("★♪-🙂.hearthmap");
    CHECK_EQ(path, Path(u8"★♪-🙂.hearthmap"));
    CHECK_EQ(pathToUtf8(path), "★♪-🙂.hearthmap");
    CHECK(pathFromUtf8("").empty());
    CHECK(pathToUtf8(Path{}).empty());
}

TEST(io_file_round_trip_preserves_raw_bytes_and_refreshes_stamp)
{
    test::Directory directory;
    for (const auto& bytes : {std::string(""), std::string("no-final-newline"), std::string("\xef\xbb\xbf★♪\r\nsecond"), std::string("a\rb\r"), std::string("a\nb\n")}) {
        test::write(directory.file(), bytes);
        auto loaded = load(directory.file());
        CHECK(loaded);
        CHECK(loaded.value.stamp.exists());
        CHECK(!check(directory.file(), loaded.value.stamp));
        auto result = save(directory.file(), loaded.value.text, test::options(loaded.value));
        CHECK(result);
        CHECK(result.stamp.exists());
        CHECK_EQ(test::read(directory.file()), bytes);
        CHECK(!check(directory.file(), result.stamp));
        CHECK_EQ(directory.entries(), size_t(1));
    }
}

TEST(io_load_handles_actual_read_chunk_boundaries)
{
    test::Directory directory;
    for (const auto& suffix : {std::string("★🙂\r\n→"), std::string("\r\n→")}) {
        auto prefix = std::string(1024 * 1024 - 1, 'x');
        auto bytes = prefix + suffix;
        test::write(directory.file(), bytes);
        auto loaded = load(directory.file());
        CHECK(loaded);
        CHECK(loaded.value.format.ending == LineEnding::Crlf);
        CHECK_EQ(loaded.value.text, prefix + (suffix.front() == '\r' ? "\n→" : "★🙂\n→"));
    }
}

TEST(io_missing_file_is_only_created_on_explicit_save)
{
    test::Directory directory;
    auto missing = load(directory.file());
    CHECK(!missing);
    CHECK(missing.error.code == ErrorCode::NotFound);
    auto loaded = load(directory.file(), {true});
    CHECK(loaded);
    CHECK(!loaded.value.stamp.exists());
    CHECK(!std::filesystem::exists(directory.file()));
    auto saved = save(directory.file(), "new", test::options(loaded.value));
    CHECK(saved);
    CHECK_EQ(test::read(directory.file()), "new");
    CHECK(!save(directory.file(), "must not overwrite"));
    CHECK_EQ(test::read(directory.file()), "new");
}

TEST(io_unicode_path_and_encoded_output_limit)
{
    test::Directory directory;
    auto path = directory.path / pathFromUtf8("★♪-🙂.txt");
    SaveOptions limited{{LineEnding::Crlf, true}, {}, 6};
    auto blocked = save(path, "x\ny", limited);
    CHECK(!blocked);
    CHECK(blocked.error.code == ErrorCode::TooLarge);
    CHECK_EQ(directory.entries(), size_t(0));
    limited.maxBytes = 7;
    CHECK(save(path, "x\ny", limited));
    CHECK_EQ(test::read(path), "\xef\xbb\xbfx\r\ny");
    auto opened = load(path);
    CHECK(opened);
    CHECK_EQ(opened.value.text, "x\ny");
}

TEST(io_load_rejects_nonregular_invalid_and_oversized_inputs)
{
    test::Directory directory;
    CHECK(!load(Path{}));
    CHECK(!load(Path(std::string("bad\0path", 8))));
    auto folder = load(directory.path);
    CHECK(!folder);
    CHECK(folder.error.code == ErrorCode::NotRegularFile);
    test::write(directory.file(), "1234");
    CHECK(!load(directory.file(), {false, 3}));
    test::write(directory.file(), "valid then \xe2\x82");
    auto invalid = load(directory.file());
    CHECK(!invalid);
    CHECK(invalid.value.text.empty());
    CHECK(invalid.error.code == ErrorCode::InvalidUtf8);
#if !defined(_WIN32)
    CHECK_EQ(mkfifo(directory.file("fifo").c_str(), 0600), 0);
    auto fifo = load(directory.file("fifo"));
    CHECK(!fifo);
    CHECK(fifo.error.code == ErrorCode::NotRegularFile);
#endif
}

TEST(io_save_rejects_lossy_or_invalid_input_before_touching_original)
{
    test::Directory directory;
    test::write(directory.file(), "one\r\ntwo\n");
    auto loaded = load(directory.file());
    auto opts = test::options(loaded.value);
    auto mixed = save(directory.file(), loaded.value.text, opts);
    CHECK(!mixed);
    CHECK(mixed.error.code == ErrorCode::MixedLineEndings);
    CHECK_EQ(test::read(directory.file()), "one\r\ntwo\n");
    opts.format.ending = LineEnding::Lf;
    CHECK(!save(directory.file(), "\xff", opts));
    CHECK_EQ(test::read(directory.file()), "one\r\ntwo\n");
    CHECK(save(directory.file(), loaded.value.text, opts));
    CHECK_EQ(test::read(directory.file()), "one\ntwo\n");
}

TEST(io_conflict_detects_same_length_same_mtime_edit_and_deleted_original)
{
    test::Directory directory;
    test::write(directory.file(), "aaaa");
    auto loaded = load(directory.file());
    auto time = std::filesystem::last_write_time(directory.file());
    test::write(directory.file(), "bbbb");
    std::filesystem::last_write_time(directory.file(), time);
    CHECK(check(directory.file(), loaded.value.stamp).code == ErrorCode::Conflict);
    auto saved = save(directory.file(), "cccc", test::options(loaded.value));
    CHECK(!saved);
    CHECK(saved.error.code == ErrorCode::Conflict);
    CHECK_EQ(test::read(directory.file()), "bbbb");
    // Match all metadata to isolate the raw digest check (e.g. coarse filesystem stamps).
    auto current = load(directory.file());
    auto matched = *detail::Access::get(loaded.value.stamp);
    matched.info = detail::Access::get(current.value.stamp)->info;
    CHECK(check(directory.file(), detail::Access::stamp(matched)).code == ErrorCode::Conflict);
    std::filesystem::remove(directory.file());
    CHECK(check(directory.file(), loaded.value.stamp).code == ErrorCode::Conflict);
    CHECK(!save(directory.file(), "do not recreate", test::options(loaded.value)));
    CHECK(!std::filesystem::exists(directory.file()));
}

TEST(io_save_rechecks_content_after_staging_and_before_replacement)
{
    test::Directory directory;
    test::write(directory.file(), "original");
    auto loaded = load(directory.file());
    detail::Hooks hooks;
    hooks.before = [&](Stage stage) {
        if (stage == Stage::Verify) test::write(directory.file(), "external");
        return std::error_code{};
    };
    auto saved = detail::saveImpl(directory.file(), "new", test::options(loaded.value), &hooks);
    CHECK(!saved);
    CHECK(saved.error.code == ErrorCode::Conflict);
    CHECK_EQ(test::read(directory.file()), "external");
    CHECK_EQ(directory.entries(), size_t(1));
}

TEST(io_replacement_with_identical_bytes_still_conflicts)
{
    test::Directory directory;
    test::write(directory.file(), "original");
    auto loaded = load(directory.file());
    auto replacement = directory.file("replacement");
    test::write(replacement, "original");
    std::filesystem::remove(directory.file());
    std::filesystem::rename(replacement, directory.file());
    auto saved = save(directory.file(), "new", test::options(loaded.value));
    CHECK(!saved);
    CHECK(saved.error.code == ErrorCode::Conflict);
    CHECK_EQ(test::read(directory.file()), "original");
}

TEST(io_create_only_commit_does_not_overwrite_a_last_moment_arrival)
{
    test::Directory directory;
    detail::Hooks hooks;
    hooks.before = [&](Stage stage) {
        if (stage == Stage::Commit) test::write(directory.file(), "external");
        return std::error_code{};
    };
    auto saved = detail::saveImpl(directory.file(), "new", {}, &hooks);
    CHECK(!saved);
    CHECK(saved.error.code == ErrorCode::Conflict);
    CHECK_EQ(test::read(directory.file()), "external");
    CHECK_EQ(directory.entries(), size_t(1));
}

TEST(io_short_writes_complete_and_precommit_failures_preserve_original)
{
    test::Directory directory;
    test::write(directory.file(), "original");
    auto loaded = load(directory.file());
    for (auto stage : {Stage::Create, Stage::Write, Stage::Metadata, Stage::FileSync, Stage::Close, Stage::Commit}) {
        detail::Hooks hooks;
        hooks.before = [stage](Stage current) {
            return stage == current ? std::make_error_code(std::errc::no_space_on_device) : std::error_code{};
        };
        auto failed = detail::saveImpl(directory.file(), "new", test::options(loaded.value), &hooks);
        CHECK(!failed);
        CHECK(failed.state == SaveState::NotWritten);
        CHECK(failed.error.stage == stage);
        CHECK_EQ(test::read(directory.file()), "original");
        CHECK_EQ(directory.entries(), size_t(1));
    }
    detail::Hooks hooks;
    hooks.maxWrite = 2;
    size_t writes = 0;
    hooks.before = [&](Stage stage) {
        return stage == Stage::Write && ++writes == 3 ? std::make_error_code(std::errc::no_space_on_device) : std::error_code{};
    };
    auto partial = detail::saveImpl(directory.file(), "many bytes", test::options(loaded.value), &hooks);
    CHECK(!partial);
    CHECK_EQ(test::read(directory.file()), "original");
    CHECK_EQ(directory.entries(), size_t(1));
    hooks.before = {};
    auto saved = detail::saveImpl(directory.file(), "★🙂\ntext", test::options(loaded.value), &hooks);
    CHECK(saved);
    CHECK_EQ(test::read(directory.file()), "★🙂\ntext");
}

TEST(io_directory_sync_failure_reports_already_committed_bytes)
{
    test::Directory directory;
    test::write(directory.file(), "original");
    auto loaded = load(directory.file());
    detail::Hooks hooks;
    hooks.before = [](Stage stage) {
        return stage == Stage::DirectorySync ? std::make_error_code(std::errc::io_error) : std::error_code{};
    };
    auto saved = detail::saveImpl(directory.file(), "new", test::options(loaded.value), &hooks);
    CHECK(!saved);
    CHECK(saved.state == SaveState::CommittedDurabilityUnknown);
    CHECK_EQ(test::read(directory.file()), "new");
    CHECK(saved.stamp.exists());
    CHECK(!check(directory.file(), saved.stamp));
    CHECK_EQ(directory.entries(), size_t(1));
}

TEST(io_postcommit_exceptions_do_not_report_original_as_untouched)
{
    test::Directory directory;
    test::write(directory.file(), "original");
    auto loaded = load(directory.file());
    detail::Hooks hooks;
    hooks.before = [](Stage stage) -> std::error_code {
        if (stage == Stage::DirectorySync) throw std::runtime_error("completion failure");
        return {};
    };
    auto saved = detail::saveImpl(directory.file(), "new", test::options(loaded.value), &hooks);
    CHECK(!saved);
    CHECK(saved.state == SaveState::CommittedDurabilityUnknown);
    CHECK_EQ(test::read(directory.file()), "new");
    CHECK_EQ(directory.entries(), size_t(1));
}

TEST(io_postcommit_external_change_does_not_become_our_saved_stamp)
{
    test::Directory directory;
    test::write(directory.file(), "original");
    auto loaded = load(directory.file());
    detail::Hooks hooks;
    hooks.before = [&](Stage stage) {
        if (stage == Stage::DirectorySync) test::write(directory.file(), "external");
        return std::error_code{};
    };
    auto saved = detail::saveImpl(directory.file(), "new", test::options(loaded.value), &hooks);
    CHECK(!saved);
    CHECK(saved.state == SaveState::CommittedDurabilityUnknown);
    CHECK(saved.error.code == ErrorCode::Conflict);
    CHECK(!saved.stamp.exists());
    CHECK_EQ(test::read(directory.file()), "external");
}

TEST(io_hardlinks_are_preserved_by_refusing_atomic_replacement)
{
    test::Directory directory;
    test::write(directory.file(), "original");
    std::filesystem::create_hard_link(directory.file(), directory.file("alias"));
    auto loaded = load(directory.file());
    auto saved = save(directory.file(), "new", test::options(loaded.value));
    CHECK(!saved);
    CHECK(saved.error.code == ErrorCode::UnsupportedMetadata);
    CHECK_EQ(test::read(directory.file()), "original");
    CHECK_EQ(test::read(directory.file("alias")), "original");
    CHECK_EQ(std::filesystem::hard_link_count(directory.file()), uintmax_t(2));
}

#if !defined(_WIN32)
TEST(io_symlink_save_targets_referent_and_retargeting_conflicts)
{
    test::Directory directory;
    test::write(directory.file(), "original");
    auto alias = directory.file("link");
    std::filesystem::create_symlink(directory.file().filename(), alias);
    auto loaded = load(alias);
    CHECK(loaded);
    CHECK(save(alias, "new", test::options(loaded.value)));
    CHECK(std::filesystem::is_symlink(alias));
    CHECK_EQ(test::read(directory.file()), "new");
    loaded = load(alias);
    test::write(directory.file("other"), "other");
    std::filesystem::remove(alias);
    std::filesystem::create_symlink("other", alias);
    CHECK(!save(alias, "do not overwrite", test::options(loaded.value)));
    CHECK_EQ(test::read(directory.file("other")), "other");
    std::filesystem::remove(alias);
    std::filesystem::create_symlink("missing", alias);
    CHECK(!load(alias, {true}));
    CHECK(!save(alias, "do not replace link"));
    CHECK(std::filesystem::is_symlink(alias));
}

TEST(io_metadata_changes_between_saves_use_current_permissions)
{
    test::Directory directory;
    auto first = save(directory.file(), "first");
    CHECK(first);
    CHECK_EQ(chmod(directory.file().c_str(), 0640), 0);
    auto second = save(directory.file(), "second", {{}, first.stamp});
    CHECK(second);
    struct stat st{};
    CHECK_EQ(stat(directory.file().c_str(), &st), 0);
    CHECK_EQ(unsigned(st.st_mode & 0777), 0640u);
    CHECK_EQ(chmod(directory.file().c_str(), 0444), 0);
    auto blocked = save(directory.file(), "third", {{}, second.stamp});
    CHECK(!blocked);
    CHECK(blocked.error.code == ErrorCode::ReadOnly);
    CHECK_EQ(test::read(directory.file()), "second");
}
#endif

#if defined(__APPLE__) || defined(__linux__)
TEST(io_metadata_updates_between_saves_preserve_new_attributes)
{
    test::Directory directory;
    auto first = save(directory.file(), "first");
    CHECK(first);
    const char* name =
#if defined(__APPLE__)
        "com.hearthold.io-test";
    CHECK_EQ(setxattr(directory.file().c_str(), name, "metadata", 8, 0, 0), 0);
#else
        "user.hearthold.io-test";
    CHECK_EQ(setxattr(directory.file().c_str(), name, "metadata", 8, 0), 0);
#endif
    CHECK(!check(directory.file(), first.stamp));
    auto second = save(directory.file(), "second", {{}, first.stamp});
    CHECK(second);
    CHECK_EQ(test::read(directory.file()), "second");
    char value[8]{};
#if defined(__APPLE__)
    auto size = getxattr(directory.file().c_str(), name, value, sizeof(value), 0, 0);
#else
    auto size = getxattr(directory.file().c_str(), name, value, sizeof(value));
#endif
    CHECK_EQ(size, ssize_t(8));
    CHECK_EQ(std::string(value, sizeof(value)), "metadata");
}

TEST(io_metadata_changes_during_staging_are_not_overwritten)
{
    test::Directory directory;
    test::write(directory.file(), "original");
    auto loaded = load(directory.file());
    detail::Hooks hooks;
    hooks.before = [&](Stage stage) {
        if (stage == Stage::Verify) {
#if defined(__APPLE__)
            CHECK_EQ(setxattr(directory.file().c_str(), "com.hearthold.io-test", "new metadata", 12, 0, 0), 0);
#else
            CHECK_EQ(setxattr(directory.file().c_str(), "user.hearthold.io-test", "new metadata", 12, 0), 0);
#endif
        }
        return std::error_code{};
    };
    auto saved = detail::saveImpl(directory.file(), "replacement", test::options(loaded.value), &hooks);
    CHECK(!saved);
    CHECK(saved.error.code == ErrorCode::Conflict);
    CHECK(saved.state == SaveState::NotWritten);
    CHECK_EQ(test::read(directory.file()), "original");
}

TEST(io_staging_attributes_absent_from_original_are_not_retained)
{
    test::Directory directory;
    test::write(directory.file(), "original");
    auto loaded = load(directory.file());
    const char* name =
#if defined(__APPLE__)
        "com.hearthold.staging-only";
#else
        "user.hearthold.staging-only";
#endif
    detail::Hooks hooks;
    hooks.before = [&](Stage stage) {
        if (stage == Stage::Metadata)
            for (const auto& entry : std::filesystem::directory_iterator(directory.path)) {
                if (entry.path() == directory.file()) continue;
#if defined(__APPLE__)
                CHECK_EQ(setxattr(entry.path().c_str(), name, "staging", 7, 0, 0), 0);
#else
                CHECK_EQ(setxattr(entry.path().c_str(), name, "staging", 7, 0), 0);
#endif
            }
        return std::error_code{};
    };
    CHECK(detail::saveImpl(directory.file(), "new", test::options(loaded.value), &hooks));
#if defined(__APPLE__)
    auto size = getxattr(directory.file().c_str(), name, nullptr, 0, 0, 0);
#else
    auto size = getxattr(directory.file().c_str(), name, nullptr, 0);
#endif
    CHECK_EQ(size, ssize_t(-1));
    CHECK_EQ(test::read(directory.file()), "new");
}
#endif

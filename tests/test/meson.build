test_support_sources = files(
  'test.cpp',
  'directory.cpp',
)
test_support_deps = []
if build_ui
  test_support_sources += files('graphics.cpp')
  test_support_deps += thorvg_dep
endif
test_support = static_library(
  'test-support',
  test_support_sources,
  cpp_args: font_args,
  dependencies: test_support_deps,
  include_directories: include_directories('..'),
  override_options: profile_options,
)
test_dep = declare_dependency(
  link_with: test_support,
  dependencies: test_support_deps,
  include_directories: include_directories('..'),
)

core_sources = files('json/json.cpp')
core_deps = []
subdir('io')

core_library = library(
  'core',
  core_sources,
  include_directories: src_inc,
  override_options: profile_options,
  dependencies: core_deps,
)
core_dep = declare_dependency(
  link_with: core_library,
  include_directories: src_inc,
  dependencies: core_deps,
)

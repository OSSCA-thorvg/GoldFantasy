stb_dep = subproject('stb').get_variable('stb_dep')
ui_text_sources = files(
  'font/face.cpp',
  'font/database.cpp',
  'font/unicode.cpp',
)
ui_text_library = library(
  'ui-text',
  ui_text_sources,
  include_directories: src_inc,
  override_options: profile_options,
  dependencies: [thorvg_dep, stb_dep, core_dep],
)
ui_text_dep = declare_dependency(
  link_with: ui_text_library,
  include_directories: src_inc,
  dependencies: [thorvg_dep, core_dep],
)

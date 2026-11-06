subdir('text')
subdir('fonts')
subdir('icons')
ui_sources = files('core/theme.cpp', 'core/context.cpp', 'graphics/appearance.cpp', 'icons/icons.cpp', 'components/controls.cpp', 'script.cpp', 'render.cpp')
ui_sources += [icon_header] + ui_font_sources
subdir('platform')
ui_deps = [core_dep, thorvg_dep, ui_text_dep, lua_dep] + ui_font_deps
ui_library = library('ui', ui_sources, include_directories: src_inc, dependencies: ui_deps, override_options: profile_options)
ui_dep = declare_dependency(link_with: ui_library, include_directories: src_inc, dependencies: ui_deps)
if build_host
  subdir('host')
endif

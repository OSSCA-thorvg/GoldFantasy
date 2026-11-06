ui_font_sources = []
ui_font_deps = [ui_text_dep]
if target_platform == 'linux'
  ui_font_sources += files('linux/system_fonts.cpp')
  ui_font_deps += declare_dependency(
    include_directories: include_directories('linux/include', is_system: true),
    dependencies: meson.get_compiler('cpp').find_library(':libfontconfig.so.1'),
  )
elif target_platform == 'macos'
  ui_font_sources += files('macos/system_fonts.cpp')
  ui_font_deps += dependency('appleframeworks', modules: ['CoreText', 'CoreFoundation'])
elif target_platform == 'windows'
  ui_font_sources += files('windows/system_fonts.cpp')
  ui_font_deps += [
    meson.get_compiler('cpp').find_library('dwrite'),
    meson.get_compiler('cpp').find_library('user32'),
  ]
else
  ui_font_sources += files('fallback/system_fonts.cpp')
endif

if is_web
  ui_host_platform = declare_dependency(
    compile_args: ['--use-port=sdl3', '--use-port=emdawnwebgpu'],
    link_args: ['--use-port=sdl3', '--use-port=emdawnwebgpu'],
  )
else
  ui_host_platform = declare_dependency(dependencies: [dependency('sdl3', version: '>=3.2.0'), dependency('wgpu_native')])
endif
ui_host_deps = [ui_dep, ui_host_platform]
ui_host_library = static_library(
  'ui-host',
  ['host.cpp', 'webgpu.cpp'],
  include_directories: src_inc,
  dependencies: ui_host_deps,
  cpp_args: font_args,
  override_options: profile_options,
)
ui_host_dep = declare_dependency(link_with: ui_host_library, dependencies: ui_host_deps, include_directories: src_inc)

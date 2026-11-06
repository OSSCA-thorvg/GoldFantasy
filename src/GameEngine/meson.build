engine_asset_path = is_web ? '/assets/engine-building.json' : meson.current_source_dir() / 'assets/building.json'
engine_asset_args = ['-DENGINE_BUILDING_PATH="' + engine_asset_path + '"']
engine_library = static_library('game-engine', 'engine.cpp', dependencies: [ui_dep, game_framework_dep, authoring_dep],
  cpp_args: engine_asset_args, include_directories: src_inc, override_options: profile_options)
engine_dep = declare_dependency(link_with: engine_library, dependencies: [ui_dep, game_framework_dep, authoring_dep], include_directories: src_inc)
if get_option('engine_mode') == 'standalone'
  module_library = static_library('project-loader', '../ui/module.cpp', dependencies: [ui_dep, meson.get_compiler('cpp').find_library('dl', required: false)], include_directories: src_inc, override_options: profile_options)
  engine_args = ['-DENGINE_SCRIPT_PATH="' + meson.current_source_dir() / 'assets/demo.lua' + '"'] + engine_asset_args
  engine_links = [module_library]
  engine_deps = [engine_dep, ui_host_dep]
  if is_web and build_game and with_editor
    engine_args += '-DHEARTHOLD_STATIC_GAME_MODULE'
    engine_links += game_module
    engine_deps += game_application_dep
  endif
  engine_exe = executable('GameEngine', 'main.cpp', name_suffix: is_web ? 'js' : [], dependencies: engine_deps, link_with: engine_links,
    cpp_args: engine_args, link_args: web_link_args, link_depends: web_resource_dependencies, override_options: profile_options, install: true)
endif
install_data('assets/demo.lua', rename: 'engine.lua', install_dir: get_option('datadir') / 'hearthold/scripts')
install_data('assets/building.json', rename: 'engine-building.json', install_dir: get_option('datadir') / 'hearthold/assets')

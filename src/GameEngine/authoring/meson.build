authoring_library = static_library('game-engine-authoring', 'building_editor.cpp',
  dependencies: [ui_dep, game_framework_dep], include_directories: src_inc, override_options: profile_options)
authoring_dep = declare_dependency(link_with: authoring_library,
  dependencies: [ui_dep, game_framework_dep], include_directories: src_inc)

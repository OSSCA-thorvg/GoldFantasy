game_framework_library = static_library(
  'game-framework',
  ['geometry.cpp', 'coordinate_hash.cpp', 'light_flicker.cpp', 'mouth_animation.cpp',
   'building_model.cpp', 'building_asset.cpp', 'building_faces.cpp', 'building_depth.cpp', 'building_animation.cpp', 'building_icon.cpp'],
  include_directories: src_inc,
  dependencies: [core_dep, thorvg_dep],
  override_options: profile_options,
)
game_framework_dep = declare_dependency(link_with: game_framework_library, include_directories: src_inc, dependencies: [core_dep, thorvg_dep])

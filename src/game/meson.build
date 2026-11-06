# The Ogg Vorbis sounds made by tools/import_loach_audio.py, embedded with #embed where the compiler has it.
subdir('assets/audio')
audio_embed = cpp.compiles('const unsigned char data[] = {\n#embed __FILE__\n};\nint main() { return sizeof(data) > 0 ? 0 : 1; }', name: 'C++ #embed')
audio_data = custom_target(
  'game_audio_data',
  input: files('assets/audio/captions.tsv') + game_audio_files,
  output: 'game_audio_data.h',
  command: [import('python').find_installation(), files('tools/embed_audio.py'), audio_embed ? [] : ['--hex'],
            '--base', meson.current_source_dir() / 'assets/audio', '@OUTPUT@', '@INPUT@'],
)

hearthold_sources = files(
  'world_map.cpp',
  'map_document.cpp',
  'game_map_editor.cpp',
  'dungeon_sites.cpp',
  'road_network.cpp',
  'road_construction.cpp',
  'road_graph.cpp',
  'building_catalog.cpp',
  'building_models.cpp',
  'rise_animation.cpp',
  'cloud_mottle.cpp',
  'music_score.cpp',
  'person_look.cpp',
  'race.cpp',
  'person_portrait.cpp',
  'portrait_background.cpp',
  'idle_gesture.cpp',
  'person_speech.cpp',
  'character_assets.cpp',
  'spoken_voice.cpp',
  'character_preset.cpp',
  'structure_icon.cpp',
  'town.cpp',
  'save_game.cpp',
  'town_economy.cpp',
  'town_people.cpp',
  'unit_orders.cpp',
  'unit_needs.cpp',
  'unit_housing.cpp',
  'unit_status.cpp',
  'resource_harvesting.cpp',
  'construction_work.cpp',
  'town_monsters.cpp',
  'climate.cpp',
  'walk_paths.cpp',
  'traffic.cpp',
  'vector_paint.cpp',
  'terrain_painter.cpp',
  'tree_painter.cpp',
  'hvergelmir_painter.cpp',
  'mountain_peaks.cpp',
  'volcano_painter.cpp',
  'world_sprites.cpp',
  'ymir_statue.cpp',
  'world_renderer.cpp',
  'visibility_map.cpp',
  'game_app.cpp',
  'game_commands.cpp',
  'game_context_dock.cpp',
  'game_unit_panel.cpp',
  'game_hud.cpp',
  'game_speech.cpp',
  'sound_library.cpp',
  'music_director.cpp',
  'thunderstorm.cpp',
  'game_soundscape.cpp',
) + [audio_data]
hearthold_deps = [ui_dep, core_dep, ui_text_dep, game_framework_dep, subproject('stb').get_variable('stb_vorbis_dep')]
if not is_web
  hearthold_deps += dependency('threads')
endif
if with_editor
  hearthold_sources += files('authoring/map_editor.cpp', 'authoring/character_editor.cpp', 'authoring/character_controls.cpp', 'game_building_editor.cpp')
  hearthold_deps += authoring_dep
endif

hearthold_game = static_library(
  'hearthold-game',
  hearthold_sources,
  include_directories: src_inc,
  dependencies: hearthold_deps,
  cpp_args: ['-DBUILDING_ASSET_PATH="' + meson.current_source_dir() / 'assets/buildings' + '"'],
  override_options: game_profile_options,
)
hearthold_game_dep = declare_dependency(
  link_with: hearthold_game,
  include_directories: src_inc,
  dependencies: hearthold_deps,
)

game_application = static_library('hearthold-application', ['application.cpp', 'scene_application.cpp', 'demo.cpp', 'sound_board.cpp', 'effect_manager.cpp'],
  dependencies: [hearthold_game_dep, ui_host_dep], include_directories: src_inc,
  cpp_args: ['-DTITLE_ASSET_PATH="' + meson.current_source_dir() / 'assets/title/landscape.rgba' + '"'], override_options: game_profile_options)
game_application_dep = declare_dependency(link_with: game_application, dependencies: [hearthold_game_dep, ui_host_dep])
hearthold = executable('Hearthold', 'main.cpp', name_suffix: is_web ? 'js' : [], dependencies: game_application_dep,
  link_args: web_game_link_args, link_depends: web_resource_dependencies, override_options: game_profile_options, install: true)
if with_editor
  if is_web
    game_module = static_library('hearthold-project', 'module.cpp', dependencies: game_application_dep, override_options: game_profile_options)
  else
    game_module = shared_module('hearthold-project', 'module.cpp', dependencies: game_application_dep,
      override_options: game_profile_options, install: true, install_dir: get_option('libdir') / 'hearthold')
  endif
endif
install_data('scripts/hud.lua', install_dir: get_option('datadir') / 'hearthold/scripts')
install_data(game_building_assets, install_dir: get_option('datadir') / 'hearthold/assets/buildings')

# Opt-in CPU profiler: no SDL window, audio, server or timing-sensitive test assertions.
if not is_web
  executable('Hearthold-character-library', '../../tools/render_character_library.cpp',
    dependencies: hearthold_game_dep, include_directories: src_inc, cpp_args: font_args,
    override_options: game_profile_options, build_by_default: false)
  executable('Hearthold-road-profile', '../../tools/profile_roads.cpp',
    dependencies: hearthold_game_dep, include_directories: src_inc,
    override_options: game_profile_options, build_by_default: false)
endif

if not is_web
  executable('Hearthold-gameplay-profile', '../../tools/profile_gameplay.cpp',
    dependencies: game_application_dep, include_directories: src_inc, cpp_args: font_args,
    override_options: game_profile_options, build_by_default: false)
endif

executable('Hearthold-residents-profile', '../../tools/profile_residents.cpp', name_suffix: is_web ? 'js' : [],
  dependencies: game_application_dep, include_directories: src_inc, link_args: web_game_link_args,
  link_depends: web_resource_dependencies, override_options: game_profile_options, build_by_default: false)

if not is_web and with_editor
  executable('Hearthold-map-profile', '../../tools/profile_map_stress.cpp',
    dependencies: game_application_dep, include_directories: src_inc, cpp_args: font_args,
    override_options: game_profile_options, build_by_default: false)
endif

install_data('assets/title/landscape.rgba', install_dir: get_option('datadir') / 'hearthold/assets/title')

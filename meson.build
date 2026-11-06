project('Hearthold', ['c', 'cpp'], version: '0.1.0', meson_version: '>=1.3',
  default_options: ['cpp_std=c++26,c++latest,c++23', 'warning_level=2', 'default_library=static', 'buildtype=debugoptimized'])

cpp = meson.get_compiler('cpp')

profile = get_option('profile')
modules = get_option('targets')
build_game = 'game' in modules
build_engine = 'engine' in modules or (build_game and profile == 'witheditor')
build_ui = build_game or build_engine or 'ui' in modules
with_editor = build_game and profile == 'witheditor'
build_host = build_game or (build_engine and get_option('engine_mode') == 'standalone')
run_tests = get_option('tests').enabled() or (get_option('tests').auto() and (not build_game or profile != 'ship'))
game_optimization = '0'
game_profile_options = ['debug=true', 'b_ndebug=false']
if profile == 'witheditor'
  game_optimization = '2'
elif profile == 'ship'
  game_optimization = '3'
  game_profile_options = ['debug=false', 'b_ndebug=true']
endif
# Release optimization takes precedence over the game profile, including authoring builds.
if get_option('buildtype') == 'release'
  game_optimization = '3'
endif
game_profile_options += ['optimization=' + game_optimization]

profile_options = []  # Engine libraries use Meson's buildtype, independently of the game profile.
target_platform = host_machine.system()
is_web = target_platform == 'emscripten'
web_link_args = []
web_game_link_args = []
if is_web
  # Emscripten runs JS/Binaryen optimizations only when the final link requests them.
  link_optimization = get_option('optimization')
  if link_optimization in ['1', '2', '3', 's']
    web_link_args = ['-O' + link_optimization]
  endif
  if game_optimization != '0'
    web_game_link_args = web_link_args
  endif
endif
if target_platform == 'darwin'
  target_platform = 'macos'
endif
src_inc = include_directories('src', '.')
config = configuration_data()
config.set10('HEARTHOLD_WITH_EDITOR', with_editor)
config.set10('HEARTHOLD_SHIPPING', build_game and profile == 'ship')
config.set10('HEARTHOLD_RENDERER_WGPU', get_option('renderer') == 'wgpu')
config.set_quoted('HEARTHOLD_PROFILE', build_game ? profile : 'engine')
configure_file(output: 'engine_config.h', configuration: config)
if cpp.get_argument_syntax() == 'msvc'
  add_project_arguments(cpp.get_supported_arguments('/permissive-', '/Zc:__cplusplus', '/Zc:preprocessor', '/utf-8'), language: 'cpp')
  add_project_arguments('/FI' + meson.project_build_root() / 'engine_config.h', language: 'cpp')
else
  add_project_arguments('-include', meson.project_build_root() / 'engine_config.h', language: 'cpp')
endif

font_assets = meson.project_source_root() / 'src/ui/assets/fonts'
font_args = ['-DUI_FONT_PATH="' + font_assets / 'DejaVuSans.ttf' + '"',
             '-DUI_BOLD_FONT_PATH="' + font_assets / 'DejaVuSans-Bold.ttf' + '"']
if is_web
  font_args = ['-DUI_FONT_PATH="/fonts/DejaVuSans.ttf"', '-DUI_BOLD_FONT_PATH="/fonts/DejaVuSans-Bold.ttf"']
endif
if build_ui
  thorvg_dep = dependency('thorvg-1', version: '>=1.2.0')
  lua_dep = subproject('lua').get_variable('lua_dep')
endif
subdir('src')
if run_tests
  subdir('tests')
endif
if build_game or build_engine
  install_data('src/ui/assets/fonts/DejaVuSans.ttf', 'src/ui/assets/fonts/DejaVuSans-Bold.ttf', 'src/ui/assets/fonts/DejaVuSans.LICENSE', install_dir: get_option('datadir') / 'hearthold/fonts')
endif
summary({'C++ standard': get_option('cpp_std'), 'Profile': profile, 'Targets': modules, 'GameEngine': build_engine, 'Renderer': get_option('renderer'), 'Web': is_web, 'Tests': run_tests})

subdir('test')
test_sources = []
test_deps = [test_dep]
test_dependencies = []
test_args = font_args + [
  '-DFONT_DATA_PATH="' + meson.current_source_dir() / 'test/fonts' + '"',
]
subdir('io')
if build_ui
  subdir('text')
  subdir('ui')
endif
if build_game or build_engine
  subdir('framework')
endif
if build_game
  subdir('game')
endif
if build_engine
  subdir('engine')
endif
if with_editor and not is_web and get_option('engine_mode') == 'standalone'
  test_sources += files('engine/testModule.cpp')
  test_deps += declare_dependency(link_with: module_library)
  test_args += '-DGAME_MODULE_PATH="' + game_module.full_path().replace('\\', '/') + '"'
  test_dependencies += game_module
endif

if test_sources != []
  test_runner = executable(
    'Hearthold-tests',
    'test/main.cpp',
    test_sources,
    dependencies: test_deps,
    cpp_args: test_args,
    override_options: profile_options,
  )
  test_env = ['SDL_MAC_BACKGROUND_APP=1', 'SDL_AUDIODRIVER=dummy']
  if host_machine.system() != 'darwin'
    test_env += 'SDL_VIDEODRIVER=dummy'
  endif
  test('Hearthold', test_runner, depends: test_dependencies, env: test_env, timeout: 300)
endif

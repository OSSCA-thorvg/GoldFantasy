project('stb', ['c', 'cpp'], version: '1.26', meson_version: '>=1.1')

# Only text/font/face.cpp compiles the stb_truetype implementation.
stb_dep = declare_dependency(
  include_directories: include_directories('.', is_system: true),
)
meson.override_dependency('stb', stb_dep)

# The Ogg Vorbis decoder, built once as C and quietly: users include stb_vorbis.c with STB_VORBIS_HEADER_ONLY.
stb_vorbis_args = ['-DSTB_VORBIS_NO_STDIO', '-DSTB_VORBIS_NO_PUSHDATA_API']
stb_vorbis = static_library('stb_vorbis', 'stb_vorbis.c', c_args: stb_vorbis_args, override_options: ['warning_level=0'])
stb_vorbis_dep = declare_dependency(
  link_with: stb_vorbis,
  include_directories: include_directories('.', is_system: true),
  compile_args: stb_vorbis_args + ['-DSTB_VORBIS_HEADER_ONLY'],
)

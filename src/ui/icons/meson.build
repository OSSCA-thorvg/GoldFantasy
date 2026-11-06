icon_assets = ['folder', 'check', 'chevron-right', 'chevron-left']
icon_rows = []
foreach name : icon_assets
  # Strip formatting around JSON lines, preserving whitespace inside strings.
  content = []
  foreach line : import('fs').read('assets' / (name + '.json')).splitlines()
    content += line.strip()
  endforeach
  icon_rows += '    {"@0@", R"LOTTIE(@1@)LOTTIE", true},'.format(name, ''.join(content))
endforeach
icon_data = configuration_data()
icon_data.set('UI_ICON_DATA', '\n'.join(icon_rows))
icon_header = configure_file(
  input: 'builtin_data.h.in',
  output: 'builtin_data.h',
  configuration: icon_data,
)

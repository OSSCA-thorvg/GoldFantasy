subdir('core')
io_dep = core_dep
game_building_assets = []
if build_game
  game_building_assets = files(
    'game/assets/buildings/apothecary.json',
    'game/assets/buildings/armorer.json',
    'game/assets/buildings/bazaar.json',
    'game/assets/buildings/camp.json',
    'game/assets/buildings/castle.json',
    'game/assets/buildings/chapel.json',
    'game/assets/buildings/cottage.json',
    'game/assets/buildings/farm.json',
    'game/assets/buildings/grand-inn.json',
    'game/assets/buildings/guild-hall.json',
    'game/assets/buildings/guild.json',
    'game/assets/buildings/hostel.json',
    'game/assets/buildings/inn.json',
    'game/assets/buildings/keep.json',
    'game/assets/buildings/lumberyard.json',
    'game/assets/buildings/mage-tower.json',
    'game/assets/buildings/manor.json',
    'game/assets/buildings/market-hall.json',
    'game/assets/buildings/market-stalls.json',
    'game/assets/buildings/palisade.json',
    'game/assets/buildings/portal.json',
    'game/assets/buildings/quarry.json',
    'game/assets/buildings/shrine.json',
    'game/assets/buildings/storehouse.json',
    'game/assets/buildings/tavern.json',
    'game/assets/buildings/tent.json',
    'game/assets/buildings/townhouse.json',
    'game/assets/buildings/weaponsmith.json',
    'game/assets/buildings/well.json',
  )
endif
web_resource_dependencies = []
if is_web
  if build_game or build_engine
    web_resource_dependencies += files('ui/assets/fonts/DejaVuSans.ttf', 'ui/assets/fonts/DejaVuSans-Bold.ttf')
  endif
  if build_game
    web_resource_dependencies += game_building_assets + files('game/scripts/hud.lua')
  endif
  if build_engine
    web_resource_dependencies += files('GameEngine/assets/demo.lua', 'GameEngine/assets/building.json')
  endif
endif
if build_ui
  subdir('ui')
  text_dep = ui_text_dep
endif
if build_game or build_engine
  subdir('GameEngine/GameFramework')
endif
if build_engine
  subdir('GameEngine/authoring')
endif
if build_game
  subdir('game')
endif
if build_engine
  subdir('GameEngine')
endif

# Explicitly built benchmark for shared UI/Lua/geometry and the module inspector.
if build_engine and not is_web
  executable('Hearthold-engine-profile', '../tools/profile_engine.cpp',
    dependencies: engine_dep, include_directories: src_inc, cpp_args: font_args,
    override_options: profile_options, build_by_default: false)
endif

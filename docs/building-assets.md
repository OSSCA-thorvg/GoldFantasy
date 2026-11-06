# Editable building assets

This is the implementation contract for replacing procedural building appearances with JSON assets and a visual editor. The initial conversion retains all 29 structures and all 93 distinct variant slots. Gameplay specifications, growth rules, placement, construction work, faiths, and world effects remain game code.

## Ownership and dependencies

- `core`: reusable JSON parsing/writing and the existing `te::io` atomic UTF-8 file API.
- `ui`: existing controls, themes, input routing, and host command export. No building knowledge.
- `GameEngine/GameFramework`: parameterized appearance types, JSON schema, orientation/sorting, projection, face generation, rise animation, and icon rendering. These files never include `game/`.
- `GameEngine/authoring`: the reusable `engine::BuildingEditor`, depending on UI and GameFramework. Build its small library before `game`, independently of the engine application wrapper.
- `GameEngine/engine.cpp`: opens the reusable editor, supplies the engine example, and explicitly sends an accepted asset to a loaded module.
- `game`: maps stable asset IDs to `Structure`, verifies game compatibility, owns active appearance revisions, and adapts existing `structureModel`, `riseAnimation`, and `structureIcon` calls.

Keep `Structure`, `StructureSpec`, `Resources`, growth/faith enums, and game `Stage` in the game. Move `Rgb`, `RoofShape`, `Trim`, `Ornament`, `Block`, `Patch`, and `Model` to GameFramework; game headers can alias them to avoid unrelated appearance changes. Move the existing geometry and animation behavior rather than writing a second preview renderer.

The native game module links a separate copy of static framework code. Engine and module must not exchange edits through a presumed shared global registry. The module receives serialized JSON through `Application::command` and publishes its own accepted revision.

## Schema version 1

One canonical file per structure lives in `src/game/assets/buildings/<id>.json`. `src/GameEngine/assets/building.json` is an independent, usable example for engine-only builds. Its ID is `example-building`.

```json
{
  "format": "building-asset",
  "version": 1,
  "id": "cottage",
  "name": "Cottage",
  "footprint": 1,
  "variants": [
    {
      "patches": [],
      "blocks": [
        {
          "bounds": [0.14, 0.16, 0.76, 0.84],
          "wall": 20,
          "roof": 15,
          "shape": "gable-y",
          "wallLit": [112, 100, 86],
          "wallShade": [72, 64, 58],
          "roofLit": [92, 80, 54],
          "roofShade": [60, 52, 38],
          "base": 0,
          "delay": 0,
          "windows": 1,
          "door": true,
          "trim": "timber",
          "glass": [232, 162, 72],
          "ornament": "none",
          "accent": [156, 40, 46]
        }
      ]
    }
  ]
}
```

Each patch is `{ "bounds": [x0,y0,x1,y1], "color": [r,g,b], "furrows": 0, "furrow": [r,g,b], "delay": 0 }`. Bounds and stage offsets use tile units; wall, roof, and base use unscaled pixel heights; delays use frames at 30 fps. Variants contain complete independent models, with no procedural expressions, inheritance, or palette substitution language.

Required top-level fields are exactly those above. Each variant requires `patches` and `blocks`. Blocks require bounds, wall, roof, shape, and the four face colors. Remaining block fields default exactly as the existing C++ struct: base/delay/windows zero, door false, trim/ornament none, glass `[232,162,72]`, accent `[156,40,46]`. Patches require bounds/color; optional furrows/delay default zero and furrow defaults `[0,0,0]`. The encoder emits every field, uses locale-independent round-trip numeric precision, and ends with a newline. Reject unknown fields instead of silently discarding edits.

A block's door lies on its authored +Y wall, 28% along the X span, and rotates with the building. The renderer's transient `doorFacing` records quarter turns; it is not a JSON property. The game selects the frontmost ground-level door as the entrance, with a footprint-edge fallback for open structures. Units walk to an accessible exterior approach, then cross to the door threshold at walking speed. Opacity changes only within the last 0.35 map units; exiting reverses the same corridor. Outdoor work stays visible. Completed indoor occupants refresh their entrance after an upgrade while hidden, and partial crossings preserve their current route.

Enums are case-sensitive strings: shape `flat|gable-x|gable-y|pyramid`, trim `none|timber|crenels|stakes`, ornament `none|banner|crystal`. Colors are exactly three integral channels in `[0,255]`; booleans must be JSON booleans. Version is the integer 1. ID matches `[a-z][a-z0-9-]{0,63}`; name is 1–96 UTF-8 bytes without controls and contains a non-space character.

V1 limits: 4 MiB per file; 1–32 variants; at most 64 blocks and 32 patches per variant, with at least one primitive; footprint `[0.25,8]`; coordinates `[-8,16]`, positive rectangle spans at most 8; individual base/wall/roof `[0,256]` and their sum at most 512; delays `[0,120]`; windows integral `[0,8]`; furrows integral `[0,32]`. All numbers are finite. Bound decoration expansion to 2,048 generated faces per variant, including stakes/crenels, before constructing animation data. Report the field path in errors, for example `variants[0].blocks[2].bounds: x1 must exceed x0`.

The game additionally requires a known ID, the exact `StructureSpec.size`, and the original variant count below. Footprint is visual metadata, not an editable gameplay collision size. Show it read-only in the game editor; standalone assets may edit it. Keep game variant counts/order fixed because Chapel slots also encode faith.

## Public framework interfaces

Use the existing struct member names internally, including `Block::x0/y0/x1/y1` and `Patch::x0/y0/x1/y1`.

```cpp
namespace gameframework {
struct BuildingAsset {
    std::string id, name;
    float footprint = 1;
    std::vector<Model> variants;
};
bool validateBuildingAsset(const BuildingAsset&, std::string& error);
bool decodeBuildingAsset(std::string_view, BuildingAsset&, std::string& error);
std::string encodeBuildingAsset(const BuildingAsset&);
const Model& buildingVariant(const BuildingAsset&, uint32_t seed);
void sortModel(Model&);
void orientModel(Model&, int quarterTurns, float footprint);
void splitAngle(float angle, int& quarterTurns, float& remainder);

struct BuildingProjection {
    float halfWidth = 32, halfHeight = 16;
    Point project(float x, float y, float z = 0) const;
};
// Existing Face/Motion behavior; Motion additionally owns a BuildingProjection.
void buildingFaces(const Model&, const Motion&, std::vector<Face>&);
struct BuildingStage {
    Model model;
    float footprint = 1, dx = 0, dy = 0;
};
// RiseAnimation retains json, width/height, originX/Y, frames/frameRate.
RiseAnimation buildingRiseAnimation(const Model&, float footprint,
    const std::vector<BuildingStage>& replaced = {}, float angle = 0,
    BuildingProjection projection = {});
tvg::Scene* buildingIcon(const Model&, float footprint, float width, float height,
    float angle = 0, BuildingProjection projection = {});
}
```

Recommended files: `building_model`, `building_asset`, `building_faces`, `building_animation`, and `building_icon` under GameFramework. Game wrappers retain their existing public call signatures and explicitly construct old-stage snapshots from the active game catalog. `buildingVariant` selects `seed % variants.size()`; never reinterpret an asset index as a game enum.

The JSON implementation seam is fixed: `<core/json/json.h>`, namespace `te::json`, `Value`, `Array=std::vector<Value>`, `Object=std::map<std::string,Value,std::less<>>`; pointer accessors `number()/boolean()/string()/array()/object()` and `find(string_view)`; `parse(string_view,Value&,string&,Limits={})`; `stringify(const Value&,bool pretty=true)`. Parsing is transactional and rejects duplicate keys, invalid UTF-8/escapes, trailing input, nonfinite numbers, and resource-limit excesses. Default limits are 4 MiB, depth 64, and 200,000 values. No private ThorVG JSON headers.

## Conversion and runtime

| Asset ID | Slots |
| --- | ---: |
| camp | 1 |
| tent | 12 |
| cottage, townhouse, manor | 6 each |
| market-stalls | 4 |
| market-hall | 12 |
| bazaar | 4 |
| farm, lumberyard, quarry, well, storehouse, shrine, mage-tower, portal | 1 each |
| tavern | 3 |
| hostel | 4 |
| inn, grand-inn | 3 each |
| guild, guild-hall | 1 each |
| chapel | 4 |
| weaponsmith, armorer, apothecary | 3 each |
| palisade, keep, castle | 2 each |

Export every slot from the original generator before deleting its procedural construction functions. Preserve every field, float value, vector order, support sorting, and all four chapel colors. Validate and round-trip exported models, then compare every slot against the original models while the exporter is still available. Retain compact semantic baseline hashes in migration tests, rather than a second runtime generator or duplicated full asset bundle.

JSON is the runtime source of truth. Initial loading of a missing/broken bundled catalog fails clearly; there is no procedural fallback. Native default lookup checks installed `share/hearthold/assets/buildings`, then the configured source directory for checkout use; an explicitly supplied directory takes priority. Web bundled files live at `/assets/buildings`; accepted user overrides live at `/data/assets/buildings`.

Game catalog operations are transactional: decode and validate a complete candidate, check ID/footprint/slot compatibility, then publish. A rejected open/reload/apply retains the last working data and revision. A persisted browser override that fails validation leaves the valid bundled entry active and reports the problem. A whole-directory reload stages every required entry before replacing the active catalog. Do not repeatedly parse files in `structureModel`; load/cache accepted assets, and offer explicit Reload for external edits.

Accepted changes increment the changed kind's appearance revision and the catalog generation. Include generation in `WorldRenderer::update`'s synchronization gate. Include the current kind and all replaced-stage appearance revisions in each retained visual's dependency key. Rebuild only affected animations, retain completed buildings at the last frame, retain normalized animation position for other built buildings, and use existing construction progress for unfinished ones. Do not alter town/building gameplay versions merely to refresh appearance. Add the relevant appearance revision to both HUD icon paint keys. `invalidateMap()` alone does not clear retained visuals and is insufficient.

Preserve quarter-turn orientation plus the residual angle, old-stage offsets around the new footprint center, the 10-frame sink head start, overshoot, delayed openings/details, dust, composition bounds, and origins. Extend duration when custom window delays or an old stage's delay exceed the existing `lastDelay+42` duration; built-in durations stay unchanged. Campfire, light spill, and arcane wisps remain existing world-renderer behavior.

Building vertices retain view depth alongside their projected position. For rotated world coordinates, projection is `screenX=32*(x-y)`, `screenY=16*(x+y)-z`, and depth is `x+y`; increasing depth along the same screen ray moves toward the viewer. `building_depth` splits intersecting surfaces with a BSP tree and draws them back to front. This allows a roof to hide only the embedded portion of a chimney. Opaque surfaces also clip buried outline segments; split boundaries do not create new outlines. Consecutive fragments of the same source share a compound paint to avoid artificial antialiasing seams.

Construction and upgrade animations recompute that geometry at 30 frames per second, including the exact last playable frame for fractional delays. Held Lottie paths prevent interpolation between unrelated fragments; adjacent float keys preserve stepped gradient colors on ThorVG versions that interpolate held gradient stops. Still previews evaluate only the completed pose, using the same geometry and materials. This handles surfaces within a building and its replacement stages; world compositing still uses retained building pictures, not a scene-wide GPU depth buffer.

## Editor and file commands

The shared editor is a contextless UI component, matching existing game authoring components:

```cpp
namespace engine {
struct BuildingEditorEntry {
    gameframework::BuildingAsset asset;
    std::filesystem::path path;
};
class BuildingEditor {
public:
    using Apply = std::function<bool(const gameframework::BuildingAsset&, std::string&)>;
    BuildingEditor(gameframework::BuildingAsset, std::filesystem::path = {});
    void setChoices(std::vector<BuildingEditorEntry>);
    void render(ui::Context&, ui::Rect, const Apply&, const std::function<void()>& close);
    const gameframework::BuildingAsset& current() const;
    bool setAsset(const gameframework::BuildingAsset&, const std::filesystem::path&, std::string&);
    bool load(const std::filesystem::path&);
    bool save(const std::filesystem::path& = {});
    bool exportTo(const std::filesystem::path&);
    bool command(std::string_view id, std::string_view argument = {});
    void undo(); void redo();
    bool changed() const; bool animating() const;
    const std::string& message() const;
};
}
```

Hosts may add small getters required by input/tests, but keep this component free of game types. The game provides compatible asset choices and its apply callback. Engine uses its example and file picker/path entry; when a module is present, its apply callback serializes and calls `module->command("asset.apply", json)`. A module rejection stays visible and leaves both working states intact. Apply is separate from Save and remains in the editor. Closing discards only the unpublished draft. Keep deferred host close/apply decisions outside UI paint callbacks when scene ownership requires it.

Editor controls: asset and variant selectors; blocks/patches list with selected primitive; Add/Duplicate/Delete; numeric rectangle bounds, wall/roof/base/delay and count inputs; roof/trim/ornament choices; door toggle; all wall/roof/glass/accent or patch/furrow RGB channels. Organize inspector tabs as Geometry, Details, and Colors with scrolling. Provide live isometric preview, selection outline, footprint/grid, continuous angle control and quarter-turn shortcuts, zoom/fit, Still/Construction/Upgrade preview, playback/restart/frame scrub, Undo/Redo, Reset, Reload, path field, Save, Apply, Close. Construction and upgrade previews use the same framework animation builder as the game. Numeric fields plus selectable geometry and live rendering are required; direct rectangle dragging is an optional enhancement.

Use existing `ui::Theme`, controls, font sizes, spacing, and native editor keyboard modifier helpers. Fit panels to narrow/short viewports without covering Save/Apply. Coalesce each drag into one history entry; cap history at 64 snapshots. Invalid numeric edits show a field error without replacing the last valid preview. Loading, switching, or closing a modified draft must offer a local discard/revert choice without changing published game data.

Access: GameEngine toolbar **Buildings** and command `asset.editor` work without a game module or game assets. The game exposes **Building Studio**, F4, and `edit.building`; start with the selected building's kind/variant, or Cottage. In an engine-hosted game, the module's Building Studio action remains available. Dev/ship game builds consume JSON assets but omit authoring UI and authoring entry points.

Existing `ui_host_command(name, argument)` is the web/native integration boundary; no new WASM export or game-specific virtual API:

| Command | Argument and effect |
| --- | --- |
| `asset.available` | Read-only capability check; true for an authoring host. |
| `asset.editor` | Optional asset path; opens the editor (game aliases this to `edit.building`). |
| `asset.open` | Required path; validate and open a draft transactionally, opening editor if needed. |
| `asset.save` | Optional destination path; save current draft with its retained disk baseline. |
| `asset.export` | Required destination path; export current validated draft without changing document path, dirty state, or game. |
| `asset.apply` | Complete JSON text; runtime game validates compatibility and publishes, without opening editor or writing a file. |

Use `te::io::pathFromUtf8/pathToUtf8`. The document retains `DiskStamp` from its original load and updates it only after a committed save; do not reacquire a fresh baseline immediately before overwriting. Changing to a new Save As path explicitly obtains that destination's baseline. Keep draft changes after any failed save, including conflict/read-only/size errors, and handle `CommittedDurabilityUnknown` truthfully.

Keep draft, saved-file, and applied snapshots separate, including when switching catalog entries. The game catalog retains the original file snapshot and stamp across Apply and editor reopening; a committed Save updates that source metadata separately. Reopening the game editor starts from the running game's appearance. **Reload** opens the saved JSON, which can then be applied. Save, Apply, and Export validate pending text-field input before using the draft; invalid input remains visible for correction.

## Browser and distribution

Extend the existing dock with a Building asset mode and Edit/Open JSON, Save in browser, and Download controls. Preserve Lua editing and its shortcuts. The visual UI stays inside the canvas. Capability-check before exposing authoring controls, including game-only builds.

Upload writes the selected file to a temporary MEMFS staging path, then invokes `asset.open`; the native decoder validates before changing the draft. Upload does not overwrite an accepted IDBFS asset. Save targets `/data/assets/buildings/<id>.json`; call `FS.syncfs(false, callback)` before claiming it is stored in the browser. Download first invokes `asset.export` to a temporary path, reads those bytes, and downloads a JSON Blob; this captures current visual-editor changes, unlike a stale textarea. Show persistence errors and keep Download available. Startup hydrates IDBFS before runtime initialization, as it already does.

Install game JSON under `datadir/hearthold/assets/buildings`; install the engine example separately. Preload game assets at `/assets/buildings` for every game web profile and the engine example at `/assets/engine-building.json` for engine builds. Preserve existing `/fonts` and `/scripts` resources. Existing packaging already copies `share/hearthold`.

## Implementation slices and checks

1. Root: `src/core/json/**`, core build registration, and `tests/io/testJson.cpp` only. Publish the fixed JSON API above.
2. Runtime agent: `GameEngine/GameFramework/building_*`, game asset files, `game/building_catalog.h` type aliases, game catalog/model/face/rise/icon adapters, `world_renderer.*`, and focused framework/game runtime tests. Own per-kind revision API consumed by HUD/editor. Do not edit game HUD, GameApp, Application, or build files; send required source lists to the build agent.
3. Editor agent: `GameEngine/authoring/**`, `GameEngine/engine.cpp`, `game/game_app.*`, `game/game_hud.cpp`, optional `game/game_building_editor.cpp`, and editor/engine tests. Own F4-facing GameApp API and both icon cache key edits. Do not edit `game/application.*`, game main, framework implementation, or build files.
4. Build/web agent: Meson wiring except root-owned core registration; `tools/web_build.py`, `web/index.html`, install/preload rules, `game/application.*`, `game/main.cpp`, and engine CLI argument wiring if needed. Route the commands above, F4/input, and startup options using editor/runtime APIs; run integrated silent native/WASM validation. Do not edit engine.cpp or GameApp internals.

Runtime and editor agents should immediately publish header/API changes to the other implementers. Build agent should register new tests/sources from their lists. Root resolves integration conflicts and reviews dependency isolation.

Required checks: strict/transactional JSON cases; all 29 IDs and 93 semantic baseline slots; variant selection including `UINT32_MAX`; encode/decode fidelity and invalid-schema nonmutation; save/load/conflict behavior; all shapes/details; arbitrary angles including quarter-turn boundaries; actual four-house merge offsets; fresh/upgrade Lottie load and bounds; editor numeric/color/add/delete/history operations; Apply updates existing world and both HUD icons without replaying completed construction; rejected apply retains revisions; native dev consumption and editor omission; engine-only standalone/library builds without game sources; native installed-path lookup; browser upload/edit/save/reload/download and IDBFS failure feedback. Retain the existing placement, growth, merge, faith, construction, and animation suites.

All validation is silent and hidden: `SDL_AUDIODRIVER=dummy`, hidden native windows, isolated headless Chromium with `--mute-audio`. Track and close only this task's processes, tabs, servers, and temporary browser profiles on success or failure. Leave no preview running.

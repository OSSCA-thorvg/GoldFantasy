#pragma once

#include <array>
#include <optional>

#include <GameEngine/GameFramework/light_flicker.h>
#include "rise_animation.h"
#include "terrain_painter.h"
#include "world_sprites.h"
#include "thunderstorm.h"
#include "town.h"
#include "traffic.h"
#include "visibility_map.h"
#include "volcano_painter.h"
#include "ymir_statue.h"
#include <ui/ui.h>
#include <map>
#include <memory>

namespace hearthold
{
using gameframework::Flicker;
using gameframework::brightest;
// What the active tool would do, drawn over the world.
struct Preview
{
    enum class Kind { None, Footprint, Road, Field, Clear } kind = Kind::None;
    Outline outline;     // Footprint, field outline or the demolition target.
    bool closed = true;  // An open outline is a field still being drawn.
    RoadPath road;       // Road being drawn, paved or cleared.
    bool brush = false; // Freehand pen cursor.
    int active = -1;     // Highlighted field corner.
    Point cursor;
    bool valid = false;
    float zoom = 1;      // Keeps knobs a constant size on screen.
    bool operator==(const Preview& o) const
    {
        return kind == o.kind && outline == o.outline && closed == o.closed && road == o.road && brush == o.brush && active == o.active &&
               cursor == o.cursor && valid == o.valid && zoom == o.zoom;
    }
};

// Retained ThorVG scenes for the town. Terrain, roads and objects rebuild only when the town changes;
// rise animations, travellers, wisps and the campfire update per frame.
class WorldRenderer
{
public:
    WorldRenderer();
    ~WorldRenderer();
    WorldRenderer(const WorldRenderer&) = delete;
    WorldRenderer& operator=(const WorldRenderer&) = delete;

    // Owned by the caller's canvas once added.
    tvg::Scene* scene() const { return root; }
    // Sync the canvas before calling: this mutates retained paints.
    void update(const Town&, const Traffic&, const Camera&, float width, float height, double seconds, const Preview&, const std::vector<int>& selected = {});
    // A strike of lightning: the land flashes, brightest towards where it struck, and a near strike's bolt comes
    // down there from the clouds.
    void lightning(const Strike&);
    bool animating() const;
    bool visible(Point at) const { return inSight(at); }
    // The building drawn over a projected point, frontmost first, or -1: its drawing from roof to footprint, as wide
    // as its footprint.
    int buildingDrawnAt(const Town&, Point projected) const;
    void invalidateMap();
    void invalidateTerrain(TileRegion);
    // Consolidate a wide editor stroke so small clipped patches do not accumulate forever.
    void finishTerrainEdits();
    void setEditorView(bool value) { editorView = value; }
    void setSceneView(bool value) { sceneView = value; editorView = value; }

private:
    bool editorView = false;
    bool sceneView = false;
    struct Visual
    {
        std::unique_ptr<tvg::Animation> animation;
        tvg::Picture* picture = nullptr;
        RiseAnimation layout;
        uint32_t version = 0;
        std::vector<uint64_t> appearances;
        Point center;
        float angle = 0;
        double start = 0;
        float frame = -1;
    };
    struct Sprite
    {
        tvg::Scene* paint = nullptr;
        int row = -1;
        bool seen = false;
    };
    struct Figure
    {
        tvg::Scene* paint = nullptr;
        std::string lookKey;
        PersonParts parts;
        int row = -1;
        bool seen = false;
        Point last = {-1, -1};  // Where they stood last frame, for the stride.
        float stride = 0;       // Walking phase, advanced by the distance walked.
        float facing = 1;
        bool striding = false;
    };
    // A light: its glow on the ground, the pool it lifts from the night and the warmth it casts,
    // all wavering together (see flare()).
    struct Pool
    {
        Point center;
        float rx, ry;
        Rgb warmth = {0, 0, 0};  // Colour it casts on walls at night; black casts none.
        Flicker flicker = Flicker::Magic;
        tvg::Paint* glow = nullptr;  // In `lights`, resting at `glowAt`.
        tvg::Paint* halo = nullptr;  // Round a lamp's flame, centred on `flame`.
        Point flame = {};
        tvg::Paint* hole = nullptr;  // Its cut in the night veil and its tint, made by buildDarkness().
        tvg::Paint* tint = nullptr;
        tvg::Matrix glowAt{};
    };
    void addPool(Pool);
    struct Wisp
    {
        Point center;
        Rgb color;
        float radius;
    };
    void resize(float width, float height);
    void rebuild(const Town&, double seconds);
    void buildObjects(const Town&, const Climate&);
    void cullTrees();
    bool buildRoadLights(const Town&, const Traffic&, bool force);
    void buildPreview(const Preview&);
    void syncVisuals(const Town&, double seconds);
    void moveAgents(const Town&, const Traffic&, double seconds, const std::vector<int>& selected);
    void updateFelling(const Town&);
    void animate(const Town&, double seconds);
    void weather(const Climate&, double seconds);
    Camera view;  // Last camera, so rain and snow stay put in the world as the view pans.
    void buildDarkness(const WorldMap&);
    // Who and what sees right now: people, buildings by their light, lanterns on the roads.
    void updateVision(const Town&);
    bool inSight(Point) const;
    void tread(const Town&, double seconds);
    void drift(const Climate&, double seconds);
    void paintOrnaments(const WorldMap&, const Climate&);
    void paintMapName(const WorldMap&, float zoom);
    void updateGroundChunks(const WorldMap&, const Climate&, bool recolor);
    // Stretches the full-view veils (fog, memory, night, sunlight) over just the visible area plus a
    // margin: huge masked or blended shapes break the GL renderer's compositing.
    void fitToView(bool force = false);
    // Slashes, arrows and floating damage numbers for the blows of the last moment.
    void sparkle(const Town&, double seconds);
    // Health bars over buildings monsters have damaged, while in sight.
    void markDamage(const Town&);
    tvg::Shape* damageBack = nullptr;
    tvg::Shape* damageLeft = nullptr;

    tvg::Scene* root;
    tvg::Scene* world;
    tvg::Scene* ground;
    tvg::Scene* farmland;
    tvg::Scene* fog;
    tvg::Scene* roads;
    tvg::Scene* lights;
    tvg::Scene* roadLights = nullptr;
    tvg::Scene* objects;
    tvg::Scene* effects;
    tvg::Scene* overlay;
    tvg::Shape* background;
    tvg::Scene* vignette;
    tvg::Scene* darkness;        // Night over the world, with light pools cut out.
    tvg::Scene* warmth;          // Lamplight tinting walls and ground inside the pools.
    tvg::Scene* memory;          // Dims land explored before but out of sight now.
    tvg::Scene* clouds;          // Cloud shadows drifting over the land on fair days.
    tvg::Scene* sunlight;        // Warm daylight brightening the land; clouds shade it.
    tvg::Scene* ornaments;       // Flat ground details: flowers, ash and snow ripples, cracks. Never above anyone.
    tvg::Scene* combat;          // Hit sparks and damage numbers; never cleared by rebuilds.
    tvg::Scene* prints;          // Footprints in the snow.
    tvg::Shape* overcast;        // Grey of clouds and rain.
    tvg::Shape* precipitation;   // Rain streaks or snowflakes, in the world so panning leaves them put.
    tvg::Scene* mapName = tvg::Scene::gen();  // "MIDGARD", lettered over the land once zoomed out.
    tvg::Scene* storm = tvg::Scene::gen();    // Lightning's flash over everything, and a near strike's bolt.
    std::optional<Strike> strike;
    Point struck;  // Where it struck, in the world.
    void paintStorm(double seconds, float night);
    bool nameDirty = true;                    // Letter it afresh: the map or its terrain changed.
    struct Lettering
    {
        tvg::Text* text;
        tvg::Text* shadow;
        Point at;     // Where the name is centred, projected.
        ui::Rect box; // Its bounds at the size it was set in.
    };
    std::optional<Lettering> lettering;
    tvg::Shape* flame = nullptr;
    tvg::Shape* flameCore = nullptr;
    std::vector<tvg::Paint*> pulses, wispPaints;
    std::array<tvg::Paint*, 2> ymirGlints{};  // His eyes, lit as night falls.
    int ymirRow = -1;
    int fireRow = -1;  // The volcano's draw row, once it is found.
    // A landmark's drawing, kept between rebuilds while its key holds.
    struct Landmark
    {
        tvg::Scene* paint = nullptr;
        uint64_t key = ~0ull;
    };
    // Readies a landmark's paint for `key`: true when it must be drawn afresh into the new, empty scene.
    static bool renew(Landmark&, uint64_t key);
    static void release(Landmark&);
    Landmark ymirPaint, volcanoPaint;
    YmirLight ymirLight;
    VolcanoLight volcanoLight;
    std::vector<tvg::Scene*> rows;  // Per-depth-row holders for moving sprites.
    std::vector<tvg::Scene*> rowBuildings, rowLamps, rowTrees;
    std::vector<uint64_t> treeKeys;
    std::vector<Wisp> wisps;
    std::vector<Pool> pools;
    size_t buildingPools = 0;
    std::vector<Point> lamps;  // Lanterns on road ends and junctions.
    std::vector<Sight> vision;
    // A single bounded image combines explored fog and current sight. GPU work no longer
    // grows with the number of overlapping units or historical exploration circles.
    VisibilityMap exploredVisibility, currentVisibility;
    VisibilityMap figureVisibility;  // Ymir's figure, kept clear of fog for the eye only: shown, not seen.
    std::vector<uint32_t> visibilityPixels;
    tvg::Picture* visibilityPicture = nullptr;
    tvg::Shape* fogBorder = nullptr;
    // Cloud shadows tile the sky; each grid cell keeps its own cluster (see drift()).
    static constexpr float cloudTile = 1150;
    static constexpr int cloudCols = 6, cloudRows = 5;
    std::vector<tvg::Scene*> cloudShapes;
    // The cloudy-day mottle texture: texels, world size of one tile, and how many tiles cover the view.
    static constexpr int mottleTexels = 128, mottleCols = 5, mottleRows = 9;
    static constexpr float mottleTile = 2048;
    tvg::Scene* mottle = nullptr;
    std::vector<tvg::Picture*> mottleTiles;
    uint64_t ornamentLook = ~0ull;
    std::vector<tvg::Shape*> sunPasses;
    tvg::Shape* darkVeil = nullptr;
    float fitted[4] = {};  // Last fitted view rectangle.
    // Weather shown on screen eases toward the sky's state instead of jumping.
    float shownGrey = 0, shownSun = 1, shownShade = 0, shownCloudy = 0, shownWet = 0, fallingIntensity = 0;
    Weather falling = Weather::Rain;
    double weatherAt = -1;
    struct Spark
    {
        Hit hit;
        double shown;
        tvg::Scene* paint;   // Impact and streak.
        tvg::Paint* number;  // Floating damage.
    };
    std::vector<Spark> sparks;
    uint64_t nextSpark = 0;
    struct Print
    {
        Point at;
        double made;
    };
    std::vector<Print> footprints;
    std::map<int, Point> lastStep;
    bool leftFoot = false;
    double printsAt = -1;
    Point firePosition;
    std::map<int, Visual> visuals;
    std::map<int, Sprite> sprites;
    std::map<int, Figure> figures;
    std::map<int, Sprite> beasts;
    int climateKey = -1;
    size_t sightCount = 0;
    double lastAnimate = -1;
    uint64_t revision = 0;
    uint64_t roadRevision = ~uint64_t(0);
    uint64_t appearanceGeneration = 0;
    std::vector<Tinted> groundTints;
    struct GroundChunk
    {
        TileRegion area;
        ui::Rect bounds;
        tvg::Scene* scene;
        tvg::Scene* terrain;
        std::vector<Tinted> tints;
        bool dirty = true;
        bool edited = false;
    };
    std::vector<GroundChunk> groundChunks;
    std::vector<GroundChunk> overviewChunks;
    tvg::Scene* detailedGround = nullptr;
    tvg::Scene* overviewGround = nullptr;
    int groundWidth = 0, groundHeight = 0;
    Preview shownPreview;
    float viewWidth = 0, viewHeight = 0;
    double lastFlicker = -1;
    std::vector<ui::Rect> treeBounds;
    struct FallingTree
    {
        tvg::Scene* paint;
        tvg::Scene* body;
        tvg::Shape* dust;
        Point pivot;
        int row;
        double at;
        float side;
    };
    std::vector<FallingTree> fallingTrees;
    uint64_t seenTreeEvent = 0;
};
}  // namespace hearthold

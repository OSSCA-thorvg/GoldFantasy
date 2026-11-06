#include <test/test.h>
#include <test/graphics.h>
#include <test/directory.h>
#include <game/building_assets.h>
#include <game/world_renderer.h>
#include <bit>
#include <fstream>
#include <memory>
#include <set>

namespace
{
using namespace hearthold;
struct Baseline { const char* id; std::vector<uint64_t> hashes; };
// Field-wise float-bit hashes exported from the original procedural generator.
const Baseline baselines[]{
    {"camp", {14723072794805724544ull}},
    {"tent", {16958340147884291049ull, 13288319071205873129ull, 6520273131713181545ull, 4851666627315632814ull, 981535965218256238ull, 2912506213917061870ull, 6520273131713181545ull, 13967827242182398249ull, 16958340147884291049ull, 2912506213917061870ull, 4376924423930149486ull, 4851666627315632814ull}},
    {"cottage", {4548226850793499556ull, 5295797513880218856ull, 11185231121956557700ull, 17604813775170772031ull, 16290559530045274995ull, 1036763488462938975ull}},
    {"townhouse", {7720915723133317013ull, 15877812676279142265ull, 16739046186902628661ull, 5385115034060966002ull, 2639848980772551526ull, 13880385879571904914ull}},
    {"manor", {11772215747758820767ull, 13416723154846570365ull, 7409486161259486431ull, 12637522495388379661ull, 3251034772588582639ull, 12821417662032836557ull}},
    {"market-stalls", {7118920899317351816ull, 3876984891496886156ull, 7190955806290265202ull, 83520455188681268ull}},
    {"market-hall", {4612313240569705919ull, 6764118907040707451ull, 18268437908714135717ull, 8705334187411751879ull, 15662395731103251683ull, 12177214698858497087ull, 11034664830513366149ull, 14477959070134060787ull, 12763795406844533087ull, 11663137071236128159ull, 4915914979046374313ull, 10901894882131983207ull}},
    {"bazaar", {10757372065656819372ull, 8369142466877278144ull, 18163834704945141506ull, 9098480728757722402ull}},
    {"farm", {3414806865810213126ull}},
    {"lumberyard", {13012458117161697267ull}},
    {"quarry", {33045207381525217ull}},
    {"well", {16856358228233885252ull}},
    {"storehouse", {10257023127082907754ull}},
    {"shrine", {7830895373984847854ull}},
    {"mage-tower", {9088223528704480098ull}},
    {"portal", {6584603768462382724ull}},
    {"tavern", {18149924666745295697ull, 4815092217652738605ull, 5471924364007708017ull}},
    {"hostel", {2851833972189097664ull, 4307820830983916352ull, 5209815471622426816ull, 5225280062068198656ull}},
    {"inn", {13650798361204534044ull, 18244381669492003928ull, 1685668899614682492ull}},
    {"grand-inn", {12365058599604911806ull, 6592810053729891074ull, 448967652153538398ull}},
    {"guild", {17127411336793763775ull}},
    {"guild-hall", {10403579329535355350ull}},
    {"chapel", {568228238062293605ull, 9589158066508823523ull, 10522744430257335269ull, 720994151698281547ull}},
    {"weaponsmith", {2089558074384774082ull, 9064231212364380238ull, 6155807685172474594ull}},
    {"armorer", {6356749387598090416ull, 6130096996599098052ull, 2761960910598321616ull}},
    {"apothecary", {7667596651053946426ull, 14360685156772522958ull, 11486291924746038938ull}},
    {"palisade", {13164315010723467103ull, 13401016286912992709ull}},
    {"keep", {10770713590239492666ull, 10116160776295380332ull}},
    {"castle", {1228110440861451498ull, 1312196281822383546ull}},
};
struct Digest
{
    uint64_t value = 14695981039346656037ull;
    void add(uint32_t x) { for (int i=0;i<4;++i) { value ^= (x >> (i*8)) & 255; value *= 1099511628211ull; } }
    void add(float x) { add(std::bit_cast<uint32_t>(x)); }
    void add(Rgb c) { add(uint32_t(c.r)); add(uint32_t(c.g)); add(uint32_t(c.b)); }
    uint64_t model(const Model& m)
    {
        add(uint32_t(m.patches.size())); add(uint32_t(m.blocks.size()));
        for (auto& p : m.patches) { add(p.x0); add(p.y0); add(p.x1); add(p.y1); add(p.color); add(uint32_t(p.furrows)); add(p.furrow); add(p.delay); }
        for (auto& b : m.blocks) {
            add(b.x0); add(b.y0); add(b.x1); add(b.y1); add(b.wall); add(b.roof); add(uint32_t(b.shape));
            add(b.wallLit); add(b.wallShade); add(b.roofLit); add(b.roofShade); add(b.base); add(b.delay);
            add(uint32_t(b.windows)); add(uint32_t(b.door)); add(uint32_t(b.trim)); add(b.glass); add(uint32_t(b.ornament)); add(b.accent);
        }
        return value;
    }
};
struct CatalogRestore
{
    CatalogRestore() { std::string error; CHECK(loadDefaultBuildingAssets({}, error)); }
    ~CatalogRestore() { std::string error; CHECK(loadDefaultBuildingAssets({}, error)); }
};
void collectPictures(const tvg::Paint* paint, std::set<const tvg::Paint*>& pictures)
{
    if (paint->type() == tvg::Type::Picture) pictures.insert(paint);
    if (paint->type() == tvg::Type::Scene)
        for (auto child : static_cast<const tvg::Scene*>(paint)->paints()) collectPictures(child, pictures);
}
std::set<const tvg::Paint*> pictures(const WorldRenderer& renderer)
{
    std::set<const tvg::Paint*> result; collectPictures(renderer.scene(), result); return result;
}
}

TEST(game_building_assets_preserve_all_29_designs_and_93_variant_slots)
{
    CatalogRestore restore;
    CHECK_EQ(std::size(baselines), size_t(Structure::Count));
    size_t total = 0;
    for (size_t i = 0; i < std::size(baselines); ++i) {
        auto kind = Structure(i); const auto& original = baselines[i];
        const auto& asset = buildingAsset(kind);
        CHECK_EQ(asset.id, std::string(original.id));
        CHECK_EQ(asset.variants.size(), original.hashes.size());
        CHECK_EQ(asset.footprint, float(structureSpec(kind).size));
        for (size_t slot = 0; slot < asset.variants.size(); ++slot) {
            CHECK_EQ(Digest{}.model(asset.variants[slot]), original.hashes[slot]);
            CHECK(structureModel(kind, uint32_t(slot)) == asset.variants[slot]);
            ++total;
        }
        for (auto seed : {0u, 17u, 999999u, UINT32_MAX})
            CHECK_EQ(Digest{}.model(structureModel(kind, seed)), original.hashes[seed % original.hashes.size()]);
        gameframework::BuildingAsset decoded; std::string error;
        CHECK(gameframework::decodeBuildingAsset(gameframework::encodeBuildingAsset(asset), decoded, error));
        CHECK(decoded == asset);
    }
    CHECK_EQ(total, size_t(93));
}

TEST(game_building_asset_apply_and_whole_catalog_reload_are_transactional)
{
    CatalogRestore restore;
    auto original = buildingAsset(Structure::Cottage), changed = original;
    auto generation = buildingCatalogGeneration(), revision = buildingAppearanceRevision(Structure::Cottage);
    auto other = buildingAppearanceRevision(Structure::Tent);
    std::string error;
    changed.footprint += 1; CHECK(!applyBuildingAsset(changed, error));
    changed = original; changed.id = "unknown-building"; CHECK(!applyBuildingAsset(changed, error));
    changed = original; changed.variants.pop_back(); CHECK(!applyBuildingAsset(changed, error));
    CHECK(!applyBuildingAsset("{broken", error));
    CHECK_EQ(buildingCatalogGeneration(), generation); CHECK_EQ(buildingAppearanceRevision(Structure::Cottage), revision);
    CHECK(buildingAsset(Structure::Cottage) == original);
    changed = original; changed.variants[0].blocks[0].wallLit = {255,0,0};
    CHECK(applyBuildingAsset(gameframework::encodeBuildingAsset(changed), error));
    CHECK_EQ(buildingCatalogGeneration(), generation + 1); CHECK_EQ(buildingAppearanceRevision(Structure::Cottage), revision + 1);
    CHECK_EQ(buildingAppearanceRevision(Structure::Tent), other);
    CHECK(applyBuildingAsset(changed, error)); CHECK_EQ(buildingCatalogGeneration(), generation + 1);
    te::test::Directory directory;
    for (int i = 0; i < int(Structure::Count); ++i) {
        auto asset = buildingAsset(Structure(i));
        std::ofstream(directory.path / (asset.id + ".json")) << gameframework::encodeBuildingAsset(asset);
    }
    std::ofstream(directory.file("castle.json")) << "{}";
    CHECK(!loadBuildingAssets(directory.path, error));
    CHECK_EQ(buildingCatalogGeneration(), generation + 1); CHECK(buildingAsset(Structure::Cottage) == changed);
    auto castle = buildingAsset(Structure::Castle);
    std::ofstream(directory.file("castle.json")) << gameframework::encodeBuildingAsset(castle);
    CHECK(loadBuildingAssets(directory.path, error));
    CHECK(buildingAssetPath(Structure::Camp).parent_path() == directory.path);
    std::ofstream(directory.file("camp.json")) << "{broken";
    CHECK(!reloadBuildingAssets(error)); CHECK(buildingAsset(Structure::Cottage) == changed);
}

TEST(game_building_asset_reload_updates_only_affected_retained_visuals_without_replaying)
{
    CatalogRestore restore;
    te::test::Graphics runtime(false);
    Town town(5); auto camp = town.map().camp(); town.scout(camp.x,camp.y,10);
    CHECK(town.place(Structure::Camp,camp,0)); town.completeConstruction();
    Traffic traffic(5); WorldRenderer renderer; Camera camera;
    renderer.update(town,traffic,camera,800,600,0,{});
    CHECK(renderer.animating());
    renderer.update(town,traffic,camera,800,600,10,{});
    CHECK(!renderer.animating());
    auto before = pictures(renderer); CHECK(!before.empty());
    auto townRevision = town.revision();
    std::string error;
    auto tent = buildingAsset(Structure::Tent); tent.variants[0].blocks[0].roofLit = {255,0,0};
    CHECK(applyBuildingAsset(tent,error));
    renderer.update(town,traffic,camera,800,600,10,{});
    CHECK(pictures(renderer) == before); CHECK(!renderer.animating());
    auto asset = buildingAsset(Structure::Camp); asset.variants[0].blocks[0].roofLit = {0,255,0};
    asset.variants[0].blocks[0].delay = 60;
    CHECK(applyBuildingAsset(asset,error));
    renderer.update(town,traffic,camera,800,600,10,{});
    CHECK(pictures(renderer) != before); CHECK(!renderer.animating());
    CHECK_EQ(town.revision(),townRevision);
}

TEST(game_building_asset_reload_retains_normalized_construction_animation_frame)
{
    CatalogRestore restore;
    te::test::Graphics runtime(false);
    Town town(5); auto camp = town.map().camp(); town.scout(camp.x,camp.y,10);
    CHECK(town.place(Structure::Camp,camp,0)); town.completeConstruction();
    Traffic traffic(5); WorldRenderer renderer; Camera camera;
    renderer.update(town,traffic,camera,800,600,0,{});
    renderer.update(town,traffic,camera,800,600,1,{});
    auto previous = pictures(renderer);
    auto old = riseAnimation(Structure::Camp,0);
    auto asset = buildingAsset(Structure::Camp); asset.variants[0].blocks[0].delay = 20;
    std::string error; CHECK(applyBuildingAsset(asset,error));
    renderer.update(town,traffic,camera,800,600,1,{});
    // The world also owns retained raster pictures for cloud textures. Only the
    // edited building's animation is replaced by an appearance-only update.
    std::set<const tvg::Paint*> current;
    for (auto picture : pictures(renderer)) if (!previous.contains(picture)) current.insert(picture);
    CHECK_EQ(current.size(),size_t(1));
    if (current.size() != 1) return;
    auto layout = riseAnimation(Structure::Camp,0);
    std::unique_ptr<tvg::Animation> expected(tvg::Animation::gen());
    CHECK(expected->picture()->load(layout.json.data(),uint32_t(layout.json.size()),"lottie+json",nullptr,true) == tvg::Result::Success);
    CHECK(expected->frame(30.f / old.frames * layout.frames) == tvg::Result::Success);
    auto raster = [](const tvg::Paint* source) {
        constexpr int side = 256;
        std::vector<uint32_t> pixels(side*side);
        std::unique_ptr<tvg::SwCanvas> canvas(tvg::SwCanvas::gen(tvg::EngineOption::Default));
        CHECK(canvas->target(pixels.data(),side,side,side,tvg::ColorSpace::ARGB8888) == tvg::Result::Success);
        auto copy = source->duplicate(); copy->transform({1,0,0,0,1,0,0,0,1});
        CHECK(canvas->add(copy) == tvg::Result::Success);
        CHECK(canvas->draw(true) == tvg::Result::Success); CHECK(canvas->sync() == tvg::Result::Success);
        return pixels;
    };
    CHECK(raster(*current.begin()) == raster(expected->picture()));
    CHECK(renderer.animating());
}

#include <test/test.h>
#include <test/graphics.h>
#include <game/character_assets.h>
#include <game/character_preset.h>
#include <game/game_app.h>
#include <game/person_portrait.h>
#include <game/world_sprites.h>
#include <algorithm>
#include <cmath>
#include <memory>

namespace
{
using namespace hearthold;
Person person(){return {7,"Rowan",Role::Resident,Calling::Settler,Race::Human,4242,{}, {}};}
std::vector<uint32_t> raster(tvg::Paint* paint,int width=320,int height=320)
{
    std::vector<uint32_t> pixels(size_t(width)*height);
    std::unique_ptr<tvg::SwCanvas> canvas(tvg::SwCanvas::gen());
    CHECK(canvas->target(pixels.data(),width,width,height,tvg::ColorSpace::ARGB8888)==tvg::Result::Success);
    CHECK(canvas->add(paint)==tvg::Result::Success);
    CHECK(canvas->draw(true)==tvg::Result::Success);CHECK(canvas->sync()==tvg::Result::Success);
    return pixels;
}
std::vector<uint32_t> head(const Appearance& a){auto image=characterHead(a);image->scale(20);image->translate(160,130);return raster(image);}
std::vector<uint32_t> outfit(const Appearance& a){auto image=characterOutfit(a);image->scale(7);image->translate(160,20);return raster(image);}
std::vector<uint32_t> portraitPixels(tvg::Paint* paint,ui::Rect panel)
{
    auto pixels=raster(paint,1280,800);std::vector<uint32_t> result;
    for(int y=int(panel.y)+17;y<int(panel.y)+91;++y)for(int x=int(panel.x)+17;x<int(panel.x)+87;++x)result.push_back(pixels[size_t(y)*1280+x]);
    return result;
}
bool text(const tvg::Paint* paint,std::string_view expected)
{
    if(paint->type()==tvg::Type::Text){auto value=static_cast<const tvg::Text*>(paint)->text();return value&&std::string_view(value).find(expected)!=std::string_view::npos;}
    if(paint->type()==tvg::Type::Scene)for(auto child:static_cast<const tvg::Scene*>(paint)->paints())if(text(child,expected))return true;
    return false;
}
}  // namespace

TEST(game_character_assets_render_all_enabled_heads_and_whole_outfits)
{
    te::test::Graphics runtime;auto a=appearanceOf(person());
    std::vector<std::vector<uint32_t>> seen;
    for(int i=0;i<hairAssetCount;++i)if(characterAssetReady(i)){
        useCharacterReference(a,i);
        auto image=head(a);
        CHECK(std::count_if(image.begin(),image.end(),[](uint32_t p){return (p>>24)>128;})>3000);
        for(auto& previous:seen)CHECK(previous!=image);
        seen.push_back(std::move(image));
        auto bounds=characterHeadBounds(a);CHECK(std::isfinite(bounds.left)&&std::isfinite(bounds.top));CHECK(bounds.right>bounds.left);
    }
    seen.clear();
    for(int i=0;i<outfitAssetCount;++i)if(characterOutfitReady(i)){a.outfitAsset=uint8_t(i);auto image=outfit(a);for(auto& previous:seen)CHECK(previous!=image);seen.push_back(std::move(image));}
    CHECK_EQ(seen.size(),size_t(13));
}

TEST(game_character_assets_share_one_eye_topology_and_interpolate_its_reference_controls)
{
    auto a=appearanceOf(person());a.portraitEyeForm=PortraitEyeForm::Reference;a.eyeRoundness=0;a.eyeOpenness=1;a.lidDrop=0;
    for(int i=0;i<referenceHeadCount;++i){
        a.eyeReference=uint8_t(i);auto original=characterEyePath(a);
        a.eyeRoundness=1;auto round=characterEyePath(a);
        a.eyeRoundness=.5f;auto half=characterEyePath(a);
        for(size_t j=0;j<half.size();++j){CHECK(distance(half[j],lerp(original[j],round[j],.5f))<.0001f);CHECK(std::isfinite(half[j].x)&&std::isfinite(half[j].y));}
        a.eyeRoundness=0;
    }
}

TEST(game_character_hair_has_a_solid_back_layer_behind_the_face)
{
    te::test::Graphics runtime;auto a=appearanceOf(person());
    for(int i:{8,9,10,11,12}) {
        a.hairAsset=uint8_t(i);setCharacterHeadBase(a,0);
        auto back=characterHair(a,false);back->scale(20);back->translate(160,130);
        auto pixels=raster(back);
        for(int y=110;y<=145;y+=5)for(int x=145;x<=175;x+=5)
            CHECK((pixels[size_t(y)*320+x]>>24)>240);
    }
}

TEST(game_character_face_is_complete_and_independent_of_the_selected_wig)
{
    te::test::Graphics runtime;auto a=appearanceOf(person());a.faceAsset=0;a.hairAsset=19;
    auto face=[&] {auto image=characterFace(a);image->scale(20);image->translate(160,130);return raster(image);};
    auto before=face();
    for(int hair:{8,9,10,11,12}) {a.hairAsset=uint8_t(hair);CHECK(face()==before);}
}

TEST(game_character_hair_keeps_its_shape_when_only_the_lower_jaw_changes)
{
    auto a=appearanceOf(person());a.faceWidth=.5f;a.jawWidth=a.chinLength=1;a.cheekFullness=.5f;a.faceBlend=0;
    for(int hair:{8,9,10,11,12}) {
        a.hairAsset=uint8_t(hair);setCharacterHeadBase(a,0);HairFit before(a);
        auto edited=a;edited.jawWidth=1.25f;edited.chinLength=1.2f;edited.cheekFullness=1;
        HairFit after(edited);
        for(auto p:{Point{-3,2},Point{3,2},Point{-4,9},Point{4,15},Point{0,-3}})
            CHECK(distance(before.map(p),after.map(p))<.001f);
    }
}

TEST(game_character_ears_are_separate_assets_and_do_not_deform_the_skull_or_hair)
{
    te::test::Graphics runtime;auto a=appearanceOf(person());a.hairAsset=9;a.earAsset=0;
    auto pixels=[&](auto build){auto paint=build(a);paint->scale(20);paint->translate(160,130);return raster(paint);};
    auto face=pixels(characterFace),hair=pixels([](auto look){return characterHair(look,true);}),ears=pixels(characterEars);
    a.earAsset=12;a.earScale=1.3f;a.earHeight=-.4f;
    CHECK(pixels(characterEars)!=ears);CHECK(pixels(characterFace)==face);
    CHECK(pixels([](auto look){return characterHair(look,true);})==hair);
}

TEST(game_character_long_locks_preserve_local_width_length_and_angles_under_skinning)
{
    auto a=appearanceOf(person());a.faceWidth=1.35f;
    for(int hair:{1,6,8,9,10,11,12})for(int face:{0,1,2,3}) {
        a.hairAsset=uint8_t(hair);setCharacterHeadBase(a,face%4);HairFit fit(a);
        for(float side:{-1.f,1.f}) {
            auto p=fit.map({side*8,7}),vertical=fit.map({side*8,15})-p,horizontal=fit.map({side*9,7})-p;
            CHECK(distance(vertical,{0,8})<.001f);CHECK(distance(horizontal,{side,0})<.001f);
        }
    }
}

TEST(game_character_hair_crown_stays_attached_to_the_independent_cranium)
{
    auto a=appearanceOf(person());a.faceWidth=.5f;
    for(int hair:{8,9,10,11,12})for(int face:{0,1,2,3}) {
        a.hairAsset=uint8_t(hair);setCharacterHeadBase(a,face%4);HairFit fit(a);
        CHECK(distance(fit.map({0,-3.2f}),characterCranium(a).crown)<.001f);
    }
}

TEST(game_character_assets_hair_skinning_preserves_the_source_at_rest_and_stays_finite)
{
    auto a=appearanceOf(person());a.faceWidth=.5f;a.jawWidth=a.chinLength=1;a.cheekFullness=.5f;a.faceBlend=0;
    for(int i=0;i<referenceHeadCount;++i){
        a.hairAsset=uint8_t(i);setCharacterHeadBase(a,i);HairFit rest(a);
        for(auto p:{Point{0,0},Point{-3,-2},Point{3,2},Point{-5,12},Point{4,17}})CHECK(distance(rest.map(p),p)<.0001f);
        for(int variant=0;variant<3;++variant){
            auto edited=a;edited.faceWidth=variant==0?-.35f:1.35f;edited.jawWidth=variant==2?1.25f:.85f;edited.chinLength=variant==1?1.2f:.8f;
            setCharacterHeadBase(edited,(i+variant)%faceBaseCount);edited.scalpWidth=variant==0?.88f:1.12f;HairFit fit(edited);
            for(float y=-4;y<=12;y+=2)for(float x=-5;x<=5;x+=2){auto at=fit.map({x,y});CHECK(std::isfinite(at.x)&&std::isfinite(at.y));}
        }
    }
}

TEST(game_character_eye_interpolation_keeps_each_curve_monotone_without_corner_hooks)
{
    auto a=appearanceOf(person());
    for(int reference=0;reference<referenceHeadCount;++reference)
        for(float blend:{0.f,.5f,1.f})for(float openness:{.1f,1.f,1.4f})for(float drop:{0.f,1.f}) {
            a.eyeReference=uint8_t(reference);a.eyeRoundness=blend;a.eyeOpenness=openness;a.lidDrop=drop;
            auto points=characterEyePath(a);
            CHECK(distance(points.front(),points.back())<.0001f);
            for(int quarter=0;quarter<4;++quarter) {
                auto begin=points[size_t(quarter*3)],end=points[size_t(quarter*3+3)];
                for(int handle=1;handle<=2;++handle) {
                    auto p=points[size_t(quarter*3+handle)];
                    CHECK(p.x>=std::min(begin.x,end.x)-.0001f&&p.x<=std::max(begin.x,end.x)+.0001f);
                    CHECK(p.y>=std::min(begin.y,end.y)-.0001f&&p.y<=std::max(begin.y,end.y)+.0001f);
                }
            }
        }
}

TEST(game_character_wigs_do_not_fold_when_transferred_between_reference_faces)
{
    auto a=appearanceOf(person());a.faceWidth=.5f;a.jawWidth=a.chinLength=1;a.cheekFullness=.5f;a.faceBlend=0;
    for(int hair=0;hair<referenceHeadCount;++hair)for(int face=0;face<faceBaseCount;++face)for(float width:{.88f,1.f,1.12f}) {
        a.hairAsset=uint8_t(hair);setCharacterHeadBase(a,face%4);a.scalpWidth=width;a.scalpHeight=2-width;a.foreheadShift=width<1?-.2f:width>1?.2f:0;a.templeWidth=width<1?.94f:width>1?1.06f:1;HairFit fit(a);float minimum=10;
        for(float y=-8;y<=32;y+=1)for(float x=-12;x<=12;x+=1) {
            auto p=fit.map({x,y}),dx=(fit.map({x+.01f,y})-p)*100,dy=(fit.map({x,y+.01f})-p)*100;
            minimum=std::min(minimum,dx.x*dy.y-dx.y*dy.x);
        }
        if(minimum<=.05f)std::cerr<<"wig "<<hair<<" / face "<<face<<" minimum Jacobian "<<minimum<<'\n';
        CHECK(minimum>.05f);
    }
}

TEST(game_character_assets_face_variations_preserve_the_whole_outfit_and_outfit_swaps_preserve_the_head)
{
    te::test::Graphics runtime;auto a=appearanceOf(person());a.outfitAsset=4;
    auto body=outfit(a);
    for(int i=0;i<referenceHeadCount;++i){auto edited=a;edited.faceAsset=edited.hairAsset=edited.eyeReference=uint8_t(i);edited.faceWidth=1.1f;edited.chinLength=1.15f;CHECK(outfit(edited)==body);}
    auto face=head(a);
    for(int i=0;i<outfitAssetCount;++i){auto edited=a;edited.outfitAsset=uint8_t(i);CHECK(head(edited)==face);}
}

TEST(game_character_assets_species_is_independent_of_the_character_visuals)
{
    te::test::Graphics runtime;
    auto human=person(),god=human;god.race=Race::God;
    CHECK_EQ(raceCount,2);CHECK_EQ(raceName(Race::Human),std::string("Human"));CHECK_EQ(raceName(Race::God),std::string("God"));
    CHECK(head(appearanceOf(human))==head(appearanceOf(god)));
    CHECK(outfit(appearanceOf(human))==outfit(appearanceOf(god)));
    auto preset=characterPreset(human);auto before=head(preset.look);preset.race=Race::God;CHECK(applyCharacter(human,preset));CHECK(head(appearanceOf(human))==before);
}

TEST(game_character_assets_eye_and_mouth_parameters_change_the_static_face)
{
    te::test::Graphics runtime;auto a=appearanceOf(person());useCharacterReference(a,0);a.portraitEyeKind=PortraitEyeKind::Open;a.eyeOutline=true;
    auto baseline=head(a);
    for(int i=0;i<6;++i){auto edited=a;
        if(i==0)edited.eyeOpenness=.4f;
        if(i==1)edited.eyeStroke=1.8f;
        if(i==2)edited.eyeGap=10.5f;
        if(i==3)edited.mouthCurve=1;
        if(i==4)edited.chinLength=1.2f;
        if(i==5)edited.faceWidth=1.35f;
        CHECK(head(edited)!=baseline);
    }
}

TEST(game_character_portraits_remain_static_through_time_and_world_speech)
{
    te::test::Graphics runtime;GameApp game(5);game.togglePause();int id=game.state().people().front().id;game.selectPeople({id});
    game.render(1280,800,0);auto panel=game.contextPanelBounds();auto before=portraitPixels(game.hudScene()->duplicate(),panel);
    CHECK(std::count_if(before.begin(),before.end(),[&](uint32_t p){return p!=before.front();})>80);
    CHECK(game.sayPerson(id,"Attack!"));
    for(double t:{.2,.7,1.5,7.0,20.0}){game.render(1280,800,t);CHECK(portraitPixels(game.hudScene()->duplicate(),panel)==before);}
}

#if HEARTHOLD_WITH_EDITOR
TEST(game_character_studio_has_static_asset_controls_and_no_profile_animation_controls)
{
    te::test::Graphics runtime;GameApp game(5);game.openCharacterEditor();game.render(1280,800,0);
    CHECK(text(game.hudScene(),"STATIC PREVIEW"));CHECK(!text(game.hudScene(),"Motion:"));CHECK(!text(game.hudScene(),"Voice:"));CHECK(!text(game.hudScene(),"Speak"));
    CHECK(game.nextFrameDelay()>=.09);
}

TEST(game_character_studio_hair_changes_keep_the_copied_body_at_the_same_scale_and_feet)
{
    te::test::Graphics runtime;GameApp game(5);game.openCharacterEditor();
    auto preset=game.characterEditor()->current();preset.look.faceAsset=preset.look.eyeReference=0;
    preset.look.outfitAsset=0;preset.look.hairAsset=0;game.characterEditor()->setPreset(preset);
    auto legs=[&] {
        game.render(1280,800,0);auto pixels=raster(game.hudScene()->duplicate(),1280,800);std::vector<uint32_t> crop;
        for(int y=480;y<555;++y)for(int x=694;x<718;++x) {
            auto p=pixels[size_t(y)*1280+x];
            crop.push_back((p&255)>245&&((p>>8)&255)>245&&((p>>16)&255)>245?1:0);
        }
        return crop;
    };
    auto before=legs();
    CHECK(std::count(before.begin(),before.end(),1)>30);
    for(int hair:{8,9,10,11,12}) {preset.look.hairAsset=uint8_t(hair);game.characterEditor()->setPreset(preset);CHECK(legs()==before);}
}
#endif

TEST(game_character_upper_cranium_changes_hair_but_chin_base_does_not)
{
    te::test::Graphics runtime;auto a=appearanceOf(person());a.faceAsset=a.scalpAsset=0;a.hairAsset=13;
    auto pixels=[&]{auto s=characterHair(a,true);s->scale(20);s->translate(160,130);return raster(s);};
    auto round=pixels();a.faceAsset=1;CHECK(pixels()==round);
    a.scalpHeight=1.1f;CHECK(pixels()!=round);
}

TEST(game_character_restored_whole_face_width_updates_the_scalp)
{
    auto a=appearanceOf(person());a.scalpAsset=0;a.faceWidth=.5f;HairFit before(a);
    a.faceWidth=1.35f;HairFit after(a);
    for(auto p:{Point{-3,-2},Point{3,-2},Point{4,9}})CHECK(distance(before.map(p),after.map(p))>.01f);
}

TEST(game_character_jaw_base_preserves_every_hair_layer_and_ear_attachment)
{
    te::test::Graphics runtime;auto a=appearanceOf(person());setCharacterHeadBase(a,0);
    auto part=[&](HairPart which){auto p=characterHairPart(a,which);p->scale(20);p->translate(160,130);return raster(p);};
    for(int hair:{8,9,10,11,12,16}) {
        a.hairAsset=uint8_t(hair);a.faceAsset=0;auto ears=characterEarRoots(a);
        std::array<std::vector<uint32_t>,4> original;
        for(int i=0;i<4;++i)original[size_t(i)]=part(HairPart(i));
        a.faceAsset=1;a.jawWidth=1.2f;a.chinLength=1.15f;
        for(int i=0;i<4;++i)CHECK(part(HairPart(i))==original[size_t(i)]);
        for(int i=0;i<2;++i)CHECK(distance(characterEarRoots(a)[size_t(i)],ears[size_t(i)])<.00001f);
    }
}

TEST(game_character_tied_accents_keep_dimensions_across_the_centre_line)
{
    te::test::Graphics runtime;
    auto a=appearanceOf(person());setCharacterHeadBase(a,2);a.scalpWidth=1.12f;a.scalpHeight=.88f;HairFit fit(a);
    Point root{0,-3.3f};auto left=fit.rigid({-1,-5},root),right=fit.rigid({1,-5},root),bottom=fit.rigid({0,-4},root);
    CHECK(distance(right-left,{2,0})<.00001f);CHECK(distance(bottom-left,{1,1})<.00001f);
    useCharacterReference(a,16);
    auto size=[&]{
        auto p=characterHairPart(a,HairPart::Tied);p->scale(20);p->translate(160,160);auto pixels=raster(p);
        int left=320,right=-1,top=320,bottom=-1;
        for(int y=0;y<320;++y)for(int x=0;x<320;++x)if((pixels[size_t(y)*320+x]>>24)>200){left=std::min(left,x);right=std::max(right,x);top=std::min(top,y);bottom=std::max(bottom,y);}
        return Point{float(right-left+1),float(bottom-top+1)};
    };
    auto original=size();CHECK(original.x>20&&original.y>20);
    for(int face:{22,24,21}){setCharacterHeadBase(a,face);a.scalpWidth=1.12f;a.scalpHeight=.88f;CHECK(distance(size(),original)<1.5f);}
}

TEST(game_character_rear_hair_does_not_duplicate_the_front_bun_above_the_scalp)
{
    te::test::Graphics runtime;
    for(int face:{16,22,24,21}) {
        auto a=appearanceOf(person());useCharacterReference(a,16);setCharacterHeadBase(a,face);
        a.scalpWidth=1.12f;a.scalpHeight=.88f;
        auto p=characterHair(a,false);p->scale(20);p->translate(160,160);auto pixels=raster(p);
        int aboveCrown=0,stop=int(160+characterCranium(a).crown.y*20)-2;
        for(int y=0;y<stop;++y)for(int x=0;x<320;++x)if((pixels[size_t(y)*320+x]>>24)>128)++aboveCrown;
        CHECK_EQ(aboveCrown,0);
    }
}

TEST(game_character_legacy_component_overrides_do_not_break_the_whole_hairstyle)
{
    te::test::Graphics runtime;auto a=appearanceOf(person());a.hairAsset=0;
    auto pixels=[&](HairPart p){auto s=characterHairPart(a,p);s->scale(20);s->translate(160,130);return raster(s);};
    auto cap=pixels(HairPart::Cap),back=pixels(HairPart::Back),body=outfit(a),front=pixels(HairPart::Fringe);
    a.hairCap=16;a.hairFringe=8;a.hairBack=12;a.hairTied=18;
    CHECK(pixels(HairPart::Cap)==cap);CHECK(pixels(HairPart::Back)==back);CHECK(outfit(a)==body);CHECK(pixels(HairPart::Fringe)==front);
    a.hairFringe=19;CHECK(pixels(HairPart::Fringe)==front);
}

TEST(game_character_curtain_fitting_preserves_lobe_proportions)
{
    auto a=appearanceOf(person());setCharacterHeadBase(a,2);a.scalpHeight=.88f;HairFit fit(a);
    Point p{-2,-2},q{-3,0},r{-1,-2};
    float longScale=distance(fit.fringe(p),fit.fringe(q))/distance(p,q);
    float shortScale=distance(fit.fringe(p),fit.fringe(r))/distance(p,r);
    CHECK(std::abs(longScale-shortScale)<.00001f);
    auto before=characterEyePath(a);setCharacterHeadBase(a,1);auto after=characterEyePath(a);
    for(size_t i=0;i<before.size();++i)CHECK(distance(before[i],after[i])<.00001f);
}

TEST(game_character_bob_and_elf_rear_interiors_cover_the_nape)
{
    te::test::Graphics runtime;auto a=appearanceOf(person());setCharacterHeadBase(a,0);
    for(int hair:{8,49}) {
        a.hairAsset=uint8_t(hair);auto p=characterHairPart(a,HairPart::Back);p->scale(20);p->translate(160,130);
        auto pixels=raster(p);CHECK((pixels[162*320+160]>>24)>240);
    }
}

TEST(game_character_default_dot_eyes_have_no_sclera_and_scale_independently_of_brows)
{
    te::test::Graphics runtime;auto a=appearanceOf(person());useCharacterReference(a,0);a.browVisible=true;
    auto layer=[&](auto build){auto p=build(a);p->scale(30);p->translate(160,140);return raster(p);};
    CHECK(a.portraitEyeKind==PortraitEyeKind::Dots);CHECK(!a.eyeOutline);
    auto dots=layer(characterEyes),brows=layer(characterBrows);int opaque=0;
    for(auto p:dots)if((p>>24)>245){++opaque;CHECK(((p>>16)&255)<80);}
    CHECK(opaque>10);a.eyeSize=2;CHECK(layer(characterEyes)!=dots);CHECK(layer(characterBrows)==brows);
    a.eyeReference=12;a.eyeGap=10.5f;a.eyeLevel=.35f;CHECK(layer(characterBrows)==brows);
    auto bigger=layer(characterEyes);a.browTilt=.5f;a.browHeight=.4f;CHECK(layer(characterEyes)==bigger);CHECK(layer(characterBrows)!=brows);
}

TEST(game_character_open_eye_shape_outline_and_pupils_are_independent_controls)
{
    te::test::Graphics runtime;auto a=appearanceOf(person());useCharacterReference(a,0);a.portraitEyeKind=PortraitEyeKind::Open;
    auto pixels=[&]{auto p=characterEyes(a);p->scale(35);p->translate(160,140);return raster(p);};auto initial=pixels();
    CHECK(std::count_if(initial.begin(),initial.end(),[](uint32_t p){return (p>>24)>245&&((p>>16)&255)>240;})>20);
    for(int i=0;i<7;++i){auto edit=a;if(i==0)edit.eyeOutline=true;if(i==1)edit.eyeSize=.55f;if(i==2)edit.eyeWidth=.5f;if(i==3)edit.eyeHeight=.5f;if(i==4)edit.pupilHeight=.7f;if(i==5)edit.pupilY=.4f;if(i==6)edit.portraitEyeForm=PortraitEyeForm::HalfLid;std::swap(a,edit);CHECK(pixels()!=initial);std::swap(a,edit);}
}

TEST(game_character_default_open_eyes_keep_a_gap_on_a_narrow_cranium)
{
    te::test::Graphics runtime;auto a=appearanceOf(person());useCharacterReference(a,49);setCharacterHeadBase(a,22);
    auto p=characterEyes(a);p->scale(20);p->translate(160,130);auto pixels=raster(p);
    int crossing=0;for(int y=0;y<280;++y)for(int x:{159,160})if((pixels[size_t(y)*320+x]>>24)>128)++crossing;
    CHECK_EQ(crossing,0);
}

TEST(game_character_eye_extremes_stay_inside_the_actual_face_and_keep_a_centre_gap)
{
    te::test::Graphics runtime;
    for(int face=0;face<faceBaseCount;++face)for(auto kind:{PortraitEyeKind::Dots,PortraitEyeKind::Open})for(int form=0;form<4;++form)for(int variant=0;variant<3;++variant) {
        auto a=appearanceOf(person());useCharacterReference(a,49);setCharacterHeadBase(a,face);a.portraitEyeKind=kind;
        a.portraitEyeForm=PortraitEyeForm(form);a.eyeSize=2.5f;a.eyeWidth=1.8f;a.eyeHeight=1.8f;a.eyeOpenness=1.4f;a.eyeStroke=2;a.eyeOutline=true;
        a.eyeGap=variant==0?6.f:12.f;a.eyeLevel=variant==0?-.7f:.7f;a.eyeTilt=(variant-1)*.45f;
        a.jawWidth=variant==0?.65f:1.35f;a.chinLength=variant==1?.65f:1.5f;
        a.faceWidth=variant==0?-.35f:1.35f;a.scalpWidth=variant==0?.88f:1.12f;a.templeWidth=variant==0?.94f:1.06f;
        if(variant==2){a.scalpAsset=24;a.scalpTarget=22;a.scalpBlend=.4f;a.jawTarget=22;a.jawBlend=.7f;}
        auto eyes=characterEyes(a);eyes->scale(25);eyes->translate(320,160);auto pixels=raster(eyes,640,400);
        auto bare=a;bare.eyeSize=0;bare.eyeOutline=bare.upperLid=bare.browVisible=false;
        auto facePaint=characterFace(bare);facePaint->scale(25);facePaint->translate(320,160);auto skin=raster(facePaint,640,400);
        int outside=0,crossing=0,visible=0;
        for(int y=0;y<400;++y)for(int x=0;x<640;++x)if((pixels[size_t(y)*640+x]>>24)>160){++visible;if((skin[size_t(y)*640+x]>>24)<200)++outside;if(x==319||x==320)++crossing;}
        CHECK(visible>4);CHECK_EQ(outside,0);CHECK_EQ(crossing,0);
    }
}

TEST(game_character_long_curtains_are_behind_the_neck_and_have_no_old_face_hole)
{
    te::test::Graphics runtime;
    for(int hair:{1,6,11,12,49})for(float chin:{.65f,1.f,1.5f}) {
        auto a=appearanceOf(person());useCharacterReference(a,hair);a.chinLength=chin;a.hair={110,80,50};a.hairShade={20,15,10};
        auto front=characterHair(a,true);front->scale(25);front->translate(160,110);auto pixels=raster(front);
        int neck=0;for(int y=int(110+(3.2f*chin+.12f)*25);y<std::min(320,int(110+(4.8f+std::max(0.f,3.2f*(chin-1)))*25));++y)
            for(int x=155;x<=165;++x)if((pixels[size_t(y)*320+x]>>24)>100)++neck;
        CHECK_EQ(neck,0);
        auto rear=characterHair(a,false);rear->scale(20);rear->translate(160,80);auto back=raster(rear);
        for(int y:{130,155,200}){auto p=back[size_t(y)*320+160];CHECK((p>>24)>240);CHECK_EQ(int((p>>16)&255),110);}
    }
}

TEST(game_character_parted_curtains_leave_the_lower_face_in_front_of_the_side_locks)
{
    te::test::Graphics runtime;
    for(int hair:{1,6,11,12,49})for(int face:{0,22,24,21}) {
        auto a=appearanceOf(person());useCharacterReference(a,hair);setCharacterHeadBase(a,face);a.chinLength=.65f;
        auto front=characterHair(a,true);front->scale(25);front->translate(160,110);auto pixels=raster(front);
        auto bare=a;bare.eyeSize=0;bare.eyeOutline=bare.upperLid=bare.browVisible=false;
        auto facePaint=characterFace(bare);facePaint->scale(25);facePaint->translate(160,110);auto skin=raster(facePaint);
        int covered=0;
        for(int y=117;y<250;++y)for(int x=40;x<280;++x)if((skin[size_t(y)*320+x]>>24)>245&&(pixels[size_t(y)*320+x]>>24)>100)++covered;
        CHECK_EQ(covered,0);
    }
}

TEST(game_character_skull_and_jaw_interpolation_are_independent)
{
    te::test::Graphics runtime;auto a=appearanceOf(person());useCharacterReference(a,0);a.jawTarget=22;
    auto hair=[&]{auto p=characterHair(a,true);p->scale(20);p->translate(160,130);return raster(p);};
    auto original=hair(),face=head(a);a.jawBlend=.5f;CHECK(hair()==original);CHECK(head(a)!=face);
    auto half=head(a);a.jawBlend=1;CHECK(head(a)!=half);CHECK(hair()==original);
    a.scalpTarget=24;a.scalpBlend=.5f;CHECK(hair()!=original);auto middle=hair();a.scalpBlend=1;CHECK(hair()!=middle);
}

TEST(game_character_gender_weights_prefer_the_selected_asset_pool_without_excluding_others)
{
    int masculine=0,feminine=0,oppositeM=0,oppositeF=0;
    for(uint32_t seed=1;seed<=6000;++seed){auto m=randomCharacterReference(seed,BodyType::Male),f=randomCharacterReference(seed,BodyType::Female);auto mg=characterAssetGender(m),fg=characterAssetGender(f);masculine+=mg==CharacterAssetGender::Masculine;feminine+=fg==CharacterAssetGender::Feminine;oppositeM+=mg==CharacterAssetGender::Feminine;oppositeF+=fg==CharacterAssetGender::Masculine;}
    CHECK(masculine>4200);CHECK(feminine>4200);CHECK(oppositeM>0&&oppositeM<1200);CHECK(oppositeF>0&&oppositeF<1200);
}

TEST(game_character_asset_pool_includes_all_original_and_earlier_colour_studies)
{
    CHECK_EQ(hairAssetCount,150);CHECK_EQ(faceBaseCount,30);CHECK_EQ(eyeReferenceCount,20);
    std::array<int,5> groups{};for(int i=0;i<hairAssetCount;++i)++groups[size_t(characterAssetGroup(i))];
    CHECK_EQ(groups[0],20);CHECK_EQ(groups[1],19);CHECK_EQ(groups[2],100);CHECK_EQ(groups[3],10);CHECK_EQ(groups[4],1);
}

TEST(game_character_skull_and_ear_silhouettes_are_bilaterally_symmetric)
{
    te::test::Graphics runtime;auto a=appearanceOf(person());
    auto symmetric=[&](tvg::Paint* p,bool rgba=false){
        p->scale(23);p->translate(160,130);auto pixels=raster(p);uint64_t error=0,total=0;
        for(int y=0;y<280;++y)for(int x=0;x<160;++x)for(int shift=rgba?0:24;shift<=24;shift+=8){auto l=(pixels[size_t(y)*320+x]>>shift)&255,r=(pixels[size_t(y)*320+319-x]>>shift)&255;error+=std::abs(int(l)-int(r));total+=l+r;}
        return double(error)/std::max<uint64_t>(1,total);
    };
    for(int face=0;face<faceBaseCount;++face){
        a=appearanceOf(person());setCharacterHeadBase(a,face);a.earAsset=uint8_t(face);auto skull=characterSkull(a);skull->fill(0,0,0);CHECK(symmetric(skull)<.005);
        CHECK(symmetric(characterEars(a))<.005);
        CHECK(symmetric(characterFace(a),true)<.006);
        a.scalpTarget=24;a.scalpBlend=.6f;a.jawTarget=22;a.jawBlend=.4f;a.chinLength=1.2f;
        skull=characterSkull(a);skull->fill(0,0,0);CHECK(symmetric(skull)<.005);
        a.portraitEyeKind=PortraitEyeKind::Open;a.portraitEyeForm=PortraitEyeForm::HalfLid;a.browVisible=true;
        for(auto shape:{FaceShape::Natural,FaceShape::Oval,FaceShape::Round,FaceShape::Angular}){
            a.faceShape=shape;a.faceBlend=.7f;a.jawWidth=.85f;a.scalpWidth=1.08f;
            CHECK(symmetric(characterFace(a),true)<.006);
        }
    }
}

TEST(game_character_random_pool_and_legacy_hair_resolution_use_reviewed_assets)
{
    for(auto gender:{BodyType::Male,BodyType::Female})for(uint32_t seed=0;seed<3000;++seed)
        CHECK(characterAssetReady(randomCharacterReference(seed,gender)));
    for(int source=0;source<hairAssetCount;++source){
        auto a=appearanceOf(person());a.hairAsset=uint8_t(source);a.hairFringe=uint8_t(source);a.outfitAsset=7;
        resolveCharacterAssets(a);CHECK(characterAssetReady(a.hairAsset));CHECK_EQ(a.hairFringe,uint8_t(255));CHECK_EQ(a.outfitAsset,uint8_t(7));
    }
    CHECK(!characterAssetReady(119));CHECK(!characterAssetReady(144));CHECK(characterAssetReady(49));
    CHECK_EQ(safeCharacterHairAsset(119),15);CHECK_EQ(safeCharacterHairAsset(144),16);
    CHECK(!characterAssetReady(10));CHECK_EQ(safeCharacterHairAsset(10),17);
}

TEST(game_character_reference_look_restores_its_neutral_head_after_other_looks_and_edits)
{
    te::test::Graphics runtime;
    for(int source:{0,8,9,11,12,15,16,49}) {
        auto clean=appearanceOf(person());clean.outfitAsset=7;clean.bodyType=BodyType::Female;
        auto edited=clean;useCharacterReference(edited,49);
        edited.faceWidth=1.35f;edited.jawWidth=1.3f;edited.chinLength=1.5f;
        edited.faceShape=FaceShape::Round;edited.faceBlend=1;edited.cheekFullness=1;
        edited.scalpTarget=24;edited.scalpBlend=1;edited.scalpWidth=1.12f;edited.scalpHeight=.88f;
        edited.foreheadShift=.2f;edited.templeWidth=1.06f;
        edited.hairLength=1.2f;edited.sideLockGap=.4f;edited.hairFringe=19;
        edited.earScale=1.3f;edited.earHeight=.5f;edited.earTilt=.25f;
        edited.portraitEyeKind=PortraitEyeKind::Open;edited.portraitEyeForm=PortraitEyeForm::HalfLid;
        edited.eyeSize=2.3f;edited.eyeWidth=1.8f;edited.eyeHeight=.5f;edited.eyeOpenness=.5f;
        edited.eyeGap=12;edited.eyeLevel=.5f;edited.eyeTilt=.2f;edited.eyeOutline=true;
        edited.browVisible=true;edited.browWidth=1.8f;edited.browSpacing=1.4f;edited.browHeight=.7f;
        edited.browTilt=.6f;edited.browCurve=1;edited.browWeight=3;
        edited.mouthWidth=10;edited.mouthCurve=1;edited.noseScale=1.6f;
        useCharacterReference(clean,source);useCharacterReference(edited,source);
        CHECK(head(edited)==head(clean));CHECK_EQ(edited.outfitAsset,uint8_t(7));
        CHECK(edited.bodyType==BodyType::Female);CHECK_EQ(edited.seed,clean.seed);
        CHECK_EQ(ui::paintKey(edited.skin,edited.hair,edited.cloth),ui::paintKey(clean.skin,clean.hair,clean.cloth));
    }
}

TEST(game_character_world_sprites_use_compact_heads_independent_of_portrait_geometry)
{
    te::test::Graphics runtime;auto owner=person();auto a=appearanceOf(owner);
    a.hair={245,0,245};a.hairShade={125,0,125};a.cloth={40,90,55};a.clothShade={25,55,35};
    auto image=[&](const Appearance& look){auto p=owner;p.customLook=look;PersonParts parts;auto sprite=personSprite(p,parts);sprite->scale(10);sprite->translate(160,240);return raster(sprite);};
    for(int source:{1,6,8,9,11,12,49}) {
        useCharacterReference(a,source);auto pixels=image(a);int belowWaist=0;
        for(int y=195;y<320;++y)for(int x=0;x<320;++x){auto p=pixels[size_t(y)*320+x];int r=(p>>16)&255,g=(p>>8)&255,b=p&255;if(r>80&&g<25&&std::abs(r-b)<5)++belowWaist;}
        CHECK_EQ(belowWaist,0);
        auto edited=a;edited.hairLength=1.2f;edited.faceWidth=1.35f;edited.chinLength=1.5f;
        edited.scalpHeight=1.12f;edited.eyeSize=2.3f;edited.eyeOutline=true;edited.earScale=1.3f;
        CHECK(image(edited)==pixels);
        auto p=owner;p.customLook=a;auto anchor=personSpeechAnchor(p);p.customLook=edited;
        CHECK(distance(anchor,personSpeechAnchor(p))<.001f);
    }
}

#if HEARTHOLD_WITH_EDITOR
TEST(game_character_studio_outfits_skip_the_removed_small_shoulder_cape)
{
    te::test::Graphics runtime;GameApp game(5);game.openCharacterEditor();game.render(1280,800,0);
    game.pointerDown(80,310,PointerButton::Primary);game.pointerUp(80,310,PointerButton::Primary);game.render(1280,800,0);
    std::vector<int> selected;auto initial=game.characterEditor()->current().look.outfitAsset;
    for(int i=0;i<13;++i) {
        CHECK(!text(game.hudScene(),"Small shoulder cape"));
        selected.push_back(game.characterEditor()->current().look.outfitAsset);
        game.pointerDown(1230,186,PointerButton::Primary);game.pointerUp(1230,186,PointerButton::Primary);game.render(1280,800,0);
    }
    std::sort(selected.begin(),selected.end());CHECK_EQ(selected.size(),size_t(13));
    CHECK(std::adjacent_find(selected.begin(),selected.end())==selected.end());
    CHECK(std::find(selected.begin(),selected.end(),10)==selected.end());
    CHECK_EQ(game.characterEditor()->current().look.outfitAsset,initial);
}

TEST(game_character_studio_offers_whole_hairstyles_without_component_swaps)
{
    te::test::Graphics runtime;GameApp game(5);game.openCharacterEditor();game.render(1280,800,0);
    game.pointerDown(80,272,PointerButton::Primary);game.pointerUp(80,272,PointerButton::Primary);game.render(1280,800,0);
    CHECK(text(game.hudScene(),"Whole hairstyle"));CHECK(!text(game.hudScene(),"Component"));
    auto preset=game.characterEditor()->current();preset.look.hairAsset=8;
    preset.look.hairCap=16;preset.look.hairFringe=12;preset.look.hairBack=1;preset.look.hairTied=18;
    game.characterEditor()->setPreset(preset);auto a=game.characterEditor()->current().look;
    CHECK_EQ(a.hairCap,uint8_t(255));CHECK_EQ(a.hairFringe,uint8_t(255));
    CHECK_EQ(a.hairBack,uint8_t(255));CHECK_EQ(a.hairTied,uint8_t(255));
}
#endif

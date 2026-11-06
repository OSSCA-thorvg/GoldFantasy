#include <test/test.h>
#include <test/directory.h>
#include <test/graphics.h>
#include <game/authoring/character_editor.h>
#include <game/character_preset.h>
#include <game/character_assets.h>
#include <game/game_app.h>
#include <limits>

namespace {
using namespace hearthold;
Person owner(){return {7,"Rowan",Role::Resident,Calling::Settler,Race::Human,4242,{}, {}};}
void removeLine(std::string& text,const std::string& key){auto at=text.find("\n"+key+" ");if(at!=std::string::npos){auto end=text.find('\n',at+1);text.erase(at,end==std::string::npos?text.size()-at:end-at);}}
}

TEST(game_character_preset_v9_roundtrips_independent_reference_parts_and_parameters)
{
    for(int i=0;i<referenceHeadCount;++i){
        auto preset=characterPreset(owner());preset.name="Rowan the quiet";
        preset.race=i%2?Race::God:Race::Human;setCharacterHeadBase(preset.look,i%4);preset.look.hairAsset=uint8_t((i+4)%hairAssetCount);
        preset.look.eyeReference=uint8_t((i+8)%referenceHeadCount);preset.look.outfitAsset=uint8_t(i%outfitAssetCount);
        preset.look.earAsset=uint8_t((i+12)%referenceHeadCount);preset.look.scalpWidth=1.08f;preset.look.scalpHeight=.95f;preset.look.foreheadShift=.1f;preset.look.templeWidth=1.04f;
        preset.look.hairCap=9;preset.look.hairFringe=255;preset.look.hairBack=12;preset.look.hairTied=19;preset.look.hairLength=1.1f;preset.look.sideLockGap=.2f;preset.look.earTilt=.1f;
        preset.look.earHeight=.3f;preset.look.earScale=1.1f;
        preset.look.eyeOpenness=.65f;preset.look.eyeRoundness=.3f;preset.look.eyeStroke=1.4f;preset.look.mouthCurve=-.5f;preset.look.faceBlend=.4f;
        auto text=encodeCharacter(preset);CHECK(text.starts_with("hearthold-character 9\n"));
        CharacterPreset decoded;std::string error;CHECK(decodeCharacter(text,decoded,error));CHECK(error.empty());CHECK_EQ(encodeCharacter(decoded),text);
    }
}

TEST(game_character_preset_rejects_invalid_asset_ids_and_nonfinite_morphs_without_mutation)
{
    auto original=characterPreset(owner());auto before=encodeCharacter(original);
    auto reject=[&](auto edit){auto bad=original;edit(bad);CHECK(!validCharacter(bad));CharacterPreset parsed=original;std::string error;CHECK(!decodeCharacter(encodeCharacter(bad),parsed,error));CHECK_EQ(encodeCharacter(parsed),before);};
    reject([](auto& p){p.race=Race(255);});reject([](auto& p){p.look.faceAsset=faceBaseCount;});reject([](auto& p){p.look.hairAsset=hairAssetCount;});
    reject([](auto& p){p.look.outfitAsset=14;});reject([](auto& p){p.look.eyeReference=eyeReferenceCount;});
    reject([](auto& p){p.look.earAsset=earAssetCount;});reject([](auto& p){p.look.earHeight=.6f;});
    reject([](auto& p){p.look.scalpAsset=faceBaseCount;});reject([](auto& p){p.look.scalpWidth=2;});
    reject([](auto& p){p.look.hairFringe=254;});reject([](auto& p){p.look.earTilt=1;});
    reject([](auto& p){p.look.eyeOpenness=std::numeric_limits<float>::quiet_NaN();});reject([](auto& p){p.look.eyeStroke=3;});
}

TEST(game_character_presets_migrate_legacy_races_and_legacy_hair_to_the_static_library)
{
    auto original=characterPreset(owner());original.look.hairStyle=HairStyle::Bun;
    for(int version=1;version<=5;++version){
        auto text=encodeCharacter(original);text.replace(std::string("hearthold-character ").size(),1,std::to_string(version));
        auto identity=text.find("identity 0 ");CHECK(identity!=std::string::npos);text.replace(identity+9,1,"3");
        removeLine(text,"face-morph");removeLine(text,"eye-system");removeLine(text,"brows");removeLine(text,"cranium");removeLine(text,"hair-parts");removeLine(text,"attachments");removeLine(text,"assets");removeLine(text,"shape");removeLine(text,"ears");if(version<5)removeLine(text,"body-type");if(version<4)removeLine(text,"portrait");
        if(version<3){removeLine(text,"features");removeLine(text,"hair-end");}if(version<2)removeLine(text,"jaw");
        CharacterPreset loaded;std::string error;CHECK(decodeCharacter(text,loaded,error));CHECK(loaded.race==Race::Human);CHECK_EQ(loaded.look.hairAsset,uint8_t(16));
    }
}

TEST(game_character_v6_presets_keep_their_original_ear_reference_during_migration)
{
    auto preset=characterPreset(owner());preset.look.faceAsset=12;
    auto text=encodeCharacter(preset);text.replace(std::string("hearthold-character ").size(),1,"6");removeLine(text,"ears");removeLine(text,"face-morph");removeLine(text,"eye-system");removeLine(text,"brows");removeLine(text,"cranium");removeLine(text,"hair-parts");removeLine(text,"attachments");
    CharacterPreset loaded;std::string error;CHECK(decodeCharacter(text,loaded,error));
    CHECK_EQ(loaded.look.earAsset,uint8_t(12));CHECK_EQ(loaded.look.earHeight,0.f);
}

TEST(game_character_preset_unicode_files_save_load_and_replace)
{
    te::test::Directory directory;auto preset=characterPreset(owner());preset.name="S\u00f8ren";
    auto file=directory.file("hero-\u00f8.character");std::string error;CHECK(saveCharacter(file,preset,error));
    preset.look.hairAsset=18;CHECK(saveCharacter(file,preset,error));CharacterPreset loaded;CHECK(loadCharacter(file,loaded,error));CHECK_EQ(encodeCharacter(loaded),encodeCharacter(preset));
}

TEST(game_character_removed_small_shoulder_cape_migrates_without_renumbering_other_outfits)
{
    CHECK(!characterOutfitReady(10));CHECK_EQ(safeCharacterOutfitAsset(10),0);
    auto preset=characterPreset(owner());useCharacterReference(preset.look,0);preset.look.outfitAsset=10;
    auto person=owner();CHECK(applyCharacter(person,preset));CHECK_EQ(person.customLook->outfitAsset,uint8_t(0));
    CHECK_EQ(appearanceOf(person).outfitAsset,uint8_t(0));
    auto text=encodeCharacter(preset);CHECK(text.find("\nassets 0 0 0 0\n")!=std::string::npos);
    auto at=text.find("\nassets "),end=text.find('\n',at+1);CHECK(at!=std::string::npos);
    text.replace(at,end-at,"\nassets 0 0 0 10");CharacterPreset loaded;std::string error;
    CHECK(decodeCharacter(text,loaded,error));CHECK_EQ(loaded.look.outfitAsset,uint8_t(0));
    for(int id:{9,11,12,13}) {
        preset.look.outfitAsset=uint8_t(id);CHECK(characterOutfitReady(id));CHECK(decodeCharacter(encodeCharacter(preset),loaded,error));
        CHECK_EQ(loaded.look.outfitAsset,uint8_t(id));
    }
    CHECK_EQ(outfitAssetName(11),std::string_view("Dark mantle & breeches"));
    CHECK_EQ(outfitAssetName(12),std::string_view("High collar robe"));
    CHECK_EQ(outfitAssetName(13),std::string_view("Wrapped robe"));
}

#if HEARTHOLD_WITH_EDITOR
TEST(game_character_editor_face_variations_and_undo_keep_the_whole_outfit)
{
    CharacterEditor editor(owner());auto preset=editor.current();preset.look.outfitAsset=11;preset.look.hairAsset=18;editor.setPreset(preset);
    auto before=encodeCharacter(editor.current());editor.randomize();CHECK_EQ(editor.current().look.outfitAsset,uint8_t(11));CHECK(editor.current().race==preset.race);
    auto varied=encodeCharacter(editor.current());CHECK(varied!=before);editor.undo();CHECK_EQ(encodeCharacter(editor.current()),before);
    editor.redo();CHECK_EQ(encodeCharacter(editor.current()),varied);editor.reset();CHECK_EQ(encodeCharacter(editor.current()),encodeCharacter(characterPreset(owner())));
}

TEST(game_character_editor_preserves_original_and_applies_metadata_and_assets_together)
{
    te::test::Graphics runtime;GameApp game(5);game.togglePause();int id=game.state().people().front().id;game.selectPeople({id});
    auto clock=game.state().clock();game.openCharacterEditor();auto edited=game.characterEditor()->current();edited.race=Race::God;
    edited.look.faceAsset=3;edited.look.hairAsset=6;edited.look.outfitAsset=12;game.characterEditor()->setPreset(edited);
    game.render(1280,800,20);CHECK_EQ(game.state().clock(),clock);CHECK(game.state().person(id)->race==Race::Human);
    game.closeCharacterEditor(true);game.render(1280,800,20);CHECK(!game.characterEditor());CHECK_EQ(encodeCharacter(characterPreset(*game.state().person(id))),encodeCharacter(edited));
}
#endif

TEST(game_character_v7_migration_keeps_hair_features_ears_outfit_and_identity)
{
    for(int old=0;old<referenceHeadCount;++old) {
        auto preset=characterPreset(owner());preset.race=Race::God;preset.look.faceAsset=uint8_t(old);
        preset.look.hairAsset=uint8_t(old);preset.look.eyeReference=uint8_t(old);preset.look.earAsset=uint8_t(old);preset.look.outfitAsset=11;
        auto text=encodeCharacter(preset);text.replace(std::string("hearthold-character ").size(),1,"7");
        for(auto key:{"cranium","hair-parts","attachments","face-morph","eye-system","brows"})removeLine(text,key);
        CharacterPreset loaded;std::string error;CHECK(decodeCharacter(text,loaded,error));
        CHECK(loaded.race==Race::God);CHECK_EQ(loaded.look.hairAsset,uint8_t(old));CHECK_EQ(loaded.look.eyeReference,uint8_t(old));
        CHECK_EQ(loaded.look.earAsset,uint8_t(old));CHECK_EQ(loaded.look.outfitAsset,uint8_t(11));CHECK(loaded.look.faceAsset<faceBaseCount);
        CHECK_EQ(loaded.look.scalpAsset,uint8_t(old));
    }
}

TEST(game_character_v9_presets_roundtrip_dot_open_brow_and_morph_controls)
{
    auto p=characterPreset(owner());auto& a=p.look;useCharacterReference(a,149);a.portraitEyeKind=PortraitEyeKind::Open;a.portraitEyeForm=PortraitEyeForm::HalfLid;
    a.eyeOutline=false;a.upperLid=false;a.browVisible=true;a.browReference=19;a.browWidth=1.6f;a.browHeight=.4f;a.browTilt=-.3f;a.browCurve=.7f;a.browSpacing=1.2f;
    a.pupilHeight=1.7f;a.pupilY=-.4f;a.eyeSize=2.3f;a.eyeWidth=1.7f;a.eyeHeight=.5f;a.scalpTarget=24;a.scalpBlend=.7f;a.jawTarget=22;a.jawBlend=.4f;
    CharacterPreset out;std::string error;auto encoded=encodeCharacter(p);CHECK(decodeCharacter(encoded,out,error));CHECK_EQ(encodeCharacter(out),encoded);
}

TEST(game_character_v8_migration_keeps_construction_components_and_rejects_future_ids)
{
    auto p=characterPreset(owner());auto& a=p.look;a.faceAsset=1;a.scalpAsset=0;a.hairAsset=11;
    a.earAsset=9;a.eyeReference=3;a.hairCap=12;a.hairFringe=9;a.hairBack=8;a.hairTied=19;
    auto text=encodeCharacter(p);text.replace(std::string("hearthold-character ").size(),1,"8");
    for(auto key:{"face-morph","eye-system","brows"})removeLine(text,key);
    CharacterPreset out;std::string error;CHECK(decodeCharacter(text,out,error));
    CHECK_EQ(out.look.faceAsset,uint8_t(22));CHECK_EQ(out.look.scalpAsset,uint8_t(0));
    CHECK_EQ(out.look.hairAsset,uint8_t(31));CHECK_EQ(out.look.hairCap,uint8_t(32));
    CHECK_EQ(out.look.hairFringe,uint8_t(29));CHECK_EQ(out.look.hairBack,uint8_t(28));CHECK_EQ(out.look.hairTied,uint8_t(19));
    CHECK_EQ(out.look.earAsset,uint8_t(9));CHECK(out.look.portraitEyeKind==PortraitEyeKind::Open);
    auto before=encodeCharacter(out);auto at=text.find("hair-parts 12");CHECK(at!=std::string::npos);
    text.replace(at,std::string("hair-parts 12").size(),"hair-parts 100");CHECK(!decodeCharacter(text,out,error));CHECK_EQ(encodeCharacter(out),before);
}

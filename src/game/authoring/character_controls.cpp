#include "character_controls.h"
#include "character_editor.h"
#include <array>
#include <cmath>

namespace hearthold
{
ui::State characterButton(ui::Context& c, const std::string& id, ui::Rect r, std::string_view label, std::function<void()> activate,
                          ui::ButtonStyle style, bool enabled, ui::Icon icon, bool active)
{
    ui::Appearance appearance;
    appearance.focusRing = true;
    return ui::button(c, id, r, label, std::move(activate), style, enabled, icon, active, appearance);
}

void characterChoice(ui::Context& c, const std::string& id, ui::Rect r, const char* label, const std::vector<std::string>& options,
                     int value, std::function<void(int)> change)
{
    const auto& t = c.theme();
    c.text({r.x, r.y, r.w, 18}, label, t.muted, 12);
    float y = r.y + 23;
    c.rect({r.x, y, r.w, 30}, t.background, t.radius, t.border);
    characterButton(c, id + "-prev", {r.x, y, 30, 30}, "", [=] { change((value + int(options.size()) - 1) % int(options.size())); },
               ui::ButtonStyle::Quiet, true, ui::Icon::ChevronLeft);
    c.text({r.x + 34, y, r.w - 68, 30}, options[size_t(value)], t.text, 13, false, ui::Align::Center);
    characterButton(c, id + "-next", {r.x + r.w - 30, y, 30, 30}, "", [=] { change((value + 1) % int(options.size())); },
               ui::ButtonStyle::Quiet, true, ui::Icon::Chevron);
}

void characterSlider(ui::Context& c, const std::string& id, ui::Rect r, const char* label, float value, float minimum, float maximum,
                     std::function<void()> begin, std::function<void(float)> change)
{
    const auto& t = c.theme();
    float fraction = std::clamp((value - minimum) / (maximum - minimum), 0.f, 1.f);
    c.text({r.x, r.y, r.w, 18}, label, t.muted, 12);
    c.text({r.x, r.y, r.w, 18}, std::to_string(int(std::round(fraction * 100))) + "%", t.text, 12, false, ui::Align::End);
    ui::Rect track{r.x + 6, r.y + 31, r.w - 12, 4};
    auto state = c.control(id, {r.x, r.y + 20, r.w, 24}, [=](const ui::Event& event) {
        if (event.type == ui::EventType::Press || event.type == ui::EventType::Drag) {
            if (event.type == ui::EventType::Press) begin();
            change(minimum + std::clamp((event.x - track.x) / track.w, 0.f, 1.f) * (maximum - minimum));
        } else if (event.type == ui::EventType::Key) {
            float next = value;
            if (event.key == ui::Key::Left || event.key == ui::Key::Down) next -= (maximum - minimum) * .02f;
            else if (event.key == ui::Key::Right || event.key == ui::Key::Up) next += (maximum - minimum) * .02f;
            else if (event.key == ui::Key::Home) next = minimum;
            else if (event.key == ui::Key::End) next = maximum;
            else return;
            begin();
            change(std::clamp(next, minimum, maximum));
        }
    }, true, true, false, true);
    c.rect(track, t.border, 2);
    c.rect({track.x, track.y, std::max(4.f, track.w * fraction), 4}, t.accent, 2);
    c.rect({track.x + track.w * fraction - 5, track.y - 4, 10, 12}, t.text, 5, state.focused || state.hovered ? t.accent : t.border);
    if (state.focused) c.focusRing({r.x, r.y + 20, r.w, 24});
}

void characterColor(ui::Context& c, ui::Rect r, Rgb value, std::function<void()> begin, std::function<void(Rgb)> change)
{
    constexpr std::array<Rgb, 12> palette{{{9, 17, 15}, {55, 38, 23}, {151, 98, 76}, {211, 153, 130}, {240, 205, 179}, {237, 224, 171},
                                         {173, 72, 39}, {219, 181, 93}, {78, 91, 68}, {48, 93, 111}, {133, 81, 92}, {55, 111, 116}}};
    const auto& t = c.theme();
    c.rect({r.x, r.y, 30, 24}, {value.r, value.g, value.b}, t.radius, t.border);
    auto rgb = std::to_string(value.r) + " / " + std::to_string(value.g) + " / " + std::to_string(value.b);
    c.text({r.x + 42, r.y, r.w - 42, 24}, rgb, t.text, 12);
    float cell = (r.w - 5 * 6) / 6;
    for (size_t i = 0; i < palette.size(); ++i) {
        auto swatch = palette[i];
        ui::Rect box{r.x + float(i % 6) * (cell + 6), r.y + 36 + float(i / 6) * 30, cell, 24};
        bool selected = value.r == swatch.r && value.g == swatch.g && value.b == swatch.b;
        auto state = c.control("studio-swatch-" + std::to_string(i), box, [=](const ui::Event& e) {
            if (e.type == ui::EventType::Activate || (e.type == ui::EventType::Key && (e.key == ui::Key::Enter || e.key == ui::Key::Space))) {
                begin();
                change(swatch);
            }
        });
        c.rect(box, {swatch.r, swatch.g, swatch.b}, t.radius, selected || state.hovered ? t.text : t.border, selected ? 2 : 1);
        if (state.focused) c.focusRing(box);
    }
    const char* labels[]{"Red", "Green", "Blue"};
    for (int channel = 0; channel < 3; ++channel) {
        auto amount = channel == 0 ? value.r : channel == 1 ? value.g : value.b;
        characterSlider(c, "studio-rgb-" + std::to_string(channel), {r.x, r.y + 104 + channel * 44, r.w, 44}, labels[channel], amount, 0, 255, begin,
            [=](float v) {
                auto next = value;
                auto byte = uint8_t(std::round(v));
                if (channel == 0) next.r = byte;
                else if (channel == 1) next.g = byte;
                else next.b = byte;
                change(next);
            });
    }
}

void CharacterEditor::controls(ui::Context& c,ui::Rect r)
{
    const auto& t=c.theme();constexpr const char* headings[]{"Character identity","Face & skull","Eyes, brows & mouth","Hair library","Whole outfit","Head colours"};
    c.text({r.x,r.y,r.w,24},headings[category],t.text,17,true);float y=r.y+38;auto& a=preset.look;
    auto names=[](int count,auto name){std::vector<std::string> v;for(int i=0;i<count;++i)v.emplace_back(name(i));return v;};
    auto choice=[&](const char* id,const char* label,const std::vector<std::string>& options,int value,std::function<void(int)> change){
        characterChoice(c,id,{r.x,y,r.w,56},label,options,std::clamp(value,0,int(options.size())-1),[this,change](int v){remember();change(v);});y+=64;
    };
    auto slider=[&](const char* id,const char* label,float Appearance::* member,float low,float high){
        characterSlider(c,id,{r.x,y,r.w,44},label,a.*member,low,high,[this]{remember();},[this,member](float v){preset.look.*member=v;});y+=44;
    };
    auto toggle=[&](const char* id,const char* label,bool Appearance::* member){choice(id,label,{"Off","On"},a.*member,[this,member](int v){preset.look.*member=v!=0;});};
    const std::array<std::string,5> allGroups{"Original artwork","Construction studies","Earlier colour artwork","Dot-eye studies","Flat-lid elf"};
    std::vector<int> groupIds;std::vector<std::string> groups;
    for(int g=0;g<5;++g)for(int i=0;i<hairAssetCount;++i)if(characterAssetReady(i)&&int(characterAssetGroup(i))==g){groupIds.push_back(g);groups.push_back(allGroups[size_t(g)]);break;}
    auto groupPosition=[&](int g){auto at=std::find(groupIds.begin(),groupIds.end(),g);return at==groupIds.end()?0:int(at-groupIds.begin());};
    auto pool=[&](int group,int gender){std::vector<int> v;for(int i=0;i<hairAssetCount;++i)if(characterAssetReady(i)&&int(characterAssetGroup(i))==group&&(gender==0||int(characterAssetGender(i))==gender-1||i==baldHairAsset))v.push_back(i);if(v.empty())v.push_back(baldHairAsset);return v;};
    auto assetChoice=[&](const char* id,const char* label,const std::vector<int>& ids,int value,std::function<void(int)> change){
        auto choices=ids;auto it=std::find(choices.begin(),choices.end(),value);int current=int(it-choices.begin());
        if(it==choices.end())choices.push_back(value);
        std::vector<std::string> labels;for(int i:choices)labels.emplace_back(hairAssetName(i));choice(id,label,labels,current,[choices,change](int v){change(choices[size_t(v)]);});
    };
    auto target=[&](const char* id,const char* label,uint8_t Appearance::* member,float Appearance::* blend){
        auto options=names(faceBaseCount,faceBaseName);options.emplace_back("Use source");int selected=a.*member==255?faceBaseCount:a.*member;
        choice(id,label,options,selected,[this,member,blend](int v){preset.look.*member=uint8_t(v==faceBaseCount?255:v);if(v!=faceBaseCount&&preset.look.*blend==0)preset.look.*blend=.5f;});
    };
    if(category==0) {
        c.text({r.x,y,r.w,18},"Name",t.muted,12);ui::textField(c,"studio-name",{r.x,y+23,r.w,32},name,"Character name",true,{},ui::Icon::None);y+=66;
        choice("studio-gender","Gender / random asset weighting",{"Male","Female"},int(a.bodyType),[this](int v){preset.look.bodyType=BodyType(v);});
        choice("studio-race","Species",{"Human","God"},int(preset.race),[this](int v){preset.race=Race(v);});
        choice("studio-calling","Calling",{"Settler","Traveller","Warrior","Ranger","Mage","Cleric","Bard"},int(preset.calling),[this](int v){preset.calling=Calling(v);});
        choice("studio-reference-group","Reference library",groups,groupPosition(referenceGroup),[this,groupIds](int v){referenceGroup=groupIds[size_t(v)];});
        assetChoice("studio-reference","Reference look",pool(referenceGroup,0),a.hairAsset,[this](int v){useCharacterReference(preset.look,v);hairGroup=referenceGroup=int(characterAssetGroup(v));});
    } else if(category==1) {
        choice("studio-face-region","Region",{"Upper skull","Jaw interpolation","Face style","Ears"},faceRegion,[this](int v){faceRegion=v;});
        if(faceRegion==0) {
            choice("studio-cranium-base","Upper skull source",names(faceBaseCount,faceBaseName),a.scalpAsset,[this](int v){preset.look.scalpAsset=uint8_t(v);});
            target("studio-scalp-target","Upper skull target",&Appearance::scalpTarget,&Appearance::scalpBlend);
            slider("studio-scalp-blend","Upper skull interpolation",&Appearance::scalpBlend,0,1);
            slider("studio-scalp-width","Cranium width",&Appearance::scalpWidth,.88f,1.12f);
            slider("studio-scalp-height","Crown height",&Appearance::scalpHeight,.88f,1.12f);
            slider("studio-forehead","Forehead line",&Appearance::foreheadShift,-.2f,.2f);
            slider("studio-temples","Temple spacing",&Appearance::templeWidth,.94f,1.06f);
        } else if(faceRegion==1) {
            choice("studio-face-asset","Jaw source",names(faceBaseCount,faceBaseName),a.faceAsset,[this](int v){preset.look.faceAsset=uint8_t(v);});
            target("studio-jaw-target","Jaw target",&Appearance::jawTarget,&Appearance::jawBlend);
            slider("studio-jaw-blend","Jaw interpolation",&Appearance::jawBlend,0,1);
            slider("studio-jaw-width","Jaw width",&Appearance::jawWidth,.65f,1.35f);
            slider("studio-chin-length","Chin length",&Appearance::chinLength,.65f,1.5f);
            slider("studio-cheeks","Cheeks",&Appearance::cheekFullness,0,1);
        } else if(faceRegion==2) {
            choice("studio-face-shape","Shape target",{"Reference","Oval","Round","Angular"},int(a.faceShape),[this](int v){preset.look.faceShape=FaceShape(v);});
            slider("studio-face-morph","Shape blend",&Appearance::faceBlend,0,1);
            slider("studio-face-width","Whole face width",&Appearance::faceWidth,-.35f,1.35f);
        } else {
            choice("studio-ear-asset","Ear source",names(earAssetCount,faceBaseName),a.earAsset,[this](int v){preset.look.earAsset=uint8_t(v);});
            slider("studio-ear-scale","Ear size",&Appearance::earScale,.7f,1.3f);slider("studio-ear-height","Ear height",&Appearance::earHeight,-.5f,.5f);slider("studio-ear-angle","Ear angle",&Appearance::earTilt,-.25f,.25f);
        }
        if(y+40<r.y+r.h)characterButton(c,"studio-fit-guides",{r.x,y+8,r.w,28},showFitGuides?"Hide scalp anchors":"Show scalp anchors",[this]{showFitGuides=!showFitGuides;},ui::ButtonStyle::Quiet);
    } else if(category==2) {
        choice("studio-eye-region","Region",{"Eye shape","Eye placement / pupils","Eye outlines","Eyebrows","Mouth / nose"},eyeRegion,[this](int v){eyeRegion=v;});
        if(eyeRegion==0) {
            choice("studio-eye-kind","Eye rendering",{"Dot eyes","Open eyes"},int(a.portraitEyeKind),[this](int v){preset.look.portraitEyeKind=PortraitEyeKind(v);});
            choice("studio-eye-form","Eye form",{"Round","Almond","Half lid","Source recipe"},int(a.portraitEyeForm),[this](int v){preset.look.portraitEyeForm=PortraitEyeForm(v);});
            choice("studio-eye-reference","Eye recipe",names(eyeReferenceCount,eyeAssetName),a.eyeReference,[this](int v){preset.look.eyeReference=uint8_t(v);preset.look.portraitEyeForm=PortraitEyeForm::Reference;});
            slider("studio-eye-size","Eye size",&Appearance::eyeSize,.25f,2.5f);slider("studio-eye-width","Eye width",&Appearance::eyeWidth,.4f,1.8f);slider("studio-eye-height","Eye height",&Appearance::eyeHeight,.4f,1.8f);
            slider("studio-eye-open","Eye openness",&Appearance::eyeOpenness,.1f,1.4f);slider("studio-eye-round","Roundness blend",&Appearance::eyeRoundness,0,1);
        } else if(eyeRegion==1) {
            slider("studio-eye-spacing","Eye spacing",&Appearance::eyeGap,6,11);slider("studio-eye-level","Eye level",&Appearance::eyeLevel,-.4f,.4f);slider("studio-eye-tilt","Eye tilt",&Appearance::eyeTilt,-.4f,.4f);
            if(a.portraitEyeKind==PortraitEyeKind::Open){slider("studio-pupil","Pupil size",&Appearance::irisSize,.5f,1.4f);slider("studio-pupil-height","Pupil height",&Appearance::pupilHeight,.5f,2.f);slider("studio-pupil-y","Pupil vertical position",&Appearance::pupilY,-.6f,.6f);}
        } else if(eyeRegion==2) {
            toggle("studio-eye-outline","Full eye outline",&Appearance::eyeOutline);toggle("studio-eye-lid","Upper lid line (open eyes)",&Appearance::upperLid);slider("studio-eye-stroke","Eye line weight",&Appearance::eyeStroke,.25f,2.f);
        } else if(eyeRegion==3) {
            toggle("studio-brows-visible","Eyebrows",&Appearance::browVisible);choice("studio-brow-reference","Brow recipe",names(eyeReferenceCount,eyeAssetName),a.browReference,[this](int v){preset.look.browReference=uint8_t(v);});
            slider("studio-brow-width","Brow width",&Appearance::browWidth,.5f,1.8f);slider("studio-brow-spacing","Brow spacing",&Appearance::browSpacing,.7f,1.4f);slider("studio-brow-height","Brow height",&Appearance::browHeight,-.7f,.7f);
            slider("studio-brow-tilt","Brow angle",&Appearance::browTilt,-.6f,.6f);slider("studio-brow-curve","Brow curvature",&Appearance::browCurve,-1.f,1.f);slider("studio-brow-weight","Brow line weight",&Appearance::browWeight,.5f,3.f);
        } else {slider("studio-mouth-curve","Mouth curve",&Appearance::mouthCurve,-1,1);slider("studio-mouth-width","Mouth width",&Appearance::mouthWidth,3,10);slider("studio-mouth-weight","Mouth line weight",&Appearance::lipFullness,.75f,1.25f);slider("studio-nose-size","Nose size",&Appearance::noseScale,.6f,1.6f);}
    } else if(category==3) {
        choice("studio-hair-group","Asset library",groups,groupPosition(hairGroup),[this,groupIds](int v){hairGroup=groupIds[size_t(v)];});choice("studio-hair-gender","Asset pool",{"All","Masculine","Feminine","Unisex"},genderFilter,[this](int v){genderFilter=v;});
        auto ids=pool(hairGroup,genderFilter);
        assetChoice("studio-hair-asset","Whole hairstyle",ids,a.hairAsset,[this](int v){auto& a=preset.look;a.hairAsset=uint8_t(v);a.hairCap=a.hairFringe=a.hairBack=a.hairTied=255;});
        slider("studio-hair-length","Long hair length",&Appearance::hairLength,.8f,1.2f);slider("studio-side-locks","Side lock clearance",&Appearance::sideLockGap,-.2f,.4f);
        if(y+32<r.y+r.h)characterButton(c,"studio-fit-guides",{r.x,y+4,r.w,28},showFitGuides?"Hide scalp anchors":"Show scalp anchors",[this]{showFitGuides=!showFitGuides;},ui::ButtonStyle::Quiet);
    } else if(category==4) {
        std::vector<int> ids;std::vector<std::string> labels;
        for(int i=0;i<outfitAssetCount;++i)if(characterOutfitReady(i)){ids.push_back(i);labels.emplace_back(outfitAssetName(i));}
        int selected=int(std::find(ids.begin(),ids.end(),safeCharacterOutfitAsset(a.outfitAsset))-ids.begin());
        choice("studio-outfit-asset","Outfit set",labels,selected,[this,ids](int v){preset.look.outfitAsset=uint8_t(ids[size_t(v)]);});
        c.text({r.x,y+12,r.w,20},"Swap the copied outfit as one set.",t.muted,12);
    } else {
        choice("studio-head-color","Colour",{"Skin","Hair"},colorTarget,[this](int v){colorTarget=v;});auto member=colorTarget?&Appearance::hair:&Appearance::skin;
        characterColor(c,{r.x,y+12,r.w,r.h-80},a.*member,[this]{remember();},[this,member](Rgb v){preset.look.*member=v;refreshShades(preset.look);});
    }
}
}  // namespace hearthold

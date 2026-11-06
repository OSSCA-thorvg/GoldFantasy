// Static vector library review. No window, game loop, audio or portrait animation.
#include <game/character_assets.h>
#include <game/character_preset.h>
#include <game/world_sprites.h>
#include <fstream>
#include <iostream>
#include <memory>
#include <string>

using namespace hearthold;

int main(int argc, char** argv)
{
    if (argc < 2) return 2;
    std::string mode = argc > 2 ? argv[2] : "heads";
    if(mode=="preset") {
        Person person{};person.name="Reference control study";person.look=42;
        auto value=characterPreset(person);useCharacterReference(value.look,0);value.look.outfitAsset=0;
        value.look.portraitEyeKind=PortraitEyeKind::Dots;value.look.portraitEyeForm=PortraitEyeForm::Round;
        value.look.eyeOutline=value.look.browVisible=false;value.look.faceWidth=.5f;
        value.look.skin={251,250,246};value.look.hair={104,104,103};refreshShades(value.look);
        if(!validCharacter(value))return 7;
        std::ofstream out(argv[1]);out<<encodeCharacter(value);return out?0:8;
    }
    if(mode=="fitcheck") {
        Appearance a{};a.faceWidth=.5f;float minimum=100;int variants=0,samples=0;
        for(int hair=0;hair<hairAssetCount;++hair)for(int face=0;face<faceBaseCount;++face)for(float width:{.88f,1.f,1.12f}) {
            a.hairAsset=uint8_t(hair);setCharacterHeadBase(a,face);a.scalpWidth=width;a.scalpHeight=2-width;a.foreheadShift=width<1?-.2f:width>1?.2f:0;a.templeWidth=width<1?.94f:width>1?1.06f:1;HairFit fit(a);++variants;
            for(float y=-8;y<=32;y+=1)for(float x=-12;x<=12;x+=1) {
                auto p=fit.map({x,y}),dx=(fit.map({x+.01f,y})-p)*100,dy=(fit.map({x,y+.01f})-p)*100;
                minimum=std::min(minimum,dx.x*dy.y-dx.y*dy.x);++samples;
            }
        }
        std::ofstream out(argv[1]);out<<"{\n  \"implementation\": \"production HairFit::map\",\n  \"variants\": "<<variants
            <<",\n  \"samples\": "<<samples<<",\n  \"domain\": {\"x\": [-12, 12], \"y\": [-8, 32], \"step\": 1},\n  \"minimumJacobian\": "<<minimum
            <<",\n  \"inversions\": "<<(minimum>0?0:1)<<"\n}\n";
        return minimum>.05f&&out?0:6;
    }
    int width=mode=="pool"?160:240,height=mode=="pool"?220:310;
    std::vector<int> reviewed;for(int i=0;i<hairAssetCount;++i)if(characterAssetReady(i))reviewed.push_back(i);
    std::vector<int> outfits;for(int i=0;i<outfitAssetCount;++i)if(characterOutfitReady(i))outfits.push_back(i);
    bool library=mode=="heads"||mode=="references"||mode=="pool"||mode=="world";
    constexpr std::array cases{1,6,8,9,11,12,119,144,139,49,10};
    int columns=mode=="pool"?8:mode=="layers"?7:4;
    int count = library?int(reviewed.size()):mode=="cases"?int(cases.size())*4:mode=="neck"?20:mode=="eye-limits"?24:mode=="skulls"?faceBaseCount:mode=="reported"?4:mode=="eyes"?24:mode=="brows"||mode=="headmorph"?16:mode=="layers"?35:mode == "outfits" ? int(outfits.size()) : mode=="crania"?16:mode == "fits" || mode=="crossfits" ? 20 : referenceHeadCount;
    int rows = (count + columns - 1) / columns, sheetWidth = columns * width, sheetHeight = rows * height;
    if (tvg::Initializer::init(0) != tvg::Result::Success) return 3;
    if (tvg::Text::load(UI_FONT_PATH) != tvg::Result::Success) { tvg::Initializer::term(); return 5; }
    {
        std::vector<uint32_t> pixels(size_t(sheetWidth) * sheetHeight);
        std::unique_ptr<tvg::SwCanvas> canvas(tvg::SwCanvas::gen());
        canvas->target(pixels.data(),sheetWidth,sheetWidth,sheetHeight,tvg::ColorSpace::ARGB8888);
        auto scene=tvg::Scene::gen();
        auto paper=tvg::Shape::gen(); paper->appendRect(0,0,sheetWidth,sheetHeight); paper->fill(230,230,225); scene->add(paper);
        for(int i=0;i<count;++i) {
            Appearance a{};
            a.skin={251,250,246}; a.hair={104,104,103}; a.hairShade={26,26,26};
            int requested=library?reviewed[size_t(i)]:mode=="cases"?cases[size_t(i/4)]:mode=="reported"?std::array{119,144,49,139}[i]:i%referenceHeadCount;
            useCharacterReference(a,requested);
            a.outfitAsset=mode=="outfits"?uint8_t(outfits[size_t(i)]):0;
            a.faceWidth=.5f; a.jaw=.4f; a.eyeSize=1; a.eyeGap=8.4f; a.browWeight=1; a.mouthWidth=6;
            if(mode=="skulls"){setCharacterHeadBase(a,i);a.earAsset=uint8_t(i);a.hairAsset=baldHairAsset;a.eyeReference=0;}
            if(mode=="reported"){a.skin={109,73,57};a.hair={67,55,46};a.hairShade={28,23,19};}
            if(mode=="cases") {
                if(i%4)setCharacterHeadBase(a,std::array{0,22,24,21}[size_t(i%4)]);
                a.skin={183,126,100};a.hair={67,55,46};a.hairShade={28,23,19};
            }
            if(mode=="neck") {
                useCharacterReference(a,std::array{1,6,11,12,49}[size_t(i/4)]);
                a.chinLength=std::array{.65f,1.f,1.5f,1.f}[size_t(i%4)];
                if(i%4==3){setCharacterHeadBase(a,24);a.scalpWidth=1.12f;}
                a.skin={183,126,100};a.hair={96,80,65};a.hairShade={28,23,19};
            }
            if(mode=="eye-limits") {
                useCharacterReference(a,49);setCharacterHeadBase(a,std::array{0,22,24,21}[size_t(i%4)]);a.hairAsset=baldHairAsset;
                a.portraitEyeKind=i/4<3?PortraitEyeKind::Dots:PortraitEyeKind::Open;
                a.eyeSize=2.5f;a.eyeWidth=a.eyeHeight=1.8f;a.eyeOpenness=1.4f;a.eyeOutline=true;a.eyeStroke=2;
                a.eyeGap=i/4%3==0?6.f:11.f;a.eyeTilt=i/4%3==1?.4f:0;a.eyeLevel=i/4%3==2?.4f:0;
            }
            if(mode=="fits"||mode=="crossfits") {
                constexpr int reported[]{8,9,10,11,12};
                a.hairAsset=uint8_t(reported[i/4]);a.eyeReference=a.hairAsset;
                a.faceWidth=(i%4==0?-.35f:i%4==1?.5f:1.35f);
                a.jawWidth=i%4==3?1.25f:1; a.chinLength=i%4==3?1.2f:1;
                if(mode=="crossfits") {setCharacterHeadBase(a,i%4);a.faceWidth=.5f;a.jawWidth=a.chinLength=1;}
                a.outfitAsset=0;
            }
            if(mode=="layers") {constexpr int reported[]{8,9,49,11,12};useCharacterReference(a,reported[i/7]);}
            if(mode=="crania") {setCharacterHeadBase(a,i%4);a.hairAsset=uint8_t(std::array{13,11,12,8}[i/4]);a.eyeReference=0;}
            if(mode=="eyes") {
                useCharacterReference(a,0);int row=i/4;a.portraitEyeKind=row<3?PortraitEyeKind::Dots:PortraitEyeKind::Open;a.portraitEyeForm=PortraitEyeForm(row%3);
                if(row%3==2)a.eyeReference=a.browReference=19;
                a.eyeSize=std::array{.55f,1.f,1.4f,1.9f}[i%4];a.browVisible=row>=3;a.eyeOutline=i%4==3;
            }
            if(mode=="brows") {
                useCharacterReference(a,0);a.browVisible=true;a.browWeight=1.7f;int row=i/4;
                if(row==0)a.browWidth=std::array{.5f,1.f,1.4f,1.8f}[i%4];
                if(row==1)a.browHeight=std::array{-.7f,-.2f,.2f,.7f}[i%4];
                if(row==2)a.browTilt=std::array{-.6f,-.2f,.2f,.6f}[i%4];
                if(row==3)a.browCurve=std::array{-1.f,-.3f,.3f,1.f}[i%4];
            }
            if(mode=="headmorph") {
                useCharacterReference(a,0);float blend=float(i%4)/3;int row=i/4;
                if(row==0){a.scalpTarget=24;a.scalpBlend=blend;}
                if(row==1)a.scalpHeight=.88f+blend*.24f;
                if(row==2){a.jawTarget=22;a.jawBlend=blend;}
                if(row==3)a.chinLength=.65f+blend*.85f;
            }
            int x=i%columns*width,y=i/columns*height;
            auto frame=tvg::Scene::gen();
            auto bg=tvg::Shape::gen(); bg->appendRect(6,6,width-12,height-20,3,3); bg->fill(212,220,212);frame->add(bg);
            auto figure=mode=="readability"||mode=="world"?tvg::Scene::gen():mode=="references"||mode=="cases"||mode=="pool"||mode=="skulls"||mode=="eyes"||mode=="eye-limits"||mode=="brows"||mode=="headmorph"?characterHead(a):characterFigure(a);
            if(mode=="world") {
                tvg::Paint::rel(figure);Person p{};p.name="World look";p.calling=Calling::Settler;
                a.cloth={86,111,89};a.clothShade={55,75,58};a.trim={186,156,94};a.skinShade=scale(a.skin,.78f);
                p.customLook=a;PersonParts parts;figure=personSprite(p,parts);figure->scale(9);figure->translate(width*.5f,height-45.f);
            } else
            if(mode=="layers") {
                tvg::Paint::rel(figure);
                if(i%7<4)figure=characterHairPart(a,HairPart(i%7));
                else if(i%7==4)figure=characterEars(a);
                else if(i%7==5)figure=characterFace(a);
                else figure=characterHead(a);
                auto placement=characterPortraitPlacement(width,height-20);
                figure->scale(placement.scale);figure->translate(placement.origin.x,placement.origin.y);
            } else if(mode=="readability") {
                auto bounds=characterHeadBounds(a);
                for(int size:{64,128}) {
                    auto head=characterHead(a);
                    float scale=std::min(float(size)/(3.2f-bounds.top),float(size+12)/(bounds.right-bounds.left));
                    head->scale(scale);head->translate(size==64?45.f:156.f,28-bounds.top*scale);
                    figure->add(head);
                }
            } else if(mode=="outfits") {
                tvg::Paint::rel(figure);
                a.faceAsset=a.hairAsset=a.eyeReference=a.earAsset=0;
                figure=characterFigure(a);
                auto placement=characterFigurePlacement(a.outfitAsset,width,height-20);
                figure->scale(placement.scale);figure->translate(placement.origin.x,placement.origin.y);
            } else {
                auto placement=characterPortraitPlacement(width,height-20);
                figure->scale(placement.scale);figure->translate(placement.origin.x,placement.origin.y);
            }
            frame->add(figure);
            auto clip=tvg::Shape::gen();clip->appendRect(6,6,width-12,height-20,3,3);frame->clip(clip);
            auto holder=tvg::Scene::gen();holder->add(frame);
            auto label=tvg::Text::gen();label->font(nullptr);label->size(10);
            std::string name=std::to_string(mode=="outfits"?a.outfitAsset:requested)+"  "+std::string(mode=="outfits"?outfitAssetName(a.outfitAsset):hairAssetName(a.hairAsset));
            if(mode=="skulls")name=std::to_string(i)+" / "+std::string(faceBaseName(i));
            if(mode=="cases")name=std::to_string(requested)+" / "+std::string(hairAssetName(a.hairAsset))+" / "+std::array{"Native","Long","Wide","Box"}[size_t(i%4)];
            if(mode=="neck")name=std::string(hairAssetName(a.hairAsset))+" / "+std::array{"Short chin","Native","Long chin","Wide skull"}[size_t(i%4)];
            if(mode=="eye-limits")name=std::string(i/4<3?"Dots / ":"Open / ")+std::array{"Native","Long","Wide","Box"}[size_t(i%4)]+" / "+std::array{"Close","Wide + tilt","Low"}[(i/4)%3];
            if(mode=="eyes")name=std::string(i/4<3?"Dots / ":"Open / ")+std::array{"Round","Almond","Half lid"}[(i/4)%3]+" / size "+std::to_string(a.eyeSize).substr(0,4)+(a.eyeOutline?" / outline":"");
            if(mode=="brows")name=std::string(std::array{"Brow width","Brow height","Brow angle","Brow curvature"}[i/4])+" / "+std::to_string(i%4);
            if(mode=="headmorph")name=std::string(std::array{"Skull blend","Crown height","Jaw blend","Chin length"}[i/4])+" / "+std::to_string(i%4);
            if(mode=="fits")name=std::string(hairAssetName(a.hairAsset))+" / "+std::array{"Narrow","Reference","Wide","Wide + chin"}[i%4];
            if(mode=="crania")name=std::string(hairAssetName(a.hairAsset))+" / "+std::string(faceBaseName(a.faceAsset));
            if(mode=="crossfits")name=std::string(hairAssetName(a.hairAsset))+" / face "+std::to_string(a.faceAsset);
            if(mode=="layers")name=std::string(hairAssetName(a.hairAsset))+" / "+std::array{"Cap","Fringe","Back","Tied","Ears","Face","Assembled"}[i%7];
            label->text(name.c_str());label->fill(37,43,40);label->translate(10,height-18);holder->add(label);
            holder->translate(float(x),float(y));scene->add(holder);
        }
        canvas->add(scene);canvas->draw(true);canvas->sync();
        std::ofstream out(argv[1],std::ios::binary);out<<"P6\n"<<sheetWidth<<' '<<sheetHeight<<"\n255\n";
        for(auto p:pixels){char rgb[]{char(p>>16),char(p>>8),char(p)};out.write(rgb,3);}
        if(!out)return 4;
    }
    tvg::Text::unload(UI_FONT_PATH);tvg::Initializer::term();
    return 0;
}

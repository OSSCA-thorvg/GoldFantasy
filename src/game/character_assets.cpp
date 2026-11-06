#include "character_assets.h"
#include <GameEngine/GameFramework/coordinate_hash.h>
#include <algorithm>
#include <charconv>
#include <cmath>
#include <functional>
#include <span>
#include <string>
#include <vector>

namespace hearthold
{
namespace
{
struct RawPath { const char* data; int tone; float stroke; bool evenodd; bool outline=false; };
struct HeadSource {
    const char* name;
    std::span<const RawPath> face, hair, hairBack, earLeft, earRight;
    float temple;
    std::array<Point, 13> eye;
    std::array<Point, 4> brow;
    float pupil, pupilX, mouthWidth, mouthY;
    std::array<Point, faceAnchorCount> contour;
    CharacterBounds hairBounds;
    float eyeSpacing, eyeY, eyeRadius, noseY;
    std::array<Point, 2> earRoots;
    std::array<std::array<float, 2>, 8> scalpWidths;
    float frontEnd, hairEarY;
    RawPath skullCoverage;
    bool earsVisible;
};
struct OutfitSource { const char* name; std::span<const RawPath> paths; float bottom; RawPath coverage; };
#include "assets/characters/character-library.inc"
struct FaceSource {
    const char* name;
    std::span<const RawPath> paths; RawPath coverage;
    std::span<const RawPath> earLeft,earRight;
    std::array<Point,16> contour; std::array<Point,2> earRoots;
    float temple,crown,chin,eyeSpacing,eyeY,eyeRadius,noseY,mouthWidth,mouthY;
};
struct FeatureSource { std::array<Point,13> eye;std::array<Point,4> brow;float pupil,pupilX; };
struct HairSource {
    const char* name;std::span<const RawPath> full,shadow,cap,fringe,back,tied;
    int nativeFace,gender,group;
    float radius,crown,splitY,tiedTop,backExtension;bool curtain;int eye,rearMode;bool ready;int fallback;
};
#include "assets/characters/character-pool.inc"
static_assert(std::size(faceSources)==faceBaseCount);
static_assert(std::size(hairSources)==hairAssetCount);
static_assert(std::size(headSources) == referenceHeadCount);
static_assert(std::size(outfitSources) == outfitAssetCount);
constexpr Rgba ink{25, 28, 27};

int headIndex(int i) { return std::clamp(i, 0, referenceHeadCount - 1); }
int outfitIndex(int i) { return safeCharacterOutfitAsset(i); }
float smooth(float t) { t = std::clamp(t, 0.f, 1.f); return t * t * (3 - 2 * t); }

int baseIndex(int i) {return std::clamp(i,0,faceBaseCount-1);}
int hairIndex(int i) {return std::clamp(i,0,hairAssetCount-1);}
const FaceSource& faceSource(int i) {return faceSources[baseIndex(i)];}
float headWidth(const Appearance& a) {return 1+(a.faceWidth-.5f)*.22f;}
float profileWidth(int face,float y,float side)
{
    const auto& f=faceSource(face);Point previous{0,-f.crown};
    for(int i=0;i<7;++i) {
        Point next=i==6?Point{0,f.chin}:f.contour[size_t(1+i*2+(side>0?1:0))];
        if(y<=next.y) {float t=smooth((y-previous.y)/std::max(.001f,next.y-previous.y));return std::max(.08f,std::abs(lerp(previous,next,t).x));}
        previous=next;
    }
    return .08f;
}
float upperWidth(const Appearance& a,float y,float side)
{
    float width=profileWidth(a.scalpAsset,y,side);
    if(a.scalpTarget!=255)width=std::lerp(width,profileWidth(a.scalpTarget,y,side),a.scalpBlend);
    return width;
}
Point upperPoint(const Appearance& a,Point p)
{
    const auto& source=faceSource(a.scalpAsset);float side=p.x<0?-1.f:1.f;
    float morph=upperWidth(a,p.y,side)/profileWidth(a.scalpAsset,p.y,side);
    float t=smooth((p.y+source.crown)/source.crown);
    return {p.x*morph*headWidth(a)*a.scalpWidth*(1+(a.templeWidth-1)*t),p.y*a.scalpHeight+a.foreheadShift*4*t*(1-t)};
}
Point facePoint(const Appearance& a,Point p)
{
    const auto& f=faceSource(a.faceAsset);if(p.y<=0)return upperPoint(a,p);
    float side=p.x<0?-1.f:1.f,lower=smooth(p.y/f.chin);
    float root=upperWidth(a,0,side)*headWidth(a)*a.scalpWidth*a.templeWidth;
    float width=root/profileWidth(a.faceAsset,0,side);
    if(a.jawTarget!=255) {
        float from=profileWidth(a.faceAsset,p.y,side)/profileWidth(a.faceAsset,0,side);
        float to=profileWidth(a.jawTarget,p.y,side)/profileWidth(a.jawTarget,0,side);
        width*=std::lerp(1.f,to/from,a.jawBlend);
    }
    float jaw=1+(a.jawWidth-1)*lower;
    if(a.faceShape==FaceShape::Round)jaw+=a.faceBlend*lower*.12f;
    else if(a.faceShape==FaceShape::Angular)jaw+=a.faceBlend*lower*.06f;
    else if(a.faceShape==FaceShape::Oval)jaw-=a.faceBlend*lower*.08f;
    float cheek=1+(a.cheekFullness-.5f)*.13f*std::sin(std::clamp(p.y/f.chin,0.f,1.f)*3.14159265f);
    return {p.x*width*jaw*cheek,p.y*(1+(a.chinLength-1)*lower)};
}
float chinBottom(const Appearance& a) {return faceSource(a.faceAsset).chin*a.chinLength;}
float outfitOffset(const Appearance& a) {return std::max(0.f,chinBottom(a)-3.2f);}
FeatureSource feature(int i)
{
    if(i>=referenceHeadCount)return extraFeature;
    const auto& h=headSources[headIndex(i)];return {h.eye,h.brow,h.pupil,h.pupilX};
}
using Map = std::function<Point(Point)>;
tvg::Shape* path(const RawPath& raw, const Map& map, bool deform = false)
{
    auto shape = tvg::Shape::gen();
    const char* p = raw.data;
    const char* end = p + std::char_traits<char>::length(p);
    auto number = [&] {
        while (p != end && *p == ' ') ++p;
        float value = 0;
        auto result = std::from_chars(p, end, value);
        p = result.ptr;
        return value;
    };
    auto point = [&] { float x = number(), y = number(); return Point{x, y}; };
    auto at = [](const std::array<Point,4>& p, float t) {
        float u=1-t;return p[0]*(u*u*u)+p[1]*(3*u*u*t)+p[2]*(3*u*t*t)+p[3]*(t*t*t);
    };
    auto curve = [&](auto&& self, std::array<Point,4> original, int depth) -> void {
        std::array<Point,4> q;
        for(size_t i=0;i<4;++i)q[i]=map(original[i]);
        if(deform) {
            constexpr float epsilon=.001f;
            q[1]=q[0]+(map(original[0]+(original[1]-original[0])*epsilon)-q[0])*(1/epsilon);
            q[2]=q[3]+(map(original[3]+(original[2]-original[3])*epsilon)-q[3])*(1/epsilon);
            float error=0;
            for(float t:{.25f,.5f,.75f})error=std::max(error,distance(map(at(original,t)),at(q,t)));
            if(error>.008f&&depth<8) {
                auto a=lerp(original[0],original[1],.5f),b=lerp(original[1],original[2],.5f),c=lerp(original[2],original[3],.5f);
                auto d=lerp(a,b,.5f),e=lerp(b,c,.5f),middle=lerp(d,e,.5f);
                self(self,{original[0],a,d,middle},depth+1);self(self,{middle,e,c,original[3]},depth+1);return;
            }
        }
        shape->cubicTo(q[1].x,q[1].y,q[2].x,q[2].y,q[3].x,q[3].y);
    };
    Point current{},start{};
    while (p != end) {
        char command = *p++;
        if (command == 'M' || command == 'L') {
            auto a=point(),mapped=map(a);
            if(command=='M') {shape->moveTo(mapped.x,mapped.y);start=a;}
            else if(deform)curve(curve,{current,lerp(current,a,1.f/3),lerp(current,a,2.f/3),a},0);
            else shape->lineTo(mapped.x,mapped.y);
            current=a;
        } else if (command == 'C') {
            auto a = point(), b = point(), c = point();
            curve(curve,{current,a,b,c},0);current=c;
        } else if (command == 'Z') {
            if(deform&&distance(current,start)>.0001f)curve(curve,{current,lerp(current,start,1.f/3),lerp(current,start,2.f/3),start},0);
            shape->close();current=start;
        }
    }
    if (raw.evenodd) shape->fillRule(tvg::FillRule::EvenOdd);
    return shape;
}

void style(tvg::Shape* shape, const RawPath& raw, Rgb color)
{
    if (raw.stroke > 0) {
        shape->fill(0, 0, 0, 0);
        shape->strokeFill(color.r, color.g, color.b);
        shape->strokeWidth(raw.stroke);
        shape->strokeCap(tvg::StrokeCap::Round);
        shape->strokeJoin(tvg::StrokeJoin::Round);
    } else {
        fill(shape,opaque(color));
        if(raw.outline){shape->strokeFill(ink.r,ink.g,ink.b);shape->strokeWidth(.075f);shape->strokeCap(tvg::StrokeCap::Round);shape->strokeJoin(tvg::StrokeJoin::Round);}
    }
}

void appendEye(tvg::Shape* shape, const std::array<Point, 13>& points, int begin = 0, int end = 4)
{
    auto p = points[size_t(begin * 3)]; shape->moveTo(p.x, p.y);
    for (int i = begin; i < end; ++i) {
        auto a = points[size_t(i * 3 + 1)], b = points[size_t(i * 3 + 2)], c = points[size_t(i * 3 + 3)];
        shape->cubicTo(a.x, a.y, b.x, b.y, c.x, c.y);
    }
    if (begin == 0 && end == 4) shape->close();
}

float featureScale(const Appearance& a,int reference)
{
    int native=reference>=referenceHeadCount?29:reference;
    return characterCranium(a).rightTemple.x/profileWidth(native,0,1);
}
Point featureCenter(const Appearance& a,float side,int reference)
{
    const auto& native=faceSource(reference>=referenceHeadCount?29:reference);
    float ratio=featureScale(a,reference);
    return {side*native.eyeSpacing*ratio,native.eyeY*a.scalpHeight};
}
Point eyeCenter(const Appearance& a,float side) {auto p=featureCenter(a,side,a.eyeReference);return {p.x*a.eyeGap/8.4f,p.y+a.eyeLevel};}

std::vector<Point> faceBoundary(const Appearance& a,bool top)
{
    const auto& source=faceSource(top?a.scalpAsset:a.faceAsset);
    auto shape=path(source.coverage,[&](Point p){return top?upperPoint(a,p):facePoint(a,p);},true);
    const tvg::PathCommand* commands=nullptr;const tvg::Point* points=nullptr;uint32_t count=0,size=0;
    shape->path(&commands,&count,&points,&size);
    std::vector<Point> boundary;Point current{},start{};uint32_t index=0;
    auto point=[&]{auto p=points[index++];return Point{p.x,p.y};};
    for(uint32_t i=0;i<count;++i) {
        switch(commands[i]) {
        case tvg::PathCommand::MoveTo:current=start=point();boundary.push_back(current);break;
        case tvg::PathCommand::LineTo:current=point();boundary.push_back(current);break;
        case tvg::PathCommand::CubicTo: {
            auto p=current,c1=point(),c2=point(),end=point();
            for(int step=1;step<=16;++step) {
                float t=float(step)/16,u=1-t;
                boundary.push_back(p*(u*u*u)+c1*(3*u*u*t)+c2*(3*u*t*t)+end*(t*t*t));
            }
            current=end;break;
        }
        case tvg::PathCommand::Close:boundary.push_back(start);current=start;break;
        }
    }
    tvg::Paint::rel(shape);return boundary;
}

struct FaceInterior {
    float top,bottom;std::array<float,257> widths{};
    explicit FaceInterior(const Appearance& a):top(-faceSource(a.scalpAsset).crown*a.scalpHeight),bottom(chinBottom(a))
    {
        // Sample the rendered contours; anatomical anchors miss cheek curvature.
        auto upper=faceBoundary(a,true),lower=faceBoundary(a,false);
        for(size_t i=0;i<widths.size();++i) {
            float y=std::lerp(top,bottom,float(i)/float(widths.size()-1));const auto& boundary=y<=0?upper:lower;
            for(size_t j=1;j<boundary.size();++j) {
                auto p=boundary[j-1],q=boundary[j];
                if((p.y<=y&&q.y>y)||(q.y<=y&&p.y>y))widths[i]=std::max(widths[i],std::abs(std::lerp(p.x,q.x,(y-p.y)/(q.y-p.y))));
            }
        }
    }
    float width(float y) const
    {
        if(y<=top||y>=bottom)return 0;
        float sample=(y-top)/(bottom-top)*float(widths.size()-1);
        auto i=std::min(widths.size()-2,size_t(sample));
        return std::min(widths[i],widths[i+1]);
    }
};

struct EyeFit {Point center;float scale;};
EyeFit fitEyes(const Appearance& a,const std::array<Point,13>& model,float rx,float ry)
{
    FaceInterior face(a);auto center=eyeCenter(a,1);
    float stroke=std::max(a.eyeOutline?.03f*a.eyeStroke:0.f,a.portraitEyeKind==PortraitEyeKind::Open&&a.upperLid?.045f*a.eyeStroke:0.f);
    constexpr float gap=.12f;float padding=.05f+stroke;
    center.y=std::clamp(center.y,face.top+padding*2,face.bottom-padding*2);
    for(int i=0;i<16&&face.width(center.y)<gap+padding*2+.05f;++i)center.y*=.75f;
    std::array<Point,65> offsets{};float co=std::cos(a.eyeTilt),si=std::sin(a.eyeTilt);size_t index=0;
    auto rotated=[&](Point p){p.x*=-rx;p.y*=ry;return Point{co*p.x-si*p.y,si*p.x+co*p.y};};
    offsets[index++]=rotated(model[0]);
    for(int curve=0;curve<4;++curve)for(int step=1;step<=16;++step) {
        float t=float(step)/16,u=1-t;size_t j=size_t(curve*3);
        offsets[index++]=rotated(model[j]*(u*u*u)+model[j+1]*(3*u*u*t)+model[j+2]*(3*u*t*t)+model[j+3]*(t*t*t));
    }
    auto interval=[&](float scale) {
        Point range{0,100};
        for(auto p:offsets) {
            p=p*scale;float y=center.y+p.y;
            float width=std::min(face.width(y-padding),face.width(y+padding));
            range.x=std::max(range.x,gap+padding-p.x);range.y=std::min(range.y,width-padding-p.x);
        }
        return range;
    };
    float scale=1;auto range=interval(scale);
    if(range.x>range.y) {
        float low=0,high=1;
        for(int i=0;i<18;++i){float middle=(low+high)*.5f;auto r=interval(middle);if(r.x<=r.y)low=middle;else high=middle;}
        scale=low;range=interval(scale);
    }
    center.x=std::clamp(center.x,range.x,std::max(range.x,range.y));
    return {center,scale};
}

void eyes(tvg::Scene* scene,const Appearance& a)
{
    if(a.eyeSize<=0)return;
    auto f=feature(a.eyeReference);auto model=characterEyePath(a);
    float base=a.portraitEyeKind==PortraitEyeKind::Dots?.14f:faceSource(a.eyeReference>=referenceHeadCount?29:a.eyeReference).eyeRadius;
    // When a cranium narrows, placement and open-eye size must use the same
    // frame. Eye size/width remain multipliers; dot eyes keep their small size.
    if(a.portraitEyeKind==PortraitEyeKind::Open)base*=std::min(1.f,featureScale(a,a.eyeReference));
    float rx=base*a.eyeSize*a.eyeWidth,ry=base*a.eyeSize*a.eyeHeight*(a.portraitEyeKind==PortraitEyeKind::Dots?1.35f:1.f);
    auto fit=fitEyes(a,model,rx,ry);rx*=fit.scale;ry*=fit.scale;
    for(float side:{-1.f,1.f}) {
        auto center=Point{fit.center.x*side,fit.center.y};float angle=a.eyeTilt*side,co=std::cos(angle),si=std::sin(angle);
        auto at=[&](Point p){p.x*=rx*-side;p.y*=ry;return center+Point{co*p.x-si*p.y,si*p.x+co*p.y};};
        auto mapped=model;for(auto& p:mapped)p=at(p);
        auto aperture=tvg::Shape::gen();appendEye(aperture,mapped);
        if(a.portraitEyeKind==PortraitEyeKind::Dots)aperture->fill(ink.r,ink.g,ink.b);
        else aperture->fill(253,252,248);
        if(a.eyeOutline){aperture->strokeFill(ink.r,ink.g,ink.b);aperture->strokeWidth(.06f*a.eyeStroke);}
        scene->add(aperture);
        if(a.portraitEyeKind==PortraitEyeKind::Open) {
            auto pupils=tvg::Scene::gen();auto pc=at({f.pupilX,a.pupilY});
            pupils->add(ellipse(pc,rx*f.pupil*a.irisSize,ry*f.pupil*a.irisSize*a.pupilHeight,ink));
            auto clip=tvg::Shape::gen();appendEye(clip,mapped);pupils->clip(clip);scene->add(pupils);
            if(a.upperLid) {auto lid=tvg::Shape::gen();appendEye(lid,mapped,0,2);lid->strokeFill(ink.r,ink.g,ink.b);lid->strokeWidth(.09f*a.eyeStroke);lid->strokeCap(tvg::StrokeCap::Round);scene->add(lid);}
        }
    }
}
void brows(tvg::Scene* scene,const Appearance& a)
{
    if(!a.browVisible)return;
    auto f=feature(a.browReference);
    for(float side:{-1.f,1.f}) {
        // Brow geometry never passes through the eye-size/openness transform.
        auto center=featureCenter(a,side,a.browReference);center.x*=a.browSpacing;center.y+=a.browHeight;
        auto b=f.brow;float middle=(b[0].x+b[3].x)*.5f,middleY=(b[0].y+b[3].y)*.5f;
        center.y+=middleY*.75f;
        float angle=a.browTilt*side,co=std::cos(angle),si=std::sin(angle);
        for(size_t i=0;i<b.size();++i) {
            Point p{(b[i].x-middle)*.75f*a.browWidth*-side,(b[i].y-middleY)*.75f};
            if(i==1||i==2)p.y+=a.browCurve*.35f;
            b[i]=center+Point{co*p.x-si*p.y,si*p.x+co*p.y};
        }
        auto brow=tvg::Shape::gen();brow->moveTo(b[0].x,b[0].y);brow->cubicTo(b[1].x,b[1].y,b[2].x,b[2].y,b[3].x,b[3].y);
        brow->strokeFill(ink.r,ink.g,ink.b);brow->strokeWidth((a.browReference==19?.24f:.065f)*a.browWeight);brow->strokeCap(tvg::StrokeCap::Round);scene->add(brow);
    }
}
}  // namespace

std::string_view faceBaseName(int i) {return faceSource(i).name;}
std::string_view eyeAssetName(int i) {return i>=referenceHeadCount?"Flat lids / elf":headSources[headIndex(i)].name;}
void setCharacterHeadBase(Appearance& a,int i)
{
    a.faceAsset=a.scalpAsset=uint8_t(baseIndex(i));a.scalpWidth=a.scalpHeight=a.templeWidth=1;a.foreheadShift=0;
    a.scalpTarget=a.jawTarget=255;a.scalpBlend=a.jawBlend=0;
}
CraniumFrame characterCranium(const Appearance& a)
{
    const auto& source=faceSource(a.scalpAsset);float radius=upperWidth(a,0,1)*headWidth(a)*a.scalpWidth;
    float h=source.crown*a.scalpHeight;return {{0,-h},{0,-h*.43f+a.foreheadShift},{-radius,0},{radius,0}};
}
std::string_view headAssetName(int i) {return headSources[headIndex(i)].name;}
std::string_view hairAssetName(int i) {return hairSources[hairIndex(i)].name;}
CharacterAssetGroup characterAssetGroup(int i) {return CharacterAssetGroup(hairSources[hairIndex(i)].group);}
CharacterAssetGender characterAssetGender(int i) {return CharacterAssetGender(hairSources[hairIndex(i)].gender);}
bool characterAssetReady(int i) {return i>=0&&i<hairAssetCount&&hairSources[i].ready;}
int safeCharacterHairAsset(int i) {return i<0||i>=hairAssetCount?baldHairAsset:hairSources[i].fallback;}
void resolveCharacterAssets(Appearance& a)
{
    a.hairAsset=uint8_t(safeCharacterHairAsset(a.hairAsset));
    a.outfitAsset=uint8_t(safeCharacterOutfitAsset(a.outfitAsset));
    // Old presets can contain incompatible cross-style parts. A hairstyle is
    // now selected as one set; the renderer still keeps front/back separate.
    a.hairCap=a.hairFringe=a.hairBack=a.hairTied=255;
}
float characterAssetWeight(int i,BodyType gender)
{
    if(!characterAssetReady(i))return 0;
    if(i==baldHairAsset)return .25f;
    auto& h=hairSources[hairIndex(i)];float family=std::array{5.f,.35f,1.f,1.5f,2.f}[size_t(h.group)];
    return family*(h.gender==2?4.f:h.gender==int(gender)?8.f:1.f);
}
int randomCharacterReference(uint32_t seed,BodyType gender)
{
    float total=0;for(int i=0;i<hairAssetCount;++i)total+=characterAssetWeight(i,gender);
    float value=gameframework::hash01(seed,0,17,0x6a17u)*total;
    for(int i=0;i<hairAssetCount;++i){value-=characterAssetWeight(i,gender);if(value<=0)return i;}
    return baldHairAsset;
}
void useCharacterReference(Appearance& a,int i)
{
    i=safeCharacterHairAsset(i);
    const auto& source=hairSources[hairIndex(i)];setCharacterHeadBase(a,source.nativeFace);
    a.hairAsset=uint8_t(hairIndex(i));a.earAsset=uint8_t(source.nativeFace);a.eyeReference=a.browReference=uint8_t(source.eye);
    a.hairCap=a.hairFringe=a.hairBack=a.hairTied=255;
    // Reference look is a complete neutral head, independent of the previous
    // look's edits. Hair-only selection intentionally does not call this.
    a.faceWidth=.5f;a.jaw=.4f;a.jawWidth=a.chinLength=1;
    a.faceShape=FaceShape::Natural;a.faceBlend=0;a.cheekFullness=.5f;
    a.hairLength=1;a.sideLockGap=0;a.earScale=1;a.earHeight=a.earTilt=0;
    a.eyeSize=a.eyeWidth=a.eyeHeight=a.eyeOpenness=a.eyeStroke=a.irisSize=1;
    a.eyeGap=8.4f;a.eyeLevel=a.eyeTilt=a.eyeRoundness=a.lidDrop=0;
    a.pupilHeight=1.35f;a.pupilY=-.22f;a.upperLid=true;
    a.portraitEyeKind=source.group==4?PortraitEyeKind::Open:PortraitEyeKind::Dots;
    a.portraitEyeForm=source.group==4?PortraitEyeForm::Reference:PortraitEyeForm::Round;
    a.eyeOutline=a.browVisible=source.group==4;
    a.browWidth=a.browSpacing=a.browWeight=1;a.browHeight=a.browTilt=a.browCurve=0;
    a.mouthWidth=6;a.mouthCurve=0;a.lipFullness=a.noseScale=1;
}
// Keep later outfit IDs stable when loading old presets.
bool characterOutfitReady(int i) { return i>=0&&i<outfitAssetCount&&i!=10; }
int safeCharacterOutfitAsset(int i) { return characterOutfitReady(i)?i:0; }
std::string_view outfitAssetName(int i) { return outfitSources[outfitIndex(i)].name; }
float outfitBottom(int i) { return outfitSources[outfitIndex(i)].bottom; }

CharacterPlacement characterPortraitPlacement(float width, float height)
{
    float scale=std::min(width*.92f/16.f,height*.75f/12.3f);
    return {scale,{width*.5f,height*.06f+8.8f*scale}};
}

CharacterPlacement characterFigurePlacement(int outfit, float width, float height)
{
    float scale=std::min((width-24)/18.f,(height-24)/(outfitBottom(outfit)+9.5f));
    return {scale,{width*.5f,height-12-outfitBottom(outfit)*scale}};
}

CharacterPlacement characterFigurePlacement(const Appearance& a,float width,float height)
{
    float bottom=outfitBottom(a.outfitAsset)+outfitOffset(a);
    float scale=std::min((width-24)/18.f,(height-24)/(bottom+9.5f));
    return {scale,{width*.5f,height-12-bottom*scale}};
}

HairFit::HairFit(const Appearance& a,int hair)
{
    const auto& source=hairSources[hairIndex(hair<0?a.hairAsset:hair)];radius=source.radius;crown=source.crown;
    auto frame=characterCranium(a);ratio=frame.rightTemple.x/radius;height=-frame.crown.y/crown;
    bool shaped=false;
    for(size_t i=0;i<profileRatios.size();++i) {
        float t=float(i)/float(profileRatios.size()-1),y=(-.875f+.875f*t)*faceSource(source.nativeFace).crown;
        float targetY=y*faceSource(a.scalpAsset).crown/faceSource(source.nativeFace).crown;
        float native=profileWidth(source.nativeFace,y,1);
        float value=upperWidth(a,targetY,1)*headWidth(a)*a.scalpWidth/native;
        // Authored modular parts already have their own registered cap frame.
        if(source.group==1)value=ratio;
        profileRatios[i]=std::clamp(value,.35f,3.f);shaped|=std::abs(profileRatios[i]-1)>.00001f;
    }
    forehead=a.foreheadShift;temples=a.templeWidth;length=a.hairLength;gap=a.sideLockGap;
    unchanged=!shaped&&std::abs(ratio-1)<.00001f&&std::abs(height-1)<.00001f&&forehead==0&&temples==1&&length==1&&gap==0;
}

Point HairFit::map(Point p) const
{
    if(unchanged)return p;
    // Positive local skin weights. Outside the attachment band, locks translate
    // rigidly. Above the crown, tips also translate instead of stretching.
    float t=smooth((p.y+crown)/crown);
    float sample=std::clamp((p.y/crown+.875f)/.875f,0.f,1.f)*float(profileRatios.size()-1);
    size_t index=std::min(profileRatios.size()-2,size_t(sample));
    float capRatio=std::lerp(profileRatios[index],profileRatios[index+1],smooth(sample-float(index)));
    float w=capRatio*(1+(temples-1)*t);
    float root=1-smooth(p.y/2.4f);
    float side=std::clamp(p.x/radius,-1.f,1.f);
    float x=p.x+(w-1)*(root*p.x+(1-root)*radius*side)+gap*side*(1-root);
    float y=p.y;
    if(p.y< -crown)y-=crown*(height-1);
    else if(p.y<0)y=p.y*height+forehead*4*t*(1-t);
    // A shaft extends; the terminal curl/shape receives translation only.
    float shaft=std::clamp(p.y,0.f,5.f);y+=(length-1)*shaft;
    return {x,y};
}

Point HairFit::fringe(Point p) const
{
    // A two-anchor similarity transform preserves each curtain lobe's aspect.
    float side=p.x<0?-1.f:1.f;
    Point from{side*radius,crown+.2f},to{side*radius*ratio*temples,(crown+.2f)*height};
    float den=from.x*from.x+from.y*from.y;
    float co=(from.x*to.x+from.y*to.y)/den,si=(from.x*to.y-from.y*to.x)/den;
    Point v=p-Point{0,-crown-.2f};
    return {co*v.x-si*v.y, -(crown+.2f)*height+si*v.x+co*v.y+forehead*.4f};
}

Point HairFit::rigid(Point p) const
{
    // Detached knots, buns and braids keep their authored dimensions.
    Point root{p.y< -crown?0.f:p.x<0?-radius:radius,p.y< -crown?-crown:0.f};
    return rigid(p,root);
}

Point HairFit::rigid(Point p,Point root) const {return p+map(root)-root;}

std::array<FitAnchor,hairAnchorCount> hairFitAnchors(const Appearance& a)
{
    const auto& source=hairSources[hairIndex(a.hairAsset)];HairFit fit(a);std::array<FitAnchor,hairAnchorCount> result;size_t i=0;
    for(float y:{-source.crown,0.f,3.2f})for(float x:{-2.f,-1.f,0.f,1.f,2.f}) {Point p{x*source.radius,y};result[i++]={p,fit.map(p)};}
    return result;
}
std::array<Point,13> characterEyePath(const Appearance& a)
{
    constexpr float k=.55228475f;
    const std::array<Point,13> round{{{-1,0},{-1,-k},{-k,-1},{0,-1},{k,-1},{1,-k},{1,0},{1,k},{k,1},{0,1},{-k,1},{-1,k},{-1,0}}};
    auto p=feature(a.eyeReference).eye;
    if(a.portraitEyeForm==PortraitEyeForm::Round)p=round;
    else if(a.portraitEyeForm==PortraitEyeForm::Almond)p=headSources[3].eye;
    else if(a.portraitEyeForm==PortraitEyeForm::HalfLid)p=extraFeature.eye;
    for(size_t i=0;i<p.size();++i){p[i]=lerp(p[i],round[i],a.eyeRoundness);p[i].y*=a.eyeOpenness;if(p[i].y<0)p[i].y*=1-std::clamp(a.lidDrop,0.f,1.f)*.7f;}
    return p;
}

tvg::Shape* characterSkull(const Appearance& a)
{
    const auto& f=faceSource(a.faceAsset);return path(f.coverage,[&](Point p){
        if(p.y<=0){float side=p.x<0?-1.f:1.f;float y=p.y*faceSource(a.scalpAsset).crown/f.crown;return upperPoint(a,{p.x*profileWidth(a.scalpAsset,y,side)/profileWidth(a.faceAsset,p.y,side),y});}
        return facePoint(a,p);
    },true);
}

tvg::Scene* characterHairPart(const Appearance& a,HairPart part)
{
    auto scene=tvg::Scene::gen();
    int selected=safeCharacterHairAsset(a.hairAsset);if(selected==baldHairAsset||selected>=hairAssetCount)return scene;
    const auto& h=hairSources[hairIndex(selected)];HairFit fit(a,selected);auto outline=mix(a.hair,{15,17,16},.8f);
    auto draw=[&](std::span<const RawPath> parts,bool shadow=false,bool linesOnly=false) {
        bool solid=std::none_of(parts.begin(),parts.end(),[](const RawPath& p){return p.stroke==0&&p.tone>=90;});
        for(const auto& raw:parts) {
            if(linesOnly&&raw.stroke==0)continue;
            auto shape=path(raw,[&](Point p){
                if(part==HairPart::Tied)return fit.rigid(p,{0,-h.crown});
                if(part==HairPart::Back)p.y+=h.backExtension*smooth((p.y+1.8f)/1.5f);
                return part==HairPart::Fringe&&h.curtain?fit.fringe(p):fit.map(p);
            },part!=HairPart::Tied&&(!fit.identity()||h.backExtension!=0));
            style(shape,raw,shadow?a.hairShade:solid||raw.tone>=90?a.hair:outline);
            if(shadow&&part==HairPart::Back) {
                // Rear source fills include the old cap and bun. Those are
                // front/tied geometry: a second scalp-warped copy would peek
                // out around rigid accents on wider heads.
                float top=fit.map({0,h.splitY-.02f}).y;
                auto band=tvg::Shape::gen();band->appendRect(-100,top,200,100-top);shape->clip(band);
            }
            scene->add(shape);
        }
    };
    bool full=!h.full.empty();
    if(full) {
        if(part==HairPart::Back&&h.rearMode==2)return scene;
        if(part==HairPart::Tied&&h.tiedTop< -99)return scene;
        // Completed loose hair is one rear mass, without the source face hole.
        if(part==HairPart::Back&&h.rearMode==4){draw(h.shadow);if(h.group==0)draw(h.full,false,true);return scene;}
        if(part==HairPart::Back)draw(h.shadow,true);
        if(part==HairPart::Back&&h.rearMode==1)return scene;
        auto inkScene=tvg::Scene::gen();std::swap(scene,inkScene);draw(h.full);std::swap(scene,inkScene);
        // A small shared overlap prevents separate antialiased clips leaving
        // a light seam through the original continuous artwork.
        constexpr float overlap=.02f;
        float top=part==HairPart::Cap?h.tiedTop-overlap:part==HairPart::Fringe?h.splitY-overlap:part==HairPart::Back?3.5f-overlap:-100;
        float fringeBottom=h.rearMode==4?0.f:h.rearMode==2?1.2f:3.5f;
        float bottom=part==HairPart::Cap?h.splitY+overlap:part==HairPart::Fringe?fringeBottom+overlap:part==HairPart::Back?100:h.tiedTop+overlap;
        auto clip=tvg::Shape::gen();auto mapped=[&](Point p){return part==HairPart::Tied?fit.rigid(p,{0,-h.crown}):fit.map(p);};
        auto p=mapped({-100,top});clip->moveTo(p.x,p.y);
        for(auto q:{Point{100,top},Point{100,bottom},Point{-100,bottom}}){p=mapped(q);clip->lineTo(p.x,p.y);}clip->close();
        if((h.rearMode==1||h.rearMode==3)&&(part==HairPart::Fringe||part==HairPart::Back)) {
            // Source side locks remain coloured; their completed rear interior
            // sits behind the face. Neck/clothing ink cannot bridge that hole.
            float innerTop=std::max(top,1.2f),edge=h.radius*.8f;
            p=mapped({-edge,innerTop});clip->moveTo(p.x,p.y);
            for(auto q:{Point{edge,innerTop},Point{edge,bottom},Point{-edge,bottom}}){p=mapped(q);clip->lineTo(p.x,p.y);}clip->close();clip->fillRule(tvg::FillRule::EvenOdd);
        }
        inkScene->clip(clip);scene->add(inkScene);
    } else draw(part==HairPart::Cap?h.cap:part==HairPart::Fringe?h.fringe:part==HairPart::Back?h.back:h.tied,part==HairPart::Back);
    return scene;
}

tvg::Scene* characterHair(const Appearance& a,bool front)
{
    auto scene=tvg::Scene::gen();
    if(front){scene->add(characterHairPart(a,HairPart::Tied));scene->add(characterHairPart(a,HairPart::Cap));scene->add(characterHairPart(a,HairPart::Fringe));}
    else {
        if(a.hairAsset!=baldHairAsset&&hairSources[hairIndex(safeCharacterHairAsset(a.hairAsset))].rearMode!=4) {
            auto base=a;base.faceAsset=base.scalpAsset;base.jawWidth=base.chinLength=1;base.jawTarget=255;base.jawBlend=base.faceBlend=0;base.cheekFullness=.5f;
            auto plate=characterSkull(base);plate->fill(a.hairShade.r,a.hairShade.g,a.hairShade.b);
            auto upper=tvg::Shape::gen();upper->appendRect(-100,-100,200,101.2f);plate->clip(upper);scene->add(plate);
        }
        scene->add(characterHairPart(a,HairPart::Back));
    }
    return scene;
}
std::array<Point,2> characterEarRoots(const Appearance& a)
{
    auto roots=faceSource(a.scalpAsset).earRoots;
    for(auto& p:roots){float side=p.x<0?-1.f:1.f;p.x=std::copysign(upperWidth(a,p.y,side)*headWidth(a)*a.scalpWidth*a.templeWidth,p.x);p.y+=a.earHeight;}
    return roots;
}

tvg::Scene* characterEars(const Appearance& a)
{
    auto scene=tvg::Scene::gen();
    auto roots=characterEarRoots(a);
    const auto& source=faceSource(a.earAsset);
    int i=0;
    for(auto paths:{source.earLeft,source.earRight}) {
        auto root=roots[size_t(i++)];
        for(const auto& raw:paths) {
            auto shape=path(raw,[&](Point p){
                float angle=(i==1?-1.f:1.f)*a.earTilt,co=std::cos(angle),si=std::sin(angle);
                return root+Point{co*p.x-si*p.y,si*p.x+co*p.y}*a.earScale;
            });
            style(shape,raw,raw.tone>230?a.skin:Rgb{ink.r,ink.g,ink.b});scene->add(shape);
        }
    }
    auto skull=characterSkull(a);const tvg::PathCommand* commands=nullptr;const tvg::Point* points=nullptr;uint32_t count=0,size=0;
    skull->path(&commands,&count,&points,&size);
    auto clip=tvg::Shape::gen();clip->appendRect(-100,-100,200,200);clip->appendPath(commands,count,points,size);
    clip->fillRule(tvg::FillRule::EvenOdd);scene->clip(clip);tvg::Paint::rel(skull);
    auto holder=tvg::Scene::gen();holder->add(scene);return holder;
}

tvg::Scene* characterEyes(const Appearance& a){auto scene=tvg::Scene::gen();eyes(scene,a);return scene;}
tvg::Scene* characterBrows(const Appearance& a){auto scene=tvg::Scene::gen();brows(scene,a);return scene;}

tvg::Scene* characterFace(const Appearance& a)
{
    auto scene=tvg::Scene::gen();
    for(bool top:{true,false}) {
        const auto& f=faceSource(top?a.scalpAsset:a.faceAsset);auto half=tvg::Scene::gen();
        for(const auto& raw:f.paths){auto shape=path(raw,[&](Point p){return top?upperPoint(a,p):facePoint(a,p);},true);style(shape,raw,raw.tone>230?a.skin:Rgb{ink.r,ink.g,ink.b});half->add(shape);}
        auto clip=tvg::Shape::gen();clip->appendRect(-100,top?-100:0,200,100);half->clip(clip);scene->add(half);
    }
    scene->add(characterEyes(a));scene->add(characterBrows(a));const auto& source=faceSource(a.faceAsset);
    auto nose=facePoint(a,{0,source.noseY});scene->add(line(nose,nose+Point{0,.1f*a.noseScale},.065f,ink));
    float width=std::clamp(source.mouthWidth,.18f,.45f)*a.mouthWidth/6;
    auto center=facePoint(a,{0,source.mouthY});auto mouth=tvg::Shape::gen();mouth->moveTo(center.x-width*.5f,center.y);
    mouth->cubicTo(center.x-width*.2f,center.y+a.mouthCurve*.16f,center.x+width*.2f,center.y+a.mouthCurve*.16f,center.x+width*.5f,center.y);
    mouth->strokeFill(ink.r,ink.g,ink.b);mouth->strokeWidth(.065f*a.lipFullness);mouth->strokeCap(tvg::StrokeCap::Round);scene->add(mouth);return scene;
}

tvg::Scene* characterHead(const Appearance& a)
{
    auto scene = tvg::Scene::gen();
    scene->add(characterHair(a,false)); scene->add(characterFace(a)); scene->add(characterHair(a,true)); scene->add(characterEars(a));
    return scene;
}

tvg::Scene* characterOutfit(const Appearance& a)
{
    auto scene = tvg::Scene::gen();
    for (const auto& raw : outfitSources[outfitIndex(a.outfitAsset)].paths) {
        auto shape = path(raw, [](Point p) { return p; });
        auto color = Rgb{uint8_t(raw.tone),uint8_t(raw.tone),uint8_t(raw.tone)};
        style(shape,raw,color);
        scene->add(shape);
    }
    scene->clip(path(outfitSources[outfitIndex(a.outfitAsset)].coverage,[](Point p){return p;}));
    auto holder=tvg::Scene::gen();holder->add(scene);return holder;
}

tvg::Scene* characterFigure(const Appearance& a)
{
    auto scene = tvg::Scene::gen(); scene->add(characterHair(a,false));
    float offset=outfitOffset(a);
    scene->add(polygon({{-.36f,chinBottom(a)-.6f},{.36f,chinBottom(a)-.6f},{.42f,4.8f+offset},{-.42f,4.8f+offset}},opaque(a.skin)));
    auto body=characterOutfit(a);body->translate(0,offset);scene->add(body); scene->add(characterFace(a)); scene->add(characterHair(a,true)); scene->add(characterEars(a));
    return scene;
}

CharacterBounds characterHeadBounds(const Appearance& a)
{
    auto frame=characterCranium(a);
    return {-std::max(5.f,frame.rightTemple.x+1),std::min(-6.f,frame.crown.y-2),std::max(5.f,frame.rightTemple.x+1),std::max(3.5f,chinBottom(a))};
}
}  // namespace hearthold

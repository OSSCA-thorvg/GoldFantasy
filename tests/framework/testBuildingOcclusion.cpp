#include <test/test.h>
#include <test/graphics.h>
#include <GameEngine/GameFramework/building_animation.h>
#include <GameEngine/GameFramework/building_depth.h>
#include <thorvg.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <memory>
#include <numbers>

namespace
{
using namespace gameframework;
struct WorldPoint { double x, y, z; };
struct RayPoint { double x, y, depth; };
struct Surface { std::vector<RayPoint> polygon; int material; };
struct Image { std::vector<uint32_t> pixels; int width, height; float scale; };

Model chimneyFixture()
{
    Block house{.1f,.1f,.9f,.9f,20,20,RoofShape::GableX,{210,45,35},{170,30,25},{210,45,35},{170,30,25}};
    Block chimney{.52f,.24f,.68f,.40f,18,0,RoofShape::Flat,{30,65,220},{25,45,170},{30,65,220},{25,45,170}};
    chimney.base = 20; chimney.delay = 16;
    return {{},{house,chimney}};
}

RayPoint projected(WorldPoint p, double angle)
{
    double c = std::cos(angle), s = std::sin(angle);
    double x = .5 + (p.x-.5)*c - (p.y-.5)*s;
    double y = .5 + (p.x-.5)*s + (p.y-.5)*c;
    return {(x-y)*32,(x+y)*16-p.z,x+y};
}

// Independent closed solids: neither framework face ordering nor BSP fragments are used here.
std::vector<Surface> surfaces(const Model& model, double angle)
{
    std::vector<Surface> result;
    for (size_t index = 0; index < model.blocks.size(); ++index) {
        const auto& b = model.blocks[index];
        double base=b.base, top=base+b.wall, peak=top+b.roof, mid=(b.y0+b.y1)/2;
        auto add = [&](std::initializer_list<WorldPoint> points) {
            Surface face{{},int(index+1)};
            for (auto p : points) face.polygon.push_back(projected(p,angle));
            result.push_back(std::move(face));
        };
        add({{b.x0,b.y0,base},{b.x1,b.y0,base},{b.x1,b.y0,top},{b.x0,b.y0,top}});
        add({{b.x0,b.y1,base},{b.x1,b.y1,base},{b.x1,b.y1,top},{b.x0,b.y1,top}});
        if (b.shape == RoofShape::GableX) {
            add({{b.x0,b.y0,base},{b.x0,b.y1,base},{b.x0,b.y1,top},{b.x0,mid,peak},{b.x0,b.y0,top}});
            add({{b.x1,b.y0,base},{b.x1,b.y1,base},{b.x1,b.y1,top},{b.x1,mid,peak},{b.x1,b.y0,top}});
            add({{b.x0,b.y0,top},{b.x1,b.y0,top},{b.x1,mid,peak},{b.x0,mid,peak}});
            add({{b.x0,b.y1,top},{b.x1,b.y1,top},{b.x1,mid,peak},{b.x0,mid,peak}});
        } else {
            add({{b.x0,b.y0,base},{b.x0,b.y1,base},{b.x0,b.y1,top},{b.x0,b.y0,top}});
            add({{b.x1,b.y0,base},{b.x1,b.y1,base},{b.x1,b.y1,top},{b.x1,b.y0,top}});
            add({{b.x0,b.y0,top},{b.x1,b.y0,top},{b.x1,b.y1,top},{b.x0,b.y1,top}});
        }
    }
    return result;
}

double cross(double ax,double ay,double bx,double by) { return ax*by-ay*bx; }
bool hit(const Surface& face,double x,double y,double& depth)
{
    const auto& p=face.polygon;
    for(size_t i=1;i+1<p.size();++i) {
        auto a=p[0],b=p[i],c=p[i+1];
        double d=cross(b.x-a.x,b.y-a.y,c.x-a.x,c.y-a.y);
        if(std::abs(d)<1e-9)continue;
        double u=cross(x-a.x,y-a.y,c.x-a.x,c.y-a.y)/d;
        double v=cross(b.x-a.x,b.y-a.y,x-a.x,y-a.y)/d;
        if(u>=-1e-7&&v>=-1e-7&&u+v<=1+1e-7){depth=a.depth+u*(b.depth-a.depth)+v*(c.depth-a.depth);return true;}
    }
    return false;
}
bool nearBoundary(const Surface& face,double x,double y)
{
    for(size_t i=0;i<face.polygon.size();++i) {
        auto a=face.polygon[i],b=face.polygon[(i+1)%face.polygon.size()];
        double dx=b.x-a.x,dy=b.y-a.y,denominator=dx*dx+dy*dy;
        double t=denominator?std::clamp(((x-a.x)*dx+(y-a.y)*dy)/denominator,0.,1.):0.;
        if(std::hypot(x-a.x-t*dx,y-a.y-t*dy)<.8)return true;
    }
    return false;
}
std::array<double,2> depthGradient(const Surface& face)
{
    const auto& p=face.polygon;
    for(size_t i=1;i+1<p.size();++i) {
        auto a=p[0],b=p[i],c=p[i+1];
        double bx=b.x-a.x,by=b.y-a.y,cx=c.x-a.x,cy=c.y-a.y,d=cross(bx,by,cx,cy);
        if(std::abs(d)>1e-9)return {((b.depth-a.depth)*cy-(c.depth-a.depth)*by)/d,
                                 (bx*(c.depth-a.depth)-cx*(b.depth-a.depth))/d};
    }
    return {};
}
Image raster(const RiseAnimation& rise,float frame)
{
    constexpr float scale=3;
    Image image{{},int(std::ceil(rise.width*scale)),int(std::ceil(rise.height*scale)),scale};
    image.pixels.resize(size_t(image.width)*image.height);
    std::unique_ptr<tvg::Animation> animation(tvg::Animation::gen());
    CHECK(animation->picture()->load(rise.json.data(),uint32_t(rise.json.size()),"lottie+json",nullptr,true)==tvg::Result::Success);
    if(animation->curFrame()!=frame)CHECK(animation->frame(frame)==tvg::Result::Success);
    animation->picture()->scale(scale);
    std::unique_ptr<tvg::SwCanvas> canvas(tvg::SwCanvas::gen(tvg::EngineOption::Default));
    CHECK(canvas->target(image.pixels.data(),image.width,image.width,image.height,tvg::ColorSpace::ARGB8888)==tvg::Result::Success);
    CHECK(canvas->add(animation->picture())==tvg::Result::Success);
    CHECK(canvas->draw(true)==tvg::Result::Success);CHECK(canvas->sync()==tvg::Result::Success);
    return image;
}
struct Comparison { int checked=0, wrong=0, coveredChimney=0, visibleChimney=0; };
Comparison compare(const Image& image,const RiseAnimation& rise,const std::vector<Surface>& geometry)
{
    Comparison count;
    for(int py=1;py<image.height;py+=3)for(int px=1;px<image.width;px+=3){
        double x=(px+.5)/image.scale-rise.originX,y=(py+.5)/image.scale-rise.originY;
        bool boundary=false, house=false,chimney=false;double nearest=-std::numeric_limits<double>::infinity();int material=0;
        const Surface* front=nullptr;
        for(const auto& face:geometry){
            if(nearBoundary(face,x,y)){boundary=true;break;}
            double depth;if(!hit(face,x,y,depth))continue;
            house|=face.material==1;chimney|=face.material==2;
            if(depth>nearest){nearest=depth;material=face.material;front=&face;}
        }
        if(boundary||!material)continue;
        // A pixel crossing a real solid intersection legitimately blends both materials.
        auto gradient=depthGradient(*front);
        for(const auto& face:geometry)if(face.material!=material) {
            double depth;if(!hit(face,x,y,depth))continue;
            auto other=depthGradient(face);double slope=std::hypot(gradient[0]-other[0],gradient[1]-other[1]);
            if(slope>1e-9&&std::abs(nearest-depth)/slope<.4){boundary=true;break;}
        }
        if(boundary)continue;
        auto pixel=image.pixels[size_t(py)*image.width+px];int r=(pixel>>16)&255,b=pixel&255;
        int actual=r>60&&r>b*1.5?1:b>60&&b>r*1.5?2:0;
        ++count.checked;if(actual!=material)++count.wrong;
        if(house&&chimney){if(material==1)++count.coveredChimney;else ++count.visibleChimney;}
    }
    return count;
}
Model constructionPose(Model model,float frame,float start)
{
    auto ease=[](float t) { t=std::clamp(t,0.f,1.f)-1;return 1+2.70158f*t*t*t+1.70158f*t*t; };
    for(auto& block:model.blocks) {
        float t=frame-start-block.delay;
        block.wall*=ease((t-6)/14);block.roof*=ease((t-16)/12);
    }
    return model;
}
}

TEST(framework_building_chimney_occlusion_matches_independent_closed_solid_rays)
{
    te::test::Graphics runtime(false);
    auto model=chimneyFixture();int covered=0,visible=0;
    for(float degrees:{0.f,30.f,44.9f,45.1f,90.f,135.f,180.f,225.f,270.f,315.f}) {
        float angle=degrees*std::numbers::pi_v<float>/180;
        auto rise=buildingRiseAnimation(model,1,{},angle);
        auto counts=compare(raster(rise,rise.frames-1),rise,surfaces(model,angle));
        CHECK(counts.checked>300);
        if(counts.wrong)std::cerr<<"occlusion angle="<<degrees<<" wrong="<<counts.wrong<<" checked="<<counts.checked<<'\n';
        CHECK_EQ(counts.wrong,0);
        covered+=counts.coveredChimney;visible+=counts.visibleChimney;
        auto still=buildingStillAnimation(model,1,angle);
        auto staticCounts=compare(raster(still,0),still,surfaces(model,angle));
        CHECK(staticCounts.checked>300);CHECK_EQ(staticCounts.wrong,0);
    }
    CHECK(covered>50);CHECK(visible>50);
}

TEST(framework_building_depth_fragments_match_closed_solid_ray_intersections)
{
    auto source=chimneyFixture();
    for(float degrees:{0.f,30.f,44.9f,45.1f,90.f,135.f,180.f,225.f,270.f,315.f}) {
        float angle=degrees*std::numbers::pi_v<float>/180;
        auto model=source;int quarter;float residual;
        splitAngle(angle,quarter,residual);orientModel(model,quarter,1);
        Motion motion;motion.turn=residual;motion.pivot={.5f,.5f};
        std::vector<Face> faces;buildingFaces(model,motion,faces);
        auto ordered=depthOrder(faces,1000);
        std::vector<Surface> painted;
        for(const auto& fragment:ordered)if(!fragment.line) {
            Surface surface{{},faces[fragment.source].color.b>faces[fragment.source].color.r?2:1};
            for(auto p:fragment.polygon)surface.polygon.push_back({p.x,p.y,p.depth});
            painted.push_back(std::move(surface));
        }
        auto geometry=surfaces(source,angle);int wrong=0,checked=0;
        for(double y=-60.37;y<30;y+=1.1)for(double x=-50.21;x<50;x+=1.1) {
            int expected=0,actual=0;double nearest=-std::numeric_limits<double>::infinity();bool boundary=false;
            for(const auto& face:geometry) {
                if(nearBoundary(face,x,y)){boundary=true;break;}
                double depth;if(hit(face,x,y,depth)&&depth>nearest){nearest=depth;expected=face.material;}
            }
            if(boundary||!expected)continue;
            for(const auto& face:painted){double depth;if(hit(face,x,y,depth))actual=face.material;}
            ++checked;if(actual!=expected)++wrong;
        }
        CHECK(checked>300);CHECK_EQ(wrong,0);
    }
}

TEST(framework_building_construction_and_upgrade_recompute_intersection_depth)
{
    te::test::Graphics runtime(false);auto model=chimneyFixture();
    for(bool upgrade:{false,true})for(float degrees:{15.f,75.f,150.f,255.f}) {
        float angle=degrees*std::numbers::pi_v<float>/180,start=upgrade?10:0;
        std::vector<BuildingStage> old;if(upgrade)old.push_back({model,1,0,0});
        auto rise=buildingRiseAnimation(model,1,old,angle);
        for(float age:{24.f,27.f,27.5f,31.f,40.f}) {
            auto pose=constructionPose(model,std::floor(age)+start,start);
            auto counts=compare(raster(rise,age+start),rise,surfaces(pose,angle));
            CHECK(counts.checked>250);
            if(counts.wrong)std::cerr<<"construction angle="<<degrees<<" upgrade="<<upgrade<<" frame="<<age+start<<" wrong="<<counts.wrong<<'\n';
            CHECK_EQ(counts.wrong,0);
        }
    }
}

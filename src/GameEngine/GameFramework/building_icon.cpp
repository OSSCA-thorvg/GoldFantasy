#include "building_icon.h"
#include "building_asset.h"
#include "building_faces.h"
#include "building_depth.h"
#include <algorithm>
#include <limits>
#include <cmath>
#include <stdexcept>

namespace gameframework
{
tvg::Scene* buildingIcon(const Model& source, float size, float width, float height, float angle, BuildingProjection projection)
{
    std::string error;
    if (!validateBuildingAsset({"preview", "Preview", size, {source}}, error)) throw std::invalid_argument(error);
    if (!std::isfinite(angle) || !std::isfinite(width) || !std::isfinite(height) || width <= 0 || height <= 0 ||
        !std::isfinite(projection.halfWidth) || !std::isfinite(projection.halfHeight) || projection.halfWidth <= 0 || projection.halfWidth > 512 ||
        projection.halfHeight <= 0 || projection.halfHeight > 512) throw std::invalid_argument("invalid building icon dimensions");
    auto model = source;
    int quarter = 0; float turn = 0;
    splitAngle(angle, quarter, turn);
    orientModel(model, quarter, size);
    Motion still;
    still.turn = turn;
    still.projection = projection;
    still.pivot = {size / 2, size / 2};
    std::vector<Face> faces;
    buildingFaces(model, still, faces);
    constexpr float done = 1000;  // Long after every part has risen.
    auto batches = depthBatches(faces, done);
    if (batches.empty()) return tvg::Scene::gen();
    float minX = std::numeric_limits<float>::max(), minY = minX, maxX = -minX, maxY = -minX;
    for (const auto& batch : batches) {
        for (const auto& polygon : batch.polygons) for (auto p : polygon) {
            minX = std::min(minX, p.x), maxX = std::max(maxX, p.x);
            minY = std::min(minY, p.y), maxY = std::max(maxY, p.y);
        }
    }
    float k = std::min(width / std::max(1.f, maxX - minX), height / std::max(1.f, maxY - minY));
    auto icon = tvg::Scene::gen();
    for (const auto& batch : batches) {
        const auto& face = faces[batch.source];
        float alpha = face.opacity.empty() ? 1 : face.opacity.back().second / 100;
        if (alpha <= 0) continue;
        auto shape = tvg::Shape::gen();
        for (const auto& polygon : batch.polygons) {
            shape->moveTo((polygon[0].x - minX) * k, (polygon[0].y - minY) * k);
            for (size_t j = 1; j < polygon.size(); ++j) shape->lineTo((polygon[j].x - minX) * k, (polygon[j].y - minY) * k);
            if (!batch.line) shape->close();
        }
        uint8_t a = uint8_t(255 * alpha);
        if (batch.line) {
            bool outline = face.style == Face::Style::Outlined;
            auto color = outline ? Rgb{20, 18, 24} : face.color;
            shape->strokeWidth(std::max(outline ? .5f : .6f, (outline ? 1.2f : face.width) * k));
            shape->strokeCap(tvg::StrokeCap::Round);
            shape->strokeJoin(tvg::StrokeJoin::Round);
            shape->strokeFill(color.r, color.g, color.b, a);
        } else {
            shape->fill(face.color.r, face.color.g, face.color.b, a);
        }
        icon->add(shape);
    }
    // Centre the picture in its box.
    icon->translate((width - (maxX - minX) * k) / 2, (height - (maxY - minY) * k) / 2);
    return icon;
}
}  // namespace gameframework

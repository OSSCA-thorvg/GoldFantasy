#pragma once

#include "climate.h"
#include "vector_paint.h"
#include "world_map.h"
#include <array>
#include <vector>

namespace hearthold
{
// The trees by where they stand: the plain triangle fir in Midgard's mild woods, snow-laden spruce on the
// frost and dead snags on the ash by the lava.
enum class TreeKind : uint8_t { Fir, SnowySpruce, Snag };

struct Tree
{
    TreeKind kind = TreeKind::Fir;
    Point foot;          // Where it stands, in tiles.
    float size = 1;      // A grown tree is 1; saplings about half that and old giants half as much again.
    float slender = 1;   // Its height over the usual height for its width.
    float lean = 0;      // How far its top leans east, in pixels at size 1.
    float variant = 0;   // 0..1, for the small choices that set one tree of a kind apart.
};

// The `index`th tree of cell (x, y): where in the cell it stands, its kind and its size. Stable per seed.
Tree treeAt(const WorldMap&, int x, int y, int index);

// Trees batched into a few shapes by colour, so a row of forest costs a handful of paths. Lit from the west
// and dressed for the season: firs brown a little in autumn and carry snow in winter.
class TreeBatch
{
public:
    explicit TreeBatch(const Climate&);
    TreeBatch(const TreeBatch&) = delete;
    TreeBatch& operator=(const TreeBatch&) = delete;
    ~TreeBatch();
    void add(const Tree&);
    // Hands over the shapes that hold anything, in drawing order, shaded for a row whose ground line lies at
    // screen y `base` at zoom 1.
    std::vector<tvg::Shape*> finish(float base);

private:
    enum Part { Dead, Stems, Lit, Shade, SnowShade, SnowLit, Parts };
    void fir(Point base, const Tree&);
    void spruce(Point base, const Tree&);
    void snag(Point base, const Tree&);

    Climate climate;
    bool snowy;
    std::array<tvg::Shape*, Parts> parts{};
};
}  // namespace hearthold

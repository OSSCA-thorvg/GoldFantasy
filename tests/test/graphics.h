#pragma once

namespace te::test
{
class Graphics
{
public:
    explicit Graphics(bool loadFonts = true);
    ~Graphics();
    Graphics(const Graphics&) = delete;
    Graphics& operator=(const Graphics&) = delete;
private:
    bool fonts;
};
}  // namespace te::test

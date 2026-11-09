# Midgard — licenses and third-party notices

Midgard's project license is [GNU GPL version 3](LICENSE.txt). The complete project license remains unchanged from the source repository. The components and assets below retain their own notices.

## Rendering

[ThorVG WebCanvas](https://github.com/thorvg/thorvg.web), package `@thorvg/webcanvas` version 1.1.3, supplies the vector rendering engine. Copyright © 2023–2026 ThorVG Project. It is distributed under the [MIT license](licenses/ThorVG-WebCanvas-1.1.3.txt), copied verbatim from the installed package. The build also includes that notice alongside the WebAssembly rendering module.

## Fonts

The game loads **DejaVu Sans** and **DejaVu Sans Bold** from `assets/native-fonts/`. The fonts retain the Bitstream Vera font license; DejaVu changes are in the public domain. See the [complete font notice](assets/native-fonts/DejaVuSans.LICENSE) and the [DejaVu project](https://dejavu-fonts.github.io/).

## Lua extension interpreter

The optional original HUD scripting extension uses **Lua 5.4.8**, compiled to WebAssembly. The game logic and interpreter bridge are TypeScript. Copyright © 1994–2025 Lua.org, PUC-Rio. Lua is distributed under its [MIT license](licenses/Lua-5.4.8.txt). See [Lua's license and copyright](https://www.lua.org/license.html).

## Original sound and artwork

Music, environmental sounds, effects and generated voice banks retain the [original audio provenance and licensing notice](assets/audio/NOTICE.md). That notice identifies the Loach procedural packs, the CC0 dedication for the Nature of Greoni pack and generated cat call, and the Qwen3-TTS voice-generation provenance. These sounds are shipped as original Ogg assets and/or PCM decoded from those assets; no speech model runs in the game.

Building, character, wildlife and world vector artwork is carried over from the original game source under the project license. Midgard's display name does not change those assets' provenance or licensing.

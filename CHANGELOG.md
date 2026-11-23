# Changelog

Changes that matter when you integrate the SDK and prepare your build.

## 2.1.0-beta.5

- **Editor window redesign.** *Home* gives an overview (status, setup checks, quick actions). The **Optimize Wizard** walks through six steps, one at a time: Build & Analyze, Textures, Audio, Shaders & Fonts, Test (QA tool), Release build.
- **Two builds.** A fast *analysis build* finds the assets worth optimizing (your settings are restored afterwards). The *release build* uses your choices; only four size options are editable: compression, managed stripping, IL2CPP code generation and decompression fallback.
- **QA tool.** Opens your build in the browser and guides you through the checks one step at a time: SDK start, saving and loading, interstitial and rewarded ads, pause and mute, and screen layouts. Start it from *Home* or from the wizard, and export the report when every step passes.
- **Optimizers.** Texture, audio, shader and font tools preview each change before applying it and support undo.
- **Neutral build.** Your build contains no portal SDK and no platform defines. The `H5SDK` API is unchanged.

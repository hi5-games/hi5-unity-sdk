# Changelog

Changes that matter when you integrate the SDK and prepare your build.

## 2.1.0

First official release. Includes everything from the 2.1 betas, plus:

- **QA tool.** Redesigned to follow a guided, step-by-step certification flow, with a manual mode for free testing. Includes mute-after-reload and pause/mute confirmation checks.
- **Update check.** The Editor warns when a newer SDK release is available, and the SDK window offers an **Update** button.
- **Install.** Add the package from `https://github.com/hi5-games/hi5-unity-sdk.git` (no tag) to always get the latest release.

## 2.1.0-beta.5

- **Editor window redesign.** *Home* gives an overview (status, setup checks, quick actions). The **Optimize Wizard** walks through six steps, one at a time: Build & Analyze, Textures, Audio, Shaders & Fonts, Test (QA tool), Release build.
- **Two builds.** A fast *analysis build* finds the assets worth optimizing (your settings are restored afterwards). The *release build* uses your choices; only four size options are editable: compression, managed stripping, IL2CPP code generation and decompression fallback.
- **QA tool.** Opens your build in the browser and guides you through the checks one step at a time: SDK start, saving and loading, interstitial and rewarded ads, pause and mute, and screen layouts. Start it from *Home* or from the wizard, and export the report when every step passes.
- **Optimizers.** Texture, audio, shader and font tools preview each change before applying it and support undo.
- **Neutral build.** Your build contains no portal SDK and no platform defines. The `H5SDK` API is unchanged.

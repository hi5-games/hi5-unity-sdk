<p align="center">
  <img src="Documentation~/Images/hi5-games-logo.jpg" alt="Hi5 Games" width="320">
</p>

# Hi5 Games Unity SDK

**Build your Unity WebGL game once. We take it to every H5 portal.**

![Release](https://img.shields.io/github/v/tag/hi5-games/hi5-unity-sdk?label=release)
![Unity](https://img.shields.io/badge/Unity-6000.3%2B-black)
![Node](https://img.shields.io/badge/Node.js-18%2B-339933)

[Documentation](Documentation~/README.md) · [Setup](Documentation~/Setup.md) · [API reference](Documentation~/API-Reference.md) · [QA tool](Documentation~/QA-Tool.md)

## Quick start

1. Open **Window > Package Manager**, click **+** and choose **Install package from git URL…**, then paste:

   ```
   https://github.com/hi5-games/hi5-unity-sdk.git
   ```

   This installs the latest release. If your installed version falls behind, the SDK warns in the Console and shows an **Update** button in **H5 Platform SDK > Open**. Wait for compilation to finish. The package installs its own dependencies.

2. Open **H5 Platform SDK > Open**. On **Home**, make every item **OK**: WebGL is the active target, `H5SdkConfig` exists, a scene is enabled, and the `H5Neutral` WebGL template is installed (click **Install**).

3. Replace any mobile or portal SDK calls with the single `H5SDK` class:

   ```csharp
   using H5PlatformSDK;

   void Start()
   {
       if (H5SDK.IsReady) OnSdkReady(); else H5SDK.OnReady += OnSdkReady;
       H5SDK.OnPauseRequested += paused => Time.timeScale = paused ? 0f : 1f;
       H5SDK.OnMuteRequested  += muted  => AudioListener.pause = muted;
   }

   void OnSdkReady()
   {
       H5SDK.OnReady -= OnSdkReady;
       H5SDK.LoadData("progress", (ok, json) => { /* ok == false: no save yet */ });
       H5SDK.GameReady();   // call once, when loading is done and the game is interactive
   }

   void OnLevelEnd() => H5SDK.ShowInterstitial("level_end", () => { /* continue the game */ });
   ```

4. Open **Optimize Wizard** and go through the six steps: a quick analysis build, textures, audio, shaders and fonts, a test in the QA tool, then **Build for Release** (the wizard selects the `H5Neutral` template for you).

5. Test in the browser: on **Home** click **Test with QA tool** (or wizard step 5). Check the screen sizes, the ads and the saves, then press **Export report**. See the [QA tool guide](Documentation~/QA-Tool.md).

6. Zip the WebGL build folder (the one with `index.html` and `Build/`) and send it to us together with the exported QA report (`qa-report-<game name>.json`).

### Next steps

Every method is listed in the [API reference](Documentation~/API-Reference.md).

## Developer tools

### H5 QA tool

Opens your build in the browser the way a portal would. It shows automatic checks (SDK start, `GameReady()`, ads, pause and mute, saves), lets you choose what the next ad does, and previews phone, tablet and landscape sizes. Start it from **Home > Test with QA tool**. See the [QA tool guide](Documentation~/QA-Tool.md).

### Build optimizer

The **H5 Platform SDK** window previews every change before it applies it, supports undo, and reports download size, size by asset type and the largest assets after each build. See [Optimizing the WebGL build](Documentation~/Optimization.md).

## Features

| Module | What it gives you |
|---|---|
| **Ads** | Interstitial and rewarded ads with a strict callback contract (a close callback always fires, rewards only on a real view), plus banners |
| **Game lifecycle** | `GameReady`, level started/completed/failed, pause/resume, restart events |
| **Pause and mute** | Platform pause and mute requests delivered as events for you to apply |
| **Storage** | Asynchronous `SaveData` / `LoadData` that persists across page reloads |
| **Player and locale** | Player name and language, with a fallback when the platform has none |
| **Editor simulation** | Ads and saves are simulated in Play Mode, so you can test without a WebGL build |
| **Neutral build** | No portal SDK and no platform defines in your build: the same build works for every portal |

See the [API reference](Documentation~/API-Reference.md) for details.

## Links

- [Documentation index](Documentation~/README.md)
- [Getting started](Documentation~/Getting-Started.md)
- [Setup](Documentation~/Setup.md)
- [Config](Documentation~/Config.md)
- [API reference](Documentation~/API-Reference.md)
- [Changelog](CHANGELOG.md)

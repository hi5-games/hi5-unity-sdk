# Setup

## 1. Installation

1. In Unity, open **Window > Package Manager**.
2. Click **+** and choose **Install package from git URL…**.
3. Paste the URL below and click **Add**:

   ```
   https://github.com/hi5-games/hi5-unity-sdk.git
   ```

   `#<tag>` pins a release. Use the tag we gave you, and keep it the same for the whole project.

4. Wait for Unity to finish compiling. The Console must show no errors. The package installs its own dependencies (`com.unity.ugui` and `com.unity.nuget.newtonsoft-json`).

Two project-owned files appear in your project: `Assets/Resources/H5SdkConfig.asset` and, after the next step, `Assets/WebGLTemplates/H5Neutral`.

## 2. WebGL template and project check

1. Open **H5 Platform SDK > Open**.
2. On the **Home** tab every item must show **OK**:
   - WebGL is the active build target.
   - `H5SdkConfig` exists.
   - The `H5Neutral` WebGL template is installed. If it shows **TODO**, click **Install**.
   - At least one scene is enabled in Build Settings.

Do not edit or remove the markers `<!-- H5:HEAD -->` and `<!-- H5:BODY_END -->` in `Assets/WebGLTemplates/H5Neutral/index.html`. We need them to package your build.

## 3. Initialization

There is nothing to initialize by hand. The SDK starts itself before the first scene loads, and you do not need a GameObject in your scene.

Your code only has to wait for it:

```csharp
using H5PlatformSDK;

void Start()
{
    if (H5SDK.IsReady) OnSdkReady();
    else H5SDK.OnReady += OnSdkReady;
}

void OnSdkReady()
{
    H5SDK.OnReady -= OnSdkReady;
    // Load saves, then call H5SDK.GameReady().
}
```

In the Unity Editor the SDK runs a simulation. `OnReady` fires after about half a second, ads succeed, and saves are kept in memory. Press Play and watch the Console for `[H5SDK]` logs.

## 4. Build

Open **H5 Platform SDK > Open > Optimize Wizard**. It walks you through six steps, one at a time:

1. **Build & Analyze**: a quick build with a fixed fast configuration (no compression). Its only purpose is the report of which assets are worth optimizing. Your own settings are not changed, and you must not send this build.
2. **Textures**, 3. **Audio**, 4. **Shaders & Fonts**: each tab previews its changes and applies nothing until you confirm. See [Optimizing the WebGL build](Optimization.md).
5. **Test (QA)**: opens the build in the [QA tool](QA-Tool.md) (SDK integration, ads flow, landscape and portrait, window resize).
6. **Release build**: choose the size options for your game, then click **Build for Release**.

The options on the last step are the ones that are a real trade-off:

| Setting | Recommended |
|---|---|
| Compression format | Brotli |
| Managed stripping level | Medium (`High` is smaller but can break reflection) |
| IL2CPP code generation | OptimizeSize |
| Exception support | None (use *ExplicitlyThrownExceptionsOnly* if your game catches exceptions) |

Pick any value; the recommended one is a suggestion, not a rule. The release build always uses what a portal build needs: no development mode, the JS decompression fallback on (so it loads on hosts that do not send `Content-Encoding`), and the IL2CPP Release configuration.

The build is written to `Builds/None/WEBGL_release_<timestamp>/`. Unity may recompile first (the SDK removes legacy platform defines and installs the `H5Neutral` template); run the build again when it finishes. Packaging for portals is done by Hi5 Games.

## 5. Test your build

Set the path to the command-line tool once per terminal session:

```bash
H5PKG=$(cat Library/H5PlatformSDK/package-dir.txt 2>/dev/null || ls -d Library/PackageCache/com.hi5games.h5platformsdk@* 2>/dev/null | head -1)
H5CLI="$H5PKG/Tools~/h5-packager/bin/h5-packager.js"
```

Run the QA tool on the build you just made:

```bash
node "$H5CLI" qa --in Builds/None/WEBGL_<timestamp> --open   # opens http://localhost:8080
```

The QA tool checks the SDK integration in a browser. See the [QA tool guide](QA-Tool.md).

## 6. Required steps

Your game must complete the steps listed on [Required steps](API-Reference.md#required-steps) before we can accept the build.

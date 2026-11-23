# Config

## SDK settings (`H5SdkConfig`)

The settings live in `Assets/Resources/H5SdkConfig.asset`. The SDK creates the file for you. Edit it in **H5 Platform SDK > Open**, or select the asset and use the Inspector.

| Field | Default | Description |
|---|---|---|
| `verboseLogging` | `true` | Prints `[H5SDK]` logs to the Console and the browser console. Turn it off for the final release build. |
| `editorSimulatedAdDelaySeconds` | `0.5` | How long the Editor simulation waits before it fires `OnReady` and resolves an ad. Editor only. |
| `minInterstitialIntervalSeconds` | `0` | Minimum seconds between two interstitials. A call inside the window is skipped and the game continues (the close callback still fires). `0` turns the limit off. |

The asset has other fields for individual portals. Leave them empty. We fill them in when we package your build.

## Build settings

The Player Settings that affect download size and load time (compression, stripping, exceptions) are on the last step of **H5 Platform SDK > Open > Optimize Wizard** (also in the **Build Settings** tab), each with the recommended value. See [Setup](Setup.md#4-build) for the summary and [Optimizing the WebGL build](Optimization.md) for the full workflow.

## WebGL template

Use the `H5Neutral` template. Do not add portal scripts to it and do not remove the `<!-- H5:HEAD -->` and `<!-- H5:BODY_END -->` markers. A build made with another template cannot be packaged.

## Scripting defines

A neutral build must not define any per-platform symbol such as `<PORTAL>_BUILD`. The release build removes them for you.

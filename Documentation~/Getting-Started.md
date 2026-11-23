# Getting started

The Hi5 Games Unity SDK lets you build your Unity WebGL game **once** and hand it to us. We package that single build for every H5 portal. You never integrate a portal SDK, and you never make a build per portal.

## How it works

1. Your game code calls one static class, `H5SDK`, for ads, saves, pause/mute and lifecycle events.
2. You make a **neutral** WebGL build with the `H5Neutral` template. It contains no portal SDK and no platform defines.
3. You test that build locally with the QA tool and send it to us.
4. We add the right portal adapter and produce one package per portal.

```
Your game ──► H5SDK ──► neutral WebGL build ──► (Hi5 Games) ──► one package per portal
```

## Requirements

- Unity **6000.3** or newer, with the WebGL build module installed.
- Node.js **18** or newer (used by the QA tool). Check with `node -v`.
- A game that already runs in a desktop browser or a WebGL build.

## Your path

| Step | What you do | Page |
|---|---|---|
| 1 | Install the package and prepare the project | [Setup](Setup.md) |
| 2 | Set the few options you may need | [Config](Config.md) |
| 3 | Call `H5SDK` from your game, starting with the required steps | [API reference](API-Reference.md) |
| 4 | Make the build smaller and faster to load | [Optimizing the WebGL build](Optimization.md) |
| 5 | Test the build and fix every failed check | [QA tool](QA-Tool.md) |
| 6 | Zip the build folder and send it to us with `qa-report.json` | see below |

## What to send us

- The WebGL build folder (it contains `index.html` and `Build/`), zipped.
- The `qa-report.json` written by the QA tool.
- The Unity version and the SDK version you used (for example `6000.3.2f1` and `2.1.0-beta.4`).

Do not send source code, and do not include any portal SDK in your build.

## Need help?

Run the checks in the QA tool first; a failed check says what to fix. If you are still stuck, contact us with the QA report.

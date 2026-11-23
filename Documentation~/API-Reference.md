# API reference

Namespace `H5PlatformSDK`. The static class `H5SDK` is the **only** API your game code should use.

- Every method is safe to call before the SDK is ready (it logs a warning and calls the failure callback where one exists) and in the Unity Editor (simulated).
- Call everything from the Unity main thread.
- Never add `#if` branches per platform. Ask the SDK at runtime if behaviour must differ (for example `H5SDK.IsBannerSupported`).

## Required steps

Your build is accepted only when it does all of these. The QA tool checks each one.

| # | Step | How | Page |
|---|---|---|---|
| 1 | Wait for the SDK before you load saves or show ads | `H5SDK.OnReady` / `H5SDK.IsReady` | [Platform](api/platform.md) |
| 2 | Load saves with `LoadData` and save progress with `SaveData` | Not `PlayerPrefs` for progress | [Storage](api/storage.md) |
| 3 | Call `GameReady()` exactly once, after loading and saves are done | `H5SDK.GameReady()` | [Game events](api/game-events.md) |
| 4 | Show interstitials at natural breaks and continue the game in the close callback | `H5SDK.ShowInterstitial(placement, onClosed)` | [Interstitial](api/advertisement/interstitial.md) |
| 5 | Pause the game and mute audio when the platform asks, then restore the exact previous state | `OnPauseRequested`, `OnMuteRequested` | [Platform](api/platform.md#pause-and-mute) |
| 6 | If the game has rewarded ads, grant the reward only in the success callback | `H5SDK.ShowRewarded(onRewarded, onFailedOrClosed)` | [Rewarded](api/advertisement/rewarded.md) |
| 7 | Remove or hide every real-money purchase | Games for H5 portals must not contain in-app purchases | |

## Modules

| Module | Description |
|---|---|
| [Platform](api/platform.md) | Ready state, pause and mute requests, audio, diagnostics |
| [Storage](api/storage.md) | `SaveData` and `LoadData` |
| [Advertisement](api/advertisement.md) | Overview of ad calls and rules |
| [Interstitial](api/advertisement/interstitial.md) | Full-screen ads between game moments (required) |
| [Rewarded](api/advertisement/rewarded.md) | Ads the player chooses to watch for a reward |
| [Banner](api/advertisement/banner.md) | Banner ads |
| [Player](api/player.md) | Player name and language |
| [Game events](api/game-events.md) | `GameReady`, level and navigation events |

## Timing cheat-sheet

1. The scene loads. The SDK has already started by itself, so no GameObject is needed.
2. `OnReady` fires. Load saves, call `GameReady()`, then show a banner if you use one.
3. During play, call `LevelStarted`, then `LevelCompleted` or `LevelFailed`. Show an interstitial at a natural break, never in the middle of a level.
4. Ads arrive together with pause and mute events. Ad callbacks can come after the game was paused, so do not rely on a fixed order.

## Minimal example

```csharp
using H5PlatformSDK;
using UnityEngine;

public class H5Integration : MonoBehaviour
{
    void Start()
    {
        H5SDK.OnPauseRequested += paused => Time.timeScale = paused ? 0f : 1f;
        H5SDK.OnMuteRequested  += muted  => AudioListener.pause = muted;

        if (H5SDK.IsReady) OnSdkReady(); else H5SDK.OnReady += OnSdkReady;
    }

    void OnSdkReady()
    {
        H5SDK.OnReady -= OnSdkReady;
        H5SDK.LoadData("progress", (ok, json) => { /* ok == false: no save yet, start fresh */ });
        H5SDK.GameReady();
    }

    public void OnLevelWin(string level)
    {
        H5SDK.LevelCompleted(level);
        H5SDK.ShowInterstitial("level_end", () => { /* open the next level */ });
    }

    public void OnWatchAdButton(System.Action grantReward) =>
        H5SDK.ShowRewarded(onRewarded: grantReward,
                           onFailedOrClosed: () => { /* show a "no ad available" message */ },
                           placement: "reward");
}
```

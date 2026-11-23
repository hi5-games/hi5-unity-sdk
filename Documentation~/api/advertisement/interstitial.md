# Interstitial

A full-screen ad shown at a natural break in the game. This page is **required**.

```csharp
static void ShowInterstitial(string placement = null)
static void ShowInterstitial(string placement, Action onClosed)
```

| Overload | Use it when |
|---|---|
| `ShowInterstitial(placement)` | You do not need to know when the ad is over. |
| `ShowInterstitial(placement, onClosed)` | The game flow continues after the ad. This is the one to use. |

## The close callback

`onClosed` is called **exactly once**, whatever happens:

- the ad was shown and closed,
- the call was skipped because of a cooldown or `minInterstitialIntervalSeconds`,
- there was no ad to show,
- an error occurred, or the SDK was not ready.

Always continue the game in `onClosed`. Never wait for an ad that may not come, or the game can hang on a loading or transition screen.

## Example

```csharp
public void OnLevelWin(string level)
{
    H5SDK.LevelCompleted(level);
    H5SDK.ShowInterstitial("level_end", () => OpenNextLevel());
}
```

## Pause and mute

While the ad is on screen the SDK raises `OnPauseRequested(true)` and `OnMuteRequested(true)`, then `false` afterwards. Your handlers from [Platform](../platform.md#pause-and-mute) do the work. Do not pause and mute the game a second time in your own code, because you would then restore the wrong state.

## What the QA tool checks

- No interstitial is shown before `GameReady()`.
- An interstitial shows and closes, and the game continues.
- The game is silent and paused while the ad is on screen, and resumes afterwards.

# Platform

Ready state, pause and mute requests, audio and diagnostics. This page is **required**.

## Ready state

| Member | Description |
|---|---|
| `static bool IsReady` | `true` after the platform adapter is initialised. Saves and ads before this are unreliable. |
| `static event Action OnReady` | Fires once when the SDK is ready. Subscribe in `Start`. If `IsReady` is already `true`, run your code directly. |

```csharp
void Start()
{
    if (H5SDK.IsReady) OnSdkReady(); else H5SDK.OnReady += OnSdkReady;
}
```

## Pause and mute

The platform asks your game to stop and to be silent while an ad or an overlay is on screen, and when the browser tab is hidden.

| Member | Description |
|---|---|
| `static event Action<bool> OnPauseRequested` | `true`: stop the simulation. `false`: resume. Typically `Time.timeScale = paused ? 0 : 1`. |
| `static event Action<bool> OnMuteRequested` | `true`: mute all audio. `false`: restore it. |
| `static bool IsPaused` | The latest pause state the platform requested. Use it if you prefer polling to events. |
| `static bool IsMuted` | The latest mute state the platform requested. |

```csharp
H5SDK.OnPauseRequested += paused => Time.timeScale = paused ? 0f : 1f;
H5SDK.OnMuteRequested  += muted  => AudioListener.pause = muted;
```

Rules that the QA tool checks:

- The game must be silent and paused while an ad is on screen, and must resume afterwards.
- Restore the exact previous state. If the player had muted the game, it must stay muted after the ad. If the player had paused the game, do not resume it.
- Resuming after an ad must not open your own pause popup.

## Audio

`static void SetAudioMute(bool muted)` tells the platform about the game's own mute toggle. Call it when the player changes your in-game sound setting, so the platform's sound button stays in sync.

## Diagnostics

| Member | Description |
|---|---|
| `static bool IsBannerSupported` | The platform can show a banner. |
| `static bool IsAdvancedBannersSupported` | The platform can show side-docked banners. |
| `static bool IsAdBlockDetected` | Best effort. It can be `false` even if ads are blocked. |
| `static H5Platform ActivePlatform` | `None` in the Editor. For logs and analytics only. **Never branch game logic on it.** |
| `static string DebugStatusString()` | One line of SDK state for a debug overlay or log. |

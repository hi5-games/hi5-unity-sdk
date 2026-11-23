# Advertisement

Ads are shown by the platform, so the platform decides whether an ad actually appears (cooldowns, no fill). Your game must keep working in every case.

| Type | Required | Call | Page |
|---|---|---|---|
| Interstitial | Yes | `ShowInterstitial(placement, onClosed)` | [Interstitial](advertisement/interstitial.md) |
| Rewarded | Only if your game uses rewards | `ShowRewarded(onRewarded, onFailedOrClosed, placement)` | [Rewarded](advertisement/rewarded.md) |
| Banner | No | `ShowBanner(position)` / `HideBanner()` | [Banner](advertisement/banner.md) |

## Rules for every ad type

- Do not show an ad before `H5SDK.IsReady`, and do not show an interstitial before `GameReady()`.
- While an ad is on screen you receive `OnPauseRequested(true)` and `OnMuteRequested(true)`, then `false` when it ends. See [Platform](platform.md#pause-and-mute).
- `placement` is an optional label used for reporting, for example `"level_end"`. It is never required.
- Show ads at natural breaks (level end, return to the menu), not in the middle of play.
- Agree the ad scenario with your Hi5 Games contact before you build it: from which level the first interstitial appears, at which moment it shows, the minimum time between two ads, and whether the game has a banner. The time limit between interstitials can be enforced by the SDK with `minInterstitialIntervalSeconds` in [Config](../Config.md).
- In the Unity Editor, an interstitial only logs, and a rewarded ad succeeds after `editorSimulatedAdDelaySeconds`.

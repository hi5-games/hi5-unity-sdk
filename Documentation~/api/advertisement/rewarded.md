# Rewarded

An ad the player chooses to watch in exchange for a reward. Use it only if your game has rewards.

```csharp
static void ShowRewarded(Action onRewarded, Action onFailedOrClosed, string placement = null)
```

## The reward contract

Exactly **one** of the two callbacks is called:

| Callback | When |
|---|---|
| `onRewarded` | The platform confirms the player watched the ad to the end. Grant the reward here and only here. |
| `onFailedOrClosed` | Anything else: the player closed the ad early, there was no ad, an error occurred, or the SDK was not ready. Grant nothing. |

Never grant the reward in both callbacks, and never in neither.

## Example

```csharp
public void OnWatchAdButton()
{
    H5SDK.ShowRewarded(
        onRewarded: () => AddCoins(100),
        onFailedOrClosed: () => ShowMessage("No ad available right now."),
        placement: "shop_coins");
}
```

## Notes

- Show the watch button only where a reward makes sense. If the ad is not available, `onFailedOrClosed` is called, so the button must handle that case.
- The SDK raises pause and mute requests while the ad is on screen. See [Platform](../platform.md#pause-and-mute).
- In the Unity Editor the rewarded ad succeeds after `editorSimulatedAdDelaySeconds`.
- The QA tool lets the tester choose the result (watched, closed early, no fill) and checks that the game keeps working. Whether the game really granted the reward is a manual check.

# Banner

A persistent ad at the top or bottom of the screen. Banners are optional.

```csharp
static void ShowBanner(BannerPosition position = BannerPosition.Bottom)   // Top | Bottom
static void HideBanner()
static void ShowAdvancedBanners(string placement = null)
static void HideAdvancedBanners()
```

| Member | Description |
|---|---|
| `ShowBanner(position)` | Shows a banner. The position is honoured where the platform allows it. |
| `HideBanner()` | Hides it. |
| `ShowAdvancedBanners` / `HideAdvancedBanners` | Side-docked banners on platforms that support them. They do nothing elsewhere. |
| `IsBannerSupported` | `true` if the platform can show a banner. |
| `IsAdvancedBannersSupported` | `true` if the platform can show side-docked banners. |

## Rules

- Call `ShowBanner` after `OnReady`. A good place is right after `GameReady()`.
- Calling a banner method on a platform that does not support it does nothing and is not an error. If the layout must change when there is no banner, ask `IsBannerSupported` at runtime.
- Do not place buttons or important UI in the area a banner covers.
- Agree with your Hi5 Games contact whether the game uses banners at all.

```csharp
void OnSdkReady()
{
    H5SDK.OnReady -= OnSdkReady;
    H5SDK.GameReady();
    H5SDK.ShowBanner(BannerPosition.Bottom);
}
```

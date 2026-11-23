using System.Collections.Generic;

namespace H5PlatformSDK.Editor.Window
{
    internal enum PlatformStatus { Ready, NeedsConfig, ComingSoon }

    /// <summary>
    /// Describes one portal for the UI: display data, which H5SdkConfig fields belong to it
    /// and how to validate them. Adding a platform to the window = adding one entry here.
    /// </summary>
    internal sealed class PlatformInfo
    {
        public H5Platform Id;
        public string Name;
        public string Tagline;
        public string[] ConfigFields = new string[0];
        public System.Func<H5SdkConfig, string> Validate = _ => null;
        /// <summary>Supported by the runtime-adapter architecture in this SDK version.</summary>
        public bool Supported;

        public PlatformStatus GetStatus(H5SdkConfig config) =>
            !Supported ? PlatformStatus.ComingSoon
            : Validate(config) == null ? PlatformStatus.Ready : PlatformStatus.NeedsConfig;
    }

    internal static class PlatformCatalog
    {
        public static readonly IReadOnlyList<PlatformInfo> All = new List<PlatformInfo>
        {
            new PlatformInfo
            {
                Id = H5Platform.Playgama, Name = "Playgama",
                Tagline = "Pass-through to playgama-bridge.js so Playgama can re-publish the build elsewhere.",
                Supported = true, // no settings
            },
            new PlatformInfo
            {
                Id = H5Platform.Xiaomi, Name = "Xiaomi Game Center",
                Tagline = "MiGames commercialization SDK, fixed-size banner.",
                Supported = true,
                ConfigFields = new[] { "xiaomiBannerWidth", "xiaomiBannerHeight" },
                Validate = c =>
                    (c.xiaomiBannerWidth <= 0 || c.xiaomiBannerHeight <= 0) ? "Banner width/height must be > 0." : null,
            },
            new PlatformInfo
            {
                Id = H5Platform.CrazyGames, Name = "CrazyGames",
                Tagline = "CrazyGames JS SDK v3 (midgame + rewarded, no banner), no ID needed.",
                Supported = true, // no config
            },
            new PlatformInfo
            {
                Id = H5Platform.YandexGames, Name = "Yandex Games",
                Tagline = "Yandex Games SDK (interstitial, rewarded, sticky banner, cloud save), no ID needed.",
                Supported = true, // no config
            },
            new PlatformInfo
            {
                Id = H5Platform.GameDistribution, Name = "GameDistribution",
                Tagline = "GameDistribution SDK (interstitial + rewarded, no banner), needs the per-game key.",
                Supported = true,
                ConfigFields = new[] { "gameDistributionGameKey" },
                Validate = c => string.IsNullOrEmpty(c.gameDistributionGameKey) ? "Game key is empty." : null,
            },
            new PlatformInfo
            {
                Id = H5Platform.GameMonetize, Name = "GameMonetize",
                Tagline = "GameMonetize SDK (interstitial only; rewarded = same ad), needs the per-game ID.",
                Supported = true,
                ConfigFields = new[] { "gameMonetizeGameId" },
                Validate = c => string.IsNullOrEmpty(c.gameMonetizeGameId) ? "Game ID is empty." : null,
            },
            new PlatformInfo
            {
                Id = H5Platform.Y8, Name = "Y8",
                Tagline = "Y8 SDK 2.0 (interstitial + rewarded, no banner), needs App ID and Game ID.",
                Supported = true,
                ConfigFields = new[] { "y8AppId", "y8GameId" },
                Validate = c => string.IsNullOrEmpty(c.y8AppId) ? "App ID is empty." : string.IsNullOrEmpty(c.y8GameId) ? "Game ID is empty." : null,
            },
            new PlatformInfo
            {
                Id = H5Platform.GamePix, Name = "GamePix",
                Tagline = "GamePix SDK; has its own packaging rules.",
            },
            new PlatformInfo
            {
                Id = H5Platform.MiniGame, Name = "MiniGame",
                Tagline = "minigame.com SDK (interstitial, rewarded, banner); ad unit IDs ship in minigame.json, no settings needed.",
                Supported = true, // no config
            },
        };
    }
}

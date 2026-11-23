using UnityEngine;

namespace H5PlatformSDK
{
    /// <summary>
    /// Per-project SDK settings, edited in the H5 Platform SDK window (H5 Platform SDK > Open).
    /// Lives at Resources/H5SdkConfig.asset (created automatically). The Packager bakes only the
    /// selected platform's slice into each zip; nothing here selects a platform at build time.
    /// </summary>
    [CreateAssetMenu(fileName = "H5SdkConfig", menuName = "H5 Platform SDK/Config")]
    public class H5SdkConfig : ScriptableObject
    {
        [Header("General")]
        public bool verboseLogging = true;
        [Tooltip("How long the Editor/Null bridge waits before simulating ad results and firing OnReady.")]
        public float editorSimulatedAdDelaySeconds = 0.5f;

        // Playgama and MiniGame have no settings (Playgama reads its identity from the developer console).
        [Header("Xiaomi")]
        // The MiGames SDK script URL is the same for every game and ships inside the packager profile.
        [Tooltip("MiGames banners are fixed-size (width x height in px), e.g. 320x50.")]
        public int xiaomiBannerWidth = 320;
        public int xiaomiBannerHeight = 50;

        [Header("GameMonetize")]
        [Tooltip("Per-game ID from your GameMonetize account (gamemonetize.com/account). Required to package for GameMonetize.")]
        public string gameMonetizeGameId = "";

        [Header("GameDistribution")]
        [Tooltip("Per-game key (32 hex chars) from your GameDistribution developer account (Upload tab). Required to package for GameDistribution.")]
        public string gameDistributionGameKey = "";

        [Header("Y8")]
        [Tooltip("App ID from the Y8 developer dashboard (login, cloud save). Required to package for Y8.")]
        public string y8AppId = "";
        [Tooltip("Game ID from the Y8 developer dashboard (ads). Required to package for Y8.")]
        public string y8GameId = "";

        [Header("Ads (all platforms)")]
        [Tooltip("Minimum seconds between two interstitials; calls inside the window are skipped (the game continues). 0 = off. " +
                 "Applied by the runtime for every portal.")]
        public int minInterstitialIntervalSeconds = 0;
    }
}

using System;

namespace H5PlatformSDK.Core
{
    /// <summary>
    /// Contract every per-platform bridge manager implements. H5SDK (the public facade)
    /// only ever talks to whichever single instance the bootstrapper wires up for the
    /// active build define - it never branches per platform itself.
    /// </summary>
    internal interface IPlatformBridge
    {
        bool IsReady { get; }
        H5Platform Platform { get; }
        bool IsBannerSupported { get; }
        bool IsAdvancedBannersSupported { get; }
        bool IsAdBlockDetected { get; }

        void Init(H5SdkConfig config, Action onReady);

        void ShowInterstitial(string placement);
        void ShowInterstitial(string placement, Action onClosed);
        void ShowRewarded(Action onRewarded, Action onFailedOrClosed, string placement);
        void ShowBanner(BannerPosition position);
        void HideBanner();
        void ShowAdvancedBanners(string placement);
        void HideAdvancedBanners();

        void GameReady();
        void LevelStarted(string levelName);
        void LevelCompleted(string levelName);
        void LevelFailed(string levelName);
        void LevelPaused();
        void LevelResumed();
        void Restart();
        void ReturnToHome();

        void SetAudioMute(bool muted);

        void SaveData(string key, string json, Action<bool> onComplete);
        void LoadData(string key, Action<bool, string> onComplete);

        void GetPlayerName(Action<bool, string> onComplete);
        void GetLocale(Action<string> onComplete);

        string DebugStatusString();
    }
}

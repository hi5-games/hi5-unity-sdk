using System;
using H5PlatformSDK.Core;

namespace H5PlatformSDK
{
    /// <summary>
    /// Single public entry point for every game integrating this SDK. Contains no
    /// per-platform branching - it only forwards to the IPlatformBridge the bootstrapper
    /// bound: the JS bridge (window.H5 + portal adapter from the Packager) in a WebGL player,
    /// or the Null simulation in the Editor.
    ///
    /// Reward contract: onRewarded fires ONLY on the platform's true "viewed/success"
    /// callback. Any error, dismiss, or close path invokes onFailedOrClosed instead -
    /// never both, never neither.
    /// </summary>
    public static class H5SDK
    {
        private static IPlatformBridge _bridge;

        public static event Action OnReady;
        public static event Action<bool> OnMuteRequested;
        public static event Action<bool> OnPauseRequested;

        public static bool IsReady => _bridge != null && _bridge.IsReady;
        public static H5Platform ActivePlatform => _bridge?.Platform ?? H5Platform.None;
        public static bool IsBannerSupported => _bridge != null && _bridge.IsBannerSupported;

        /// <summary>
        /// Playgama-specific "advanced banners" - fixed banners docked to the left/right
        /// edges of the portal viewport, shown only when the game's own content doesn't
        /// occupy the full width (e.g. a portrait-locked game letterboxed/pillarboxed
        /// inside a wider landscape browser window). Only Playgama currently exposes this;
        /// every other bridge reports false via H5BridgeManagerBase so call sites never
        /// need an #if.
        /// </summary>
        public static bool IsAdvancedBannersSupported => _bridge != null && _bridge.IsAdvancedBannersSupported;
        public static bool IsAdBlockDetected => _bridge != null && _bridge.IsAdBlockDetected;

        /// <summary>
        /// Mirrors the most recent OnPauseRequested value - true while the platform has the
        /// game paused (e.g. an interstitial is currently on screen). Lets call sites that
        /// can't conveniently subscribe to the event (e.g. a coroutine waiting for an ad to
        /// close before reloading a scene) poll the current state instead.
        /// </summary>
        public static bool IsPaused { get; private set; }

        /// <summary>
        /// Mirrors the most recent OnMuteRequested value - true while the platform wants
        /// audio muted. A bridge whose platform reports its CURRENT audio state (rather
        /// than only future changes) should call RaiseMuteRequested once during Init, so
        /// this is already correct the first time scene code reads it in Start() - before
        /// any sound has had a chance to play.
        /// </summary>
        public static bool IsMuted { get; private set; }

        /// <summary>
        /// Called once by H5SdkBootstrapper. Not intended to be called by game code.
        /// </summary>
        internal static void Bind(IPlatformBridge bridge, H5SdkConfig config)
        {
            // WebGL's Player Setting "Run In Background" defaults to (and in this project's
            // ProjectSettings.asset currently is) off, which means Unity's own main loop - not
            // just our Time.timeScale - stops ticking entirely once the canvas loses DOM input
            // focus. A portal's ad overlay (e.g. Y8's ad iframe) steals that focus while showing,
            // so even though the ad SDK's own close event correctly resumes Time.timeScale, the
            // engine loop itself stays halted until a real user click hands focus back to the
            // canvas - a browser security restriction that no script-driven window.focus() call
            // can bypass (see H5VisibilityBridge.ReclaimFocus's comment). Forcing this true here
            // - once, for every platform, since any WebGL-in-iframe portal can hit the same issue
            // - keeps the render/main loop always running; our own pause logic (Time.timeScale
            // driven by RaisePauseRequested) remains the only thing that legitimately freezes
            // gameplay, decoupled from DOM focus entirely.
            UnityEngine.Application.runInBackground = true;

            _bridge = bridge;
            H5SdkLog.Verbose = config == null || config.verboseLogging;
            H5VisibilityBridge.EnsureInstalled();
            _bridge.Init(config, () => OnReady?.Invoke());
        }

        public static void ShowInterstitial(string placement = null)
        {
            if (!EnsureBridge()) return;
            _bridge.ShowInterstitial(placement);
        }

        /// <summary>
        /// Interstitial with a completion callback. <paramref name="onClosed"/> is invoked exactly once on every
        /// outcome: the ad was shown and closed, skipped by a cooldown, no fill, an error, or the SDK not bound.
        /// Use it to continue the game flow (next level, return to menu) after the ad.
        /// </summary>
        public static void ShowInterstitial(string placement, Action onClosed)
        {
            if (!EnsureBridge())
            {
                onClosed?.Invoke();
                return;
            }
            _bridge.ShowInterstitial(placement, onClosed);
        }

        public static void ShowRewarded(Action onRewarded, Action onFailedOrClosed, string placement = null)
        {
            if (!EnsureBridge())
            {
                onFailedOrClosed?.Invoke();
                return;
            }
            _bridge.ShowRewarded(onRewarded, onFailedOrClosed, placement);
        }

        public static void ShowBanner(BannerPosition position = BannerPosition.Bottom)
        {
            if (!EnsureBridge()) return;
            _bridge.ShowBanner(position);
        }

        public static void HideBanner()
        {
            if (!EnsureBridge()) return;
            _bridge.HideBanner();
        }

        public static void ShowAdvancedBanners(string placement = null)
        {
            if (!EnsureBridge()) return;
            _bridge.ShowAdvancedBanners(placement);
        }

        public static void HideAdvancedBanners()
        {
            if (!EnsureBridge()) return;
            _bridge.HideAdvancedBanners();
        }

        public static void GameReady()
        {
            if (!EnsureBridge()) return;
            _bridge.GameReady();
        }

        public static void LevelStarted(string levelName = null)
        {
            if (!EnsureBridge()) return;
            _bridge.LevelStarted(levelName);
        }

        public static void LevelCompleted(string levelName = null)
        {
            if (!EnsureBridge()) return;
            _bridge.LevelCompleted(levelName);
        }

        public static void LevelFailed(string levelName = null)
        {
            if (!EnsureBridge()) return;
            _bridge.LevelFailed(levelName);
        }

        public static void LevelPaused()
        {
            if (!EnsureBridge()) return;
            _bridge.LevelPaused();
        }

        public static void LevelResumed()
        {
            if (!EnsureBridge()) return;
            _bridge.LevelResumed();
        }

        public static void Restart()
        {
            if (!EnsureBridge()) return;
            _bridge.Restart();
        }

        public static void ReturnToHome()
        {
            if (!EnsureBridge()) return;
            _bridge.ReturnToHome();
        }

        /// <summary>
        /// Call from your own audio manager when a platform requests a mute state
        /// change around an ad (subscribe to OnMuteRequested), and call this to push
        /// the game's own mute toggle out to the platform.
        /// </summary>
        public static void SetAudioMute(bool muted)
        {
            if (!EnsureBridge()) return;
            _bridge.SetAudioMute(muted);
        }

        internal static void RaiseMuteRequested(bool muted)
        {
            IsMuted = muted;
            OnMuteRequested?.Invoke(muted);
        }

        /// <summary>
        /// Raised when the platform itself asks the game to pause (e.g. a system overlay
        /// opened over the game). Bridges that receive a real pause signal from their SDK
        /// forward it here - subscribe from your own game loop (e.g. Time.timeScale) to
        /// actually stop simulation while true.
        /// </summary>
        internal static void RaisePauseRequested(bool paused)
        {
            // Deliberately permanent, not a temporary debug log: this is the single choke point
            // every bridge's ad-pause bracket and the DOM fallback both funnel through, so it's
            // the fastest way to tell from a browser console log dump whether a report like
            // "ad closed but the game stayed paused" is because this was never called with
            // false (the ad SDK's own close callback/promise never fired) versus something
            // downstream of OnPauseRequested (e.g. AudioController's Time.timeScale) not
            // actually resuming despite this firing correctly.
            H5SdkLog.Info($"RaisePauseRequested({paused})");
            IsPaused = paused;
            OnPauseRequested?.Invoke(paused);
        }

        public static void SaveData(string key, string json, Action<bool> onComplete = null)
        {
            if (!EnsureBridge())
            {
                onComplete?.Invoke(false);
                return;
            }
            _bridge.SaveData(key, json, onComplete);
        }

        public static void LoadData(string key, Action<bool, string> onComplete)
        {
            if (!EnsureBridge())
            {
                onComplete?.Invoke(false, null);
                return;
            }
            _bridge.LoadData(key, onComplete);
        }

        /// <summary>
        /// Best-effort display name for the signed-in player. Only Y8 currently has a real
        /// player/auth concept; every other platform reports a safe simulated default via
        /// H5BridgeManagerBase, so game code never needs an #if to call this.
        /// </summary>
        public static void GetPlayerName(Action<bool, string> onComplete)
        {
            if (!EnsureBridge())
            {
                onComplete?.Invoke(false, null);
                return;
            }
            _bridge.GetPlayerName(onComplete);
        }

        /// <summary>
        /// Platform-reported locale code (e.g. "en", "vi"). Falls back to "en" on platforms
        /// with no locale API - same fallback the real platforms themselves use.
        /// </summary>
        public static void GetLocale(Action<string> onComplete)
        {
            if (!EnsureBridge())
            {
                onComplete?.Invoke("en");
                return;
            }
            _bridge.GetLocale(onComplete);
        }

        public static string DebugStatusString()
        {
            return _bridge != null
                ? _bridge.DebugStatusString()
                : "H5SDK: no bridge bound yet";
        }

        private static bool EnsureBridge()
        {
            if (_bridge != null) return true;
            H5SdkLog.Warn("H5SDK used before H5SdkBootstrapper ran. Call sites should wait for OnReady/IsReady.");
            return false;
        }
    }
}

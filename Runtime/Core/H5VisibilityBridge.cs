using UnityEngine;
#if UNITY_WEBGL && !UNITY_EDITOR
using System.Runtime.InteropServices;
#endif

namespace H5PlatformSDK.Core
{
    /// <summary>
    /// Cross-portal fallback for "the game got backgrounded" - the browser tab/window was
    /// minimized or switched away from, or (mobile browser) the screen was locked, turned off,
    /// or the user went to the home screen. None of the per-bridge ad-pause wiring covers this
    /// (it isn't an ad), and only Yandex Games' (YG2.onPauseGame) and GamePix's (Gpx.IsGamePaused)
    /// vendor SDKs happen to detect it on their own. Every other platform (CrazyGames,
    /// GameDistribution, GameMonetize, MiniGame, Playgama, Xiaomi, Y8) had nothing watching for
    /// this at all, so the game's BGM/SFX kept playing while backgrounded.
    ///
    /// Installed once from H5SDK.Bind(), which every bridge - satellite-asmdef self-bootstrapped
    /// or not - calls exactly once, so this runs under every H5 platform without any per-bridge
    /// wiring. Forwards into the same H5SDK.RaisePauseRequested every bridge's own ad-pause
    /// signal already uses; safe to layer on top of a platform's own pause signal since both are
    /// idempotent force-sets (SoundManager/GamePlayManager), never a capture/restore pair - see
    /// INTEGRATION.md's pause-ownership rule for why capture/restore is the actual danger, not
    /// this kind of layering.
    /// </summary>
    internal static class H5VisibilityBridge
    {
        private static bool _installed;

        public static void EnsureInstalled()
        {
            if (_installed) return;
            _installed = true;

#if UNITY_WEBGL && !UNITY_EDITOR
            var go = new GameObject("H5PlatformSDK.Visibility");
            Object.DontDestroyOnLoad(go);
            go.AddComponent<H5VisibilityBehaviour>();
            H5VisibilityJsBridge.H5Visibility_Init(go.name);
#endif
        }

        // Call right around a bridge's own ad call, alongside the H5SDK.RaisePauseRequested(true)/
        // (false) bracket it already has (e.g. Y8BridgeManager around ShowAdAsync). While
        // suppressed, the generic DOM visibilitychange fallback in h5VisibilitySDK.jslib goes
        // silent, so it can't race with / override the ad SDK's own
        // pause/resume signal - which is authoritative for exactly this window, since the ad is
        // the reason focus moved in the first place. Un-suppressing immediately rechecks the DOM's
        // real current state, so genuine backgrounding that happened to start mid-ad is still
        // caught once the ad SDK's own signal has had its say. No-op outside WebGL player builds.
        public static void SetSuppressed(bool suppressed)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            H5VisibilityJsBridge.H5Visibility_SetSuppressed(suppressed);
#endif
        }

        // Call right after a bridge resumes the game with its own H5SDK.RaisePauseRequested(false)
        // when that resume happens purely in C# with nothing touching the DOM. Forces focus back
        // and lifts any suppression still in effect (belt-and-suspenders if a bridge calls this
        // without having called SetSuppressed itself). No-op outside WebGL player builds.
        public static void ReclaimFocus()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            H5VisibilityJsBridge.H5Visibility_ReclaimFocus();
#endif
        }
    }

#if UNITY_WEBGL && !UNITY_EDITOR
    internal class H5VisibilityBehaviour : MonoBehaviour
    {
        // Called by h5VisibilitySDK.jslib via SendMessage whenever document.hidden (the Page
        // Visibility API) changes - "1" hidden, "0" visible. Deliberately not driven by
        // window focus/blur - see h5VisibilitySDK.jslib's H5Visibility_Init comment for why
        // that signal is unreliable inside a portal's iframe.
        private void OnVisibilityChanged(string hidden)
        {
            var isHidden = hidden == "1";
            H5SDK.RaisePauseRequested(isHidden);
            // RaisePauseRequested alone only stops Time.timeScale, which SoundManager's BGM
            // AudioSources ignore (ignoreListenerPause = true, see SoundManager.cs) - so backgrounding
            // the tab left music playing. Mute explicitly too, same as a bridge's own ad-pause bracket
            // should (see XiaomiBridgeManager.OnAdBreakStart/End).
            H5SDK.RaiseMuteRequested(isHidden);
        }
    }

    internal static class H5VisibilityJsBridge
    {
        [DllImport("__Internal")] public static extern void H5Visibility_Init(string callbackGameObjectName);
        [DllImport("__Internal")] public static extern void H5Visibility_SetSuppressed(bool suppressed);
        [DllImport("__Internal")] public static extern void H5Visibility_ReclaimFocus();
    }
#endif
}

using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using H5PlatformSDK.Core;
using UnityEngine;

namespace H5PlatformSDK.Bridges.Js
{
    /// <summary>
    /// Platform-agnostic bridge: every call is forwarded to the page's window.H5 runtime
    /// (h5-bridge.js + the adapter the Packager injected for the target portal). Contains no
    /// portal-specific code, so ONE WebGL build works for every packaged platform. In the Editor
    /// (or without window.H5) it degrades to the base class's safe simulation.
    /// </summary>
    public class H5JsBridgeManager : H5BridgeManagerBase
    {
        public const string ObjectName = "H5PlatformSDK.Bridge";

        [Serializable]
        private class Msg
        {
            public string type;
            public int id;
            public bool ok;
            public string value;
            public bool flag;
            public string platform;
            public bool banner;
            public bool advancedBanner;
            public bool adblock;
        }

        [Serializable] private class Args { public string placement; public string position; public string type; public string name; public string key; public string json; }

        // Reported to the H5 QA tool only (platform "qa"): what the game actually did after a pause/mute/ad signal.
        [Serializable] private class QaState { public float timeScale; public bool audioPaused; public float volume; public bool sdkPaused; public bool sdkMuted; }
        private bool _qa;

        private H5Platform _platform = H5Platform.None;
        private bool _banner, _advancedBanner, _adblock;
        private int _nextId = 1;
        private readonly Dictionary<int, Action<Msg>> _pending = new Dictionary<int, Action<Msg>>();

        public override H5Platform Platform => _platform;
        public override bool IsBannerSupported => _banner;
        public override bool IsAdvancedBannersSupported => _advancedBanner;
        public override bool IsAdBlockDetected => _adblock;

        protected override void Awake()
        {
            base.Awake();
            gameObject.name = ObjectName; // fixed name: h5sdk.jslib targets it via SendMessage
        }

        protected override void OnInit()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            H5JsInterop.H5_Init(gameObject.name);
#else
            base.OnInit();
#endif
        }

        private void Call(string method, Args args, Action<Msg> onResult = null)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            int id = 0;
            if (onResult != null) { id = _nextId++; _pending[id] = onResult; }
            H5JsInterop.H5_Call(method, JsonUtility.ToJson(args ?? new Args()), id);
#endif
        }

        // ---- JS -> Unity (SendMessage target) ----
        private void OnH5Message(string json)
        {
            var m = JsonUtility.FromJson<Msg>(json);
            switch (m.type)
            {
                case "ready":
                    _platform = ParsePlatform(m.platform);
                    _banner = m.banner; _advancedBanner = m.advancedBanner; _adblock = m.adblock;
                    // The adapter owns pause/mute signals (ads, portal overlays); the DOM
                    // visibility fallback would only race it.
                    if (m.flag) H5VisibilityBridge.SetSuppressed(true);
                    _qa = m.platform == "qa";
                    // Trace log in the page: development builds show the "H5 log" button (copyable report), release
                    // builds stop the recording.
                    Call("trace", new Args { type = Debug.isDebugBuild ? "on" : "off" });
                    MarkReady();
                    break;
#if DEVELOPMENT_BUILD
                case "traceRequest":
                    Call("trace", new Args { type = "state", json = TraceState() });
                    break;
#endif
                case "pause": H5SDK.RaisePauseRequested(m.flag); break;
                case "mute": H5SDK.RaiseMuteRequested(m.flag); break;
                case "adStart":
                    H5SDK.RaisePauseRequested(true);
                    H5SDK.RaiseMuteRequested(true);
                    H5VisibilityBridge.SetSuppressed(true);
                    break;
                case "adEnd":
                    H5SDK.RaisePauseRequested(false);
                    H5SDK.RaiseMuteRequested(false);
                    H5VisibilityBridge.ReclaimFocus();
                    break;
                case "result":
                    if (_pending.TryGetValue(m.id, out var cb)) { _pending.Remove(m.id); cb(m); }
                    break;
            }
#if DEVELOPMENT_BUILD || UNITY_EDITOR
            // QA tool scenario runner: run a test hook and send the result back (adapter "qa" only).
            if (_qa && m.type == "qaCommand")
            {
                string result; bool ok = true;
                try { result = H5QAHooks.Execute(m.value); }
                catch (Exception e) { ok = false; result = (e is TargetInvocationException tie && tie.InnerException != null ? tie.InnerException : e).Message; }
                Call("qaResult", new Args { key = m.id.ToString(), type = ok ? "1" : "0", json = result });
            }
#endif
            if (_qa && (m.type == "pause" || m.type == "mute" || m.type == "adStart" || m.type == "adEnd"))
                StartCoroutine(ReportQaState(m.type == "pause" || m.type == "mute" ? m.type + ":" + (m.flag ? "1" : "0") : m.type));
        }

#if DEVELOPMENT_BUILD
        // Game state for the trace report (development builds). Game hooks named state/popups/level/coin are added when registered.
        private static string TraceState()
        {
            var sb = new System.Text.StringBuilder();
            sb.Append(Application.productName).Append(' ').Append(Application.version).Append(" (Unity ").Append(Application.unityVersion).Append(")");
            sb.Append(" | scene ").Append(UnityEngine.SceneManagement.SceneManager.GetActiveScene().name);
            sb.Append(" | timeScale ").Append(Time.timeScale.ToString(System.Globalization.CultureInfo.InvariantCulture));
            sb.Append(" | audio pause ").Append(AudioListener.pause).Append(" vol ").Append(AudioListener.volume.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture));
            sb.Append(" | sdk paused ").Append(H5SDK.IsPaused).Append(" muted ").Append(H5SDK.IsMuted);
            sb.Append(" | screen ").Append(Screen.width).Append('x').Append(Screen.height);
            sb.Append(" | up ").Append(Time.realtimeSinceStartup.ToString("0.0", System.Globalization.CultureInfo.InvariantCulture)).Append('s');
            foreach (var h in new[] { "state", "popups", "level", "coin" })
            {
                if (!H5QAHooks.Has(h)) continue;
                try { sb.Append(" | ").Append(h).Append(' ').Append(H5QAHooks.Execute(h)); } catch (Exception) { }
            }
            return sb.ToString();
        }
#endif

        // Half a second (real time, so it also runs while Time.timeScale is 0) gives the game's own
        // OnPauseRequested/OnMuteRequested handlers time to act before the state is sampled.
        private IEnumerator ReportQaState(string reason)
        {
            yield return new WaitForSecondsRealtime(0.5f);
            var s = new QaState
            {
                timeScale = Time.timeScale, audioPaused = AudioListener.pause, volume = AudioListener.volume,
                sdkPaused = H5SDK.IsPaused, sdkMuted = H5SDK.IsMuted,
            };
            Call("qaState", new Args { type = reason, json = JsonUtility.ToJson(s) });
        }

        private static H5Platform ParsePlatform(string id)
        {
            switch (id)
            {
                case "playgama": return H5Platform.Playgama;
                case "xiaomi": return H5Platform.Xiaomi;
                case "gamemonetize": return H5Platform.GameMonetize;
                case "y8": return H5Platform.Y8;
                case "gamedistribution": return H5Platform.GameDistribution;
                case "crazygames": return H5Platform.CrazyGames;
                case "yandexgames": return H5Platform.YandexGames;
                case "minigame": return H5Platform.MiniGame;
                default: return H5Platform.None;
            }
        }

        // ---- IPlatformBridge ----
        public override void ShowInterstitial(string placement)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            Call("showInterstitial", new Args { placement = placement });
#else
            base.ShowInterstitial(placement);
#endif
        }

        public override void ShowInterstitial(string placement, Action onClosed)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            // The JS core replies once for every outcome (shown, cooldown skip, no fill, error), so onClosed always runs.
            Call("showInterstitial", new Args { placement = placement }, _ => onClosed?.Invoke());
#else
            base.ShowInterstitial(placement, onClosed);
#endif
        }

        public override void ShowRewarded(Action onRewarded, Action onFailedOrClosed, string placement)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            Call("showRewarded", new Args { placement = placement },
                r => { if (r.ok && r.value == "1") onRewarded?.Invoke(); else onFailedOrClosed?.Invoke(); });
#else
            base.ShowRewarded(onRewarded, onFailedOrClosed, placement);
#endif
        }

        public override void ShowBanner(BannerPosition position)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            Call("showBanner", new Args { position = position == BannerPosition.Top ? "top" : "bottom" });
#else
            base.ShowBanner(position);
#endif
        }

        public override void HideBanner()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            Call("hideBanner", null);
#endif
        }

        public override void ShowAdvancedBanners(string placement)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            Call("showAdvancedBanners", new Args { placement = placement });
#else
            base.ShowAdvancedBanners(placement);
#endif
        }

        public override void HideAdvancedBanners()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            Call("hideAdvancedBanners", null);
#endif
        }

        public override void GameReady() => Event("game_ready", null, () => base.GameReady());
        public override void LevelStarted(string n) => Event("level_started", n, () => base.LevelStarted(n));
        public override void LevelCompleted(string n) => Event("level_completed", n, () => base.LevelCompleted(n));
        public override void LevelFailed(string n) => Event("level_failed", n, () => base.LevelFailed(n));
        public override void LevelPaused() => Event("level_paused", null, () => base.LevelPaused());
        public override void LevelResumed() => Event("level_resumed", null, () => base.LevelResumed());

        private void Event(string type, string name, Action editorFallback)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            Call("event", new Args { type = type, name = name });
#else
            editorFallback();
#endif
        }

        public override void SaveData(string key, string json, Action<bool> onComplete)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            Call("save", new Args { key = key, json = json }, r => onComplete?.Invoke(r.ok));
#else
            base.SaveData(key, json, onComplete);
#endif
        }

        public override void LoadData(string key, Action<bool, string> onComplete)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            Call("load", new Args { key = key }, r => onComplete?.Invoke(r.ok, r.ok ? r.value : null));
#else
            base.LoadData(key, onComplete);
#endif
        }

        public override void GetPlayerName(Action<bool, string> onComplete)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            Call("playerName", null, r => onComplete?.Invoke(r.ok, r.value));
#else
            base.GetPlayerName(onComplete);
#endif
        }

        public override void GetLocale(Action<string> onComplete)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            Call("locale", null, r => onComplete?.Invoke(string.IsNullOrEmpty(r.value) ? "en" : r.value));
#else
            base.GetLocale(onComplete);
#endif
        }
    }
}

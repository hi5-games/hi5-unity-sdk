using System;
using System.Collections;
using System.Collections.Generic;
using H5PlatformSDK.Core;
using UnityEngine;

namespace H5PlatformSDK.Bridges
{
    /// <summary>
    /// Shared singleton scaffolding + safe simulated-default behaviour for every
    /// per-platform bridge manager. Concrete bridges only override the members
    /// their platform actually supports (e.g. a platform with no banner API simply
    /// never overrides ShowBanner/IsBannerSupported).
    /// </summary>
    public abstract class H5BridgeManagerBase : MonoBehaviour, IPlatformBridge
    {
        protected H5SdkConfig Config { get; private set; }
        protected bool AudioMuted { get; private set; }

        public bool IsReady { get; protected set; }
        public abstract H5Platform Platform { get; }
        public virtual bool IsBannerSupported => false;
        public virtual bool IsAdvancedBannersSupported => false;
        public virtual bool IsAdBlockDetected => false;

        private Action _onReady;
        private readonly Dictionary<string, string> _simulatedStorage = new Dictionary<string, string>();

        protected virtual void Awake()
        {
            if (FindObjectsOfType(GetType()).Length > 1)
            {
                Destroy(gameObject);
                return;
            }
            DontDestroyOnLoad(gameObject);
        }

        public void Init(H5SdkConfig config, Action onReady)
        {
#if UNITY_EDITOR
            // Editor scenario run (H5 Platform SDK > QA): storage seeded by the test, persisted across reloads.
            if (QA.H5EditorQA.Active) QA.H5EditorQA.LoadStorage(_simulatedStorage);
#endif
            Config = config;
            _onReady = onReady;
            OnInit();
        }

        /// <summary>Override to kick off the platform's real SDK init sequence.</summary>
        protected virtual void OnInit()
        {
            StartCoroutine(SimulatedReadyRoutine());
        }

        protected IEnumerator SimulatedReadyRoutine()
        {
            float delay = Config != null ? Config.editorSimulatedAdDelaySeconds : 0.5f;
            if (delay > 0f) yield return new WaitForSeconds(delay);
            MarkReady();
        }

        protected void MarkReady()
        {
            if (IsReady) return;
            IsReady = true;
            H5SdkLog.Info($"{Platform} bridge ready.");
            _onReady?.Invoke();
        }

        public virtual void ShowInterstitial(string placement)
        {
#if UNITY_EDITOR
            if (QA.H5EditorQA.Active) { StartCoroutine(QA.H5EditorQA.SimulateAd("interstitial", placement, null)); return; }
#endif
            H5SdkLog.Info($"{Platform}: simulated ShowInterstitial({placement})");
        }

        public virtual void ShowInterstitial(string placement, Action onClosed)
        {
#if UNITY_EDITOR
            if (QA.H5EditorQA.Active) { StartCoroutine(QA.H5EditorQA.SimulateAd("interstitial", placement, _ => onClosed?.Invoke())); return; }
#endif
            ShowInterstitial(placement);
            onClosed?.Invoke();
        }

        public virtual void ShowRewarded(Action onRewarded, Action onFailedOrClosed, string placement)
        {
#if UNITY_EDITOR
            if (QA.H5EditorQA.Active)
            {
                StartCoroutine(QA.H5EditorQA.SimulateAd("rewarded", placement, ok => { if (ok) onRewarded?.Invoke(); else onFailedOrClosed?.Invoke(); }));
                return;
            }
#endif
            H5SdkLog.Info($"{Platform}: simulated ShowRewarded({placement}) -> success");
            onRewarded?.Invoke();
        }

        public virtual void ShowBanner(BannerPosition position)
        {
            H5SdkLog.Info($"{Platform}: ShowBanner not supported, ignored.");
        }

        public virtual void HideBanner()
        {
        }

        public virtual void ShowAdvancedBanners(string placement)
        {
            H5SdkLog.Info($"{Platform}: ShowAdvancedBanners not supported, ignored.");
        }

        public virtual void HideAdvancedBanners()
        {
        }

        public virtual void GameReady() { QaEvent("game_ready"); H5SdkLog.Info($"{Platform}: GameReady"); }
        public virtual void LevelStarted(string levelName) { QaEvent("level_started"); H5SdkLog.Info($"{Platform}: LevelStarted({levelName})"); }
        public virtual void LevelCompleted(string levelName) { QaEvent("level_completed"); H5SdkLog.Info($"{Platform}: LevelCompleted({levelName})"); }
        public virtual void LevelFailed(string levelName) { QaEvent("level_failed"); H5SdkLog.Info($"{Platform}: LevelFailed({levelName})"); }
        public virtual void LevelPaused() { QaEvent("level_paused"); H5SdkLog.Info($"{Platform}: LevelPaused"); }
        public virtual void LevelResumed() { QaEvent("level_resumed"); H5SdkLog.Info($"{Platform}: LevelResumed"); }

        // Editor scenario runner records SDK events with the same names as the QA tool.
        [System.Diagnostics.Conditional("UNITY_EDITOR")]
        private static void QaEvent(string type)
        {
#if UNITY_EDITOR
            if (QA.H5EditorQA.Active) QA.H5EditorQA.RecordEvent(type);
#endif
        }
        public virtual void Restart() => H5SdkLog.Info($"{Platform}: Restart");
        public virtual void ReturnToHome() => H5SdkLog.Info($"{Platform}: ReturnToHome");

        public virtual void SetAudioMute(bool muted)
        {
            AudioMuted = muted;
            H5SDK.RaiseMuteRequested(muted);
        }

        public virtual void SaveData(string key, string json, Action<bool> onComplete)
        {
            _simulatedStorage[key] = json;
#if UNITY_EDITOR
            if (QA.H5EditorQA.Active) QA.H5EditorQA.WriteStorage(_simulatedStorage);
#endif
            onComplete?.Invoke(true);
        }

        public virtual void LoadData(string key, Action<bool, string> onComplete)
        {
            bool found = _simulatedStorage.TryGetValue(key, out var value);
            onComplete?.Invoke(found, found ? value : null);
        }

        public virtual void GetPlayerName(Action<bool, string> onComplete)
        {
            H5SdkLog.Info($"{Platform}: simulated GetPlayerName -> \"Player\"");
            onComplete?.Invoke(true, "Player");
        }

        public virtual void GetLocale(Action<string> onComplete)
        {
            onComplete?.Invoke("en");
        }

        public virtual string DebugStatusString()
        {
            return $"{Platform} | IsReady={IsReady} | BannerSupported={IsBannerSupported}";
        }
    }
}

mergeInto(LibraryManager.library, {

  // Cross-portal fallback for "the game got backgrounded": the browser tab/window was
  // minimized or switched away from, or - on a mobile browser - the screen was locked, turned
  // off, or the user went to the home screen. None of the per-vendor ad SDKs report this (it
  // has nothing to do with an ad), and Unity's own OnApplicationPause is not reliably raised by
  // WebGL builds across browsers, so this listens to the DOM's own Page Visibility API
  // (document.hidden via visibilitychange, plus pagehide/pageshow) and forwards a single boolean
  // into H5VisibilityBridge.cs, which raises H5SDK.RaisePauseRequested. A bridge that already has
  // its own authoritative pause/resume signal for a given window (an ad call) can silence this
  // fallback for that window via H5Visibility_SetSuppressed, below.
  //
  // Deliberately NOT using window.hasFocus()/blur/focus (an earlier revision of this file did,
  // and so does Assets/WebGLTemplates/YandexGames/index.html for its own unrelated purpose):
  // document.hasFocus() is unreliable for a game running inside a portal's iframe (Y8, MiniGame,
  // ...). Browsers require a real user gesture to hand keyboard/input focus back to a child
  // iframe - a script-driven window.focus() call from an ad SDK's async close callback is not
  // one, so after an ad overlay closes, hasFocus() can stay false indefinitely, with nothing but
  // an actual player click ever making it true again. Polling for it to "settle" (a prior
  // revision of this file did that, capped at ~0.5s) just delays the same wrong outcome: once the
  // cap is hit, hasFocus() is still false, and reporting that as "backgrounded" re-pauses the
  // game with no further event coming to correct it - this was the reported "ad closes, game
  // stays paused until the player clicks the canvas" bug on Y8, twice. document.hidden has no
  // equivalent handoff delay - it flips synchronously and atomically with real tab
  // visibility/minimize/lock-screen state, which is both the reliable signal AND the one this
  // fallback actually needs to cover (ad SDKs already own the "ad is showing" case via
  // SetSuppressed/ReclaimFocus below).
  H5Visibility_Init: function (callbackGameObjectNamePtr) {
    var goName = UTF8ToString(callbackGameObjectNamePtr);
    var lastHidden = document.hidden;
    // Ads/portal overlays (Y8's showAd, MiniGame's ad units, ...) are already bracketed by the
    // owning bridge's own H5SDK.RaisePauseRequested(true)/(false), driven directly by the ad
    // SDK's own start/close callbacks - authoritative for exactly this window, since the ad is
    // the reason this fired in the first place. This generic DOM fallback exists only for what
    // the ad SDKs DON'T report (the tab/window being backgrounded for an unrelated reason), so
    // while a bridge marks itself suppressed, this file stays silent instead of racing the ad
    // SDK's own pause/resume.
    var suppressed = false;

    function send(hidden) {
      if (suppressed) return;
      if (hidden === lastHidden) return;
      lastHidden = hidden;
      SendMessage(goName, "OnVisibilityChanged", hidden ? "1" : "0");
    }

    function reportImmediate() {
      send(document.hidden);
    }

    document.addEventListener("visibilitychange", reportImmediate);
    window.addEventListener("pagehide", reportImmediate);
    window.addEventListener("pageshow", reportImmediate);

    // Exposed so a bridge (see H5Visibility_SetSuppressed/H5Visibility_ReclaimFocus below) can
    // force a resync against the DOM's current real state.
    window.H5PlatformSDKRecheckVisibility = reportImmediate;

    // Callable from C# (see H5VisibilityBridge.SetSuppressed) right around a bridge's own ad
    // call - e.g. Y8BridgeManager wraps ShowAdAsync with SetSuppressed(true) then
    // SetSuppressed(false) in its finally, alongside the RaisePauseRequested(true)/(false) it
    // already does. Unlike the old hasFocus()-based version of this file, lifting suppression is
    // a single immediate recheck - document.hidden has no async settle delay to wait out (see
    // the class comment above), so there is nothing to poll for.
    window.H5PlatformSDKSetVisibilitySuppressed = function (isSuppressed) {
      suppressed = !!isSuppressed;
      if (!suppressed) reportImmediate();
    };

    // Only worth checking at init for the genuinely-hidden-tab case (opened/preloaded in a
    // background tab).
    if (document.hidden) reportImmediate();
  },

  // Callable from C# (see H5VisibilityBridge.SetSuppressed) by a bridge that already brackets
  // its own ad call with H5SDK.RaisePauseRequested(true)/(false) - silences the generic DOM
  // fallback above for the duration of the ad, so its own visibilitychange listener can't race
  // with the ad SDK's own pause/resume signal.
  H5Visibility_SetSuppressed: function (suppressed) {
    if (typeof window.H5PlatformSDKSetVisibilitySuppressed === "function") {
      window.H5PlatformSDKSetVisibilitySuppressed(!!suppressed);
    }
  },

  // Callable from C# (see H5VisibilityBridge.ReclaimFocus) by any bridge whose ad SDK closes an
  // ad via a plain async callback/Promise rather than its own jslib - e.g. Y8BridgeManager.cs,
  // which calls H5SDK.RaisePauseRequested(false) directly in C# with nothing touching the DOM.
  // window.focus() is best-effort only (browsers may ignore it without a user gesture - see the
  // class comment above) - the real resync is the immediate, hasFocus()-independent recheck from
  // lifting suppression right after.
  H5Visibility_ReclaimFocus: function () {
    try { window.focus(); } catch (e) {}
    if (typeof window.H5PlatformSDKSetVisibilitySuppressed === "function") {
      window.H5PlatformSDKSetVisibilitySuppressed(false);
    } else if (typeof window.H5PlatformSDKRecheckVisibility === "function") {
      window.H5PlatformSDKRecheckVisibility();
    }
  }

});

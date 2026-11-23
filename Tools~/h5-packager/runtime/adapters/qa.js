/* QA adapter - a fake portal for local testing with the H5 QA tool (`h5-packager qa`).
 * Never shipped to a portal: profile `qa` is internal and not part of `--platform all`.
 *
 * - Ads are simulated with an overlay; the outcome (success / no-fill / skip) comes from the QA tool.
 * - Saves go to localStorage under `h5qa:<key>` (the QA tool's Storage panel reads/edits them).
 * - Every H5.call / H5.emit / console line / error is reported to the QA tool.
 * - Game audio is measured: everything Unity connects to the AudioDestinationNode is routed through an
 *   AnalyserNode, so the tool can check "silent during ads" and "silent when the tab is hidden".
 *
 * The QA tool is the same-origin parent page and exposes window.H5QA_HOST = { log(kind, data), settings }.
 * Opened standalone (no parent), the adapter still works with default settings and logs to the console. */
(function () {
  'use strict';

  var host = null;
  try { if (window.parent !== window && window.parent.H5QA_HOST) host = window.parent.H5QA_HOST; } catch (e) { /* cross-origin parent */ }
  var DEFAULTS = { interstitial: 'success', rewarded: 'success', adDurationSec: 3, locale: 'en', playerName: 'QA Player', muted: false };
  function settings() {
    var s = (host && host.settings) || {};
    var out = {};
    for (var k in DEFAULTS) out[k] = s[k] != null ? s[k] : DEFAULTS[k];
    return out;
  }
  function report(kind, data) {
    try { if (host) host.log(kind, data == null ? {} : data); } catch (e) { /* host gone (reload) */ }
  }

  // ---- console + errors -------------------------------------------------------------------------
  ['log', 'info', 'warn', 'error'].forEach(function (level) {
    var orig = console[level];
    console[level] = function () {
      try {
        var parts = [];
        for (var i = 0; i < arguments.length; i++) {
          var a = arguments[i];
          parts.push(typeof a === 'string' ? a : (a && a.stack) ? String(a.stack) : (function () { try { return JSON.stringify(a); } catch (e) { return String(a); } })());
        }
        report('console', { level: level, text: parts.join(' ').slice(0, 2000) });
      } catch (e) { /* never break the game's logging */ }
      return orig.apply(console, arguments);
    };
  });
  window.addEventListener('error', function (e) { report('error', { text: String(e.message || e) + (e.filename ? ' @ ' + e.filename + ':' + e.lineno : '') }); });
  window.addEventListener('unhandledrejection', function (e) { report('error', { text: 'Unhandled rejection: ' + String(e.reason && (e.reason.stack || e.reason.message) || e.reason) }); });

  // ---- audio meter ------------------------------------------------------------------------------
  // Must run before Unity creates its AudioContext (this file is a head script, Unity's loader runs later).
  var analysers = [];
  if (window.AudioNode && window.AudioDestinationNode) {
    var origConnect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (dest) {
      if (dest instanceof AudioDestinationNode && !this.__h5qa) {
        var ctx = dest.context;
        if (!ctx.__h5qaAnalyser) {
          var an = ctx.createAnalyser();
          an.fftSize = 2048;
          an.__h5qa = true;
          origConnect.call(an, dest);
          ctx.__h5qaAnalyser = an;
          analysers.push({ ctx: ctx, an: an, buf: new Float32Array(an.fftSize) });
          report('audio-context', { state: ctx.state, sampleRate: ctx.sampleRate });
          if (ctx.addEventListener) ctx.addEventListener('statechange', function () { report('audio-context', { state: ctx.state }); });
        }
        var args = Array.prototype.slice.call(arguments);
        args[0] = ctx.__h5qaAnalyser;
        origConnect.apply(this, args);
        return dest;
      }
      return origConnect.apply(this, arguments);
    };
  }
  // RMS of the loudest context, 0..1. A suspended context outputs nothing.
  function level() {
    var max = 0;
    for (var i = 0; i < analysers.length; i++) {
      var a = analysers[i];
      if (a.ctx.state !== 'running') continue;
      a.an.getFloatTimeDomainData(a.buf);
      var sum = 0;
      for (var j = 0; j < a.buf.length; j++) sum += a.buf[j] * a.buf[j];
      max = Math.max(max, Math.sqrt(sum / a.buf.length));
    }
    return max;
  }
  setInterval(function () {
    report('audio', { rms: level(), contexts: analysers.length, running: analysers.some(function (a) { return a.ctx.state === 'running'; }) });
  }, 200);

  // ---- H5 core hooks ----------------------------------------------------------------------------
  var core = window.H5;
  if (!core) { console.error('[H5 QA] h5-bridge.js must load before the qa adapter'); return; }
  var origCall = core.call, origEmit = core.emit, origAttach = core.attach, origProgress = core.progress;
  core.call = function (method, args, id) { report('call', { method: method, args: args || {}, id: id }); return origCall.apply(core, arguments); };
  core.emit = function (msg) {
    if (msg && msg.type === 'result') report('result', msg);
    else report('emit', msg || {});
    return origEmit.apply(core, arguments);
  };
  core.attach = function () { report('attach', {}); return origAttach.apply(core, arguments); };
  core.progress = function (p) { report('progress', { p: p }); return origProgress.apply(core, arguments); };

  // ---- ad overlay -------------------------------------------------------------------------------
  var adOpen = false;
  function overlay(kind, placement, allowSkip, onDone) {
    var s = settings();
    var el = document.createElement('div');
    el.id = 'h5qa-ad';
    el.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;background:rgba(10,10,20,.94);color:#fff;display:flex;' +
      'flex-direction:column;align-items:center;justify-content:center;font:16px/1.4 system-ui,sans-serif;text-align:center');
    var left = Math.max(1, Math.round(s.adDurationSec));
    el.innerHTML = '<div style="font-size:12px;letter-spacing:.2em;opacity:.6">H5 QA - SIMULATED AD</div>' +
      '<div style="font-size:28px;font-weight:700;margin:8px 0">' + kind + '</div>' +
      '<div style="opacity:.7">placement: ' + (placement || '(none)') + '</div>' +
      '<div id="h5qa-ad-t" style="font-size:40px;margin:16px 0">' + left + '</div>' +
      (allowSkip ? '<button id="h5qa-ad-skip" style="font:inherit;padding:8px 16px;border-radius:8px;border:1px solid #888;background:#222;color:#fff;cursor:pointer">Close without reward</button>' : '');
    document.body.appendChild(el);
    var finished = false;
    var finish = function (completed) {
      if (finished) return; finished = true;
      clearInterval(timer); el.remove(); onDone(completed);
    };
    var timer = setInterval(function () {
      left -= 1;
      var t = document.getElementById('h5qa-ad-t'); if (t) t.textContent = String(Math.max(left, 0));
      if (left <= 0) finish(true);
    }, 1000);
    if (allowSkip) document.getElementById('h5qa-ad-skip').onclick = function () { finish(false); };
    return finish;
  }

  // Ad bracket: pause+mute while the ad is on screen, then restore the platform mute state.
  function runAd(kind, placement, mode) {
    return new Promise(function (resolve) {
      if (adOpen) { report('ad', { kind: kind, placement: placement, phase: 'rejected', reason: 'another ad is open' }); resolve(false); return; }
      if (mode === 'nofill') { report('ad', { kind: kind, placement: placement, phase: 'nofill' }); resolve(false); return; }
      adOpen = true;
      report('ad', { kind: kind, placement: placement, phase: 'open' });
      core.emit({ type: 'adStart' });
      overlay(kind, placement, kind === 'rewarded', function (completed) {
        if (mode === 'skip') completed = false;
        adOpen = false;
        core.emit({ type: 'adEnd' });
        if (settings().muted) core.emit({ type: 'mute', flag: true });
        report('ad', { kind: kind, placement: placement, phase: 'close', completed: completed });
        resolve(completed);
      });
      if (mode === 'skip') setTimeout(function () { var b = document.getElementById('h5qa-ad-skip'); if (b) b.click(); }, 800);
    });
  }

  var banner = null;
  var qaPending = {}, qaSeq = 1;
  H5.registerAdapter({
    id: 'qa',
    capabilities: { banner: true, ownsPause: true },
    init: function () {
      report('init', { settings: settings() });
      if (settings().muted) core.emit({ type: 'mute', flag: true });
      return new Promise(function (r) { setTimeout(r, 150); });
    },
    showInterstitial: function (placement) { return runAd('interstitial', placement, settings().interstitial); },
    showRewarded: function (placement) { return runAd('rewarded', placement, settings().rewarded); },
    showBanner: function (pos) {
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'h5qa-banner';
        banner.textContent = 'H5 QA banner (320x50)';
        document.body.appendChild(banner);
      }
      banner.setAttribute('style', 'position:fixed;left:50%;transform:translateX(-50%);' + (String(pos).toLowerCase() === 'top' ? 'top:0' : 'bottom:0') +
        ';width:320px;height:50px;z-index:2147483646;background:#ffd400;color:#000;display:flex;align-items:center;justify-content:center;font:13px system-ui,sans-serif');
      report('banner', { visible: true, position: pos });
    },
    hideBanner: function () { if (banner) { banner.remove(); banner = null; } report('banner', { visible: false }); },
    event: function (type, name) { report('event', { type: type, name: name || null }); },
    save: function (key, json) { localStorage.setItem('h5qa:' + key, json); report('storage', { op: 'save', key: key, bytes: (json || '').length }); return Promise.resolve(); },
    load: function (key) {
      var v = localStorage.getItem('h5qa:' + key);
      report('storage', { op: 'load', key: key, found: v != null, bytes: v ? v.length : 0 });
      return Promise.resolve(v);
    },
    qaResult: function (id, ok, value) {
      var p = qaPending[id];
      report('qa-result', { id: Number(id), ok: ok, value: value });
      if (!p) return;
      delete qaPending[id];
      if (ok) p.resolve(value); else p.reject(new Error(value));
    },
    qaState: function (reason, json) {
      var st = {}; try { st = JSON.parse(json || '{}'); } catch (e) { /* ignore */ }
      st.reason = reason; report('game-state', st);
    },
    playerName: function () { return settings().playerName; },
    locale: function () { return settings().locale; }
  });

  // Controls used by the QA tool (same origin): platform pause/mute, simulated tab hide.
  window.H5QA = {
    emit: function (msg) { core.emit(msg); },
    // Runs a test hook in Unity (H5QAHooks, development builds only). Resolves with its result string.
    command: function (cmd, timeoutMs) {
      return new Promise(function (resolve, reject) {
        var id = qaSeq++;
        qaPending[id] = { resolve: resolve, reject: reject };
        report('qa-command', { id: id, cmd: cmd });
        core.emit({ type: 'qaCommand', id: id, value: cmd });
        setTimeout(function () {
          if (!qaPending[id]) return;
          delete qaPending[id];
          reject(new Error('no reply from Unity (needs a development build with H5PlatformSDK 2.1.0-beta.5+)'));
        }, timeoutMs || 10000);
      });
    },
    level: level,
    setHidden: function (hidden) {
      try {
        Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return hidden; } });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return hidden ? 'hidden' : 'visible'; } });
      } catch (e) { /* ignore */ }
      document.dispatchEvent(new Event('visibilitychange'));
    }
  };
})();

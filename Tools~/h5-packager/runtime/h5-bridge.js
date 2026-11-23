/* H5 Platform SDK runtime core. Platform-agnostic: adapters (adapters/*.js) do the portal work.
 * Injected by the H5 Packager; config comes from window.__H5_CONFIG__ = { platform, <platformId>: {...} }.
 * Contract with Unity: Assets/Plugins/H5PlatformSDK/Core/h5sdk.jslib (H5.attach / H5.call). */
(function () {
  'use strict';
  var adapters = {};
  var sink = null;
  var queue = [];
  var readyMsg = null;
  var lastInterstitial = 0;
  var prerollDone = false;
  // Shared cooldown (config.general.minInterstitialIntervalSec, 0 = off): skip instead of queueing.
  function interstitial(a, placement) {
    var min = ((H5.config.general || {}).minInterstitialIntervalSec || 0) * 1000, now = Date.now();
    if (min > 0 && lastInterstitial && now - lastInterstitial < min) return Promise.resolve(0);
    if (!a.showInterstitial) return Promise.resolve(0);
    try { return Promise.resolve(a.showInterstitial(placement)).then(function (v) { lastInterstitial = Date.now(); return v; }); }
    catch (e) { return Promise.reject(e); }
  }
  // ---------------------------------------------------------------- trace log (development builds)
  // Ring buffer of console output (Unity logs arrive here too), page errors and SDK calls/signals, recorded from page load.
  // Unity tells us at start-up: development build -> 'on' (shows the "H5 log" button), release -> 'off' (stops recording,
  // restores console). The report has no query string, cookies or saves.
  var trace = { rec: true, on: false, lines: [], max: 400, t0: Date.now(), orig: {}, state: null, stateWait: null };
  function fmt(v) {
    if (v instanceof Error) return v.message + (v.stack ? '\n' + String(v.stack).split('\n').slice(1, 5).join('\n') : '');
    if (typeof v === 'object') { try { return JSON.stringify(v); } catch (e) { return String(v); } }
    return String(v);
  }
  function tr(kind, text) {
    if (!trace.rec) return;
    var s = String(text).replace(/%c/g, '').replace(/\s+$/, '').slice(0, 1200), l = trace.lines, last = l[l.length - 1];
    if (last && last.k === kind && last.s === s) { last.n++; return; }
    l.push({ t: Date.now() - trace.t0, k: kind, s: s, n: 1 });
    if (l.length > trace.max) l.shift();
  }
  ['error', 'warn', 'log', 'info'].forEach(function (level) {
    var orig = trace.orig[level] = console[level];
    if (!orig) return;
    console[level] = function () {
      try { tr(level === 'error' ? 'E' : level === 'warn' ? 'W' : 'I', Array.prototype.map.call(arguments, fmt).join(' ')); } catch (e) {}
      return orig.apply(console, arguments);
    };
  });
  window.addEventListener('error', function (e) { tr('E', (e.message || 'error') + (e.filename ? ' @' + e.filename.split('/').pop() + ':' + e.lineno : '')); });
  window.addEventListener('unhandledrejection', function (e) { tr('E', 'unhandled rejection: ' + fmt(e.reason)); });

  function traceCmd(type, json) {
    if (type === 'off') {
      trace.rec = false; trace.lines = [];
      for (var k in trace.orig) if (trace.orig[k]) console[k] = trace.orig[k];
    } else if (type === 'on' && !trace.on) {
      trace.on = true;
      var b = document.createElement('button');
      b.textContent = 'H5 log';
      b.setAttribute('style', 'position:fixed;left:4px;bottom:4px;z-index:2147483000;font:11px sans-serif;padding:3px 6px;' +
        'opacity:.45;background:#222;color:#fff;border:1px solid #888;border-radius:4px;cursor:pointer');
      b.onclick = function (e) { e.stopPropagation(); openReport(); };
      document.body.appendChild(b);
    } else if (type === 'state') {
      trace.state = json;
      if (trace.stateWait) { var w = trace.stateWait; trace.stateWait = null; w(); }
    }
  }
  function buildReport() {
    var a = H5.adapter ? H5.adapter.id : '-', out = [];
    out.push('=== H5 trace report ===');
    out.push('time: ' + new Date().toISOString() + '   page age: ' + ((Date.now() - trace.t0) / 1000).toFixed(1) + 's');
    out.push('page: ' + location.host + location.pathname + '   adapter: ' + a + '   in iframe: ' + (window.top !== window));
    out.push('browser: ' + navigator.userAgent);
    out.push('window: ' + innerWidth + 'x' + innerHeight + ' @' + (window.devicePixelRatio || 1) + 'x   visibility: ' + document.visibilityState);
    out.push('unity: ' + (trace.state || '(no reply)'));
    out.push('--- log (oldest first, ' + trace.lines.length + ' entries) ---');
    trace.lines.forEach(function (l) {
      out.push('[' + (l.t / 1000).toFixed(1) + 's] ' + l.k + ' ' + l.s + (l.n > 1 ? '  (x' + l.n + ')' : ''));
    });
    return out.join('\n');
  }
  function openReport() {
    if (!trace.on) { (trace.orig.warn || console.warn).call(console, '[H5] the trace report is only in development builds'); return; }
    trace.state = null;
    var shown = false, show = function () { if (shown) return; shown = true; showPanel(buildReport()); };
    trace.stateWait = show;
    H5.emit({ type: 'traceRequest' });
    setTimeout(show, 1000);
  }
  function showPanel(text) {
    var old = document.getElementById('h5-trace'); if (old) old.remove();
    var d = document.createElement('div');
    d.id = 'h5-trace';
    d.setAttribute('style', 'position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center');
    d.innerHTML = '<div style="background:#fff;color:#111;width:min(900px,94vw);max-height:90vh;display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:8px;font:13px sans-serif">' +
      '<b>H5 trace report</b><span>Copy and paste it into the chat.</span>' +
      '<textarea readonly style="width:100%;height:60vh;font:11px monospace;white-space:pre"></textarea>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end"><span class="st" style="align-self:center;color:#080"></span>' +
      '<button class="cp" style="padding:6px 14px">Copy</button><button class="cl" style="padding:6px 14px">Close</button></div></div>';
    var ta = d.querySelector('textarea'), st = d.querySelector('.st');
    ta.value = text;
    ['pointerdown', 'mousedown', 'touchstart', 'keydown', 'wheel'].forEach(function (ev) { d.addEventListener(ev, function (e) { e.stopPropagation(); }); });
    d.querySelector('.cl').onclick = function () { d.remove(); };
    d.querySelector('.cp').onclick = function () {
      var fallback = function () {
        ta.focus(); ta.select();
        var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
        st.textContent = ok ? 'Copied' : 'Select all (Ctrl/Cmd+A) and copy';
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { st.textContent = 'Copied'; }, fallback);
      else fallback();
    };
    document.body.appendChild(d);
  }

  var H5 = window.H5 = {
    adapter: null,
    config: window.__H5_CONFIG__ || {},
    registerAdapter: function (a) { adapters[a.id] = a; },

    // Shared helper for adapters that must load a portal SDK themselves. Rejects on error/timeout.
    loadScript: function (src, ms) {
      return new Promise(function (resolve, reject) {
        var s = document.createElement('script'), t = null, done = false;
        var fin = function (fn, v) { if (done) return; done = true; clearTimeout(t); fn(v); };
        s.src = src; s.async = true;
        s.onload = function () { fin(resolve); };
        s.onerror = function () { fin(reject, new Error('load failed: ' + src)); };
        if (ms) t = setTimeout(function () { fin(reject, new Error('timeout: ' + src)); }, ms);
        document.head.appendChild(s);
      });
    },

    emit: function (msg) {
      if (msg.type !== 'result' && msg.type !== 'qaCommand' && msg.type !== 'traceRequest') tr('<', 'signal ' + msg.type + (msg.flag != null ? ' ' + msg.flag : ''));
      if (sink) sink(msg); else queue.push(msg);
    },

    // Called from h5sdk.jslib once Unity is up.
    attach: function (fn) {
      sink = fn;
      if (readyMsg) fn(readyMsg);
      var q = queue; queue = [];
      for (var i = 0; i < q.length; i++) fn(q[i]);
    },

    // Called by the page BEFORE Unity starts. Never rejects: falls back to a no-op adapter.
    boot: function () {
      var cfg = H5.config;
      var qs = (location.search.match(/[?&]h5platform=([^&]+)/) || [])[1];
      var id = qs || cfg.platform;
      var adapter = adapters[id];
      if (!adapter) {
        for (var k in adapters) { if (adapters[k].detect && adapters[k].detect()) { adapter = adapters[k]; break; } }
      }
      adapter = adapter || adapters.none;
      H5.adapter = adapter;
      var done = function (ok) {
        if (!ok) console.warn('[H5] adapter init failed, continuing without portal features:', adapter.id);
        var caps = adapter.capabilities || {};
        readyMsg = {
          type: 'ready', platform: adapter.id, flag: !!caps.ownsPause,
          banner: !!caps.banner, advancedBanner: !!(caps.advancedBanner && (typeof caps.advancedBanner !== 'function' || caps.advancedBanner())),
          adblock: false
        };
        H5.emit(readyMsg);
      };
      var p;
      try { p = Promise.resolve(adapter.init ? adapter.init(cfg[adapter.id] || {}, H5) : true); } catch (e) { p = Promise.reject(e); }
      return p.then(function () { done(true); }, function (e) { console.error(e); done(false); });
    },

    progress: function (p) { try { if (H5.adapter && H5.adapter.progress) H5.adapter.progress(p); } catch (e) {} },

    // Unity -> adapter. Results are sent back as {type:'result', id, ok, value}.
    call: function (method, args, id) {
      var a = H5.adapter || adapters.none;
      if (method !== 'trace' && method !== 'qaResult' && method !== 'qaState')
        tr('>', method + (args.placement ? ' ' + args.placement : '') + (args.type ? ' ' + args.type : '') + (args.key ? ' ' + args.key : '') + (args.json ? ' (' + args.json.length + ' bytes)' : ''));
      var reply = function (ok, value) {
        if (method !== 'trace') tr('<', method + ' ' + (ok ? 'ok' : 'FAILED') + (method === 'load' || value == null || value === '' ? '' : ' ' + String(value).slice(0, 40)));
        if (id > 0) H5.emit({ type: 'result', id: id, ok: ok, value: value == null ? '' : String(value) });
      };
      var run = function (fn) {
        try { Promise.resolve(fn()).then(function (v) { reply(true, v); }, function (e) { if (!(method === 'load' && e && e.message === 'not found')) console.error('[H5]', method, e); reply(false, ''); }); }
        catch (e) { console.error('[H5]', method, e); reply(false, ''); }
      };
      switch (method) {
        case 'showInterstitial': return run(function () { return interstitial(a, args.placement); });
        case 'showRewarded': return run(function () { return a.showRewarded ? a.showRewarded(args.placement).then(function (ok) { return ok ? '1' : '0'; }) : '0'; });
        case 'showBanner': return run(function () { return a.showBanner && a.showBanner(args.position); });
        case 'hideBanner': return run(function () { return a.hideBanner && a.hideBanner(); });
        case 'showAdvancedBanners': return run(function () { return a.showAdvancedBanners && a.showAdvancedBanners(args.placement); });
        case 'hideAdvancedBanners': return run(function () { return a.hideAdvancedBanners && a.hideAdvancedBanners(); });
        case 'event': return run(function () {
          // Portals that require an ad as soon as the game is ready (capabilities.adOnGameReady: GameMonetize,
          // GameDistribution) get exactly one interstitial on the first game_ready. All other portals forbid it.
          if (args.type === 'game_ready' && !prerollDone && (a.capabilities || {}).adOnGameReady) {
            prerollDone = true;
            interstitial(a, 'game_ready').catch(function (e) { console.warn('[H5] preroll failed', e); });
          }
          return a.event && a.event(args.type, args.name);
        });
        case 'save': return run(function () { return a.save ? a.save(args.key, args.json).then(function () { return ''; }) : Promise.reject(new Error('no storage')); });
        case 'load': return run(function () { return a.load ? a.load(args.key).then(function (v) { if (v == null) throw new Error('not found'); return v; }) : Promise.reject(new Error('no storage')); });
        case 'playerName': return run(function () { return a.playerName ? a.playerName() : 'Player'; });
        case 'locale': return run(function () { return a.locale ? a.locale() : (navigator.language || 'en').split('-')[0]; });
        // Only the internal QA adapter implements this (game state sampled after pause/mute/ad signals).
        case 'qaResult': return run(function () { return a.qaResult && a.qaResult(args.key, args.type === '1', args.json); });
        case 'qaState': return run(function () { return a.qaState && a.qaState(args.type, args.json); });
        case 'trace': return run(function () { traceCmd(args.type, args.json); });
        case 'traceReport': return run(function () { openReport(); });
        default: console.warn('[H5] unknown call', method);
      }
    }
  };

  H5.traceReport = openReport;   // also from the browser console: H5.traceReport()

  // Fallback: no portal features, localStorage persistence.
  H5.registerAdapter({
    id: 'none',
    capabilities: {},
    showRewarded: function () { return Promise.resolve(true); },
    save: function (k, v) { try { localStorage.setItem('h5:' + k, v); return Promise.resolve(); } catch (e) { return Promise.reject(e); } },
    load: function (k) { try { return Promise.resolve(localStorage.getItem('h5:' + k)); } catch (e) { return Promise.reject(e); } }
  });
})();

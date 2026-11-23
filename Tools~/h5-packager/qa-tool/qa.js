/* H5 QA tool - runs a game packaged with the internal `qa` adapter (served at /game/) and checks it against
 * portal certification requirements. The adapter calls window.H5QA_HOST.log(kind, data) for everything it sees;
 * this page turns that stream into checks. Results survive game reloads (needed for the save persistence check). */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var AUDIBLE = 0.003;   // RMS above this = sound is playing
  var SILENT = 0.0015;   // RMS below this = silent
  var GRACE = 700;       // ms allowed for the game to react to pause/mute
  var PROBE = 'qa_probe'; // placement of ads this tool shows by itself (not requested by the game)
  var AUTO = /[?&]auto=1\b/.test(location.search);
  var TESTS = /[?&]tests=1\b/.test(location.search);

  // ---------------------------------------------------------------- state
  var info = { name: 'game' };
  var settingsKey = 'h5qa-settings';
  var settings = Object.assign({ interstitial: 'success', rewarded: 'success', adDurationSec: 3, locale: 'en', playerName: 'QA Player', muted: false },
    JSON.parse(localStorage.getItem(settingsKey) || '{}'));
  settings.muted = false; // platform mute always starts off
  var events = [];        // {t, run, kind, data}
  var runs = [];          // {index, start, ...derived}
  var cur = null;
  var hiddenWindows = [], muteWindows = []; // {run, start, end}
  var t0 = performance.now();
  var now = function () { return performance.now() - t0; };

  function newRun() {
    cur = { index: runs.length, start: now(), ready: null, attach: null, progress100: null, gameReady: [], calls: [], ads: [], openAd: null,
      saves: [], loads: [], errors: [], audio: [], audioCtx: null, locale: false, banner: false, levels: {}, states: [] };
    runs.push(cur);
  }

  window.H5QA_HOST = {
    settings: settings,
    log: function (kind, data) {
      if (!cur) newRun();
      var e = { t: now(), run: cur.index, kind: kind, data: data };
      if (kind !== 'audio') { events.push(e); appendLog(e); }
      digest(e);
      schedule();
    }
  };

  function digest(e) {
    var d = e.data, r = cur;
    switch (e.kind) {
      case 'emit':
        if (d.type === 'ready' && r.ready == null) r.ready = e.t;
        break;
      case 'attach': r.attach = e.t; break;
      case 'progress': if (d.p >= 1 && r.progress100 == null) r.progress100 = e.t; break;
      case 'call':
        r.calls.push({ t: e.t, method: d.method, args: d.args, id: d.id });
        if (d.method === 'locale') r.locale = true;
        break;
      case 'event':
        if (d.type === 'game_ready') r.gameReady.push(e.t);
        if (/^level_/.test(d.type)) r.levels[d.type] = (r.levels[d.type] || 0) + 1;
        (r.events = r.events || []).push({ t: e.t, type: d.type, name: d.name });
        break;
      case 'ad':
        if (d.phase === 'open') r.openAd = { kind: d.kind, placement: d.placement, probe: d.placement === PROBE, open: e.t, close: null, peak: 0 };
        else if (d.phase === 'close' && r.openAd) { r.openAd.close = e.t; r.openAd.completed = d.completed; r.ads.push(r.openAd); r.openAd = null; renderAds(); }
        else if (d.phase === 'nofill' || d.phase === 'rejected') { r.ads.push({ kind: d.kind, placement: d.placement, probe: d.placement === PROBE, open: e.t, close: e.t, nofill: true, reason: d.reason }); renderAds(); }
        break;
      case 'banner': if (d.visible) r.banner = true; break;
      case 'storage':
        if (d.op === 'save') r.saves.push({ t: e.t, key: d.key, bytes: d.bytes });
        else r.loads.push({ t: e.t, key: d.key, found: d.found });
        break;
      case 'error': r.errors.push({ t: e.t, text: d.text }); break;
      case 'console': if (d.level === 'error' && !/^\[H5 QA\]/.test(d.text)) r.errors.push({ t: e.t, text: d.text }); break;
      case 'audio-context': r.audioCtx = d.state || r.audioCtx; break;
      case 'game-state': r.states.push(Object.assign({ t: e.t }, d)); break;
      case 'event': break;
      case 'audio':
        r.audio.push({ t: e.t, rms: d.rms });
        if (r.audio.length > 6000) r.audio.splice(0, 1000);
        if (r.openAd) r.openAd.peak = Math.max(r.openAd.peak, e.t - r.openAd.open > GRACE ? d.rms : 0);
        meter(d);
        break;
    }
  }

  // ---------------------------------------------------------------- checks
  function maxRms(run, from, to) {
    var m = -1;
    run.audio.forEach(function (s) { if (s.t >= from && s.t <= to) m = Math.max(m, s.rms); });
    return m;
  }
  function everAudible() { return runs.some(function (r) { return r.audio.some(function (s) { return s.rms > AUDIBLE; }); }); }
  function allAds() { var a = []; runs.forEach(function (r) { a = a.concat(r.ads); }); return a; }
  var P = function (d) { return { s: 'pass', d: d || '' }; }, F = function (d) { return { s: 'fail', d: d }; },
    W = function (d) { return { s: 'warn', d: d }; }, N = function (d) { return { s: 'pending', d: d }; };
  var sec = function (ms) { return (ms / 1000).toFixed(1) + 's'; };

  var CHECKS = [
    { id: 'sdk_init', g: '1. SDK start-up', title: 'SDK initializes', run: function (r) {
      return r.ready != null ? P('ready after ' + sec(r.ready - r.start)) : N('waiting for H5.boot()'); } },
    { id: 'unity_attach', g: '1. SDK start-up', title: 'Unity connects to the SDK (H5SDK bootstrapped)', run: function (r) {
      return r.attach != null ? P('after ' + sec(r.attach - r.start)) : (r.progress100 != null && now() - r.progress100 > 8000 ? F('loaded but H5.attach never called - H5SdkBootstrapper missing or crashed') : N('waiting for Unity')); } },
    { id: 'game_ready', g: '1. SDK start-up', title: 'GameReady() sent exactly once', run: function (r) {
      if (r.gameReady.length === 1) return P('at ' + sec(r.gameReady[0] - r.start));
      if (r.gameReady.length > 1) return W('sent ' + r.gameReady.length + ' times in this run');
      return r.progress100 != null && now() - r.progress100 > 15000 ? F('not sent 15s after loading finished') : N('not sent yet'); } },
    { id: 'game_ready_after_load', g: '1. SDK start-up', title: 'GameReady() only after loading finished', run: function (r) {
      if (!r.gameReady.length) return N('');
      return r.progress100 != null && r.gameReady[0] >= r.progress100 ? P('') : F('sent before loading reached 100%'); } },
    { id: 'no_ad_before_ready', g: '3. Interstitial ads', title: 'No interstitial before GameReady()', run: function (r) {
      var inter = r.calls.filter(function (c) { return c.method === 'showInterstitial'; })[0];
      if (inter && (!r.gameReady.length || inter.t < r.gameReady[0])) return F('interstitial requested at ' + sec(inter.t - r.start) + ', before GameReady');
      return r.gameReady.length ? P('') : N(''); } },
    { id: 'interstitial', g: '3. Interstitial ads', title: 'Interstitial ad shows and closes', run: function () {
      var a = allAds().filter(function (x) { return x.kind === 'interstitial' && !x.nofill && !x.probe; });
      return a.length ? P(a.length + ' shown') : N(AUTO ? 'not requested by the game during the automatic run (needs gameplay)' : 'play until the game shows an interstitial'); } },
    { id: 'interstitial_nofill', g: '3. Interstitial ads', title: 'Game keeps working when an interstitial fails', manualHint: true, run: function () {
      var a = allAds().filter(function (x) { return x.kind === 'interstitial' && x.nofill && !x.probe; });
      return a.length ? continued(a, 'no-fill simulated ' + a.length + 'x') : N('Ads tab: set Interstitial = No fill, then trigger one in the game'); }, hint: 'nofill' },
    { id: 'save', g: '2. Save data', title: 'Progress saved via H5SDK.SaveData', run: function () {
      var n = runs.reduce(function (s, r) { return s + r.saves.length; }, 0);
      return n ? P(n + ' writes') : N('no save yet'); } },
    { id: 'load_before_ready', g: '2. Save data', title: 'Saves loaded before GameReady()', run: function (r) {
      if (!r.gameReady.length) return N('');
      var first = r.loads[0];
      if (!first) return W('no LoadData call in this run');
      return first.t <= r.gameReady[0] ? P('') : W('first LoadData ' + sec(first.t - r.gameReady[0]) + ' after GameReady'); } },
    { id: 'persist', g: '2. Save data', title: 'Progress survives a page reload', run: function (r) {
      var earlier = {};
      runs.slice(0, r.index).forEach(function (x) { x.saves.forEach(function (s) { earlier[s.key] = true; }); });
      var keys = Object.keys(earlier);
      if (!keys.length) return N(runs.reduce(function (s, x) { return s + x.saves.length; }, 0) ? 'press "Reload game"' : 'play until the game saves, then press "Reload game"');
      var hits = r.loads.filter(function (l) { return earlier[l.key]; });
      if (!hits.length) return r.gameReady.length ? F('saved keys (' + keys.join(', ') + ') were not loaded after reload') : N('');
      var miss = hits.filter(function (l) { return !l.found; });
      return miss.length ? F('not found after reload: ' + miss.map(function (l) { return l.key; }).join(', ')) : P(hits.length + ' key(s) restored'); } },
    { id: 'no_errors', g: '1. SDK start-up', title: 'No errors or exceptions in the console', run: function () {
      var errs = []; runs.forEach(function (r) { errs = errs.concat(r.errors); });
      return errs.length ? F(errs.length + ' error(s); first: ' + errs[0].text.slice(0, 140)) : (cur && cur.gameReady.length ? P('') : N('')); } },

    { id: 'rewarded', g: '4. Rewarded ads', title: 'Case 1 - ad watched to the end: the reward IS given', confirm: ['Reward received', 'No reward'], expect: 'yes', run: function () {
      var a = allAds().filter(function (x) { return x.kind === 'rewarded' && x.completed && !x.probe; });
      if (!a.length) return N('Ads tab: Rewarded = "Watched to the end", then trigger a rewarded ad in the game');
      return confirmed('rewarded', a.length, 'yes', 'The ad was completed but the game did not give the reward'); } },
    { id: 'rewarded_fail', g: '4. Rewarded ads', title: 'Case 2 - ad closed early / failed: NO reward', confirm: ['Reward received', 'No reward'], expect: 'no', run: function () {
      var a = allAds().filter(function (x) { return x.kind === 'rewarded' && !x.probe && (x.nofill || x.completed === false); });
      if (!a.length) return N('Ads tab: Rewarded = "Closed early", then trigger a rewarded ad in the game');
      return confirmed('rewarded_fail', a.length, 'no', 'The game gave a reward although the ad was closed early / failed'); } },
    { id: 'locale', g: '7. Other SDK features (optional)', title: 'Language read via H5SDK.GetLocale', run: function () {
      return runs.some(function (r) { return r.locale; }) ? P('') : N('not called'); } },
    { id: 'levels', g: '7. Other SDK features (optional)', title: 'Level events (LevelStarted / Completed / Failed)', run: function () {
      var all = {}; runs.forEach(function (r) { for (var k in r.levels) all[k] = (all[k] || 0) + r.levels[k]; });
      var ks = Object.keys(all);
      return ks.length ? P(ks.map(function (k) { return k.replace('level_', '') + '×' + all[k]; }).join(', ')) : N('not sent'); } },
    { id: 'banner', g: '7. Other SDK features (optional)', title: 'Banner', run: function () {
      return runs.some(function (r) { return r.banner; }) ? P('shown') : N('not used'); } },

    { id: 'audible', g: '5. Pause & audio', title: 'The game is not completely silent', run: function () {
      if (everAudible()) return P('');
      return cur && cur.audioCtx !== 'running' ? N('click inside the game once (browsers start audio only after a user gesture)') : N('no sound heard yet'); } },
    { id: 'ad_silent', g: '5. Pause & audio', title: 'Sound stops while a full-screen ad is shown', run: function () {
      var a = allAds().filter(function (x) { return !x.nofill && x.close != null; });
      if (!a.length) return N('needs an ad');
      if (!everAudible()) return N('no game sound heard yet - cannot judge');
      var loud = a.filter(function (x) { return x.peak > SILENT; });
      return loud.length ? F(loud.length + ' of ' + a.length + ' ad(s) had game audio (peak RMS ' + Math.max.apply(null, loud.map(function (x) { return x.peak; })).toFixed(4) + ') - handle OnMuteRequested/OnPauseRequested')
        : P(a.length + ' ad(s), silent'); } },
    { id: 'ad_pause', g: '5. Pause & audio', title: 'Gameplay pauses during ads (Time.timeScale = 0)', run: function () {
      var st = adStates('adStart', 'open');
      if (st === null) return N('needs an ad');
      if (!st.length) return N('no game state reported - the build needs H5PlatformSDK 2.1.0-beta.5+');
      var moving = st.filter(function (x) { return x.timeScale > 0; });
      return moving.length ? W('Time.timeScale = ' + moving[0].timeScale + ' during ' + moving.length + ' ad(s) - fine only if the game pauses another way (confirm manually)') : P(st.length + ' ad(s)'); } },
    { id: 'ad_resume', g: '5. Pause & audio', title: 'Game resumes after the ad closes', run: function () {
      var st = adStates('adEnd', 'close');
      if (st === null) return N('needs an ad');
      if (!st.length) return N('no game state reported - the build needs H5PlatformSDK 2.1.0-beta.5+');
      var frozen = st.filter(function (x) { return x.timeScale === 0; });
      return frozen.length ? F('Time.timeScale still 0 after ' + frozen.length + ' ad(s) closed - handle OnPauseRequested(false)') : P('timeScale ' + st.map(function (x) { return x.timeScale; }).join(', ')); } },
    { id: 'hidden_silent', g: '5. Pause & audio', title: 'Sound stops when the tab is hidden', run: function () { return windowCheck(hiddenWindows, 'press "Hide tab" for a few seconds'); } },
    { id: 'platform_mute', g: '5. Pause & audio', title: 'Game obeys the platform mute', run: function () { return windowCheck(muteWindows, 'toggle "Platform mute" for a few seconds'); } },
  ];

  // Which optional features the game uses. Answering "No" skips (passes) that step.
  var FEATURE_OF = { '2. Save data': 'save', '3. Interstitial ads': 'interstitial', '4. Rewarded ads': 'rewarded' };
  var REQUIRED = { save: true }; // answering No to these fails the step
  var FEATURE_Q = { save: 'Does the game save progress?', interstitial: 'Does the game show interstitial ads?', rewarded: 'Does the game offer rewarded ads?' };
  var uses = {};
  var usesKey = function () { return 'h5qa-uses:' + info.name; };
  function skipped(group, id) {
    var f = FEATURE_OF[group];
    if (f && uses[f] === 'no' && !REQUIRED[f]) return true;
    return false;
  }

  // The game counts as "continued" when it keeps talking to the SDK after the failed ad and logs no error since.
  function continued(ads, what) {
    var last = ads[ads.length - 1], later = 0, errs = 0;
    runs.forEach(function (r) {
      later += r.calls.filter(function (c) { return c.t > last.close + 300 && c.method !== 'showInterstitial' && c.method !== 'showRewarded'; }).length;
      errs += r.errors.filter(function (e) { return e.t > last.open; }).length;
    });
    if (errs) return F(what + ', then ' + errs + ' error(s) in the console');
    return later ? P(what + ', game kept running') : N(what + '. Keep playing - the game must carry on without freezing');
  }

  // Game states sampled after the adStart/adEnd of each shown ad (null = no ad shown yet).
  function adStates(reason, edge) {
    var out = [], any = false;
    runs.forEach(function (r) {
      r.ads.forEach(function (a) {
        if (a.nofill || a.close == null) return;
        any = true;
        var at = a[edge];
        var s = r.states.filter(function (x) { return x.reason === reason && x.t >= at && x.t <= at + 3000; })[0];
        if (s) out.push(s);
      });
    });
    return any ? out : null;
  }

  function windowCheck(list, hint) {
    var done = list.filter(function (w) { return (w.end || now()) - w.start > GRACE + 600; });
    if (!done.length) return N(hint);
    if (!everAudible()) return N('no game sound heard yet - cannot judge');
    var peak = 0;
    done.forEach(function (w) { var r = runs[w.run]; if (r) peak = Math.max(peak, maxRms(r, w.start + GRACE, w.end || now())); });
    return peak > SILENT ? F('audio kept playing (peak RMS ' + peak.toFixed(4) + ')') : P('silent');
  }

  // Tester confirmations for scripted cases: {id: {a: 'yes'|'no'|'ok'|'bad', n: number of matching events}}.
  // An answer counts only while no newer matching event happened (a new ad needs a new answer).
  var confirms = {}, viewed = {};
  var confirmKey = function () { return 'h5qa-confirm:' + info.name; };
  function confirmed(id, n, expect, failText) {
    var c = confirms[id];
    if (!c || c.n !== n) return { s: 'ask', d: 'Did the game give the reward? Answer below.' };
    return c.a === expect ? P('confirmed') : F(failText);
  }
  var LAYOUTS = [['layout_16x9', '16:9 landscape', '1280x720'], ['layout_9x16', '9:16 portrait', '720x1280'], ['layout_1x1', '1:1 square', '800x800']];
  LAYOUTS.forEach(function (l) {
    CHECKS.push({ id: l[0], g: '6. Screen layout', title: l[1] + ': layout is correct', confirm: ['Layout OK', 'Layout broken'], expect: 'yes', run: function () {
      var c = confirms[l[0]];
      if (!c && !viewed[l[0]]) return N('press "Show ' + l[1] + '", then look at the game: nothing cut off, nothing overlapping, popups closable');
      if (!c) return { s: 'ask', d: 'Is the layout correct at ' + l[2].replace('x', '×') + '?' };
      return c.a === 'yes' ? P('confirmed') : F('layout reported broken at ' + l[2].replace('x', '×')); } });
  });
  var ACTIONS = { ad_silent: 'testad', ad_pause: 'testad', ad_resume: 'testad', hidden_silent: 'hide', platform_mute: 'mute', layout_16x9: 'layout:1280x720', layout_9x16: 'layout:720x1280', layout_1x1: 'layout:800x800' };
  var ACT_LABEL = { testad: 'Show test ad', hide: 'Hide tab 4s', mute: 'Mute 4s', layout: 'Show' };
  function runAction(a) {
    if (a === 'testad') { var w = gameWin(); if (w && w.H5) w.H5.call('showInterstitial', { placement: PROBE }, 0); }
    else if (a === 'hide') { $('#btn-hide').click(); setTimeout(function () { $('#btn-hide').click(); }, 4000); }
    else if (a === 'mute') { muteToggle(); setTimeout(muteToggle, 4000); }
    else if (a.indexOf('layout:') === 0) { var sz = a.slice(7); $('#preset').value = sz; applyPreset(sz); LAYOUTS.forEach(function (l) { if (l[2] === sz) viewed[l[0]] = true; }); }
  }
  var manualKey = function () { return 'h5qa-manual:' + info.name; };
  var manual = {};

  // ---------------------------------------------------------------- render
  var pending = false;
  function schedule() { if (!pending) { pending = true; setTimeout(function () { pending = false; renderReq(); }, 400); } }

  function evaluate() {
    var r = cur || { index: 0, start: 0, calls: [], gameReady: [], loads: [], saves: [], errors: [], audio: [], ads: [], levels: {} };
    return CHECKS.map(function (c) { var f0 = FEATURE_OF[c.g]; var v = f0 && REQUIRED[f0] && uses[f0] === 'no' ? { s: 'fail', d: 'Required: progress must be saved and loaded through H5SDK.SaveData / LoadData' } : skipped(c.g, c.id) ? { s: 'pass', d: 'Skipped - the game does not use this' } : c.run(r); return { id: c.id, confirm: c.confirm, group: c.g, title: c.title, status: v.s, detail: v.d }; });
  }

  // ---- focused wizard: one case at a time ------------------------------------------------------
  var wiz = { id: null, follow: true, drop: null };
  var MERGED = '1. SDK start-up';
  function buildCases(res) {
    var list = [], groups = [];
    res.forEach(function (x) { if (groups.indexOf(x.group) < 0) groups.push(x.group); });
    groups.sort();
    groups.forEach(function (grp) {
      if (/^7\./.test(grp)) return; // optional features are informational, not part of the script
      var f = FEATURE_OF[grp], items = res.filter(function (x) { return x.group === grp; });
      if (f) {
        var a = uses[f] || '';
        list.push({ id: 'q:' + f, group: grp, kind: 'ask', feature: f, title: FEATURE_Q[f],
          status: !a ? 'pending' : (a === 'no' && REQUIRED[f]) ? 'fail' : 'pass',
          detail: !a ? 'Pick one to continue.' : a === 'no' ? (REQUIRED[f] ? 'Required: progress must be saved and loaded through H5SDK.SaveData / LoadData.' : 'Skipped - the game does not use this.') : 'Yes' });
        if (a === 'no') return;
      }
      if (grp === MERGED) {
        var bad = items.filter(function (x) { return x.status === 'fail'; })[0], wait = items.filter(function (x) { return x.status !== 'pass'; })[0];
        list.push({ id: 'start', group: grp, kind: 'merge', title: 'Start the game and wait until it is playable', items: items,
          status: bad ? 'fail' : wait ? 'pending' : 'pass', detail: (bad || wait) ? (bad || wait).title + (((bad || wait).detail) ? ' - ' + (bad || wait).detail : '') : 'The SDK started and the game reported ready.' });
        return;
      }
      items.forEach(function (x) { x.kind = 'check'; list.push(x); });
    });
    return list;
  }
  var DOT = { pass: 'PASS', fail: 'FAIL', pending: 'TODO', ask: 'TODO', warn: 'WARN' };
  function renderReq() {
    var res = evaluate(), cases = buildCases(res), html = '';
    var done = cases.filter(function (c) { return c.status === 'pass'; }).length;
    var fails = cases.filter(function (c) { return c.status === 'fail'; });
    var pct = cases.length ? Math.round(done * 100 / cases.length) : 0;
    var firstOpen = -1;
    cases.forEach(function (c, i) { if (firstOpen < 0 && c.status !== 'pass') firstOpen = i; });
    var idx = firstOpen < 0 ? cases.length : firstOpen;
    if (!wiz.follow && wiz.id) { var k = cases.map(function (c) { return c.id; }).indexOf(wiz.id); if (k >= 0) idx = k; }
    wiz.id = idx < cases.length ? cases[idx].id : null;

    $('#summary').innerHTML = '<button class="chip" data-drop="progress"><b style="color:' + (pct === 100 ? 'var(--pass)' : 'var(--text)') + '">' + pct + '%</b> Progress ▾</button>' +
      '<button class="chip" data-drop="findings"><b style="color:' + (fails.length ? 'var(--fail)' : 'var(--muted)') + '">' + fails.length + '</b> Findings ▾</button>' +
      '<span class="muted" style="align-self:center">run #' + (cur ? cur.index + 1 : 0) + '</span>';

    if (wiz.drop) {
      var list = wiz.drop === 'findings' ? fails : cases;
      html += '<div class="drop">' + (list.length ? list.map(function (c) {
        return '<div class="dr" data-go="' + c.id + '"><span class="dot ' + c.status + '">' + DOT[c.status] + '</span><div><div class="t">' + esc(c.title) + '</div>' +
          (wiz.drop === 'findings' && c.detail ? '<div class="d">' + esc(c.detail) + '</div>' : '<div class="d">' + esc(c.group) + '</div>') + '</div></div>';
      }).join('') : '<div class="d">No findings.</div>') + '</div>';
    }

    if (idx >= cases.length) {
      html += '<div class="wz"><h2>' + (fails.length ? fails.length + ' finding' + (fails.length > 1 ? 's' : '') + ' to fix' : 'All steps passed') + '</h2>' +
        '<p class="wz-desc">' + (fails.length ? 'Open Findings above, fix the game, then press Reload game and repeat the failed steps.' : 'Ready to send. Press Export report (top right) and send the report together with the build.') + '</p>' +
        '<div class="wz-nav"><button data-nav="back"' + (cases.length ? '' : ' disabled') + '>Back</button></div></div>';
      $('#req-list').innerHTML = html; return;
    }

    var c = cases[idx], open = c.status === 'pending' || c.status === 'ask';
    html += '<div class="wz"><div class="wz-head"><span class="ring">' + (idx + 1) + '</span><div><div class="wz-grp">' + esc(c.group.replace(/^\d+\.\s*/, '')) + '</div>' +
      '<div class="muted">Step ' + (idx + 1) + ' of ' + cases.length + '</div></div></div><h2>' + esc(c.title) + '</h2>';
    if (open && c.detail) html += '<p class="wz-desc">' + esc(c.detail) + '</p>';
    if (c.kind === 'merge') {
      html += '<div class="subs">' + c.items.map(function (x) {
        return '<div class="req"><span class="dot ' + x.status + '">' + DOT[x.status] + '</span><div><div class="t">' + esc(x.title) + '</div>' + (x.detail ? '<div class="d">' + esc(x.detail) + '</div>' : '') + '</div></div>';
      }).join('') + '</div>';
    }
    var ctl = '';
    if (c.kind === 'ask') ctl += '<button class="pill' + (uses[c.feature] === 'yes' ? ' on' : '') + '" data-qa="' + c.feature + '|yes">Yes</button><button class="pill' + (uses[c.feature] === 'no' ? ' on' : '') + '" data-qa="' + c.feature + '|no">No</button>';
    var act = ACTIONS[c.id];
    if (act) ctl += '<button class="pill act" data-act="' + act + '">' + ACT_LABEL[act.split(':')[0]] + '</button>';
    if (c.confirm && (c.status === 'ask' || c.status === 'pass' || c.status === 'fail')) {
      ctl += '<button class="pill" data-confirm="' + c.id + '|yes">' + esc(c.confirm[0]) + '</button><button class="pill" data-confirm="' + c.id + '|no">' + esc(c.confirm[1]) + '</button>';
    }
    if (ctl) html += '<div class="wz-ctl">' + ctl + '</div>';
    if (c.kind !== 'ask' || c.status !== 'pending') {
      html += '<div class="wz-status ' + c.status + '"><span class="dot ' + c.status + '">' + DOT[c.status] + '</span> ' +
        (open ? 'Waiting for you...' : esc(c.status === 'pass' ? 'Passed' + (c.detail && c.kind !== 'merge' ? ' - ' + c.detail : '') : 'Failed - ' + (c.detail || ''))) + '</div>';
    }
    html += '<div class="wz-nav"><button data-nav="back"' + (idx ? '' : ' disabled') + '>Back</button>' +
      '<button class="primary" data-nav="next"' + (open ? ' disabled' : '') + '>Next</button></div></div>';
    $('#req-list').innerHTML = html;

    $('#req-list').__cases = cases; $('#req-list').__idx = idx;
  }
  function go(id, follow) { wiz.id = id; wiz.follow = follow; wiz.drop = null; renderReq(); }
  $('#summary').addEventListener('click', function (e) {
    var d = e.target.closest && e.target.closest('[data-drop]'); if (!d) return;
    wiz.drop = wiz.drop === d.getAttribute('data-drop') ? null : d.getAttribute('data-drop'); renderReq();
  });
  $('#req-list').addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-act],[data-confirm],[data-qa],[data-nav],[data-go]') : null; if (!t || t.disabled) return;
    var list = $('#req-list').__cases || [], idx = $('#req-list').__idx || 0;
    if (t.hasAttribute('data-go')) return go(t.getAttribute('data-go'), false);
    if (t.hasAttribute('data-nav')) {
      if (t.getAttribute('data-nav') === 'back') { var prev = idx > 0 ? list[idx - 1] : list[list.length - 1]; return prev ? go(prev.id, false) : null; }
      var nxt = list[idx + 1]; if (!nxt) { wiz.follow = true; wiz.id = null; return renderReq(); }
      var fo = -1; list.forEach(function (c, i) { if (fo < 0 && c.status !== 'pass') fo = i; });
      return go(nxt.id, fo === idx + 1);
    }
    if (t.hasAttribute('data-act')) { runAction(t.getAttribute('data-act')); setTimeout(renderReq, 500); return; }
    if (t.hasAttribute('data-qa')) {
      var q = t.getAttribute('data-qa').split('|'); uses[q[0]] = q[1];
      localStorage.setItem(usesKey(), JSON.stringify(uses)); wiz.follow = true; return renderReq();
    }
    var cf = t.getAttribute('data-confirm');
    var id = cf.split('|')[0], yes = cf.split('|')[1] === 'yes', n = 1;
    if (id === 'rewarded') n = allAds().filter(function (x) { return x.kind === 'rewarded' && x.completed && !x.probe; }).length;
    if (id === 'rewarded_fail') n = allAds().filter(function (x) { return x.kind === 'rewarded' && !x.probe && (x.nofill || x.completed === false); }).length;
    confirms[id] = { a: yes ? 'yes' : 'no', n: n };
    localStorage.setItem(confirmKey(), JSON.stringify(confirms)); wiz.follow = true; renderReq();
  });

  // logs
  var KIND_GROUP = { call: 'sdk', emit: 'sdk', result: 'sdk', attach: 'sdk', init: 'sdk', progress: 'sdk', event: 'sdk', banner: 'ad', ad: 'ad', storage: 'storage', console: 'console', error: 'error', 'audio-context': 'sdk' };
  function logText(e) {
    var d = e.data;
    switch (e.kind) {
      case 'call': {
        // JsonUtility sends every Args field; show only the ones that are set, and only the size of save payloads.
        var shown = [];
        for (var k in d.args) {
          var v = d.args[k];
          if (v === '' || v == null) continue;
          shown.push(k + '=' + (k === 'json' ? '<' + String(v).length + ' chars>' : JSON.stringify(v)));
        }
        return 'Unity → ' + d.method + '(' + shown.join(', ') + ')' + (d.id ? ' #' + d.id : '');
      }
      case 'result': return 'result #' + d.id + ' ok=' + d.ok + (d.value ? ' value=' + String(d.value).slice(0, 120) : '');
      case 'emit': return 'portal → Unity ' + JSON.stringify(d);
      case 'event': return 'event ' + d.type + (d.name ? ' (' + d.name + ')' : '');
      case 'progress': return 'loading ' + Math.round(d.p * 100) + '%';
      case 'ad': return d.kind + ' ' + d.phase + (d.placement ? ' [' + d.placement + ']' : '') + (d.completed != null ? ' completed=' + d.completed : '') + (d.reason ? ' ' + d.reason : '');
      case 'storage': return d.op + ' "' + d.key + '"' + (d.op === 'load' ? (d.found ? ' found' : ' not found') : '') + ' ' + d.bytes + 'B';
      case 'console': return '[' + d.level + '] ' + d.text;
      case 'error': return d.text;
      case 'audio-context': return 'AudioContext ' + (d.state || '');
      case 'init': return 'QA adapter init ' + JSON.stringify(d.settings);
      case 'attach': return 'Unity attached (H5.attach)';
      default: return e.kind + ' ' + JSON.stringify(d);
    }
  }
  function logVisible(e) {
    var g = KIND_GROUP[e.kind] || 'sdk';
    var box = document.querySelector('#tab-logs input[data-kind="' + g + '"]');
    if (e.kind === 'progress' && e.data.p > 0 && e.data.p < 1) return false;
    return !box || box.checked;
  }
  function appendLog(e) {
    if (!logVisible(e)) return;
    var el = document.createElement('div');
    el.className = 'k-' + e.kind + (e.data && e.data.level ? ' lv-' + e.data.level : '');
    el.innerHTML = '<span class="ts">#' + (e.run + 1) + ' ' + sec(e.t - runs[e.run].start) + '</span>' + esc(logText(e));
    var box = $('#log'), atBottom = box.parentElement.scrollTop + box.parentElement.clientHeight >= box.parentElement.scrollHeight - 30;
    box.appendChild(el);
    if (box.children.length > 3000) box.removeChild(box.firstChild);
    if (atBottom) box.parentElement.scrollTop = box.parentElement.scrollHeight;
  }
  function rerenderLogs() { $('#log').innerHTML = ''; events.forEach(appendLog); }
  document.querySelectorAll('#tab-logs input').forEach(function (i) { i.onchange = rerenderLogs; });
  $('#btn-clear-logs').onclick = function () { $('#log').innerHTML = ''; };

  function renderAds() {
    var a = allAds();
    $('#ad-history').innerHTML = a.length ? a.slice().reverse().map(function (x) {
      return '<div class="ad-row">' + esc(x.kind) + ' <span class="muted">[' + esc(x.placement || '-') + ']</span> ' +
        (x.probe ? '<span class="muted">(QA probe)</span> ' : '') + (x.nofill ? 'no fill' + (x.reason ? ' (' + esc(x.reason) + ')' : '') : (x.completed ? 'completed' : 'closed early') + ' · ' + sec(x.close - x.open) + ' · audio peak ' + x.peak.toFixed(4)) + '</div>';
    }).join('') : 'No ads yet.';
  }

  function meter(d) {
    var pct = Math.min(100, Math.sqrt(d.rms) * 300);
    $('#meter-fill').style.width = pct + '%';
    $('#meter-fill').style.background = d.rms > AUDIBLE ? 'var(--pass)' : 'var(--pending)';
    $('#meter-state').textContent = !d.contexts ? 'no context' : !d.running ? 'suspended - click game' : d.rms.toFixed(4);
  }

  // storage
  function renderStorage() {
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k.indexOf('h5qa:') === 0) keys.push(k); }
    keys.sort();
    $('#storage').innerHTML = keys.length ? keys.map(function (k) {
      return '<div class="st-item"><div><b>' + esc(k.slice(5)) + '</b> <span class="muted">' + localStorage.getItem(k).length + ' chars</span></div>' +
        '<textarea data-k="' + esc(k) + '">' + esc(localStorage.getItem(k)) + '</textarea>' +
        '<div class="row"><button class="small" data-save="' + esc(k) + '">Apply</button><button class="small danger" data-del="' + esc(k) + '">Delete</button></div></div>';
    }).join('') : '<p class="muted">No data. Play the game until it saves.</p>';
  }
  $('#storage').addEventListener('click', function (e) {
    var s = e.target.getAttribute('data-save'), d = e.target.getAttribute('data-del');
    if (s) localStorage.setItem(s, document.querySelector('textarea[data-k="' + s + '"]').value);
    if (d) localStorage.removeItem(d);
    if (s || d) renderStorage();
  });
  $('#btn-st-refresh').onclick = renderStorage;
  $('#btn-st-clear').onclick = function () {
    var del = [];
    for (var i = 0; i < localStorage.length; i++) if (localStorage.key(i).indexOf('h5qa:') === 0) del.push(localStorage.key(i));
    del.forEach(function (k) { localStorage.removeItem(k); });
    renderStorage();
  };

  // ---------------------------------------------------------------- controls
  var frame = $('#game');
  var gameWin = function () { try { return frame.contentWindow; } catch (e) { return null; } };
  function loadGame() {
    newRun();
    hiddenOff(); if (settings.muted) muteToggle();
    frame.src = '/game/?run=' + runs.length;
    renderReq();
  }
  $('#btn-reload').onclick = loadGame;

  var hidden = null;
  function hiddenOff() {
    if (!hidden) return;
    hidden.end = now(); hidden = null;
    var w = gameWin();
    if (w && w.H5QA) { w.H5QA.setHidden(false); w.H5QA.emit({ type: 'pause', flag: false }); w.H5QA.emit({ type: 'mute', flag: settings.muted }); }
    $('#btn-hide').textContent = 'Hide tab'; $('#btn-hide').classList.remove('active');
  }
  $('#btn-hide').onclick = function () {
    if (hidden) return hiddenOff();
    var w = gameWin(); if (!w || !w.H5QA) return;
    hidden = { run: cur.index, start: now(), end: null }; hiddenWindows.push(hidden);
    w.H5QA.setHidden(true); w.H5QA.emit({ type: 'pause', flag: true }); w.H5QA.emit({ type: 'mute', flag: true });
    $('#btn-hide').textContent = 'Show tab'; $('#btn-hide').classList.add('active');
  };

  var muteWin = null;
  function muteToggle() {
    settings.muted = !settings.muted;
    var w = gameWin();
    if (w && w.H5QA) w.H5QA.emit({ type: 'mute', flag: settings.muted });
    if (settings.muted) { muteWin = { run: cur ? cur.index : 0, start: now(), end: null }; muteWindows.push(muteWin); }
    else if (muteWin) { muteWin.end = now(); muteWin = null; }
    $('#btn-mute').textContent = 'Platform mute: ' + (settings.muted ? 'on' : 'off');
    $('#btn-mute').classList.toggle('active', settings.muted);
  }
  $('#btn-mute').onclick = muteToggle;
  $('#btn-pause').onclick = function () { var w = gameWin(); if (w && w.H5QA) w.H5QA.emit({ type: 'pause', flag: true }); };
  $('#btn-resume').onclick = function () { var w = gameWin(); if (w && w.H5QA) w.H5QA.emit({ type: 'pause', flag: false }); };

  ['interstitial', 'rewarded', 'adDurationSec', 'locale', 'playerName'].forEach(function (k) {
    var el = $('#set-' + k);
    el.value = settings[k];
    el.onchange = function () {
      settings[k] = k === 'adDurationSec' ? Math.max(1, Number(el.value) || 3) : el.value;
      var save = Object.assign({}, settings); delete save.muted;
      localStorage.setItem(settingsKey, JSON.stringify(save));
    };
  });

  document.querySelectorAll('#tabs button').forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll('#tabs button, .tab').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on'); $('#tab-' + b.getAttribute('data-tab')).classList.add('on');
      if (b.getAttribute('data-tab') === 'storage') renderStorage();
    };
  });

  // screen presets
  var wrap = $('#frame-wrap');
  function applyPreset(v) {
    if (v === 'fit') { wrap.classList.add('fit'); frame.style.width = frame.style.height = ''; frame.style.transform = ''; }
    else {
      wrap.classList.remove('fit');
      var p = v.split('x').map(Number);
      frame.style.width = p[0] + 'px'; frame.style.height = p[1] + 'px';
      var s = Math.min(1, (wrap.clientWidth - 24) / p[0], (wrap.clientHeight - 24) / p[1]);
      frame.style.transform = 'scale(' + s + ')';
    }
    setTimeout(function () { $('#stage-size').textContent = frame.clientWidth + '×' + frame.clientHeight + (v === 'fit' ? '' : ' (shown at ' + Math.round(frame.getBoundingClientRect().width / frame.clientWidth * 100) + '%)'); }, 50);
  }
  $('#preset').onchange = function () { applyPreset(this.value); };
  window.addEventListener('resize', function () { applyPreset($('#preset').value); });
  $('#btn-resize').onclick = function () {
    var seq = ['1280x720', '720x1280', '800x800', '393x852', '852x393', '1024x768', 'fit'], i = 0, btn = this;
    btn.disabled = true;
    var step = function () { $('#preset').value = seq[i]; applyPreset(seq[i]); i++; if (i < seq.length) setTimeout(step, 2500); else btn.disabled = false; };
    step();
  };

  // ---------------------------------------------------------------- report
  function report() {
    return {
      tool: 'h5-qa', toolVersion: info.tool, game: info.name, buildDir: info.buildDir, generatedAt: new Date().toISOString(),
      mode: AUTO ? 'headless' : 'interactive', runs: runs.length, settings: settings, screenshots: shots, tests: testResults,
      checks: baseline || evaluate(), featuresUsed: uses, confirmations: confirms,
      
      ads: allAds().map(function (a) { return { kind: a.kind, placement: a.placement || null, probe: !!a.probe, nofill: !!a.nofill, completed: a.completed == null ? null : a.completed, seconds: +((a.close - a.open) / 1000).toFixed(1), audioPeak: a.peak == null ? null : +a.peak.toFixed(4) }; }),
      errors: [].concat.apply([], runs.map(function (r) { return r.errors.map(function (e) { return { run: r.index + 1, text: e.text }; }); })),
    };
  }
  window.H5QA_REPORT = report; // for headless runners
  $('#btn-export').onclick = function () {
    var json = JSON.stringify(report(), null, 2);
    fetch('/__qa/report', { method: 'POST', body: json }).catch(function () {});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = 'qa-report-' + info.name.replace(/[^A-Za-z0-9_-]+/g, '_') + '.json';
    a.click();
  };

  // ---------------------------------------------------------------- automatic run (`h5-packager qa --headless`)
  // No gameplay: it checks start-up, saves, pause/mute/hidden reactions (with a probe ad the tool shows itself),
  // takes screenshots at every screen preset, then reloads once for the persistence check.
  var shots = [];
  var baseline = null; // checks of the plain automatic run, kept when scenario tests reload the game
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function waitFor(cond, ms) {
    var end = Date.now() + ms;
    return new Promise(function (resolve) {
      (function poll() { if (cond()) resolve(true); else if (Date.now() > end) resolve(false); else setTimeout(poll, 250); })();
    });
  }
  function shot(name) {
    var r = frame.getBoundingClientRect();
    var q = 'name=' + encodeURIComponent(name) + '&x=' + Math.round(r.left) + '&y=' + Math.round(r.top) + '&w=' + Math.round(r.width) + '&h=' + Math.round(r.height);
    return fetch('/__qa/screenshot?' + q).then(function (res) { return res.ok ? res.json() : null; })
      .then(function (j) { if (j && j.file) shots.push({ name: name, file: j.file }); }).catch(function () {});
  }
  var step = function (msg) { fetch('/__qa/progress?msg=' + encodeURIComponent(msg)).catch(function () {}); };
  async function autoRun() {
    var q = new URLSearchParams(location.search), loadMs = (Number(q.get('timeout')) || 90) * 1000;
    step('loading game');
    var ok = await waitFor(function () { return cur && cur.gameReady.length; }, loadMs);
    if (!ok) { step('GameReady not received within ' + loadMs / 1000 + 's'); return finishAuto(); }
    step('game ready; idling 5s'); await sleep(5000);
    var presets = ['1280x720', '720x1280', '800x800', '393x852', '852x393', '1024x768'];
    for (var i = 0; i < presets.length; i++) {
      $('#preset').value = presets[i]; applyPreset(presets[i]); await sleep(2000);
      await shot('screen-' + presets[i]);
    }
    $('#preset').value = 'fit'; applyPreset('fit'); await sleep(1500);
    step('probe interstitial');
    var w = gameWin();
    if (w && w.H5) {
      w.H5.call('showInterstitial', { placement: PROBE }, 0);
      await sleep(1500); await shot('probe-ad-open');
      await waitFor(function () { return !cur.openAd; }, (settings.adDurationSec + 5) * 1000);
      await sleep(1500); await shot('probe-ad-closed');
    }
    step('hidden tab'); $('#btn-hide').click(); await sleep(3000); $('#btn-hide').click(); await sleep(1500);
    step('platform mute'); muteToggle(); await sleep(3000); muteToggle(); await sleep(1500);
    step('reload (save persistence)'); loadGame();
    await waitFor(function () { return cur.gameReady.length; }, loadMs);
    await sleep(4000);
    if (TESTS) { renderReq(); baseline = report().checks; await runTests(); }
    return finishAuto();
  }
  // ---------------------------------------------------------------- scenario tests (`qa --tests file.json`)
  // File: { "saveKey": "save_v1", "saveFormat": "typeMap" | "raw", "tests": [ { id, title, save, settings, steps[], expect[], timeoutMs } ] }
  // Steps : hook:<cmd>  wait:<ms>  waitfor:<expect>  settings:<key>=<value>  reload  screenshot:<name>  hide:<ms>  mute:<ms>
  // Expect: ad:<kind>:<open|close|completed|skipped|nofill>[:placement]   paused@ad   silent@ad   noerrors   gameready
  //         event:<type>   scene=<Name>   exists:<GameObject>   !exists:<GameObject>   hook:<cmd>=<value>
  //         save:<Type>.<field><op><value>   (op: = != > < >= <=)
  var testResults = [];
  var testFile = null;

  function readSave() {
    if (!testFile) return null;
    var raw = localStorage.getItem('h5qa:' + testFile.saveKey);
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  function saveValue(type, field) {
    var root = readSave();
    if (!root) return undefined;
    var obj = testFile.saveFormat === 'raw' ? root : (function () { try { return JSON.parse(root[type]); } catch (e) { return undefined; } })();
    if (testFile.saveFormat === 'raw' && type) obj = obj && obj[type];
    return field.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj);
  }
  function compare(actual, op, expected) {
    var a = actual, b = expected, na = Number(a), nb = Number(b);
    var num = !isNaN(na) && !isNaN(nb) && a !== '' && a != null;
    switch (op) {
      case '=': return num ? na === nb : String(a) === b;
      case '!=': return num ? na !== nb : String(a) !== b;
      case '>': return num && na > nb; case '<': return num && na < nb;
      case '>=': return num && na >= nb; case '<=': return num && na <= nb;
    }
    return false;
  }
  function hook(cmd, timeoutMs) {
    var w = gameWin();
    if (!w || !w.H5QA || !w.H5QA.command) return Promise.reject(new Error('game not loaded'));
    return w.H5QA.command(cmd, timeoutMs);
  }
  // Returns {ok, detail}. Evaluated against the current run, from the test's start time.
  async function checkExpect(x, since) {
    var r = cur, m;
    if ((m = x.match(/^ad:(\w+):(open|close|completed|skipped|nofill)(?::(.+))?$/))) {
      var kind = m[1], phase = m[2], pl = m[3];
      var ads = r.ads.concat(r.openAd ? [r.openAd] : []).filter(function (a) { return a.open >= since && a.kind === kind && (!pl || a.placement === pl); });
      var hit = ads.some(function (a) {
        if (phase === 'open') return !a.nofill; if (phase === 'nofill') return !!a.nofill;
        if (phase === 'close') return a.close != null && !a.nofill;
        if (phase === 'completed') return a.completed === true; if (phase === 'skipped') return a.completed === false;
      });
      return { ok: hit, detail: ads.length ? ads.map(function (a) { return a.kind + '[' + (a.placement || '-') + ']' + (a.nofill ? ' nofill' : a.close == null ? ' open' : a.completed ? ' completed' : ' closed'); }).join(', ') : 'no ' + kind + ' ad since test start' };
    }
    if (x === 'paused@ad' || x === 'silent@ad') {
      var shown = r.ads.filter(function (a) { return a.open >= since && !a.nofill && a.close != null; });
      if (!shown.length) return { ok: false, detail: 'no ad shown' };
      if (x === 'silent@ad') { var loud = shown.filter(function (a) { return a.peak > SILENT; }); return { ok: !loud.length, detail: loud.length ? 'audio peak ' + loud[0].peak.toFixed(4) : 'silent' }; }
      var st = r.states.filter(function (s) { return s.reason === 'adStart' && s.t >= since; });
      return { ok: st.length > 0 && st.every(function (s) { return s.timeScale === 0; }), detail: st.length ? 'timeScale ' + st.map(function (s) { return s.timeScale; }).join(',') : 'no game state reported' };
    }
    if (x === 'noerrors') { var errs = r.errors.filter(function (e) { return e.t >= since; }); return { ok: !errs.length, detail: errs.length ? errs[0].text.slice(0, 160) : '' }; }
    if (x === 'gameready') return { ok: r.gameReady.length > 0, detail: r.gameReady.length + 'x' };
    if ((m = x.match(/^event:(.+)$/))) { var ev = (r.events || []).filter(function (e) { return e.t >= since && e.type === m[1]; }); return { ok: ev.length > 0, detail: ev.length + 'x' }; }
    if ((m = x.match(/^scene=(.+)$/))) { var sc = await hook('scene'); return { ok: sc === m[1], detail: 'scene ' + sc }; }
    if ((m = x.match(/^(!?)exists:(.+)$/))) { var ex = await hook('exists:' + m[2]); return { ok: (ex === 'true') === !m[1], detail: m[2] + ' exists=' + ex }; }
    if ((m = x.match(/^hook:(.+?)(=|!=|>=|<=|>|<)(.*)$/))) { var hv = await hook(m[1]); return { ok: compare(hv, m[2], m[3]), detail: m[1] + ' -> ' + hv }; }
    if ((m = x.match(/^save:(\w+)\.([\w.]+)(=|!=|>=|<=|>|<)(.*)$/))) { var sv = saveValue(m[1], m[2]); return { ok: compare(sv, m[3], m[4]), detail: m[1] + '.' + m[2] + ' = ' + JSON.stringify(sv) }; }
    return { ok: false, detail: 'unknown expectation' };
  }
  async function eventually(x, since, timeoutMs) {
    var end = Date.now() + timeoutMs, last;
    while (true) {
      try { last = await checkExpect(x, since); } catch (e) { last = { ok: false, detail: e.message }; }
      if (last.ok || Date.now() > end) return last;
      await sleep(400);
    }
  }
  // "{today}" in save values -> local date yyyy-MM-dd (games that count per day, like DateTime.Now in Unity WebGL).
  function today() { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  // "{nowTicks}" -> current UTC time as .NET DateTime ticks (games that store DateTime.UtcNow.Ticks as a string).
  function nowTicks() { return String(BigInt(Date.now()) * 10000n + 621355968000000000n); }
  function fill(v) { return JSON.parse(JSON.stringify(v).replace(/\{today\}/g, today()).replace(/\{nowTicks\}/g, nowTicks())); }
  function seedSave(save) {
    if (save) save = fill(save);
    var del = [];
    for (var i = 0; i < localStorage.length; i++) if (localStorage.key(i).indexOf('h5qa:') === 0) del.push(localStorage.key(i));
    del.forEach(function (k) { localStorage.removeItem(k); });
    if (!save) return;
    var v = testFile.saveFormat === 'raw' ? save : Object.keys(save).reduce(function (o, k) { o[k] = typeof save[k] === 'string' ? save[k] : JSON.stringify(save[k]); return o; }, {});
    localStorage.setItem('h5qa:' + testFile.saveKey, JSON.stringify(v));
  }
  async function runTest(t) {
    var res = { id: t.id, title: t.title || t.id, status: 'pass', failures: [], log: [], seconds: 0 };
    var t0 = Date.now(), timeout = t.timeoutMs || 20000;
    step('test ' + t.id);
    var defaults = { interstitial: 'success', rewarded: 'success', adDurationSec: 2 };
    Object.keys(defaults).forEach(function (k) { settings[k] = defaults[k]; });
    Object.keys(t.settings || {}).forEach(function (k) { settings[k] = t.settings[k]; });
    // Unload the previous game first: while shutting down it may still save and would overwrite the seeded save.
    frame.src = 'about:blank';
    await sleep(800);
    seedSave(t.save);
    loadGame();
    if (!(await waitFor(function () { return cur.gameReady.length; }, 120000))) { res.status = 'fail'; res.failures.push('GameReady not received'); return res; }
    await sleep(t.settleMs || 3000);
    var since = now() - 50;
    try {
      for (var i = 0; i < (t.steps || []).length; i++) {
        var s = t.steps[i], m;
        res.log.push(s);
        if ((m = s.match(/^hook:(.+)$/))) res.log.push('  -> ' + await hook(m[1]));
        else if ((m = s.match(/^wait:(\d+)$/))) await sleep(+m[1]);
        else if ((m = s.match(/^waitfor:(.+?)(?::(\d+))?$/))) { var w = await eventually(m[1], since, m[2] ? +m[2] : timeout); if (!w.ok) throw new Error('waitfor ' + m[1] + ' failed: ' + w.detail); }
        else if ((m = s.match(/^settings:(\w+)=(.+)$/))) settings[m[1]] = m[1] === 'adDurationSec' ? +m[2] : m[2];
        else if (s === 'reload') { loadGame(); await waitFor(function () { return cur.gameReady.length; }, 120000); await sleep(2000); since = now() - 50; }
        else if ((m = s.match(/^screenshot:(.+)$/))) await shot(t.id + '-' + m[1]);
        else if ((m = s.match(/^preset:(.+)$/))) { $('#preset').value = m[1]; applyPreset(m[1]); await sleep(1500); }
        else if ((m = s.match(/^hide:(\d+)$/))) { $('#btn-hide').click(); await sleep(+m[1]); $('#btn-hide').click(); }
        else if ((m = s.match(/^mute:(\d+)$/))) { muteToggle(); await sleep(+m[1]); muteToggle(); }
        else throw new Error('unknown step ' + s);
      }
      for (var j = 0; j < (t.expect || []).length; j++) {
        var ex = t.expect[j], r;
        if (ex.charAt(0) === '!' && ex.indexOf('!exists:') !== 0) {
          // Negative: must still be false after a short settle time.
          await sleep(t.negativeWaitMs || 2500);
          try { r = await checkExpect(ex.slice(1), since); } catch (e) { r = { ok: false, detail: e.message }; }
          r = { ok: !r.ok, detail: r.detail };
        } else r = await eventually(ex, since, t.expectTimeoutMs || 8000);
        if (!r.ok) { res.status = 'fail'; res.failures.push(ex + ' (' + r.detail + ')'); }
      }
    } catch (e) { res.status = 'fail'; res.failures.push(e.message); }
    await shot(t.id + '-end');
    res.seconds = Math.round((Date.now() - t0) / 1000);
    return res;
  }
  async function runTests() {
    testFile = await fetch('/__qa/tests').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    if (!testFile || !testFile.tests) { step('no test file'); return; }
    testFile.saveKey = testFile.saveKey || 'save_v1';
    var only = new URLSearchParams(location.search).get('only');
    for (var i = 0; i < testFile.tests.length; i++) {
      var t = testFile.tests[i];
      if (only && only.split(',').indexOf(t.id) < 0) continue;
      var r = await runTest(t);
      testResults.push(r);
      step((r.status === 'pass' ? 'PASS ' : 'FAIL ') + t.id + (r.failures.length ? ' - ' + r.failures.join('; ') : '') + ' (' + r.seconds + 's)');
    }
  }

  function finishAuto() {
    renderReq();
    return fetch('/__qa/report?final=1', { method: 'POST', body: JSON.stringify(report(), null, 2) }).catch(function () {});
  }

  // ---------------------------------------------------------------- boot
  fetch('/__qa/info').then(function (r) { return r.json(); }).catch(function () { return {}; }).then(function (i) {
    info = Object.assign(info, i);
    document.title = 'H5 QA - ' + info.name;
    $('#game-name').textContent = info.name;
    var total = (info.buildFiles || []).reduce(function (s, f) { return s + f.size; }, 0);
    $('#game-meta').textContent = (info.buildDir || '') + (total ? ' · ' + (total / 1048576).toFixed(1) + ' MB' : '');
    $('#build-files').innerHTML = (info.buildFiles || []).map(function (f) { return esc(f.name) + ' - ' + (f.size / 1048576).toFixed(2) + ' MB'; }).join('<br>');
    uses = JSON.parse(localStorage.getItem(usesKey()) || '{}');
    confirms = JSON.parse(localStorage.getItem(confirmKey()) || '{}');
    applyPreset('fit');
    loadGame();
    if (AUTO) autoRun();
  });
  setInterval(renderReq, 2000);
})();

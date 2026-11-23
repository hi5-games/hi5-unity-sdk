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
    { id: 'sdk_init', g: '1. Build startup', title: 'SDK initializes', run: function (r) {
      return r.ready != null ? P('ready after ' + sec(r.ready - r.start)) : N('waiting for H5.boot()'); } },
    { id: 'unity_attach', g: '1. Build startup', title: 'Unity connects to the SDK (H5SDK bootstrapped)', run: function (r) {
      return r.attach != null ? P('after ' + sec(r.attach - r.start)) : (r.progress100 != null && now() - r.progress100 > 8000 ? F('loaded but H5.attach never called - H5SdkBootstrapper missing or crashed') : N('waiting for Unity')); } },
    { id: 'game_ready', g: '1. Build startup', title: 'GameReady() sent exactly once', run: function (r) {
      if (r.gameReady.length === 1) return P('at ' + sec(r.gameReady[0] - r.start));
      if (r.gameReady.length > 1) return W('sent ' + r.gameReady.length + ' times in this run');
      return r.progress100 != null && now() - r.progress100 > 15000 ? F('not sent 15s after loading finished') : N('not sent yet'); } },
    { id: 'game_ready_after_load', g: '1. Build startup', title: 'GameReady() only after loading finished', run: function (r) {
      if (!r.gameReady.length) return N('');
      return r.progress100 != null && r.gameReady[0] >= r.progress100 ? P('') : F('sent before loading reached 100%'); } },
    { id: 'no_ad_before_ready', g: '4. Interstitial ads', title: 'No interstitial before GameReady()', run: function (r) {
      var inter = r.calls.filter(function (c) { return c.method === 'showInterstitial'; })[0];
      if (inter && (!r.gameReady.length || inter.t < r.gameReady[0])) return F('interstitial requested at ' + sec(inter.t - r.start) + ', before GameReady');
      return r.gameReady.length ? P('') : N(''); } },
    { id: 'interstitial', g: '4. Interstitial ads', title: 'Interstitial ad shows; the game pauses and mutes', confirm: ['Yes, paused and muted', 'No'], expect: 'yes', run: function () {
      var a = allAds().filter(function (x) { return x.kind === 'interstitial' && !x.nofill && !x.probe; });
      if (!a.length) return N(AUTO ? 'not requested by the game during the automatic run (needs gameplay)' : 'play until the game shows an interstitial');
      return confirmed('interstitial', a.length, 'yes', 'The tester reported that the game did not pause and mute while the ad was shown', 'The ad was shown. Did the game pause and mute while it played, and carry on afterwards?'); } },
    { id: 'interstitial_nofill', g: '4. Interstitial ads', title: 'Game keeps working when an interstitial fails', manualHint: true, run: function () {
      var a = allAds().filter(function (x) { return x.kind === 'interstitial' && x.nofill && !x.probe; });
      return a.length ? continued(a, 'no-fill simulated ' + a.length + 'x') : N('Ads tab: set Interstitial = No fill, then trigger one in the game'); }, hint: 'nofill' },
    { id: 'save', g: '2. Game saves', title: 'Progress saved via H5SDK.SaveData', run: function () {
      var n = runs.reduce(function (s, r) { return s + r.saves.length; }, 0);
      return n ? P(n + (n === 1 ? ' write' : ' writes') + ' through H5SDK.SaveData') : N('no save yet'); } },
    { id: 'load_before_ready', g: '2. Game saves', title: 'Saves loaded before GameReady()', run: function (r) {
      if (!r.gameReady.length) return N('');
      var first = r.loads[0];
      if (!first) return W('no LoadData call in this run');
      return first.t <= r.gameReady[0] ? P('') : W('first LoadData ' + sec(first.t - r.gameReady[0]) + ' after GameReady'); } },
    { id: 'persist', g: '2. Game saves', title: 'Progress survives a page reload', confirm: ['Yes, progress is restored', 'No, progress is lost'], expect: 'yes', run: function (r) {
      if (confirms.persist && confirms.persist.a === 'yes') return P('confirmed after the reload');
      var earlier = {};
      runs.slice(0, r.index).forEach(function (x) { x.saves.forEach(function (s) { earlier[s.key] = true; }); });
      var keys = Object.keys(earlier);
      if (!keys.length) return N(runs.reduce(function (s, x) { return s + x.saves.length; }, 0) ? 'press "Reload game"' : 'play until the game saves, then press "Reload game"');
      var hits = r.loads.filter(function (l) { return earlier[l.key]; });
      if (!hits.length) return r.gameReady.length ? F('saved keys (' + keys.join(', ') + ') were not loaded after reload') : N('');
      var miss = hits.filter(function (l) { return !l.found; });
      return miss.length ? F('not found after reload: ' + miss.map(function (l) { return l.key; }).join(', ')) : confirmed('persist', r.index, 'yes', 'The tester reported that progress was not restored after the reload', 'The game loaded your save (' + hits.length + ' key(s)). Is your progress restored?'); } },
    { id: 'no_errors', g: '1. Build startup', title: 'No errors or exceptions in the console', run: function () {
      var errs = []; runs.forEach(function (r) { errs = errs.concat(r.errors); });
      return errs.length ? F(errs.length + ' error(s); first: ' + errs[0].text.slice(0, 140)) : (cur && cur.gameReady.length ? P('') : N('')); } },

    { id: 'rewarded_fail', g: '3. Rewarded ads', title: 'Ad closed early or failed: no reward', confirm: ['Reward received', 'No reward'], expect: 'no', run: function () {
      var a = allAds().filter(function (x) { return x.kind === 'rewarded' && !x.probe && (x.nofill || x.completed === false); });
      if (!a.length) return N('Ads tab: Rewarded = "Closed early", then trigger a rewarded ad in the game');
      return confirmed('rewarded_fail', a.length, 'no', 'The game gave a reward although the ad was closed early / failed'); } },
    { id: 'rewarded', g: '3. Rewarded ads', title: 'Ad watched to the end: the reward is given', confirm: ['Reward received', 'No reward'], expect: 'yes', run: function () {
      var a = allAds().filter(function (x) { return x.kind === 'rewarded' && x.completed && !x.probe; });
      if (!a.length) return N('Ads tab: Rewarded = "Watched to the end", then trigger a rewarded ad in the game');
      return confirmed('rewarded', a.length, 'yes', 'The ad was completed but the game did not give the reward'); } },
    { id: 'locale', g: '7. Other SDK features (optional)', title: 'Language read via H5SDK.GetLocale', run: function () {
      return runs.some(function (r) { return r.locale; }) ? P('') : N('not called'); } },
    { id: 'levels', g: '7. Other SDK features (optional)', title: 'Level events (LevelStarted / Completed / Failed)', run: function () {
      var all = {}; runs.forEach(function (r) { for (var k in r.levels) all[k] = (all[k] || 0) + r.levels[k]; });
      var ks = Object.keys(all);
      return ks.length ? P(ks.map(function (k) { return k.replace('level_', '') + '×' + all[k]; }).join(', ')) : N('not sent'); } },
    { id: 'banner', g: '7. Other SDK features (optional)', title: 'Banner', run: function () {
      return runs.some(function (r) { return r.banner; }) ? P('shown') : N('not used'); } },

    { id: 'audible', g: '5. System events', title: 'The game is not completely silent', run: function () {
      if (everAudible()) return P('');
      return cur && cur.audioCtx !== 'running' ? N('click inside the game once (browsers start audio only after a user gesture)') : N('no sound heard yet'); } },
    { id: 'platform_mute', g: '5. System events', title: 'Game obeys the platform mute', run: function () { return windowCheck(muteWindows, 'toggle "Platform mute" for a few seconds'); } },
    { id: 'mute_reload', g: '5. System events', title: 'The game stays muted after a reload', confirm: ['Yes, still muted', 'No, sound came back'], expect: 'yes', run: function () {
      if (muteHoldRun == null) return N('press "Mute and reload"');
      var c = confirms.mute_reload;
      if (c && c.n === muteHoldRun) return c.a === 'yes' ? P('stayed muted after the reload') : F('The tester reported that sound came back after the reload while the platform mute was on');
      if (!cur || cur.index !== muteHoldRun) return N('press "Mute and reload"');
      if (!cur.gameReady.length) return N('waiting for the game to start');
      var w = muteWindows.filter(function (x) { return x.run === muteHoldRun; })[0];
      var peak = w ? maxRms(cur, w.start + GRACE, w.end || now()) : 0;
      if (peak > SILENT) return F('audio is playing after the reload although the platform mute is on (peak RMS ' + peak.toFixed(4) + ')');
      return { s: 'ask', d: 'Is the game still muted after the reload?' }; } },
    { id: 'ad_silent', g: '5. System events', title: 'Sound stops while a full-screen ad is shown', run: function () {
      var a = allAds().filter(function (x) { return !x.nofill && x.close != null; });
      if (!a.length) return N('needs an ad');
      if (!everAudible()) return N('no game sound heard yet - cannot judge');
      var loud = a.filter(function (x) { return x.peak > SILENT; });
      return loud.length ? F(loud.length + ' of ' + a.length + ' ad(s) had game audio (peak RMS ' + Math.max.apply(null, loud.map(function (x) { return x.peak; })).toFixed(4) + ') - handle OnMuteRequested/OnPauseRequested')
        : P(a.length + ' ad(s), silent'); } },
    { id: 'ad_pause', g: '5. System events', title: 'Gameplay pauses during ads (Time.timeScale = 0)', run: function () {
      var st = adStates('adStart', 'open');
      if (st === null) return N('needs an ad');
      if (!st.length) return N('no game state reported - the build needs H5PlatformSDK 2.1.0-beta.5+');
      var moving = st.filter(function (x) { return x.timeScale > 0; });
      return moving.length ? W('Time.timeScale = ' + moving[0].timeScale + ' during ' + moving.length + ' ad(s) - fine only if the game pauses another way (confirm manually)') : P(st.length + ' ad(s)'); } },
    { id: 'ad_resume', g: '5. System events', title: 'Game resumes after the ad closes', run: function () {
      var st = adStates('adEnd', 'close');
      if (st === null) return N('needs an ad');
      if (!st.length) return N('no game state reported - the build needs H5PlatformSDK 2.1.0-beta.5+');
      var frozen = st.filter(function (x) { return x.timeScale === 0; });
      return frozen.length ? F('Time.timeScale still 0 after ' + frozen.length + ' ad(s) closed - handle OnPauseRequested(false)') : P('timeScale ' + st.map(function (x) { return x.timeScale; }).join(', ')); } },
    { id: 'hidden_silent', g: '5. System events', title: 'Sound stops when the tab is hidden', run: function () { return windowCheck(hiddenWindows, 'press "Hide tab" for a few seconds'); } },
  ];

  // Which optional features the game uses. Answering "No" skips (passes) that step.
  var FEATURE_OF = { '2. Game saves': 'save', '4. Interstitial ads': 'interstitial', '3. Rewarded ads': 'rewarded' };
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
  function confirmed(id, n, expect, failText, q) {
    var c = confirms[id];
    if (!c || c.n !== n) return { s: 'ask', d: q || 'Did the game give the reward? Answer below.' };
    return c.a === expect ? P('confirmed') : F(failText);
  }
  var LAYOUTS = [['layout_16x9', '16:9 landscape', '1280x720'], ['layout_9x16', '9:16 portrait', '720x1280'], ['layout_1x1', '1:1 square', '800x800']];
  LAYOUTS.forEach(function (l) {
    CHECKS.push({ id: l[0], g: '6. Scale test', title: l[1] + ': layout is correct', confirm: ['Layout OK', 'Layout broken'], expect: 'yes', run: function () {
      var c = confirms[l[0]];
      if (!c && !viewed[l[0]]) return N('press "Show ' + l[1] + '", then look at the game: nothing cut off, nothing overlapping, popups closable');
      if (!c) return { s: 'ask', d: 'Is the layout correct at ' + l[2].replace('x', '×') + '?' };
      return c.a === 'yes' ? P('confirmed') : F('layout reported broken at ' + l[2].replace('x', '×')); } });
  });
  var ACTIONS = { ad_silent: 'testad', ad_pause: 'testad', ad_resume: 'testad', hidden_silent: 'hide', platform_mute: 'mute', mute_reload: 'mutereload', persist: 'reload', layout_16x9: 'layout:1280x720', layout_9x16: 'layout:720x1280', layout_1x1: 'layout:800x800' };
  var ACT_LABEL = { testad: 'Show an ad', hide: 'Hide the tab', mute: 'Send mute signal', mutereload: 'Mute and reload', layout: 'Show this screen', reload: 'Reload game' };
  function runAction(a) {
    if (a === 'reload') loadGame();
    else if (a === 'testad') { var w = gameWin(); if (w && w.H5) w.H5.call('showInterstitial', { placement: PROBE }, 0); }
    else if (a === 'hide') { $('#btn-hide').click(); setTimeout(function () { $('#btn-hide').click(); }, 4000); }
    else if (a === 'mute') { muteToggle(); setTimeout(muteToggle, 4000); }
    else if (a === 'mutereload') { if (!settings.muted) muteToggle(); muteHold = true; loadGame(true); muteHoldRun = cur.index; }
    else if (a.indexOf('layout:') === 0) { var sz = a.slice(7); $('#preset').value = sz; applyPreset(sz); LAYOUTS.forEach(function (l) { if (l[2] === sz) viewed[l[0]] = true; }); }
  }
  var manualKey = function () { return 'h5qa-manual:' + info.name; };
  var manual = {};

  // ---------------------------------------------------------------- render
  var pending = false;
  function schedule() { if (!pending) { pending = true; setTimeout(function () { pending = false; renderReq(); }, 400); } }

  function evaluate() {
    var r = cur || { index: 0, start: 0, calls: [], gameReady: [], loads: [], saves: [], errors: [], audio: [], ads: [], levels: {} };
    return CHECKS.map(function (c) { var f0 = FEATURE_OF[c.g]; var v = f0 && REQUIRED[f0] && uses[f0] === 'no' ? { s: 'fail', d: 'Required: progress must be saved and loaded through H5SDK.SaveData / LoadData' } : skipped(c.g, c.id) ? { s: 'pass', d: 'Skipped - the game does not use this' } : c.run(r); if (cant[c.id] && v.s !== 'pass') v = { s: 'fail', d: 'Could not be triggered in the game.' }; return { id: c.id, confirm: c.confirm, group: c.g, title: c.title, status: v.s, detail: v.d }; });
  }

  // ---- focused wizard: one case at a time ------------------------------------------------------
  var wiz = { id: null, follow: true, drop: null, applied: null };
  var cant = {}, acked = {}; // cases the tester could not trigger / failed cases the tester moved past
  var MERGED = '1. Build startup';
  function buildCases(res) {
    var list = [], groups = [];
    res.forEach(function (x) { if (groups.indexOf(x.group) < 0) groups.push(x.group); });
    groups.sort();
    groups.forEach(function (grp) {
      if (/^7\./.test(grp)) return; // optional features are informational, not part of the script
      var f = FEATURE_OF[grp], items = res.filter(function (x) { return x.group === grp && !HIDE[x.id]; });
      if (f) {
        var a = uses[f] || '';
        list.push({ id: 'q:' + f, group: grp, kind: 'ask', feature: f, title: FEATURE_Q[f],
          status: !a ? 'pending' : (a === 'no' && REQUIRED[f]) ? 'fail' : 'pass',
          detail: !a ? 'Pick one to continue.' : a === 'no' ? (REQUIRED[f] ? 'Required: progress must be saved and loaded through H5SDK.SaveData / LoadData.' : 'Skipped - the game does not use this.') : 'Yes' });
        if (a === 'no') return;
      }
      if (grp === MERGED) {
        var bad = items.filter(function (x) { return x.status === 'fail'; })[0], wait = items.filter(function (x) { return x.status !== 'pass'; })[0];
        var sc = confirms.startup, st = bad ? 'fail' : (sc && sc.a === 'yes') ? 'pass' : wait ? 'pending' : !sc ? 'ask' : 'fail';
        list.push({ id: 'startup', group: grp, kind: 'merge', title: 'Start the game and wait until it is playable', items: items, confirm: ['Yes, the game is ready', 'No'],
          status: st, detail: bad ? bad.title + (bad.detail ? ' - ' + bad.detail : '') : st === 'fail' ? 'The tester reported that the game was not ready when GameReady() was sent.' : wait ? wait.title + (wait.detail ? ' - ' + wait.detail : '') : 'The SDK started and the game reported ready.' });
        return;
      }
      items.forEach(function (x) { x.kind = 'check'; list.push(x); });
    });
    return list;
  }
  var DOT = { pass: 'PASS', fail: 'FAIL', pending: 'TODO', ask: 'TODO', warn: 'WARN' };
  var PROMPT = {
    save: ['Play the game and complete a level so your progress can be saved.', 'Waiting for a save through H5SDK.SaveData...'],
    persist: ['Reload the game: your progress must come back.', 'Press Reload game and wait for the game to load.'],
    interstitial: ['Trigger an interstitial ad in the game.', 'Play until the game shows one. The tool plays a simulated ad.'],
    interstitial_nofill: ['Trigger an interstitial ad again. This time the ad fails to load.', 'The game must carry on normally: keep playing for a few seconds.'],
    rewarded_fail: ['Trigger a rewarded ad and close it before the end.', 'The tool closes the ad early. No reward should be granted.'],
    rewarded: ['Trigger a rewarded ad and let it play to the end.', 'The reward should be granted after the ad finishes.'],
    audible: ['Play the game until you hear sound.', 'Click inside the game once: browsers start audio only after a user gesture. The game must not be silent.'],
    platform_mute: ['The platform mutes the game.', 'Press the button: the platform sends a mute signal for 4 seconds. The game must go silent.'],
    mute_reload: ['Reload the game while the platform mute is on.', 'Press the button: the game reloads and the platform keeps it muted. Click inside the game and check that it stays silent.'],
    hidden_silent: ['The player switches to another browser tab.', 'Press the button: the tab is hidden for 4 seconds. Sound must stop, and the game must resume afterwards.'],
    ad_silent: ['A full-screen ad is shown.', 'Press the button. While the ad plays, the game sound and gameplay must stop.'],
    ad_pause: ['A full-screen ad is shown.', 'Press the button. While the ad plays, the game must pause.'],
    ad_resume: ['A full-screen ad is shown.', 'Press the button. After the ad closes, the game must carry on where it was.']
  };
  LAYOUTS.forEach(function (l) { PROMPT[l[0]] = ['Check the game at ' + l[1] + ' (' + l[2].replace('x', '×') + ').', 'Press the button, then look at the game: nothing cut off, nothing overlapping, popups closable.']; });
  var FAILT = {
    save: 'The game did not save progress.', persist: 'Progress was not restored after the reload.',
    interstitial: 'The interstitial ad was not triggered.', interstitial_nofill: 'The game did not keep working after a failed interstitial.',
    startup: 'The game was not ready when GameReady() was sent.', rewarded_fail: 'The rewarded ad was not handled correctly when closed early.', rewarded: 'The rewarded ad was not handled correctly when watched to the end.'
  };
  var ASK_DESC = {
    save: 'Saving means the game keeps the player\'s data (levels, scores, unlocks, settings) between sessions. This is required.',
    interstitial: 'Full-screen ads shown at natural pauses, for example between levels.',
    rewarded: 'Ads the player chooses to watch in exchange for a reward.'
  };
  var MODE_FOR = { rewarded: { rewarded: 'success' }, rewarded_fail: { rewarded: 'skip' }, interstitial: { interstitial: 'success' }, interstitial_nofill: { interstitial: 'nofill' } };
  var CANT = { save: 1, persist: 1, interstitial: 1, interstitial_nofill: 1, rewarded: 1, rewarded_fail: 1 };
  var BG = { no_ad_before_ready: 1, load_before_ready: 1, no_errors: 1 }; // silent background checks: only a failure is shown
  var PASST = {
    save: 'Save event detected.', interstitial: 'Interstitial ad detected.', interstitial_nofill: 'The game kept working after the failed ad.',
    audible: 'Game sound detected.', mute_reload: 'The game stayed muted after the reload.', platform_mute: 'The game went silent on the mute signal.', hidden_silent: 'The game went silent while the tab was hidden.',
    ad_silent: 'The game was silent during the ad.', ad_pause: 'The game paused during the ad.', ad_resume: 'The game resumed after the ad.'
  };
  var needAck = function (c) { return c.kind === 'check' && !c.confirm && !BG[c.id]; };
  var settled = function (c) {
    if (BG[c.id] && c.status !== 'fail') return true;
    if (c.status === 'pass' && !needAck(c)) return true;
    return !!acked[c.id] && (c.status === 'pass' || c.status === 'fail');
  };
  var HIDE = { interstitial_nofill: 1, ad_silent: 1, ad_pause: 1, ad_resume: 1 }; // still evaluated for the report, not part of the guided script
  var plain = function (g) { return g.replace(/^\d+\.\s*/, ''); };

  function groupState(cases, g) {
    var xs = cases.filter(function (c) { return c.group === g; });
    if (xs.some(function (c) { return c.status === 'fail'; })) return 'fail';
    if (xs.every(function (c) { return c.status === 'pass'; })) return 'pass';
    var cur1 = cases.filter(function (c) { return !settled(c); })[0];
    return cur1 && cur1.group === g ? 'run' : 'todo';
  }
  function applyMode(id) {
    var m = MODE_FOR[id]; if (!m) return;
    for (var k in m) { var el = $('#set-' + k); if (el && el.value !== m[k]) { el.value = m[k]; el.onchange(); } }
  }
  function saveFlags() {
    localStorage.setItem(usesKey(), JSON.stringify(uses)); localStorage.setItem(confirmKey(), JSON.stringify(confirms));
    localStorage.setItem('h5qa-flags:' + info.name, JSON.stringify({ cant: cant, acked: acked }));
  }
  function forget(ids) {
    ids.forEach(function (id) {
      delete cant[id]; delete acked[id]; delete confirms[id];
      if (id.indexOf('q:') === 0) delete uses[id.slice(2)];
    });
    saveFlags(); wiz.follow = true; wiz.drop = null; renderReq();
  }

  function renderReq() {
    var res = evaluate(), cases = buildCases(res), html = '';
    var done = cases.filter(function (c) { return c.status === 'pass'; }).length;
    var fails = cases.filter(function (c) { return c.status === 'fail'; });
    var pct = cases.length ? Math.round(done * 100 / cases.length) : 0;
    var firstOpen = -1;
    cases.forEach(function (c, i) { if (firstOpen < 0 && !settled(c)) firstOpen = i; });
    var idx = firstOpen < 0 ? cases.length : firstOpen;
    if (!wiz.follow && wiz.id) { var k = cases.map(function (c) { return c.id; }).indexOf(wiz.id); if (k >= 0) idx = k; }
    wiz.id = idx < cases.length ? cases[idx].id : null;
    var c = idx < cases.length ? cases[idx] : null;
    if (c && wiz.applied !== c.id) { wiz.applied = c.id; applyMode(c.id); }
    if (muteHold && document.body.classList.contains('cert') && (!c || c.id !== 'mute_reload')) { muteHold = false; if (settings.muted) muteToggle(); }

    var sum = '<button class="chip" data-drop="progress"><span><b class="num' + (pct === 100 ? ' ok' : '') + '">' + pct + '%</b><i>Progress</i></span><em>▾</em></button>' +
      '<button class="chip" data-drop="findings"><span><b class="num' + (fails.length ? ' bad' : ' dim') + '">' + fails.length + '</b><i>Findings</i></span><em>▾</em></button>';
    if ($('#summary').__sum !== sum) { $('#summary').innerHTML = sum; $('#summary').__sum = sum; }

    if (wiz.drop === 'progress') {
      var seen = [];
      cases.forEach(function (x) { if (seen.indexOf(x.group) < 0) seen.push(x.group); });
      html += '<div class="drop"><div class="drop-list">' + seen.map(function (g, n) {
        var st = groupState(cases, g), ids = cases.filter(function (x) { return x.group === g; }).map(function (x) { return x.id; });
        return '<div class="dr st-' + st + '" data-go="' + ids[0] + '"><span class="gn">' + (n + 1) + '.</span><div class="gt">' + esc(plain(g)) +
          '<div class="gs">' + ({ pass: 'Passed', fail: 'Findings', run: 'In progress', todo: '' })[st] + '</div></div>' +
          (st !== 'todo' ? '<button class="mini" data-restart="' + ids.join(',') + '">Restart test</button>' : '') + '</div>';
      }).join('') + '</div><div class="dr-foot"><button class="mini" data-restart-all="1">Restart all tests</button><button class="mini" data-drop-close="1">Close</button></div></div>';
    } else if (wiz.drop === 'findings') {
      html += '<div class="drop"><div class="drop-list">' + (fails.length ? fails.map(function (x) {
        return '<div class="dr" data-go="' + x.id + '"><span class="dot fail">FAIL</span><div class="gt">' + esc(FAILT[x.id] || x.title) + '<div class="gs">' + esc(x.detail || '') + '</div></div></div>';
      }).join('') : '<div class="gs" style="padding:8px 0">No findings.</div>') + '</div><div class="dr-foot"><button class="mini" data-drop-close="1">Close</button></div></div>';
    }

    var veil = false;
    if (!c) {
      html += '<div class="wz"><h2>' + (fails.length ? fails.length + ' finding' + (fails.length > 1 ? 's' : '') + ' to fix' : 'All steps passed') + '</h2>' +
        '<p class="wz-desc">' + (fails.length ? 'Open Findings above, fix the game, press Reload game, then restart the failed steps from Progress.' : 'Ready to send. Press Export report (top right) and send the report together with the build.') + '</p></div>';
      paint(html, false, cases, idx); return;
    }

    var open = c.status === 'pending' || c.status === 'ask', head = c.title, desc = open ? c.detail : '';
    if (c.kind === 'check' && c.status === 'pending' && PROMPT[c.id]) { head = PROMPT[c.id][0]; desc = PROMPT[c.id][1]; }
    if (c.kind === 'ask') desc = ASK_DESC[c.feature] || '';
    if (c.kind === 'check' && c.status === 'ask') { head = (c.detail || c.title).replace(/\s*Answer below\.?$/, ''); desc = ''; }
    if (c.kind === 'merge') { head = c.status === 'ask' ? 'Is the game actually ready at this moment?' : 'Start the game and wait until it is playable'; desc = c.status === 'ask' ? 'The SDK reported GameReady(). Look at the game: it must be fully loaded and playable right now.' : ''; }
    if (c.status === 'pass' && c.kind === 'check' && needAck(c)) { head = PASST[c.id] || c.title; desc = c.detail || ''; }
    if (c.status === 'fail') { head = FAILT[c.id] || (c.kind === 'ask' ? 'Progress saving is required.' : c.title); desc = c.detail || ''; veil = true; }
    if (c.status === 'pass' && c.kind !== 'merge') veil = true;
    if (c.status === 'fail' && c.kind === 'merge') veil = false;
    if (c.kind === 'ask') veil = true;

    html += '<div class="wz"><div class="wz-head"><span class="ring">' + (parseInt(c.group, 10) || idx + 1) + '</span><div class="wz-grp">' + esc(plain(c.group)) + '</div></div><h2>' + esc(head) + '</h2>';
    if (desc) html += '<p class="wz-desc">' + esc(desc) + '</p>';
    if (c.kind === 'merge') {
      html += '<div class="subs">' + c.items.map(function (x) {
        return '<div class="req"><span class="dot ' + x.status + '">' + DOT[x.status] + '</span><div><div class="t">' + esc(x.title) + '</div>' + (x.detail ? '<div class="d">' + esc(x.detail) + '</div>' : '') + '</div></div>';
      }).join('') + '</div>';
    }
    var ctl = '';
    if (c.kind === 'ask' && c.status !== 'fail') ctl += '<button class="pill" data-qa="' + c.feature + '|yes">Yes</button><button class="pill ghost" data-qa="' + c.feature + '|no">No</button>';
    var act = ACTIONS[c.id];
    if (act && (c.status === 'pending' || (c.status === 'ask' && c.id.indexOf('layout_') === 0))) ctl += '<button class="pill" data-act="' + act + '">' + ACT_LABEL[act.split(':')[0]] + '</button>';
    if (c.confirm && c.status === 'ask') ctl += '<button class="pill" data-confirm="' + c.id + '|yes">' + esc(c.confirm[0]) + '</button><button class="pill ghost" data-confirm="' + c.id + '|no">' + esc(c.confirm[1]) + '</button>';
    if (c.status === 'pending' && c.kind === 'check' && CANT[c.id]) ctl += '<span class="spin"></span><button class="pill ghost" data-cant="' + c.id + '">Can\'t trigger it</button>';
    else if (c.status === 'pending' && c.kind !== 'ask') ctl += '<span class="spin"></span>';
    if (c.status === 'fail') ctl += '<button class="pill" data-ack="' + c.id + '">Continue</button><button class="pill bad" data-retry="' + c.id + '">Try again</button>';
    if (c.status === 'pass' && c.kind !== 'merge') ctl += '<button class="pill" data-ack="' + c.id + '">Continue</button>';
    if (ctl) html += '<div class="wz-ctl">' + ctl + '</div>';
    html += '</div>';
    paint(html, veil, cases, idx);
  }
  // Repainting every 2 s restarted the spinner and reset the list scroll; only touch the DOM when the content changed.
  function paint(html, veil, cases, idx) {
    var box = $('#req-list');
    box.__cases = cases; box.__idx = idx;
    $('#veil').style.display = veil && document.body.classList.contains('cert') ? 'flex' : 'none';
    if (box.__html === html) return;
    var old = box.querySelector('.drop-list'), top = old ? old.scrollTop : 0;
    box.innerHTML = html; box.__html = html;
    var nl = box.querySelector('.drop-list'); if (nl) nl.scrollTop = top;
  }
  function go(id, follow) { wiz.id = id; wiz.follow = follow; wiz.drop = null; renderReq(); }
  $('#summary').addEventListener('click', function (e) {
    var d = e.target.closest && e.target.closest('[data-drop]'); if (!d) return;
    wiz.drop = wiz.drop === d.getAttribute('data-drop') ? null : d.getAttribute('data-drop'); renderReq();
  });
  $('#req-list').addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-act],[data-confirm],[data-qa],[data-go],[data-cant],[data-ack],[data-retry],[data-restart],[data-restart-all],[data-drop-close]') : null; if (!t || t.disabled) return;
    if (t.hasAttribute('data-drop-close')) { wiz.drop = null; return renderReq(); }
    if (t.hasAttribute('data-restart-all')) { uses = {}; confirms = {}; cant = {}; acked = {}; viewed = {}; saveFlags(); wiz.applied = null; wiz.follow = true; wiz.drop = null; loadGame(); return; }
    if (t.hasAttribute('data-restart')) return forget(t.getAttribute('data-restart').split(','));
    if (t.hasAttribute('data-go')) return go(t.getAttribute('data-go'), false);
    if (t.hasAttribute('data-cant')) { cant[t.getAttribute('data-cant')] = true; saveFlags(); wiz.follow = true; return renderReq(); }
    if (t.hasAttribute('data-ack')) { acked[t.getAttribute('data-ack')] = true; saveFlags(); wiz.follow = true; return renderReq(); }
    if (t.hasAttribute('data-retry')) { wiz.applied = null; return forget([t.getAttribute('data-retry')]); }
    if (t.hasAttribute('data-act')) { runAction(t.getAttribute('data-act')); setTimeout(renderReq, 500); return; }
    if (t.hasAttribute('data-qa')) {
      var q = t.getAttribute('data-qa').split('|'); uses[q[0]] = q[1];
      saveFlags(); wiz.follow = true; return renderReq();
    }
    var cf = t.getAttribute('data-confirm');
    var id = cf.split('|')[0], yes = cf.split('|')[1] === 'yes', n = 1;
    if (id === 'persist') n = cur ? cur.index : 0;
    if (id === 'mute_reload') n = muteHoldRun;
    if (id === 'interstitial') n = allAds().filter(function (x) { return x.kind === 'interstitial' && !x.nofill && !x.probe; }).length;
    if (id === 'rewarded') n = allAds().filter(function (x) { return x.kind === 'rewarded' && x.completed && !x.probe; }).length;
    if (id === 'rewarded_fail') n = allAds().filter(function (x) { return x.kind === 'rewarded' && !x.probe && (x.nofill || x.completed === false); }).length;
    confirms[id] = { a: yes ? 'yes' : 'no', n: n };
    saveFlags(); wiz.follow = true; renderReq();
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
  function loadGame(keepMute) {
    newRun();
    hiddenOff();
    if (keepMute === true) { if (muteWin) muteWin.end = now(); muteWin = { run: cur.index, start: now(), end: null }; muteWindows.push(muteWin); }
    else if (settings.muted) muteToggle();
    frame.src = '/game/?run=' + runs.length;
    renderReq();
  }
  $('#btn-reload').onclick = function () { loadGame(); };
  $('#btn-update').onclick = function () { loadGame(); };
  function showTool(name) {
    document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('on'); });
    $('#tab-' + name).classList.add('on');
    if (name === 'storage') renderStorage();
  }
  $('#tool').onchange = function () { showTool(this.value); };
  $('#btn-mode').onclick = function () {
    var cert = document.body.classList.toggle('cert');
    $('#btn-mode').textContent = cert ? 'Switch to manual testing' : 'Switch to guided steps';
    showTool(cert ? 'req' : $('#tool').value);
    applyPreset(cert ? 'fit' : $('#preset').value); renderReq();
  };
  var dockPaused = false;
  $('#btn-dockpause').onclick = function () {
    var w = gameWin(); if (!w || !w.H5QA) return;
    dockPaused = !dockPaused; w.H5QA.emit({ type: 'pause', flag: dockPaused });
    this.classList.toggle('active', dockPaused); this.title = dockPaused ? 'Resume (platform resume signal)' : 'Pause / resume (platform pause signal)';
  };
  $('#btn-full').onclick = function () { var el = $('#frame-wrap'); if (document.fullscreenElement) document.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen(); };

  var hidden = null;
  function hiddenOff() {
    if (!hidden) return;
    hidden.end = now(); hidden = null;
    var w = gameWin();
    if (w && w.H5QA) { w.H5QA.setHidden(false); w.H5QA.emit({ type: 'pause', flag: false }); w.H5QA.emit({ type: 'mute', flag: settings.muted }); }
    $('#btn-hide').title = 'Hide tab (simulates the player leaving the tab: pause + mute)'; $('#btn-hide').classList.remove('active');
  }
  $('#btn-hide').onclick = function () {
    if (hidden) return hiddenOff();
    var w = gameWin(); if (!w || !w.H5QA) return;
    hidden = { run: cur.index, start: now(), end: null }; hiddenWindows.push(hidden);
    w.H5QA.setHidden(true); w.H5QA.emit({ type: 'pause', flag: true }); w.H5QA.emit({ type: 'mute', flag: true });
    $('#btn-hide').title = 'Show tab again'; $('#btn-hide').classList.add('active');
  };

  var muteWin = null, muteHold = false, muteHoldRun = null;
  function muteToggle() {
    settings.muted = !settings.muted;
    var w = gameWin();
    if (w && w.H5QA) w.H5QA.emit({ type: 'mute', flag: settings.muted });
    if (settings.muted) { muteWin = { run: cur ? cur.index : 0, start: now(), end: null }; muteWindows.push(muteWin); }
    else if (muteWin) { muteWin.end = now(); muteWin = null; }
    $('#btn-mute').title = 'Platform mute: ' + (settings.muted ? 'on (click to unmute)' : 'off (the platform asks the game to mute)');
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

  // screen presets
  var wrap = $('#frame-wrap');
  function applyPreset(v) {
    var rr = document.querySelector('#scale-list input[value="' + v + '"]'); if (rr) rr.checked = true;
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
  $('#scale-list').innerHTML = Array.prototype.map.call($('#preset').options, function (o) { return '<label class="radio"><input type="radio" name="scale" value="' + o.value + '"><span>' + esc(o.textContent) + '</span></label>'; }).join('');
  $('#scale-list').onchange = function (e) { $('#preset').value = e.target.value; applyPreset(e.target.value); };
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
    var fl = JSON.parse(localStorage.getItem('h5qa-flags:' + info.name) || '{}'); cant = fl.cant || {}; acked = fl.acked || {};
    applyPreset('fit');
    loadGame();
    if (AUTO) autoRun();
  });
  setInterval(renderReq, 2000);
})();

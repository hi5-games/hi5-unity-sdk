# H5 QA tool: command line, automatic runs and scenario tests (internal)

The everyday guide for developers is [QA-Tool.md](QA-Tool.md). This page keeps the command-line details.

A local copy of what portal QA tools check, run against your **neutral build**
before you upload anything. It packages the build with an internal fake portal (`qa` adapter), serves it with the
same `Content-Encoding` headers a CDN sends, and checks the game in a browser page.

```bash
node "$H5CLI" build --project .                       # optional: neutral build in batchmode (close the Editor first)
node "$H5CLI" qa --in Builds/None/WEBGL_x --open      # http://localhost:8080
node "$H5CLI" qa --in Builds/None/WEBGL_x --host 0.0.0.0   # also prints a LAN URL to open on a phone
```
Automatic run (CI, agents, or a quick check before a manual session):
```bash
node "$H5CLI" qa --in Builds/None/WEBGL_x --headless [--timeout 90] [--report Builds/qa-report.json]
```
Opens the build in headless Chrome (or Edge; `--chrome <path>`), waits for `GameReady`, takes a screenshot at every
screen preset, shows one **probe interstitial** (the tool calls the ad itself, so the game's pause/mute reaction is
tested without gameplay), hides the tab, toggles platform mute, reloads once for the persistence check, then prints the
results, writes the report and `qa-screens/*.png` next to it. Exit code `1` when any check fails. Checks that need real
gameplay (the game's own ads, rewarded, no-fill handling) stay `pending`: do those in the interactive page.
Screenshots need Node 22+ (built-in WebSocket); older Node runs everything else.

`qa` never changes the build folder (it stages a copy in the temp folder). The `qa` build is for testing only and must never be uploaded to a portal.

## What it checks automatically
| Group | Check |
|---|---|
| SDK mandatory | SDK initializes · Unity attaches (`H5SdkBootstrapper` ran) · `GameReady()` exactly once, after loading reached 100% · no interstitial before `GameReady()` · an interstitial shows and closes · progress saved with `SaveData` · saves loaded before `GameReady()` · **saves survive a reload** (press *Reload game*) · no console errors/exceptions |
| SDK optional | rewarded completes · rewarded closed early / no fill (then confirm no reward) · `GetLocale` · level events · banner |
| System events | game is not silent · **silent while an ad is on screen** · **gameplay paused during the ad and resumed after it** (`Time.timeScale` reported by the SDK) · silent while the tab is hidden (*Hide tab*) · obeys platform mute (*Platform mute*) |

The pause checks need a build made with SDK 2.1.0-beta.5 or newer: with the `qa` adapter only, the SDK samples
`Time.timeScale`, `AudioListener.pause/volume` 0.5 s after each pause/mute/ad signal and reports it. A game that pauses
without `Time.timeScale` gets a `warn` (confirm by eye), never a `fail`; still 0 after the ad closed is a `fail`.

Audio is measured, not assumed: the adapter routes everything Unity sends to the speakers through an `AnalyserNode`.
Browsers start audio only after a user gesture, so click inside the game once.

## Tester controls
- **Ads tab**: next interstitial = show / no fill; next rewarded = watched / closed early / no fill; ad duration.
  The game must keep working in every case and give a reward only when watched.
- **Storage tab**: view, edit or delete the `h5qa:` saves, then *Reload game* to test loading (corrupt or old saves).
- **Platform tab**: locale and player name returned by the SDK, platform pause/resume.
- **Screen**: 16:9, 9:16, 1:1, iPhone portrait/landscape, tablet, and *Resize test* (cycles sizes live).
- **Feature questions** (Requirements tab): whether the game uses interstitial / rewarded ads. Saved per game in the
  browser and written to the report as `featuresUsed`. Save data is required, so answering No fails it. Rewarded and layout cases also ask the tester to confirm the outcome.

## Scenario tests (`--tests`)
Each game gets an `h5-tests.json`, written during the port from the survey (one scenario per ad placement,
rewarded reward, hidden purchase, save type, start-up path). Scenarios jump straight to the situation instead of playing:
a seeded save + test hooks. Needs a **development build** (hooks are compiled out of release builds).
```bash
node "$H5CLI" qa --in Builds/None/WEBGL_dev --headless --tests h5-tests.json [--only inter_level_win,shop_watch_ad]
```
```json
{ "saveKey": "save_v1", "saveFormat": "typeMap",
  "tests": [ { "id": "inter_level_win", "save": { "GameData": { "currentLevel": 12 } },
    "settings": { "interstitial": "success" },
    "steps": ["hook:play", "waitfor:scene=GamePlay", "hook:call:GamePlayManager.WinLevel",
              "waitfor:exists:PopupWinLose", "hook:call:PopupWinLose.OnNextBtnClick", "waitfor:ad:interstitial:close:level_win"],
    "expect": ["paused@ad", "silent@ad", "hook:level=13", "noerrors"] } ] }
```
- **save**: written to the QA storage before the game loads. `typeMap` = one key holding `{"Type": "<json>"}` (objects are
  stringified for you); `raw` = the object as is. `{today}` becomes the local date `yyyy-MM-dd`; `{nowTicks}` becomes the current UTC time in .NET ticks (for `DateTime.UtcNow.Ticks.ToString()` fields).
- **steps**: `hook:<cmd>` · `wait:<ms>` · `waitfor:<expect>[:<ms>]` · `settings:<key>=<value>` · `reload` · `preset:<WxH|fit>` ·
  `screenshot:<name>` · `hide:<ms>` · `mute:<ms>`
- **expect** (polled until true, 8 s; a leading `!` = must stay false): `ad:<kind>:<open|close|completed|skipped|nofill>[:placement]` ·
  `paused@ad` · `silent@ad` · `noerrors` · `gameready` · `event:<type>` · `scene=<Name>` · `exists:<GameObject>` / `!exists:` ·
  `hook:<cmd><op><value>` · `save:<Type>.<field><op><value>` (op `= != > < >= <=`)
- **Hooks** (`H5PlatformSDK.H5QAHooks`, `#if DEVELOPMENT_BUILD || UNITY_EDITOR`): built in `scene`, `timeScale`, `exists:<name>`,
  `tap:<button name>`, `call:<Component>.<Method>` (public, parameterless); games add their own with
  `H5QAHooks.Register("coin", _ => ...)`. Only reachable when the game runs in the QA tool.
- Results go to the report (`tests[]`), each test's screenshots to `qa-screens/<id>-*.png`; exit code 1 if a test fails.

## Editor run (Play Mode) — run this first
The same `h5-tests.json` runs in the Unity Editor, without a WebGL build: `H5PlatformSDK.QA.H5EditorQA.Run(testsPath, only)`
(from code, an Editor script or Unity MCP; `Cancel()`, `Status()`).
Each test seeds the save into the Editor storage, enters Play Mode from the first enabled build scene, waits for GameReady, runs the
steps and expectations and exits Play Mode; **all tests run even when some fail** (about 15–25 s per test).
Report: `Library/H5SDK/qa-editor-report.json`, screenshots `Library/H5SDK/qa-editor-screens/`, summary in the Console.
- Simulated like the qa adapter: interstitial/rewarded with `success` / `nofill` / `skip` and the pause+mute bracket, `hide:`, `mute:`,
  `reload` (Play Mode restarts, the save is kept).
- Differences: `preset:` is skipped (browser only); `silent@ad` is read from `AudioListener` (pause / volume 0), not measured.
- Browser-only problems still need the build run: compression/loading, real audio, tab visibility, `Screen.safeArea` in the
  browser, WebGL-only code (`#if UNITY_WEBGL && !UNITY_EDITOR`).

**Test loop:** run the whole suite → sort every failure (game bug / test bug / environment) → fix all of them → re-run in the Editor
until green → **one** development build → `qa --headless --tests` as the gate. Do not rebuild per failure.

## Trace log on real portals (development builds)
A **development** build shows a small **H5 log** button at the bottom-left of the page. It opens the trace report: page/browser/window,
the game state (scene, timeScale, audio, SDK pause/mute, plus game hooks `state`, `popups`, `level`, `coin` when registered), and the
last 400 log lines from page load: Unity logs, page errors, the portal SDK's console output, every SDK call and its result, and the
platform signals (pause, mute, adStart, adEnd). **Copy** puts it on the clipboard (select-all fallback inside portal iframes); paste it
into the chat and turn it into a scenario test. `H5.traceReport()` opens it from the browser console too. No query string, cookies or
save contents are included (only save sizes). Release builds turn the recording off and show no button.

## Report
*Export report* downloads `qa-report.json` and also writes it next to where `qa` was started (`--report <file>`).
`window.H5QA_REPORT()` returns the same object (for headless runs).
```json
{ "game": "Jewel Jam", "runs": 2, "checks": [ { "id": "persist", "group": "SDK mandatory", "status": "pass", "detail": "1 key(s) restored" } ],
  "featuresUsed": { "save": "yes", "interstitial": "yes", "rewarded": "no" }, "ads": [ { "kind": "interstitial", "completed": true, "audioPeak": 0 } ], "errors": [] }
```
Statuses: `pass`, `fail`, `warn`, `pending` (not exercised yet).

## Limits
- It tests the game's use of `H5SDK`, not a portal's own SDK: still run each zip in the portal's QA tool before publishing.
- It cannot see whether the game *granted* a reward; that is game logic the tool cannot observe, so the tester answers "reward received?" after each rewarded case (and "layout OK?" after each screen case); the answers are stored in the report as `confirmations`.

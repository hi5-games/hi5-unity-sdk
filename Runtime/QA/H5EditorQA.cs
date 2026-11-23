#if UNITY_EDITOR
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace H5PlatformSDK.QA
{
    /// <summary>
    /// Runs the scenario tests of h5-tests.json in Unity Play Mode (Editor only), so most bugs are found before any
    /// WebGL build. Same file and step/expect syntax as `h5-packager qa --tests`; see Documentation~/QA-Tool.md.
    ///
    /// Each test: seed the save into the Editor storage, enter Play Mode from the first build scene, wait for
    /// GameReady, run the steps and expectations, exit Play Mode. All tests run even when some fail.
    /// Simulated in the Editor: ads (success / nofill / skip, with the pause+mute bracket of the real bridge),
    /// tab hide, platform mute, reload. Browser-only steps (preset) are logged as skipped; silent@ad is checked from
    /// AudioListener (pause / volume 0) because there is no audio meter.
    /// State lives in Library/H5SDK/ files so it survives the domain reload of entering Play Mode.
    /// </summary>
    public static class H5EditorQA
    {
        private static readonly string Dir = Path.GetFullPath(Path.Combine(Application.dataPath, "../Library/H5SDK"));
        private static string RunFile => Path.Combine(Dir, "qa-editor-run.json");
        private static string StorageFile => Path.Combine(Dir, "qa-editor-storage.json");
        /// <summary>Report of the last run (JSON).</summary>
        public static string ReportFile => Path.Combine(Dir, "qa-editor-report.json");
        /// <summary>Screenshots of the last run.</summary>
        public static string ScreensDir => Path.Combine(Dir, "qa-editor-screens");

        // ------------------------------------------------------------------ persisted run state

        [Serializable]
        public class TestResult
        {
            public string id, title, status = "pass";
            public List<string> failures = new List<string>();
            public List<string> log = new List<string>();
            public int seconds;
            public long startedUnixMs;
        }

        [Serializable]
        private class Settings
        {
            public string interstitial = "success", rewarded = "success";
            public float adDurationSec = 2f;
        }

        [Serializable]
        private class RunState
        {
            public bool active;
            public string testsPath, only, startScenePath;
            public int testIndex = -1, stepIndex;
            public string phase;   // "fresh" | "reload" | "done"
            public long startedUnixMs;
            public Settings settings = new Settings();
            public TestResult current;
            public List<TestResult> results = new List<TestResult>();
        }

        [Serializable] private class Kv { public string key, value; }
        [Serializable] private class StorageData { public List<Kv> items = new List<Kv>(); }

        private static RunState LoadRun()
        {
            try { return File.Exists(RunFile) ? JsonUtility.FromJson<RunState>(File.ReadAllText(RunFile)) : null; }
            catch { return null; }
        }

        private static void SaveRun(RunState s)
        {
            Directory.CreateDirectory(Dir);
            File.WriteAllText(RunFile, JsonUtility.ToJson(s, true));
        }

        /// <summary>True while a scenario run is in progress (Editor storage and ads are simulated by the runner).</summary>
        public static bool Active
        {
            get
            {
                if (_activeCached == null) { var r = LoadRun(); _activeCached = r != null && r.active; }
                return _activeCached.Value;
            }
        }
        private static bool? _activeCached;

        // ------------------------------------------------------------------ storage (used by the Editor bridge)

        internal static void LoadStorage(Dictionary<string, string> into)
        {
            into.Clear();
            if (!File.Exists(StorageFile)) return;
            var data = JsonUtility.FromJson<StorageData>(File.ReadAllText(StorageFile));
            foreach (var kv in data.items) into[kv.key] = kv.value;
        }

        internal static void WriteStorage(Dictionary<string, string> from)
        {
            var data = new StorageData();
            foreach (var kv in from) data.items.Add(new Kv { key = kv.Key, value = kv.Value });
            Directory.CreateDirectory(Dir);
            File.WriteAllText(StorageFile, JsonUtility.ToJson(data, true));
        }

        private static string ReadStorageKey(string key)
        {
            var d = new Dictionary<string, string>();
            LoadStorage(d);
            return d.TryGetValue(key, out var v) ? v : null;
        }

        // ------------------------------------------------------------------ recording (per Play session)

        private class AdRec { public string kind, placement; public float open, close = -1; public bool nofill, completed; }
        private class StateRec { public float t; public string reason; public float timeScale, volume; public bool audioPaused; }

        private static readonly List<AdRec> _ads = new List<AdRec>();
        private static readonly List<KeyValuePair<float, string>> _events = new List<KeyValuePair<float, string>>();
        private static readonly List<KeyValuePair<float, string>> _errors = new List<KeyValuePair<float, string>>();
        private static readonly List<StateRec> _states = new List<StateRec>();
        private static int _gameReady;
        private static Settings _settings = new Settings();

        private static void ResetRecords()
        {
            _ads.Clear(); _events.Clear(); _errors.Clear(); _states.Clear(); _gameReady = 0;
        }

        /// <summary>Called by the Editor bridge for GameReady / level events (same names as the QA tool: game_ready, level_started...).</summary>
        internal static void RecordEvent(string type)
        {
            if (type == "game_ready") _gameReady++;
            _events.Add(new KeyValuePair<float, string>(Time.realtimeSinceStartup, type));
        }

        private static void OnLog(string message, string stack, LogType type)
        {
            if ((type == LogType.Error || type == LogType.Exception || type == LogType.Assert) && !message.StartsWith("[H5 QA]"))
                _errors.Add(new KeyValuePair<float, string>(Time.realtimeSinceStartup, message));
        }

        // ------------------------------------------------------------------ simulated ads (used by the Editor bridge)

        /// <summary>Simulates an ad like the QA adapter: pause+mute while open, outcome from the test settings.</summary>
        internal static IEnumerator SimulateAd(string kind, string placement, Action<bool> onDone)
        {
            string outcome = kind == "rewarded" ? _settings.rewarded : _settings.interstitial;
            var rec = new AdRec { kind = kind, placement = placement, open = Time.realtimeSinceStartup };
            if (outcome == "nofill")
            {
                rec.nofill = true; rec.close = rec.open;
                _ads.Add(rec);
                Debug.Log($"[H5 QA] {kind} ad ({placement}) -> no fill");
                onDone?.Invoke(false);
                yield break;
            }
            Debug.Log($"[H5 QA] {kind} ad ({placement}) open");
            H5SDK.RaisePauseRequested(true);
            H5SDK.RaiseMuteRequested(true);
            yield return new WaitForSecondsRealtime(0.5f);
            _states.Add(new StateRec
            {
                t = Time.realtimeSinceStartup, reason = "adStart", timeScale = Time.timeScale,
                audioPaused = AudioListener.pause, volume = AudioListener.volume,
            });
            yield return new WaitForSecondsRealtime(Mathf.Max(0f, _settings.adDurationSec - 0.5f));
            rec.completed = outcome != "skip";
            rec.close = Time.realtimeSinceStartup;
            _ads.Add(rec);
            H5SDK.RaisePauseRequested(false);
            H5SDK.RaiseMuteRequested(false);
            Debug.Log($"[H5 QA] {kind} ad ({placement}) closed, completed={rec.completed}");
            onDone?.Invoke(rec.completed);
        }

        // ------------------------------------------------------------------ public API (Editor)

        /// <summary>Starts a run. testsPath defaults to h5-tests.json at the project root; only = "id1,id2" or null.</summary>
        public static void Run(string testsPath = null, string only = null)
        {
            if (string.IsNullOrEmpty(testsPath)) testsPath = Path.GetFullPath(Path.Combine(Application.dataPath, "../h5-tests.json"));
            if (!File.Exists(testsPath)) throw new FileNotFoundException("h5-tests.json not found", testsPath);
            var file = (Dictionary<string, object>)H5MiniJson.Parse(File.ReadAllText(testsPath));
            if (!(file.TryGetValue("tests", out var tests) && tests is List<object>)) throw new FormatException("h5-tests.json has no \"tests\" array");

            string startScene = null;
            foreach (var s in EditorBuildSettings.scenes) if (s.enabled) { startScene = s.path; break; }
            if (startScene == null) throw new InvalidOperationException("No enabled scene in Build Settings");

            if (Directory.Exists(ScreensDir)) foreach (var f in Directory.GetFiles(ScreensDir, "*.png")) File.Delete(f);
            var run = new RunState
            {
                active = true, testsPath = testsPath, only = only, startScenePath = startScene,
                startedUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            };
            SaveRun(run);
            _activeCached = true;
            Debug.Log($"[H5 QA] Editor scenario run started: {testsPath}" + (string.IsNullOrEmpty(only) ? "" : " (only " + only + ")"));
            if (EditorApplication.isPlaying) EditorApplication.ExitPlaymode();   // continues in OnPlayModeChanged
            else Next(run);
        }

        /// <summary>Stops the current run after the current test.</summary>
        public static void Cancel()
        {
            var run = LoadRun();
            if (run == null || !run.active) return;
            run.active = false;
            SaveRun(run);
            _activeCached = false;
            EditorSceneManager.playModeStartScene = null;
            if (EditorApplication.isPlaying) EditorApplication.ExitPlaymode();
            Debug.Log("[H5 QA] Editor scenario run cancelled.");
        }

        /// <summary>Short status: "running test 3/14 (id)", "done: 13/14 pass" or "idle".</summary>
        public static string Status()
        {
            var run = LoadRun();
            if (run == null) return "idle";
            int pass = run.results.FindAll(r => r.status == "pass").Count;
            if (run.active) return $"running: {run.results.Count} done ({pass} pass), current {(run.current != null ? run.current.id : "-")}";
            return $"done: {pass}/{run.results.Count} pass";
        }

        // ------------------------------------------------------------------ orchestration (Edit Mode side)

        [InitializeOnLoadMethod]
        private static void InitEditor()
        {
            EditorApplication.playModeStateChanged -= OnPlayModeChanged;
            EditorApplication.playModeStateChanged += OnPlayModeChanged;
        }

        private static void OnPlayModeChanged(PlayModeStateChange change)
        {
            if (change != PlayModeStateChange.EnteredEditMode) return;
            var run = LoadRun();
            if (run == null || !run.active) return;
            if (run.phase == "reload") { EditorApplication.EnterPlaymode(); return; }
            if (run.phase != "done" && run.current != null)
            {
                // Play Mode was stopped by hand in the middle of a test.
                run.current.status = "fail";
                run.current.failures.Add("Play Mode stopped during the test");
                run.results.Add(run.current);
                run.current = null;
                run.active = false;
                SaveRun(run);
                Finish(run);
                return;
            }
            Next(run);
        }

        private static List<object> Tests(RunState run)
        {
            var file = (Dictionary<string, object>)H5MiniJson.Parse(File.ReadAllText(run.testsPath));
            return (List<object>)file["tests"];
        }

        private static Dictionary<string, object> TestFile(RunState run) =>
            (Dictionary<string, object>)H5MiniJson.Parse(File.ReadAllText(run.testsPath));

        private static void Next(RunState run)
        {
            var file = TestFile(run);
            var tests = (List<object>)file["tests"];
            var only = string.IsNullOrEmpty(run.only) ? null : new List<string>(run.only.Split(','));
            int i = run.testIndex + 1;
            while (i < tests.Count && only != null && !only.Contains(Str(((Dictionary<string, object>)tests[i]), "id"))) i++;
            if (i >= tests.Count) { run.active = false; SaveRun(run); Finish(run); return; }

            var t = (Dictionary<string, object>)tests[i];
            run.testIndex = i;
            run.stepIndex = 0;
            run.phase = "fresh";
            run.settings = new Settings();
            if (t.TryGetValue("settings", out var so) && so is Dictionary<string, object> sd) ApplySettings(run.settings, sd);
            run.current = new TestResult
            {
                id = Str(t, "id"), title = Str(t, "title") ?? Str(t, "id"),
                startedUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            };
            SaveRun(run);
            SeedStorage(file, t);
            EditorSceneManager.playModeStartScene = AssetDatabase.LoadAssetAtPath<SceneAsset>(run.startScenePath);
            Debug.Log($"[H5 QA] test {run.current.id}");
            EditorApplication.EnterPlaymode();
        }

        private static void ApplySettings(Settings s, Dictionary<string, object> d)
        {
            if (d.TryGetValue("interstitial", out var a)) s.interstitial = Convert.ToString(a, CultureInfo.InvariantCulture);
            if (d.TryGetValue("rewarded", out var b)) s.rewarded = Convert.ToString(b, CultureInfo.InvariantCulture);
            if (d.TryGetValue("adDurationSec", out var c)) s.adDurationSec = Convert.ToSingle(c, CultureInfo.InvariantCulture);
        }

        private static string Str(Dictionary<string, object> d, string k) =>
            d.TryGetValue(k, out var v) && v != null ? Convert.ToString(v, CultureInfo.InvariantCulture) : null;

        private static string Fill(string json) => json
            .Replace("{today}", DateTime.Now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture))
            .Replace("{nowTicks}", DateTime.UtcNow.Ticks.ToString(CultureInfo.InvariantCulture));

        // Same layout as the QA tool's seedSave: typeMap = { Type: "<json string>" }, raw = the object as is.
        private static void SeedStorage(Dictionary<string, object> file, Dictionary<string, object> test)
        {
            var store = new Dictionary<string, string>();
            if (test.TryGetValue("save", out var save) && save is Dictionary<string, object> sd)
            {
                string key = Str(file, "saveKey") ?? "save_v1";
                var filled = (Dictionary<string, object>)H5MiniJson.Parse(Fill(H5MiniJson.Serialize(sd)));
                if (Str(file, "saveFormat") == "raw") store[key] = H5MiniJson.Serialize(filled);
                else
                {
                    var map = new Dictionary<string, object>();
                    foreach (var kv in filled) map[kv.Key] = kv.Value as string ?? H5MiniJson.Serialize(kv.Value);
                    store[key] = H5MiniJson.Serialize(map);
                }
            }
            WriteStorage(store);
        }

        private static void Finish(RunState run)
        {
            EditorSceneManager.playModeStartScene = null;
            _activeCached = false;
            int pass = run.results.FindAll(r => r.status == "pass").Count;
            var sb = new System.Text.StringBuilder();
            sb.Append("{\n  \"tool\": \"h5-editor-qa\",\n  \"testsPath\": ").Append(H5MiniJson.Serialize(run.testsPath))
              .Append(",\n  \"generatedAt\": ").Append(H5MiniJson.Serialize(DateTime.UtcNow.ToString("o")))
              .Append(",\n  \"seconds\": ").Append((DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - run.startedUnixMs) / 1000)
              .Append(",\n  \"pass\": ").Append(pass).Append(",\n  \"total\": ").Append(run.results.Count)
              .Append(",\n  \"tests\": [\n");
            for (int i = 0; i < run.results.Count; i++)
                sb.Append("    ").Append(JsonUtility.ToJson(run.results[i])).Append(i < run.results.Count - 1 ? ",\n" : "\n");
            sb.Append("  ]\n}\n");
            Directory.CreateDirectory(Dir);
            File.WriteAllText(ReportFile, sb.ToString());

            var summary = new System.Text.StringBuilder();
            summary.Append($"[H5 QA] Editor scenario tests: {pass}/{run.results.Count} pass ({(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - run.startedUnixMs) / 1000}s)\n");
            foreach (var r in run.results)
                summary.Append(r.status == "pass" ? "PASS " : "FAIL ").Append(r.id).Append(" (").Append(r.seconds).Append("s)")
                    .Append(r.failures.Count > 0 ? " - " + string.Join("; ", r.failures) : "").Append('\n');
            summary.Append("Report: ").Append(ReportFile);
            if (pass == run.results.Count) Debug.Log(summary.ToString());
            else Debug.LogWarning(summary.ToString());
        }

        // ------------------------------------------------------------------ Play Mode side

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void InitPlay()
        {
            _activeCached = null;
            var run = LoadRun();
            if (run == null || !run.active || run.current == null) return;
            _settings = run.settings ?? new Settings();
            ResetRecords();
            Application.logMessageReceived -= OnLog;
            Application.logMessageReceived += OnLog;
            var go = new GameObject("[H5 QA Editor Runner]");
            UnityEngine.Object.DontDestroyOnLoad(go);
            go.hideFlags = HideFlags.HideInHierarchy;
            go.AddComponent<Runner>();
        }

        private class Runner : MonoBehaviour
        {
            private IEnumerator Start()
            {
                var run = LoadRun();
                var test = (Dictionary<string, object>)Tests(run)[run.testIndex];
                var file = TestFile(run);
                var res = run.current;
                float timeout = Num(test, "timeoutMs", 20000) / 1000f;

                float t0 = Time.realtimeSinceStartup;
                while (_gameReady == 0 && Time.realtimeSinceStartup - t0 < 120f) yield return null;
                if (_gameReady == 0) { Fail(res, "GameReady not received"); yield return EndTest(run, res); yield break; }
                yield return new WaitForSecondsRealtime(run.stepIndex == 0 ? Num(test, "settleMs", 3000) / 1000f : 2f);
                float since = Time.realtimeSinceStartup - 0.05f;

                var steps = test.TryGetValue("steps", out var so) && so is List<object> sl ? sl : new List<object>();
                string error = null;
                for (int i = run.stepIndex; i < steps.Count && error == null; i++)
                {
                    string s = Convert.ToString(steps[i], CultureInfo.InvariantCulture);
                    res.log.Add(s);
                    Match m;
                    if ((m = Regex.Match(s, @"^hook:(.+)$")).Success)
                    {
                        try { res.log.Add("  -> " + Hook(m.Groups[1].Value)); }
                        catch (Exception e) { error = e.Message; }
                    }
                    else if ((m = Regex.Match(s, @"^wait:(\d+)$")).Success) yield return new WaitForSecondsRealtime(int.Parse(m.Groups[1].Value) / 1000f);
                    else if ((m = Regex.Match(s, @"^waitfor:(.+?)(?::(\d+))?$")).Success)
                    {
                        var box = new Result();
                        yield return Eventually(m.Groups[1].Value, since, m.Groups[2].Success ? int.Parse(m.Groups[2].Value) / 1000f : timeout, file, box);
                        if (!box.ok) error = "waitfor " + m.Groups[1].Value + " failed: " + box.detail;
                    }
                    else if ((m = Regex.Match(s, @"^settings:(\w+)=(.+)$")).Success)
                    {
                        ApplySettings(_settings, new Dictionary<string, object> { { m.Groups[1].Value, m.Groups[2].Value } });
                        run.settings = _settings;
                    }
                    else if (s == "reload")
                    {
                        run.stepIndex = i + 1;
                        run.phase = "reload";
                        run.current = res;
                        SaveRun(run);
                        EditorApplication.ExitPlaymode();   // OnPlayModeChanged enters Play Mode again without reseeding
                        yield break;
                    }
                    else if ((m = Regex.Match(s, @"^screenshot:(.+)$")).Success) { Shot(res.id + "-" + m.Groups[1].Value); yield return null; yield return null; }
                    else if ((m = Regex.Match(s, @"^preset:(.+)$")).Success) res.log.Add("  -> skipped in the Editor (browser only)");
                    else if ((m = Regex.Match(s, @"^hide:(\d+)$")).Success)
                    {
                        H5SDK.RaisePauseRequested(true); H5SDK.RaiseMuteRequested(true);
                        yield return new WaitForSecondsRealtime(int.Parse(m.Groups[1].Value) / 1000f);
                        H5SDK.RaisePauseRequested(false); H5SDK.RaiseMuteRequested(false);
                    }
                    else if ((m = Regex.Match(s, @"^mute:(\d+)$")).Success)
                    {
                        H5SDK.RaiseMuteRequested(true);
                        yield return new WaitForSecondsRealtime(int.Parse(m.Groups[1].Value) / 1000f);
                        H5SDK.RaiseMuteRequested(false);
                    }
                    else error = "unknown step " + s;
                }
                if (error != null) Fail(res, error);
                else
                {
                    var expects = test.TryGetValue("expect", out var eo) && eo is List<object> el ? el : new List<object>();
                    foreach (var eobj in expects)
                    {
                        string ex = Convert.ToString(eobj, CultureInfo.InvariantCulture);
                        var box = new Result();
                        if (ex.StartsWith("!") && !ex.StartsWith("!exists:"))
                        {
                            yield return new WaitForSecondsRealtime(Num(test, "negativeWaitMs", 2500) / 1000f);
                            Check(ex.Substring(1), since, file, box);
                            box.ok = !box.ok;
                        }
                        else yield return Eventually(ex, since, Num(test, "expectTimeoutMs", 8000) / 1000f, file, box);
                        if (!box.ok) Fail(res, ex + " (" + box.detail + ")");
                    }
                }
                yield return EndTest(run, res);
            }

            private IEnumerator EndTest(RunState run, TestResult res)
            {
                Shot(res.id + "-end");
                yield return null;
                yield return null;
                res.seconds = (int)((DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - res.startedUnixMs) / 1000);
                run.results.Add(res);
                run.current = null;
                run.phase = "done";
                SaveRun(run);
                Debug.Log($"[H5 QA] {(res.status == "pass" ? "PASS" : "FAIL")} {res.id} ({res.seconds}s)" + (res.failures.Count > 0 ? " - " + string.Join("; ", res.failures) : ""));
                EditorApplication.ExitPlaymode();
            }

            private static void Fail(TestResult r, string msg) { r.status = "fail"; r.failures.Add(msg); }

            private static void Shot(string name)
            {
                Directory.CreateDirectory(ScreensDir);
                ScreenCapture.CaptureScreenshot(Path.Combine(ScreensDir, Regex.Replace(name, @"[^\w\-]", "_") + ".png"));
            }

            private static float Num(Dictionary<string, object> d, string k, float def) =>
                d.TryGetValue(k, out var v) && v != null ? Convert.ToSingle(v, CultureInfo.InvariantCulture) : def;
        }

        // ------------------------------------------------------------------ expectations (same syntax as qa.js)

        private class Result { public bool ok; public string detail = ""; }

        private static string Hook(string cmd)
        {
            try { return H5QAHooks.Execute(cmd); }
            catch (TargetInvocationException e) when (e.InnerException != null) { throw new Exception(cmd + ": " + e.InnerException.Message); }
            catch (Exception e) { throw new Exception(cmd + ": " + e.Message); }
        }

        private static IEnumerator Eventually(string x, float since, float timeoutSec, Dictionary<string, object> file, Result box)
        {
            float end = Time.realtimeSinceStartup + timeoutSec;
            while (true)
            {
                Check(x, since, file, box);
                if (box.ok || Time.realtimeSinceStartup > end) yield break;
                yield return new WaitForSecondsRealtime(0.4f);
            }
        }

        private static void Check(string x, float since, Dictionary<string, object> file, Result box)
        {
            try { CheckInner(x, since, file, box); }
            catch (Exception e) { box.ok = false; box.detail = e.Message; }
        }

        private static void CheckInner(string x, float since, Dictionary<string, object> file, Result box)
        {
            Match m;
            if ((m = Regex.Match(x, @"^ad:(\w+):(\w+)(?::(.+))?$")).Success)
            {
                string kind = m.Groups[1].Value, phase = m.Groups[2].Value, pl = m.Groups[3].Success ? m.Groups[3].Value : null;
                var ads = _ads.FindAll(a => a.open >= since && a.kind == kind && (pl == null || a.placement == pl));
                box.ok = ads.Exists(a =>
                    phase == "open" ? !a.nofill :
                    phase == "nofill" ? a.nofill :
                    phase == "close" ? a.close >= 0 && !a.nofill :
                    phase == "completed" ? !a.nofill && a.completed :
                    phase == "skipped" && !a.nofill && a.close >= 0 && !a.completed);
                box.detail = ads.Count == 0 ? "no " + kind + " ad since test start"
                    : string.Join(", ", ads.ConvertAll(a => a.kind + "[" + a.placement + "]" + (a.nofill ? " nofill" : a.completed ? " completed" : " closed")));
                return;
            }
            if (x == "paused@ad" || x == "silent@ad")
            {
                var st = _states.FindAll(s => s.reason == "adStart" && s.t >= since);
                if (st.Count == 0) { box.ok = false; box.detail = "no ad shown"; return; }
                if (x == "paused@ad") { box.ok = st.TrueForAll(s => s.timeScale == 0f); box.detail = "timeScale " + string.Join(",", st.ConvertAll(s => s.timeScale.ToString(CultureInfo.InvariantCulture))); }
                else { box.ok = st.TrueForAll(s => s.audioPaused || s.volume <= 0.001f); box.detail = string.Join(",", st.ConvertAll(s => "pause=" + s.audioPaused + " volume=" + s.volume)); }
                return;
            }
            if (x == "noerrors")
            {
                var errs = _errors.FindAll(e => e.Key >= since);
                box.ok = errs.Count == 0; box.detail = errs.Count > 0 ? Trim(errs[0].Value) : "";
                return;
            }
            if (x == "gameready") { box.ok = _gameReady > 0; box.detail = _gameReady + "x"; return; }
            if ((m = Regex.Match(x, @"^event:(.+)$")).Success)
            {
                int n = _events.FindAll(e => e.Key >= since && e.Value == m.Groups[1].Value).Count;
                box.ok = n > 0; box.detail = n + "x";
                return;
            }
            if ((m = Regex.Match(x, @"^scene=(.+)$")).Success) { var sc = Hook("scene"); box.ok = sc == m.Groups[1].Value; box.detail = "scene " + sc; return; }
            if ((m = Regex.Match(x, @"^(!?)exists:(.+)$")).Success)
            {
                var ex = Hook("exists:" + m.Groups[2].Value);
                box.ok = (ex == "true") == (m.Groups[1].Value == ""); box.detail = m.Groups[2].Value + " exists=" + ex;
                return;
            }
            if ((m = Regex.Match(x, @"^hook:(.+?)(=|!=|>=|<=|>|<)(.*)$")).Success)
            {
                var hv = Hook(m.Groups[1].Value);
                box.ok = Compare(hv, m.Groups[2].Value, m.Groups[3].Value); box.detail = m.Groups[1].Value + " -> " + hv;
                return;
            }
            if ((m = Regex.Match(x, @"^save:(\w+)\.([\w.]+)(=|!=|>=|<=|>|<)(.*)$")).Success)
            {
                object sv = SaveValue(file, m.Groups[1].Value, m.Groups[2].Value);
                string s = sv == null ? null : sv is string str ? str : H5MiniJson.Serialize(sv);
                box.ok = Compare(s, m.Groups[3].Value, m.Groups[4].Value); box.detail = m.Groups[1].Value + "." + m.Groups[2].Value + " = " + (s ?? "undefined");
                return;
            }
            box.ok = false; box.detail = "unknown expectation";
        }

        private static string Trim(string s) => s.Length > 160 ? s.Substring(0, 160) : s;

        private static object SaveValue(Dictionary<string, object> file, string type, string field)
        {
            string raw = ReadStorageKey(Str(file, "saveKey") ?? "save_v1");
            if (raw == null) return null;
            var root = H5MiniJson.Parse(raw) as Dictionary<string, object>;
            if (root == null || !root.TryGetValue(type, out var tv)) return null;
            object obj = Str(file, "saveFormat") == "raw" ? tv : tv is string ts ? H5MiniJson.Parse(ts) : tv;
            foreach (var k in field.Split('.'))
            {
                if (!(obj is Dictionary<string, object> d) || !d.TryGetValue(k, out obj)) return null;
            }
            return obj;
        }

        private static bool Compare(string a, string op, string b)
        {
            bool num = double.TryParse(a, NumberStyles.Float, CultureInfo.InvariantCulture, out var na)
                       & double.TryParse(b, NumberStyles.Float, CultureInfo.InvariantCulture, out var nb) && !string.IsNullOrEmpty(a);
            switch (op)
            {
                case "=": return num ? na == nb : a == b;
                case "!=": return num ? na != nb : a != b;
                case ">": return num && na > nb;
                case "<": return num && na < nb;
                case ">=": return num && na >= nb;
                case "<=": return num && na <= nb;
            }
            return false;
        }
    }
}
#endif

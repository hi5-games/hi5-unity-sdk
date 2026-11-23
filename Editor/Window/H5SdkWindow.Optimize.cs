using System;
using System.Collections.Generic;
using System.Linq;
using H5PlatformSDK.Editor.Optimize;
using UnityEditor;
using UnityEngine;
using UnityEngine.UIElements;

namespace H5PlatformSDK.Editor.Window
{
    public sealed partial class H5SdkWindow
    {
        private const string TexCapPref = "H5PlatformSDK.Opt.TexCap";
        private const string TexCrunchPref = "H5PlatformSDK.Opt.TexCrunch";
        private const string TexQualityPref = "H5PlatformSDK.Opt.TexQuality";
        private const string AudQualityPref = "H5PlatformSDK.Opt.AudQuality";
        private const string AudMonoPref = "H5PlatformSDK.Opt.AudMono";

        private VisualElement BuildTextures()
        {
            var page = new VisualElement();
            page.Add(Label("Textures", "h5-h1"));
            page.Add(Label("Lowers the WebGL texture size and enables crunch compression. Only the WebGL override of each texture is changed; other platforms are untouched. Preview first, then apply. Undo restores the last apply.", "h5-sub"));

            var opts = new VisualElement(); opts.AddToClassList("h5-card");
            var caps = new List<int> { 4096, 2048, 1024, 512 };
            var cap = new PopupField<int>("Max texture size", caps, Mathf.Max(0, caps.IndexOf(EditorPrefs.GetInt(TexCapPref, 2048))));
            var crunch = new Toggle("Crunch compression") { value = EditorPrefs.GetBool(TexCrunchPref, true) };
            var quality = new SliderInt("Crunch quality", 10, 100) { value = EditorPrefs.GetInt(TexQualityPref, 50), showInputField = true };
            opts.Add(cap); opts.Add(crunch); opts.Add(quality);
            opts.Add(Label("Crunch makes textures much smaller but slows import. Quality 50 is a good start; check visuals afterwards.", "h5-sub"));
            page.Add(opts);

            var list = new VisualElement();
            var status = Label("", "h5-sub");
            Action scan = null;
            scan = () =>
            {
                EditorPrefs.SetInt(TexCapPref, cap.value); EditorPrefs.SetBool(TexCrunchPref, crunch.value); EditorPrefs.SetInt(TexQualityPref, quality.value);
                RenderOptimizer(list, status, "textures", H5AssetOptimizer.ScanTextures(cap.value, crunch.value, quality.value), scan);
            };
            var bar = new VisualElement(); bar.AddToClassList("h5-row");
            bar.Add(Button("Scan", () => scan()));
            page.Add(bar);
            page.Add(status);
            page.Add(list);
            scan();
            return page;
        }

        private VisualElement BuildAudio()
        {
            var page = new VisualElement();
            page.Add(Label("Audio", "h5-h1"));
            page.Add(Label("Sets Vorbis compression for WebGL, caps quality and picks a load type by clip size. Only the WebGL override is changed (Force to Mono, if enabled, is a clip-wide setting). Preview first, then apply. Undo restores the last apply.", "h5-sub"));

            var opts = new VisualElement(); opts.AddToClassList("h5-card");
            var quality = new Slider("Max quality", 0.1f, 1f) { value = EditorPrefs.GetFloat(AudQualityPref, 0.5f), showInputField = true };
            var mono = new Toggle("Force to mono (all platforms)") { value = EditorPrefs.GetBool(AudMonoPref, false) };
            opts.Add(quality); opts.Add(mono);
            opts.Add(Label("Mono halves the size of stereo clips but loses stereo effects. Leave off unless the game is mono anyway.", "h5-sub"));
            page.Add(opts);

            var list = new VisualElement();
            var status = Label("", "h5-sub");
            Action scan = null;
            scan = () =>
            {
                EditorPrefs.SetFloat(AudQualityPref, quality.value); EditorPrefs.SetBool(AudMonoPref, mono.value);
                RenderOptimizer(list, status, "audio", H5AssetOptimizer.ScanAudio(quality.value, mono.value), scan);
            };
            var bar = new VisualElement(); bar.AddToClassList("h5-row");
            bar.Add(Button("Scan", () => scan()));
            page.Add(bar);
            page.Add(status);
            page.Add(list);
            scan();
            return page;
        }

        private VisualElement BuildShaders()
        {
            var page = new VisualElement();
            page.Add(Label("Shaders", "h5-h1"));
            page.Add(Label("Shaders add to build size and load time. This tab shows the shaders of the last build and the 'Always Included Shaders' list (Project Settings > Graphics), which forces shaders into every build even when nothing uses them.", "h5-sub"));

            var a = H5BuildAnalyzer.Load();
            page.Add(Label("Shaders in the last build", "h5-section"));
            var inb = new VisualElement(); inb.AddToClassList("h5-card");
            if (a == null || a.shaders.Count == 0) inb.Add(Label("No data. Run Build & Analyze (Build Settings tab).", "h5-sub"));
            else foreach (var s in a.shaders.Take(10)) inb.Add(Label($"{H5BuildAnalyzer.Format(s.bytes),10}   {s.path}", "h5-sub"));
            page.Add(inb);

            page.Add(Label("Always Included Shaders", "h5-section"));
            page.Add(Label("Removal candidates are shaders that no material in the project uses. They start unselected: a script calling Shader.Find would break, so tick only what you are sure about. Shaders for UI, sprites, TextMeshPro and URP are protected. Undo re-adds them.", "h5-sub"));
            var list = new VisualElement();
            var status = Label("", "h5-sub");
            Action scan = null;
            scan = () => RenderOptimizer(list, status, "shaders", H5AssetOptimizer.ScanAlwaysIncludedShaders(), scan);
            var bar = new VisualElement(); bar.AddToClassList("h5-row");
            bar.Add(Button("Scan", () => scan()));
            page.Add(bar); page.Add(status); page.Add(list);
            scan();
            return page;
        }

        private VisualElement BuildFonts()
        {
            var page = new VisualElement();
            page.Add(Label("Fonts", "h5-h1"));
            page.Add(Label("Lists font files and TextMeshPro font assets with advice. Large font files (full CJK / Unicode) are a common cause of big builds: subset them outside Unity and replace the file. The only automatic change is 'Clear Dynamic Data On Build' for dynamic TMP fonts (glyphs are regenerated at runtime). Undo restores it.", "h5-sub"));
            var list = new VisualElement();
            var status = Label("", "h5-sub");
            Action scan = null;
            scan = () => RenderOptimizer(list, status, "fonts", H5AssetOptimizer.ScanFonts(), scan);
            var bar = new VisualElement(); bar.AddToClassList("h5-row");
            bar.Add(Button("Scan", () => scan()));
            page.Add(bar); page.Add(status); page.Add(list);
            scan();
            return page;
        }

        /// <summary>Shared preview list: per-asset checkbox, Apply selected, Undo last apply.</summary>
        private void RenderOptimizer(VisualElement host, Label status, string kind, List<H5OptRow> rows, Action rescan)
        {
            host.Clear();
            var changes = rows.Where(r => r.Proposed != null).ToList();
            long total = rows.Sum(r => r.DiskBytes);
            status.text = $"{rows.Count} items" + (total > 0 ? $", {H5BuildAnalyzer.Format(total)} on disk" : "") + $". {changes.Count} can be changed." +
                          (H5BuildAnalyzer.Load() == null ? " Run Build & Analyze for in-build sizes." : "");

            var actions = new VisualElement(); actions.AddToClassList("h5-row");
            if (changes.Count > 0)
            {
                actions.Add(Button("Select all", () => { foreach (var r in changes) r.Selected = true; RenderOptimizer(host, status, kind, rows, rescan); }));
                actions.Add(Button("Select none", () => { foreach (var r in changes) r.Selected = false; RenderOptimizer(host, status, kind, rows, rescan); }));
                actions.Add(Button("Apply selected", () =>
                {
                    int n = changes.Count(r => r.Selected);
                    if (n == 0) return;
                    if (!EditorUtility.DisplayDialog("Apply optimization", $"Change {n} assets (WebGL import settings)?\nThey will reimport. You can use Undo last apply afterwards.", "Apply", "Cancel")) return;
                    int done = H5AssetOptimizer.ApplyRows(kind, changes);
                    Debug.Log($"[H5PlatformSDK] Optimized {done} {kind}.");
                    rescan();
                }));
            }
            var info = H5AssetOptimizer.BackupInfo(kind);
            if (info != null)
                actions.Add(Button("Undo last apply (" + info + ")", () =>
                {
                    int n = H5AssetOptimizer.Undo(kind);
                    Debug.Log($"[H5PlatformSDK] Restored {n} {kind}.");
                    rescan();
                }));
            host.Add(actions);

            foreach (var r in rows.Take(60))
            {
                var row = r;
                var card = new VisualElement(); card.AddToClassList("h5-card"); card.AddToClassList("h5-row");
                if (row.Proposed != null)
                {
                    var t = new Toggle { value = row.Selected };
                    t.RegisterValueChangedCallback(e => row.Selected = e.newValue);
                    card.Add(t);
                }
                else card.Add(Pill("OK", "ok"));
                var text = new VisualElement(); text.AddToClassList("h5-grow"); text.style.marginLeft = 8;
                var size = row.BuildBytes > 0 ? $"   ({H5BuildAnalyzer.Format(row.BuildBytes)} in build)"
                    : row.DiskBytes > 0 ? $"   ({H5BuildAnalyzer.Format(row.DiskBytes)})" : "";
                text.Add(Label(row.Path + size, null));
                text.Add(Label(row.Proposed == null ? row.Current : row.Current + "   ->   " + row.Proposed, "h5-sub"));
                if (!string.IsNullOrEmpty(row.Advice)) text.Add(Label("Advice: " + row.Advice, "h5-sub"));
                card.Add(text);
                var obj = AssetDatabase.LoadMainAssetAtPath(row.Path);
                if (obj != null) card.Add(Button("Ping", () => { Selection.activeObject = obj; EditorGUIUtility.PingObject(obj); }));
                host.Add(card);
            }
            if (rows.Count > 60) host.Add(Label($"... {rows.Count - 60} more (largest 60 shown; apply, then scan again).", "h5-sub"));
        }
    }
}

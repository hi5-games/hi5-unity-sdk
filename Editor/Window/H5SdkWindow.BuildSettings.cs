using System.IO;
using System.Linq;
using H5PlatformSDK.Editor.Optimize;
using UnityEditor;
using UnityEngine;
using UnityEngine.UIElements;

namespace H5PlatformSDK.Editor.Window
{
    public sealed partial class H5SdkWindow
    {
        private VisualElement BuildBuildSettings()
        {
            var page = new VisualElement();
            page.Add(Label("Build Settings", "h5-h1"));
            page.Add(BuildSettingsPanel());
            page.Add(BuildScenesFoldout(false));
            var cards = new VisualElement(); cards.AddToClassList("h5-build-cards"); cards.style.marginTop = 8;
            cards.Add(BuildAnalysisCard()); cards.Add(BuildReleaseCard());
            page.Add(cards);
            page.Add(BuildLastBuildFoldout(false));
            return page;
        }

        /// <summary>Status banner + 2-column grid of editable options. Hover a label for the explanation.</summary>
        private VisualElement BuildSettingsPanel()
        {
            var box = new VisualElement();
            var items = H5BuildSettingsModel.Items();
            int bad = items.Count(i => !i.IsOk);

            var banner = new VisualElement(); banner.AddToClassList("h5-banner"); banner.AddToClassList(bad == 0 ? "h5-banner--ok" : "h5-banner--warn");
            var msg = Label(bad == 0 ? "Settings optimized for a small download" : bad + " settings differ from the recommended values (your choice is kept)", null);
            msg.AddToClassList("h5-grow"); banner.Add(msg);
            if (bad > 0)
                banner.Add(Button("Use recommended", () =>
                {
                    var list = string.Join("\n", items.Where(i => !i.IsOk).Select(i => $"- {i.Title}: {i.Current()} -> {i.Recommended}"));
                    if (!EditorUtility.DisplayDialog("Use recommended values", list + "\n\nYou can still change each one afterwards.", "Apply", "Cancel")) return;
                    H5BuildSettingsModel.ApplyAll();
                    SelectTab(_tab);
                }));
            box.Add(banner);

            var grid = new VisualElement(); grid.AddToClassList("h5-opt-grid");
            foreach (var item in items)
            {
                var it = item;
                var cell = new VisualElement(); cell.AddToClassList("h5-opt");
                var l = Label(it.Title, "h5-opt-label");
                if (!it.IsOk) l.AddToClassList("h5-opt-label--custom");
                l.tooltip = it.Why + (it.IsOk ? "" : "\nRecommended: " + it.Recommended);
                cell.Add(l);
                var dd = new DropdownField(new System.Collections.Generic.List<string>(it.Options), it.Current());
                dd.tooltip = l.tooltip;
                dd.RegisterValueChangedCallback(e => { it.Set(e.newValue); AssetDatabase.SaveAssets(); SelectTab(_tab); });
                cell.Add(dd);
                grid.Add(cell);
            }
            box.Add(grid);
            box.Add(Label("Orange name = differs from recommended. Hover a name to see why it matters. The release build always uses: no development mode, JS decompression fallback on, IL2CPP Release configuration (portal requirements, not options).", "h5-sub"));
            box.Add(BuildRuntimeCard());
            return box;
        }

        private VisualElement BuildScenesFoldout(bool open)
        {
            var enabled = EditorBuildSettings.scenes.Where(s => s.enabled).ToArray();
            var f = new Foldout { text = $"Scenes ({enabled.Length} enabled)", value = open };
            if (enabled.Length == 0) f.Add(Label("No scene enabled. Add scenes in File > Build Profiles.", "h5-sub"));
            foreach (var sc in enabled) f.Add(Label(sc.path, "h5-sub"));
            f.Add(Button("Open Build Profiles", () => EditorApplication.ExecuteMenuItem("File/Build Profiles")));
            return f;
        }

        private VisualElement BuildAnalysisCard()
        {
            var c = new VisualElement(); c.AddToClassList("h5-build-card"); c.AddToClassList("h5-build-card--dev");
            c.Add(Label("Analysis build", "h5-tile-title"));
            c.Add(Label("One fixed, fast configuration (no compression). The goal is the report of which assets to optimize, not the size. " +
                        "Your Build Settings are not touched. Do not send this build. About 1-3 min.", "h5-tile-sub"));
            c.Add(Button("Build & Analyze", () => RunBuild(false)));
            return c;
        }

        private VisualElement BuildReleaseCard()
        {
            var c = new VisualElement(); c.AddToClassList("h5-build-card"); c.AddToClassList("h5-build-card--release");
            c.Add(Label("Release build", "h5-tile-title"));
            c.Add(Label("Production build with the options above. This is the build you send to Hi5 Games. About 5-15 min.", "h5-tile-sub"));
            var row = new VisualElement(); row.AddToClassList("h5-row");
            row.Add(Button("Build for Release", () => RunBuild(true)));
            var qaDir = H5QaRunner.FindBuildDir();
            var qa = Button(H5QaRunner.Running ? "Stop QA" : "Test last build", ToggleQa);
            qa.SetEnabled(H5QaRunner.Running || qaDir != null);
            row.Add(qa);
            c.Add(row);
            return c;
        }

        private VisualElement BuildLastBuildFoldout(bool open)
        {
            var a = H5BuildAnalyzer.Load();
            var f = new Foldout { text = a == null ? "Last build: none yet" : $"Last build: {H5BuildAnalyzer.Format(a.outputBytes)}  ({a.builtAt})", value = open };
            f.style.marginTop = 6;
            ShowAnalysis(f);
            return f;
        }

        private static void ShowAnalysis(VisualElement page)
        {
            var a = H5BuildAnalyzer.Load();
            if (a == null) { page.Add(Label("No analysis yet. Run Build & Analyze.", "h5-sub")); return; }
            var prev = H5BuildAnalyzer.Load(true);

            var card = new VisualElement(); card.AddToClassList("h5-card");
            var delta = "";
            if (prev != null && prev.outputBytes > 0)
            {
                long d = a.outputBytes - prev.outputBytes;
                delta = $"   ({(d >= 0 ? "+" : "-")}{H5BuildAnalyzer.Format(System.Math.Abs(d))} vs previous build)";
            }
            card.Add(Label($"Download size: {H5BuildAnalyzer.Format(a.outputBytes)}{delta}", null));
            card.Add(Label(a.succeeded ? a.folder : "Build FAILED - sizes below may be incomplete.", "h5-sub"));
            foreach (var f in a.files.Take(8)) card.Add(Label($"{H5BuildAnalyzer.Format(f.bytes),10}   {f.name}", "h5-sub"));
            var reveal = a.folder;
            if (Directory.Exists(reveal)) card.Add(Button("Reveal folder", () => EditorUtility.RevealInFinder(reveal)));
            page.Add(card);

            if (a.categories.Count > 0)
            {
                page.Add(Label("Assets by type (uncompressed, total " + H5BuildAnalyzer.Format(a.assetBytes) + ")", "h5-section"));
                var cat = new VisualElement(); cat.AddToClassList("h5-card");
                foreach (var c in a.categories)
                {
                    float pct = a.assetBytes > 0 ? (float)c.bytes / a.assetBytes : 0;
                    var row = new VisualElement(); row.AddToClassList("h5-row");
                    var name = Label($"{c.name} ({c.count})", null); name.style.width = 120; row.Add(name);
                    var bar = new VisualElement();
                    bar.style.height = 8; bar.style.width = Length.Percent(Mathf.Max(1f, pct * 55f));
                    bar.style.backgroundColor = new Color(0.94f, 0.33f, 0.14f); bar.style.marginRight = 8; row.Add(bar);
                    row.Add(Label($"{H5BuildAnalyzer.Format(c.bytes)}  {pct * 100:0}%", "h5-sub"));
                    cat.Add(row);
                }
                page.Add(cat);

                page.Add(Label("Largest assets", "h5-section"));
                var top = new VisualElement(); top.AddToClassList("h5-card");
                foreach (var t in a.topAssets.Take(15))
                {
                    var path = t.path;
                    var row = new VisualElement(); row.AddToClassList("h5-row");
                    var l = Label($"{H5BuildAnalyzer.Format(t.bytes),10}  [{t.category}]  {t.path}", "h5-sub");
                    l.style.marginBottom = 2; row.Add(l);
                    var obj = AssetDatabase.LoadMainAssetAtPath(path);
                    if (obj != null) { var sp = new VisualElement(); sp.AddToClassList("h5-grow"); row.Add(sp); row.Add(Button("Ping", () => { Selection.activeObject = obj; EditorGUIUtility.PingObject(obj); })); }
                    top.Add(row);
                }
                page.Add(top);
            }
        }
    }
}

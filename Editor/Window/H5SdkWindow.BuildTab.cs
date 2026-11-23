using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;
using UnityEngine.UIElements;

namespace H5PlatformSDK.Editor.Window
{
    public sealed partial class H5SdkWindow
    {
        private const string SourcePref = "H5PlatformSDK.Package.Source";
        private const string OutPref = "H5PlatformSDK.Package.Out";
        private const string TargetPrefPrefix = "H5PlatformSDK.Package.Target.";

        private VisualElement BuildPackage()
        {
            var page = new VisualElement();
            page.Add(Label("Package", "h5-h1"));
            page.Add(Label("Internal: take the partner's neutral build and package it for each portal.", "h5-sub"));

            var node = H5PackagerRunner.FindNode();
            if (node == null)
            {
                var warn = new VisualElement();
                warn.AddToClassList("h5-card");
                warn.Add(Pill("Node.js not found", "err"));
                warn.Add(Label("The packager needs Node.js 18+ (nodejs.org). Install it, then reopen this tab.", "h5-sub"));
                page.Add(warn);
            }

            // Step 1
            page.Add(Label("1. Source build", "h5-section"));
            var src = new TextField { value = EditorPrefs.GetString(H5Paths.ProjectKey(SourcePref), EditorPrefs.GetString(H5NeutralBuild.LastBuildKey, "")) };
            src.RegisterValueChangedCallback(e => EditorPrefs.SetString(H5Paths.ProjectKey(SourcePref), e.newValue));
            var s1 = new VisualElement(); s1.AddToClassList("h5-card");
            src.style.flexGrow = 1;
            var r1 = new VisualElement(); r1.AddToClassList("h5-row");
            r1.Add(src);
            r1.Add(Button("Browse", () =>
            {
                var p = EditorUtility.OpenFolderPanel("WebGL build folder (contains index.html)", src.value, "");
                if (!string.IsNullOrEmpty(p)) src.value = p;
            }));
            s1.Add(r1);
            var r1b = new VisualElement(); r1b.AddToClassList("h5-row");
            r1b.Add(Button("Use last build", () => src.value = EditorPrefs.GetString(H5NeutralBuild.LastBuildKey, src.value)));
            s1.Add(r1b);
            s1.Add(Label("The folder must contain index.html built with the H5Neutral template (the build received from the partner).", "h5-sub"));
            page.Add(s1);

            // Step 2
            page.Add(Label("2. Target platforms", "h5-section"));
            var targets = new List<(PlatformInfo info, Toggle toggle)>();
            var s2 = new VisualElement(); s2.AddToClassList("h5-card");
            foreach (var info in PlatformCatalog.All)
            {
                if (!info.Supported) continue;
                var status = info.GetStatus(_config);
                var row = new VisualElement(); row.AddToClassList("h5-row");
                var t = new Toggle(info.Name) { value = status == PlatformStatus.Ready && EditorPrefs.GetBool(H5Paths.ProjectKey(TargetPrefPrefix + info.Id), true) };
                t.SetEnabled(status == PlatformStatus.Ready);
                var id = info.Id;
                t.RegisterValueChangedCallback(e => EditorPrefs.SetBool(H5Paths.ProjectKey(TargetPrefPrefix + id), e.newValue));
                t.style.flexGrow = 1;
                row.Add(t);
                row.Add(status == PlatformStatus.Ready ? Pill("Ready", "ok") : Pill("Needs config", "warn"));
                s2.Add(row);
                targets.Add((info, t));
            }
            page.Add(s2);

            // Step 3
            page.Add(Label("3. Output", "h5-section"));
            var s3 = new VisualElement(); s3.AddToClassList("h5-card");
            var outField = new TextField("Output folder") { value = EditorPrefs.GetString(H5Paths.ProjectKey(OutPref), Path.GetFullPath("Builds/Packages")) };
            outField.RegisterValueChangedCallback(e => EditorPrefs.SetString(H5Paths.ProjectKey(OutPref), e.newValue));
            var nameField = new TextField("Game name") { value = SafeName(Application.productName) };
            var verField = new TextField("Version") { value = PlayerSettings.bundleVersion };
            s3.Add(outField); s3.Add(nameField); s3.Add(verField);
            page.Add(s3);

            var results = new VisualElement();
            var log = new Label(""); log.AddToClassList("h5-sub"); log.selection.isSelectable = true;
            var go = new Button { text = "Package" };
            go.AddToClassList("h5-accent");
            go.clicked += () =>
            {
                var picked = new List<string>();
                foreach (var (info, t) in targets) if (t.value) picked.Add(PlatformId(info.Id));
                if (picked.Count == 0) { log.text = "Select at least one platform."; return; }
                if (node == null) { log.text = "Node.js is required."; return; }
                if (!File.Exists(Path.Combine(src.value, "index.html"))) { log.text = "Source folder has no index.html."; return; }
                go.SetEnabled(false); results.Clear(); log.text = "Packaging...";
                var job = H5PackagerRunner.Start(node, src.value, picked.ToArray(), outField.value, nameField.value, verField.value, _config);
                IVisualElementScheduledItem poll = null;
                poll = go.schedule.Execute(() =>
                {
                    if (!job.Done) return;
                    poll.Pause();
                    go.SetEnabled(true);
                    ShowResults(results, log, job, outField.value);
                }).Every(300);
            };
            page.Add(go);
            page.Add(results);
            page.Add(log);
            return page;
        }

        private static void ShowResults(VisualElement host, Label log, H5PackagerRunner.Job job, string outDir)
        {
            host.Clear();
            var rep = job.Report;
            if (rep == null) { log.text = "Packager failed:\n" + job.Output; return; }
            log.text = rep.ok ? "Done." : "Finished with errors.";
            if (rep.errors != null) foreach (var e in rep.errors) host.Add(Label("ERROR: " + e, "h5-sub"));
            if (rep.results == null) return;
            foreach (var r in rep.results)
            {
                var card = new VisualElement(); card.AddToClassList("h5-card"); card.AddToClassList("h5-row");
                card.Add(Pill(r.ok ? "OK" : "FAILED", r.ok ? "ok" : "err"));
                var text = new VisualElement(); text.AddToClassList("h5-grow"); text.style.marginLeft = 8;
                text.Add(Label(r.platform, null));
                text.Add(Label(r.ok ? $"{Path.GetFileName(r.zip)}  ({r.sizeBytes / 1048576f:0.00} MB, {r.files} files)" : string.Join("\n", r.errors ?? new string[0]), "h5-sub"));
                card.Add(text);
                if (r.ok) { var zip = r.zip; card.Add(Button("Reveal", () => EditorUtility.RevealInFinder(zip))); }
                host.Add(card);
            }
        }

        private static string PlatformId(H5Platform p) => p.ToString().ToLowerInvariant();

        private static string SafeName(string s)
        {
            foreach (var c in Path.GetInvalidFileNameChars()) s = s.Replace(c, '_');
            return s.Replace(' ', '_');
        }
    }
}

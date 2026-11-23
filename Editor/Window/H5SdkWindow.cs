using System;
using System.Collections.Generic;
using System.Linq;
using H5PlatformSDK.Editor.Optimize;
using UnityEditor;
using UnityEditor.UIElements;
using UnityEngine;
using UnityEngine.UIElements;

namespace H5PlatformSDK.Editor.Window
{
    /// <summary>
    /// Main window: sidebar of tabs + content, UI Toolkit.
    /// </summary>
    public sealed partial class H5SdkWindow : EditorWindow
    {
        private static string Version => H5Paths.PackageVersion;
        private const string TabPref = "H5PlatformSDK.Window.Tab";
        private const string PlatformPref = "H5PlatformSDK.Window.Platform";
        
        private struct Tab
        {
            public string Name;
            public string Phase; // null = implemented
            public bool Internal; // packaging tabs: only in the internal edition
            public Func<H5SdkWindow, VisualElement> Build;
        }

        private static readonly Tab[] Tabs =
        {
            new Tab { Name = "Home", Build = w => w.BuildHome() },
            new Tab { Name = "Optimize Wizard", Build = w => w.BuildWizard() },
            new Tab { Name = "Build Settings", Build = w => w.BuildBuildSettings() },
            new Tab { Name = "Textures", Build = w => w.BuildTextures() },
            new Tab { Name = "Audio", Build = w => w.BuildAudio() },
            new Tab { Name = "Shaders", Build = w => w.BuildShaders() },
            new Tab { Name = "Fonts", Build = w => w.BuildFonts() },
            new Tab { Name = "Platform IDs", Internal = true, Build = w => w.BuildPlatforms() },
            new Tab { Name = "Package", Internal = true, Build = w => w.BuildPackage() },
        };

        private static bool Visible(Tab t) => !t.Internal || H5Paths.IsInternalEdition;

        private H5SdkConfig _config;
        private VisualElement _content;
        private readonly List<Button> _tabButtons = new List<Button>();
        private int _tab;

        [MenuItem("H5 Platform SDK/Open", priority = 0)]
        public static void Open()
        {
            var w = GetWindow<H5SdkWindow>();
            w.titleContent = new GUIContent("H5 Platform SDK");
            w.minSize = new Vector2(900, 540);
            w.Show();
        }

        private void CreateGUI()
        {
            _config = H5SdkConfigProvider.GetOrCreateDefault();
            H5Paths.WriteCliPathHint();
            _tab = Mathf.Clamp(EditorPrefs.GetInt(TabPref, 0), 0, Tabs.Length - 1);
            if (!Visible(Tabs[_tab])) _tab = 0;

            var root = rootVisualElement;
            root.Clear();
            var theme = AssetDatabase.LoadAssetAtPath<StyleSheet>(H5Paths.ThemePath);
            if (theme != null) root.styleSheets.Add(theme);
            root.AddToClassList("h5-root");

            var sidebar = new VisualElement();
            sidebar.AddToClassList("h5-sidebar");
            sidebar.Add(Label("H5 Platform SDK", "h5-title"));
            sidebar.Add(Label("v" + Version, "h5-version"));
            if (H5UpdateCheck.UpdateAvailable)
            {
                sidebar.Add(Label("Update available: v" + H5UpdateCheck.Latest, "h5-version"));
                var upd = new Button(H5UpdateCheck.Update) { text = "Update" };
                sidebar.Add(upd);
            }

            var tabs = new VisualElement();
            tabs.AddToClassList("h5-tabs");
            _tabButtons.Clear();
            bool dividerAdded = false;
            for (int i = 0; i < Tabs.Length; i++)
            {
                int index = i;
                if (!Visible(Tabs[i])) { _tabButtons.Add(null); continue; }
                if (Tabs[i].Internal && !dividerAdded) { tabs.Add(Label("INTERNAL - PACKAGING", "h5-version")); dividerAdded = true; }
                var b = new Button(() => SelectTab(index)) { text = Tabs[i].Name };
                b.AddToClassList("h5-tab");
                _tabButtons.Add(b);
                tabs.Add(b);
            }
            sidebar.Add(tabs);

            var build = new Button(() => RunBuild(false)) { text = "Build & Analyze" };
            build.AddToClassList("h5-accent");
            sidebar.Add(build);

            _content = new ScrollView();
            _content.AddToClassList("h5-content");
            _content.style.flexGrow = 1;

            root.Add(sidebar);
            root.Add(_content);
            SelectTab(_tab);
        }

        private void SelectTabByName(string name)
        {
            for (int i = 0; i < Tabs.Length; i++) if (Tabs[i].Name == name && Visible(Tabs[i])) { SelectTab(i); return; }
        }

        private void SelectTab(int index)
        {
            if (index < 0 || index >= Tabs.Length || !Visible(Tabs[index])) index = 0;
            _tab = index;
            EditorPrefs.SetInt(TabPref, index);
            for (int i = 0; i < _tabButtons.Count; i++)
                _tabButtons[i]?.EnableInClassList("h5-tab--selected", i == index);

            _content.Clear();
            var tab = Tabs[index];
            if (tab.Build != null)
            {
                _content.Add(tab.Build(this));
            }
            else
            {
                _content.Add(Label(tab.Name, "h5-h1"));
                _content.Add(Label("Coming in " + tab.Phase + ". See Plans~/05-Roadmap.md in the SDK repository.", "h5-sub"));
            }
        }

        private struct SetupCheck
        {
            public string Title, Detail, ActionText;
            public bool Ok;
            public Action Action;
        }

        private List<SetupCheck> GetSetupChecks()
        {
            return new List<SetupCheck>
            {
                new SetupCheck { Title = "WebGL build target active", Ok = EditorUserBuildSettings.activeBuildTarget == BuildTarget.WebGL,
                    Detail = "Switch in File > Build Profiles." },
                new SetupCheck { Title = "Node.js 18+ installed (needed by the QA tool)", Ok = H5PackagerRunner.FindNode() != null,
                    Detail = "Install from nodejs.org or `brew install node`, then reopen the window." },
                new SetupCheck { Title = "H5SdkConfig asset exists", Ok = _config != null, Detail = "Resources/H5SdkConfig.asset" },
                new SetupCheck { Title = "H5Neutral WebGL template installed", Ok = H5NeutralSetup.IsInstalled, Detail = H5NeutralSetup.TargetFolder,
                    ActionText = "Install", Action = () => { H5NeutralSetup.Install(); SelectTab(_tab); } },
                new SetupCheck { Title = "At least one scene enabled in Build Profiles",
                    Ok = EditorBuildSettings.scenes.Length > 0 && Array.Exists(EditorBuildSettings.scenes, sc => sc.enabled),
                    Detail = "Add the game scenes." },
                new SetupCheck { Title = "H5Neutral is the selected WebGL template",
                    Ok = PlayerSettings.WebGL.template == "PROJECT:" + H5NeutralSetup.TemplateName,
                    Detail = "Project Settings > Player > WebGL > Resolution and Presentation, or run Build & Analyze." },
                new SetupCheck { Title = "No legacy per-platform *_BUILD defines", Ok = !HasLegacyDefines(),
                    Detail = "Remove them in Player Settings > Scripting Define Symbols (WebGL), or run Build & Analyze once." },
            };
        }

        /// <summary>release = false: quick analysis build (fixed fast settings). release = true: production build with the Build Settings.</summary>
        private void RunBuild(bool release)
        {
            if (!EditorUtility.DisplayDialog(release ? "Release build" : "Analysis build",
                release ? "Builds the production WebGL build with your Build Settings. This can take 5-15 minutes. Unity may recompile first."
                        : "Builds quickly with fixed settings (no compression) so the report is ready fast. Your settings are not changed. Do not send this build. Unity may recompile first.",
                "Build", "Cancel")) return;
            H5NeutralBuild.Build(release);
            SelectTab(_tab);
        }

        private void ToggleQa()
        {
            if (H5QaRunner.Running) H5QaRunner.Stop();
            else
            {
                var err = H5QaRunner.Start(H5QaRunner.FindBuildDir());
                if (err != null) EditorUtility.DisplayDialog("QA tool", err, "OK");
            }
            SelectTab(_tab);
        }

        // ---------------------------------------------------------------- Home

        private VisualElement BuildHome()
        {
            var page = new VisualElement();
            page.Add(Label("Home", "h5-h1"));
            page.Add(Label("Where your WebGL build stands and what to do next.", "h5-sub"));

            var a = H5BuildAnalyzer.Load();
            bool hasBuild = a != null && a.succeeded && a.outputBytes > 0;
            var checks = GetSetupChecks();
            int issues = checks.Count(c => !c.Ok);
            int review = H5BuildSettingsModel.CountNotOk();
            string qaDir = H5QaRunner.FindBuildDir();

            // Status strip
            var stats = new VisualElement(); stats.AddToClassList("h5-stats");
            stats.Add(Stat(hasBuild ? H5BuildAnalyzer.Format(a.outputBytes) : "No build", hasBuild ? (a.kind == "analysis" ? "Analysis build (uncompressed)" : "Release build") : "Last build", false));
            stats.Add(Stat(issues == 0 ? "OK" : issues.ToString(), "Setup issues", issues > 0));
            stats.Add(Stat(review.ToString(), "Settings to review", review > 0));
            stats.Add(Stat(hasBuild ? a.categories.Sum(c => c.count).ToString() : "-", "Assets in build", false));
            page.Add(stats);

            // Hero: the guided path
            var hero = new VisualElement(); hero.AddToClassList("h5-hero");
            var heroText = new VisualElement(); heroText.AddToClassList("h5-grow");
            heroText.Add(Label("Start Optimization Wizard", "h5-hero-title"));
            heroText.Add(Label("Build and analyze, optimize textures, audio, shaders and fonts, review settings, then test.", "h5-hero-sub"));
            hero.Add(heroText);
            hero.Add(Pill(WizardStepCount + " steps", "idle"));
            hero.RegisterCallback<ClickEvent>(_ => SelectTabByName("Optimize Wizard"));
            page.Add(hero);

            // Quick actions
            var tiles = new VisualElement(); tiles.AddToClassList("h5-tiles");
            tiles.Add(Tile("Build & Analyze", "Quick build to find assets worth optimizing", () => RunBuild(false), true));
            tiles.Add(Tile(H5QaRunner.Running ? "Stop QA server" : "Test with QA tool",
                H5QaRunner.Running ? "Running at " + H5QaRunner.Url : "Check the integration and screen sizes in the browser",
                ToggleQa, H5QaRunner.Running || qaDir != null));
            tiles.Add(Tile("Build Settings", "Compression, stripping, exceptions", () => SelectTabByName("Build Settings"), true));
            if (H5Paths.IsInternalEdition)
                tiles.Add(Tile("Package", "Create the portal zips (internal)", () => SelectTabByName("Package"), true));
            page.Add(tiles);

            // Setup status: only what needs attention
            page.Add(Label("Setup", "h5-section"));
            if (issues == 0)
            {
                var ok = new VisualElement(); ok.AddToClassList("h5-card"); ok.AddToClassList("h5-row");
                ok.Add(Pill("OK", "ok"));
                var t = Label("All setup checks passed.", null); t.style.marginLeft = 8; ok.Add(t);
                page.Add(ok);
            }
            else
            {
                foreach (var c in checks.Where(c => !c.Ok))
                    AddCheck(page, c.Title, false, c.Detail, c.ActionText, c.Action);
            }

            // Tools
            page.Add(Label("Optimization tools", "h5-section"));
            var tools = new VisualElement(); tools.AddToClassList("h5-card");
            tools.Add(ToolRow("Textures", "Max size and crunch compression"));
            tools.Add(ToolRow("Audio", "Vorbis, quality cap and load type"));
            tools.Add(ToolRow("Shaders", "Always Included shaders and their sizes"));
            tools.Add(ToolRow("Fonts", "Font sizes and TextMeshPro assets"));
            tools.Add(ToolRow("Build Settings", "Compression, stripping, exceptions"));
            page.Add(tools);

            var foot = new VisualElement(); foot.AddToClassList("h5-row");
            foot.Add(Button("Select config asset", () => Selection.activeObject = _config));
            foot.Add(Button("Open docs folder", () =>
            {
                var readme = System.IO.Path.Combine(H5Paths.DocsDir, "README.md");
                if (System.IO.File.Exists(readme)) EditorUtility.RevealInFinder(readme);
            }));
            foot.Add(Button("Reinstall H5Neutral template", () =>
            {
                if (EditorUtility.DisplayDialog("Reinstall template", "Overwrites Assets/WebGLTemplates/H5Neutral with the SDK's copy.", "Reinstall", "Cancel"))
                    H5NeutralSetup.Install(true);
            }));
            page.Add(foot);
            return page;
        }

        private static VisualElement Stat(string value, string label, bool warn)
        {
            var s = new VisualElement(); s.AddToClassList("h5-stat");
            if (warn) s.AddToClassList("h5-stat--warn");
            s.Add(Label(value, "h5-stat-value"));
            s.Add(Label(label, "h5-stat-label"));
            return s;
        }

        private VisualElement Tile(string title, string sub, Action onClick, bool enabled)
        {
            var t = new VisualElement(); t.AddToClassList("h5-tile");
            t.Add(Label(title, "h5-tile-title"));
            t.Add(Label(sub, "h5-tile-sub"));
            if (enabled) t.RegisterCallback<ClickEvent>(_ => onClick());
            else t.AddToClassList("h5-tile--disabled");
            return t;
        }

        private VisualElement ToolRow(string tab, string description)
        {
            var r = new VisualElement(); r.AddToClassList("h5-toolrow");
            r.Add(Label(tab, "h5-toolrow-title"));
            var d = Label(description, "h5-sub"); d.style.marginBottom = 0; d.AddToClassList("h5-grow"); r.Add(d);
            r.Add(Label(">", "h5-sub"));
            r.RegisterCallback<ClickEvent>(_ => SelectTabByName(tab));
            return r;
        }

        private static bool HasLegacyDefines()
        {
            var defines = PlayerSettings.GetScriptingDefineSymbols(UnityEditor.Build.NamedBuildTarget.WebGL);
            foreach (var d in defines.Split(';'))
                if (d.Trim().EndsWith("_BUILD", StringComparison.Ordinal)) return true;
            return false;
        }

        private void AddCheck(VisualElement parent, string title, bool ok, string detail, string actionText, Action action)
        {
            var card = new VisualElement();
            card.AddToClassList("h5-card");
            card.AddToClassList("h5-row");
            card.Add(Pill(ok ? "OK" : "TODO", ok ? "ok" : "warn"));
            var text = new VisualElement();
            text.AddToClassList("h5-grow");
            text.style.marginLeft = 8;
            text.Add(Label(title, null));
            text.Add(Label(detail, "h5-sub"));
            card.Add(text);
            if (!ok && action != null) card.Add(Button(actionText, action));
            parent.Add(card);
        }

        // ------------------------------------------------------------ Platforms

        private VisualElement BuildPlatforms()
        {
            var page = new VisualElement();
            page.Add(Label("Platform IDs", "h5-h1"));
            page.Add(Label("Internal: enter the app or game IDs created on each portal. They are baked into the portal zips.", "h5-sub"));

            var selected = (H5Platform)EditorPrefs.GetInt(PlatformPref, (int)PlatformCatalog.All[0].Id);
            var detail = new VisualElement();
            var grid = new VisualElement();
            grid.AddToClassList("h5-grid");
            var cards = new Dictionary<H5Platform, VisualElement>();

            foreach (var info in PlatformCatalog.All)
            {
                var p = info;
                var card = new VisualElement();
                card.AddToClassList("h5-pcard");
                var head = new VisualElement();
                head.AddToClassList("h5-row");
                var name = Label(p.Name, "h5-pcard-name");
                name.AddToClassList("h5-grow");
                head.Add(name);
                var st = p.GetStatus(_config);
                head.Add(st == PlatformStatus.Ready ? Pill("Ready", "ok")
                    : st == PlatformStatus.NeedsConfig ? Pill("Needs config", "warn")
                    : Pill("Coming soon", "idle"));
                card.Add(head);
                card.Add(Label(p.Tagline, "h5-pcard-tag"));
                card.RegisterCallback<ClickEvent>(_ =>
                {
                    EditorPrefs.SetInt(PlatformPref, (int)p.Id);
                    foreach (var kv in cards) kv.Value.EnableInClassList("h5-pcard--selected", kv.Key == p.Id);
                    ShowPlatformDetail(detail, p);
                });
                cards[p.Id] = card;
                card.EnableInClassList("h5-pcard--selected", p.Id == selected);
                grid.Add(card);
            }

            page.Add(grid);
            page.Add(detail);
            var current = PlatformCatalog.All[0];
            foreach (var info in PlatformCatalog.All) if (info.Id == selected) current = info;
            ShowPlatformDetail(detail, current);
            return page;
        }

        private void ShowPlatformDetail(VisualElement host, PlatformInfo info)
        {
            host.Clear();
            host.Add(Label(info.Name + " settings", "h5-section"));

            var problem = info.Validate(_config);
            var box = new VisualElement();
            box.AddToClassList("h5-card");
            if (!info.Supported)
            {
                box.Add(Pill("Coming soon", "idle"));
                box.Add(Label("Not available in " + Version + ". Planned for a later version.", "h5-sub"));
                host.Add(box);
                return;
            }
            if (problem != null)
            {
                box.Add(Pill("Needs config", "warn"));
                box.Add(Label(problem, "h5-sub"));
            }
            else
            {
                box.Add(Pill("Ready", "ok"));
            }

            if (info.ConfigFields.Length == 0)
            {
                box.Add(Label("Nothing to configure for this platform.", "h5-sub"));
            }
            else
            {
                var so = new SerializedObject(_config);
                foreach (var field in info.ConfigFields)
                {
                    var prop = so.FindProperty(field);
                    if (prop == null) continue;
                    var pf = new PropertyField(prop);
                    pf.Bind(so);
                    box.Add(pf);
                }
            }
            host.Add(box);
        }

        // -------------------------------------------------------------- helpers

        private static Label Label(string text, string cls)
        {
            var l = new Label(text);
            if (cls != null) l.AddToClassList(cls);
            return l;
        }

        private static Label Pill(string text, string kind)
        {
            var l = new Label(text);
            l.AddToClassList("h5-pill");
            l.AddToClassList("h5-pill--" + kind);
            return l;
        }

        private static Button Button(string text, Action onClick)
        {
            var b = new Button(onClick) { text = text };
            b.AddToClassList("h5-btn");
            return b;
        }
    }
}

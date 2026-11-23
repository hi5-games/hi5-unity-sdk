using System;
using UnityEditor;
using UnityEngine.UIElements;

namespace H5PlatformSDK.Editor.Window
{
    public sealed partial class H5SdkWindow
    {
        private const int WizardStepCount = 6;
        private const string WizardStepPref = "H5PlatformSDK.Window.WizardStep";
        private static readonly string[] WizardTitles = { "Build & Analyze", "Textures", "Audio", "Shaders & Fonts", "Test (QA)", "Release build" };

        private int WizardStep
        {
            get => UnityEngine.Mathf.Clamp(EditorPrefs.GetInt(H5Paths.ProjectKey(WizardStepPref), 0), 0, WizardStepCount - 1);
            set => EditorPrefs.SetInt(H5Paths.ProjectKey(WizardStepPref), value);
        }

        /// <summary>One step at a time: build, settings, textures, audio, shaders/fonts, then test. The bar lets experienced users jump.</summary>
        private VisualElement BuildWizard()
        {
            var page = new VisualElement();
            page.Add(Label("Optimize Wizard", "h5-h1"));
            int cur = WizardStep;

            var bar = new VisualElement(); bar.AddToClassList("h5-steps");
            for (int i = 0; i < WizardStepCount; i++)
            {
                int n = i;
                var b = new Button(() => { WizardStep = n; SelectTab(_tab); }) { text = (i < cur ? "\u2713 " : (i + 1) + ". ") + WizardTitles[i] };
                b.AddToClassList("h5-step");
                if (i == cur) b.AddToClassList("h5-step--current"); else if (i < cur) b.AddToClassList("h5-step--done");
                bar.Add(b);
            }
            page.Add(bar);

            page.Add(WizardContent(cur));

            var foot = new VisualElement(); foot.AddToClassList("h5-wizard-footer");
            var back = Button("Back", () => { WizardStep = cur - 1; SelectTab(_tab); });
            back.SetEnabled(cur > 0);
            foot.Add(back);
            var next = Button(cur == WizardStepCount - 1 ? "Finish" : "Next", () =>
            {
                if (cur == WizardStepCount - 1) { WizardStep = 0; SelectTabByName("Home"); return; }
                WizardStep = cur + 1; SelectTab(_tab);
            });
            next.AddToClassList("h5-accent");
            foot.Add(next);
            page.Add(foot);
            return page;
        }

        private VisualElement WizardContent(int step)
        {
            var box = new VisualElement();
            switch (step)
            {
                case 0:
                    box.Add(Label("Quick build with a fixed configuration. It only exists to find which assets are worth optimizing, so size does not matter here.", "h5-sub"));
                    var one = new VisualElement(); one.AddToClassList("h5-build-cards"); one.Add(BuildAnalysisCard());
                    box.Add(one);
                    box.Add(BuildLastBuildFoldout(true));
                    break;
                case 1: box.Add(BuildTextures()); break;
                case 2: box.Add(BuildAudio()); break;
                case 3:
                    box.Add(BuildShaders());
                    box.Add(BuildFonts());
                    break;
                case 4:
                    box.Add(Label("Test the build in the browser", "h5-section"));
                    var card = new VisualElement(); card.AddToClassList("h5-card");
                    var qaDir = H5QaRunner.FindBuildDir();
                    card.Add(Label(H5QaRunner.Running ? "QA server running at " + H5QaRunner.Url :
                        qaDir != null ? "Opens your last build with the QA tool: SDK integration, ads flow, landscape and portrait sizes, window resize."
                                      : "No build yet. Go back to step 1 and build first.", "h5-sub"));
                    var row = new VisualElement(); row.AddToClassList("h5-row");
                    var go = Button(H5QaRunner.Running ? "Stop QA server" : "Start QA tool", ToggleQa);
                    go.SetEnabled(H5QaRunner.Running || qaDir != null);
                    row.Add(go);
                    card.Add(row);
                    box.Add(card);
                    break;
                default:
                    box.Add(Label("Pick the size options for your game, then build the version you send.", "h5-sub"));
                    box.Add(BuildSettingsPanel());
                    var rel = new VisualElement(); rel.AddToClassList("h5-build-cards"); rel.style.marginTop = 8; rel.Add(BuildReleaseCard());
                    box.Add(rel);
                    box.Add(Label("After the release build, use 'Test last build' once more, then send the build folder (the one with index.html) to the Hi5 Games team.", "h5-sub"));
                    break;
            }
            return box;
        }
    }
}

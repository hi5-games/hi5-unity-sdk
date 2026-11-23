using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace H5PlatformSDK.Editor.Window
{
    /// <summary>
    /// Builds the single platform-neutral WebGL build (H5Neutral template, no platform defines).
    /// The Packager then turns that build into per-portal zips.
    /// </summary>
    internal static class H5NeutralBuild
    {
        public const string LastBuildPref = "H5PlatformSDK.LastNeutralBuild";
        public static string LastBuildKey => H5Paths.ProjectKey(LastBuildPref);

        /// <summary>Defines used by SDK 1.x per-platform builds. They must not be set in a neutral build.</summary>
        private static readonly string[] LegacyDefines =
        {
            "CRAZYGAMES_BUILD", "PLAYGAMA_BUILD", "XIAOMI_BUILD", "Y8_BUILD", "YANDEX_BUILD", "GAMEPIX_BUILD",
            "GAMEMONETIZE_BUILD", "GAMEDISTRIBUTION_BUILD", "MINIGAME_BUILD",
        };

        /// <summary>Applies the neutral Player settings (target, template, no legacy defines; NOT size options). Returns true when scripting defines changed (Unity will recompile).</summary>
        public static bool ApplySettings()
        {
            if (EditorUserBuildSettings.activeBuildTarget != BuildTarget.WebGL)
                EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.WebGL, BuildTarget.WebGL);

            H5NeutralSetup.Install();
            PlayerSettings.WebGL.template = "PROJECT:" + H5NeutralSetup.TemplateName;
            // Compression, stripping etc. are the developer's choice (Build Settings tab shows the recommended values).

            var target = NamedBuildTarget.WebGL;
            var current = PlayerSettings.GetScriptingDefineSymbols(target).Split(';')
                .Select(d => d.Trim()).Where(d => d.Length > 0).ToList();
            var cleaned = current.Where(d => Array.IndexOf(LegacyDefines, d) < 0).ToList();
            if (cleaned.Count == current.Count) return false;
            PlayerSettings.SetScriptingDefineSymbols(target, string.Join(";", cleaned));
            return true;
        }

        /// <summary>
        /// Writes the Project Settings default icon to TemplateData/h5-icon.png so the loading screen can show it.
        /// No default icon set -> no file -> the template shows only the loading bar.
        /// </summary>
        private static void ExportDefaultIcon(string buildFolder)
        {
            try
            {
                var icons = PlayerSettings.GetIcons(NamedBuildTarget.Unknown, IconKind.Any);
                var icon = icons?.Where(t => t != null).OrderByDescending(t => t.width).FirstOrDefault();
                if (icon == null) return;
                var rt = RenderTexture.GetTemporary(icon.width, icon.height, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
                var prev = RenderTexture.active;
                Graphics.Blit(icon, rt);
                RenderTexture.active = rt;
                var copy = new Texture2D(icon.width, icon.height, TextureFormat.RGBA32, false);
                copy.ReadPixels(new Rect(0, 0, icon.width, icon.height), 0, 0);
                copy.Apply();
                RenderTexture.active = prev;
                RenderTexture.ReleaseTemporary(rt);
                var dir = Path.Combine(buildFolder, "TemplateData");
                Directory.CreateDirectory(dir);
                File.WriteAllBytes(Path.Combine(dir, "h5-icon.png"), copy.EncodeToPNG());
                UnityEngine.Object.DestroyImmediate(copy);
            }
            catch (Exception e) { Debug.LogWarning("[H5PlatformSDK] Default icon export skipped: " + e.Message); }
        }

        /// <summary>
        /// release = false: quick ANALYSIS build. Uses fixed settings that make Unity finish fast (no compression, smaller-build code generation,
        /// code generation, minimal stripping); sizes of the output are meaningless, the asset report is what counts.
        /// The developer's own settings are restored afterwards.
        /// release = true: the production build with the developer's Build Settings (plus the release invariants).
        /// </summary>
        public static void Build(bool release)
        {
            if (ApplySettings())
            {
                Debug.LogWarning("[H5PlatformSDK] Removed legacy *_BUILD defines from WebGL settings. Unity is recompiling - run Build again when it finishes.");
                return;
            }

            var folder = "Builds/None/WEBGL_" + (release ? "release_" : "analysis_") + DateTime.Now.ToString("yyyyMMdd_HHmmss");
            var web = NamedBuildTarget.WebGL;
            var oldCompression = PlayerSettings.WebGL.compressionFormat;
            var oldCodeGen = PlayerSettings.GetIl2CppCodeGeneration(web);
            var oldStripping = PlayerSettings.GetManagedStrippingLevel(web);
            var oldDev = EditorUserBuildSettings.development;
            var oldFallback = PlayerSettings.WebGL.decompressionFallback;
            var oldConfig = PlayerSettings.GetIl2CppCompilerConfiguration(web);
            UnityEditor.Build.Reporting.BuildReport report;
            try
            {
                if (release) H5PlatformSDK.Editor.Optimize.H5BuildSettingsModel.ApplyReleaseInvariants();
                else
                {
                    EditorUserBuildSettings.development = false;
                    PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
                    PlayerSettings.SetIl2CppCodeGeneration(web, Il2CppCodeGeneration.OptimizeSize);
                    PlayerSettings.SetManagedStrippingLevel(web, ManagedStrippingLevel.Minimal);
                }
                report = BuildTo(folder, false, release ? "release" : "analysis");
            }
            finally
            {
                if (!release)
                {
                    PlayerSettings.WebGL.compressionFormat = oldCompression;
                    PlayerSettings.SetIl2CppCodeGeneration(web, oldCodeGen);
                    PlayerSettings.SetManagedStrippingLevel(web, oldStripping);
                    EditorUserBuildSettings.development = oldDev;
                    PlayerSettings.WebGL.decompressionFallback = oldFallback;
                    PlayerSettings.SetIl2CppCompilerConfiguration(web, oldConfig);
                }
            }
            if (report.summary.result == BuildResult.Succeeded) EditorUtility.RevealInFinder(folder);
        }

        /// <summary>
        /// Builds the enabled scenes to <paramref name="folder"/> (WebGL: the OUTPUT FOLDER; the page lands at folder/index.html).
        /// Shared by the window's Build button and the batchmode entry point <see cref="H5PlatformSDK.Editor.H5BuildCI"/>.
        /// </summary>
        internal static BuildReport BuildTo(string folder, bool development, string kind = "release")
        {
            var options = new BuildPlayerOptions
            {
                scenes = EditorBuildSettings.scenes.Where(s => s.enabled).Select(s => s.path).ToArray(),
                locationPathName = folder,
                target = BuildTarget.WebGL,
                options = development ? BuildOptions.Development : BuildOptions.None,
            };

            var report = BuildPipeline.BuildPlayer(options);
            var summary = report.summary;
            var fullFolder = Path.GetFullPath(folder);
            var analysis = H5PlatformSDK.Editor.Optimize.H5BuildAnalyzer.Analyze(report, fullFolder);
            analysis.kind = kind;
            H5PlatformSDK.Editor.Optimize.H5BuildAnalyzer.Save(analysis);
            if (summary.result == BuildResult.Succeeded)
            {
                ExportDefaultIcon(fullFolder);
                EditorPrefs.SetString(LastBuildKey, fullFolder);
                Debug.Log($"[H5PlatformSDK] Neutral build succeeded: {summary.totalSize} bytes -> {folder}");
            }
            else
            {
                Debug.LogError($"[H5PlatformSDK] Neutral build failed: {summary.result} ({summary.totalErrors} errors)");
            }
            return report;
        }
    }
}

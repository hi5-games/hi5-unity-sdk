using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;
using H5PlatformSDK.Editor.Window;

namespace H5PlatformSDK.Editor
{
    /// <summary>
    /// Batchmode entry point for the neutral WebGL build, used by `h5-packager build` and CI:
    /// <code>Unity -batchmode -projectPath . -buildTarget WebGL -executeMethod H5PlatformSDK.Editor.H5BuildCI.Build
    ///   [-h5Out Builds/None/WEBGL_x] [-h5Development] -logFile build.log</code>
    /// Writes Builds/last-build.json ({ok, path, sizeBytes, seconds, errors}) and exits with 0 (success) or 1.
    /// </summary>
    public static class H5BuildCI
    {
        [Serializable]
        private class Result
        {
            public bool ok;
            public string path;
            public long sizeBytes;
            public int seconds;
            public string unityVersion;
            public bool development;
            public string[] errors = new string[0];
        }

        public static void Build()
        {
            var started = DateTime.Now;
            var result = new Result { unityVersion = Application.unityVersion };
            try
            {
                var args = Environment.GetCommandLineArgs();
                string Arg(string name)
                {
                    var i = Array.IndexOf(args, name);
                    return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
                }
                result.development = args.Contains("-h5Development");
                var folder = Arg("-h5Out") ?? "Builds/None/WEBGL_" + started.ToString("yyyyMMdd_HHmmss");

                // In batchmode the player scripts are compiled by BuildPlayer with the defines set here, so a define
                // change does not need the second run that the window's Build button asks for.
                if (H5NeutralBuild.ApplySettings())
                    Debug.Log("[H5PlatformSDK] Removed legacy *_BUILD defines from WebGL settings.");

                var report = H5NeutralBuild.BuildTo(folder, result.development);
                result.path = Path.GetFullPath(folder);
                result.ok = report.summary.result == BuildResult.Succeeded;
                result.sizeBytes = (long)report.summary.totalSize;
                if (!result.ok)
                {
                    result.errors = report.steps.SelectMany(s => s.messages)
                        .Where(m => m.type == LogType.Error || m.type == LogType.Exception)
                        .Select(m => m.content).Distinct().Take(20).ToArray();
                    if (result.errors.Length == 0) result.errors = new[] { "Build " + report.summary.result + " (" + report.summary.totalErrors + " errors) - see the Unity log" };
                }
            }
            catch (Exception e)
            {
                result.ok = false;
                result.errors = new[] { e.ToString() };
            }

            result.seconds = (int)(DateTime.Now - started).TotalSeconds;
            Directory.CreateDirectory("Builds");
            File.WriteAllText(Path.Combine("Builds", "last-build.json"), JsonUtility.ToJson(result, true));
            Debug.Log("[H5PlatformSDK] H5BuildCI: " + (result.ok ? "OK " + result.path : "FAILED"));
            if (Application.isBatchMode) EditorApplication.Exit(result.ok ? 0 : 1);
        }
    }
}

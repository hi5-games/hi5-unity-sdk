using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using UnityEditor;
using UnityEngine;

namespace H5PlatformSDK.Editor.Window
{
    [Serializable] internal class PackageResult { public string platform; public bool ok; public string zip; public long sizeBytes; public int files; public string[] errors; }
    [Serializable] internal class PackageReport { public bool ok; public string[] errors; public PackageResult[] results; }


    /// <summary>Runs Tools/h5-packager (Node CLI) - the single implementation of the packaging pipeline.</summary>
    internal static class H5PackagerRunner
    {
        public static string CliPath => H5Paths.CliPath;

        public static string FindNode()
        {
            var candidates = new List<string> { "/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node" };
#if UNITY_EDITOR_WIN
            candidates.Add(@"C:\Program Files\nodejs\node.exe");
#endif
            foreach (var c in candidates) if (File.Exists(c)) return c;
#if UNITY_EDITOR_OSX || UNITY_EDITOR_LINUX
            // Unity launched from the Hub has a minimal PATH (no nvm/fnm) - ask a login shell.
            try
            {
                var o = Exec("/bin/zsh", "-lc \"command -v node\"", null, out _);
                var line = o.Trim().Split('\n')[0].Trim();
                if (File.Exists(line)) return line;
            }
            catch { }
#endif
            return null;
        }

        public static string ConfigJson(H5SdkConfig c)
        {
            // Hand-built: JsonUtility cannot emit this nested shape.
            return "{\"xiaomi\":{\"bannerWidth\":" + c.xiaomiBannerWidth + ",\"bannerHeight\":" + c.xiaomiBannerHeight + "}," +
                   "\"gamemonetize\":{\"gameId\":" + Quote(c.gameMonetizeGameId) + "}," +
                   "\"y8\":{\"appId\":" + Quote(c.y8AppId) + ",\"gameId\":" + Quote(c.y8GameId) + "}," +
                   "\"gamedistribution\":{\"gameKey\":" + Quote(c.gameDistributionGameKey) + "}," +
                   "\"general\":{\"minInterstitialIntervalSec\":" + Mathf.Max(0, c.minInterstitialIntervalSeconds) + "}}";
        }

        private static string Quote(string s) => "\"" + (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";

        /// <summary>Starts packaging on a worker thread; poll Done/Output from the UI.</summary>
        public sealed class Job
        {
            public volatile bool Done;
            public string Output;
            public int ExitCode;
            public PackageReport Report;
        }

        public static Job Start(string node, string input, string[] platforms, string outDir, string name, string version, H5SdkConfig config)
        {
            var job = new Job();
            var cfgPath = Path.Combine(Path.GetTempPath(), "h5-config-" + Guid.NewGuid().ToString("N") + ".json");
            File.WriteAllText(cfgPath, ConfigJson(config));
            var cli = Path.GetFullPath(CliPath);
            var args = $"\"{cli}\" package --in \"{input}\" --platform {string.Join(",", platforms)} --out \"{outDir}\" " +
                       $"--config \"{cfgPath}\" --name \"{name}\" --version \"{version}\" --json";
            Task.Run(() =>
            {
                job.Output = Exec(node, args, null, out job.ExitCode);
                try { File.Delete(cfgPath); } catch { }
                try { job.Report = JsonUtility.FromJson<PackageReport>(job.Output); } catch { }
                job.Done = true;
            });
            return job;
        }

        private static string Exec(string file, string args, string cwd, out int exitCode)
        {
            var psi = new ProcessStartInfo(file, args)
            {
                RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8, WorkingDirectory = cwd ?? Directory.GetCurrentDirectory()
            };
            using (var p = Process.Start(psi))
            {
                var err = p.StandardError.ReadToEndAsync();
                var o = p.StandardOutput.ReadToEnd();
                p.WaitForExit();
                exitCode = p.ExitCode;
                return err.Result.Length > 0 && p.ExitCode != 0 ? o + "\n" + err.Result : o;
            }
        }
    }
}

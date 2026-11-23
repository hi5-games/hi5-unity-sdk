using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace H5PlatformSDK.Editor.Optimize
{
    [Serializable] public sealed class H5FileSize { public string name; public long bytes; }
    [Serializable] public sealed class H5AssetSize { public string path; public string category; public long bytes; }
    [Serializable] public sealed class H5CategorySize { public string name; public long bytes; public int count; }

    /// <summary>Result of the last neutral build: what is on disk and what the biggest assets are.</summary>
    [Serializable]
    public sealed class H5BuildAnalysis
    {
        public string folder;
        public string builtAt;
        public bool succeeded;
        public string kind;                       // "analysis" (quick, uncompressed) or "release"
        public long outputBytes;                  // sum of everything in the output folder (what gets downloaded)
        public List<H5FileSize> files = new List<H5FileSize>();
        public long assetBytes;                   // uncompressed size of tracked assets (from the BuildReport)
        public List<H5CategorySize> categories = new List<H5CategorySize>();
        public List<H5AssetSize> topAssets = new List<H5AssetSize>();
        public List<H5AssetSize> shaders = new List<H5AssetSize>();   // largest shaders in the build
        public List<H5AssetSize> fonts = new List<H5AssetSize>();     // largest fonts in the build
    }

    internal static class H5BuildAnalyzer
    {
        private static string StorePath =>
            Path.Combine(Path.GetDirectoryName(Application.dataPath) ?? ".", "Library", "H5PlatformSDK", "last-analysis.json");

        private static string PreviousPath => Path.ChangeExtension(StorePath, ".prev.json");

        public static H5BuildAnalysis Load(bool previous = false)
        {
            try
            {
                var p = previous ? PreviousPath : StorePath;
                return File.Exists(p) ? JsonUtility.FromJson<H5BuildAnalysis>(File.ReadAllText(p)) : null;
            }
            catch (Exception) { return null; }
        }

        public static H5BuildAnalysis Analyze(BuildReport report, string folder)
        {
            var a = new H5BuildAnalysis
            {
                folder = folder,
                builtAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm"),
                succeeded = report != null && report.summary.result == BuildResult.Succeeded,
            };

            if (Directory.Exists(folder))
            {
                foreach (var f in Directory.GetFiles(folder, "*", SearchOption.AllDirectories))
                {
                    var len = new FileInfo(f).Length;
                    a.files.Add(new H5FileSize { name = f.Substring(folder.Length).TrimStart('/', '\\').Replace('\\', '/'), bytes = len });
                    a.outputBytes += len;
                }
                a.files = a.files.OrderByDescending(x => x.bytes).ToList();
            }

            if (report != null)
            {
                var assets = new List<H5AssetSize>();
                foreach (var pa in report.packedAssets)
                    foreach (var c in pa.contents)
                    {
                        if (c.packedSize == 0) continue;
                        var path = string.IsNullOrEmpty(c.sourceAssetPath) ? "(built-in / generated)" : c.sourceAssetPath;
                        assets.Add(new H5AssetSize { path = path, category = Categorize(path, c.type), bytes = (long)c.packedSize });
                    }
                a.assetBytes = assets.Sum(x => x.bytes);
                a.categories = assets.GroupBy(x => x.category)
                    .Select(g => new H5CategorySize { name = g.Key, bytes = g.Sum(x => x.bytes), count = g.Count() })
                    .OrderByDescending(x => x.bytes).ToList();
                a.topAssets = assets.OrderByDescending(x => x.bytes).Take(40).ToList();
                a.shaders = assets.Where(x => x.category == "Shaders").OrderByDescending(x => x.bytes).Take(25).ToList();
                a.fonts = assets.Where(x => x.category == "Fonts").OrderByDescending(x => x.bytes).Take(25).ToList();
            }
            return a;
        }

        public static void Save(H5BuildAnalysis a)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(StorePath));
                if (File.Exists(StorePath)) File.Copy(StorePath, PreviousPath, true);
                File.WriteAllText(StorePath, JsonUtility.ToJson(a, true));
            }
            catch (Exception e) { Debug.LogWarning("[H5PlatformSDK] Could not save build analysis: " + e.Message); }
        }

        private static string Categorize(string path, Type type)
        {
            var n = type != null ? type.Name : "";
            if (n.Contains("Texture") || n == "Sprite" || n == "Cubemap") return "Textures";
            if (n == "AudioClip") return "Audio";
            if (n == "Mesh") return "Meshes";
            if (n == "Shader" || n == "ComputeShader") return "Shaders";
            if (n == "Font" || n.Contains("TMP_FontAsset")) return "Fonts";
            if (n == "AnimationClip" || n.Contains("Animator")) return "Animation";
            if (n == "MonoScript") return "Scripts";
            if (n == "Material") return "Materials";
            if (path.EndsWith(".unity", StringComparison.OrdinalIgnoreCase)) return "Scenes";
            if (path.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase)) return "Prefabs";
            return "Other";
        }

        public static string Format(long bytes)
        {
            if (bytes >= 1048576) return (bytes / 1048576.0).ToString("0.00") + " MB";
            if (bytes >= 1024) return (bytes / 1024.0).ToString("0.0") + " KB";
            return bytes + " B";
        }
    }
}

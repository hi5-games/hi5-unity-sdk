using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace H5PlatformSDK.Editor.Optimize
{
    /// <summary>One proposed importer change. Only the WebGL platform override is touched, other platforms keep their settings.</summary>
    public sealed class H5OptRow
    {
        public string Path;
        public long DiskBytes;      // size of the source file
        public long BuildBytes;     // size in the last build report (0 = unknown)
        public string Current;      // human readable
        public string Proposed;     // human readable, null when nothing to change
        public bool Selected;
        public Action Apply;        // performs the change (called inside an AssetDatabase editing batch)
        public Func<string> Capture;// returns a backup record for undo
        public string Advice;       // manual advice shown when there is nothing to apply
        public long SortBytes => BuildBytes > 0 ? BuildBytes : DiskBytes;
    }

    [Serializable] class BackupEntry { public string path; public string data; }
    [Serializable] class BackupFile { public string kind; public string at; public List<BackupEntry> entries = new List<BackupEntry>(); }

    public static partial class H5AssetOptimizer
    {
        private const string Platform = "WebGL";

        private static string BackupDir =>
            Path.Combine(Path.GetDirectoryName(Application.dataPath) ?? ".", "Library", "H5PlatformSDK");

        private static string BackupPath(string kind) => Path.Combine(BackupDir, "undo-" + kind + ".json");

        public static bool HasBackup(string kind) => File.Exists(BackupPath(kind));

        // ------------------------------------------------------------ textures

        [Serializable] class TexState { public bool overridden; public int maxSize; public int format; public bool crunched; public int quality; public int compression; }

        public static List<H5OptRow> ScanTextures(int maxSizeCap, bool crunch, int crunchQuality)
        {
            var built = BuildSizes();
            var rows = new List<H5OptRow>();
            foreach (var guid in AssetDatabase.FindAssets("t:Texture2D", new[] { "Assets" }))
            {
                var path = AssetDatabase.GUIDToAssetPath(guid);
                if (IsExcluded(path)) continue;
                var imp = AssetImporter.GetAtPath(path) as TextureImporter;
                if (imp == null || imp.textureType == TextureImporterType.Cursor || imp.textureType == TextureImporterType.Lightmap) continue;

                int w, h;
                imp.GetSourceTextureWidthAndHeight(out w, out h);
                var ps = imp.GetPlatformTextureSettings(Platform);
                var def = imp.GetDefaultPlatformTextureSettings();
                int curMax = ps.overridden ? ps.maxTextureSize : def.maxTextureSize;
                bool curCrunch = ps.overridden ? ps.crunchedCompression : def.crunchedCompression;
                var compression = imp.textureCompression;

                int srcMax = Mathf.Max(w, h);
                int propMax = Mathf.Min(curMax, maxSizeCap);
                if (srcMax > 0) propMax = Mathf.Min(propMax, Mathf.Max(32, Mathf.NextPowerOfTwo(srcMax)));
                bool canCrunch = crunch && compression != TextureImporterCompression.Uncompressed
                    && imp.textureType != TextureImporterType.NormalMap && imp.textureType != TextureImporterType.SingleChannel;
                bool propCrunch = canCrunch || curCrunch;

                bool sizeChange = propMax < curMax;
                bool crunchChange = canCrunch && !curCrunch;
                long disk = FileLen(path);
                built.TryGetValue(path, out var bytes);
                var row = new H5OptRow { Path = path, DiskBytes = disk, BuildBytes = bytes };
                row.Current = $"{w}x{h}  max {curMax}  crunch {(curCrunch ? "on" : "off")}";
                if (sizeChange || crunchChange)
                {
                    row.Proposed = $"max {propMax}  crunch {(propCrunch ? "on" : "off")}";
                    row.Selected = true;
                    int newMax = propMax; bool newCrunch = propCrunch; int q = crunchQuality;
                    row.Apply = () =>
                    {
                        var i = (TextureImporter)AssetImporter.GetAtPath(path);
                        var s = i.GetPlatformTextureSettings(Platform);
                        if (!s.overridden)
                        {
                            var d = i.GetDefaultPlatformTextureSettings();
                            s.format = d.format; s.textureCompression = d.textureCompression; s.compressionQuality = d.compressionQuality;
                            s.crunchedCompression = d.crunchedCompression; s.maxTextureSize = d.maxTextureSize;
                        }
                        s.name = Platform; s.overridden = true;
                        s.maxTextureSize = newMax;
                        s.crunchedCompression = newCrunch;
                        if (newCrunch) s.compressionQuality = q;
                        i.SetPlatformTextureSettings(s);
                        i.SaveAndReimport();
                    };
                    row.Capture = () =>
                    {
                        var i = (TextureImporter)AssetImporter.GetAtPath(path);
                        var s = i.GetPlatformTextureSettings(Platform);
                        return JsonUtility.ToJson(new TexState { overridden = s.overridden, maxSize = s.maxTextureSize, format = (int)s.format, crunched = s.crunchedCompression, quality = s.compressionQuality, compression = (int)s.textureCompression });
                    };
                }
                rows.Add(row);
            }
            return rows.OrderByDescending(r => r.SortBytes).ToList();
        }

        private static void RestoreTexture(BackupEntry e)
        {
            var i = AssetImporter.GetAtPath(e.path) as TextureImporter;
            if (i == null) return;
            var st = JsonUtility.FromJson<TexState>(e.data);
            var s = i.GetPlatformTextureSettings(Platform);
            s.name = Platform; s.overridden = st.overridden; s.maxTextureSize = st.maxSize;
            s.format = (TextureImporterFormat)st.format; s.crunchedCompression = st.crunched;
            s.compressionQuality = st.quality; s.textureCompression = (TextureImporterCompression)st.compression;
            i.SetPlatformTextureSettings(s);
            i.SaveAndReimport();
        }

        // --------------------------------------------------------------- audio

        [Serializable] class AudState { public bool overridden; public int loadType; public int format; public float quality; public int rateSetting; public bool mono; }

        public static List<H5OptRow> ScanAudio(float quality, bool forceMono)
        {
            var built = BuildSizes();
            var rows = new List<H5OptRow>();
            foreach (var guid in AssetDatabase.FindAssets("t:AudioClip", new[] { "Assets" }))
            {
                var path = AssetDatabase.GUIDToAssetPath(guid);
                if (IsExcluded(path)) continue;
                var imp = AssetImporter.GetAtPath(path) as AudioImporter;
                if (imp == null) continue;

                long disk = FileLen(path);
                bool hasOverride = imp.ContainsSampleSettingsOverride(Platform);
                var cur = hasOverride ? imp.GetOverrideSampleSettings(Platform) : imp.defaultSampleSettings;

                var prop = cur;
                prop.compressionFormat = AudioCompressionFormat.Vorbis;
                prop.quality = Mathf.Min(cur.quality, quality);
                // Short effects play instantly when decompressed; longer clips stay compressed in memory.
                prop.loadType = disk > 200 * 1024 ? AudioClipLoadType.CompressedInMemory : AudioClipLoadType.DecompressOnLoad;
                prop.sampleRateSetting = AudioSampleRateSetting.OptimizeSampleRate;
                bool monoChange = forceMono && !imp.forceToMono;

                bool change = prop.compressionFormat != cur.compressionFormat || !Mathf.Approximately(prop.quality, cur.quality)
                    || prop.loadType != cur.loadType || prop.sampleRateSetting != cur.sampleRateSetting || monoChange;

                built.TryGetValue(path, out var bytes);
                var row = new H5OptRow { Path = path, DiskBytes = disk, BuildBytes = bytes };
                row.Current = $"{cur.compressionFormat}  q {cur.quality:0.00}  {cur.loadType}  {(imp.forceToMono ? "mono" : "stereo")}";
                if (change)
                {
                    row.Proposed = $"{prop.compressionFormat}  q {prop.quality:0.00}  {prop.loadType}  {(forceMono ? "mono" : (imp.forceToMono ? "mono" : "stereo"))}";
                    row.Selected = true;
                    var newSettings = prop; bool mono = forceMono;
                    row.Apply = () =>
                    {
                        var i = (AudioImporter)AssetImporter.GetAtPath(path);
                        i.SetOverrideSampleSettings(Platform, newSettings);
                        if (mono) i.forceToMono = true;
                        i.SaveAndReimport();
                    };
                    row.Capture = () =>
                    {
                        var i = (AudioImporter)AssetImporter.GetAtPath(path);
                        var has = i.ContainsSampleSettingsOverride(Platform);
                        var s = has ? i.GetOverrideSampleSettings(Platform) : i.defaultSampleSettings;
                        return JsonUtility.ToJson(new AudState { overridden = has, loadType = (int)s.loadType, format = (int)s.compressionFormat, quality = s.quality, rateSetting = (int)s.sampleRateSetting, mono = i.forceToMono });
                    };
                }
                rows.Add(row);
            }
            return rows.OrderByDescending(r => r.SortBytes).ToList();
        }

        private static void RestoreAudio(BackupEntry e)
        {
            var i = AssetImporter.GetAtPath(e.path) as AudioImporter;
            if (i == null) return;
            var st = JsonUtility.FromJson<AudState>(e.data);
            if (st.overridden)
            {
                var s = i.GetOverrideSampleSettings(Platform);
                s.loadType = (AudioClipLoadType)st.loadType; s.compressionFormat = (AudioCompressionFormat)st.format;
                s.quality = st.quality; s.sampleRateSetting = (AudioSampleRateSetting)st.rateSetting;
                i.SetOverrideSampleSettings(Platform, s);
            }
            else i.ClearSampleSettingOverride(Platform);
            i.forceToMono = st.mono;
            i.SaveAndReimport();
        }

        // ------------------------------------------------------- apply / undo

        /// <summary>Applies the selected rows. Writes an undo file first. Returns the number of assets changed.</summary>
        public static int ApplyRows(string kind, IEnumerable<H5OptRow> rows)
        {
            var todo = rows.Where(r => r.Selected && r.Apply != null).ToList();
            if (todo.Count == 0) return 0;

            var backup = new BackupFile { kind = kind, at = DateTime.Now.ToString("yyyy-MM-dd HH:mm") };
            foreach (var r in todo) backup.entries.Add(new BackupEntry { path = r.Path, data = r.Capture() });
            Directory.CreateDirectory(BackupDir);
            File.WriteAllText(BackupPath(kind), JsonUtility.ToJson(backup, true));

            AssetDatabase.StartAssetEditing();
            try { foreach (var r in todo) r.Apply(); }
            finally { AssetDatabase.StopAssetEditing(); }
            AssetDatabase.SaveAssets();
            return todo.Count;
        }

        /// <summary>Restores what the last Apply changed. Returns the number of assets restored.</summary>
        public static int Undo(string kind)
        {
            var p = BackupPath(kind);
            if (!File.Exists(p)) return 0;
            var backup = JsonUtility.FromJson<BackupFile>(File.ReadAllText(p));
            AssetDatabase.StartAssetEditing();
            try
            {
                foreach (var e in backup.entries)
                {
                    if (kind == "textures") RestoreTexture(e);
                    else if (kind == "audio") RestoreAudio(e);
                    else if (kind == "shaders") RestoreShader(e);
                    else if (kind == "fonts") RestoreFont(e);
                }
            }
            finally { AssetDatabase.StopAssetEditing(); }
            AssetDatabase.SaveAssets();
            File.Delete(p);
            return backup.entries.Count;
        }

        public static string BackupInfo(string kind)
        {
            var p = BackupPath(kind);
            if (!File.Exists(p)) return null;
            var b = JsonUtility.FromJson<BackupFile>(File.ReadAllText(p));
            return $"{b.entries.Count} assets changed on {b.at}";
        }

        // --------------------------------------------------------------- utils

        internal static bool IsExcluded(string path) =>
            path.Contains("/Editor/") || H5Paths.IsSdkAsset(path) || path.Contains("/Gizmos/");

        internal static long FileLen(string assetPath)
        {
            try { return new FileInfo(assetPath).Length; } catch (Exception) { return 0; }
        }

        internal static Dictionary<string, long> BuildSizes()
        {
            var d = new Dictionary<string, long>();
            var a = H5BuildAnalyzer.Load();
            if (a == null) return d;
            foreach (var t in a.topAssets) d[t.path] = t.bytes;
            return d;
        }
    }
}

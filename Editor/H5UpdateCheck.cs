using System;
using UnityEditor;
using UnityEditor.PackageManager;
using UnityEngine;
using UnityEngine.Networking;

namespace H5PlatformSDK.Editor
{
    /// <summary>
    /// Warns when the installed SDK is older than the latest release. Only active for the public edition
    /// (the package's documentationUrl points at the public repo); never blocks the editor.
    /// </summary>
    [InitializeOnLoad]
    public static class H5UpdateCheck
    {
        public const string InstallUrl = "https://github.com/Hi5-Games-Studio/hi5-unity-sdk.git";
        const string ManifestUrl = "https://raw.githubusercontent.com/Hi5-Games-Studio/hi5-unity-sdk/main/package.json";
        const string PrefLatest = "H5SDK.UpdateCheck.Latest";
        const string PrefTime = "H5SDK.UpdateCheck.Time";
        const string SessionKey = "H5SDK.UpdateCheck.Done";
        const double RecheckHours = 6;

        /// <summary>Latest released version seen on the last successful check, or "".</summary>
        public static string Latest => EditorPrefs.GetString(PrefLatest, "");

        public static bool Enabled
        {
            get
            {
                var info = H5Paths.Info;
                return info != null && info.documentationUrl != null && info.documentationUrl.Contains("hi5-unity-sdk");
            }
        }

        public static bool UpdateAvailable => Enabled && Latest.Length > 0 && Compare(H5Paths.PackageVersion, Latest) < 0;

        static H5UpdateCheck()
        {
            EditorApplication.delayCall += () =>
            {
                if (!Enabled || SessionState.GetBool(SessionKey, false)) return;
                SessionState.SetBool(SessionKey, true);
                Check(false);
            };
        }

        public static void Check(bool force)
        {
            if (!Enabled) return;
            double age = (DateTime.UtcNow - new DateTime(long.Parse(EditorPrefs.GetString(PrefTime, "0")))).TotalHours;
            if (!force && Latest.Length > 0 && age < RecheckHours) { Warn(); return; }

            var req = UnityWebRequest.Get(ManifestUrl);
            req.timeout = 8;
            req.SendWebRequest().completed += _ =>
            {
                try
                {
                    if (req.result != UnityWebRequest.Result.Success) return; // offline: stay silent
                    var v = JsonUtility.FromJson<Manifest>(req.downloadHandler.text)?.version;
                    if (string.IsNullOrEmpty(v)) return;
                    EditorPrefs.SetString(PrefLatest, v);
                    EditorPrefs.SetString(PrefTime, DateTime.UtcNow.Ticks.ToString());
                    Warn();
                }
                finally { req.Dispose(); }
            };
        }

        static void Warn()
        {
            if (!UpdateAvailable) return;
            Debug.LogWarning($"[H5 Platform SDK] A newer version is available: v{Latest} (installed v{H5Paths.PackageVersion}). " +
                             "Open H5 Platform SDK > Open and click Update, or re-add the package from " + InstallUrl);
        }

        /// <summary>Re-resolves the git package, which pulls the newest commit of the default branch.</summary>
        public static void Update()
        {
            Client.Add(InstallUrl);
            EditorPrefs.DeleteKey(PrefLatest);
        }

        /// <summary>Negative if a &lt; b. Handles "2.1.0-beta.5" style versions (a release outranks its prereleases).</summary>
        public static int Compare(string a, string b)
        {
            Split(a, out var ca, out var pa); Split(b, out var cb, out var pb);
            for (int i = 0; i < 3; i++) if (ca[i] != cb[i]) return ca[i].CompareTo(cb[i]);
            if (pa.Length == 0 || pb.Length == 0) return pa.Length == pb.Length ? 0 : pa.Length == 0 ? 1 : -1;
            var xa = pa.Split('.'); var xb = pb.Split('.');
            for (int i = 0; i < Math.Max(xa.Length, xb.Length); i++)
            {
                if (i >= xa.Length) return -1;
                if (i >= xb.Length) return 1;
                bool na = int.TryParse(xa[i], out var ia), nb = int.TryParse(xb[i], out var ib);
                int c = na && nb ? ia.CompareTo(ib) : string.CompareOrdinal(xa[i], xb[i]);
                if (c != 0) return c;
            }
            return 0;
        }

        static void Split(string v, out int[] core, out string pre)
        {
            core = new int[3]; pre = "";
            if (string.IsNullOrEmpty(v)) return;
            int d = v.IndexOf('-'); if (d >= 0) { pre = v.Substring(d + 1); v = v.Substring(0, d); }
            var p = v.Split('.');
            for (int i = 0; i < 3 && i < p.Length; i++) int.TryParse(p[i], out core[i]);
        }

        [Serializable] class Manifest { public string version; }
    }
}

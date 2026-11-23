using System.IO;
using UnityEditor;
using PackageInfo = UnityEditor.PackageManager.PackageInfo;
using UnityEngine;

namespace H5PlatformSDK.Editor
{
    /// <summary>
    /// Where the SDK lives. It is a UPM package (read-only), so project-owned files (config assets, WebGL template)
    /// are created under the game's Assets/ folder and package files are located through PackageInfo.
    /// Also works when the folder is embedded in Assets/ (development copy).
    /// </summary>
    [InitializeOnLoad]
    internal static class H5Paths
    {
        public const string PackageName = "com.hi5games.h5platformsdk";

        /// <summary>Project-owned settings live here (Resources so the runtime can load them).</summary>
        public const string ProjectResourcesFolder = "Assets/Resources";

        private static PackageInfo _info;
        private static bool _resolved;

        static H5Paths()
        {
            EditorApplication.delayCall += WriteCliPathHint;
        }

        private static PackageInfo Info
        {
            get
            {
                if (!_resolved)
                {
                    _info = PackageInfo.FindForAssembly(typeof(H5Paths).Assembly);
                    _resolved = true;
                }
                return _info;
            }
        }

        /// <summary>Asset path of the package root, e.g. "Packages/com.hi5games.h5platformsdk".</summary>
        public static string AssetRoot => Info != null ? Info.assetPath : "Packages/" + PackageName;

        /// <summary>Absolute folder of the package on disk (PackageCache, local path or embedded).</summary>
        public static string PackageDir => Info != null ? Info.resolvedPath : Path.GetFullPath("Packages/" + PackageName);

        public static string PackageVersion => Info != null ? Info.version : "?";

        public static string ThemePath => AssetRoot + "/Editor/Window/H5Theme.uss";

        public static string TemplateSourceDir => Path.Combine(PackageDir, "Templates~");

        public static string CliPath => Path.Combine(PackageDir, "Tools~", "h5-packager", "bin", "h5-packager.js");

        /// <summary>
        /// The internal edition ships the per-portal adapters; the partner edition only ships the QA adapter
        /// (see release-partner.sh). Packaging tabs are only shown when the portal adapters are present.
        /// </summary>
        public static bool IsInternalEdition =>
            File.Exists(Path.Combine(PackageDir, "Tools~", "h5-packager", "runtime", "adapters", "playgama.js"));

        public static string DocsDir => Path.Combine(PackageDir, "Documentation~");

        public static string ProjectDir => Path.GetDirectoryName(Application.dataPath) ?? ".";

        /// <summary>EditorPrefs are per machine, not per project. Scope a key to this project so paths from another game never leak in.</summary>
        public static string ProjectKey(string key) => key + "." + Hash128.Compute(Application.dataPath).ToString().Substring(0, 8);

        /// <summary>True for paths that belong to the SDK itself (never optimise those).</summary>
        public static bool IsSdkAsset(string assetPath) =>
            assetPath.StartsWith("Packages/", System.StringComparison.Ordinal) ||
            assetPath.StartsWith("Assets/H5PlatformSDK/", System.StringComparison.Ordinal);

        /// <summary>Lets scripts and AI assistants find the package: Library/H5PlatformSDK/package-dir.txt (+ cli-path.txt).</summary>
        internal static void WriteCliPathHint()
        {
            try
            {
                var dir = Path.Combine(ProjectDir, "Library", "H5PlatformSDK");
                Directory.CreateDirectory(dir);
                var file = Path.Combine(dir, "cli-path.txt");
                var cli = CliPath;
                if (!File.Exists(file) || File.ReadAllText(file) != cli) File.WriteAllText(file, cli);
                var pkgFile = Path.Combine(dir, "package-dir.txt");
                if (!File.Exists(pkgFile) || File.ReadAllText(pkgFile) != PackageDir) File.WriteAllText(pkgFile, PackageDir);
            }
            catch (IOException) { }
        }
    }
}

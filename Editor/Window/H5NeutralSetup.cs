using System.IO;
using UnityEditor;

namespace H5PlatformSDK.Editor.Window
{
    /// <summary>
    /// Unity only reads WebGL templates from Assets/WebGLTemplates, and the SDK package is read-only,
    /// so this setup step copies the template (Templates~/H5Neutral) into the project.
    /// </summary>
    internal static class H5NeutralSetup
    {
        public const string TemplateName = "H5Neutral";
        public const string TargetFolder = "Assets/WebGLTemplates/" + TemplateName;

        public static string SourceDir => Path.Combine(H5Paths.TemplateSourceDir, TemplateName);

        public static bool IsInstalled => AssetDatabase.IsValidFolder(TargetFolder);

        public static void Install(bool overwrite = false)
        {
            if (IsInstalled && !overwrite) return;
            if (!Directory.Exists(SourceDir))
            {
                UnityEngine.Debug.LogError("[H5PlatformSDK] Template source not found: " + SourceDir);
                return;
            }
            if (IsInstalled) AssetDatabase.DeleteAsset(TargetFolder);
            CopyDir(SourceDir, Path.Combine(H5Paths.ProjectDir, TargetFolder));
            AssetDatabase.Refresh();
        }

        private static void CopyDir(string from, string to)
        {
            Directory.CreateDirectory(to);
            foreach (var f in Directory.GetFiles(from))
                File.Copy(f, Path.Combine(to, Path.GetFileName(f)), true);
            foreach (var d in Directory.GetDirectories(from))
                CopyDir(d, Path.Combine(to, Path.GetFileName(d)));
        }
    }
}

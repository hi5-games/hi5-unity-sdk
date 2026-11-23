using System;
using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace H5PlatformSDK.Editor.Optimize
{
    public static partial class H5AssetOptimizer
    {
        // ------------------------------------------------------------- shaders

        private const string AlwaysIncludedProp = "m_AlwaysIncludedShaders";

        // Shaders the engine/UI/SRP resolve implicitly (no material references them). Never proposed for removal.
        private static readonly string[] ProtectedShaderParts =
            { "UI/Default", "Sprites/Default", "Hidden/", "Universal Render Pipeline", "TextMeshPro", "GUI/Text Shader" };

        private static UnityEngine.Object GraphicsSettingsAsset =>
            AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/GraphicsSettings.asset").FirstOrDefault();

        private static HashSet<string> UsedShaderNames()
        {
            var used = new HashSet<string>();
            foreach (var guid in AssetDatabase.FindAssets("t:Material"))
            {
                var m = AssetDatabase.LoadAssetAtPath<Material>(AssetDatabase.GUIDToAssetPath(guid));
                if (m != null && m.shader != null) used.Add(m.shader.name);
            }
            return used;
        }

        /// <summary>
        /// Lists Graphics Settings > Always Included Shaders. Entries no material uses are proposed for removal
        /// (unselected by default: a script using Shader.Find would break).
        /// </summary>
        public static List<H5OptRow> ScanAlwaysIncludedShaders()
        {
            var rows = new List<H5OptRow>();
            var gs = GraphicsSettingsAsset;
            if (gs == null) return rows;
            var prop = new SerializedObject(gs).FindProperty(AlwaysIncludedProp);
            if (prop == null) return rows;

            var used = UsedShaderNames();
            var a = H5BuildAnalyzer.Load();
            for (int i = 0; i < prop.arraySize; i++)
            {
                var sh = prop.GetArrayElementAtIndex(i).objectReferenceValue as Shader;
                if (sh == null) continue;
                var name = sh.name;
                long bytes = 0;
                var path = AssetDatabase.GetAssetPath(sh);
                if (a != null) { var hit = a.shaders.FirstOrDefault(x => x.path == path); if (hit != null) bytes = hit.bytes; }

                bool isUsed = used.Contains(name);
                bool prot = ProtectedShaderParts.Any(p => name.Contains(p));
                var row = new H5OptRow { Path = name, BuildBytes = bytes, DiskBytes = 0 };
                row.Current = isUsed ? "used by a material" : prot ? "protected (engine / UI / SRP)" : "no material uses it";
                if (!isUsed && !prot)
                {
                    row.Proposed = "remove from Always Included";
                    row.Selected = false;
                    row.Apply = () => SetAlwaysIncluded(name, false);
                    row.Capture = () => AlwaysIncludedIndex(name) + "|" + name;
                }
                rows.Add(row);
            }
            return rows.OrderBy(r => r.Proposed == null).ThenBy(r => r.Path).ToList();
        }

        private static int AlwaysIncludedIndex(string shaderName)
        {
            var prop = new SerializedObject(GraphicsSettingsAsset).FindProperty(AlwaysIncludedProp);
            for (int i = 0; i < prop.arraySize; i++)
                if (prop.GetArrayElementAtIndex(i).objectReferenceValue is Shader s && s.name == shaderName) return i;
            return -1;
        }

        private static void SetAlwaysIncluded(string shaderName, bool include, int index = -1)
        {
            var gs = GraphicsSettingsAsset;
            var so = new SerializedObject(gs);
            var prop = so.FindProperty(AlwaysIncludedProp);
            var keep = new List<UnityEngine.Object>();
            for (int i = 0; i < prop.arraySize; i++)
            {
                var o = prop.GetArrayElementAtIndex(i).objectReferenceValue;
                if (o != null && o.name != shaderName && !(o is Shader s && s.name == shaderName)) keep.Add(o);
                else if (o != null && include) keep.Add(o); // already present
            }
            if (include && !keep.Any(o => o is Shader s && s.name == shaderName))
            {
                var sh = Shader.Find(shaderName);
                if (sh != null) keep.Insert(index >= 0 && index <= keep.Count ? index : keep.Count, sh);
            }
            prop.arraySize = keep.Count;
            for (int i = 0; i < keep.Count; i++) prop.GetArrayElementAtIndex(i).objectReferenceValue = keep[i];
            so.ApplyModifiedProperties();
            AssetDatabase.SaveAssets();
        }

        private static void RestoreShader(BackupEntry e)
        {
            // Capture() recorded "<index>|<name>"; the path field holds the row path (shader name).
            var parts = e.data.Split('|');
            int.TryParse(parts[0], out var idx);
            SetAlwaysIncluded(parts.Length > 1 ? parts[1] : e.path, true, idx);
        }

        // --------------------------------------------------------------- fonts

        private const string TmpType = "TMP_FontAsset";

        /// <summary>
        /// Inventory of fonts with advice. The only automatic change: Clear Dynamic Data On Build for dynamic TMP font
        /// assets (drops glyphs cached in the editor from the build; they are re-generated at runtime).
        /// </summary>
        public static List<H5OptRow> ScanFonts()
        {
            var built = BuildSizes();
            var a = H5BuildAnalyzer.Load();
            var rows = new List<H5OptRow>();

            foreach (var guid in AssetDatabase.FindAssets("t:Font", new[] { "Assets" }))
            {
                var path = AssetDatabase.GUIDToAssetPath(guid);
                if (IsExcluded(path)) continue;
                long disk = FileLen(path);
                long inBuild = 0;
                if (a != null) { var hit = a.fonts.FirstOrDefault(x => x.path == path); if (hit != null) inBuild = hit.bytes; }
                var row = new H5OptRow { Path = path, DiskBytes = disk, BuildBytes = inBuild };
                row.Current = "Font file " + H5BuildAnalyzer.Format(disk);
                row.Advice = disk > 1024 * 1024
                    ? "Very large (likely a full CJK/Unicode font). Subset it to the characters you really use (pyftsubset / glyphhanger) and replace the file."
                    : disk > 300 * 1024 ? "Large. Consider subsetting to the languages you ship." : null;
                rows.Add(row);
            }

            foreach (var guid in AssetDatabase.FindAssets("t:" + TmpType, new[] { "Assets" }))
            {
                var path = AssetDatabase.GUIDToAssetPath(guid);
                if (IsExcluded(path)) continue;
                var obj = AssetDatabase.LoadMainAssetAtPath(path);
                if (obj == null) continue;
                var so = new SerializedObject(obj);
                int w = so.FindProperty("m_AtlasWidth")?.intValue ?? 0;
                int h = so.FindProperty("m_AtlasHeight")?.intValue ?? 0;
                int mode = so.FindProperty("m_AtlasPopulationMode")?.intValue ?? 0;   // 0 static, 1 dynamic
                int atlases = so.FindProperty("m_AtlasTextures")?.arraySize ?? 1;
                int chars = so.FindProperty("m_CharacterTable")?.arraySize ?? 0;
                var clear = so.FindProperty("m_ClearDynamicDataOnBuild");

                long inBuild = 0;
                if (a != null) { var hit = a.fonts.FirstOrDefault(x => x.path == path); if (hit != null) inBuild = hit.bytes; }
                var row = new H5OptRow { Path = path, DiskBytes = FileLen(path), BuildBytes = inBuild };
                row.Current = $"TMP {(mode == 1 ? "dynamic" : "static")}  atlas {w}x{h} x{atlases}  {chars} glyphs" +
                              (clear != null && mode == 1 ? $"  clear-on-build {(clear.boolValue ? "on" : "off")}" : "");
                if (w * h * atlases > 2048 * 2048) row.Advice = "Large atlas. Reduce sampling point size/padding or the character set and regenerate it.";
                if (atlases > 1 && mode == 0) row.Advice = "Several static atlases. Trim the character set so it fits one atlas.";
                if (mode == 1 && clear != null && !clear.boolValue)
                {
                    row.Proposed = "Clear Dynamic Data On Build = on";
                    row.Selected = true;
                    row.Apply = () => SetClearDynamic(path, true);
                    row.Capture = () => ((SerializedObject)new SerializedObject(AssetDatabase.LoadMainAssetAtPath(path))).FindProperty("m_ClearDynamicDataOnBuild").boolValue ? "1" : "0";
                }
                rows.Add(row);
            }
            return rows.OrderByDescending(r => r.SortBytes).ToList();
        }

        private static void SetClearDynamic(string path, bool value)
        {
            var obj = AssetDatabase.LoadMainAssetAtPath(path);
            if (obj == null) return;
            var so = new SerializedObject(obj);
            var p = so.FindProperty("m_ClearDynamicDataOnBuild");
            if (p == null) return;
            p.boolValue = value;
            so.ApplyModifiedProperties();
            EditorUtility.SetDirty(obj);
        }

        private static void RestoreFont(BackupEntry e) => SetClearDynamic(e.path, e.data == "1");
    }
}

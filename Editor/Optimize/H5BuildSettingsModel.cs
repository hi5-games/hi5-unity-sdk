using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.Build;
using UnityEngine;

namespace H5PlatformSDK.Editor.Optimize
{
    /// <summary>
    /// WebGL Player settings that matter for download size / load time, each with a recommended value.
    /// Nothing here is applied automatically: the Build Settings tab lets the developer pick any value and offers the recommended one.
    /// </summary>
    internal sealed class H5SettingItem
    {
        public string Title;
        public string Why;
        public Func<string> Current;
        public string Recommended;
        /// <summary>Values the user may pick (the first call to Set applies one). Recommended is always one of them.</summary>
        public string[] Options;
        public Action<string> Set;
        public bool IsOk => Current() == Recommended;
        public void Apply() => Set(Recommended);
    }

    internal static class H5BuildSettingsModel
    {
        private static readonly NamedBuildTarget Web = NamedBuildTarget.WebGL;

        /// <summary>
        /// The few options that are a real trade-off for a portal game. Everything else is either left at Unity's default
        /// or fixed by <see cref="ApplyReleaseInvariants"/> because a portal build is wrong without it.
        /// </summary>
        public static List<H5SettingItem> Items() => new List<H5SettingItem>
        {
            Enum("Compression format", "Brotli gives the smallest download. Gzip if the portal rejects .br files. Disabled only for testing.",
                () => PlayerSettings.WebGL.compressionFormat, v => PlayerSettings.WebGL.compressionFormat = v, WebGLCompressionFormat.Brotli),
            Enum("Managed stripping level", "Removes unused managed code. 'Medium' is the safe choice; 'High' is smaller but can break reflection-based code (test first).",
                () => PlayerSettings.GetManagedStrippingLevel(Web), v => PlayerSettings.SetManagedStrippingLevel(Web, v), ManagedStrippingLevel.Medium),
            Enum("IL2CPP code generation", "'OptimizeSize' reduces the .wasm size; 'OptimizeSpeed' is faster at run time but larger.",
                () => PlayerSettings.GetIl2CppCodeGeneration(Web), v => PlayerSettings.SetIl2CppCodeGeneration(Web, v), Il2CppCodeGeneration.OptimizeSize),
            Enum("Exception support", "'None' removes exception handling code (smaller/faster). Use 'ExplicitlyThrownExceptionsOnly' if the game relies on catching exceptions.",
                () => PlayerSettings.WebGL.exceptionSupport, v => PlayerSettings.WebGL.exceptionSupport = v, WebGLExceptionSupport.None),
            Toggle("Decompression fallback", "'On' adds a JS decompressor so the build loads on hosts that do not send a Content-Encoding header (most portals). " +
                "'Off' only if the portal serves the files with the right Content-Encoding (or requires fallback off): smaller loader and streamed .wasm.",
                () => PlayerSettings.WebGL.decompressionFallback, v => PlayerSettings.WebGL.decompressionFallback = v, true),
        };

        /// <summary>Requirements, not choices: a portal build must not be a development build and must use the Release IL2CPP
        /// configuration. Decompression fallback is a choice (see <see cref="Items"/>), kept as set in Player Settings.</summary>
        public static void ApplyReleaseInvariants()
        {
            EditorUserBuildSettings.development = false;
            PlayerSettings.SetIl2CppCompilerConfiguration(Web, Il2CppCompilerConfiguration.Release);
        }

        private static H5SettingItem Toggle(string title, string why, Func<bool> get, Action<bool> set, bool recommended) => new H5SettingItem
        {
            Title = title, Why = why,
            Current = () => get() ? "On" : "Off", Recommended = recommended ? "On" : "Off",
            Options = new[] { "On", "Off" }, Set = v => set(v == "On"),
        };

        private static H5SettingItem Enum<T>(string title, string why, Func<T> get, Action<T> set, T recommended) where T : struct, System.Enum => new H5SettingItem
        {
            Title = title, Why = why,
            Current = () => get().ToString(), Recommended = recommended.ToString(),
            Options = System.Enum.GetNames(typeof(T)), Set = v => set((T)System.Enum.Parse(typeof(T), v)),
        };

        public static int CountNotOk()
        {
            int n = 0;
            foreach (var i in Items()) if (!i.IsOk) n++;
            return n;
        }

        /// <summary>Applies every recommended value. Returns the number of settings changed.</summary>
        public static int ApplyAll()
        {
            int n = 0;
            foreach (var i in Items()) if (!i.IsOk) { i.Apply(); n++; }
            AssetDatabase.SaveAssets();
            return n;
        }
    }
}

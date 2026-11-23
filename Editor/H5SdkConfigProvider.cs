using System.IO;
using UnityEditor;
using UnityEngine;

namespace H5PlatformSDK.Editor
{
    internal static class H5SdkConfigProvider
    {
        private const string ResourceFolder = H5Paths.ProjectResourcesFolder;
        private const string AssetPath = ResourceFolder + "/H5SdkConfig.asset";

        public static H5SdkConfig GetOrCreateDefault()
        {
            var config = AssetDatabase.LoadAssetAtPath<H5SdkConfig>(AssetPath);
            if (config != null) return config;

            if (!Directory.Exists(ResourceFolder))
            {
                Directory.CreateDirectory(ResourceFolder);
            }

            config = ScriptableObject.CreateInstance<H5SdkConfig>();
            AssetDatabase.CreateAsset(config, AssetPath);
            AssetDatabase.SaveAssets();
            return config;
        }
    }
}

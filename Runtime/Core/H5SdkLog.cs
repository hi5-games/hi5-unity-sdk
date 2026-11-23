using UnityEngine;

namespace H5PlatformSDK.Core
{
    internal static class H5SdkLog
    {
        public static bool Verbose = true;

        public static void Info(string message)
        {
            if (Verbose)
            {
                Debug.Log("[H5PlatformSDK] " + message);
            }
        }

        public static void Warn(string message)
        {
            Debug.LogWarning("[H5PlatformSDK] " + message);
        }

        public static void Error(string message)
        {
            Debug.LogError("[H5PlatformSDK] " + message);
        }
    }
}

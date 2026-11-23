using H5PlatformSDK.Bridges;
using UnityEngine;

namespace H5PlatformSDK.Bootstrap
{
    /// <summary>
    /// Binds the platform bridge before the first scene loads. In a WebGL player this is
    /// <see cref="H5PlatformSDK.Bridges.Js.H5JsBridgeManager"/>, which talks to window.H5 (the JS runtime and
    /// portal adapter injected by the H5 Packager); in the Editor it is the Null simulation.
    /// There is no per-platform branching here - the portal is chosen at package time.
    /// </summary>
    internal static class H5SdkBootstrapper
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Bootstrap()
        {
            var config = Resources.Load<H5SdkConfig>("H5SdkConfig");
            var go = new GameObject("H5PlatformSDK.Bridge");

#if UNITY_WEBGL && !UNITY_EDITOR
            var bridge = go.AddComponent<H5PlatformSDK.Bridges.Js.H5JsBridgeManager>();
#else
            var bridge = go.AddComponent<NullBridgeManager>();
#endif
            H5SDK.Bind(bridge, config);
        }
    }
}

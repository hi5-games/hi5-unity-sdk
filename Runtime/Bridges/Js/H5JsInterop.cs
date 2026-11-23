#if UNITY_WEBGL && !UNITY_EDITOR
using System.Runtime.InteropServices;

namespace H5PlatformSDK.Bridges.Js
{
    /// <summary>Raw externs matching Assets/Plugins/H5PlatformSDK/Core/h5sdk.jslib. Use H5SDK instead.</summary>
    internal static class H5JsInterop
    {
        [DllImport("__Internal")] public static extern void H5_Init(string callbackGameObjectName);
        [DllImport("__Internal")] public static extern void H5_Call(string method, string argsJson, int callId);
    }
}
#endif

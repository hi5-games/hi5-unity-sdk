namespace H5PlatformSDK.Bridges
{
    /// <summary>
    /// Used in the Editor and in any build where none of the platform defines
    /// is bound (Editor / Play Mode).
    /// Every call is a safe, logged simulation - inherited as-is from the base class.
    /// </summary>
    public class NullBridgeManager : H5BridgeManagerBase
    {
        public override H5Platform Platform => H5Platform.None;
    }
}

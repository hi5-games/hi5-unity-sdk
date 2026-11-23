using UnityEditor;
using UnityEditor.UIElements;
using UnityEngine.UIElements;

namespace H5PlatformSDK.Editor.Window
{
    public sealed partial class H5SdkWindow
    {
        /// <summary>The only runtime option left from the old Settings tab; it lives with the build options now.</summary>
        private VisualElement BuildRuntimeCard()
        {
            var card = new VisualElement(); card.AddToClassList("h5-card");
            var so = new SerializedObject(_config);
            var pf = new PropertyField(so.FindProperty("verboseLogging")); pf.Bind(so);
            card.Add(pf);
            card.Add(Label("Writes SDK log lines to the browser console. Turn off for release.", "h5-sub"));
            return card;
        }
    }
}

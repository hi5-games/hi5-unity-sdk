#if DEVELOPMENT_BUILD || UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Reflection;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace H5PlatformSDK
{
    /// <summary>
    /// Test hooks for the H5 QA tool's scenario runner (`h5-packager qa --tests`). Development builds and the Editor only;
    /// release builds do not contain this class. Commands arrive only when the game runs inside the QA tool (adapter "qa").
    ///
    /// Built-in commands (work in any game, no game code needed):
    ///   scene                      -> active scene name
    ///   timeScale                  -> Time.timeScale
    ///   exists:&lt;GameObjectName&gt;   -> "true"/"false": an active GameObject with that name exists
    ///   tap:&lt;GameObjectName&gt;      -> invokes onClick of the first active, interactable Button with that name
    ///   call:&lt;Component&gt;.&lt;Method&gt; -> calls a public parameterless method on the first active component of that type
    ///                                 (e.g. call:GamePlayManager.WinLevel, call:PopupWinLose.OnNextBtnClick)
    /// Games add their own with <see cref="Register"/> (e.g. "setCoin", "state").
    /// </summary>
    public static class H5QAHooks
    {
        private static readonly Dictionary<string, Func<string, string>> _commands = new Dictionary<string, Func<string, string>>();

        /// <summary>Adds or replaces a command. The handler gets the text after "name:" (or "") and returns a result string.</summary>
        public static void Register(string name, Func<string, string> handler)
        {
            if (!string.IsNullOrEmpty(name) && handler != null) _commands[name] = handler;
        }

        /// <summary>True when a game command with this name is registered.</summary>
        public static bool Has(string name) => name != null && _commands.ContainsKey(name);

        /// <summary>Runs "name" or "name:arg". Throws on unknown commands or failures (the QA tool reports the message).</summary>
        public static string Execute(string command)
        {
            if (string.IsNullOrEmpty(command)) throw new ArgumentException("empty command");
            int colon = command.IndexOf(':');
            string name = colon < 0 ? command : command.Substring(0, colon);
            string arg = colon < 0 ? "" : command.Substring(colon + 1);

            if (_commands.TryGetValue(name, out var custom)) return custom(arg) ?? "";
            switch (name)
            {
                case "scene": return SceneManager.GetActiveScene().name;
                case "timeScale": return Time.timeScale.ToString(System.Globalization.CultureInfo.InvariantCulture);
                case "exists": return (FindActive(arg) != null) ? "true" : "false";
                case "tap": return Tap(arg);
                case "call": return Call(arg);
                default: throw new InvalidOperationException("unknown QA command '" + name + "'");
            }
        }

        private static GameObject FindActive(string name)
        {
            foreach (var t in UnityEngine.Object.FindObjectsByType<Transform>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
                if (t.name == name && t.gameObject.activeInHierarchy) return t.gameObject;
            return null;
        }

        // UnityEngine.UI.Button via reflection, so the SDK assembly does not depend on uGUI.
        private static string Tap(string name)
        {
            foreach (var t in UnityEngine.Object.FindObjectsByType<Transform>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
            {
                if (t.name != name || !t.gameObject.activeInHierarchy) continue;
                foreach (var c in t.GetComponents<Component>())
                {
                    if (c == null) continue;
                    var type = c.GetType();
                    var onClick = type.GetProperty("onClick", BindingFlags.Public | BindingFlags.Instance);
                    if (onClick == null) continue;
                    var interactable = type.GetProperty("interactable", BindingFlags.Public | BindingFlags.Instance);
                    if (interactable != null && !(bool)interactable.GetValue(c)) throw new InvalidOperationException("'" + name + "' is not interactable");
                    var evt = onClick.GetValue(c);
                    evt.GetType().GetMethod("Invoke", Type.EmptyTypes).Invoke(evt, null);
                    return "tapped";
                }
            }
            throw new InvalidOperationException("no active button '" + name + "'");
        }

        private static string Call(string spec)
        {
            int dot = spec.LastIndexOf('.');
            if (dot <= 0) throw new ArgumentException("use call:Component.Method");
            string typeName = spec.Substring(0, dot), method = spec.Substring(dot + 1);
            foreach (var mb in UnityEngine.Object.FindObjectsByType<MonoBehaviour>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
            {
                var type = mb.GetType();
                if (type.Name != typeName && type.FullName != typeName) continue;
                var m = type.GetMethod(method, BindingFlags.Public | BindingFlags.Instance, null, Type.EmptyTypes, null);
                if (m == null) throw new MissingMethodException(typeName, method);
                var r = m.Invoke(mb, null);
                return r == null ? "called" : r.ToString();
            }
            throw new InvalidOperationException("no active component '" + typeName + "'");
        }
    }
}
#endif

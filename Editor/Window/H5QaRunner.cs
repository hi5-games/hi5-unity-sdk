using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using H5PlatformSDK.Editor.Optimize;
using UnityEditor;
using UnityEngine;

namespace H5PlatformSDK.Editor.Window
{
    /// <summary>
    /// Starts and stops the local QA tool (`h5-packager qa`) for the last neutral build.
    /// The server lives as long as the Editor session; it is stopped on quit and before a script reload.
    /// </summary>
    internal static class H5QaRunner
    {
        private static Process _proc;

        public static string Url { get; private set; }

        public static bool Running => _proc != null && !_proc.HasExited;

        [InitializeOnLoadMethod]
        private static void Init()
        {
            AssemblyReloadEvents.beforeAssemblyReload += Stop;
            EditorApplication.quitting += Stop;
        }

        /// <summary>Folder of the last successful neutral build of THIS project, or null.</summary>
        public static string FindBuildDir()
        {
            var a = H5BuildAnalyzer.Load();
            if (a == null || !a.succeeded || string.IsNullOrEmpty(a.folder)) return null;
            return File.Exists(Path.Combine(a.folder, "index.html")) ? a.folder : null;
        }

        /// <summary>Starts the QA server and opens it in the browser. Returns an error message, or null on success.</summary>
        public static string Start(string buildDir)
        {
            if (Running) return null;
            var node = H5PackagerRunner.FindNode();
            if (node == null) return "Node.js 18+ was not found. Install it (nodejs.org or `brew install node`) and try again.";
            if (string.IsNullOrEmpty(buildDir) || !File.Exists(Path.Combine(buildDir, "index.html")))
                return "No neutral build found. Run Build & Analyze first.";

            int port = FreePort();
            var cli = Path.GetFullPath(H5PackagerRunner.CliPath);
            var psi = new ProcessStartInfo(node, $"\"{cli}\" qa --in \"{buildDir}\" --port {port} --open")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = H5Paths.ProjectDir,
            };
            try { _proc = Process.Start(psi); }
            catch (Exception e) { return "Could not start the QA tool: " + e.Message; }
            Url = "http://localhost:" + port;
            return null;
        }

        public static void Stop()
        {
            try { if (_proc != null && !_proc.HasExited) _proc.Kill(); }
            catch (Exception) { }
            _proc = null;
            Url = null;
        }

        private static int FreePort()
        {
            var l = new TcpListener(IPAddress.Loopback, 0);
            l.Start();
            int port = ((IPEndPoint)l.LocalEndpoint).Port;
            l.Stop();
            return port;
        }
    }
}

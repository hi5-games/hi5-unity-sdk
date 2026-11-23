mergeInto(LibraryManager.library, {

  // Single, platform-agnostic C# <-> JS surface. The page's window.H5 runtime (h5-bridge.js,
  // injected by the H5 Packager together with the adapter for the target portal) does the
  // portal-specific work. Without window.H5 (raw neutral build) everything degrades to a
  // harmless simulation so the build still runs.
  H5_Init: function (goPtr) {
    var go = UTF8ToString(goPtr);
    var send = function (msg) { SendMessage(go, 'OnH5Message', JSON.stringify(msg)); };
    window.__h5Send = send;
    if (window.H5 && window.H5.attach) {
      window.H5.attach(send);
    } else {
      send({ type: 'ready', platform: 'none' });
    }
  },

  H5_Call: function (methodPtr, argsPtr, callId) {
    var method = UTF8ToString(methodPtr);
    var args = {};
    try { args = JSON.parse(UTF8ToString(argsPtr) || '{}'); } catch (e) {}
    try {
      if (window.H5 && window.H5.call) {
        window.H5.call(method, args, callId);
      } else if (callId > 0 && window.__h5Send) {
        window.__h5Send({ type: 'result', id: callId, ok: true, value: method === 'showRewarded' ? '1' : '' });
      }
    } catch (e) {
      console.error('[H5] call failed', method, e);
      if (callId > 0 && window.__h5Send) window.__h5Send({ type: 'result', id: callId, ok: false, value: '' });
    }
  }

});

'use strict';
// Headless Chrome for `qa --headless`: launch + a minimal DevTools Protocol client (screenshots only).
// The protocol client needs the global WebSocket (Node 22+); on older Node the run works without screenshots.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

function findChrome(explicit) {
  const list = [explicit, process.env.CHROME_PATH];
  if (process.platform === 'darwin') {
    list.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser');
  } else if (process.platform === 'win32') {
    for (const base of [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)) {
      list.push(path.join(base, 'Google/Chrome/Application/chrome.exe'), path.join(base, 'Microsoft/Edge/Application/msedge.exe'));
    }
  } else {
    for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) {
      try { list.push(execFileSync('which', [n], { encoding: 'utf8' }).trim()); } catch (_) { /* not installed */ }
    }
  }
  return list.find(p => p && fs.existsSync(p)) || null;
}

async function launch(chromePath, url) {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'h5qa-chrome-'));
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--window-size=1920,1500', '--hide-scrollbars'];
  // Linux CI machines usually have no GPU; SwiftShader keeps WebGL working there.
  if (process.platform === 'linux') args.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist');
  args.push(url);
  const proc = spawn(chromePath, args, { stdio: 'ignore' });
  const kill = () => { try { proc.kill(); } catch (_) {} try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (_) {} };

  // Chrome writes the chosen port to DevToolsActivePort.
  let port = null;
  for (let i = 0; i < 100 && !port; i++) {
    await new Promise(r => setTimeout(r, 100));
    try { port = Number(fs.readFileSync(path.join(userDir, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch (_) { /* not yet */ }
  }
  let cdp = null;
  if (port && typeof WebSocket !== 'undefined') {
    try {
      let page = null;
      for (let i = 0; i < 50 && !page; i++) {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        page = list.find(t => t.type === 'page' && t.url.startsWith(url.split('?')[0]));
        if (!page) await new Promise(r => setTimeout(r, 100));
      }
      if (page) cdp = await connect(page.webSocketDebuggerUrl);
    } catch (_) { cdp = null; }
  }
  return { proc, kill, cdp };
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0; const waiting = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString());
      if (m.id && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); m.error ? w.reject(new Error(m.error.message)) : w.resolve(m.result); }
    };
    ws.onerror = () => reject(new Error('DevTools connection failed'));
    ws.onopen = () => resolve({
      send: (method, params) => new Promise((res, rej) => { id++; waiting.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method, params: params || {} })); }),
      close: () => { try { ws.close(); } catch (_) {} },
    });
  });
}

async function screenshot(cdp, clip, file) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', clip: Object.assign({ scale: 1 }, clip), captureBeyondViewport: false });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  return file;
}

module.exports = { findChrome, launch, screenshot };

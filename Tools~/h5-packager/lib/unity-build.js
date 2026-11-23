'use strict';
// Runs the neutral WebGL build headless: Unity -batchmode -executeMethod H5PlatformSDK.Editor.H5BuildCI.Build
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function projectVersion(project) {
  const f = path.join(project, 'ProjectSettings', 'ProjectVersion.txt');
  if (!fs.existsSync(f)) throw new Error(`Not a Unity project (missing ${f})`);
  const m = fs.readFileSync(f, 'utf8').match(/m_EditorVersion:\s*(\S+)/);
  if (!m) throw new Error('Cannot read m_EditorVersion from ProjectVersion.txt');
  return m[1];
}

/** Unity Hub default install locations. --unity overrides. */
function findUnity(version) {
  const candidates = process.platform === 'darwin'
    ? [`/Applications/Unity/Hub/Editor/${version}/Unity.app/Contents/MacOS/Unity`]
    : process.platform === 'win32'
      ? [`C:\\Program Files\\Unity\\Hub\\Editor\\${version}\\Editor\\Unity.exe`]
      : [path.join(process.env.HOME || '', `Unity/Hub/Editor/${version}/Editor/Unity`)];
  return candidates.find(c => fs.existsSync(c)) || null;
}

function build(opts) {
  const project = path.resolve(opts.project || '.');
  const version = projectVersion(project);
  const unity = opts.unity || findUnity(version);
  if (!unity) throw new Error(`Unity ${version} not found in the Unity Hub folder. Install it, or pass --unity <path to the Unity binary>.`);
  if (fs.existsSync(path.join(project, 'Temp', 'UnityLockfile'))) {
    // The lock file exists while an Editor has the project open; batchmode on the same project fails.
    console.error('WARN: Temp/UnityLockfile exists - close the Unity Editor on this project first (batchmode cannot open a project that is already open).');
  }
  const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  const out = opts.out || path.join('Builds', 'None', 'WEBGL_' + stamp); // local time, same as the window's Build button
  const log = path.resolve(project, opts.log || path.join('Builds', 'unity-build.log'));
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const args = ['-batchmode', '-projectPath', project, '-buildTarget', 'WebGL',
    '-executeMethod', 'H5PlatformSDK.Editor.H5BuildCI.Build', '-logFile', log, '-h5Out', out];
  if (opts.development) args.push('-h5Development');
  console.log(`Unity ${version}: ${unity}\nLog: ${log}\nBuilding -> ${out} ...`);
  const t0 = Date.now();
  return new Promise((resolve) => {
    const p = spawn(unity, args, { stdio: 'ignore' });
    p.on('error', (e) => resolve({ ok: false, errors: ['Could not start Unity: ' + e.message], log }));
    p.on('exit', (code) => {
      const resultFile = path.join(project, 'Builds', 'last-build.json');
      let r = { ok: false, errors: [`Unity exited with code ${code}; no Builds/last-build.json. See ${log}`] };
      try {
        const j = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
        if (fs.statSync(resultFile).mtimeMs >= t0) r = j;
      } catch (e) { /* keep default */ }
      if (code !== 0 && r.ok) r = Object.assign({}, r, { ok: false, errors: [`Unity exited with code ${code}`] });
      r.log = log;
      r.seconds = Math.round((Date.now() - t0) / 1000);
      resolve(r);
    });
  });
}

module.exports = { build, projectVersion, findUnity };

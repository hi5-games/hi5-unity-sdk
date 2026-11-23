#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { run, stage, validateInput, PLATFORMS, ALL_PROFILES } = require('../lib/packager');
const { createServer, listen, lanAddresses } = require('../lib/serve');
let internal = { usage: '', handle() { return false; } };
try { internal = require('../lib/internal-commands'); } catch (e) { /* not part of every edition */ }

function parse(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const k = t.slice(2);
      if (['json', 'development', 'open', 'quiet', 'headless'].includes(k)) a[k] = true; else a[k] = argv[++i];
    } else a._.push(t);
  }
  return a;
}

function usage() {
  console.log(`h5-packager <command> [options]

Commands:
  package   --in <webgl-build-dir> --platform <a,b|all> --out <dir> [--config h5-config.json] [--name Game] [--version 1.0.0] [--json]
  validate  --in <webgl-build-dir> [--json]
  list      [--json]
${internal.usage}  build     [--project .] [--out Builds/None/WEBGL_<time>] [--development] [--unity <Unity binary>] [--log <file>] [--json]
            Neutral WebGL build in Unity batchmode (close the Editor on that project first).
  serve     --dir <folder> [--port 8080] [--host 127.0.0.1]
            Static server with real Content-Encoding headers for .unityweb/.br/.gz.
  qa        --in <webgl-build-dir> [--port 8080] [--host 127.0.0.1] [--open] [--report qa-report.json]
            Packages the build with the internal QA adapter and serves the H5 QA tool.
            --headless [--timeout 90] [--chrome <path>]: automatic run in headless Chrome, writes the report and
            screenshots (qa-screens/ next to the report), exit code 1 if any check fails.
            --tests <h5-tests.json> [--only id1,id2]: also run scenario tests (development build); see QA-Tool.md.

Platforms: ${PLATFORMS.join(', ')}
Exit codes: 0 ok, 1 package/validation failed, 2 usage error.`);
}

function out(a, obj, text) { console.log(a.json ? JSON.stringify(obj, null, 2) : text); }

const a = parse(process.argv.slice(2));
const cmd = a._[0];
try {
  if (cmd === 'list') { out(a, PLATFORMS, PLATFORMS.join('\n')); process.exit(0); }
  if (internal.handle(cmd, a)) process.exit(0);
  if (cmd === 'validate') {
    if (!a.in) { usage(); process.exit(2); }
    const extra = { warnings: [] };
    const errors = validateInput(path.resolve(a.in), extra);
    extra.warnings.forEach(w => console.error('WARN: ' + w));
    out(a, { ok: !errors.length, errors }, errors.length ? errors.join('\n') : 'OK');
    process.exit(errors.length ? 1 : 0);
  }
  if (cmd === 'package') {
    if (!a.in || !a.platform || !a.out) { usage(); process.exit(2); }
    const platforms = a.platform === 'all' ? PLATFORMS : a.platform.split(',').map(s => s.trim()).filter(Boolean);
    let config = {};
    if (a.config) {
      if (!fs.existsSync(a.config)) { console.error('ERROR: config file not found: ' + a.config); process.exit(2); }
      try { config = JSON.parse(fs.readFileSync(a.config, 'utf8')); } catch (e) { console.error(`ERROR: ${a.config} is not valid JSON (${e.message})`); process.exit(2); }
    }
    const unknown = platforms.filter(p => !ALL_PROFILES.includes(p));
    if (unknown.length) { console.error(`ERROR: unknown platform '${unknown.join(',')}'. Available: ${PLATFORMS.join(', ')}`); process.exit(2); }
    const report = run({ in: path.resolve(a.in), out: path.resolve(a.out), platforms, config, name: a.name || 'game', version: a.version || '1.0.0' });
    if (a.json) console.log(JSON.stringify(report, null, 2));
    else {
      if (report.errors) report.errors.forEach(e => console.error('ERROR: ' + e));
      (report.warnings || []).forEach(w => console.error('WARN: ' + w));
      for (const r of report.results) {
        if (r.ok) console.log(`OK   ${r.platform}: ${r.zip} (${(r.sizeBytes / 1048576).toFixed(2)} MB, ${r.files} files)`);
        else console.error(`FAIL ${r.platform}:\n  - ` + r.errors.join('\n  - '));
      }
    }
    process.exit(report.ok ? 0 : 1);
  }
  if (cmd === 'build') {
    require('../lib/unity-build').build({ project: a.project, out: a.out, development: a.development, unity: a.unity, log: a.log }).then((r) => {
      if (a.json) console.log(JSON.stringify(r, null, 2));
      else if (r.ok) console.log(`OK   neutral build -> ${r.path} (${(r.sizeBytes / 1048576).toFixed(2)} MB, ${r.seconds}s)`);
      else console.error('FAIL build:\n  - ' + (r.errors || []).join('\n  - ') + `\n  log: ${r.log}`);
      process.exit(r.ok ? 0 : 1);
    });
    return;
  }
  if (cmd === 'serve') {
    if (!a.dir) { usage(); process.exit(2); }
    const server = createServer({ mounts: [{ prefix: '/', dir: a.dir }], onRequest: a.quiet ? null : (r) => console.log(`${r.status} ${r.url}${r.encoding ? '  [' + r.encoding + ']' : ''}`) });
    listen(server, a.host || '127.0.0.1', Number(a.port || 8080)).then((port) => printUrls(a.host, port, '/'));
    return;
  }
  if (cmd === 'qa') { qa(a); return; }
  usage(); process.exit(2);
} catch (e) {
  console.error('h5-packager error: ' + e.message);
  process.exit(1);
}

function printUrls(host, port, p) {
  console.log(`Serving on http://localhost:${port}${p}`);
  if (host === '0.0.0.0') for (const ip of lanAddresses()) console.log(`  LAN (phone on the same Wi-Fi): http://${ip}:${port}${p}`);
}

function qa(a) {
  if (!a.in) { usage(); process.exit(2); }
  const inDir = path.resolve(a.in);
  const out = path.join(os.tmpdir(), 'h5qa-' + require('crypto').createHash('sha1').update(inDir).digest('hex').slice(0, 10));
  const r = stage({ in: inDir, out, config: {}, name: 'qa', version: '0' }, 'qa');
  (r.warnings || []).forEach(w => console.error('WARN: ' + w));
  if (!r.ok) { console.error('FAIL qa package:\n  - ' + r.errors.join('\n  - ')); process.exit(1); }
  const html = fs.readFileSync(path.join(r.dir, 'index.html'), 'utf8');
  const title = ((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || path.basename(inDir)).trim();
  const buildFiles = fs.readdirSync(path.join(r.dir, 'Build')).map(n => ({ name: n, size: fs.statSync(path.join(r.dir, 'Build', n)).size }));
  const reportPath = path.resolve(a.report || 'qa-report.json');
  const shotsDir = path.join(path.dirname(reportPath), 'qa-screens');
  let chrome = null;
  const info = { name: title, buildDir: inDir, buildFiles, tool: require('../package.json').version };
  let tests = null;
  if (a.tests) {
    try { tests = JSON.parse(fs.readFileSync(path.resolve(a.tests), 'utf8')); }
    catch (e) { console.error(`Cannot read --tests ${a.tests}: ${e.message}`); process.exit(2); }
  }
  const api = (req, res, url) => {
    if (url.pathname === '/__qa/tests') {
      if (!tests) { res.writeHead(404); res.end(); return true; }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(tests)); return true;
    }
    if (url.pathname === '/__qa/info') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(info)); return true; }
    if (url.pathname === '/__qa/report' && req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        let rep;
        try { rep = JSON.parse(body); fs.writeFileSync(reportPath, body); res.writeHead(200); res.end(JSON.stringify({ path: reportPath })); console.log('Report saved: ' + reportPath); }
        catch (e) { res.writeHead(400); res.end('invalid json'); return; }
        if (a.headless && url.searchParams.get('final') === '1') finishHeadless(rep);
      });
      return true;
    }
    if (url.pathname === '/__qa/progress') { if (a.headless) console.log('  · ' + url.searchParams.get('msg')); res.writeHead(204); res.end(); return true; }
    if (url.pathname === '/__qa/screenshot') {
      if (!chrome || !chrome.cdp) { res.writeHead(501); res.end(); return true; }
      const n = (url.searchParams.get('name') || 'shot').replace(/[^A-Za-z0-9._-]+/g, '_');
      const clip = { x: +url.searchParams.get('x'), y: +url.searchParams.get('y'), width: +url.searchParams.get('w'), height: +url.searchParams.get('h') };
      require('../lib/chrome').screenshot(chrome.cdp, clip, path.join(shotsDir, n + '.png'))
        .then((f) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ file: path.relative(path.dirname(reportPath), f) })); })
        .catch((e) => { res.writeHead(500); res.end(e.message); });
      return true;
    }
    return false;
  };
  const seen = new Set();
  const server = createServer({
    mounts: [{ prefix: '/game/', dir: r.dir }, { prefix: '/', dir: path.join(__dirname, '..', 'qa-tool') }], api,
    onRequest: (q) => { if (!a.headless && q.url.startsWith('/game/Build/') && !seen.has(q.url)) { seen.add(q.url); console.log(`  ${q.url.slice(6)}  Content-Encoding: ${q.encoding || 'none'}`); } }
  });

  function finishHeadless(rep) {
    const icon = { pass: 'PASS', fail: 'FAIL', warn: 'WARN', pending: '-   ', manual: 'MAN ' };
    console.log('');
    for (const c of rep.checks) console.log(`${icon[c.status] || c.status} ${c.title}${c.detail ? '  (' + c.detail + ')' : ''}`);
    const n = (s) => rep.checks.filter(c => c.status === s).length;
    console.log(`\n${n('pass')} pass, ${n('fail')} fail, ${n('warn')} warn, ${n('pending') + n('manual')} need gameplay/manual checks`);
    const tr = rep.tests || [];
    const tfail = tr.filter(t => t.status !== 'pass');
    if (tr.length) {
      console.log(`\nScenario tests: ${tr.length - tfail.length}/${tr.length} pass`);
      for (const t of tr) console.log(`${t.status === 'pass' ? 'PASS' : 'FAIL'} ${t.id} (${t.seconds}s)${t.failures.length ? '\n     - ' + t.failures.join('\n     - ') : ''}`);
    }
    if (rep.screenshots && rep.screenshots.length) console.log(`Screenshots: ${shotsDir}`);
    else if (chrome && !chrome.cdp) console.log('Screenshots skipped (needs Node 22+).');
    console.log(`Report: ${reportPath}`);
    if (chrome) chrome.kill();
    server.close();
    process.exit(n('fail') || tfail.length ? 1 : 0);
  }
  listen(server, a.host || '127.0.0.1', Number(a.headless && !a.port ? 0 : a.port || 8080)).then(async (port) => {
    if (a.headless) {
      const ch = require('../lib/chrome');
      const exe = ch.findChrome(a.chrome);
      if (!exe) { console.error('Chrome/Edge not found. Install Google Chrome or pass --chrome <path>.'); process.exit(2); }
      const loadSec = Number(a.timeout || 90);
      console.log(`H5 QA headless run for "${title}" (${exe})`);
      const q = `auto=1&timeout=${loadSec}` + (tests ? '&tests=1' : '') + (a.only ? '&only=' + encodeURIComponent(a.only) : '');
      chrome = await ch.launch(exe, `http://127.0.0.1:${port}/?${q}`);
      if (!chrome.cdp) console.log('  (no DevTools connection: screenshots skipped - needs Node 22+)');
      const limit = loadSec * 2 + 90 + (tests ? (tests.tests || []).length * 150 : 0);
      setTimeout(() => { console.error(`FAIL: headless run did not finish within ${limit}s`); chrome.kill(); process.exit(1); }, limit * 1000).unref();
      return;
    }
    console.log(`H5 QA tool for "${title}"`);
    printUrls(a.host, port, '/');
    console.log('  Game only (e.g. for a phone): /game/');
    if (a.open) { const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'; require('child_process').exec(`${opener} http://localhost:${port}/`); }
  }).catch((e) => { console.error(`Cannot listen on port ${a.port || 8080}: ${e.message}. Use --port.`); process.exit(1); });
}

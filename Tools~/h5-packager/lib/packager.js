'use strict';
const fs = require('fs');
const path = require('path');
const { zipDirectory, listFiles } = require('./zip');

const TOOL_ROOT = path.resolve(__dirname, '..');
const ALL_PROFILES = fs.readdirSync(path.join(TOOL_ROOT, 'profiles')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
const isInternal = (id) => { try { return !!JSON.parse(fs.readFileSync(path.join(TOOL_ROOT, 'profiles', id + '.json'), 'utf8')).internal; } catch (e) { return false; } };
// Portal profiles (`--platform all`, `list`). Internal profiles (qa) can still be named explicitly.
const PLATFORMS = ALL_PROFILES.filter(id => !isInternal(id));

const getPath = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const readTool = (rel) => fs.readFileSync(path.join(TOOL_ROOT, rel), 'utf8');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

// Names that only exist when game code still calls a portal SDK directly (C# wrapper -> jslib).
// Found inside the Unity framework file => the build is NOT neutral.
const FORBIDDEN_FRAMEWORK_SYMBOLS = [
  ['getInterstitialState', 'portal C# package (Bridge.*) - use H5SDK instead'],
  ['CrazyGames.SDK', 'CrazyGames SDK wrapper - use H5SDK instead'],
  ['YG2', 'PluginYG2 - use H5SDK instead'],
  ['crazygames-sdk-v3.js', 'CrazyGames Unity SDK jslib - use H5SDK instead'],
  ['YaGames', 'Yandex SDK wrapper - use H5SDK instead'],
  ['MiniGameAds', 'MiniGame SDK wrapper - use H5SDK instead'],
  ['y8.min.js', 'Y8 SDK wrapper - use H5SDK instead'],
  ['GDSDK', 'GameDistribution wrapper - use H5SDK instead'],
  ['html5.api.gamedistribution.com', 'GameDistribution Unity SDK - use H5SDK instead'],
  ['api.gamemonetize.com', 'GameMonetize Unity SDK - use H5SDK instead'],
];

// Portal-specific rules live in lib/compat-portals.js (internal edition only). Without that file only the generic rules apply.
let portalRules = { EXTRA_FORBIDDEN: [], checks: {} };
try { portalRules = require('./compat-portals'); } catch (e) { /* partner edition */ }
FORBIDDEN_FRAMEWORK_SYMBOLS.push(...portalRules.EXTRA_FORBIDDEN);

function readMaybeCompressed(file) {
  const zlib = require('zlib');
  let buf = fs.readFileSync(file);
  if (!/\.(unityweb|br|gz)$/.test(file)) return buf.toString('latin1');
  try { return zlib.brotliDecompressSync(buf).toString('latin1'); } catch (e) { /* not brotli */ }
  try { return zlib.gunzipSync(buf).toString('latin1'); } catch (e) { /* not gzip */ }
  return buf.toString('latin1'); // stored uncompressed (.unityweb with compression off)
}

/** Scans Build/*.framework.js* for leftover portal-SDK glue. Returns {errors, warnings}. */
function scanFramework(inDir) {
  const out = { errors: [], warnings: [] };
  const buildDir = path.join(inDir, 'Build');
  if (!fs.existsSync(buildDir)) return out;
  const frameworks = fs.readdirSync(buildDir).filter(f => /\.framework\.js(\.unityweb|\.br|\.gz)?$/.test(f));
  if (!frameworks.length) { out.warnings.push('No *.framework.js found in Build/; cannot check for leftover portal SDK code.'); return out; }
  for (const f of frameworks) {
    const text = readMaybeCompressed(path.join(buildDir, f));
    for (const [sym, hint] of FORBIDDEN_FRAMEWORK_SYMBOLS) {
      if (text.includes(sym)) out.errors.push(`Build/${f} references '${sym}' - game code still calls a portal SDK directly (${hint}).`);
    }
  }
  return out;
}

function validateInput(inDir, extra) {
  const errors = [];
  if (!fs.existsSync(inDir) || !fs.statSync(inDir).isDirectory()) return [`Input folder not found: ${inDir}`];
  const index = path.join(inDir, 'index.html');
  if (!fs.existsSync(index)) { errors.push('index.html not found in input folder. Point --in at the WebGL build folder (the one that contains index.html and Build/).'); return errors; }
  const buildDir = path.join(inDir, 'Build');
  if (!fs.existsSync(buildDir)) errors.push('Build/ folder not found.');
  else {
    const names = fs.readdirSync(buildDir);
    for (const [label, re] of [['loader (*.loader.js)', /\.loader\.js$/], ['framework (*.framework.js*)', /\.framework\.js/], ['wasm (*.wasm*)', /\.wasm/], ['data (*.data*)', /\.data/]]) {
      if (!names.some(n => re.test(n))) errors.push(`Build/ has no ${label} file - the build looks incomplete.`);
    }
  }
  const html = fs.readFileSync(index, 'utf8');
  for (const m of ['<!-- H5:HEAD -->', '<!-- H5:BODY_END -->']) {
    if (!html.includes(m)) errors.push(`index.html is missing marker ${m} - either this is an already-packaged build (package from the neutral build output) or it was not built with the H5Neutral WebGL template (Project Settings > Player > WebGL > Resolution and Presentation > H5Neutral).`);
  }
  const fw = scanFramework(inDir);
  errors.push(...fw.errors);
  if (extra && extra.warnings) extra.warnings.push(...fw.warnings);
  return errors;
}

function packageOne(opts, platform) {
  const result = { platform, ok: false, errors: [], warnings: [] };
  const profilePath = path.join(TOOL_ROOT, 'profiles', platform + '.json');
  if (!fs.existsSync(profilePath)) { result.errors.push(`Unknown platform '${platform}'. Available: ${PLATFORMS.join(', ')}`); return result; }
  const stageOnly = !!opts.stageOnly;
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  const config = opts.config || {};
  const outAbs = path.resolve(opts.out), inAbs = path.resolve(opts.in);
  if (outAbs === inAbs || outAbs.startsWith(inAbs + path.sep)) { result.errors.push('--out must not be inside --in (it would be copied into itself). Use a sibling folder, e.g. Builds/Packages.'); return result; }

  for (const key of profile.requiredConfig || []) {
    const v = getPath(config, key);
    if (v === undefined || v === null || v === '') result.errors.push(`Missing required config '${key}'.`);
  }
  if (result.errors.length) return result;

  const stage = stageOnly ? path.join(opts.out, platform) : path.join(opts.out, '_stage', platform);
  fs.rmSync(stage, { recursive: true, force: true });
  copyDir(opts.in, stage);

  for (const f of profile.files || []) {
    const dst = path.join(stage, f.to);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(TOOL_ROOT, f.from), dst);
  }

  // Generated JSON files (e.g. minigame.json): template + values copied from config; empty/missing config keeps the template default.
  for (const jf of profile.jsonFiles || []) {
    const obj = JSON.parse(fs.readFileSync(path.join(TOOL_ROOT, jf.from), 'utf8'));
    for (const [target, cfgKey] of Object.entries(jf.fill || {})) {
      const v = getPath(config, cfgKey);
      if (v === undefined || v === null || v === '') continue;
      const parts = target.split('.'); let o = obj;
      for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] = o[parts[i]] || {};
      o[parts[parts.length - 1]] = v;
    }
    fs.writeFileSync(path.join(stage, jf.to), JSON.stringify(obj, null, '\t'));
  }

  // Config slice: only the selected platform's values are baked in.
  const slice = { platform, general: config.general || {}, [platform]: config[platform] || {} };
  const configScript = `<script>window.__H5_CONFIG__ = ${JSON.stringify(slice)};</script>`;
  const scriptTags = [];
  for (const u of profile.headScriptUrls || []) scriptTags.push(`<script src="${u}"></script>`);
  for (const key of profile.headScriptsFromConfig || []) scriptTags.push(`<script src="${getPath(config, key)}"></script>`);
  for (const s of profile.headScripts || []) scriptTags.push(`<script src="./${s}"></script>`);
  const headBlock = [configScript, ...scriptTags].join('\n    ');

  const indexPath = path.join(stage, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  html = html.replace('<!-- H5:HEAD -->', () => headBlock);
  if (profile.bodyEndFile) html = html.replace('<!-- H5:BODY_END -->', () => readTool(profile.bodyEndFile));
  if (profile.headFirstFile) {
    const before = html;
    html = html.replace(/<head[^>]*>/i, (m) => m + '\n' + readTool(profile.headFirstFile));
    if (before === html) result.errors.push('Could not find <head> to inject platform head-first snippet.');
  }
  fs.writeFileSync(indexPath, html);

  // Output validation (incl. platform compat rules).
  for (const f of profile.requiredOutput || []) if (!fs.existsSync(path.join(stage, f))) result.errors.push(`Required file missing in output: ${f}`);
  for (const bad of profile.forbiddenInHtml || []) {
    if (html.includes(bad)) result.errors.push(`index.html contains forbidden marker '${bad}' for ${platform} package.`);
  }
  if (profile.compat && portalRules.checks[profile.compat]) result.errors.push(...portalRules.checks[profile.compat](stage, html));
  if (result.errors.length) return result;
  if (stageOnly) { result.ok = true; result.dir = stage; return result; }

  fs.mkdirSync(opts.out, { recursive: true });
  const zipName = `${String(opts.name).replace(/[^A-Za-z0-9._-]+/g, '_')}_${platform}_${opts.version}.zip`;
  const zipPath = path.join(opts.out, zipName);
  const count = zipDirectory(stage, zipPath);
  result.ok = true;
  result.zip = zipPath;
  result.files = count;
  result.sizeBytes = fs.statSync(zipPath).size;
  return result;
}

function run(opts) {
  const report = { tool: 'h5-packager', version: require('../package.json').version, input: opts.in, results: [] };
  const extra = { warnings: [] };
  const inputErrors = validateInput(opts.in, extra);
  report.warnings = extra.warnings;
  if (!opts.platforms.length) inputErrors.push('No platform selected. Use --platform <id>[,<id>] or --platform all');
  if (inputErrors.length) { report.ok = false; report.errors = inputErrors; return report; }
  for (const p of opts.platforms) report.results.push(packageOne(opts, p));
  fs.rmSync(path.join(opts.out, '_stage'), { recursive: true, force: true });
  report.ok = report.results.every(r => r.ok);
  fs.mkdirSync(opts.out, { recursive: true });
  fs.writeFileSync(path.join(opts.out, 'report.json'), JSON.stringify(report, null, 2));
  return report;
}

/** Builds the unzipped package for one platform into <out>/<platform> (used by `qa`). */
function stage(opts, platform) {
  const extra = { warnings: [] };
  const errors = validateInput(opts.in, extra);
  if (errors.length) return { platform, ok: false, errors, warnings: extra.warnings };
  const r = packageOne(Object.assign({}, opts, { stageOnly: true }), platform);
  r.warnings = (r.warnings || []).concat(extra.warnings);
  return r;
}

module.exports = { run, stage, validateInput, PLATFORMS, ALL_PROFILES };

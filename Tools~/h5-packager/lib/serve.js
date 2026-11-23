'use strict';
// Static server for testing WebGL builds locally, with the Content-Encoding a real portal CDN would send.
// Unity's *.unityweb files have no compression in their name; the codec is sniffed from the file header.
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.data': 'application/octet-stream', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8',
};

const sniffCache = new Map();
/** 'br' | 'gzip' | null for a file name + its first bytes. */
function encodingOf(file) {
  if (file.endsWith('.br')) return 'br';
  if (file.endsWith('.gz')) return 'gzip';
  if (!file.endsWith('.unityweb')) return null;
  const st = fs.statSync(file), k = file + ':' + st.mtimeMs;
  if (sniffCache.has(k)) return sniffCache.get(k);
  const fd = fs.openSync(file, 'r'), buf = Buffer.alloc(64);
  fs.readSync(fd, buf, 0, 64, 0); fs.closeSync(fd);
  let enc = null;
  if (buf[0] === 0x1f && buf[1] === 0x8b) enc = 'gzip';
  else if (buf.includes('UnityWeb Compressed Content (brotli)')) enc = 'br';
  sniffCache.set(k, enc);
  return enc;
}

/** Content type ignoring the compression suffix: x.wasm.unityweb -> application/wasm. */
function typeOf(file) {
  const base = file.replace(/\.(unityweb|br|gz)$/, '');
  return TYPES[path.extname(base).toLowerCase()] || 'application/octet-stream';
}

function resolveSafe(root, urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

/**
 * mounts: [{ prefix: '/game/', dir }, { prefix: '/', dir }] (longest prefix first).
 * api: optional (req, res) => boolean handled.
 * onRequest: optional ({url, status, encoding}) logger.
 */
function createServer({ mounts, api, onRequest }) {
  mounts = mounts.map(m => ({ prefix: m.prefix, dir: path.resolve(m.dir) })).sort((a, b) => b.prefix.length - a.prefix.length);
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (api && api(req, res, url)) return;
    const m = mounts.find(x => url.pathname.startsWith(x.prefix) || url.pathname + '/' === x.prefix);
    const done = (status, encoding) => { if (onRequest) onRequest({ url: url.pathname, status, encoding }); };
    if (!m) { res.writeHead(404); res.end('not found'); return done(404); }
    if (url.pathname + '/' === m.prefix) { res.writeHead(302, { Location: m.prefix }); res.end(); return done(302); }
    let file = resolveSafe(m.dir, url.pathname.slice(m.prefix.length));
    if (!file) { res.writeHead(403); res.end(); return done(403); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return done(404); }
    const headers = { 'Content-Type': typeOf(file), 'Cache-Control': 'no-store', 'Content-Length': fs.statSync(file).size };
    // Send Content-Encoding only when the browser accepts it (Chrome does not accept br on plain http to a LAN IP);
    // otherwise the raw bytes go out and Unity's decompression fallback handles them, like on a portal without the header.
    const enc = encodingOf(file);
    const accepted = String(req.headers['accept-encoding'] || '').split(',').map(s => s.trim().split(';')[0]);
    const sent = enc && accepted.includes(enc) ? enc : null;
    if (sent) headers['Content-Encoding'] = sent;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(); return done(200, sent); }
    fs.createReadStream(file).pipe(res);
    done(200, sent || (enc ? enc + ' (not accepted, raw)' : null));
  });
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  return out;
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server.address().port));
  });
}

module.exports = { createServer, listen, lanAddresses, encodingOf, typeOf };

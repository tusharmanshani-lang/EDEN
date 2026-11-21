'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

async function staticPreview(folder) {
  const root = await fs.realpath(folder);
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript',
    '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
    '.wasm': 'application/wasm', '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg' };
  const server = http.createServer(async (request, response) => {
    try {
      const address = server.address();
      if (request.headers.host !== '127.0.0.1:' + address.port) { response.writeHead(403).end(); return; }
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      if (pathname.split('/').some(part => part.startsWith('.') || part.includes('\\'))) { response.writeHead(403).end(); return; }
      let target = path.resolve(root, '.' + pathname);
      const relative = path.relative(root, target);
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) { response.writeHead(403).end(); return; }
      try { if ((await fs.stat(target)).isDirectory()) target = path.join(target, 'index.html'); }
      catch (error) { if (error.code === 'ENOENT') { response.writeHead(404).end('Not found'); return; } throw error; }
      const resolved = await fs.realpath(target);
      if (!resolved.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
      const data = await fs.readFile(resolved);
      response.writeHead(200, { 'Content-Type': types[path.extname(resolved)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch (error) { response.writeHead(error.code === 'ENOENT' ? 404 : 400).end('Unavailable'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const url = 'http://127.0.0.1:' + server.address().port;
  return { url, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); }) };
}

async function availablePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

module.exports = { staticPreview, availablePort };

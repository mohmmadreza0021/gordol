// سرور تست محلی گردول (بدون وابستگی)
const http = require('http');
const fs = require('fs');
const path = require('path');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.mjs': 'text/javascript',
  '.jpg': 'image/jpeg',
  '.png': 'image/png'
};
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(process.cwd(), p);
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' });
    res.end(d);
  });
}).listen(8077, () => console.log('GORDOL DEV: http://127.0.0.1:8077'));

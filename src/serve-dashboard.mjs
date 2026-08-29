// Dashboard local: NO publica nada en internet. Sirve la pagina y los
// datos de ~/.vigia-sisfe/state.json solo en localhost, en tu propia PC.
//
// Uso: node src/serve-dashboard.mjs
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = process.env.STATE_PATH || path.join(os.homedir(), '.vigia-sisfe', 'state.json');
const PORT = process.env.PORT || 5173;

const server = http.createServer(async (req, res) => {
  if (req.url === '/api/state') {
    try {
      const data = await readFile(STATE_PATH, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ actualizado: null, causas: [] }));
    }
    return;
  }

  try {
    const html = await readFile(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (err) {
    res.writeHead(500);
    res.end('No se pudo cargar dashboard.html: ' + err.message);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Dashboard local en http://127.0.0.1:${PORT} (solo en esta PC, no accesible desde afuera)`);
});

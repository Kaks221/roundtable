import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authStatus, closeAgents } from './lib/agents.mjs';
import { Store, Coordinator, createRoom } from './lib/rooms.mjs';
import { recycleConversation } from './lib/recycle.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3210);
const dataDirectory = process.env.ROUNDTABLE_DATA_DIR || path.join(process.env.LOCALAPPDATA || path.join(homedir(), '.local', 'share'), 'Roundtable', 'conversations');
const defaultProject = path.resolve(process.env.ROUNDTABLE_PROJECT || path.dirname(root));
const store = new Store(dataDirectory), clients = new Set();
const csrf = randomBytes(32).toString('hex');
const publish = event => { for (const client of clients) client.write(`data: ${JSON.stringify(event)}\n\n`); };
const coordinator = new Coordinator(store, publish);
let auth = { codex: { ok: false, detail: 'Checking login…' }, claude: { ok: false, detail: 'Checking login…' } };
async function refreshAuth() {
  const results = await Promise.all(['codex', 'claude'].map(authStatus));
  auth = { codex: results[0], claude: results[1] }; publish({ type: 'auth', auth }); return auth;
}
void refreshAuth();

function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
function conversationName(value, required = false) {
  const name = String(value || '').trim();
  if ((required && !name) || name.length > 120) throw new Error('Enter a conversation name between 1 and 120 characters.');
  return name;
}
async function body(req) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > 200000) throw new Error('Message is too large'); }
  return JSON.parse(text || '{}');
}
const staticFiles = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']]]);
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const host = req.headers.host;
  if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host)) return json(res, 403, { error: 'Local connections only' });
  if (req.headers.origin && req.headers.origin !== `http://${host}`) return json(res, 403, { error: 'Cross-origin requests are not allowed' });
  if (req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: 'Cross-site requests are not allowed' });
  const url = new URL(req.url, `http://${host}`);
  try {
    if (req.method === 'GET' && staticFiles.has(url.pathname)) {
      const [file, type] = staticFiles.get(url.pathname);
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); return res.end(readFileSync(path.join(root, 'public', file)));
    }
    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, { csrf, defaultProject, rooms: [...store.rooms.values()], auth, runtime: coordinator.state() });
    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      res.write(': connected\n\n'); clients.add(res);
      const timer = setInterval(() => res.write(': heartbeat\n\n'), 15000);
      req.on('close', () => { clients.delete(res); clearInterval(timer); }); return;
    }
    if (req.method !== 'POST') return json(res, 404, { error: 'Not found' });
    if (req.headers['x-roundtable-token'] !== csrf || !req.headers['content-type']?.startsWith('application/json')) return json(res, 403, { error: 'Refresh this page before continuing' });
    const input = await body(req);
    if (url.pathname === '/api/auth') return json(res, 200, await refreshAuth());
    if (url.pathname === '/api/rooms') {
      const project = realpathSync(String(input.project || defaultProject));
      if (!statSync(project).isDirectory()) throw new Error('Choose an existing project folder');
      const name = conversationName(input.name);
      const room = createRoom(project);
      if (name) { room.title = name; room.customTitle = true; }
      store.save(room); coordinator.emit(room); return json(res, 201, room);
    }
    if (url.pathname === '/api/stop') { coordinator.stop(); return json(res, 200, { ok: true }); }
    const room = store.rooms.get(input.room);
    if (!room) return json(res, 404, { error: 'Conversation not found' });
    if (url.pathname === '/api/rename-room') {
      room.title = conversationName(input.name, true); room.customTitle = true;
      store.save(room); coordinator.emit(room); return json(res, 200, room);
    }
    if (url.pathname === '/api/delete-room') {
      if (coordinator.active?.room === room.id) throw new Error('Stop the active response before deleting this conversation.');
      recycleConversation(store.directory, room.id);
      await closeAgents(Object.values(room.agents).map(agent => agent.session).filter(Boolean));
      store.rooms.delete(room.id);
      publish({ type: 'deleted', roomId: room.id });
      return json(res, 200, { ok: true, message: 'Conversation moved to the Recycle Bin or Trash. You can recover it there.' });
    }
    if (url.pathname === '/api/message') {
      const text = String(input.text || '').trim();
      if (!text || text.length > 100000) throw new Error('Enter a message under 100,000 characters');
      coordinator.submit(room, text); return json(res, 202, { ok: true });
    }
    if (url.pathname === '/api/respond') {
      const target = input.target;
      if (!['codex', 'claude', 'both'].includes(target)) throw new Error('Invalid recipient');
      const required = target === 'both' ? ['codex', 'claude'] : [target];
      if (required.some(agent => !auth[agent].ok)) throw new Error('A subscription login is unavailable. Sign in using the CLI, then click Recheck logins.');
      void coordinator.respond(room, target).catch(error => console.error('Response failed:', error.message));
      return json(res, 202, { ok: true });
    }
    json(res, 404, { error: 'Not found' });
  } catch (error) { json(res, 400, { error: error.message }); }
});
server.listen(port, '127.0.0.1', () => console.log(`Roundtable is ready: http://localhost:${port}\nConversations: ${dataDirectory}\nPress Ctrl+C to stop.`));
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is busy. Roundtable may already be open at http://localhost:${port}` : error.message); process.exitCode = 1; });
async function shutdown() { coordinator.stop(); for (const client of clients) client.end(); server.close(); await closeAgents(); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);

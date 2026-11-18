// Kaiser Online – optional server mode: runs the ORIGINAL C64 program (Ariolasoft 1984) in an
// emulator on a server. The same game also runs without any server on GitHub Pages (see index.html).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { loadMedia } from './emu/media-node.js';
import { Room } from './emu/room.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = +process.env.PORT || 8080;
const MEDIA = process.env.KAISER_MEDIA || path.join(ROOT, 'media');
const DATA = process.env.KAISER_DATA || path.join(ROOT, 'data');
const TG_TOKEN = process.env.KAISER_TELEGRAM_BOT_TOKEN || '';
const BASE_URL = process.env.KAISER_BASE_URL || '';
fs.mkdirSync(DATA, { recursive: true });

let media;
try { media = loadMedia(MEDIA); }
catch (e) {
  console.error(`\n  Fehlende Dateien in ${MEDIA}:\n  - roms/kernal-901227-03.bin, roms/basic-901226-01.bin, roms/chargen-901225-01.bin  (npm run fetch-roms)\n  - kaiser.d64  (die Original-Diskette)\n`);
  process.exit(1);
}

function notifyTelegram(info) {
  if (!TG_TOKEN || !info.contact) return;
  const link = BASE_URL ? `\n${BASE_URL}/?room=${encodeURIComponent(info.room)}` : '';
  fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: info.contact, text: `👑 KAISER: Du bist dran, ${info.player}! (Jahr ${info.year})${link}` }),
  }).catch(e => console.warn('Telegram:', e.message));
}

const rooms = new Map();
function getRoom(name) {
  name = (name || 'kaiser').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) || 'kaiser';
  if (rooms.has(name)) return rooms.get(name);
  const file = path.join(DATA, `room-${name}.json`);
  let state = null;
  if (fs.existsSync(file)) { try { state = JSON.parse(fs.readFileSync(file, 'utf8')); console.log(`[${name}] Spielstand geladen`); } catch { } }
  const room = new Room(name, {
    media, state, telegram: !!TG_TOKEN, onTurn: notifyTelegram,
    encode: (rows) => ({ kind: 1, data: zlib.deflateRawSync(rows, { level: 6 }) }),
    save: (s) => { fs.writeFileSync(file + '.tmp', JSON.stringify(s)); fs.renameSync(file + '.tmp', file); },
    onReset: () => { try { fs.renameSync(file, `${file}.${Date.now()}.bak`); } catch { } },
  });
  rooms.set(name, room);
  return room;
}

// ---------------------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/health') { res.writeHead(200); return res.end('ok'); }
  if (u.pathname === '/charset.bin') { // C64 character ROM, used to render the UI in the real C64 font
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'max-age=86400' });
    return res.end(Buffer.from(media.chargen));
  }
  let p = path.normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, '');
  if (!p || p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, 'public', p);
  if (!f.startsWith(path.join(ROOT, 'public'))) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  const u = new URL(req.url, 'http://x');
  const room = getRoom(u.searchParams.get('room'));
  const client = {
    nick: (u.searchParams.get('nick') || '').slice(0, 20) || 'Gast-' + crypto.randomBytes(2).toString('hex'),
    audio: false,
    ok: () => ws.readyState === 1 && ws.bufferedAmount < 2e6,
    send: (d) => { if (ws.readyState === 1) ws.send(d); },
  };
  room.join(client);
  console.log(`[${room.name}] + ${client.nick} (${room.clients.size})`);
  ws.on('message', (data, bin) => {
    if (bin) return;
    let m; try { m = JSON.parse(data); } catch { return; }
    room.handle(client, m);
  });
  ws.on('close', () => { room.leave(client); console.log(`[${room.name}] - ${client.nick} (${room.clients.size})`); });
});

function shutdown() { for (const r of rooms.values()) r.save(); process.exit(0); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);

server.listen(PORT, () => console.log(`Kaiser Online läuft auf http://localhost:${PORT}  (Medien: ${MEDIA}, Daten: ${DATA})`));

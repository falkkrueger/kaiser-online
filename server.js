// Kaiser Online – runs the ORIGINAL C64 program (Ariolasoft 1984) in an emulator on the server
// and lets several people play it together in the browser ("Hotseat über das Internet").
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { loadMedia, createMachine, autostart } from './emu/machine.js';
import { InputScheduler } from './emu/input.js';
import { FB_W, FB_H } from './emu/c64.js';
import { context, controller, players, hotspots, resolveClick, numberTaps } from './emu/kaiser.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = +process.env.PORT || 8080;
const MEDIA = process.env.KAISER_MEDIA || path.join(ROOT, 'media');
const DATA = process.env.KAISER_DATA || path.join(ROOT, 'data');
const FPS = 50.125;
const TG_TOKEN = process.env.KAISER_TELEGRAM_BOT_TOKEN || '';
const BASE_URL = process.env.KAISER_BASE_URL || '';
fs.mkdirSync(DATA, { recursive: true });

let media;
try { media = loadMedia(MEDIA); }
catch (e) {
  console.error(`\n  Fehlende Dateien in ${MEDIA}:\n  - roms/kernal-901227-03.bin, roms/basic-901226-01.bin, roms/chargen-901225-01.bin  (npm run fetch-roms)\n  - kaiser.d64  (die Original-Diskette)\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
class Room {
  constructor(name) {
    this.name = name;
    this.file = path.join(DATA, `room-${name.replace(/[^a-z0-9_-]/gi, '_')}.json`);
    this.clients = new Set();
    this.seats = {};       // playerIdx -> nick
    this.free = false;     // everybody may control
    this.pauseAbsent = true; // freeze the C64 while the player to move is offline (the original punishes slow turns)
    this.contacts = {};    // nick -> telegram chat id
    this.lastCtrl = -2;
    this.speed = 1;
    this.boot();
    this.lastFrame = null; this.dirty = true; this.lastStatus = '';
    this.timer = null; this.frameNo = 0; this.lastSave = Date.now(); this.changed = false;
  }
  boot(fresh = false) {
    this.c64 = createMachine(media);
    this.input = new InputScheduler(this.c64);
    this.c64.drive.onChange = () => { this.changed = true; };
    if (!fresh && fs.existsSync(this.file)) {
      try {
        const s = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.c64.loadState(s.machine); this.seats = s.seats || {}; this.free = !!s.free;
        this.contacts = s.contacts || {}; if (s.pauseAbsent !== undefined) this.pauseAbsent = s.pauseAbsent;
        console.log(`[${this.name}] Spielstand geladen`); return;
      } catch (e) { console.warn(`[${this.name}] Spielstand defekt, starte neu:`, e.message); }
    }
    autostart(this.c64);
  }
  save() {
    const s = { machine: this.c64.saveState(), seats: this.seats, free: this.free, contacts: this.contacts, pauseAbsent: this.pauseAbsent, saved: new Date().toISOString() };
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(s)); fs.renameSync(this.file + '.tmp', this.file);
    this.lastSave = Date.now(); this.changed = false;
  }
  start() {
    if (this.timer) return;
    this.t0 = performance.now(); this.done = 0;
    this.timer = setInterval(() => this.loop(), 10);
  }
  stop() { clearInterval(this.timer); this.timer = null; try { this.save(); } catch (e) { console.error(e); } }

  online(nick) { return [...this.clients].some(w => w.nick === nick); }
  waitingFor() { // nick of the absent player the C64 is waiting for, or null
    if (!this.pauseAbsent || this.free) return null;
    const ctrl = controller(this.c64, context(this.c64));
    const owner = ctrl >= 0 ? this.seats[ctrl] : null;
    return owner && !this.online(owner) ? owner : null;
  }
  loop() {
    const now = performance.now();
    if (now - (this.lastWaitCheck || 0) > 400) {
      this.lastWaitCheck = now;
      const w = this.waitingFor();
      if (w !== (this.paused || null)) { this.paused = w; this.sendStatus(true); }
    }
    if (this.paused) { this.t0 = now; this.done = 0; return; }
    const due = Math.floor((performance.now() - this.t0) * FPS * this.speed / 1000);
    let n = Math.min(due - this.done, 8 * this.speed);
    if (due - this.done > 50 * this.speed) this.done = due - n; // don't spiral after a stall
    let audio = [];
    for (let i = 0; i < n; i++) {
      this.input.tick(); this.c64.runFrame(); this.done++; this.frameNo++;
      if (this.c64.sidEvents.length && this.speed === 1) audio.push([this.frameNo, this.c64.sidEvents]);
    }
    if (n <= 0) return;
    if (audio.length) this.sendAudio(audio);
    if (this.frameNo % 2 === 0 || n > 1) this.sendFrame();
    if (this.frameNo % 5 < n) { this.sendStatus(); this.checkTurn(); }
    if (Date.now() - this.lastSave > 60000) this.save();
  }

  checkTurn() {
    const ctrl = controller(this.c64, context(this.c64));
    if (ctrl === this.lastCtrl) return;
    this.lastCtrl = ctrl;
    const owner = ctrl >= 0 ? this.seats[ctrl] : null;
    if (!owner || this.online(owner) || !this.contacts[owner] || !TG_TOKEN) return;
    const p = players(this.c64).find(p => p.idx === ctrl);
    const link = BASE_URL ? `\n${BASE_URL}/?room=${encodeURIComponent(this.name)}` : '';
    const text = `👑 KAISER: Du bist dran, ${p ? p.name : owner}! (Jahr ${this.c64.getVar('ZE')})${link}`;
    fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: this.contacts[owner], text }),
    }).catch(e => console.warn('Telegram:', e.message));
  }

  // ----- outgoing -----
  sendFrame(only) {
    const fb = this.c64.fb;
    let y0 = 0, y1 = FB_H - 1;
    if (!only && this.lastFrame) {
      const same = (y) => Buffer.compare(Buffer.from(fb.buffer, y * FB_W, FB_W), Buffer.from(this.lastFrame.buffer, y * FB_W, FB_W)) === 0;
      while (y0 < FB_H && same(y0)) y0++;
      if (y0 === FB_H) return;
      while (y1 > y0 && same(y1)) y1--;
    }
    const rows = fb.subarray(y0 * FB_W, (y1 + 1) * FB_W);
    const z = zlib.deflateRawSync(rows, { level: 6 });
    const msg = Buffer.alloc(5 + z.length);
    msg[0] = 1; msg.writeUInt16LE(y0, 1); msg.writeUInt16LE(y1, 3); z.copy(msg, 5);
    if (only) { only.send(msg); return; }
    this.lastFrame = Uint8Array.from(fb);
    for (const ws of this.clients) if (ws.readyState === 1 && ws.bufferedAmount < 2e6) ws.send(msg);
  }
  sendAudio(list) {
    let len = 1; for (const [, ev] of list) len += 4 + 2 + ev.length / 3 * 4;
    const b = Buffer.alloc(len); let o = 0; b[o++] = 2;
    for (const [f, ev] of list) {
      b.writeUInt32LE(f, o); o += 4; b.writeUInt16LE(ev.length / 3, o); o += 2;
      for (let i = 0; i < ev.length; i += 3) { b.writeUInt16LE(ev[i], o); b[o + 2] = ev[i + 1]; b[o + 3] = ev[i + 2]; o += 4; }
    }
    for (const ws of this.clients) if (ws.readyState === 1 && ws.audio) ws.send(b);
  }
  status() {
    const c = this.c64, ctx = context(c);
    const ctrl = controller(c, ctx);
    return {
      t: 'status', room: this.name, line: ctx.line, mode: ctx.mode, num: ctx.num || null,
      ctrl, players: players(c), seats: this.seats, free: this.free, speed: this.speed,
      paused: this.paused || null, pauseAbsent: this.pauseAbsent, telegram: !!TG_TOKEN,
      hot: hotspots(c, ctx), busy: this.input.busy(),
      users: [...this.clients].map(w => w.nick), year: c.getVar('ZE'),
    };
  }
  sendStatus(force) {
    const s = JSON.stringify(this.status());
    if (!force && s === this.lastStatus) return;
    this.lastStatus = s;
    for (const ws of this.clients) if (ws.readyState === 1) ws.send(s);
  }

  // ----- incoming -----
  mayControl(ws) {
    if (this.free) return true;
    const ctrl = controller(this.c64, context(this.c64));
    if (ctrl < 0) return true;
    const owner = this.seats[ctrl];
    return !owner || owner === ws.nick || (!this.pauseAbsent && !this.online(owner));
  }
  handle(ws, m) {
    const c = this.c64, inp = this.input;
    const deny = () => ws.send(JSON.stringify({ t: 'deny', msg: 'Du bist gerade nicht dran.' }));
    switch (m.t) {
      case 'nick': ws.nick = String(m.nick || '').slice(0, 20) || ws.nick; this.sendStatus(true); return;
      case 'audio': ws.audio = !!m.on; return;
      case 'seat': {
        const idx = +m.idx;
        if (m.on) this.seats[idx] = ws.nick; else if (this.seats[idx] === ws.nick) delete this.seats[idx];
        this.changed = true; this.sendStatus(true); return;
      }
      case 'free': this.free = !!m.on; this.sendStatus(true); return;
      case 'pauseAbsent': this.pauseAbsent = !!m.on; this.sendStatus(true); return;
      case 'telegram': if (m.chat) this.contacts[ws.nick] = String(m.chat).slice(0, 32); else delete this.contacts[ws.nick]; this.changed = true; return;
      case 'speed': this.speed = [1, 2, 4].includes(+m.v) ? +m.v : 1; this.t0 = performance.now(); this.done = 0; this.sendStatus(true); return;
      case 'reset':
        if (m.confirm !== 'NEUSTART') return;
        try { fs.renameSync(this.file, this.file + '.' + Date.now() + '.bak'); } catch { }
        this.seats = {}; this.boot(true); this.lastFrame = null; this.sendStatus(true); this.sendFrame(); return;
    }
    if (!this.mayControl(ws)) return deny();
    switch (m.t) {
      case 'joy': inp.joyTap(m.dir); break;
      case 'hold': inp.joyHold(m.dir, !!m.on); break;
      case 'key': inp.key(m.k); break;
      case 'click': {
        const ctx = context(c);
        for (const d of resolveClick(c, ctx, m.col | 0, m.row | 0, +m.fy || 0)) inp.joyTap(d);
        break;
      }
      case 'number': {
        const ctx = context(c);
        if (ctx.mode !== 'number' || inp.busy()) return;
        for (const d of numberTaps(ctx, +m.v, m.confirm !== false)) inp.joyTap(d);
        break;
      }
    }
    this.changed = true;
  }
}

const rooms = new Map();
function getRoom(name) {
  name = (name || 'kaiser').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) || 'kaiser';
  if (!rooms.has(name)) rooms.set(name, new Room(name));
  return rooms.get(name);
}

// ---------------------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };
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
  ws.nick = (u.searchParams.get('nick') || '').slice(0, 20) || 'Gast-' + crypto.randomBytes(2).toString('hex');
  ws.audio = false;
  room.clients.add(ws);
  room.start();
  console.log(`[${room.name}] + ${ws.nick} (${room.clients.size})`);
  room.sendFrame(ws);
  room.sendStatus(true);
  ws.on('message', (data, bin) => {
    if (bin) return;
    let m; try { m = JSON.parse(data); } catch { return; }
    room.handle(ws, m);
  });
  ws.on('close', () => {
    room.clients.delete(ws);
    console.log(`[${room.name}] - ${ws.nick} (${room.clients.size})`);
    if (!room.clients.size) room.stop(); else room.sendStatus(true);
  });
});

function shutdown() { for (const r of rooms.values()) { try { r.save(); } catch (e) { console.error(e); } } process.exit(0); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);

server.listen(PORT, () => console.log(`Kaiser Online läuft auf http://localhost:${PORT}  (Medien: ${MEDIA}, Daten: ${DATA})`));

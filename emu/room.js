// A "room": one running C64 with the original Kaiser disk plus the people looking at it.
// Platform neutral – used by the Node server (WebSocket clients) and by the in-browser host
// (Web Worker, clients connected via WebRTC).
//
// client = { nick, audio, send(data: string | Uint8Array), ok(): boolean }
import { createMachine, autostart } from './machine.js';
import { InputScheduler } from './input.js';
import { FB_W, FB_H } from './c64.js';
import { context, controller, players, hotspots, resolveClick, numberTaps } from './kaiser.js';

const FPS = 50.125;

// Frame codec 3: run-length, one byte = (runLength-1) << 4 | colour (palette index 0-15)
export function rleEncode(px) {
  const out = new Uint8Array(px.length); let o = 0;
  for (let i = 0; i < px.length;) {
    const c = px[i] & 15; let n = 1;
    while (n < 16 && i + n < px.length && (px[i + n] & 15) === c) n++;
    out[o++] = ((n - 1) << 4) | c; i += n;
  }
  return out.subarray(0, o);
}

export class Room {
  /**
   * opts: { media, state?, save(state), encode?(rows)->{kind,data}, onTurn?(info), onReset?(), telegram? }
   */
  constructor(name, opts) {
    this.name = name; this.opts = opts;
    this.clients = new Set();
    this.seats = {}; this.free = false; this.pauseAbsent = true; this.contacts = {};
    this.speed = 1; this.lastCtrl = -2;
    this.lastFrame = null; this.lastStatus = ''; this.timer = null; this.frameNo = 0;
    this.lastSave = Date.now(); this.paused = null;
    this.boot(opts.state || null);
  }

  boot(state) {
    this.c64 = createMachine(this.opts.media);
    this.input = new InputScheduler(this.c64);
    if (state) {
      try {
        this.c64.loadState(state.machine);
        this.seats = state.seats || {}; this.free = !!state.free;
        this.contacts = state.contacts || {}; if (state.pauseAbsent !== undefined) this.pauseAbsent = state.pauseAbsent;
        return true;
      } catch (e) { console.warn(`[${this.name}] Spielstand defekt, starte neu:`, e.message); this.c64 = createMachine(this.opts.media); this.input = new InputScheduler(this.c64); }
    }
    autostart(this.c64);
    return false;
  }
  snapshot() {
    return { machine: this.c64.saveState(), seats: this.seats, free: this.free, contacts: this.contacts, pauseAbsent: this.pauseAbsent, saved: new Date().toISOString() };
  }
  save() { this.lastSave = Date.now(); try { this.opts.save && this.opts.save(this.snapshot()); } catch (e) { console.error(e); } }
  load(state) { // replace the running game (e.g. imported save file)
    this.boot(state); this.lastFrame = null; this.sendFrame(); this.sendStatus(true); this.save();
  }

  // ----- clients -----
  join(client) {
    this.clients.add(client);
    this.start();
    this.sendFrame(client); this.sendStatus(true);
  }
  leave(client) {
    this.clients.delete(client);
    if (!this.clients.size && this.opts.stopWhenEmpty !== false) this.stop(); else this.sendStatus(true);
  }
  online(nick) { for (const c of this.clients) if (c.nick === nick) return true; return false; }

  start() {
    if (this.timer) return;
    this.t0 = performance.now(); this.done = 0;
    this.timer = setInterval(() => this.loop(), 10);
  }
  stop() { clearInterval(this.timer); this.timer = null; this.save(); }

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
      if (w !== this.paused) { this.paused = w; this.sendStatus(true); }
    }
    if (this.paused) { this.t0 = now; this.done = 0; return; }
    const due = Math.floor((now - this.t0) * FPS * this.speed / 1000);
    const n = Math.min(due - this.done, 8 * this.speed);
    if (due - this.done > 50 * this.speed) this.done = due - n; // don't spiral after a stall
    if (n <= 0) return;
    const audio = [];
    for (let i = 0; i < n; i++) {
      this.input.tick(); this.c64.runFrame(); this.done++; this.frameNo++;
      if (this.c64.sidEvents.length && this.speed === 1) audio.push([this.frameNo, this.c64.sidEvents]);
    }
    if (audio.length) this.sendAudio(audio);
    if (this.frameNo % 2 === 0 || n > 1) this.sendFrame();
    if (this.frameNo % 5 < n) { this.sendStatus(); this.checkTurn(); }
    if (Date.now() - this.lastSave > (this.opts.saveEvery || 30000)) this.save();
  }

  checkTurn() {
    const ctrl = controller(this.c64, context(this.c64));
    if (ctrl === this.lastCtrl) return;
    this.lastCtrl = ctrl;
    const owner = ctrl >= 0 ? this.seats[ctrl] : null;
    if (!owner || this.online(owner) || !this.opts.onTurn) return;
    const p = players(this.c64).find(p => p.idx === ctrl);
    this.opts.onTurn({ room: this.name, owner, player: p ? p.name : owner, year: this.c64.getVar('ZE'), contact: this.contacts[owner] });
  }

  // ----- outgoing -----
  sendFrame(only) {
    const fb = this.c64.fb;
    let y0 = 0, y1 = FB_H - 1;
    const anyStale = [...this.clients].some(c => c.stale && c.ok());
    if (!only && this.lastFrame) {
      const lf = this.lastFrame;
      const same = (y) => { for (let i = y * FB_W, e = i + FB_W; i < e; i++) if (fb[i] !== lf[i]) return false; return true; };
      while (y0 < FB_H && same(y0)) y0++;
      if (y0 === FB_H && !anyStale) return;
      if (y0 === FB_H) { y0 = 0; y1 = 0; }
      while (y1 > y0 && same(y1)) y1--;
    }
    const build = (a, b) => {
      const enc = this.opts.encode ? this.opts.encode(fb.subarray(a * FB_W, (b + 1) * FB_W)) : { kind: 3, data: rleEncode(fb.subarray(a * FB_W, (b + 1) * FB_W)) };
      const msg = new Uint8Array(5 + enc.data.length);
      msg[0] = enc.kind; msg[1] = a & 255; msg[2] = a >> 8; msg[3] = b & 255; msg[4] = b >> 8; msg.set(enc.data, 5);
      return msg;
    };
    if (only) { only.send(build(0, FB_H - 1)); only.stale = false; return; }
    const msg = build(y0, y1); let full = null;
    if (this.lastFrame) this.lastFrame.set(fb); else this.lastFrame = Uint8Array.from(fb);
    for (const c of this.clients) {
      if (!c.ok()) { c.stale = true; continue; }          // congested: skip, resend everything later
      if (c.stale) { c.send(full || (full = build(0, FB_H - 1))); c.stale = false; }
      else c.send(msg);
    }
  }
  sendAudio(list) {
    let len = 1; for (const [, ev] of list) len += 6 + ev.length / 3 * 4;
    const b = new Uint8Array(len); const dv = new DataView(b.buffer); let o = 0; b[o++] = 2;
    for (const [f, ev] of list) {
      dv.setUint32(o, f, true); o += 4; dv.setUint16(o, ev.length / 3, true); o += 2;
      for (let i = 0; i < ev.length; i += 3) { dv.setUint16(o, ev[i], true); b[o + 2] = ev[i + 1]; b[o + 3] = ev[i + 2]; o += 4; }
    }
    for (const c of this.clients) if (c.audio && c.ok()) c.send(b);
  }
  status() {
    const c = this.c64, ctx = context(c);
    return {
      t: 'status', room: this.name, line: ctx.line, mode: ctx.mode, num: ctx.num || null,
      ctrl: controller(c, ctx), players: players(c), seats: this.seats, free: this.free, speed: this.speed,
      paused: this.paused || null, pauseAbsent: this.pauseAbsent, telegram: !!this.opts.telegram,
      hot: hotspots(c, ctx), busy: this.input.busy(),
      users: [...this.clients].map(w => w.nick), year: c.getVar('ZE'),
    };
  }
  sendStatus(force) {
    const s = JSON.stringify(this.status());
    if (!force && s === this.lastStatus) return;
    this.lastStatus = s;
    for (const c of this.clients) c.send(s);
  }

  // ----- incoming -----
  mayControl(client) {
    if (this.free) return true;
    const ctrl = controller(this.c64, context(this.c64));
    if (ctrl < 0) return true;
    const owner = this.seats[ctrl];
    return !owner || owner === client.nick || (!this.pauseAbsent && !this.online(owner));
  }
  handle(client, m) {
    const c = this.c64, inp = this.input;
    switch (m.t) {
      case 'nick': client.nick = String(m.nick || '').slice(0, 20) || client.nick; this.sendStatus(true); return;
      case 'audio': client.audio = !!m.on; return;
      case 'seat': {
        const idx = +m.idx;
        if (m.on) this.seats[idx] = client.nick; else if (this.seats[idx] === client.nick) delete this.seats[idx];
        this.sendStatus(true); return;
      }
      case 'free': this.free = !!m.on; this.sendStatus(true); return;
      case 'pauseAbsent': this.pauseAbsent = !!m.on; this.sendStatus(true); return;
      case 'telegram': if (m.chat) this.contacts[client.nick] = String(m.chat).slice(0, 32); else delete this.contacts[client.nick]; return;
      case 'speed': this.speed = [1, 2, 4].includes(+m.v) ? +m.v : 1; this.t0 = performance.now(); this.done = 0; this.sendStatus(true); return;
      case 'reset':
        if (m.confirm !== 'NEUSTART') return;
        this.opts.onReset && this.opts.onReset();
        this.seats = {}; this.boot(null); this.lastFrame = null; this.sendStatus(true); this.sendFrame(); this.save(); return;
    }
    if (!this.mayControl(client)) { client.send(JSON.stringify({ t: 'deny', msg: 'Du bist gerade nicht dran.' })); return; }
    switch (m.t) {
      case 'joy': inp.joyTap(m.dir); break;
      case 'hold': inp.joyHold(m.dir, !!m.on); break;
      case 'key': inp.key(m.k); break;
      case 'click': for (const d of resolveClick(c, context(c), m.col | 0, m.row | 0, +m.fy || 0)) inp.joyTap(d); break;
      case 'number': {
        const ctx = context(c);
        if (ctx.mode !== 'number' || inp.busy()) return;
        for (const d of numberTaps(ctx, +m.v, m.confirm !== false)) inp.joyTap(d);
        break;
      }
    }
  }
}

import { toB64, fromB64 } from './b64.js';
// Virtual 1541 (device 8) at KERNAL serial-bus level, backed by a .d64 image.
// Written files go to an overlay (the original image is never modified).

const SPT = [0, ...Array(17).fill(21), ...Array(7).fill(19), ...Array(6).fill(18), ...Array(5).fill(17)];
const TRACK_OFF = [0];
for (let t = 1; t <= 35; t++) TRACK_OFF[t] = TRACK_OFF[t - 1] + (t > 1 ? SPT[t - 1] : 0);

export class D64 {
  constructor(buf) { this.d = new Uint8Array(buf); }
  sector(t, s) {
    if (t < 1 || t > 35 || s < 0 || s >= SPT[t]) return null;
    const o = (TRACK_OFF[t] + s) * 256; return this.d.subarray(o, o + 256);
  }
  dir() {
    const out = []; let t = 18, s = 1, guard = 0;
    while (t && guard++ < 40) {
      const b = this.sector(t, s); if (!b) break;
      for (let i = 0; i < 8; i++) {
        const e = b.subarray(i * 32, i * 32 + 32);
        if (!(e[2] & 7)) continue;
        let name = Array.from(e.subarray(5, 21)); while (name.length && name[name.length - 1] === 0xa0) name.pop();
        out.push({ type: e[2], name: Uint8Array.from(name), t: e[3], s: e[4], blocks: e[30] | (e[31] << 8) });
      }
      t = b[0]; s = b[1];
    }
    return out;
  }
  readChain(t, s) {
    const parts = []; let guard = 0;
    while (t && guard++ < 700) {
      const b = this.sector(t, s); if (!b) break;
      if (b[0] === 0) { parts.push(b.slice(2, b[1] + 1)); break; }
      parts.push(b.slice(2)); t = b[0]; s = b[1];
    }
    let len = 0; parts.forEach(p => len += p.length);
    const r = new Uint8Array(len); let o = 0; parts.forEach(p => { r.set(p, o); o += p.length; });
    return r;
  }
  diskName() { const b = this.sector(18, 0); return { name: b.slice(0x90, 0xa0), id: b.slice(0xa2, 0xa7) }; }
}

const key = (bytes) => Array.from(bytes).map(c => c.toString(16).padStart(2, '0')).join('');
const fromKey = (k) => Uint8Array.from(k.match(/../g) || [], h => parseInt(h, 16));

function match(pattern, name) {
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === 0x2a) return true; // '*'
    if (i >= name.length) return false;
    if (c !== 0x3f && c !== name[i]) return false;
  }
  return pattern.length === name.length;
}

export class VirtualDrive {
  constructor(d64bytes) {
    this.disk = new D64(d64bytes);
    this.overlay = new Map();   // hexname -> {type:'SEQ'|'PRG', data:Uint8Array}
    this.deleted = new Set();   // hexname of d64 files scratched
    this.reset();
  }
  reset() {
    this.channels = {};
    this.status = [73, 'CBM DOS V2.6 1541', 0, 0];
    this.statusBuf = null;
    this.mode = null;  // 'listen' | 'talk'
    this.chan = 0; this.secCmd = 0; this.nameBuf = [];
  }

  setStatus(code, msg, t = 0, s = 0) { this.status = [code, msg, t, s]; this.statusBuf = null; }
  statusBytes() {
    const [c, m, t, s] = this.status;
    const str = `${String(c).padStart(2, '0')},${m},${String(t).padStart(2, '0')},${String(s).padStart(2, '0')}\r`;
    return Uint8Array.from(str, ch => ch.charCodeAt(0));
  }

  // ---- file lookup ----
  findFile(pattern) {
    for (const [k, f] of this.overlay) { const n = fromKey(k); if (match(pattern, n)) return { name: n, data: f.data, type: f.type }; }
    for (const e of this.disk.dir()) {
      if (this.deleted.has(key(e.name))) continue;
      if (match(pattern, e.name)) return { name: e.name, data: this.disk.readChain(e.t, e.s), type: ['DEL', 'SEQ', 'PRG', 'USR', 'REL'][e.type & 7] };
    }
    return null;
  }
  directoryListing() {
    const out = []; let addr = 0x0801;
    const line = (num, bytes) => { const l = [0, 0, num & 0xff, num >> 8, ...bytes, 0]; out.push(l); };
    const dn = this.disk.diskName();
    line(0, [0x12, 0x22, ...dn.name, 0x22, 0x20, ...dn.id]);
    const entries = [];
    for (const e of this.disk.dir()) if (!this.deleted.has(key(e.name)) && !this.overlay.has(key(e.name))) entries.push({ name: e.name, blocks: e.blocks, type: ['DEL', 'SEQ', 'PRG', 'USR', 'REL'][e.type & 7] });
    for (const [k, f] of this.overlay) entries.push({ name: fromKey(k), blocks: Math.ceil(f.data.length / 254) || 1, type: f.type });
    for (const e of entries) {
      const pad = e.blocks < 10 ? 3 : e.blocks < 100 ? 2 : 1;
      const q = [...Array(pad).fill(0x20), 0x22, ...e.name, 0x22];
      while (q.length < pad + 18) q.push(0x20);
      line(e.blocks, [...q, ...Array.from(e.type, c => c.charCodeAt(0)), 0x20]);
    }
    line(558, Array.from('BLOCKS FREE.', c => c.charCodeAt(0)));
    const bytes = [addr & 0xff, addr >> 8];
    for (const l of out) { addr += l.length; l[0] = addr & 0xff; l[1] = addr >> 8; bytes.push(...l); }
    bytes.push(0, 0);
    return Uint8Array.from(bytes);
  }

  parseName(raw) {
    let n = Array.from(raw);
    let overwrite = false;
    if (n[0] === 0x40) { overwrite = true; n = n.slice(1); } // '@'
    const colon = n.indexOf(0x3a);
    if (colon >= 0 && colon <= 2) n = n.slice(colon + 1);
    const parts = []; let cur = [];
    for (const c of n) { if (c === 0x2c) { parts.push(cur); cur = []; } else cur.push(c); }
    parts.push(cur);
    const name = Uint8Array.from(parts[0]);
    let type = null, mode = null;
    for (const p of parts.slice(1)) {
      const c = String.fromCharCode(p[0] || 0).toUpperCase();
      if ('SPUL'.includes(c) && !type) type = { S: 'SEQ', P: 'PRG', U: 'USR', L: 'REL' }[c];
      else if ('RWA'.includes(c)) mode = c;
    }
    return { name, type, mode, overwrite };
  }

  openChannel(ch, raw) {
    if (ch === 15) { if (raw.length) this.command(raw); return; }
    if (raw.length === 0) { this.channels[ch] = null; return; }
    if (raw[0] === 0x23) { // '#'
      this.channels[ch] = { kind: 'buf', buf: new Uint8Array(256), pos: 0, len: 256 };
      this.setStatus(0, ' OK'); return;
    }
    if (raw[0] === 0x24 && ch === 0) { // '$'
      this.channels[ch] = { kind: 'read', data: this.directoryListing(), pos: 0 };
      this.setStatus(0, ' OK'); return;
    }
    const p = this.parseName(raw);
    const write = p.mode === 'W' || p.mode === 'A' || ch === 1;
    if (!write) {
      const f = this.findFile(p.name);
      if (!f) { this.channels[ch] = { kind: 'none' }; this.setStatus(62, 'FILE NOT FOUND'); return; }
      this.channels[ch] = { kind: 'read', data: f.data, pos: 0 };
      this.setStatus(0, ' OK');
    } else {
      const exists = this.findFile(p.name);
      if (exists && !p.overwrite && p.mode !== 'A') { this.channels[ch] = { kind: 'none' }; this.setStatus(63, 'FILE EXISTS'); return; }
      const init = (p.mode === 'A' && exists) ? Array.from(exists.data) : [];
      this.channels[ch] = { kind: 'write', name: p.name, type: p.type || (ch === 1 ? 'PRG' : 'SEQ'), data: init };
      this.setStatus(0, ' OK');
    }
  }

  closeChannel(ch) {
    if (ch === 15) { for (const k of Object.keys(this.channels)) this.closeChannel(+k === 15 ? -1 : +k); return; }
    const c = this.channels[ch];
    if (c && c.kind === 'write') {
      const k = key(c.name);
      this.overlay.set(k, { type: c.type, data: Uint8Array.from(c.data) });
      this.deleted.add(k);
      this.onChange && this.onChange();
    }
    delete this.channels[ch];
  }

  command(raw) {
    const s = String.fromCharCode(...raw).replace(/\r$/, '');
    const up = s.toUpperCase();
    const nums = () => (up.split(/[: ]/).slice(1).join(' ').match(/\d+/g) || []).map(Number);
    if (up.startsWith('U1') || up.startsWith('UA') || up.startsWith('B-R')) {
      const [ch, , t, sec] = nums();
      const b = this.disk.sector(t, sec);
      const c = this.channels[ch];
      if (!b) { this.setStatus(66, 'ILLEGAL TRACK OR SECTOR', t, sec); return; }
      if (c && c.kind === 'buf') {
        c.buf.set(b);
        if (up.startsWith('B-R')) { c.pos = 1; c.len = b[0] || 256; } else { c.pos = 0; c.len = 256; }
      }
      this.setStatus(0, ' OK');
    } else if (up.startsWith('B-P')) {
      const [ch, pos] = nums(); const c = this.channels[ch];
      if (c && c.kind === 'buf') { c.pos = pos & 0xff; c.len = 256; }
      this.setStatus(0, ' OK');
    } else if (up[0] === 'S') {
      const p = this.parseName(raw.slice(1)); let n = 0;
      for (const k of [...this.overlay.keys()]) if (match(p.name, fromKey(k))) { this.overlay.delete(k); n++; }
      for (const e of this.disk.dir()) { const k = key(e.name); if (!this.deleted.has(k) && match(p.name, e.name)) { this.deleted.add(k); n++; } }
      this.setStatus(1, 'FILES SCRATCHED', n, 0);
      this.onChange && this.onChange();
    } else if (up[0] === 'I' || up[0] === 'V' || up.startsWith('UJ') || up.startsWith('U:')) {
      this.setStatus(0, ' OK');
    } else if (up.startsWith('M-R')) {
      this.statusBuf = Uint8Array.from([0]);
    } else {
      this.setStatus(0, ' OK');
    }
  }

  // ---- bus level ----
  readByte(ch) { // returns [byte, eoi] or null when nothing to read
    if (ch === 15) {
      if (!this.statusBuf) this.statusBuf = { d: this.statusBytes(), p: 0 };
      const sb = this.statusBuf;
      const v = sb.d[sb.p++]; const eoi = sb.p >= sb.d.length;
      if (eoi) this.setStatus(0, ' OK');
      return [v, eoi];
    }
    const c = this.channels[ch];
    if (!c) return null;
    if (c.kind === 'read') { if (c.pos >= c.data.length) return null; const v = c.data[c.pos++]; return [v, c.pos >= c.data.length]; }
    if (c.kind === 'buf') { if (c.pos >= c.len) { c.pos = 0; } const v = c.buf[c.pos++]; return [v, c.pos >= c.len]; }
    return null;
  }

  writeByte(ch, v) {
    if (ch === 15) { this.cmdBuf.push(v); return; }
    const c = this.channels[ch];
    if (!c) return;
    if (c.kind === 'write') c.data.push(v);
    else if (c.kind === 'buf') { c.buf[c.pos] = v; c.pos = (c.pos + 1) & 0xff; }
  }

  // KERNAL trap entry points. Return ST bits to OR into $90.
  listen(dev) { if (dev !== 8) return 0x80; this.mode = 'listen'; this.secCmd = -1; return 0; }
  talk(dev) { if (dev !== 8) return 0x80; this.mode = 'talk'; this.secCmd = -1; return 0; }
  second(sa) {
    const ch = sa & 0x0f, cmd = sa & 0xf0;
    this.chan = ch; this.secCmd = cmd;
    if (cmd === 0xf0) this.nameBuf = [];
    else if (cmd === 0xe0) this.closeChannel(ch);
    else if (cmd === 0x60 && ch === 15) this.cmdBuf = [];
    return 0;
  }
  tksa(sa) { this.chan = sa & 0x0f; this.secCmd = sa & 0xf0; return 0; }
  ciout(v) {
    if (this.mode !== 'listen') return 0x80;
    if (this.secCmd === 0xf0) this.nameBuf.push(v);
    else if (this.secCmd === 0x60) this.writeByte(this.chan, v);
    return 0;
  }
  unlisten() {
    if (this.mode === 'listen') {
      if (this.secCmd === 0xf0) this.openChannel(this.chan, Uint8Array.from(this.nameBuf));
      else if (this.secCmd === 0x60 && this.chan === 15 && this.cmdBuf && this.cmdBuf.length) { this.command(Uint8Array.from(this.cmdBuf)); this.cmdBuf = []; }
    }
    this.mode = null; return 0;
  }
  acptr() { // -> [byte, st]
    if (this.mode !== 'talk') return [0, 0x02];
    const r = this.readByte(this.chan);
    if (!r) return [0x0d, 0x42];
    return [r[0], r[1] ? 0x40 : 0];
  }
  untalk() { this.mode = null; return 0; }

  saveState() {
    return { overlay: [...this.overlay].map(([k, f]) => [k, f.type, toB64(f.data)]), deleted: [...this.deleted] };
  }
  loadState(s) {
    this.overlay = new Map((s.overlay || []).map(([k, t, d]) => [k, { type: t, data: fromB64(d) }]));
    this.deleted = new Set(s.deleted || []);
    this.reset(); this.setStatus(0, ' OK');
  }
}

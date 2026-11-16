// Commodore 64 (PAL) machine: memory map, VIC-II (line based), 2x CIA 6526, SID register file.
import { CPU } from './cpu6502.js';

export const FB_W = 384, FB_H = 272;
const FIRST_LINE = 16;               // raster line shown at framebuffer row 0
const LINES = 312, CYCLES_PER_LINE = 63;

class CIA {
  constructor(name, onIrq) {
    this.name = name; this.onIrq = onIrq;
    this.reset();
  }
  reset() {
    this.pra = 0; this.prb = 0; this.ddra = 0; this.ddrb = 0;
    this.ta = 0xffff; this.tb = 0xffff; this.tla = 0xffff; this.tlb = 0xffff;
    this.cra = 0; this.crb = 0; this.icr = 0; this.mask = 0;
    this.tod = [0, 0, 0, 1]; this.todLatch = null; this.todStopped = false; this.alarm = [0, 0, 0, 0];
    this.todDiv = 0;
    this.irq = false;
  }
  update() {
    const want = !!(this.icr & this.mask & 0x1f);
    if (want !== this.irq) { this.irq = want; this.onIrq(want); }
  }
  tick(n) {
    let taUnder = 0;
    if (this.cra & 1) {
      if (!(this.cra & 0x20)) {
        this.ta -= n;
        while (this.ta < 0) {
          taUnder++;
          this.icr |= 1;
          if (this.cra & 8) { this.cra &= ~1; this.ta = this.tla; break; }
          this.ta += this.tla + 1;
        }
      }
    }
    if (this.crb & 1) {
      const mode = (this.crb >> 5) & 3;
      let dec = mode === 0 ? n : (mode === 2 ? taUnder : 0);
      if (dec) {
        this.tb -= dec;
        while (this.tb < 0) {
          this.icr |= 2;
          if (this.crb & 8) { this.crb &= ~1; this.tb = this.tlb; break; }
          this.tb += this.tlb + 1;
        }
      }
    }
    if (this.icr & this.mask & 3) this.update();
  }
  todTick() { // called at 50Hz
    if (this.todStopped) return;
    if (++this.todDiv < 5) return; // 1/10 s
    this.todDiv = 0;
    const bcdInc = (v, max) => { let lo = (v & 15) + 1, hi = v >> 4; if (lo > 9) { lo = 0; hi++; } v = (hi << 4) | lo; return v > max ? -1 : v; };
    let t = this.tod;
    t[0] = (t[0] + 1) % 10;
    if (t[0] === 0) {
      let s = bcdInc(t[1], 0x59); if (s < 0) { t[1] = 0;
        let m = bcdInc(t[2], 0x59); if (m < 0) { t[2] = 0;
          let h = t[3] & 0x1f, pm = t[3] & 0x80; h = bcdInc(h, 0x12); if (h === 0x12) pm ^= 0x80; if (h < 0 || h > 0x12) h = 1; t[3] = h | pm; }
        else t[2] = m; }
      else t[1] = s;
    }
    if (t[0] === this.alarm[0] && t[1] === this.alarm[1] && t[2] === this.alarm[2] && t[3] === this.alarm[3]) { this.icr |= 4; this.update(); }
  }
  read(r, portA, portB) {
    switch (r) {
      case 0: return portA();
      case 1: return portB();
      case 2: return this.ddra; case 3: return this.ddrb;
      case 4: return this.ta & 0xff; case 5: return this.ta >> 8;
      case 6: return this.tb & 0xff; case 7: return this.tb >> 8;
      case 8: { const src = this.todLatch || this.tod; const v = src[0]; this.todLatch = null; return v; }
      case 9: return (this.todLatch || this.tod)[1];
      case 10: return (this.todLatch || this.tod)[2];
      case 11: this.todLatch = this.tod.slice(); return this.todLatch[3];
      case 13: { const v = this.icr | (this.irq ? 0x80 : 0); this.icr = 0; this.update(); return v; }
      case 14: return this.cra & 0xef; case 15: return this.crb & 0xef;
    }
    return 0;
  }
  write(r, v) {
    switch (r) {
      case 0: this.pra = v; break; case 1: this.prb = v; break;
      case 2: this.ddra = v; break; case 3: this.ddrb = v; break;
      case 4: this.tla = (this.tla & 0xff00) | v; break;
      case 5: this.tla = (this.tla & 0xff) | (v << 8); if (!(this.cra & 1)) this.ta = this.tla; break;
      case 6: this.tlb = (this.tlb & 0xff00) | v; break;
      case 7: this.tlb = (this.tlb & 0xff) | (v << 8); if (!(this.crb & 1)) this.tb = this.tlb; break;
      case 8: if (this.crb & 0x80) this.alarm[0] = v & 15; else { this.tod[0] = v & 15; this.todStopped = false; } break;
      case 9: if (this.crb & 0x80) this.alarm[1] = v & 0x7f; else this.tod[1] = v & 0x7f; break;
      case 10: if (this.crb & 0x80) this.alarm[2] = v & 0x7f; else this.tod[2] = v & 0x7f; break;
      case 11: if (this.crb & 0x80) this.alarm[3] = v & 0x9f; else { this.tod[3] = v & 0x9f; this.todStopped = true; } break;
      case 13: if (v & 0x80) this.mask |= v & 0x1f; else this.mask &= ~(v & 0x1f); this.update(); break;
      case 14: if (v & 0x10) this.ta = this.tla; this.cra = v & 0xef; break;
      case 15: if (v & 0x10) this.tb = this.tlb; this.crb = v & 0xef; break;
    }
  }
  save() { const s = {}; for (const k of ['pra', 'prb', 'ddra', 'ddrb', 'ta', 'tb', 'tla', 'tlb', 'cra', 'crb', 'icr', 'mask', 'tod', 'todStopped', 'alarm', 'todDiv', 'irq']) s[k] = this[k]; return s; }
  load(s) { Object.assign(this, s); this.todLatch = null; }
}

export class C64 {
  constructor({ kernal, basic, chargen }) {
    this.kernal = kernal; this.basic = basic; this.chargen = chargen;
    this.ram = new Uint8Array(0x10000);
    this.color = new Uint8Array(1024);
    this.vic = new Uint8Array(0x40);
    this.sid = new Uint8Array(0x20);
    this.fb = new Uint8Array(FB_W * FB_H);
    this.irqSrc = 0;
    this.cia1 = new CIA('cia1', on => this.setIrq(1, on));
    this.cia2 = new CIA('cia2', on => { if (on) this.cpu.nmiPending = true; });
    this.cpu = new CPU(this);
    this.keys = new Uint8Array(8);    // keys[paBit] = bitmask of pbBits pressed
    this.joy = [0xff, 0xff];          // [port1, port2] active-low bits 0-4
    this.sidEvents = [];              // [cycleInFrame, reg, value]
    this.frameCycle = 0;
    this.joyReads = 0;                // reads of a joystick port by the game (DDRA=$E0 pattern)
    this.drive = null;
    this.traps = new Map();
    this.typeQueue = [];
    this.frame = 0;
    this.noise = 0x7ffff8;
    this.reset();
  }

  setIrq(bit, on) { if (on) this.irqSrc |= bit; else this.irqSrc &= ~bit; this.cpu.irqLine = this.irqSrc; }

  reset() {
    this.ram.fill(0);
    for (let i = 0; i < 0x10000; i += 128) this.ram.fill(0xff, i + 64, i + 128); // power-on pattern
    this.ram[0] = 0x2f; this.ram[1] = 0x37;
    this.vic.fill(0); this.sid.fill(0);
    this.raster = 0; this.rasterCmp = 0;
    this.cia1.reset(); this.cia2.reset();
    this.irqSrc = 0;
    this.cpu.reset();
    this.setupTraps();
  }

  // ----- memory -----
  port() { const ddr = this.ram[0]; return (this.ram[1] & ddr) | (~ddr & 0x17); }
  read(a) {
    if (a < 0xa000) {
      if (a < 2) return a === 0 ? this.ram[0] : this.port();
      return this.ram[a];
    }
    const p = this.port();
    if (a < 0xc000) return ((p & 3) === 3) ? this.basic[a - 0xa000] : this.ram[a];
    if (a < 0xd000) return this.ram[a];
    if (a < 0xe000) {
      if (!(p & 3)) return this.ram[a];
      if (!(p & 4)) return this.chargen[a - 0xd000];
      return this.ioRead(a);
    }
    return (p & 2) ? this.kernal[a - 0xe000] : this.ram[a];
  }
  write(a, v) {
    if (a >= 0xd000 && a < 0xe000) {
      const p = this.port();
      if ((p & 3) && (p & 4)) { this.ioWrite(a, v); return; }
    }
    this.ram[a] = v;
  }
  peek(a) { return this.ram[a]; }

  ioRead(a) {
    if (a < 0xd400) return this.vicRead(a & 0x3f);
    if (a < 0xd800) {
      const r = a & 0x1f;
      if (r === 0x19 || r === 0x1a) return 0xff;
      if (r === 0x1b) { this.noise = ((this.noise << 1) | (((this.noise >> 22) ^ (this.noise >> 17)) & 1)) & 0x7fffff; return this.noise & 0xff; }
      if (r === 0x1c) return 0;
      return 0;
    }
    if (a < 0xdc00) return (this.color[a & 0x3ff] & 0x0f) | 0xf0;
    if (a < 0xdd00) {
      const r = a & 0x0f;
      if ((r === 0 || r === 1) && this.cia1.ddra === 0xe0 && this.cpu.pc >= 0xa000 && this.cpu.pc < 0xc000) this.joyReads++;
      return this.cia1.read(r, () => this.cia1PortA(), () => this.cia1PortB());
    }
    if (a < 0xde00) return this.cia2.read(a & 0x0f, () => (this.cia2.pra | ~this.cia2.ddra) & 0x3f | 0xc0, () => (this.cia2.prb | ~this.cia2.ddrb) & 0xff);
    return 0xff;
  }
  ioWrite(a, v) {
    if (a < 0xd400) return this.vicWrite(a & 0x3f, v);
    if (a < 0xd800) { const r = a & 0x1f; this.sid[r] = v; this.sidEvents.push(this.frameCycle, r, v); return; }
    if (a < 0xdc00) { this.color[a & 0x3ff] = v & 0x0f; return; }
    if (a < 0xdd00) return this.cia1.write(a & 0x0f, v);
    if (a < 0xde00) return this.cia2.write(a & 0x0f, v);
  }

  cia1PortA() {
    const c = this.cia1;
    let v = (c.pra | ~c.ddra) & 0xff;
    const pbOut = (c.prb | ~c.ddrb) & 0xff & this.joy[0];
    for (let col = 0; col < 8; col++) if (this.keys[col] & ~pbOut & 0xff) v &= ~(1 << col);
    return v & (this.joy[1] | 0xe0);
  }
  cia1PortB() {
    const c = this.cia1;
    let v = (c.prb | ~c.ddrb) & 0xff;
    const paOut = (c.pra | ~c.ddra) & 0xff & (this.joy[1] | 0xe0);
    for (let col = 0; col < 8; col++) if (!(paOut & (1 << col))) v &= ~this.keys[col];
    return v & (this.joy[0] | 0xe0);
  }

  // ----- VIC-II -----
  vicRead(r) {
    const v = this.vic;
    switch (r) {
      case 0x11: return (v[0x11] & 0x7f) | ((this.raster & 0x100) >> 1);
      case 0x12: return this.raster & 0xff;
      case 0x16: return v[0x16] | 0xc0;
      case 0x18: return v[0x18] | 0x01;
      case 0x19: return (v[0x19] & 0x0f) | 0x70 | ((v[0x19] & v[0x1a] & 0x0f) ? 0x80 : 0);
      case 0x1a: return v[0x1a] | 0xf0;
      case 0x1e: { const x = v[0x1e]; v[0x1e] = 0; return x; }
      case 0x1f: { const x = v[0x1f]; v[0x1f] = 0; return x; }
    }
    if (r >= 0x20 && r <= 0x2e) return v[r] | 0xf0;
    if (r > 0x2e) return 0xff;
    return v[r];
  }
  vicWrite(r, val) {
    const v = this.vic;
    if (r === 0x11) { v[0x11] = val; this.rasterCmp = (this.rasterCmp & 0xff) | ((val & 0x80) << 1); return; }
    if (r === 0x12) { this.rasterCmp = (this.rasterCmp & 0x100) | val; return; }
    if (r === 0x19) { v[0x19] &= ~val & 0x0f; this.updVicIrq(); return; }
    if (r === 0x1a) { v[0x1a] = val & 0x0f; this.updVicIrq(); return; }
    if (r === 0x1e || r === 0x1f) return;
    v[r] = val;
  }
  updVicIrq() { this.setIrq(2, !!(this.vic[0x19] & this.vic[0x1a] & 0x0f)); }
  vicBank() { const c = this.cia2; return (3 - (((c.pra | ~c.ddra) & 3))) * 0x4000; }
  vmem(a) { // a: 14-bit VIC address
    a &= 0x3fff;
    const bank = this.vicBank();
    if ((bank === 0 || bank === 0x8000) && a >= 0x1000 && a < 0x2000) return this.chargen[a - 0x1000];
    return this.ram[bank + a];
  }

  renderLine(raster) {
    const y = raster - FIRST_LINE;
    if (y < 0 || y >= FB_H) return;
    const v = this.vic, fb = this.fb, row0 = y * FB_W;
    const border = v[0x20] & 15, bg0 = v[0x21] & 15;
    const d011 = v[0x11], d016 = v[0x16];
    const den = d011 & 0x10, rsel = d011 & 8, csel = d016 & 8;
    const top = rsel ? 51 : 55, bot = rsel ? 251 : 247;
    if (!den || raster < top || raster >= bot) { fb.fill(border, row0, row0 + FB_W); return; }
    const fg = this.lineFg || (this.lineFg = new Uint8Array(FB_W));
    fg.fill(0);
    const xs = d016 & 7, ys = d011 & 7;
    const ecm = d011 & 0x40, bmm = d011 & 0x20, mcm = d016 & 0x10;
    const d018 = v[0x18];
    const screen = ((d018 >> 4) & 15) * 1024, chars = ((d018 >> 1) & 7) * 2048, bitmap = (d018 & 8) * 1024;
    const rl = raster - 0x30 - ys;
    fb.fill(bg0, row0, row0 + FB_W);
    if (rl >= 0 && rl < 200) {
      const crow = rl >> 3, line = rl & 7;
      const b1 = v[0x22] & 15, b2 = v[0x23] & 15, b3 = v[0x24] & 15;
      for (let col = 0; col < 40; col++) {
        const idx = crow * 40 + col;
        const sc = this.vmem(screen + idx), cr = this.color[idx] & 15;
        let x = 32 + xs + col * 8 + row0, fx = 32 + xs + col * 8;
        if (!bmm) {
          if (ecm && mcm) { for (let i = 0; i < 8; i++) fb[x + i] = 0; continue; }
          const ch = ecm ? (sc & 63) : sc;
          const bits = this.vmem(chars + ch * 8 + line);
          if (mcm && (cr & 8)) {
            const cols = [bg0, b1, b2, cr & 7];
            for (let i = 0; i < 4; i++) { const p = (bits >> (6 - i * 2)) & 3; fb[x + i * 2] = fb[x + i * 2 + 1] = cols[p]; if (p & 2) fg[fx + i * 2] = fg[fx + i * 2 + 1] = 1; }
          } else {
            const fcol = mcm ? (cr & 7) : cr;
            const bcol = ecm ? (v[0x21 + (sc >> 6)] & 15) : bg0;
            for (let i = 0; i < 8; i++) { if (bits & (0x80 >> i)) { fb[x + i] = fcol; fg[fx + i] = 1; } else fb[x + i] = bcol; }
          }
        } else {
          if (ecm) { for (let i = 0; i < 8; i++) fb[x + i] = 0; continue; }
          const bits = this.vmem(bitmap + idx * 8 + line);
          if (mcm) {
            const cols = [bg0, sc >> 4, sc & 15, cr];
            for (let i = 0; i < 4; i++) { const p = (bits >> (6 - i * 2)) & 3; fb[x + i * 2] = fb[x + i * 2 + 1] = cols[p]; if (p & 2) fg[fx + i * 2] = fg[fx + i * 2 + 1] = 1; }
          } else {
            const f = sc >> 4, b = sc & 15;
            for (let i = 0; i < 8; i++) { if (bits & (0x80 >> i)) { fb[x + i] = f; fg[fx + i] = 1; } else fb[x + i] = b; }
          }
        }
      }
    }
    // sprites
    const en = v[0x15];
    if (en) {
      const occ = this.lineOcc || (this.lineOcc = new Uint8Array(FB_W + 64));
      occ.fill(0);
      for (let s = 7; s >= 0; s--) {
        if (!(en & (1 << s))) continue;
        const sy = v[1 + s * 2], yexp = (v[0x17] >> s) & 1;
        let sl = raster - sy - 1; if (sl < 0) sl += 256; // wrap
        const h = yexp ? 42 : 21;
        if (sl >= h) continue;
        const dl = yexp ? sl >> 1 : sl;
        const ptr = this.vmem(screen + 0x3f8 + s) * 64 + dl * 3;
        const data = (this.vmem(ptr) << 16) | (this.vmem(ptr + 1) << 8) | this.vmem(ptr + 2);
        if (!data) continue;
        const sx = v[s * 2] | (((v[0x10] >> s) & 1) << 8);
        const xexp = (v[0x1d] >> s) & 1, mc = (v[0x1c] >> s) & 1, behind = (v[0x1b] >> s) & 1;
        const col = v[0x27 + s] & 15, m0 = v[0x25] & 15, m1 = v[0x26] & 15;
        const w = xexp ? 2 : 1;
        for (let i = 0; i < 24; i++) {
          let c = -1;
          if (mc) { const p = (data >> (22 - (i & ~1))) & 3; if (p) c = p === 1 ? m0 : p === 2 ? col : m1; }
          else if (data & (0x800000 >> i)) c = col;
          if (c < 0) continue;
          for (let k = 0; k < w; k++) {
            let px = sx + 8 + i * w + k; if (px >= 512) px -= 504;
            if (px < 0 || px >= FB_W) continue;
            if (occ[px]) v[0x1e] |= occ[px] | (1 << s), this.collSS = true;
            occ[px] |= 1 << s;
            if (fg[px]) { v[0x1f] |= 1 << s; this.collSB = true; }
            if (behind && fg[px]) continue;
            fb[row0 + px] = c;
          }
        }
      }
      // sprite 0 must win: redraw handled by draw order (7..0)
    }
    // side borders
    const left = csel ? 32 : 39, right = csel ? 352 : 343;
    fb.fill(border, row0, row0 + left);
    fb.fill(border, row0 + right, row0 + FB_W);
  }

  // ----- run -----
  runFrame() {
    const cpu = this.cpu;
    this.sidEvents = [];
    this.frameCycle = 0;
    this.collSS = this.collSB = false;
    for (let line = 0; line < LINES; line++) {
      this.raster = line;
      if (line === this.rasterCmp) { this.vic[0x19] |= 1; this.updVicIrq(); }
      const ys = this.vic[0x11] & 7;
      let budget = CYCLES_PER_LINE;
      if (line >= 0x30 && line <= 0xf7 && (line & 7) === ys && (this.vic[0x11] & 0x10)) budget -= 40;
      let used = 0;
      while (used < budget) {
        const c = cpu.step();
        used += c;
        this.cia1.tick(c); this.cia2.tick(c);
        this.frameCycle += c;
      }
      if (budget < CYCLES_PER_LINE) { this.cia1.tick(CYCLES_PER_LINE - budget); this.cia2.tick(CYCLES_PER_LINE - budget); this.frameCycle += CYCLES_PER_LINE - budget; }
      this.renderLine(line);
    }
    if (this.collSS && (this.vic[0x1a] & 4)) { this.vic[0x19] |= 4; this.updVicIrq(); }
    if (this.collSB && (this.vic[0x1a] & 2)) { this.vic[0x19] |= 2; this.updVicIrq(); }
    this.cia1.todTick(); this.cia2.todTick();
    this.frame++;
    this.feedTyping();
  }

  // ----- keyboard buffer typing (used for autostart only) -----
  type(text) { for (const ch of text) this.typeQueue.push(ch.charCodeAt(0)); }
  feedTyping() {
    if (!this.typeQueue.length || this.ram[0xc6] !== 0) return;
    let n = 0; while (n < 10 && this.typeQueue.length) this.ram[0x277 + n++] = this.typeQueue.shift();
    this.ram[0xc6] = n;
  }

  // ----- KERNAL serial bus traps -> virtual drive -----
  setupTraps() {
    const k = this.kernal, vec = (a) => { const o = a - 0xe000; return k[o + 1] | (k[o + 2] << 8); }; // JMP target in jump table
    const t = this.traps; t.clear();
    t.set(vec(0xffb1), 'listen'); t.set(vec(0xffb4), 'talk'); t.set(vec(0xff93), 'second'); t.set(vec(0xff96), 'tksa');
    t.set(vec(0xffa8), 'ciout'); t.set(vec(0xffa5), 'acptr'); t.set(vec(0xffab), 'untalk'); t.set(vec(0xffae), 'unlisten');
    this.cpu.trap = (pc) => {
      if (pc < 0xe000 || !this.drive) return false;
      const name = t.get(pc); if (!name) return false;
      if (!(this.port() & 2)) return false;
      const cpu = this.cpu, d = this.drive; let st = 0;
      switch (name) {
        case 'listen': st = d.listen(cpu.a & 0x1f); break;
        case 'talk': st = d.talk(cpu.a & 0x1f); break;
        case 'second': st = d.second(cpu.a); break;
        case 'tksa': st = d.tksa(cpu.a); break;
        case 'ciout': st = d.ciout(cpu.a); break;
        case 'unlisten': st = d.unlisten(); break;
        case 'untalk': st = d.untalk(); break;
        case 'acptr': { const [b, s] = d.acptr(); cpu.a = b; st = s; cpu.nz(b); break; }
      }
      this.ram[0x90] |= st;
      cpu.p &= ~1; // CLC
      if (name === 'second' || name === 'tksa' || name === 'ciout' || name === 'acptr') cpu.p &= ~4; // CLI like KERNAL
      const l = cpu.pull(), h = cpu.pull(); cpu.pc = ((l | (h << 8)) + 1) & 0xffff;
      return true;
    };
  }

  // ----- BASIC introspection -----
  basicLine() { const h = this.ram[0x3a]; return h === 0xff ? -1 : this.ram[0x39] | (h << 8); }
  static mflpt(b) { // 5-byte CBM float
    if (!b[0]) return 0;
    const sign = b[1] & 0x80 ? -1 : 1;
    const m = ((b[1] | 0x80) * 16777216 + b[2] * 65536 + b[3] * 256 + b[4]) / 4294967296;
    return sign * m * Math.pow(2, b[0] - 128);
  }
  varName(name) {
    const isStr = name.endsWith('$'), isInt = name.endsWith('%');
    const base = name.replace(/[$%]$/, '');
    let c1 = base.charCodeAt(0), c2 = base.length > 1 ? base.charCodeAt(1) : 0;
    if (isStr) c2 |= 0x80; if (isInt) { c1 |= 0x80; c2 |= 0x80; }
    return [c1, c2, isStr, isInt];
  }
  readValue(addr, isStr, isInt) {
    const r = this.ram;
    if (isStr) { const len = r[addr], p = r[addr + 1] | (r[addr + 2] << 8); return String.fromCharCode(...r.subarray(p, p + len)); }
    if (isInt) { const v = (r[addr] << 8) | r[addr + 1]; return v > 32767 ? v - 65536 : v; }
    return C64.mflpt(r.subarray(addr, addr + 5));
  }
  getVar(name) {
    const r = this.ram, [c1, c2, isStr, isInt] = this.varName(name);
    let p = r[0x2d] | (r[0x2e] << 8); const end = r[0x2f] | (r[0x30] << 8);
    while (p < end && p < 0xffff) { if (r[p] === c1 && r[p + 1] === c2) return this.readValue(p + 2, isStr, isInt); p += 7; }
    return undefined;
  }
  getArray(name, idx) {
    const r = this.ram, [c1, c2, isStr, isInt] = this.varName(name);
    let p = r[0x2f] | (r[0x30] << 8); const end = r[0x31] | (r[0x32] << 8);
    let guard = 0;
    while (p < end && guard++ < 500) {
      const size = r[p + 2] | (r[p + 3] << 8); if (!size) break;
      if (r[p] === c1 && r[p + 1] === c2) {
        const nd = r[p + 4]; const dims = []; for (let i = 0; i < nd; i++) dims.push((r[p + 5 + i * 2] << 8) | r[p + 6 + i * 2]);
        if (idx >= dims[0]) return undefined; // single dim only
        const es = isStr ? 3 : isInt ? 2 : 5;
        return this.readValue(p + 5 + nd * 2 + idx * es, isStr, isInt);
      }
      p += size;
    }
    return undefined;
  }

  // ----- snapshots -----
  saveState() {
    return {
      ram: Buffer.from(this.ram).toString('base64'), color: Buffer.from(this.color).toString('base64'),
      vic: Array.from(this.vic), sid: Array.from(this.sid), rasterCmp: this.rasterCmp, irqSrc: this.irqSrc,
      cpu: this.cpu.save(), cia1: this.cia1.save(), cia2: this.cia2.save(), frame: this.frame,
      drive: this.drive ? this.drive.saveState() : null,
    };
  }
  loadState(s) {
    this.ram.set(Buffer.from(s.ram, 'base64')); this.color.set(Buffer.from(s.color, 'base64'));
    this.vic.set(s.vic); this.sid.set(s.sid); this.rasterCmp = s.rasterCmp;
    this.cpu.load(s.cpu); this.cia1.load(s.cia1); this.cia2.load(s.cia2); this.frame = s.frame;
    this.irqSrc = s.irqSrc; this.cpu.irqLine = this.irqSrc;
    if (s.drive && this.drive) this.drive.loadState(s.drive);
    this.keys.fill(0); this.joy = [0xff, 0xff]; this.typeQueue = [];
  }
}

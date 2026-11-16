// MOS 6510 CPU core (NMOS 6502 incl. the stable undocumented opcodes).
// Instruction-stepped, returns cycles used per step.

const C = 1, Z = 2, I = 4, D = 8, B = 16, U = 32, V = 64, N = 128;

// Base cycle counts per opcode (page-cross / branch penalties added separately).
const CYCLES = [
  7,6,2,8,3,3,5,5,3,2,2,2,4,4,6,6, 2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
  6,6,2,8,3,3,5,5,4,2,2,2,4,4,6,6, 2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
  6,6,2,8,3,3,5,5,3,2,2,2,3,4,6,6, 2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
  6,6,2,8,3,3,5,5,4,2,2,2,5,4,6,6, 2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
  2,6,2,6,3,3,3,3,2,2,2,2,4,4,4,4, 2,6,2,6,4,4,4,4,2,5,2,5,5,5,5,5,
  2,6,2,6,3,3,3,3,2,2,2,2,4,4,4,4, 2,5,2,5,4,4,4,4,2,4,2,4,4,4,4,4,
  2,6,2,8,3,3,5,5,2,2,2,2,4,4,6,6, 2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
  2,6,2,8,3,3,5,5,2,2,2,2,4,4,6,6, 2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
];

export class CPU {
  constructor(bus) {
    this.bus = bus; // {read(a), write(a,v)}
    this.a = 0; this.x = 0; this.y = 0; this.sp = 0xfd; this.p = U | I; this.pc = 0;
    this.irqLine = 0;   // bitmask of IRQ sources (level triggered)
    this.nmiPending = false;
    this.jammed = false;
    this.extra = 0;
    this.trap = null;   // optional function(pc) -> true if handled (performed instead of opcode)
  }

  reset() {
    this.sp = 0xfd; this.p = U | I; this.jammed = false;
    this.pc = this.rd(0xfffc) | (this.rd(0xfffd) << 8);
  }

  rd(a) { return this.bus.read(a & 0xffff); }
  wr(a, v) { this.bus.write(a & 0xffff, v & 0xff); }
  push(v) { this.wr(0x100 | this.sp, v); this.sp = (this.sp - 1) & 0xff; }
  pull() { this.sp = (this.sp + 1) & 0xff; return this.rd(0x100 | this.sp); }
  nz(v) { this.p = (this.p & ~(N | Z)) | (v & N) | (v ? 0 : Z); return v; }

  interrupt(vector, brk) {
    this.push(this.pc >> 8); this.push(this.pc & 0xff);
    this.push((this.p | U | (brk ? B : 0)) & ~(brk ? 0 : B));
    this.p |= I;
    this.pc = this.rd(vector) | (this.rd(vector + 1) << 8);
    return 7;
  }

  // addressing helpers
  imm() { return this.pc++ & 0xffff; }
  zp() { return this.rd(this.pc++); }
  zpx() { return (this.rd(this.pc++) + this.x) & 0xff; }
  zpy() { return (this.rd(this.pc++) + this.y) & 0xff; }
  abs() { const l = this.rd(this.pc), h = this.rd(this.pc + 1); this.pc += 2; return l | (h << 8); }
  absx(pen) { const b = this.abs(); const a = (b + this.x) & 0xffff; if (pen && ((a ^ b) & 0xff00)) this.extra++; return a; }
  absy(pen) { const b = this.abs(); const a = (b + this.y) & 0xffff; if (pen && ((a ^ b) & 0xff00)) this.extra++; return a; }
  izx() { const z = (this.rd(this.pc++) + this.x) & 0xff; return this.rd(z) | (this.rd((z + 1) & 0xff) << 8); }
  izy(pen) {
    const z = this.rd(this.pc++); const b = this.rd(z) | (this.rd((z + 1) & 0xff) << 8);
    const a = (b + this.y) & 0xffff; if (pen && ((a ^ b) & 0xff00)) this.extra++; return a;
  }

  adc(v) {
    if (this.p & D) {
      const c = this.p & C;
      let lo = (this.a & 0x0f) + (v & 0x0f) + c;
      let hi = (this.a & 0xf0) + (v & 0xf0);
      this.p &= ~(Z | N | V | C);
      if (!((this.a + v + c) & 0xff)) this.p |= Z;
      if (lo > 9) { hi += 0x10; lo += 6; }
      if (hi & 0x80) this.p |= N;
      if (~(this.a ^ v) & (this.a ^ hi) & 0x80) this.p |= V;
      if (hi > 0x90) hi += 0x60;
      if (hi & 0xff00) this.p |= C;
      this.a = ((lo & 0x0f) | (hi & 0xf0)) & 0xff;
    } else {
      const r = this.a + v + (this.p & C);
      this.p &= ~(C | V);
      if (r > 0xff) this.p |= C;
      if (~(this.a ^ v) & (this.a ^ r) & 0x80) this.p |= V;
      this.a = this.nz(r & 0xff);
    }
  }
  sbc(v) {
    if (this.p & D) {
      const c = (this.p & C) ? 0 : 1;
      const r = this.a - v - c;
      let lo = (this.a & 0x0f) - (v & 0x0f) - c;
      let hi = (this.a & 0xf0) - (v & 0xf0);
      if (lo & 0x10) { lo -= 6; hi -= 0x10; }
      if (hi & 0x100) hi -= 0x60;
      this.p &= ~(C | V | Z | N);
      if (r >= 0 && !(r & 0x100)) this.p |= C;
      if ((this.a ^ v) & (this.a ^ r) & 0x80) this.p |= V;
      this.nzKeep(r & 0xff);
      this.a = ((lo & 0x0f) | (hi & 0xf0)) & 0xff;
    } else {
      const r = this.a - v - ((this.p & C) ? 0 : 1);
      this.p &= ~(C | V);
      if (r >= 0) this.p |= C;
      if ((this.a ^ v) & (this.a ^ r) & 0x80) this.p |= V;
      this.a = this.nz(r & 0xff);
    }
  }
  nzKeep(v) { this.p |= (v & N) | (v ? 0 : Z); }
  cmp(r, v) { const t = r - v; this.p = (this.p & ~(C | Z | N)) | (t >= 0 ? C : 0) | (t & 0xff ? 0 : Z) | (t & N); }
  asl(v) { this.p = (this.p & ~C) | ((v >> 7) & 1); return this.nz((v << 1) & 0xff); }
  lsr(v) { this.p = (this.p & ~C) | (v & 1); return this.nz(v >> 1); }
  rol(v) { const c = this.p & C; this.p = (this.p & ~C) | ((v >> 7) & 1); return this.nz(((v << 1) | c) & 0xff); }
  ror(v) { const c = this.p & C; this.p = (this.p & ~C) | (v & 1); return this.nz((v >> 1) | (c << 7)); }
  bit(v) { this.p = (this.p & ~(N | V | Z)) | (v & (N | V)) | ((this.a & v) ? 0 : Z); }
  rmw(a, f) { const v = this.rd(a); this.wr(a, v); const r = f.call(this, v); this.wr(a, r); return r; }
  branch(cond) {
    const o = this.rd(this.pc++);
    if (cond) {
      const t = (this.pc + ((o ^ 0x80) - 0x80)) & 0xffff;
      this.extra += ((t ^ this.pc) & 0xff00) ? 2 : 1;
      this.pc = t;
    }
  }

  step() {
    if (this.nmiPending) { this.nmiPending = false; return this.interrupt(0xfffa, false); }
    if (this.irqLine && !(this.p & I)) return this.interrupt(0xfffe, false);
    if (this.jammed) return 2;
    if (this.trap && this.trap(this.pc)) return 6;
    const op = this.rd(this.pc++);
    this.extra = 0;
    let a, v;
    switch (op) {
      // LDA
      case 0xa9: this.a = this.nz(this.rd(this.imm())); break;
      case 0xa5: this.a = this.nz(this.rd(this.zp())); break;
      case 0xb5: this.a = this.nz(this.rd(this.zpx())); break;
      case 0xad: this.a = this.nz(this.rd(this.abs())); break;
      case 0xbd: this.a = this.nz(this.rd(this.absx(1))); break;
      case 0xb9: this.a = this.nz(this.rd(this.absy(1))); break;
      case 0xa1: this.a = this.nz(this.rd(this.izx())); break;
      case 0xb1: this.a = this.nz(this.rd(this.izy(1))); break;
      // LDX
      case 0xa2: this.x = this.nz(this.rd(this.imm())); break;
      case 0xa6: this.x = this.nz(this.rd(this.zp())); break;
      case 0xb6: this.x = this.nz(this.rd(this.zpy())); break;
      case 0xae: this.x = this.nz(this.rd(this.abs())); break;
      case 0xbe: this.x = this.nz(this.rd(this.absy(1))); break;
      // LDY
      case 0xa0: this.y = this.nz(this.rd(this.imm())); break;
      case 0xa4: this.y = this.nz(this.rd(this.zp())); break;
      case 0xb4: this.y = this.nz(this.rd(this.zpx())); break;
      case 0xac: this.y = this.nz(this.rd(this.abs())); break;
      case 0xbc: this.y = this.nz(this.rd(this.absx(1))); break;
      // STA
      case 0x85: this.wr(this.zp(), this.a); break;
      case 0x95: this.wr(this.zpx(), this.a); break;
      case 0x8d: this.wr(this.abs(), this.a); break;
      case 0x9d: this.wr(this.absx(0), this.a); break;
      case 0x99: this.wr(this.absy(0), this.a); break;
      case 0x81: this.wr(this.izx(), this.a); break;
      case 0x91: this.wr(this.izy(0), this.a); break;
      // STX / STY
      case 0x86: this.wr(this.zp(), this.x); break;
      case 0x96: this.wr(this.zpy(), this.x); break;
      case 0x8e: this.wr(this.abs(), this.x); break;
      case 0x84: this.wr(this.zp(), this.y); break;
      case 0x94: this.wr(this.zpx(), this.y); break;
      case 0x8c: this.wr(this.abs(), this.y); break;
      // transfers
      case 0xaa: this.x = this.nz(this.a); break;
      case 0xa8: this.y = this.nz(this.a); break;
      case 0x8a: this.a = this.nz(this.x); break;
      case 0x98: this.a = this.nz(this.y); break;
      case 0xba: this.x = this.nz(this.sp); break;
      case 0x9a: this.sp = this.x; break;
      // stack
      case 0x48: this.push(this.a); break;
      case 0x08: this.push(this.p | B | U); break;
      case 0x68: this.a = this.nz(this.pull()); break;
      case 0x28: this.p = (this.pull() & ~B) | U; break;
      // logic
      case 0x29: this.a = this.nz(this.a & this.rd(this.imm())); break;
      case 0x25: this.a = this.nz(this.a & this.rd(this.zp())); break;
      case 0x35: this.a = this.nz(this.a & this.rd(this.zpx())); break;
      case 0x2d: this.a = this.nz(this.a & this.rd(this.abs())); break;
      case 0x3d: this.a = this.nz(this.a & this.rd(this.absx(1))); break;
      case 0x39: this.a = this.nz(this.a & this.rd(this.absy(1))); break;
      case 0x21: this.a = this.nz(this.a & this.rd(this.izx())); break;
      case 0x31: this.a = this.nz(this.a & this.rd(this.izy(1))); break;
      case 0x09: this.a = this.nz(this.a | this.rd(this.imm())); break;
      case 0x05: this.a = this.nz(this.a | this.rd(this.zp())); break;
      case 0x15: this.a = this.nz(this.a | this.rd(this.zpx())); break;
      case 0x0d: this.a = this.nz(this.a | this.rd(this.abs())); break;
      case 0x1d: this.a = this.nz(this.a | this.rd(this.absx(1))); break;
      case 0x19: this.a = this.nz(this.a | this.rd(this.absy(1))); break;
      case 0x01: this.a = this.nz(this.a | this.rd(this.izx())); break;
      case 0x11: this.a = this.nz(this.a | this.rd(this.izy(1))); break;
      case 0x49: this.a = this.nz(this.a ^ this.rd(this.imm())); break;
      case 0x45: this.a = this.nz(this.a ^ this.rd(this.zp())); break;
      case 0x55: this.a = this.nz(this.a ^ this.rd(this.zpx())); break;
      case 0x4d: this.a = this.nz(this.a ^ this.rd(this.abs())); break;
      case 0x5d: this.a = this.nz(this.a ^ this.rd(this.absx(1))); break;
      case 0x59: this.a = this.nz(this.a ^ this.rd(this.absy(1))); break;
      case 0x41: this.a = this.nz(this.a ^ this.rd(this.izx())); break;
      case 0x51: this.a = this.nz(this.a ^ this.rd(this.izy(1))); break;
      case 0x24: this.bit(this.rd(this.zp())); break;
      case 0x2c: this.bit(this.rd(this.abs())); break;
      // arithmetic
      case 0x69: this.adc(this.rd(this.imm())); break;
      case 0x65: this.adc(this.rd(this.zp())); break;
      case 0x75: this.adc(this.rd(this.zpx())); break;
      case 0x6d: this.adc(this.rd(this.abs())); break;
      case 0x7d: this.adc(this.rd(this.absx(1))); break;
      case 0x79: this.adc(this.rd(this.absy(1))); break;
      case 0x61: this.adc(this.rd(this.izx())); break;
      case 0x71: this.adc(this.rd(this.izy(1))); break;
      case 0xe9: case 0xeb: this.sbc(this.rd(this.imm())); break;
      case 0xe5: this.sbc(this.rd(this.zp())); break;
      case 0xf5: this.sbc(this.rd(this.zpx())); break;
      case 0xed: this.sbc(this.rd(this.abs())); break;
      case 0xfd: this.sbc(this.rd(this.absx(1))); break;
      case 0xf9: this.sbc(this.rd(this.absy(1))); break;
      case 0xe1: this.sbc(this.rd(this.izx())); break;
      case 0xf1: this.sbc(this.rd(this.izy(1))); break;
      // compare
      case 0xc9: this.cmp(this.a, this.rd(this.imm())); break;
      case 0xc5: this.cmp(this.a, this.rd(this.zp())); break;
      case 0xd5: this.cmp(this.a, this.rd(this.zpx())); break;
      case 0xcd: this.cmp(this.a, this.rd(this.abs())); break;
      case 0xdd: this.cmp(this.a, this.rd(this.absx(1))); break;
      case 0xd9: this.cmp(this.a, this.rd(this.absy(1))); break;
      case 0xc1: this.cmp(this.a, this.rd(this.izx())); break;
      case 0xd1: this.cmp(this.a, this.rd(this.izy(1))); break;
      case 0xe0: this.cmp(this.x, this.rd(this.imm())); break;
      case 0xe4: this.cmp(this.x, this.rd(this.zp())); break;
      case 0xec: this.cmp(this.x, this.rd(this.abs())); break;
      case 0xc0: this.cmp(this.y, this.rd(this.imm())); break;
      case 0xc4: this.cmp(this.y, this.rd(this.zp())); break;
      case 0xcc: this.cmp(this.y, this.rd(this.abs())); break;
      // inc/dec
      case 0xe6: this.rmw(this.zp(), v => this.nz((v + 1) & 0xff)); break;
      case 0xf6: this.rmw(this.zpx(), v => this.nz((v + 1) & 0xff)); break;
      case 0xee: this.rmw(this.abs(), v => this.nz((v + 1) & 0xff)); break;
      case 0xfe: this.rmw(this.absx(0), v => this.nz((v + 1) & 0xff)); break;
      case 0xc6: this.rmw(this.zp(), v => this.nz((v - 1) & 0xff)); break;
      case 0xd6: this.rmw(this.zpx(), v => this.nz((v - 1) & 0xff)); break;
      case 0xce: this.rmw(this.abs(), v => this.nz((v - 1) & 0xff)); break;
      case 0xde: this.rmw(this.absx(0), v => this.nz((v - 1) & 0xff)); break;
      case 0xe8: this.x = this.nz((this.x + 1) & 0xff); break;
      case 0xca: this.x = this.nz((this.x - 1) & 0xff); break;
      case 0xc8: this.y = this.nz((this.y + 1) & 0xff); break;
      case 0x88: this.y = this.nz((this.y - 1) & 0xff); break;
      // shifts
      case 0x0a: this.a = this.asl(this.a); break;
      case 0x06: this.rmw(this.zp(), this.asl); break;
      case 0x16: this.rmw(this.zpx(), this.asl); break;
      case 0x0e: this.rmw(this.abs(), this.asl); break;
      case 0x1e: this.rmw(this.absx(0), this.asl); break;
      case 0x4a: this.a = this.lsr(this.a); break;
      case 0x46: this.rmw(this.zp(), this.lsr); break;
      case 0x56: this.rmw(this.zpx(), this.lsr); break;
      case 0x4e: this.rmw(this.abs(), this.lsr); break;
      case 0x5e: this.rmw(this.absx(0), this.lsr); break;
      case 0x2a: this.a = this.rol(this.a); break;
      case 0x26: this.rmw(this.zp(), this.rol); break;
      case 0x36: this.rmw(this.zpx(), this.rol); break;
      case 0x2e: this.rmw(this.abs(), this.rol); break;
      case 0x3e: this.rmw(this.absx(0), this.rol); break;
      case 0x6a: this.a = this.ror(this.a); break;
      case 0x66: this.rmw(this.zp(), this.ror); break;
      case 0x76: this.rmw(this.zpx(), this.ror); break;
      case 0x6e: this.rmw(this.abs(), this.ror); break;
      case 0x7e: this.rmw(this.absx(0), this.ror); break;
      // jumps
      case 0x4c: this.pc = this.abs(); break;
      case 0x6c: { const p = this.abs(); this.pc = this.rd(p) | (this.rd((p & 0xff00) | ((p + 1) & 0xff)) << 8); break; }
      case 0x20: { const t = this.abs(); const r = (this.pc - 1) & 0xffff; this.push(r >> 8); this.push(r & 0xff); this.pc = t; break; }
      case 0x60: { const l = this.pull(), h = this.pull(); this.pc = ((l | (h << 8)) + 1) & 0xffff; break; }
      case 0x40: { this.p = (this.pull() & ~B) | U; const l = this.pull(), h = this.pull(); this.pc = l | (h << 8); break; }
      case 0x00: this.pc = (this.pc + 1) & 0xffff; this.interrupt(0xfffe, true); break;
      // branches
      case 0x10: this.branch(!(this.p & N)); break;
      case 0x30: this.branch(this.p & N); break;
      case 0x50: this.branch(!(this.p & V)); break;
      case 0x70: this.branch(this.p & V); break;
      case 0x90: this.branch(!(this.p & C)); break;
      case 0xb0: this.branch(this.p & C); break;
      case 0xd0: this.branch(!(this.p & Z)); break;
      case 0xf0: this.branch(this.p & Z); break;
      // flags
      case 0x18: this.p &= ~C; break;
      case 0x38: this.p |= C; break;
      case 0x58: this.p &= ~I; break;
      case 0x78: this.p |= I; break;
      case 0xb8: this.p &= ~V; break;
      case 0xd8: this.p &= ~D; break;
      case 0xf8: this.p |= D; break;
      case 0xea: break;

      // ---- undocumented ----
      case 0x1a: case 0x3a: case 0x5a: case 0x7a: case 0xda: case 0xfa: break; // NOP
      case 0x80: case 0x82: case 0x89: case 0xc2: case 0xe2: this.pc++; break;
      case 0x04: case 0x44: case 0x64: this.zp(); break;
      case 0x14: case 0x34: case 0x54: case 0x74: case 0xd4: case 0xf4: this.zpx(); break;
      case 0x0c: this.abs(); break;
      case 0x1c: case 0x3c: case 0x5c: case 0x7c: case 0xdc: case 0xfc: this.absx(1); break;
      // LAX
      case 0xa7: this.a = this.x = this.nz(this.rd(this.zp())); break;
      case 0xb7: this.a = this.x = this.nz(this.rd(this.zpy())); break;
      case 0xaf: this.a = this.x = this.nz(this.rd(this.abs())); break;
      case 0xbf: this.a = this.x = this.nz(this.rd(this.absy(1))); break;
      case 0xa3: this.a = this.x = this.nz(this.rd(this.izx())); break;
      case 0xb3: this.a = this.x = this.nz(this.rd(this.izy(1))); break;
      case 0xab: this.a = this.x = this.nz((this.a | 0xee) & this.rd(this.imm())); break;
      // SAX
      case 0x87: this.wr(this.zp(), this.a & this.x); break;
      case 0x97: this.wr(this.zpy(), this.a & this.x); break;
      case 0x8f: this.wr(this.abs(), this.a & this.x); break;
      case 0x83: this.wr(this.izx(), this.a & this.x); break;
      // DCP
      case 0xc7: a = this.zp(); this.dcp(a); break;
      case 0xd7: a = this.zpx(); this.dcp(a); break;
      case 0xcf: a = this.abs(); this.dcp(a); break;
      case 0xdf: a = this.absx(0); this.dcp(a); break;
      case 0xdb: a = this.absy(0); this.dcp(a); break;
      case 0xc3: a = this.izx(); this.dcp(a); break;
      case 0xd3: a = this.izy(0); this.dcp(a); break;
      // ISC
      case 0xe7: a = this.zp(); this.isc(a); break;
      case 0xf7: a = this.zpx(); this.isc(a); break;
      case 0xef: a = this.abs(); this.isc(a); break;
      case 0xff: a = this.absx(0); this.isc(a); break;
      case 0xfb: a = this.absy(0); this.isc(a); break;
      case 0xe3: a = this.izx(); this.isc(a); break;
      case 0xf3: a = this.izy(0); this.isc(a); break;
      // SLO
      case 0x07: a = this.zp(); this.slo(a); break;
      case 0x17: a = this.zpx(); this.slo(a); break;
      case 0x0f: a = this.abs(); this.slo(a); break;
      case 0x1f: a = this.absx(0); this.slo(a); break;
      case 0x1b: a = this.absy(0); this.slo(a); break;
      case 0x03: a = this.izx(); this.slo(a); break;
      case 0x13: a = this.izy(0); this.slo(a); break;
      // RLA
      case 0x27: a = this.zp(); this.rla(a); break;
      case 0x37: a = this.zpx(); this.rla(a); break;
      case 0x2f: a = this.abs(); this.rla(a); break;
      case 0x3f: a = this.absx(0); this.rla(a); break;
      case 0x3b: a = this.absy(0); this.rla(a); break;
      case 0x23: a = this.izx(); this.rla(a); break;
      case 0x33: a = this.izy(0); this.rla(a); break;
      // SRE
      case 0x47: a = this.zp(); this.sre(a); break;
      case 0x57: a = this.zpx(); this.sre(a); break;
      case 0x4f: a = this.abs(); this.sre(a); break;
      case 0x5f: a = this.absx(0); this.sre(a); break;
      case 0x5b: a = this.absy(0); this.sre(a); break;
      case 0x43: a = this.izx(); this.sre(a); break;
      case 0x53: a = this.izy(0); this.sre(a); break;
      // RRA
      case 0x67: a = this.zp(); this.rra(a); break;
      case 0x77: a = this.zpx(); this.rra(a); break;
      case 0x6f: a = this.abs(); this.rra(a); break;
      case 0x7f: a = this.absx(0); this.rra(a); break;
      case 0x7b: a = this.absy(0); this.rra(a); break;
      case 0x63: a = this.izx(); this.rra(a); break;
      case 0x73: a = this.izy(0); this.rra(a); break;
      // immediates
      case 0x0b: case 0x2b: this.a = this.nz(this.a & this.rd(this.imm())); this.p = (this.p & ~C) | ((this.a >> 7) & 1); break; // ANC
      case 0x4b: this.a = this.lsr(this.a & this.rd(this.imm())); break; // ALR
      case 0x6b: { // ARR
        this.a &= this.rd(this.imm());
        const c = this.p & C; this.a = ((this.a >> 1) | (c << 7)) & 0xff; this.nz(this.a);
        this.p = (this.p & ~(C | V)) | ((this.a >> 6) & 1) | (((this.a >> 6) ^ (this.a >> 5)) & 1 ? V : 0);
        break;
      }
      case 0xcb: { // SBX/AXS
        const t = (this.a & this.x) - this.rd(this.imm());
        this.p = (this.p & ~C) | (t >= 0 ? C : 0); this.x = this.nz(t & 0xff); break;
      }
      case 0x8b: this.a = this.nz((this.a | 0xee) & this.x & this.rd(this.imm())); break; // ANE
      case 0xbb: { v = this.rd(this.absy(1)) & this.sp; this.a = this.x = this.sp = v; this.nz(v); break; } // LAS
      case 0x9b: { a = this.absy(0); this.sp = this.a & this.x; this.wr(a, this.sp & (((a >> 8) + 1) & 0xff)); break; }
      case 0x9c: { a = this.absx(0); this.wr(a, this.y & (((a >> 8) + 1) & 0xff)); break; }
      case 0x9e: { a = this.absy(0); this.wr(a, this.x & (((a >> 8) + 1) & 0xff)); break; }
      case 0x9f: { a = this.absy(0); this.wr(a, this.a & this.x & (((a >> 8) + 1) & 0xff)); break; }
      case 0x93: { a = this.izy(0); this.wr(a, this.a & this.x & (((a >> 8) + 1) & 0xff)); break; }
      default: // JAM
        this.jammed = true; this.pc = (this.pc - 1) & 0xffff; return 2;
    }
    return CYCLES[op] + this.extra;
  }

  dcp(a) { const v = (this.rd(a) - 1) & 0xff; this.wr(a, v); this.cmp(this.a, v); }
  isc(a) { const v = (this.rd(a) + 1) & 0xff; this.wr(a, v); this.sbc(v); }
  slo(a) { const v = this.asl(this.rd(a)); this.wr(a, v); this.a = this.nz(this.a | v); }
  rla(a) { const v = this.rol(this.rd(a)); this.wr(a, v); this.a = this.nz(this.a & v); }
  sre(a) { const v = this.lsr(this.rd(a)); this.wr(a, v); this.a = this.nz(this.a ^ v); }
  rra(a) { const v = this.ror(this.rd(a)); this.wr(a, v); this.adc(v); }

  save() { return { a: this.a, x: this.x, y: this.y, sp: this.sp, p: this.p, pc: this.pc, nmi: this.nmiPending, jam: this.jammed }; }
  load(s) { Object.assign(this, { a: s.a, x: s.x, y: s.y, sp: s.sp, p: s.p, pc: s.pc, nmiPending: s.nmi, jammed: s.jam }); }
}

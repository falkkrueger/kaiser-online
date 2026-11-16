// Input scheduling: keyboard matrix + joystick with "hold until the program has seen it" semantics.

// C64 keyboard matrix: MATRIX[paBit] = keys for pbBit 0..7
const MATRIX = [
  ['DEL', 'RETURN', 'RIGHT', 'F7', 'F1', 'F3', 'F5', 'DOWN'],
  ['3', 'W', 'A', '4', 'Z', 'S', 'E', 'LSHIFT'],
  ['5', 'R', 'D', '6', 'C', 'F', 'T', 'X'],
  ['7', 'Y', 'G', '8', 'B', 'H', 'U', 'V'],
  ['9', 'I', 'J', '0', 'M', 'K', 'O', 'N'],
  ['+', 'P', 'L', '-', '.', ':', '@', ','],
  ['£', '*', ';', 'HOME', 'RSHIFT', '=', '^', '/'],
  ['1', '<-', 'CTRL', '2', 'SPACE', 'C=', 'Q', 'STOP'],
];
export const KEYPOS = {};
MATRIX.forEach((row, pa) => row.forEach((k, pb) => { KEYPOS[k] = [pa, pb]; }));

// characters that need SHIFT on the C64 keyboard
const SHIFTED = { '!': '1', '"': '2', '#': '3', '$': '4', '%': '5', '&': '6', "'": '7', '(': '8', ')': '9', '[': ':', ']': ';', '<': ',', '>': '.', '?': '/', 'UP': 'DOWN', 'LEFT': 'RIGHT', 'CLR': 'HOME' };

// Map a client key name to a list of matrix keys to hold together.
export function keyCombo(k) {
  if (KEYPOS[k]) return [k];
  if (k === ' ') return ['SPACE'];
  if (k === '\r' || k === 'Enter') return ['RETURN'];
  if (k === 'Backspace') return ['DEL'];
  if (/^[a-z]$/.test(k)) return [k.toUpperCase()];
  if (/^[A-Z]$/.test(k)) return ['LSHIFT', k];
  if (SHIFTED[k]) return ['LSHIFT', SHIFTED[k]];
  return null;
}

const JOY = { up: 1, down: 2, left: 4, right: 8, fire: 16 };

export class InputScheduler {
  constructor(c64) {
    this.c = c64;
    this.queue = [];     // steps: {kind:'joy', bits, minReads, minFrames} | {kind:'key', combo, frames} | {kind:'wait', frames}
    this.cur = null;
    this.held = 0;       // currently held joystick bits (manual hold mode)
  }
  clear() { this.queue = []; this.cur = null; this.c.joy = [0xff, 0xff]; this.c.keys.fill(0); this.held = 0; }

  // A joystick "tap": held until the game has polled the stick, then released until polled again.
  joyTap(dir) {
    const bits = JOY[dir] || 0;
    this.queue.push({ kind: 'joy', bits, reads: 2, frames: 2, max: 150 });
    this.queue.push({ kind: 'joy', bits: 0, reads: 2, frames: 2, max: 50 });
  }
  joyHold(dir, on) { // continuous hold (e.g. scrolling the battle map)
    const b = JOY[dir] || 0;
    this.held = on ? (this.held | b) : (this.held & ~b);
    if (!this.cur && !this.queue.length) this.apply(this.held);
  }
  key(k) {
    const combo = keyCombo(k); if (!combo) return;
    this.queue.push({ kind: 'key', combo, frames: 4 });
    this.queue.push({ kind: 'key', combo: [], frames: 3 });
  }
  apply(bits) { const v = 0xff & ~bits; this.c.joy = [v, v]; }

  // called once per emulated frame (before runFrame)
  tick() {
    const c = this.c;
    if (!this.cur) {
      this.cur = this.queue.shift() || null;
      if (!this.cur) { this.apply(this.held); return; }
      this.cur.startReads = c.joyReads; this.cur.n = 0;
      if (this.cur.kind === 'joy') this.apply(this.cur.bits | this.held);
      if (this.cur.kind === 'key') { c.keys.fill(0); for (const k of this.cur.combo) { const [pa, pb] = KEYPOS[k]; c.keys[pa] |= 1 << pb; } }
    }
    const s = this.cur; s.n++;
    let done = false;
    if (s.kind === 'joy') done = (s.n >= s.frames && c.joyReads - s.startReads >= s.reads) || s.n >= s.max;
    else done = s.n >= s.frames;
    if (done) { if (s.kind === 'key') c.keys.fill(0); this.cur = null; }
  }
  busy() { return !!this.cur || this.queue.length > 0; }
}

// Compact MOS 6581 SID approximation as an AudioWorklet.
// Receives register writes (with C64 frame number + cycle) from the server and plays them in time.

const CLOCK = 985248, FRAME_CYCLES = 19656;
const ATTACK_MS = [2, 8, 16, 24, 38, 56, 68, 80, 100, 250, 500, 800, 1000, 3000, 5000, 8000];
const DECAY_MS = [6, 24, 48, 72, 114, 168, 204, 240, 300, 750, 1500, 2400, 3000, 9000, 15000, 24000];

class Voice {
  constructor() {
    this.freq = 0; this.pw = 0; this.ctrl = 0; this.ad = 0; this.sr = 0;
    this.acc = 0; this.noise = 0x7ffff8; this.noiseOut = 0;
    this.env = 0; this.state = 'release';
  }
}

class SID extends AudioWorkletProcessor {
  constructor() {
    super();
    this.v = [new Voice(), new Voice(), new Voice()];
    this.regs = new Uint8Array(32);
    this.queue = []; this.qi = 0;
    this.sample = 0; this.base = null; this.f0 = 0;
    this.spf = sampleRate * FRAME_CYCLES / CLOCK;
    this.cyclesPerSample = CLOCK / sampleRate;
    this.lp = 0; this.bp = 0;
    this.port.onmessage = (e) => this.feed(e.data);
  }
  feed(buf) {
    const dv = new DataView(buf); let o = 1;
    const lat = 0.09 * sampleRate;
    while (o < buf.byteLength) {
      const f = dv.getUint32(o, true), n = dv.getUint16(o + 4, true); o += 6;
      let pos = this.base === null ? -1 : this.base + (f - this.f0) * this.spf;
      if (this.base === null || pos < this.sample || pos > this.sample + 0.6 * sampleRate) {
        this.base = this.sample + lat; this.f0 = f; pos = this.base;
      }
      for (let i = 0; i < n; i++) {
        const cyc = dv.getUint16(o, true), r = dv.getUint8(o + 2), val = dv.getUint8(o + 3); o += 4;
        this.queue.push(pos + cyc / this.cyclesPerSample, r, val);
      }
    }
  }
  write(r, val) {
    this.regs[r] = val;
    if (r < 21) {
      const v = this.v[(r / 7) | 0], k = r % 7;
      if (k === 0) v.freq = (v.freq & 0xff00) | val;
      else if (k === 1) v.freq = (v.freq & 0xff) | (val << 8);
      else if (k === 2) v.pw = (v.pw & 0xf00) | val;
      else if (k === 3) v.pw = (v.pw & 0xff) | ((val & 15) << 8);
      else if (k === 4) {
        const was = v.ctrl & 1; v.ctrl = val;
        if (!was && (val & 1)) v.state = 'attack';
        else if (was && !(val & 1)) v.state = 'release';
        if (val & 8) { v.acc = 0; }
      }
      else if (k === 5) v.ad = val; else if (k === 6) v.sr = val;
    }
  }
  envStep(v, dt) {
    if (v.state === 'attack') {
      v.env += dt / (ATTACK_MS[v.ad >> 4] / 1000);
      if (v.env >= 1) { v.env = 1; v.state = 'decay'; }
    } else if (v.state === 'decay') {
      const s = (v.sr >> 4) / 15;
      if (v.env > s) { v.env -= (v.env - s + 0.02) * dt / (DECAY_MS[v.ad & 15] / 1000) * 3; if (v.env < s) v.env = s; }
    } else if (v.state === 'release') {
      if (v.env > 0) { v.env -= (v.env + 0.02) * dt / (DECAY_MS[v.sr & 15] / 1000) * 3; if (v.env < 0) v.env = 0; }
    }
  }
  process(_, outputs) {
    const out = outputs[0][0]; const dt = 1 / sampleRate;
    const q = this.queue;
    const vol = () => (this.regs[24] & 15) / 15;
    for (let i = 0; i < out.length; i++) {
      while (this.qi < q.length && q[this.qi] <= this.sample) { this.write(q[this.qi + 1], q[this.qi + 2]); this.qi += 3; }
      let mixF = 0, mixD = 0;
      const filt = this.regs[23], mode = this.regs[24];
      for (let n = 0; n < 3; n++) {
        const v = this.v[n];
        const prevAcc = v.acc;
        v.acc = (v.acc + v.freq * this.cyclesPerSample) % 16777216;
        if ((v.acc & 0x80000) && !(prevAcc & 0x80000) || (v.freq * this.cyclesPerSample > 0x80000)) {
          const b = ((v.noise >> 22) ^ (v.noise >> 17)) & 1; v.noise = ((v.noise << 1) | b) & 0x7fffff;
          v.noiseOut = (((v.noise >> 22) & 1) << 7 | ((v.noise >> 20) & 1) << 6 | ((v.noise >> 16) & 1) << 5 | ((v.noise >> 13) & 1) << 4 | ((v.noise >> 11) & 1) << 3 | ((v.noise >> 7) & 1) << 2 | ((v.noise >> 4) & 1) << 1 | ((v.noise >> 2) & 1)) / 255;
        }
        if ((v.ctrl & 2)) { const src = this.v[(n + 2) % 3]; if (src.acc < src.freq * this.cyclesPerSample) v.acc = 0; }
        this.envStep(v, dt);
        if (v.ctrl & 8) continue;
        const ph = v.acc / 16777216;
        let w = -1, cnt = 0, acc = 1;
        if (v.ctrl & 0x10) { let t = ph < .5 ? ph * 2 : 2 - ph * 2; if (v.ctrl & 4) { const r = this.v[(n + 2) % 3].acc / 16777216; if (r >= .5) t = 1 - t; } acc = Math.min(acc, t); cnt++; }
        if (v.ctrl & 0x20) { acc = Math.min(acc, ph); cnt++; }
        if (v.ctrl & 0x40) { acc = Math.min(acc, ph * 4096 >= v.pw ? 1 : 0); cnt++; }
        if (v.ctrl & 0x80) { acc = cnt ? 0 : v.noiseOut; cnt++; }
        if (cnt) w = acc * 2 - 1; else w = 0;
        const s = w * v.env;
        if (n === 2 && (mode & 0x80) && !(filt & 4)) continue;
        if (filt & (1 << n)) mixF += s; else mixD += s;
      }
      // simple state-variable filter
      if (filt & 7) {
        const fcReg = (this.regs[21] & 7) | (this.regs[22] << 3);
        const fc = 30 + fcReg * 5.8;
        const f = Math.min(0.9, 2 * Math.sin(Math.PI * fc / sampleRate));
        const res = 1.4 - ((filt >> 4) / 15) * 1.2;
        const hp = mixF - this.lp - res * this.bp;
        this.bp += f * hp; this.lp += f * this.bp;
        let o = 0; if (mode & 0x10) o += this.lp; if (mode & 0x20) o += this.bp; if (mode & 0x40) o += hp;
        mixF = o;
      }
      out[i] = (mixF + mixD) * vol() * 0.22;
      this.sample++;
    }
    if (this.qi > 3000) { this.queue = q.slice(this.qi); this.qi = 0; }
    return true;
  }
}
registerProcessor('sid', SID);

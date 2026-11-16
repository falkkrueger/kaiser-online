// Kaiser-specific knowledge: reading game state from the running original BASIC program
// and translating clicks into joystick actions. Line numbers refer to the original listing.

const ARROW = { 30: 'up', 27: 'down', 28: 'right', 31: 'left' };

export function screenCodes(c) {
  const base = c.vicBank() + ((c.vic[0x18] >> 4) & 15) * 1024;
  return c.ram.subarray(base, base + 1000);
}

const between = (l, a, b) => l >= a && l <= b;

function buttonPrompt(scr) { // big "KNOPF DRÜCKEN!" (2x2 font) in row 23
  const r = scr.subarray(23 * 40, 24 * 40);
  for (let i = 0; i < 36; i++) if (r[i] === 54 && r[i + 1] === 55 && r[i + 2] === 60 && r[i + 3] === 61) return true;
  return false;
}

// Which menu / input mode is active?
export function context(c) {
  const line = c.basicLine();
  const ctx = { line, mode: 'none' };
  if (line < 0) return ctx;
  const scr = screenCodes(c);
  ctx.prompt = buttonPrompt(scr);
  if (line === 29 || line === 862 || between(line, 879, 883)) ctx.mode = 'keyboard';
  else if (between(line, 18, 31) && c.getVar('C3') !== undefined) {
    const C3 = c.getVar('C3'), X = c.getVar('X'), Y = c.getVar('Y'), AR = c.getVar('AR');
    const digits = []; for (let i = 0; i < C3; i++) digits.push(c.getArray('SL', i) || 0);
    ctx.mode = 'number'; ctx.num = { c3: C3, x: X, y: Y, ar: AR, digits };
  } else if (between(line, 581, 585)) { ctx.mode = 'cursor'; ctx.cursor = { q: c.getVar('Q'), min: 1, max: 8 }; }
  else if (between(line, 657, 663)) { ctx.mode = 'cursor'; ctx.cursor = { q: c.getVar('Q'), min: 1, max: 4 }; }
  else if (between(line, 679, 683)) { ctx.mode = 'cursor'; ctx.cursor = { q: c.getVar('Q'), min: 0, max: c.getVar('N') }; }
  else if (between(line, 37, 40) || line === 147 || line === 773 || line === 797 || line === 727) ctx.mode = 'fire';
  else if (between(line, 353, 388) || between(line, 45, 49)) ctx.mode = 'battle';
  else ctx.mode = 'menu';
  return ctx;
}

// Which player (index into the game's arrays) is in control right now? -1 = anyone.
export function controller(c, ctx) {
  const N = c.getVar('N'), C = c.getVar('C');
  if (N === undefined || C === undefined || C < 0) return -1;
  if (between(ctx.line, 864, 883)) return -1;           // game setup
  if (between(ctx.line, 353, 388)) {                     // battle: attacker (I=0) / defender (I=1) place troops
    const I = c.getVar('I'), H = c.getVar('H');
    return I === 1 && H !== undefined ? H : C;
  }
  return C > N ? -1 : C;
}

export function players(c) {
  const N = c.getVar('N'); const F = c.getVar('F$') || '';
  if (N === undefined) return [];
  const out = [];
  for (let i = 0; i <= N; i++) {
    const len = c.getArray('A6', i) || 0;
    let name = F.substr(i * 10, len || 10).trim();
    if (!name) continue;
    out.push({ idx: i, name: petsciiToText(name), title: c.getArray('T', i), male: c.getArray('A7', i) === -1 });
  }
  return out;
}

export function petsciiToText(s) {
  // names are stored as shifted PETSCII (uppercase in the lowercase charset)
  return Array.from(s, ch => { const v = ch.charCodeAt(0); if (v >= 0xc1 && v <= 0xda) return String.fromCharCode(v - 0x80); if (v >= 0x41 && v <= 0x5a) return String.fromCharCode(v + 32); return ch; }).join('');
}

// Hotspots shown to the client (clickable screen areas).
export function hotspots(c, ctx) {
  const scr = screenCodes(c), hs = [];
  if (ctx.mode === 'number') {
    const { x, y, c3 } = ctx.num; hs.push({ row: y, c0: x, c1: x + c3 - 1, kind: 'digits' });
  } else if (ctx.mode === 'cursor') {
    const { min, max } = ctx.cursor;
    for (let q = min; q <= max; q++) hs.push({ row: 6 + 2 * q, c0: 0, c1: 39, kind: 'item' });
  } else if (ctx.mode === 'menu' || ctx.mode === 'fire') {
    for (let r = 0; r < 25; r++) {
      if (r === 23 && ctx.prompt) continue;
      for (let x = 0; x < 40; x++) {
        const v = scr[r * 40 + x] & 0x7f;
        if (ARROW[v] && (scr[r * 40 + x + 1] === 46 || scr[r * 40 + x + 1] === 32) && rowHasText(scr, r, x + 1)) { hs.push({ row: r, c0: x, c1: lastText(scr, r), kind: 'arrow', dir: ARROW[v] }); break; }
      }
    }
  }
  if (ctx.prompt) hs.push({ row: 23, c0: 0, c1: 39, kind: 'fire' });
  return hs;
}
function rowHasText(scr, r, from) { for (let x = from; x < 40; x++) { const v = scr[r * 40 + x] & 0x7f; if (v >= 1 && v <= 26) return true; } return false; }
function lastText(scr, r) { for (let x = 39; x >= 0; x--) if (scr[r * 40 + x] !== 32) return x; return 39; }

// Translate a click on (col,row) into a list of joystick taps.
export function resolveClick(c, ctx, col, row, fy) {
  const hs = hotspots(c, ctx);
  const h = hs.find(h => h.row === row && col >= h.c0 - 1 && col <= h.c1 + 1) || hs.find(h => h.kind === 'item' && h.row === row + 1);
  if (ctx.mode === 'fire' && (!h || h.kind === 'fire')) return ['fire'];
  if (!h) return [];
  if (h.kind === 'fire') return ['fire'];
  if (h.kind === 'arrow') return [h.dir];
  if (h.kind === 'item') {
    const target = (h.row - 6) / 2, q = ctx.cursor.q, taps = [];
    const dir = target < q ? 'up' : 'down';
    for (let i = 0; i < Math.abs(target - q); i++) taps.push(dir);
    taps.push('fire');
    return taps;
  }
  if (h.kind === 'digits') {
    const { x, c3, ar } = ctx.num;
    const pos = Math.max(0, Math.min(c3 - 1, x + c3 - 1 - col)); // AR index of clicked digit
    const taps = [];
    for (let i = ar; i < pos; i++) taps.push('left');
    for (let i = ar; i > pos; i--) taps.push('right');
    taps.push(fy < 0.5 ? 'up' : 'down');
    return taps;
  }
  return [];
}

// Enter a complete number in the joystick digit editor (lines 18-31), optionally confirm.
export function numberTaps(ctx, value, confirm = true) {
  const { c3, ar, digits } = ctx.num;
  const want = String(Math.max(0, Math.floor(value))).padStart(c3, '0').slice(-c3).split('').reverse().map(Number);
  const taps = []; let pos = ar;
  // visit positions starting at the current one, going left (higher digits), then back right
  const order = []; for (let i = 0; i < c3; i++) order.push(i);
  order.sort((a, b) => Math.abs(a - ar) - Math.abs(b - ar));
  for (const p of order) {
    if (digits[p] === want[p]) continue;
    while (pos < p) { taps.push('left'); pos++; }
    while (pos > p) { taps.push('right'); pos--; }
    const d = (want[p] - digits[p] + 10) % 10;
    if (d <= 5) for (let i = 0; i < d; i++) taps.push('up'); else for (let i = 0; i < 10 - d; i++) taps.push('down');
  }
  if (confirm) taps.push('fire');
  return taps;
}

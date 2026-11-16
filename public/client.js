// Kaiser Online – browser client. Shows the server-side C64, sends clicks/joystick/keys.

const PALETTE = [0x000000, 0xffffff, 0x813338, 0x75cec8, 0x8e3c97, 0x56ac4d, 0x2e2c9b, 0xedf171,
  0x8e5029, 0x553800, 0xc46c71, 0x4a4a4a, 0x7b7b7b, 0xa9ff9f, 0x706deb, 0xb2b2b2];
const FB_W = 384, FB_H = 272;
const TEXT_X0 = 32, TEXT_Y0 = 35;   // framebuffer position of character cell (0,0)

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const room = (params.get('room') || 'kaiser').toLowerCase();
let nick = localStorage.getItem('kaiser.nick') || '';
let status = null, ws = null, audio = null;

// ---------------------------------------------------------------- C64 font
let charset = null;
const ARROWS = { // extra glyphs for UI (8x8)
  '▲': [0x18, 0x3c, 0x7e, 0xff, 0x18, 0x18, 0x18, 0x00], '▼': [0x18, 0x18, 0x18, 0xff, 0x7e, 0x3c, 0x18, 0x00],
  '◀': [0x10, 0x30, 0x7f, 0xff, 0x7f, 0x30, 0x10, 0x00], '▶': [0x08, 0x0c, 0xfe, 0xff, 0xfe, 0x0c, 0x08, 0x00],
};
function screenCode(ch) {
  const c = ch.charCodeAt(0);
  if (ch === '@') return 0;
  if (c >= 97 && c <= 122) return c - 96;
  if (c >= 65 && c <= 90) return c;
  if (ch === '£') return 28; if (ch === '^') return 30;
  if (c >= 32 && c <= 63) return c;
  return 32;
}
const UML = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', 'ß': 'ss' };
function textCanvas(text, fg = 14, bg = null) {
  text = String(text).replace(/[äöüÄÖÜß]/g, m => UML[m]);
  const cv = document.createElement('canvas'); cv.className = 'txt';
  cv.width = Math.max(1, text.length * 8); cv.height = 8;
  const ctx = cv.getContext('2d'); const img = ctx.createImageData(cv.width, 8);
  const f = PALETTE[fg], b = bg == null ? null : PALETTE[bg];
  [...text].forEach((ch, i) => {
    const rows = ARROWS[ch] || (charset ? charset.subarray(2048 + screenCode(ch) * 8, 2048 + screenCode(ch) * 8 + 8) : new Uint8Array(8));
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const on = rows[y] & (0x80 >> x), o = (y * cv.width + i * 8 + x) * 4;
      const col = on ? f : b; if (col == null) continue;
      img.data[o] = col >> 16; img.data[o + 1] = (col >> 8) & 255; img.data[o + 2] = col & 255; img.data[o + 3] = 255;
    }
  });
  ctx.putImageData(img, 0, 0);
  cv.style.setProperty('--n', text.length);
  return cv;
}
function setText(el, text, fg) { el.replaceChildren(textCanvas(text, fg ?? (+el.dataset.fg || 14))); }
function paintStatic() { document.querySelectorAll('[data-t]').forEach(el => setText(el, el.dataset.t)); }

// ---------------------------------------------------------------- screen
const screen = $('#screen'), sctx = screen.getContext('2d');
const overlay = $('#overlay'), octx = overlay.getContext('2d');
const fb = new Uint8Array(FB_W * FB_H);
const img = sctx.createImageData(FB_W, FB_H);
const pal32 = new Uint32Array(PALETTE.map(c => 0xff000000 | ((c & 255) << 16) | (c & 0xff00) | (c >> 16)));
const img32 = new Uint32Array(img.data.buffer);

async function inflate(buf) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([buf]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
let frameChain = Promise.resolve();
function onFrame(buf) {
  const dv = new DataView(buf); const y0 = dv.getUint16(1, true), y1 = dv.getUint16(3, true);
  frameChain = frameChain.then(async () => {
    const rows = await inflate(buf.slice(5));
    fb.set(rows, y0 * FB_W);
    for (let i = y0 * FB_W, e = (y1 + 1) * FB_W; i < e; i++) img32[i] = pal32[fb[i] & 15];
    sctx.putImageData(img, 0, 0, 0, y0, FB_W, y1 - y0 + 1);
  });
}

// hover highlight of clickable areas
let hover = null;
function cellFromEvent(e) {
  const r = overlay.getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width * FB_W, py = (e.clientY - r.top) / r.height * FB_H;
  const col = Math.floor((px - TEXT_X0) / 8), row = Math.floor((py - TEXT_Y0) / 8);
  const fy = ((py - TEXT_Y0) / 8) - row;
  return { col, row, fy };
}
function hotAt(col, row) {
  if (!status) return null;
  return status.hot.find(h => h.row === row && col >= h.c0 - 1 && col <= h.c1 + 1)
    || status.hot.find(h => h.kind === 'item' && h.row === row + 1) || null;
}
function drawOverlay() {
  octx.clearRect(0, 0, FB_W, FB_H);
  if (!status || !hover) return;
  const h = hotAt(hover.col, hover.row);
  if (!h) return;
  octx.strokeStyle = 'rgba(255,255,255,.85)'; octx.lineWidth = 1;
  if (h.kind === 'digits') {
    const x = TEXT_X0 + Math.max(h.c0, Math.min(h.c1, hover.col)) * 8, y = TEXT_Y0 + h.row * 8;
    octx.fillStyle = 'rgba(255,255,255,.25)';
    octx.fillRect(x, y + (hover.fy < .5 ? -8 : 8), 8, 8);
    octx.strokeRect(x - .5, y - 8.5, 9, 25);
    octx.fillStyle = '#fff'; octx.font = '8px monospace';
    octx.fillText(hover.fy < .5 ? '+' : '-', x + 2, hover.fy < .5 ? y - 1 : y + 15);
  } else {
    const x0 = TEXT_X0 + Math.max(0, h.c0 - 1) * 8, x1 = TEXT_X0 + Math.min(40, h.c1 + 2) * 8;
    octx.strokeRect(x0 - .5, TEXT_Y0 + h.row * 8 - 1.5, x1 - x0 + 1, 11);
  }
}
overlay.addEventListener('pointermove', e => { hover = cellFromEvent(e); drawOverlay(); });
overlay.addEventListener('pointerleave', () => { hover = null; drawOverlay(); });
overlay.addEventListener('click', e => {
  const c = cellFromEvent(e);
  if (status && status.mode === 'fire') return send({ t: 'click', ...c });
  if (!hotAt(c.col, c.row)) return;
  send({ t: 'click', ...c });
  audioUnlock();
});

// ---------------------------------------------------------------- network
function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?room=${encodeURIComponent(room)}&nick=${encodeURIComponent(nick)}`);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => { if (audio) send({ t: 'audio', on: true }); };
  ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') {
      const m = JSON.parse(ev.data);
      if (m.t === 'status') onStatus(m);
      else if (m.t === 'deny') flashDeny(m.msg);
      return;
    }
    const kind = new Uint8Array(ev.data, 0, 1)[0];
    if (kind === 1) onFrame(ev.data);
    else if (kind === 2 && audio) audio.feed(ev.data);
  };
  ws.onclose = () => { setText($('#roomInfo'), 'VERBINDUNG WEG...', 10); setTimeout(connect, 1500); };
}
let denyTimer;
function flashDeny(msg) {
  const el = $('#denyMsg'); setText(el, msg, 1); el.hidden = false;
  clearTimeout(denyTimer); denyTimer = setTimeout(() => el.hidden = true, 1800);
}

// ---------------------------------------------------------------- status / players
let lastCtrlMine = false;
function mySeats() { return Object.entries(status?.seats || {}).filter(([, n]) => n === nick).map(([i]) => +i); }
function onStatus(s) {
  const prev = status; status = s; window.__kaiser = s;
  setText($('#roomInfo'), `RAUM ${s.room.toUpperCase()}  ${s.users.length} DA${s.year ? '  JAHR ' + s.year : ''}`, 15);
  renderPlayers();
  // number entry box
  const nb = $('#numBox');
  if (s.mode === 'number') { if (nb.hidden) { numBuf = ''; } nb.hidden = false; renderNum(); } else nb.hidden = true;
  // turn banner + notification
  const ctrlNick = s.ctrl >= 0 ? s.seats[s.ctrl] : null;
  const mine = s.ctrl >= 0 && ctrlNick === nick;
  const banner = $('#turnBanner');
  if (s.paused) {
    banner.hidden = false; banner.style.animation = 'none';
    banner.replaceChildren(textCanvas(`C64 WARTET AUF ${s.paused.toUpperCase()} (OFFLINE)`, 2));
  } else if (s.ctrl >= 0) {
    const p = s.players.find(p => p.idx === s.ctrl);
    banner.hidden = false;
    banner.replaceChildren(textCanvas(mine ? `DU BIST DRAN, ${(p?.name || '').toUpperCase()}!` : `AM ZUG: ${(p?.name || '?').toUpperCase()}${ctrlNick ? ' (' + ctrlNick + ')' : ''}`, mine ? 0 : 6));
    banner.style.animation = mine ? '' : 'none';
  } else banner.hidden = true;
  if (mine && !lastCtrlMine && prev) notifyTurn(s);
  lastCtrlMine = mine;
  $('#chkFree').checked = s.free;
  $('#chkPause').checked = s.pauseAbsent;
  $('#tgLine').hidden = !s.telegram;
  document.querySelectorAll('.speed').forEach(b => b.classList.toggle('on', +b.dataset.v === s.speed));
  drawOverlay();
}
function renderPlayers() {
  const box = $('#whoBox'); box.replaceChildren();
  const s = status;
  if (!s.players.length) {
    box.append(textCanvas('NOCH KEINE HERRSCHER', 15));
    const u = document.createElement('div'); u.style.marginTop = '6px';
    u.append(textCanvas('ONLINE: ' + s.users.join(', ').slice(0, 34), 3)); box.append(u);
    return;
  }
  for (const p of s.players) {
    const d = document.createElement('div'); d.className = 'pl' + (p.idx === s.ctrl ? ' cur' : '');
    const who = document.createElement('div'); who.className = 'who';
    who.append(textCanvas(`${p.idx + 1}. ${p.name}`, p.idx === s.ctrl ? 7 : 1));
    const owner = s.seats[p.idx];
    who.append(textCanvas(owner ? (owner === nick ? 'DU' : owner) + (s.users.includes(owner) ? '' : ' (OFFLINE)') : 'FREI', owner === nick ? 13 : 15));
    d.append(who);
    const b = document.createElement('button'); b.className = 'c64btn';
    const isMine = owner === nick;
    b.append(textCanvas(isMine ? 'NICHT ICH' : 'DAS BIN ICH', 1));
    b.onclick = () => send({ t: 'seat', idx: p.idx, on: !isMine });
    d.append(b); box.append(d);
  }
}
function notifyTurn(s) {
  beep();
  if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
  if (localStorage.getItem('kaiser.notify') === '1' && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    const p = s.players.find(p => p.idx === s.ctrl);
    new Notification('Kaiser: Du bist dran!', { body: `${p ? p.name : ''} – Jahr ${s.year || ''}`, tag: 'kaiser-turn' });
  }
  document.title = '► Du bist dran – Kaiser';
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) document.title = 'Kaiser Online'; });

// ---------------------------------------------------------------- number entry
let numBuf = '';
function renderNum() {
  const n = status.num; const len = n.c3;
  const cur = n.digits.slice().reverse().join('');
  const shown = numBuf ? numBuf.padStart(len, ' ') : cur;
  $('#numDisplay').replaceChildren(textCanvas(shown, numBuf ? 7 : 15));
}
function buildNumPad() {
  const pad = $('#numPad');
  for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'DEL', '0', 'OK']) {
    const b = document.createElement('button'); b.className = 'c64btn';
    b.append(textCanvas(k, k === 'OK' ? 7 : 1));
    b.onclick = () => numKey(k);
    pad.append(b);
  }
}
function numKey(k) {
  if (!status || status.mode !== 'number') return;
  if (k === 'DEL') numBuf = numBuf.slice(0, -1);
  else if (k === 'OK') { send({ t: 'number', v: numBuf ? +numBuf : +status.num.digits.slice().reverse().join(''), confirm: true }); numBuf = ''; }
  else if (numBuf.length < status.num.c3) numBuf += k;
  renderNum();
}

// ---------------------------------------------------------------- joystick pad
function bindDir(btn) {
  const dir = btn.dataset.dir; let t = null, holding = false;
  btn.addEventListener('pointerdown', e => {
    e.preventDefault(); audioUnlock(); btn.setPointerCapture(e.pointerId);
    t = setTimeout(() => { holding = true; send({ t: 'hold', dir, on: true }); }, 400);
  });
  const up = () => {
    if (t) clearTimeout(t); t = null;
    if (holding) send({ t: 'hold', dir, on: false }); else send({ t: 'joy', dir });
    holding = false;
  };
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', () => { if (t) clearTimeout(t); if (holding) send({ t: 'hold', dir, on: false }); holding = false; });
}
document.querySelectorAll('#dpad .dir').forEach(bindDir);
$('#fire').addEventListener('click', () => { audioUnlock(); send({ t: 'joy', dir: 'fire' }); });
$('#btnF1').addEventListener('click', () => send({ t: 'key', k: 'F1' }));

// ---------------------------------------------------------------- on-screen keyboard
const KBD = [['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], ['Q', 'W', 'E', 'R', 'T', 'Z', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'], ['Y', 'X', 'C', 'V', 'B', 'N', 'M', 'DEL'], ['SPACE', 'RETURN']];
function buildKbd() {
  const k = $('#kbd');
  for (const row of KBD) {
    const r = document.createElement('div'); r.className = 'krow';
    for (const key of row) {
      const b = document.createElement('button'); b.className = 'c64btn';
      b.append(textCanvas(key === 'SPACE' ? ' LEER ' : key, 1));
      if (key === 'SPACE') b.style.flex = '4';
      b.onclick = () => send({ t: 'key', k: key.length === 1 ? key.toLowerCase() : key });
      r.append(b);
    }
    k.append(r);
  }
}
$('#btnKbd').onclick = () => { $('#kbd').hidden = !$('#kbd').hidden; $('#btnKbd').classList.toggle('on', !$('#kbd').hidden); };

// physical keyboard
const KEYDIR = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
let lastTap = 0;
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  audioUnlock();
  const mode = status?.mode;
  if (KEYDIR[e.key]) {
    e.preventDefault();
    const now = performance.now();
    if (e.repeat && now - lastTap < 140) return;
    lastTap = now; send({ t: 'joy', dir: KEYDIR[e.key] }); return;
  }
  if (mode === 'number') {
    if (/^[0-9]$/.test(e.key)) { numKey(e.key); e.preventDefault(); return; }
    if (e.key === 'Backspace') { numKey('DEL'); e.preventDefault(); return; }
    if (e.key === 'Enter') { numKey('OK'); e.preventDefault(); return; }
  }
  if (mode !== 'keyboard' && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); if (!e.repeat) send({ t: 'joy', dir: 'fire' }); return; }
  if (e.key === 'F1') { e.preventDefault(); send({ t: 'key', k: 'F1' }); return; }
  if (e.key.length === 1 || e.key === 'Enter' || e.key === 'Backspace') { e.preventDefault(); send({ t: 'key', k: e.key }); }
});

// ---------------------------------------------------------------- menu
$('#btnMenu').onclick = () => { $('#nickIn').value = nick; $('#tgIn').value = localStorage.getItem('kaiser.tg') || ''; $('#chkNotify').checked = localStorage.getItem('kaiser.notify') === '1'; $('#menu').hidden = false; };
$('#btnClose').onclick = () => {
  const n = $('#nickIn').value.trim().slice(0, 20);
  if (n && n !== nick) {
    // carry seats over to the new name
    const mine = mySeats(); nick = n; localStorage.setItem('kaiser.nick', nick); send({ t: 'nick', nick });
    mine.forEach(i => send({ t: 'seat', idx: i, on: true }));
  }
  const tg = $('#tgIn').value.trim();
  if (tg !== (localStorage.getItem('kaiser.tg') || '')) { localStorage.setItem('kaiser.tg', tg); send({ t: 'telegram', chat: tg }); }
  $('#menu').hidden = true;
};
$('#chkFree').onchange = (e) => send({ t: 'free', on: e.target.checked });
$('#chkPause').onchange = (e) => send({ t: 'pauseAbsent', on: e.target.checked });
$('#chkNotify').onchange = async (e) => {
  if (e.target.checked && 'Notification' in window && Notification.permission !== 'granted') {
    const p = await Notification.requestPermission(); if (p !== 'granted') e.target.checked = false;
  }
  localStorage.setItem('kaiser.notify', e.target.checked ? '1' : '0');
};
document.querySelectorAll('.speed').forEach(b => b.onclick = () => send({ t: 'speed', v: +b.dataset.v }));
$('#btnReset').onclick = () => {
  if (confirm('Den C64 wirklich neu starten? Das laufende Spiel geht verloren (außer es wurde mit F1 auf Diskette gespeichert).')) send({ t: 'reset', confirm: 'NEUSTART' });
};
$('#btnShare').onclick = async () => {
  const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(room)}`;
  try { await navigator.clipboard.writeText(url); setText($('#shareOk'), 'KOPIERT!', 13); } catch { prompt('Link für deine Freunde:', url); }
};

// ---------------------------------------------------------------- audio (SID)
function beep() {
  try {
    const ac = audio?.ctx || new AudioContext(); const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'square'; o.frequency.value = 880; g.gain.value = 0.08; o.connect(g).connect(ac.destination);
    o.start(); o.frequency.setValueAtTime(1320, ac.currentTime + 0.12); o.stop(ac.currentTime + 0.25);
  } catch { }
}
let wantSound = localStorage.getItem('kaiser.sound') !== '0';
async function startAudio() {
  if (audio) return;
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule('sid-worklet.js');
  const node = new AudioWorkletNode(ctx, 'sid', { outputChannelCount: [1] });
  node.connect(ctx.destination);
  audio = {
    ctx, node,
    feed(buf) { node.port.postMessage(buf, [buf]); },
  };
  send({ t: 'audio', on: true });
  setText($('#btnSound'), 'TON AN', 1);
}
function stopAudio() { if (!audio) return; audio.ctx.close(); audio = null; send({ t: 'audio', on: false }); setText($('#btnSound'), 'TON AUS', 1); }
function audioUnlock() { if (wantSound && !audio) startAudio().catch(() => { }); }
$('#btnSound').onclick = () => {
  if (audio) { wantSound = false; stopAudio(); } else { wantSound = true; startAudio(); }
  localStorage.setItem('kaiser.sound', wantSound ? '1' : '0');
};

// ---------------------------------------------------------------- boot
(async function init() {
  try { charset = new Uint8Array(await (await fetch('charset.bin')).arrayBuffer()); } catch { }
  paintStatic(); buildNumPad(); buildKbd();
  if (!nick) {
    nick = (prompt('Wie heißt du? (Name für die Mitspieler)') || '').trim().slice(0, 20) || 'Spieler' + Math.floor(Math.random() * 100);
    localStorage.setItem('kaiser.nick', nick);
  }
  connect();
  document.addEventListener('pointerdown', audioUnlock, { once: true });
})();

// Serverless mode (GitHub Pages): the host's browser runs the C64 in a Web Worker,
// friends connect directly to the host via WebRTC (PeerJS for the handshake).

const PEERJS_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
const ROM_BASE = 'https://raw.githubusercontent.com/VICE-Team/svn-mirror/main/vice/data/C64/';
const ROMS = { kernal: 'kernal-901227-03.bin', basic: 'basic-901226-01.bin', chargen: 'chargen-901225-01.bin' };
const D64_SIZES = [174848, 175531];

// ------------------------------------------------------------------ IndexedDB (key/value)
function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('kaiser-online', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
export async function idbGet(k) {
  const d = await db();
  return new Promise((res, rej) => { const r = d.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
export async function idbSet(k, v) {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}

// ------------------------------------------------------------------ media
export async function loadRoms(progress) {
  const out = {};
  for (const [k, f] of Object.entries(ROMS)) {
    let b = await idbGet('rom:' + k);
    if (!b) {
      progress && progress(`LADE C64-ROM ${k.toUpperCase()}...`);
      const r = await fetch(ROM_BASE + f);
      if (!r.ok) throw new Error(`ROM ${f}: HTTP ${r.status}`);
      b = new Uint8Array(await r.arrayBuffer());
      await idbSet('rom:' + k, b);
    }
    out[k] = new Uint8Array(b);
  }
  return out;
}

// Checks that a file is a .d64 with the Kaiser loader on it. Returns an error text or null.
export function checkDisk(bytes) {
  if (!D64_SIZES.includes(bytes.length)) return 'DAS IST KEIN D64-DISKETTENIMAGE';
  const off = (t, s) => { const spt = [0, ...Array(17).fill(21), ...Array(7).fill(19), ...Array(6).fill(18), ...Array(5).fill(17)]; let o = 0; for (let i = 1; i < t; i++) o += spt[i]; return (o + s) * 256; };
  const names = []; let t = 18, s = 1, guard = 0;
  while (t && guard++ < 20) {
    const b = bytes.subarray(off(t, s), off(t, s) + 256);
    for (let i = 0; i < 8; i++) { const e = b.subarray(i * 32, i * 32 + 32); if (e[2] & 7) names.push(String.fromCharCode(...e.subarray(5, 21)).replace(/\xa0+$/, '')); }
    t = b[0]; s = b[1];
  }
  if (!names.includes('KAISER')) return 'AUF DIESER DISKETTE IST KEIN KAISER';
  if (!names.includes('MOS')) return 'BITTE DIE ASS-VERSION DER DISKETTE NEHMEN';
  return null;
}

let peerLib = null;
function loadPeerJS() {
  if (peerLib) return peerLib;
  peerLib = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = PEERJS_URL;
    s.onload = () => res(window.Peer); s.onerror = () => rej(new Error('PeerJS konnte nicht geladen werden'));
    document.head.append(s);
  });
  return peerLib;
}
const toAB = (d) => d instanceof ArrayBuffer ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };

// ------------------------------------------------------------------ host
export async function startHost({ nick, media, state, onMessage, onInfo }) {
  const worker = new Worker(new URL('host-worker.js', import.meta.url), { type: 'module' });
  const conns = new Map(); // id -> conn
  let peer = null, peerId = localStorage.getItem('kaiser.hostId');
  if (!peerId) { peerId = 'kaiser-' + Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, '0')).join(''); localStorage.setItem('kaiser.hostId', peerId); }
  let exportWaiter = null;

  worker.onmessage = (e) => {
    const m = e.data;
    if (m.t === 'out') {
      if (m.id === 'me') { onMessage(typeof m.data === 'string' ? m.data : toAB(m.data)); return; }
      const c = conns.get(m.id); if (!c || !c.open) return;
      if (typeof m.data !== 'string' && c.dataChannel && c.dataChannel.bufferedAmount > 1_000_000) {
        if (!c.congested) { c.congested = true; worker.postMessage({ t: 'congested', id: m.id, on: true }); }
        return;
      }
      c.send(typeof m.data === 'string' ? m.data : toAB(m.data));
    } else if (m.t === 'save') idbSet('state', m.state).catch(e => console.warn('Speichern fehlgeschlagen', e));
    else if (m.t === 'export' && exportWaiter) { exportWaiter(m.state); exportWaiter = null; }
  };
  // re-open congested connections when their buffer drained
  setInterval(() => {
    for (const [id, c] of conns) if (c.congested && c.dataChannel && c.dataChannel.bufferedAmount < 200_000) { c.congested = false; worker.postMessage({ t: 'congested', id, on: false }); }
  }, 250);

  const copy = (u8) => new Uint8Array(u8);
  worker.postMessage({ t: 'init', media: { kernal: copy(media.kernal), basic: copy(media.basic), chargen: copy(media.chargen), disk: copy(media.disk) }, state });
  worker.postMessage({ t: 'join', id: 'me', nick });

  const charsetMsg = JSON.stringify({ t: 'charset', b64: b64(media.chargen) });
  function openPeer(Peer) {
    peer = new Peer(peerId, { debug: 1, ...(window.KAISER_PEER || {}) });
    peer.on('open', () => onInfo({ state: 'online', peerId }));
    peer.on('connection', (conn) => {
      const id = conn.connectionId;
      conn.on('open', () => {
        conns.set(id, conn);
        conn.send(charsetMsg);
        worker.postMessage({ t: 'join', id, nick: String(conn.metadata?.nick || 'Gast').slice(0, 20) });
      });
      conn.on('data', (d) => { if (typeof d === 'string') { try { worker.postMessage({ t: 'msg', id, m: JSON.parse(d) }); } catch { } } });
      const gone = () => { if (conns.delete(id)) worker.postMessage({ t: 'leave', id }); };
      conn.on('close', gone); conn.on('error', gone);
    });
    peer.on('disconnected', () => { onInfo({ state: 'reconnecting' }); setTimeout(() => !peer.destroyed && peer.reconnect(), 2000); });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') onInfo({ state: 'error', msg: 'DAS SPIEL LAEUFT SCHON IN EINEM ANDEREN TAB' });
      else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') onInfo({ state: 'reconnecting' });
      else console.warn('PeerJS', err.type, err);
    });
  }
  loadPeerJS().then(openPeer).catch(e => onInfo({ state: 'error', msg: 'KEINE VERBINDUNG ZUM VERMITTLUNGSDIENST' }));
  const saveNow = () => worker.postMessage({ t: 'saveNow' });
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

  return {
    peerId,
    send: (s) => worker.postMessage({ t: 'msg', id: 'me', m: JSON.parse(s) }),
    exportState: () => new Promise(res => { exportWaiter = res; worker.postMessage({ t: 'export' }); }),
    importState: (st) => worker.postMessage({ t: 'import', state: st }),
  };
}

// ------------------------------------------------------------------ guest
export async function startGuest({ hostId, nick, onMessage, onInfo }) {
  const Peer = await loadPeerJS();
  let conn = null, retry = null;
  const peer = new Peer({ debug: 1, ...(window.KAISER_PEER || {}) });
  const connect = () => {
    clearTimeout(retry);
    onInfo({ state: 'connecting' });
    conn = peer.connect(hostId, { reliable: true, metadata: { nick } });
    conn.on('open', () => onInfo({ state: 'online' }));
    conn.on('data', (d) => onMessage(typeof d === 'string' ? d : toAB(d)));
    conn.on('close', () => { onInfo({ state: 'lost' }); retry = setTimeout(connect, 3000); });
  };
  peer.on('open', connect);
  peer.on('disconnected', () => setTimeout(() => !peer.destroyed && peer.reconnect(), 2000));
  peer.on('error', (err) => {
    if (err.type === 'peer-unavailable') { onInfo({ state: 'hostOffline' }); retry = setTimeout(connect, 5000); }
    else console.warn('PeerJS', err.type, err);
  });
  return {
    send: (s) => { if (conn && conn.open) conn.send(s); },
    rename: (n) => { nick = n; },
  };
}

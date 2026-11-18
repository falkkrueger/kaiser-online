// Runs the C64 + room logic inside the host's browser (Web Worker, so it keeps running in background tabs).
import { Room } from '../emu/room.js';

let room = null;
const clients = new Map(); // id -> client

self.onmessage = (e) => {
  const m = e.data;
  switch (m.t) {
    case 'init':
      room = new Room('kaiser', {
        media: m.media, state: m.state, stopWhenEmpty: false, saveEvery: 3000,
        save: (state) => self.postMessage({ t: 'save', state }),
      });
      room.start();
      self.postMessage({ t: 'ready' });
      break;
    case 'join': {
      const client = {
        id: m.id, nick: m.nick || 'Gast', audio: false, budget: true,
        ok: () => client.budget,
        send: (data) => {
          if (typeof data === 'string') self.postMessage({ t: 'out', id: m.id, data });
          else { const copy = data.slice(); self.postMessage({ t: 'out', id: m.id, data: copy }, [copy.buffer]); }
        },
      };
      clients.set(m.id, client); room.join(client);
      break;
    }
    case 'leave': { const c = clients.get(m.id); if (c) { room.leave(c); clients.delete(m.id); } break; }
    case 'congested': { const c = clients.get(m.id); if (c) { c.budget = !m.on; if (m.on) c.stale = true; } break; }
    case 'msg': { const c = clients.get(m.id); if (c) room.handle(c, m.m); break; }
    case 'export': self.postMessage({ t: 'export', state: room.snapshot() }); break;
    case 'saveNow': room.save(); break;
    case 'import': room.load(m.state); break;
  }
};

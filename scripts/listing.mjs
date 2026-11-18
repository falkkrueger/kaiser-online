// Startet die Original-Diskette im Emulator und schreibt das BASIC-Listing des Hauptprogramms
// nach media/kaiser.bas (nur lokal – das Programm ist urheberrechtlich geschützt).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMachine, autostart } from '../emu/machine.js';
import { loadMedia } from '../emu/media-node.js';
import { InputScheduler } from '../emu/input.js';
import { listBasic } from '../emu/listing.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const c = createMachine(loadMedia(path.join(root, 'media')));
const inp = new InputScheduler(c);
autostart(c);
let pressed = false;
for (let f = 0; f < 50 * 180; f++) {
  inp.tick(); c.runFrame();
  const line = c.basicLine();
  if (line === 29 && !pressed) { inp.key('j'); pressed = true; }
  if (line === 862) break;
}
const out = path.join(root, 'media', 'kaiser.bas');
fs.writeFileSync(out, listBasic(c.ram));
console.log(`Listing geschrieben: ${out} (${fs.readFileSync(out, 'utf8').split('\n').length - 1} Zeilen)`);

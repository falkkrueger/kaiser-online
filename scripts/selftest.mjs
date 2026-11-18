// Selbsttest: bootet die Original-Diskette, beginnt ein Spiel mit 2 Spielern und kauft Korn per Joystick.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMachine, autostart } from '../emu/machine.js';
import { loadMedia } from '../emu/media-node.js';
import { InputScheduler } from '../emu/input.js';
import { context, numberTaps } from '../emu/kaiser.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const c = createMachine(loadMedia(path.join(root, 'media')));
const inp = new InputScheduler(c);
autostart(c);
const t0 = Date.now();
const until = (pred, max = 50 * 120) => {
  for (let f = 0; f < max; f++) { inp.tick(); c.runFrame(); if (!inp.busy() && pred()) return true; }
  throw new Error(`Zeitüberschreitung bei Zeile ${c.basicLine()}`);
};
const step = (msg) => console.log(`✓ ${msg}`);

until(() => c.basicLine() === 29); step('Vorspann geladen, "Neues Spiel (J/N)?"');
inp.key('j'); until(() => c.basicLine() === 862); step('Titelbild, "Wie viele Spieler"');
if (c.peek(767) === 0) throw new Error('Kopierschutz-Flag (767) nicht gesetzt');
step(`Kopierschutz-Flag 767 = ${c.peek(767)}`);
for (const k of ['2', '1', 'A', 'n', 'n', 'a', '\r', 'w', 'B', 'e', 'n', '\r', 'm']) inp.key(k);
until(() => c.basicLine() === 491); step('Namensvergabe, erste Runde (Menü Zeile 491)');
const before = c.getArray('P', 0);
inp.joyTap('up'); until(() => context(c).mode === 'number'); step('Joystick hoch -> "Wieviel Korn wollen Sie kaufen?"');
for (const d of numberTaps(context(c), 123)) inp.joyTap(d);
until(() => c.basicLine() === 491);
const after = c.getArray('P', 0);
if (after - before !== 123) throw new Error(`Korn: erwartet +123, bekommen ${after - before}`);
step(`123 Maß Korn gekauft (${before} -> ${after})`);
console.log(`Selbsttest bestanden in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

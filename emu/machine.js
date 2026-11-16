// Builds a C64 with ROMs + virtual drive and autostarts the disk.
import fs from 'node:fs';
import path from 'node:path';
import { C64 } from './c64.js';
import { VirtualDrive } from './drive.js';

export function loadMedia(dir) {
  const rd = (f) => new Uint8Array(fs.readFileSync(path.join(dir, f)));
  const romDir = 'roms';
  return {
    kernal: rd(path.join(romDir, 'kernal-901227-03.bin')),
    basic: rd(path.join(romDir, 'basic-901226-01.bin')),
    chargen: rd(path.join(romDir, 'chargen-901225-01.bin')),
    disk: rd('kaiser.d64'),
  };
}

export function createMachine(media) {
  const c64 = new C64(media);
  c64.drive = new VirtualDrive(media.disk);
  return c64;
}

export function autostart(c64) {
  // let KERNAL/BASIC boot (~2.5 s), then type the classic load command
  for (let i = 0; i < 130; i++) c64.runFrame();
  c64.type('LOAD"*",8,1\r');
}

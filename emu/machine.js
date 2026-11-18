// Builds a C64 with ROMs + virtual drive and autostarts the disk (platform neutral).
import { C64 } from './c64.js';
import { VirtualDrive } from './drive.js';

export const ROM_FILES = { kernal: 'kernal-901227-03.bin', basic: 'basic-901226-01.bin', chargen: 'chargen-901225-01.bin' };

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

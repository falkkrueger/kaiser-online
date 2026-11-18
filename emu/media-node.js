// Loads ROMs and the disk image from a directory (Node only).
import fs from 'node:fs';
import path from 'node:path';
import { ROM_FILES } from './machine.js';

export function loadMedia(dir) {
  const rd = (f) => new Uint8Array(fs.readFileSync(path.join(dir, f)));
  return {
    kernal: rd(path.join('roms', ROM_FILES.kernal)),
    basic: rd(path.join('roms', ROM_FILES.basic)),
    chargen: rd(path.join('roms', ROM_FILES.chargen)),
    disk: rd('kaiser.d64'),
  };
}

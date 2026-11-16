// Detokenizer for Commodore BASIC V2 programs in C64 memory (for studying the original program).
const TOKENS = 'END FOR NEXT DATA INPUT# INPUT DIM READ LET GOTO RUN IF RESTORE GOSUB RETURN REM STOP ON WAIT LOAD SAVE VERIFY DEF POKE PRINT# PRINT CONT LIST CLR CMD SYS OPEN CLOSE GET NEW TAB( TO FN SPC( THEN NOT STEP + - * / ^ AND OR > = < SGN INT ABS USR FRE POS SQR RND LOG EXP COS SIN TAN ATN PEEK LEN STR$ VAL ASC CHR$ LEFT$ RIGHT$ MID$ GO'.split(' ');
const CTRL = { 5: 'wht', 13: 'cr', 14: 'lower', 17: 'down', 18: 'rvon', 19: 'home', 20: 'del', 28: 'red', 29: 'rght', 30: 'grn', 31: 'blu', 129: 'orng', 142: 'upper', 144: 'blk', 145: 'up', 146: 'rvof', 147: 'clr', 149: 'brn', 150: 'lred', 151: 'gry1', 152: 'gry2', 153: 'lgrn', 154: 'lblu', 155: 'gry3', 156: 'pur', 157: 'left', 158: 'yel', 159: 'cyn' };
// Kaiser runs in the lower-case character set; its custom font puts arrows/umlauts on these codes.
const KAISER_CHARS = { 0x5b: '↓', 0x5c: '→', 0x5e: '↑', 0x5f: '←', 0xdb: 'Ü', 0xdc: 'ü', 0xdd: 'Ö', 0xdf: 'Ä', 0xa0: 'ä', 0xff: 'ö', 0xc0: 'ß' };

function strChar(c) {
  if (CTRL[c]) return `{${CTRL[c]}}`;
  if (KAISER_CHARS[c]) return KAISER_CHARS[c];
  if (c >= 0x41 && c <= 0x5a) return String.fromCharCode(c + 32);   // unshifted = lower case
  if (c >= 0xc1 && c <= 0xda) return String.fromCharCode(c - 0x80); // shifted = upper case
  if ((c >= 0x20 && c < 0x41) || c === 0x5b || c === 0x5d) return String.fromCharCode(c);
  return `{$${c.toString(16).padStart(2, '0')}}`;
}

export function listBasic(ram, start = ram[0x2b] | (ram[0x2c] << 8)) {
  const out = []; let a = start, guard = 0;
  while (guard++ < 5000) {
    const next = ram[a] | (ram[a + 1] << 8); if (!next) break;
    let s = `${ram[a + 2] | (ram[a + 3] << 8)} `, p = a + 4, q = false, rem = false;
    while (ram[p]) {
      const c = ram[p++];
      if (c === 0x22) { q = !q; s += '"'; }
      else if (q || rem) s += strChar(c);
      else if (c >= 0x80 && c <= 0xcb) { s += TOKENS[c - 0x80]; if (c === 0x8f) rem = true; }
      else if (c === 0xff) s += 'π';
      else s += String.fromCharCode(c);
    }
    out.push(s); a = next;
  }
  return out.join('\n') + '\n';
}

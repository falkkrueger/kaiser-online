// === C64 Graphics Engine for Kaiser Online ===
// Uses the authentic custom character set extracted from the game diskette.
// Renders in C64 Multicolor Character Mode (40x25 cells, 8x8 pixels each).

// C64 Color Palette (Pepto/Colodore accurate)
const C64_PALETTE = [
  '#000000','#FFFFFF','#813338','#75CEC8','#8E3C97','#56AC4D','#2E2C9B','#EDF171',
  '#8E4229','#553800','#C46C71','#4A4A4A','#808080','#AAD652','#6C7EEB','#D0D0D0'
];

// Custom character set extracted from Kaiser diskette ($E000)
// 255 chars × 8 bytes = 2040 bytes, base64 encoded
const KAISER_CHARSET_B64 = "PGZubmBiPAAAAHjMzMx2AOBgfGZmZvwAAAA+ZmBmPAAODHzMzMx2AAAAPGZ+YD4AHDAwMHwwMDAABjxmZj5gfuBgfGZmZvcAGAA4GBgYPAAGAA4GBgZmPOBgbHh4bPYDOBgYGBgYPAAAAP7b29vbAAAA3GZmZvcAAAA8ZmZmPAAAAPxmZnxg8AAAfszMfAwOAADcZmBg8AAAAD5gPAZ8ABgYfhgYGA4AAADuZmZmOwAAAOdidDgQAAAAxtb+fGwAAABmPBg8ZgAAAGZmZj4GfAAAfkwYMn4AGBgYGH48GAAABAZ/fwYEADwMDAwMDDwAGDx+GBgYGAAAEDB/fzAQAAAAAAAAAAAAABgYGBgAGAAAZmZmAAAAAABm/2Zm/2YAGD5gPAZ8GAAAZmwYMGZGABw2HDhvZjsAODgYMAAAAAAMGBgYGBgYDDAYGBgYGBgwAGY8/zxmAAAAGBh+GBgAAAAAAAAAGBgwAAAAfgAAAAAAAAAAABgYAAAGDBgwYEAAADxmbnZmPAAAGDgYGBg8AAA8ZgwwYn4AAH5MGAxmPAAADBw8bH4MAAB+YnwGZjwAADxgfGZmPAAAfkYMGDAwAAA8ZjxmZjwAADxmPgYMOAAAABgYABgYAAAAGBgAGBgwBgwYMBgMBgAAAH4AAH4AAGAwGAwYMGAAADxmDBgAGAAAPGZsZmZsYAAYPGZmfmYAAPxmfGZm/AAAPmZgYGY8AAD8ZmZmZvwAAP5ieGBi/gAA/mJ4YGDwAAB8xMDezHwAAGZmfmZmZgAA/5kYGJn/AAAeDAwMzHgAAPdseHhs9gMA8GBgYGL+AADG7v7WxsYAAOd2fm5m5wAAPGZmZmY8AAD8ZmZ8YPAAADxmZmZsNgEA/GZmfGz2AwA+YDwGBnwAAP+ZGBgYPAAAZmZmZmY8AABmZmY8PBgAAMbG1v7uxgAA52Y8PGbnAADnYjQYGDwAAP6MGDBi/gBmAGZmZmY8AGYA7mZmZjsAwzxmZmZmPABmADxmZmY8AGYYPGZmfmYAbAB4zMzMdgAAAAAAAKqq/xgYGPj4AAAAGDxmfv/b2/8AAAD4+BgYGP///5mZ////AAAAABg8fn4cHAh/HBw2Y0EiFAgUKl0UAAw/DAwMDAwgcFB/dV9fAAgcPn9Vd3cAAAAAAABVVf8AAAAfHxgYGAAAAP//AAAACBw+f1d9fQD////Nzc/PzwIHBX9XfX0ACBw+f3VfXwAAEDh8dFxcAP///9nZ+fn5GBgYHx8AAAB4iPiYGDx+fklJSUlJSUlJkpKSkpKSkpLMM8wzzDPMMwB/QV1VXUF/AAAAGH4YGAAYGBgYGBgYGAAIHD4+HAgICAAIGDh4OBg+HD5jd3c+AAAAAPDwMDw8AAAAKgIqIioAICAgKCIiCAAAAAAKICAKAAICAgoiIgoAAAAIIiogCAAKCAgqCAgIAAAAKiIqAioAICAgKCIiIgAACAAICAgIAAIAAgICAigAICAiIigiIgAoCAgICAgqAAAAACoqIiIAAAAAKCIiIgAAAAAIIiIIAAAAACgiKCAAAAAACiIKAgAAAAAKICAgAAAACiAIAigACCoICAgIAgAAAAAiIiIIAAAAACIiCAgAAAAAIiIqKgAAAAAiCCIiAAAAACIKAigAAAAAKgIoKgADDz8RERUVAMDw/FREREQAAAAAPxURFTD8/FREVEREAAAAAAw/DAwAAAAAAAAAAAAICAgICAAIAAADDwUEBQQAAADAQEBAQAAAMPxURFREERURFREVERUMDAz/EVURFREVEdURVREVAAogICAgIAoAKAICAgICKAAADD8MDD8VAAAICCoICAAAAAAAAAgIIAAAAAAqAAAAAAAAAAAACAgAAAICCAggIAAqIiIiIiIqAAgoCAgICCoAKAICCAggKgAqAgIKAgIqACAgICIqCAgAKiAgKgICKgAKICAqIiIqACoCAggIICAAKiIiCCIiKgAqIiIqAgIqAAAICAAICAAAAAgIAAgIIAU1ERURFREVQH8RVRFVERVUVxFVEVURFQAqIgIICAAIACgiKCIoICAACCIiIioiIgAoIiIoIiIoACoiICAiIioAKCIiIiIiKAAqICAqICAqACogICggICAAKiAgKiIiKgAiIiIqIiIiACoICAgICCoAAgICAiIiKgAiIiggKCIiACAgICAgICoAIioqIiIiIgAiIioqKiIiAAgiIiIiIggAKCIiKCAgIAAIIiIiIioKACoiIiooIiIACiAgCAICKAAqCAgICAgIACIiIiIiIioAIiIiIiIICAAiIiIiKioiACIiCAgiIiIAIiIiCAgICAAqAggIICAqACIAIiIiIggAACIAACIiCAAiCCIiIiIIAAAiAAgiIggAIggiIiIqIgAiACoCKiIqAAAAAAAEFRUAAAAAAEBQVAAAAAA/DwwMAE5MTHxwMDAAAAAADz8PAQAAAAD8/PwQAAMBFQMPPDwAwIBUwPA8PAACAT8CCigoAICA/ICgKCgCCioqCgEBAYCgqKigQEBAAHExMT0NDAwAAAAA/PAwMAAAAP//AAAAPDw8PDw8PDwAAAAAPz8/BAAAAADw/PBAAAQBAAEEAwMABBBA0MTw8AEGGSYJAQEBgGCYZJBAQEA8PDDw8AAAADw8DA8PAAAAADAMAwADDDAAAwwwwDAMAwAAAA8PDDw8AAAAAAUVVVX//////////wAABRQQFAUAAABQFAQUUA==";

class C64Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cols = 40;
    this.rows = 25;
    this.charW = 8;
    this.charH = 8;
    
    // Scale up for crisp pixels
    this.scale = 8; // Higher scale = sharper pixels when CSS shrinks
    canvas.width = this.cols * this.charW * this.scale;  // 40*8*8 = 2560
    canvas.height = this.rows * this.charH * this.scale; // 25*8*8 = 1600
    this.ctx.imageSmoothingEnabled = false;
    
    // VIC-II registers (defaults from Kaiser init)
    this.regs = {
      bg: 6,       // $D021 background color (blue)
      border: 14,  // $D020 border color (light blue)
      multi1: 6,   // $D022 multicolor 1 (blue) - set by POKE883,6
      multi2: 6,   // $D023 multicolor 2 (blue) - set by POKE884,6
      multi3: 6,   // $D024 multicolor 3 (blue) - set by POKE885,6
    };
    
    // Screen RAM (40x25 = 1000 bytes) - character codes
    this.screen = new Uint8Array(1000);
    // Color RAM (40x25 = 1000 bytes) - color values (lower nibble)
    this.color = new Uint8Array(1000);
    
    // Load charset
    this.charset = null;
    this.loadCharset();
  }
  
  loadCharset() {
    const binary = atob(KAISER_CHARSET_B64);
    this.charset = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      this.charset[i] = binary.charCodeAt(i);
    }
  }
  
  // Set a character at position with color
  poke(col, row, charCode, color) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return;
    const idx = row * this.cols + col;
    this.screen[idx] = charCode;
    this.color[idx] = color & 0x0F;
  }
  
  // Print text (PETSCII to screen code conversion)
  print(col, row, text, color) {
    for (let i = 0; i < text.length && col + i < this.cols; i++) {
      const ch = text.charCodeAt(i);
      let screenCode;
      if (ch >= 65 && ch <= 90) screenCode = ch - 65; // A-Z -> 1-26
      else if (ch >= 48 && ch <= 57) screenCode = ch - 48 + 48; // 0-9
      else if (ch === 32) screenCode = 32; // space
      else screenCode = ch; // fallback
      this.poke(col + i, row, screenCode, color);
    }
  }
  
  // Clear screen
  clear(charCode, color) {
    charCode = charCode || 32;
    color = color || this.regs.bg;
    for (let i = 0; i < 1000; i++) {
      this.screen[i] = charCode;
      this.color[i] = color;
    }
  }
  
  // Render the entire screen to canvas
  // mode: 'hires' = 8px wide text (readable), 'multicolor' = 4px wide graphics
  render(mode) {
    const ctx = this.ctx;
    const s = this.scale;
    mode = mode || this.renderMode || 'hires'; // default to hires for readable text
    
    // Fill border
    ctx.fillStyle = C64_PALETTE[this.regs.border];
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const idx = row * this.cols + col;
        const charCode = this.screen[idx];
        const charColor = this.color[idx];
        
        // Get character data (8 bytes)
        const charBase = charCode * 8;
        
        for (let py = 0; py < 8; py++) {
          if (charBase + py >= this.charset.length) continue;
          const byteVal = this.charset[charBase + py];
          
          if (mode === 'multicolor') {
            // Multicolor: 2 bits per pixel, 4 pixels wide (doubled)
            for (let px = 0; px < 4; px++) {
              const bits = (byteVal >> (6 - px * 2)) & 0x03;
              let colorIdx;
              if (bits === 0) colorIdx = this.regs.bg;
              else if (bits === 1) colorIdx = this.regs.multi1;
              else if (bits === 2) colorIdx = this.regs.multi2;
              else colorIdx = charColor;
              ctx.fillStyle = C64_PALETTE[colorIdx];
              const x = (col * 8 + px * 2) * s;
              const y = (row * 8 + py) * s;
              ctx.fillRect(x, y, 2 * s, s);
            }
          } else {
            // Hi-Res: 1 bit per pixel, 8 pixels wide (READABLE TEXT!)
            for (let px = 0; px < 8; px++) {
              const bit = (byteVal >> (7 - px)) & 1;
              const colorIdx = bit ? charColor : this.regs.bg;
              ctx.fillStyle = C64_PALETTE[colorIdx];
              const x = (col * 8 + px) * s;
              const y = (row * 8 + py) * s;
              ctx.fillRect(x, y, s, s);
            }
          }
        }
      }
    }
  }
  
  // Set VIC-II register
  setReg(name, value) {
    this.regs[name] = value;
  }
}
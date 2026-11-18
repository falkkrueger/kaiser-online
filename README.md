# Kaiser Online

**Kaiser** (Ariolasoft 1984, Claudio Kronmüller & Dirk Beyelstein) – das *echte* C64-Original,
online mit Freunden spielbar.

Hier wird nichts nachprogrammiert. Ein Commodore 64 wird emuliert und startet darauf die
Original-Diskette, also das unveränderte BASIC-Programm mit seinen Maschinencode-Routinen. Alle
Formeln, Zufälle, Bugs und Geräusche sind deshalb exakt wie 1984. Alle Mitspieler sehen denselben
C64, wie früher am Brotkasten, nur übers Internet.

## Funktionen

- Originalgetreues Bild: VIC-II-Emulation (Multicolor-Titelbild, eigener Zeichensatz, Sprites, Schlachtfeld)
- SID-Sound im Browser (AudioWorklet)
- **Klickbare Steuerung** statt Joystick:
  - Menüpunkte (↑ ↓ → ←) direkt auf dem C64-Bildschirm anklicken
  - Cursor-Menüs (Staatseinkäufe, Militär, Angriffsziel): Zeile anklicken, und der Cursor fährt hin und drückt Feuer
  - Zahleneingaben (sonst Ziffer für Ziffer mit dem Joystick): Zahl eintippen oder Ziffernblock benutzen
  - Steuerkreuz + Feuerknopf (lang drücken = halten, z. B. zum Scrollen des Schlachtfelds)
  - Tastatur: Pfeiltasten = Joystick, Leertaste/Enter = Feuer, Buchstaben für Namen, F1 = Spielstand auf Diskette
- **Mehrspieler (Hotseat online)**: Jeder klickt bei seinem Herrscher auf „Das bin ich“. Dann kann nur
  steuern, wer laut Programm gerade dran ist. Dafür werden die BASIC-Variablen des laufenden
  Originals (`C` = aktueller Spieler, im Gefecht `I`/`H` für Angreifer und Verteidiger).
- **Zeitfaktor des Originals bleibt erhalten** (ein Zug über ca. 1:20 min kostet Lebensjahre). Ist der Spieler am
  Zug offline, hält der C64 an, bis er wiederkommt (abschaltbar im Menü).
- „Du bist dran“ als Signalton und Browser-Benachrichtigung (im Server-Modus auch per Telegram)
- Der Spielstand (komplette Maschine) wird automatisch gesichert und übersteht Neuladen und Neustarts.

## Spielen – direkt im Browser (GitHub Pages)

Es ist kein Server nötig. Der C64 läuft im Browser des **Gastgebers**, die Mitspieler verbinden sich direkt mit ihm (WebRTC).

1. **Gastgeber** öffnet `https://falkkrueger.github.io/kaiser-online/` und wählt einmalig die eigene
   Kaiser-Diskette (`Kaiser_Ariolasoft_1984_German_ASS.d64`). Sie bleibt nur im eigenen Browser
   gespeichert und wird nirgends hochgeladen. Die C64-ROMs lädt die Seite automatisch aus dem VICE-Projekt.
2. Oben auf **„Mitspieler einladen“** klicken und den kopierten Link an die Freunde schicken.
3. Jeder klickt rechts bei seinem Herrscher auf **„Das bin ich“**.

Gut zu wissen:
- Der Tab des Gastgebers muss offen bleiben, solange gespielt wird. Er darf aber im Hintergrund liegen.
- Der Spielstand wird laufend im Browser des Gastgebers gespeichert. Seite neu laden, Rechner neu
  starten oder morgen weiterspielen geht ohne Verlust; der Einladungslink bleibt derselbe.
- Unter **Menü → Spielstand sichern/laden** lässt sich der Stand als Datei sichern, z. B. um den
  Gastgeber zu wechseln.
- Für den Verbindungsaufbau wird der kostenlose PeerJS-Vermittlungsdienst benutzt, die Spieldaten
  laufen direkt zwischen den Browsern. In sehr restriktiven Netzen (manche Firmen- oder Mobilfunknetze)
  kann der direkte Verbindungsaufbau scheitern.

**Einmalig einrichten:** Im Repository unter *Settings → Pages* als Quelle den Branch mit diesem Code und
den Ordner `/ (root)` wählen.

## Optional: eigener Server

Statt im Browser des Gastgebers kann der C64 auch auf einem Server laufen. Dann muss niemand
einen Tab offen halten, und Telegram-Benachrichtigungen sind möglich.

```bash
npm install
```

```bash
npm run fetch-roms
```

Danach die Diskette nach `media/kaiser.d64` kopieren.

```bash
npm test
```

```bash
npm start
```

Dann im Browser `http://localhost:8080/?room=meinspiel` öffnen.

### Umgebungsvariablen

| Variable | Bedeutung |
|---|---|
| `PORT` | HTTP-Port (Standard 8080) |
| `KAISER_MEDIA` | Ordner mit `kaiser.d64` und `roms/` (Standard `./media`) |
| `KAISER_DATA` | Ordner für Spielstände (Standard `./data`) |
| `KAISER_TELEGRAM_BOT_TOKEN` | optional: Telegram-Bot für „Du bist dran“ (Chat-ID trägt jeder im Menü ein) |
| `KAISER_BASE_URL` | optional: öffentliche URL für den Link in Telegram-Nachrichten |

### Deployment auf fly.io

`media/kaiser.d64` muss lokal vorhanden sein, denn `fly deploy` lädt das Verzeichnis inklusive Image hoch.
Die ROMs holt das Dockerfile selbst.

```bash
fly volumes create kaiser_data --size 1
```

```bash
fly deploy
```

## Aufbau

| Datei | Inhalt |
|---|---|
| `emu/cpu6502.js` | 6510-CPU (inkl. undokumentierter Opcodes) |
| `emu/c64.js` | C64: Speicher-Banking, VIC-II, 2× CIA, SID-Register, KERNAL-Traps, BASIC-Variablen lesen, Snapshots |
| `emu/drive.js` | virtuelles 1541-Laufwerk auf KERNAL-Bus-Ebene (D64 lesen, Schreiben in ein Overlay, Block-Befehle `U1`/`B-P`) |
| `emu/input.js` | Tastaturmatrix + Joystick-Impulse, die gehalten werden, bis das Programm sie gelesen hat |
| `emu/kaiser.js` | Spielwissen: welches Menü gerade aktiv ist, wer steuern darf, Klick → Joystick-Folge |
| `emu/listing.js`, `scripts/listing.mjs` | BASIC-Listing des Originals aus dem Speicher ziehen (`node scripts/listing.mjs` → `media/kaiser.bas`) |
| `emu/room.js` | Ein Spieltisch: Echtzeit-Takt (50,125 Hz PAL), Bild-Diffs, Sound-Events, Plätze und Rechte (Server und Browser) |
| `server.js` | optionaler Server-Modus (HTTP + WebSocket) |
| `public/p2p.js`, `public/host-worker.js` | Browser-Modus: Gastgeber-Worker, WebRTC, Diskette/ROMs/Spielstand in IndexedDB |
| `public/` | Browser-Client (Canvas, C64-Zeichensatz für die Oberfläche, SID-Worklet) |

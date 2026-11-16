# Analyse der Kaiser-Disketten

## Die drei Images

| Image | Inhalt | Eignung |
|---|---|---|
| `Kaiser_Ariolasoft_1984_German_ASS.d64` | Lader `KAISER` (110 Bytes, Autostart über den `$0302`-Vektor), `MOS` (Lader bei `$0400`), Datei `K` (letzter Kaiser). Das eigentliche Programm liegt außerhalb des Directorys und wird blockweise geladen. | **verwendet**: Original-Vorspann, Programm unverändert |
| `…_EX5DG.d64` | Gepackter „Onefiler“ von Excess (178 Blöcke) mit Cracker-Intro + `KAISER ANLEITUNG` | Cracker-Intro vor dem Spiel |
| `…_1985_Improved_Version_Sir_Aliba.d64` | Entpackte Einzeldateien, aber **verändert** („ewiges Leben“, „Karte nur auf Wunsch“, „kein Absturz beim Krieg“ …) | nicht original |

### Lader der ASS-Version

`MOS` lädt nur über Standard-KERNAL-Aufrufe: Er öffnet den Befehlskanal 15 und einen Pufferkanal `#`,
sendet Blockbefehle `U1:2 0 tt ss` und liest jeweils 256 Bytes über `CHKIN`/`CHRIN`. Ein Schnelllader
im Laufwerk wird nicht verwendet. Deshalb reicht ein virtuelles Laufwerk auf KERNAL-Ebene
(`emu/drive.js`), eine echte 1541-Emulation ist nicht nötig.

## Programmaufbau

1. Intro-BASIC (Zeilen 0–140): Titel-Sprites, Credits, „NEUES SPIEL (J/N)?“, Multicolor-Titelbild mit
   Sternschnuppe, danach lädt `SYS 1856` das Hauptprogramm.
2. **Hauptprogramm: Commodore BASIC V2, 887 Zeilen** (`$0801`–`$867A`). Speichergrenze `$A000`.
3. Maschinencode-Hilfsroutinen **unter dem BASIC-ROM** ab `$A000`. Aufruf aus BASIC mit `SYS M,n,…`
   (`M=901`). Der Dispatcher bei `$0385` blendet das BASIC-ROM aus (`$01`), springt über die Tabelle bei
   `$A014` in eine von 34 Routinen und blendet das ROM wieder ein.

Wichtige Routinen:

| `SYS M,n` | Funktion |
|---|---|
| 0 | `RESTORE` auf eine Zeilennummer (DATA-Zugriff) |
| 1 | Cursor setzen (x,y) |
| 7 | **Joystick lesen**: Port 0 = `$DC01` (Port 1), 1 = `$DC00` (Port 2). Richtung nach `715` (1=↑, 2=→, 3=↓, 4=←), Feuer nach `716` (0 = gedrückt) |
| 8 | Text in großer 2×2-Schrift („KNOPF DRÜCKEN!“) |
| 15 | Stadtansicht scrollen (Joystick) |
| 16/17 | SID-Töne |
| 26 | Ausschnitt der Schlachtfeldkarte (`$C000`, 76 Zeilen) auf den Bildschirm kopieren |

Grafik: VIC-Bank 3, Bildschirm `$CC00`, eigener Zeichensatz `$F000` (u. a. Umlaute: ö = Code 94;
Pfeile ↑↓→← = 30/27/28/31).

## Steuerung im Original

Fast alles läuft über den Joystick:

- Richtungsmenüs: ↑/↓/→/← wählen direkt einen Menüpunkt (z. B. Zeile 491 Korn/Land).
- Cursor-Menüs: Cursor `→` mit ↑/↓ bewegen, Feuer wählt aus (Zeilen 581, 657, 679; Bildschirmzeile `6+2·Q`).
- **Zahleneingabe** (Zeilen 18–31): ←/→ wählt die Stelle, ↑/↓ verändert die Ziffer, Feuer bestätigt.
- Tastatur nur für Spieleranzahl, Joystickanzahl, Namen, m/w; F1 beim Zugende = Spielstand speichern.
- Gefecht (Zeilen 353–388): Angreifer setzt Truppen mit Port 1 (`SYS M,7,0`), Verteidiger mit Port 2 (`SYS M,7,1`).

## Bemerkenswerte Regeln aus dem Listing

- **Kopierschutz-Falle**: `PEEK(767)=0` ⇒ kein Start-Korn, weniger Einwohner, Tod bei der Beförderung
  ab Titel 3 und eine Endlosschleife im Krieg (Zeilen 800–804). In der ASS-Version ist `767 = 128`. Der
  Selbsttest prüft das.
- **Zeitfaktor** (Zeile 609): dauert ein Zug länger als `TI$ ≥ 000120` (1:20 min), sinkt die Lebenserwartung `K(C)`
  um 1–3 Jahre.
- Lebenserwartung startet bei 1760. Ab Erreichen stirbt man mit 50 % pro Jahr (Zeile 718).
- Spielstand: SEQ-Datei `a` (Zeilen 885–903), letzter Kaiser: SEQ-Datei `k`.

## Werkzeuge

- `node scripts/listing.mjs` erzeugt das vollständige Listing lokal in `media/kaiser.bas` (wird nicht eingecheckt).
- Für Maschinencode bietet sich [REA](https://github.com/morluto/rea) mit Ghidra (6502-Prozessormodul) an.
  Für diese Analyse genügten ein Disassembler und der laufende Emulator, weil das Spiel fast
  vollständig in BASIC geschrieben ist.

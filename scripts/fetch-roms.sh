#!/bin/sh
# Lädt die C64-ROMs (KERNAL, BASIC, Zeichensatz) aus dem VICE-Projekt nach media/roms/.
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)/media/roms"
BASE="https://raw.githubusercontent.com/VICE-Team/svn-mirror/main/vice/data/C64"
mkdir -p "$DIR"
for f in kernal-901227-03.bin basic-901226-01.bin chargen-901225-01.bin; do
  if [ ! -s "$DIR/$f" ]; then
    echo "lade $f"
    curl -fsSL -o "$DIR/$f" "$BASE/$f"
  fi
done
echo "ROMs liegen in $DIR"

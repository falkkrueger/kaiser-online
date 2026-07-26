# Kaiser Online

Kaiser (1984, Ariolasoft) als rundenbasiertes Online-Multiplayer-Spiel mit originalgetreuer C64-Optik.

## Spielen

 Öffne die URL im Browser (Handy, iPad, Desktop).

## Features

- 🎮 Originalgetreue C64-GUI (40×25 Zeichen, PETSCII-Font, C64-Farben)
- 📱 Touch-Steuerung statt Joystick
- 🌐 Multiplayer (1-9 Spieler, rundenbasiert)
- 📲 Notifications: "Du bist dran!" via Telegram/SMS
- 🏰 Alle Original-Spielmechaniken: Handel, Steuern, Bauen, Krieg, Beförderungen

## Starten

```bash
cd kaiser
pip3 install fastapi uvicorn pydantic
python3 server.py
```

Dann im Browser: `http://localhost:8080`

## Dateien

| Datei | Beschreibung |
|-------|-------------|
| `engine.py` | Game-Engine (alle Kaiser-Regeln) |
| `server.py` | FastAPI Backend (REST + WebSocket + Notifications) |
| `notifications.py` | Notification Service (Telegram/SMS) |
| `static/index.html` | Web-Frontend (C64-Optik, Touch, Login, Game) |
| `start.sh` | Start-Skript |

## Technik

- **Backend**: Python / FastAPI / WebSockets
- **Frontend**: HTML5 / CSS / Vanilla JS (kein Framework)
- **Font**: Press Start 2P (Google Fonts)
- **Farben**: C64 VIC-II 16-Farben-Palette
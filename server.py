"""
Kaiser Online - FastAPI Backend
Multi-Instance, WebSocket-ready, niederschwelliges Login.
"""
import os
import json
import random
import string
import asyncio
from datetime import datetime
from typing import Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel
import uvicorn

from engine import KaiserEngine, SpielPhase, STAATEN, TITEL
from notifications import get_notification_service, init_notification_service

# === Speicher ===
# In Produktion: SQLite/PostgreSQL. Für Prototyp: In-Memory.
spiele: dict[str, KaiserEngine] = {}
# Spielcode -> spiel_id mapping
spiel_codes: dict[str, str] = {}
# WebSocket-Verbindungen pro Spiel
ws_connections: dict[str, list[WebSocket]] = {}
# Spieler-Kontakte pro Spiel: spiel_id -> {spieler_name -> {telegram_chat_id, phone}}
spieler_kontakte: dict[str, dict] = {}

# Notifications initialisieren
notif = init_notification_service(os.environ.get("KAISER_TELEGRAM_BOT_TOKEN", ""))
# Default: Falk's Telegram Chat-ID
FALK_CHAT_ID = "1062835848"
KAISER_BASE_URL = os.environ.get("KAISER_BASE_URL", "http://192.168.5.149:8080")

app = FastAPI(title="Kaiser Online", version="0.1.0")

# === Modelle ===

class SpielErstellen(BaseModel):
    spieler: list[dict]  # [{name, geschlecht, staat}]

class Aktion(BaseModel):
    aktion: str
    parameter: dict = {}

class SteuerAktion(BaseModel):
    typ: str  # zoll, mwst, einkommen, justiz
    wert: int

class KornAusgabe(BaseModel):
    menge: int

class BauenAktion(BaseModel):
    gebaeude: str  # marktplatz, kornmühle, palast, kathedrale

class KriegAktion(BaseModel):
    verteidiger_idx: int

# === Hilfsfunktionen ===

def generiere_spielcode() -> str:
    """6-stelligen Code generieren."""
    while True:
        code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
        if code not in spiel_codes:
            return code

def get_spiel(spiel_id: str) -> KaiserEngine:
    if spiel_id not in spiele:
        raise HTTPException(status_code=404, detail="Spiel nicht gefunden")
    return spiele[spiel_id]

async def broadcast_spielstand(spiel_id: str):
    """Spielstand an alle WebSocket-Clients senden."""
    if spiel_id not in ws_connections:
        return
    spiel = spiele.get(spiel_id)
    if not spiel:
        return
    stand = spiel.spielstand()
    dead = []
    for ws in ws_connections[spiel_id]:
        try:
            await ws.send_json({"type": "spielstand", "data": stand})
        except:
            dead.append(ws)
    for ws in dead:
        ws_connections[spiel_id].remove(ws)

# === API Endpoints ===

@app.get("/")
async def index():
    """Liefert die Web-App (HTML)."""
    html_path = os.path.join(os.path.dirname(__file__), "static", "index.html")
    if os.path.exists(html_path):
        with open(html_path, "r", encoding="utf-8") as f:
            return HTMLResponse(f.read())
    return HTMLResponse("<h1>Kaiser Online</h1><p>Frontend nicht gefunden.</p>")

@app.get("/api/staaten")
async def list_staaten():
    """Verfügbare Staaten."""
    return {"staaten": STAATEN}

@app.post("/api/spiel/erstellen")
async def spiel_erstellen(data: dict):
    """Neues Spiel erstellen. Nur der Ersteller wird angelegt."""
    name = data.get("name", "")[:10]
    geschlecht = data.get("geschlecht", "M")
    staat = data.get("staat", "Preussen")
    
    if not name:
        raise HTTPException(400, "Name erforderlich")
    
    code = generiere_spielcode()
    spiel_id = f"kaiser_{code.lower()}"
    
    engine = KaiserEngine(spiel_id)
    # Spiel mit nur 1 Spieler starten, andere treten später bei
    engine.setup([{"name": name, "geschlecht": geschlecht, "staat": staat}])
    engine.phase = SpielPhase.SETUP  # Warten in Lobby bis Start
    
    spiele[spiel_id] = engine
    spiel_codes[code] = spiel_id
    ws_connections[spiel_id] = []
    spieler_kontakte[spiel_id] = {}
    
    # Ersteller registrieren für Notifications
    tg = data.get("telegram_chat_id")
    if tg:
        notif.register_spieler(name, telegram_chat_id=tg)
        spieler_kontakte[spiel_id][name] = {"telegram_chat_id": tg}
    
    return {
        "spiel_code": code,
        "spiel_id": spiel_id,
        "spielstand": engine.spielstand(),
    }

@app.post("/api/spiel/{spiel_id}/beitreten")
async def spieler_beitreten(spiel_id: str, data: dict):
    """Ein Spieler tritt einem bestehenden Spiel bei."""
    spiel = get_spiel(spiel_id)
    if spiel.spiel_beendet:
        raise HTTPException(400, "Spiel bereits beendet")
    if spiel.phase != SpielPhase.SETUP:
        raise HTTPException(400, "Spiel bereits gestartet")
    
    name = data.get("name", "")[:10]
    geschlecht = data.get("geschlecht", "M")
    staat = data.get("staat", "")
    
    if not name:
        raise HTTPException(400, "Name erforderlich")
    
    # Prüfen ob Name schon vergeben
    for s in spiel.spieler:
        if s.name == name:
            raise HTTPException(400, "Name bereits vergeben")
    
    if len(spiel.spieler) >= 9:
        raise HTTPException(400, "Spiel voll (max 9 Spieler)")
    
    # Staat automatisch wählen falls nicht angegeben
    verfuegbare = [st for st in STAATEN if st not in [s.staat for s in spiel.spieler]]
    if not staat or staat in [s.staat for s in spiel.spieler]:
        staat = verfuegbare[0] if verfuegbare else STAATEN[len(spiel.spieler) % len(STAATEN)]
    
    from engine import Spieler, Truppen
    neuer = Spieler(name=name, geschlecht=geschlecht, staat=staat)
    spiel.spieler.append(neuer)
    
    # Kontakt registrieren
    tg = data.get("telegram_chat_id")
    if tg:
        notif.register_spieler(name, telegram_chat_id=tg)
        spieler_kontakte[spiel_id][name] = {"telegram_chat_id": tg}
    
    await broadcast_spielstand(spiel_id)
    
    return {"erfolg": True, "name": name, "staat": staat, "spielstand": spiel.spielstand()}

@app.post("/api/spiel/{spiel_id}/starten")
async def spiel_starten(spiel_id: str):
    """Ersteller startet das Spiel aus der Lobby."""
    spiel = get_spiel(spiel_id)
    if spiel.phase != SpielPhase.SETUP:
        raise HTTPException(400, "Spiel bereits gestartet")
    if len(spiel.spieler) < 1:
        raise HTTPException(400, "Keine Spieler")
    
    spiel.phase = SpielPhase.BILD1_HANDEL
    
    # Ersten Spieler benachrichtigen
    code = next((c for c, s in spiel_codes.items() if s == spiel_id), "")
    first = spiel.aktiver_spieler
    if first:
        notif.notify_du_bist_dran(first.name, code, spiel.jahr, first.staat, KAISER_BASE_URL)
    
    await broadcast_spielstand(spiel_id)
    return {"erfolg": True, "spielstand": spiel.spielstand()}

@app.post("/api/spiel/{spiel_id}/kontakt")
async def kontakt_registrieren(spiel_id: str, data: dict):
    """Spieler-Kontaktdaten für Notifications registrieren."""
    name = data.get("name", "")
    telegram_chat_id = data.get("telegram_chat_id")
    phone = data.get("phone")
    
    if not name:
        raise HTTPException(400, "Name erforderlich")
    
    kontakt = {}
    if telegram_chat_id: kontakt["telegram_chat_id"] = telegram_chat_id
    if phone: kontakt["phone"] = phone
    
    if spiel_id not in spieler_kontakte:
        spieler_kontakte[spiel_id] = {}
    spieler_kontakte[spiel_id][name] = kontakt
    
    notif.register_spieler(name, telegram_chat_id=telegram_chat_id, phone=phone)
    
    return {"erfolg": True, "name": name}

@app.get("/api/spiel/{spiel_id}")
async def get_spielstand(spiel_id: str):
    """Aktuellen Spielstand abrufen."""
    spiel = get_spiel(spiel_id)
    return spiel.spielstand()

@app.get("/api/spiel/code/{code}")
async def get_spiel_by_code(code: str):
    """Spiel über Code finden."""
    code = code.upper()
    if code not in spiel_codes:
        raise HTTPException(404, "Ungültiger Spielcode")
    spiel_id = spiel_codes[code]
    spiel = spiele[spiel_id]
    return {"spiel_id": spiel_id, "spielstand": spiel.spielstand()}

@app.post("/api/spiel/{spiel_id}/aktion")
async def aktion_ausfuehren(spiel_id: str, aktion: Aktion):
    """Eine Spielaktion ausführen."""
    spiel = get_spiel(spiel_id)
    s = spiel.aktiver_spieler
    if s is None:
        raise HTTPException(400, "Kein aktiver Spieler")
    
    result = {"erfolg": False, "fehler": "Unbekannte Aktion"}
    
    a = aktion.aktion
    p = aktion.parameter
    
    if a == "korn_kaufen":
        result = spiel.korn_kaufen(int(p.get("menge", 0)))
    elif a == "korn_verkaufen":
        result = spiel.korn_verkaufen(int(p.get("menge", 0)))
    elif a == "land_kaufen":
        result = spiel.land_kaufen(int(p.get("hektar", 0)))
    elif a == "land_verkaufen":
        result = spiel.land_verkaufen(int(p.get("hektar", 0)))
    elif a == "korn_ausgeben":
        result = spiel.korn_ausgeben(int(p.get("menge", 0)))
    elif a == "steuern_aendern":
        result = spiel.steuern_aendern(p.get("typ", ""), int(p.get("wert", 0)))
    elif a == "justiz_aendern":
        result = spiel.justiz_aendern(int(p.get("stufe", 0)))
    elif a == "marktplatz_bauen":
        result = spiel.marktplatz_bauen()
    elif a == "kornmühle_bauen":
        result = spiel.kornmühle_bauen()
    elif a == "palast_bauen":
        result = spiel.palast_bauen()
    elif a == "kathedrale_bauen":
        result = spiel.kathedrale_bauen()
    elif a == "soldaten_rekrutieren":
        result = spiel.soldaten_rekrutieren(p.get("typ", ""), int(p.get("anzahl", 0)))
    elif a == "soeldner_anwerben":
        result = spiel.soeldner_anwerben(p.get("typ", ""), int(p.get("anzahl", 0)))
    elif a == "manoever":
        result = spiel.manoever()
    elif a == "krieg_erklaeren":
        result = spiel.krieg_erklaeren(int(p.get("verteidiger_idx", -1)))
    elif a == "zug_beenden":
        result = spiel.zug_beenden()
        # Notification an nächsten Spieler
        if result.get("naechster_spieler") and not result.get("spielende"):
            code = next((c for c, s in spiel_codes.items() if s == spiel_id), "")
            naechster = result["naechster_spieler"]
            naechster_spieler = spiel.spieler[result.get("naechster_spieler_idx", 0)]
            notif.notify_du_bist_dran(
                naechster, code, result.get("jahr", spiel.jahr),
                naechster_spieler.staat, KAISER_BASE_URL
            )
        # Kriegs-Notifications
        if a == "krieg_durchfuehren" and result.get("angreifer"):
            notif.notify_krieg(result.get("angreifer",""), result.get("verteidiger",""), result)
    elif a == "krieg_durchfuehren":
        result = spiel.krieg_durchfuehren(int(p.get("verteidiger_idx", -1)), {}, {})
        # Kriegs-Notification an alle
        if result.get("angreifer"):
            notif.notify_krieg(result.get("angreifer",""), result.get("verteidiger",""), result)
    else:
        raise HTTPException(400, f"Unbekannte Aktion: {a}")
    
    # Broadcast an alle WebSocket-Clients
    await broadcast_spielstand(spiel_id)
    
    return result

@app.post("/api/spiel/{spiel_id}/zug_beenden")
async def zug_beenden(spiel_id: str):
    """Spielerzug beenden."""
    spiel = get_spiel(spiel_id)
    result = spiel.zug_beenden()
    await broadcast_spielstand(spiel_id)
    return result

@app.get("/api/spiele")
async def list_spiele():
    """Alle aktiven Spiele (für Debug)."""
    return {
        "spiele": [
            {
                "spiel_id": sid,
                "code": next((c for c, s in spiel_codes.items() if s == sid), None),
                "jahr": sp.jahr,
                "spieler": [s.name for s in sp.spieler],
                "aktiv": sp.aktiver_spieler.name if sp.aktiver_spieler else None,
                "beendet": sp.spiel_beendet,
            }
            for sid, sp in spiele.items()
        ]
    }

# === WebSocket für Live-Updates ===

@app.websocket("/ws/{spiel_id}")
async def websocket_endpoint(ws: WebSocket, spiel_id: str):
    await ws.accept()
    
    if spiel_id not in ws_connections:
        ws_connections[spiel_id] = []
    ws_connections[spiel_id].append(ws)
    
    # Aktuellen Stand senden
    spiel = spiele.get(spiel_id)
    if spiel:
        await ws.send_json({"type": "spielstand", "data": spiel.spielstand()})
    
    try:
        while True:
            data = await ws.receive_text()
            # Client kann Aktionen senden
            msg = json.loads(data)
            if msg.get("type") == "ping":
                await ws.send_json({"type": "pong"})
    except WebSocketDisconnect:
        if ws in ws_connections.get(spiel_id, []):
            ws_connections[spiel_id].remove(ws)

# === Startup ===

@app.on_event("startup")
async def startup():
    print("=" * 50)
    print("  KAISER ONLINE - Server gestartet")
    print("  http://localhost:8080")
    print("=" * 50)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    host = os.environ.get("HOST", "0.0.0.0")
    uvicorn.run(app, host=host, port=port)
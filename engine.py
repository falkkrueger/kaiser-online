"""
Kaiser Game Engine - Implementiert die kompletten Spielregeln.
Basierend auf dem C64 Original (Ariolasoft 1984) und dem Handbuch.
"""
import random
import json
import copy
from enum import Enum
from dataclasses import dataclass, field, asdict
from typing import Optional

# === Konstanten aus dem Handbuch ===

START_GELD = 15000
START_LAND = 10000
TODESJAHR_MIN = 1760
TODESJAHR_MAX = 1768
SPIELJAHR_START = 1700
KORNPREIS_MIN = 20
KORNPREIS_MAX = 430
LANDPREIS_MIN = 16
LANDPREIS_MAX = 70
PROVISION_LANDVERKAUF = 0.10  # 10% beim Verkaufen
ZEITFAKTOR_SEKUNDEN = 90
BONITAET_START = 10000
BONITAET_PRO_TITEL = 10000

# Gebäudedaten
MARKTPLATZ_KOSTEN = 1000
MARKTPLATZ_LAND = 1000
KORNMUEHLE_KOSTEN = 2000
KORNMUEHLE_LAND = 1000
PALAST_TEILE = 16
PALAST_TEIL_KOSTEN = 5000
PALAST_LAND = 13000
KATHEDRALE_TEILE = 14
KATHEDRALE_TEIL_KOSTEN = 9000
KATHEDRALE_LAND = 25000

# Stadt: 5 Märkte + 3 Mühlen
STADT_MAERKTE = 5
STADT_MUEHLEN = 3
STADT_LAND = 5000

# Kaiser-Voraussetzungen
KAISER_LAND = 25000
KAISER_GELD = 100000
KAISER_STAEDTE = 5

# Beförderungsstufen
TITEL = [
    ("Baron", "Baronin"),
    ("Landgraf", "Graefin"),
    ("Markgraf", "Markgraefin"),
    ("Fuerst", "Fuerstin"),
    ("Herzog", "Herzogin"),
    ("Kurfuerst", "Kurfuerstin"),
    ("Koenig", "Koenigin"),     # braucht Palast
    ("Kaiser", "Kaiserin"),      # braucht Kathedrale
]

# Historische Staaten
STAATEN = [
    "Preussen", "Bayern", "Hessen", "Boehmen", "Sachsen",
    "Wuerttemberg", "Hannover", "Pfalz", "Braunschweig",
]

# Grenzen (wer angreifen kann)
GRENZEN = {
    "Preussen": ["Hessen", "Boehmen", "Braunschweig", "Hannover"],
    "Bayern": ["Boehmen", "Wuerttemberg", "Pfalz", "Sachsen"],
    "Hessen": ["Preussen", "Sachsen", "Pfalz", "Hannover", "Braunschweig"],
    "Boehmen": ["Preussen", "Bayern", "Sachsen"],
    "Sachsen": ["Preussen", "Hessen", "Boehmen", "Bayern", "Braunschweig"],
    "Wuerttemberg": ["Bayern", "Pfalz"],
    "Hannover": ["Preussen", "Hessen", "Braunschweig"],
    "Pfalz": ["Bayern", "Hessen", "Wuerttemberg"],
    "Braunschweig": ["Preussen", "Hessen", "Sachsen", "Hannover"],
}

# Wetter
WETTER = ["Sonnig", "Bewoelkt", "Regnerisch", "Sturm", "Duerre"]
WETTER_ERTRAG = {
    "Sonnig": 1.0,
    "Bewoelkt": 0.8,
    "Regnerisch": 0.6,
    "Sturm": 0.4,
    "Duerre": 0.2,
}

# Justiz-Stufen
JUSTIZ_STUFEN = ["Sehr fair", "Bescheiden", "Hart", "Gierig"]
JUSTIZ_FAKTOR = [0.5, 1.0, 1.5, 2.0]  # Einfluss auf Einnahmen/Stimmung


class SpielPhase(Enum):
    TITEL = "titel"
    SETUP = "setup"
    BILD1_HANDEL = "bild1_handel"
    BILD1_KORNAUSGABE = "bild1_kornausgabe"
    BILD2_STATISTIK = "bild2_statistik"
    BILD3_STEUERN = "bild3_steuern"
    BILD4_LANDKARTE = "bild4_landkarte"
    BILD5_AUSGABEN = "bild5_ausgaben"
    MILITAER = "militaer"
    KRIEG = "krieg"
    BEFOERDERUNG = "befoerderung"
    KROENUNG = "kroenung"
    SPIELENDE = "spielende"


@dataclass
class Truppen:
    kavallerie: int = 0
    artillerie: int = 0
    infanterie: int = 0
    # Miliz wird automatisch berechnet aus Märkten + Mühlen
    
    def gesamt(self):
        return self.kavallerie + self.artillerie + self.infanterie


@dataclass
class Spieler:
    name: str
    geschlecht: str  # 'M' oder 'W'
    staat: str
    # Ressourcen
    geld: int = START_GELD
    land: int = START_LAND
    land_bebaut: int = 0
    korn: int = 10000
    einwohner: int = 500
    # Gebäude
    maerkte: int = 0
    muehlen: int = 0
    palast_teile: int = 0
    kathedrale_teile: int = 0
    # Steuern (Prozent)
    steuer_zoll: int = 5
    steuer_mwst: int = 8
    steuer_einkommen: int = 15
    justiz: int = 1  # Index in JUSTIZ_STUFEN (0-3)
    # Militär
    truppen: Truppen = field(default_factory=Truppen)
    truppen_kampfwert: int = 50  # 0-100
    # Rang
    rang: int = -1  # -1 = noch kein Titel, 0=Baron, ... 7=Kaiser
    # Sonstiges
    tot: bool = False
    punkte: int = 0
    korn_ausgabe_letztes_jahr: int = 0
    
    @property
    def titel(self):
        if self.rang < 0:
            return ""
        if self.geschlecht == 'W':
            return TITEL[self.rang][1]
        return TITEL[self.rang][0]
    
    @property
    def staedte(self):
        return min(self.maerkte // STADT_MAERKTE, self.muehlen // STADT_MUEHLEN)
    
    @property
    def miliz(self):
        return (self.maerkte + self.muehlen) * 10
    
    @property
    def ist_kaiser(self):
        return self.rang >= 7
    
    @property
    def hat_palast(self):
        return self.palast_teile >= PALAST_TEILE
    
    @property
    def hat_kathedrale(self):
        return self.kathedrale_teile >= KATHEDRALE_TEILE
    
    @property
    def bonitaet(self):
        return BONITAET_START + (max(0, self.rang + 1) * BONITAET_PRO_TITEL)
    
    def to_dict(self):
        d = asdict(self)
        d['titel'] = self.titel
        d['staedte'] = self.staedte
        d['miliz'] = self.miliz
        d['ist_kaiser'] = self.ist_kaiser
        d['hat_palast'] = self.hat_palast
        d['hat_kathedrale'] = self.hat_kathedrale
        d['bonitaet'] = self.bonitaet
        return d


@dataclass
class SpielEvent:
    jahr: int
    spieler: str
    typ: str
    beschreibung: str
    daten: dict = field(default_factory=dict)


class KaiserEngine:
    """Die Haupt-Spielengine für Kaiser."""
    
    def __init__(self, spiel_id: str):
        self.spiel_id = spiel_id
        self.spieler: list[Spieler] = []
        self.jahr = SPIELJAHR_START
        self.todesjahr = random.randint(TODESJAHR_MIN, TODESJAHR_MAX)
        self.aktiver_spieler_idx = 0
        self.phase = SpielPhase.TITEL
        self.spiel_beendet = False
        self.kaiser_spieler_idx = None
        self.events: list[SpielEvent] = []
        self.kornpreis = 100
        self.landpreis = 35
        self.wetter = "Sonnig"
        self.runden_log: list[dict] = []
        
    def setup(self, spieler_daten: list[dict]):
        """Spiel initialisieren mit Spielerdaten."""
        self.spieler = []
        verfuegbare_staaten = copy.deepcopy(STAATEN)
        
        for i, data in enumerate(spieler_daten):
            staat = data.get('staat', verfuegbare_staaten[i % len(verfuegbare_staaten)])
            if staat in verfuegbare_staaten:
                verfuegbare_staaten.remove(staat)
            
            s = Spieler(
                name=data['name'][:10],
                geschlecht=data.get('geschlecht', 'M'),
                staat=staat,
            )
            self.spieler.append(s)
        
        self.phase = SpielPhase.BILD1_HANDEL
        self._berechne_preise()
        self._berechne_wetter()
    
    def _berechne_preise(self):
        """Korn- und Landpreise zufällig berechnen."""
        self.kornpreis = random.randint(KORNPREIS_MIN, KORNPREIS_MAX)
        self.landpreis = random.randint(LANDPREIS_MIN, LANDPREIS_MAX)
    
    def _berechne_wetter(self):
        """Wetter für dieses Jahr bestimmen."""
        self.wetter = random.choice(WETTER)
    
    @property
    def aktiver_spieler(self) -> Spieler:
        if self.aktiver_spieler_idx < len(self.spieler):
            return self.spieler[self.aktiver_spieler_idx]
        return None
    
    # === BILD 1: Handel & Korn ===
    
    def korn_kaufen(self, menge: int) -> dict:
        """Korn kaufen."""
        s = self.aktiver_spieler
        kosten = menge * self.kornpreis
        if kosten > s.geld:
            return {"erfolg": False, "fehler": "Nicht genug Geld"}
        s.geld -= kosten
        s.korn += menge
        return {"erfolg": True, "geld": s.geld, "korn": s.korn}
    
    def korn_verkaufen(self, menge: int) -> dict:
        """Korn verkaufen (10% Provision)."""
        s = self.aktiver_spieler
        if menge > s.korn:
            return {"erfolg": False, "fehler": "Nicht genug Korn"}
        erloes = int(menge * self.kornpreis * (1 - PROVISION_LANDVERKAUF))
        s.geld += erloes
        s.korn -= menge
        return {"erfolg": True, "geld": s.geld, "korn": s.korn, "erloes": erloes}
    
    def land_kaufen(self, hektar: int) -> dict:
        """Land kaufen."""
        s = self.aktiver_spieler
        kosten = hektar * self.landpreis
        if kosten > s.geld:
            return {"erfolg": False, "fehler": "Nicht genug Geld"}
        s.geld -= kosten
        s.land += hektar
        return {"erfolg": True, "geld": s.geld, "land": s.land}
    
    def land_verkaufen(self, hektar: int) -> dict:
        """Land verkaufen (10% Provision)."""
        s = self.aktiver_spieler
        if hektar > s.land:
            return {"erfolg": False, "fehler": "Nicht genug Land"}
        erloes = int(hektar * self.landpreis * (1 - PROVISION_LANDVERKAUF))
        s.geld += erloes
        s.land -= hektar
        return {"erfolg": True, "geld": s.geld, "land": s.land, "erloes": erloes}
    
    def korn_ausgeben(self, menge: int) -> dict:
        """Korn an Bevölkerung ausgeben."""
        s = self.aktiver_spieler
        noetig = self._korn_benoetigt()
        menge = min(menge, s.korn)
        s.korn -= menge
        s.korn_ausgabe_letztes_jahr = menge
        
        # Auswirkungen
        verhungert = 0
        eingewandert = 0
        
        if menge < noetig:
            # Verhungern
            mangel = noetig - menge
            verhungert = int(s.einwohner * (mangel / max(noetig, 1)) * 0.3)
            s.einwohner -= verhungert
        elif menge > noetig * 1.2:
            # Einwanderung
            ueberschuss = menge - noetig
            eingewandert = int(ueberschuss / max(noetig, 1) * 20)
            s.einwohner += eingewandert
        
        return {
            "erfolg": True,
            "korn": s.korn,
            "verhungert": verhungert,
            "eingewandert": eingewandert,
            "einwohner": s.einwohner,
        }
    
    def _korn_benoetigt(self) -> int:
        """Kornbedarf der Bevölkerung."""
        s = self.aktiver_spieler
        return int(s.einwohner * 17)  # ~17 Maß pro Einwohner
    
    # === BILD 2: Statistik (wird automatisch berechnet) ===
    
    def jahresbilanz(self) -> dict:
        """Berechnet Geburten, Todesfälle, Ein-/Auswanderer."""
        s = self.aktiver_spieler
        noetig = self._korn_benoetigt()
        korn_ausgabe = s.korn_ausgabe_letztes_jahr
        
        geburten = int(s.einwohner * 0.05 * random.uniform(0.8, 1.2))
        todesfaelle = int(s.einwohner * 0.03 * random.uniform(0.8, 1.2))
        
        eingewandert = 0
        ausgewandert = 0
        
        if korn_ausgabe > noetig * 1.1:
            eingewandert = random.randint(5, 30)
        elif korn_ausgabe < noetig * 0.8:
            ausgewandert = random.randint(5, 20)
        
        # Bevölkerung aktualisieren
        s.einwohner += geburten - todesfaelle + eingewandert - ausgewandert
        s.einwohner = max(0, s.einwohner)
        
        # Einnahmen
        einnahmen_marktplaetze = s.maerkte * 100
        einnahmen_muehlen = s.muehlen * 150
        einnahmen_zoll = int(s.einwohner * s.steuer_zoll / 100 * 10)
        einnahmen_mwst = int(s.einwohner * s.steuer_mwst / 100 * 8)
        einnahmen_einkommen = int(s.einwohner * s.steuer_einkommen / 100 * 12)
        einnahmen_justiz = int(s.einwohner * JUSTIZ_FAKTOR[s.justiz] * 5)
        
        gesamt_einnahmen = (einnahmen_marktplaetze + einnahmen_muehlen + 
                           einnahmen_zoll + einnahmen_mwst + einnahmen_einkommen + einnahmen_justiz)
        
        # Ausgaben
        ausgaben_armee = s.truppen.gesamt() * 10
        ausgaben_hof = 100 + (s.rang + 1) * 50 if s.rang >= 0 else 100
        
        gesamt_ausgaben = ausgaben_armee + ausgaben_hof
        
        # Saldo
        s.geld += gesamt_einnahmen - gesamt_ausgaben
        
        # Korn-Ertrag
        ertrag_faktor = WETTER_ERTRAG[self.wetter]
        korn_ertrag = int(s.land_bebaut * ertrag_faktor * random.uniform(0.8, 1.2))
        s.korn += korn_ertrag
        
        return {
            "geburten": geburten,
            "todesfaelle": todesfaelle,
            "eingewandert": eingewandert,
            "ausgewandert": ausgewandert,
            "einnahmen_marktplaetze": einnahmen_marktplaetze,
            "einnahmen_muehlen": einnahmen_muehlen,
            "einnahmen_zoll": einnahmen_zoll,
            "einnahmen_mwst": einnahmen_mwst,
            "einnahmen_einkommen": einnahmen_einkommen,
            "einnahmen_justiz": einnahmen_justiz,
            "gesamt_einnahmen": gesamt_einnahmen,
            "ausgaben_armee": ausgaben_armee,
            "ausgaben_hof": ausgaben_hof,
            "gesamt_ausgaben": gesamt_ausgaben,
            "saldo": gesamt_einnahmen - gesamt_ausgaben,
            "korn_ertrag": korn_ertrag,
            "geld": s.geld,
            "korn": s.korn,
            "einwohner": s.einwohner,
        }
    
    # === BILD 3: Steuern ===
    
    def steuern_aendern(self, steuer_typ: str, wert: int) -> dict:
        """Steuersatz ändern."""
        s = self.aktiver_spieler
        if steuer_typ == "zoll":
            s.steuer_zoll = max(0, min(50, wert))
        elif steuer_typ == "mwst":
            s.steuer_mwst = max(0, min(50, wert))
        elif steuer_typ == "einkommen":
            s.steuer_einkommen = max(0, min(99, wert))
        return {"erfolg": True, "spieler": s.to_dict()}
    
    def justiz_aendern(self, stufe: int) -> dict:
        """Justiz-Stufe ändern (0-3)."""
        s = self.aktiver_spieler
        s.justiz = max(0, min(3, stufe))
        return {"erfolg": True, "justiz": JUSTIZ_STUFEN[s.justiz]}
    
    # === BILD 5: Bauen ===
    
    def marktplatz_bauen(self) -> dict:
        s = self.aktiver_spieler
        if s.geld < MARKTPLATZ_KOSTEN:
            return {"erfolg": False, "fehler": "Nicht genug Geld"}
        if s.land < MARKTPLATZ_LAND:
            return {"erfolg": False, "fehler": "Nicht genug Land"}
        s.geld -= MARKTPLATZ_KOSTEN
        s.land -= MARKTPLATZ_LAND
        s.maerkte += 1
        return {"erfolg": True, "maerkte": s.maerkte, "geld": s.geld, "land": s.land}
    
    def kornmühle_bauen(self) -> dict:
        s = self.aktiver_spieler
        if s.geld < KORNMUEHLE_KOSTEN:
            return {"erfolg": False, "fehler": "Nicht genug Geld"}
        if s.land < KORNMUEHLE_LAND:
            return {"erfolg": False, "fehler": "Nicht genug Land"}
        s.geld -= KORNMUEHLE_KOSTEN
        s.land -= KORNMUEHLE_LAND
        s.muehlen += 1
        return {"erfolg": True, "muehlen": s.muehlen, "geld": s.geld, "land": s.land}
    
    def palast_bauen(self) -> dict:
        s = self.aktiver_spieler
        if s.palast_teile >= PALAST_TEILE:
            return {"erfolg": False, "fehler": "Palast bereits fertig"}
        if s.geld < PALAST_TEIL_KOSTEN:
            return {"erfolg": False, "fehler": "Nicht genug Geld"}
        if s.land < PALAST_LAND:
            return {"erfolg": False, "fehler": "Nicht genug Land (13000 noetig)"}
        s.geld -= PALAST_TEIL_KOSTEN
        s.palast_teile += 1
        return {"erfolg": True, "palast_teile": s.palast_teile, "geld": s.geld}
    
    def kathedrale_bauen(self) -> dict:
        s = self.aktiver_spieler
        if s.kathedrale_teile >= KATHEDRALE_TEILE:
            return {"erfolg": False, "fehler": "Kathedrale bereits fertig"}
        if s.geld < KATHEDRALE_TEIL_KOSTEN:
            return {"erfolg": False, "fehler": "Nicht genug Geld"}
        if s.land < KATHEDRALE_LAND:
            return {"erfolg": False, "fehler": "Nicht genug Land (25000 noetig)"}
        s.geld -= KATHEDRALE_TEIL_KOSTEN
        s.kathedrale_teile += 1
        return {"erfolg": True, "kathedrale_teile": s.kathedrale_teile, "geld": s.geld}
    
    # === Militär ===
    
    def soldaten_rekrutieren(self, truppentyp: str, anzahl: int) -> dict:
        """Soldaten aus Bevölkerung rekrutieren."""
        s = self.aktiver_spieler
        if anzahl > s.einwohner:
            return {"erfolg": False, "fehler": "Nicht genug Einwohner"}
        
        kosten = {
            "kavallerie": anzahl * 50,
            "artillerie": anzahl * 80,
            "infanterie": anzahl * 30,
        }[truppentyp]
        
        if kosten > s.geld:
            return {"erfolg": False, "fehler": "Nicht genug Geld"}
        
        s.geld -= kosten
        s.einwohner -= anzahl
        
        if truppentyp == "kavallerie":
            s.truppen.kavallerie += anzahl
        elif truppentyp == "artillerie":
            s.truppen.artillerie += anzahl
        elif truppentyp == "infanterie":
            s.truppen.infanterie += anzahl
        
        return {"erfolg": True, "truppen": asdict(s.truppen), "geld": s.geld, "einwohner": s.einwohner}
    
    def soeldner_anwerben(self, truppentyp: str, anzahl: int) -> dict:
        """Söldner anwerben (teurer, keine Bevölkerungsreduktion)."""
        s = self.aktiver_spieler
        kosten = {
            "kavallerie": anzahl * 100,
            "artillerie": anzahl * 160,
            "infanterie": anzahl * 60,
        }[truppentyp]
        
        if kosten > s.geld:
            return {"erfolg": False, "fehler": "Nicht genug Geld"}
        
        s.geld -= kosten
        if truppentyp == "kavallerie":
            s.truppen.kavallerie += anzahl
        elif truppentyp == "artillerie":
            s.truppen.artillerie += anzahl
        elif truppentyp == "infanterie":
            s.truppen.infanterie += anzahl
        
        return {"erfolg": True, "truppen": asdict(s.truppen), "geld": s.geld}
    
    def manoever(self) -> dict:
        """Manöver durchführen → Kampfwert verbessern."""
        s = self.aktiver_spieler
        kosten = s.truppen.gesamt() * 5
        if kosten > s.geld:
            return {"erfolg": False, "fehler": "Nicht genug Geld"}
        s.geld -= kosten
        s.truppen_kampfwert = min(100, s.truppen_kampfwert + random.randint(2, 8))
        return {"erfolg": True, "kampfwert": s.truppen_kampfwert, "kosten": kosten, "geld": s.geld}
    
    def krieg_erklaeren(self, verteidiger_idx: int) -> dict:
        """Krieg erklären."""
        angreifer = self.aktiver_spieler
        if angreifer.rang < 0:
            return {"erfolg": False, "fehler": "Braucht mindestens Baron-Rang"}
        if verteidiger_idx < 0 or verteidiger_idx >= len(self.spieler):
            return {"erfolg": False, "fehler": "Ungueltiger Gegner"}
        
        verteidiger = self.spieler[verteidiger_idx]
        
        # Grenze prüfen
        if verteidiger.staat not in GRENZEN.get(angreifer.staat, []):
            return {"erfolg": False, "fehler": "Keine direkte Grenze zu " + verteidiger.staat}
        
        return {
            "erfolg": True,
            "angreifer": angreifer.name,
            "verteidiger": verteidiger.name,
            "angreifer_truppen": asdict(angreifer.truppen),
            "verteidiger_truppen": asdict(verteidiger.truppen),
        }
    
    def krieg_durchfuehren(self, verteidiger_idx: int, angreifer_truppen: dict, verteidiger_truppen: dict) -> dict:
        """Krieg simulieren (vereinfacht)."""
        angreifer = self.aktiver_spieler
        verteidiger = self.spieler[verteidiger_idx]
        
        # Kampfkraft berechnen
        angreifer_kraft = (angreifer.truppen.kavallerie * 3 + angreifer.truppen.artillerie * 2 + 
                          angreifer.truppen.infanterie * 1) * (angreifer.truppen_kampfwert / 100)
        verteidiger_kraft = (verteidiger.truppen.kavallerie * 3 + verteidiger.truppen.artillerie * 2 + 
                            verteidiger.truppen.infanterie * 1) * (verteidiger.truppen_kampfwert / 100)
        verteidiger_kraft += verteidiger.miliz  # Miliz verteidigt
        
        # Zufallsfaktor (Schlachtenglück)
        angreifer_kraft *= random.uniform(0.7, 1.3)
        verteidiger_kraft *= random.uniform(0.7, 1.3)
        
        angreifer_gewinnt = angreifer_kraft > verteidiger_kraft
        
        # Verluste
        angreifer_verluste = int(angreifer.truppen.gesamt() * random.uniform(0.1, 0.4))
        verteidiger_verluste = int(verteidiger.truppen.gesamt() * random.uniform(0.1, 0.4))
        
        # Truppen reduzieren
        self._truppen_reduzieren(angreifer, angreifer_verluste)
        self._truppen_reduzieren(verteidiger, verteidiger_verluste)
        
        ergebnis = {
            "angreifer": angreifer.name,
            "verteidiger": verteidiger.name,
            "angreifer_gewinnt": angreifer_gewinnt,
            "angreifer_verluste": angreifer_verluste,
            "verteidiger_verluste": verteidiger_verluste,
        }
        
        if angreifer_gewinnt:
            # Landgewinn
            land_gewinn = min(verteidiger.land // 4, 5000)
            verteidiger.land -= land_gewinn
            angreifer.land += land_gewinn
            ergebnis["land_gewinn"] = land_gewinn
        else:
            # Angreifer verliert Geld
            geld_verlust = min(angreifer.geld // 4, 5000)
            angreifer.geld -= geld_verlust
            ergebnis["geld_verlust"] = geld_verlust
        
        self.events.append(SpielEvent(
            self.jahr, angreifer.name, "krieg",
            f"{angreifer.name} griff {verteidiger.name} an und {'gewann' if angreifer_gewinnt else 'verlor'}.",
            ergebnis
        ))
        
        return ergebnis
    
    def _truppen_reduzieren(self, spieler: Spieler, verluste: int):
        """Truppenverluste proportional verteilen."""
        t = spieler.truppen
        gesamt = t.gesamt()
        if gesamt == 0:
            return
        ratio = verluste / gesamt
        t.kavallerie = max(0, int(t.kavallerie * (1 - ratio)))
        t.artillerie = max(0, int(t.artillerie * (1 - ratio)))
        t.infanterie = max(0, int(t.infanterie * (1 - ratio)))
    
    # === Rundenverwaltung ===
    
    def zug_beenden(self) -> dict:
        """Spielerzug beenden → Beförderung prüfen → nächster Spieler."""
        s = self.aktiver_spieler
        
        # Zinsen berechnen
        if s.geld > 0:
            s.geld += int(s.geld * 0.05)  # 5% Zinsen auf positives Guthaben
        elif s.geld < 0:
            s.geld -= int(abs(s.geld) * 0.10)  # 10% Schuldenzinsen
        
        # Beförderung prüfen
        befoerderung = self._befoerderung_pruefen(s)
        
        # Tod prüfen
        if self.jahr >= self.todesjahr:
            s.tot = True
        
        # Spielende prüfen
        if s.ist_kaiser:
            self.spiel_beendet = True
            self.kaiser_spieler_idx = self.aktiver_spieler_idx
            self.phase = SpielPhase.KROENUNG
            return {"spielende": True, "kaiser": s.name, "befoerderung": befoerderung}
        
        # Nächster Spieler
        lebende_spieler = [i for i, sp in enumerate(self.spieler) if not sp.tot]
        if not lebende_spieler:
            self.spiel_beendet = True
            return {"spielende": True, "grund": "Alle Spieler tot"}
        
        aktueller = self.aktiver_spieler_idx
        naechster = None
        for i in range(aktueller + 1, aktueller + 1 + len(self.spieler)):
            idx = i % len(self.spieler)
            if not self.spieler[idx].tot:
                naechster = idx
                break
        
        if naechster is not None:
            # Wenn wir wieder beim ersten Spieler sind → neues Jahr
            if naechster <= aktueller:
                self.jahr += 1
                self._berechne_preise()
                self._berechne_wetter()
                # Alle Spieler: Jahresbilanz
                for sp in self.spieler:
                    if not sp.tot:
                        self.jahresbilanz_fuer_spieler(sp)
            
            self.aktiver_spieler_idx = naechster
            self.phase = SpielPhase.BILD1_HANDEL
            
            return {
                "spielende": False,
                "naechster_spieler": self.spieler[naechster].name,
                "naechster_spieler_idx": naechster,
                "befoerderung": befoerderung,
                "jahr": self.jahr,
            }
        
        return {"spielende": True}
    
    def _befoerderung_pruefen(self, s: Spieler) -> Optional[dict]:
        """Prüft ob eine Beförderung fällig ist."""
        if s.tot:
            return None
        
        naechster_rang = s.rang + 1
        
        # Bedingungen für Beförderung
        if s.geld <= 0:
            return None
        
        if naechster_rang >= len(TITEL):
            return None
        
        # Spezifische Bedingungen für höhere Ränge
        if naechster_rang == 6:  # König → braucht Palast
            if not s.hat_palast:
                return None
        
        if naechster_rang == 7:  # Kaiser → braucht Kathedrale
            if not s.hat_kathedrale:
                return None
            if s.land < KAISER_LAND:
                return None
            if s.geld < KAISER_GELD:
                return None
            if s.staedte < KAISER_STAEDTE:
                return None
        
        # Befördern
        alter_rang = s.rang
        s.rang = naechster_rang
        
        self.events.append(SpielEvent(
            self.jahr, s.name, "befoerderung",
            f"{s.name} wurde zu {s.titel} befördert.",
            {"alter_rang": alter_rang, "neuer_rang": s.rang, "titel": s.titel}
        ))
        
        return {"alter_rang": alter_rang, "neuer_rang": s.rang, "titel": s.titel}
    
    def jahresbilanz_fuer_spieler(self, s: Spieler):
        """Jahresbilanz für einen Spieler (intern, am Jahresende)."""
        # Bevölkerungswachstum
        if s.einwohner < 500:
            s.einwohner = max(0, s.einwohner - 50)  # Bevölkerungsschwund
        
        # Land bebaut (automatisch, basierend auf Einwohnern)
        s.land_bebaut = min(s.land, s.einwohner)
    
    def spielstand(self) -> dict:
        """Kompletter Spielstand als Dict."""
        return {
            "spiel_id": self.spiel_id,
            "jahr": self.jahr,
            "todesjahr": self.todesjahr,
            "phase": self.phase.value,
            "aktiver_spieler_idx": self.aktiver_spieler_idx,
            "kornpreis": self.kornpreis,
            "landpreis": self.landpreis,
            "wetter": self.wetter,
            "spiel_beendet": self.spiel_beendet,
            "kaiser_spieler_idx": self.kaiser_spieler_idx,
            "spieler": [s.to_dict() for s in self.spieler],
            "events": [{"jahr": e.jahr, "spieler": e.spieler, "typ": e.typ, 
                        "beschreibung": e.beschreibung} for e in self.events[-20:]],
        }
    
    def to_json(self) -> str:
        return json.dumps(self.spielstand(), ensure_ascii=False, indent=2)
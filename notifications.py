"""
Kaiser Online - Notification Service
Sendet Benachrichtigungen an Spieler wenn sie dran sind.
Unterstützt: Telegram Bot API, SMS (via Twilio/webhook), Webhook.
"""
import os
import json
import urllib.request
import urllib.parse
import logging
from typing import Optional

logger = logging.getLogger("kaiser.notifications")


class NotificationService:
    """Versendet 'Du bist dran' und Rundenende-Notifications."""
    
    def __init__(self, telegram_bot_token: str = "", telegram_api_base: str = "https://api.telegram.org"):
        self.telegram_bot_token = telegram_bot_token
        self.telegram_api_base = telegram_api_base
        # Spieler-Map: name -> {telegram_chat_id, phone, webhook_url}
        self.spieler_kontakte: dict[str, dict] = {}
    
    def set_telegram_token(self, token: str):
        self.telegram_bot_token = token
    
    def register_spieler(self, name: str, telegram_chat_id: str = None, phone: str = None, webhook_url: str = None):
        """Spieler für Notifications registrieren."""
        self.spieler_kontakte[name] = {
            "telegram_chat_id": telegram_chat_id,
            "phone": phone,
            "webhook_url": webhook_url,
        }
    
    def notify_du_bist_dran(self, spieler_name: str, spiel_code: str, jahr: int, staat: str, url: str = ""):
        """'Du bist dran' Benachrichtigung senden."""
        text = (
            f"🎮 KAISER ONLINE\n\n"
            f"Du bist dran, {spieler_name}!\n"
            f"Jahr {jahr} | {staat}\n"
            f"Spielcode: {spiel_code}\n"
        )
        if url:
            text += f"\n👉 {url}/?code={spiel_code}\n"
        
        self._send(spieler_name, text, parse_mode="HTML")
    
    def notify_runde_beendet(self, spieler_name: str, naechster_spieler: str, jahr: int, befoerderung: dict = None):
        """'Runde beendet' Benachrichtigung senden."""
        text = f"🎮 KAISER ONLINE\n\n{jahr} — {spieler_name} hat den Zug beendet.\n"
        if befoerderung:
            text += f"🎖️ {spieler_name} wurde zu {befoerderung.get('titel','')} befördert!\n"
        text += f"\nJetzt dran: {naechster_spieler}"
        
        # An alle registrierten Spieler senden
        for name, kontakt in self.spieler_kontakte.items():
            if name != naechster_spieler:  # Der nächste bekommt eine extra "Du bist dran" Nachricht
                self._send(name, text, parse_mode="HTML")
    
    def notify_krieg(self, angreifer: str, verteidiger: str, ergebnis: dict):
        """Kriegs-Ergebnis an alle senden."""
        text = (
            f"⚔️ KRIEG!\n\n"
            f"{angreifer} griff {verteidiger} an und "
            f"{'GEWANN' if ergebnis.get('angreifer_gewinnt') else 'VERLOAR'}.\n"
        )
        if ergebnis.get('land_gewinn'):
            text += f"Landgewinn: {ergebnis['land_gewinn']} Ha\n"
        if ergebnis.get('geld_verlust'):
            text += f"Geldverlust: {ergebnis['geld_verlust']}\n"
        text += f"\nVerluste A: {ergebnis.get('angreifer_verluste',0)} | V: {ergebnis.get('verteidiger_verluste',0)}"
        
        for name in self.spieler_kontakte:
            self._send(name, text, parse_mode="HTML")
    
    def notify_spieler_de(self, spieler_name: str, nachricht: str):
        """Allgemeine Nachricht an einen Spieler."""
        self._send(spieler_name, nachricht, parse_mode="HTML")
    
    def _send(self, spieler_name: str, text: str, parse_mode: str = None):
        """Nachricht über alle verfügbaren Kanäle senden."""
        kontakt = self.spieler_kontakte.get(spieler_name)
        if not kontakt:
            logger.debug(f"Kein Kontakt für Spieler {spieler_name}")
            return
        
        sent = False
        
        # Telegram (sendet auch ohne Token ins Log-File als Fallback)
        if kontakt.get("telegram_chat_id"):
            try:
                self._send_telegram(kontakt["telegram_chat_id"], text, parse_mode)
                sent = True
            except Exception as e:
                logger.error(f"Telegram send failed: {e}")
        
        # Webhook (z.B. für WhatsApp Business API)
        if kontakt.get("webhook_url"):
            try:
                self._send_webhook(kontakt["webhook_url"], spieler_name, text)
                sent = True
            except Exception as e:
                logger.error(f"Webhook send failed: {e}")
        
        # SMS (via Twilio oder ähnlich - würde hier implementiert)
        if kontakt.get("phone"):
            logger.info(f"SMS an {spieler_name} ({kontakt['phone']}): {text[:50]}...")
            # SMS-Versand würde hier implementiert werden (Twilio, etc.)
            # self._send_sms(kontakt["phone"], text)
        
        if not sent:
            logger.debug(f"Kein Versandkanal für {spieler_name}")
    
    def _send_telegram(self, chat_id: str, text: str, parse_mode: str = None):
        """Telegram Bot API Nachricht senden."""
        if not self.telegram_bot_token:
            logger.warning("Kein Telegram Bot Token gesetzt - Notification übersprungen")
            # Fallback: Schreibe in Log-Datei
            log_path = os.environ.get("KAISER_NOTIF_LOG", "/tmp/kaiser_notifications.log")
            with open(log_path, "a") as f:
                f.write(f"[{chat_id}] {text}\n---\n")
            return
        url = f"{self.telegram_api_base}/bot{self.telegram_bot_token}/sendMessage"
        data = urllib.parse.urlencode({
            "chat_id": chat_id,
            "text": text,
            "parse_mode": parse_mode or "HTML",
        }).encode()
        req = urllib.request.Request(url, data=data)
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read())
            if not result.get("ok"):
                raise Exception(f"Telegram API error: {result}")
    
    def _send_webhook(self, url: str, spieler_name: str, text: str):
        """Webhook aufrufen (z.B. WhatsApp Business API)."""
        data = json.dumps({"spieler": spieler_name, "text": text}).encode()
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status >= 400:
                raise Exception(f"Webhook error: {resp.status}")
    
    def _send_sms(self, phone: str, text: str):
        """SMS versenden ( Platzhalter für Twilio/other SMS gateway)."""
        # Implementation würde Twilio oder anderen SMS-Provider nutzen
        # Beispiel:
        # from twilio.rest import Client
        # client = Client(account_sid, auth_token)
        # client.messages.create(to=phone, from_=from_number, body=text[:160])
        pass


# === Singleton ===
_notification_service: Optional[NotificationService] = None

def get_notification_service() -> NotificationService:
    global _notification_service
    if _notification_service is None:
        token = os.environ.get("KAISER_TELEGRAM_BOT_TOKEN", "")
        _notification_service = NotificationService(telegram_bot_token=token)
    return _notification_service

def init_notification_service(telegram_bot_token: str = ""):
    global _notification_service
    token = telegram_bot_token or os.environ.get("KAISER_TELEGRAM_BOT_TOKEN", "")
    _notification_service = NotificationService(telegram_bot_token=token)
    return _notification_service
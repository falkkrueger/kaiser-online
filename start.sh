#!/bin/bash
# Kaiser Online - Start-Skript
# Startet den Server auf Port 8080

cd /home/hermes/kaiser

# Telegram Bot Token (optional - fuer Notifications)
# Setzen mit: export KAISER_TELEGRAM_BOT_TOKEN="dein-bot-token"
# Ohne Token werden Notifications ins Log-File /tmp/kaiser_notifications.log geschrieben

# Basis-URL fuer Notifications (wird in Telegram-Nachrichten eingebettet)
export KAISER_BASE_URL="${KAISER_BASE_URL:-http://192.168.5.149:8080}"

echo "================================"
echo "  KAISER ONLINE - Starte Server"
echo "  URL: $KAISER_BASE_URL"
echo "  Port: 8080"
echo "================================"

python3 server.py
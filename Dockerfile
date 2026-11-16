FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
# C64-ROMs holen, falls nicht mitgeliefert (die Diskette media/kaiser.d64 muss vorhanden sein)
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/* \
 && sh scripts/fetch-roms.sh
ENV PORT=8080 KAISER_DATA=/data
EXPOSE 8080
CMD ["node", "server.js"]

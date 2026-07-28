FROM node:20-bookworm-slim

# Installa ffmpeg e python3 (che a volte serve al motore yt-dlp)
RUN apt-get update && \
    apt-get install -y ffmpeg python3 && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Crea la directory di lavoro
WORKDIR /usr/src/app

# Copia i file delle dipendenze e installa
COPY package*.json ./
RUN npm install

# Copia il resto del codice
COPY . .

# Esponi la porta 3000
EXPOSE 3000

# Avvia l'applicazione
CMD [ "node", "server.js" ]

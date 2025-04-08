# Gebruik een officiële Node.js 18 image
FROM node:18-bullseye

# Installeer systeemafhankelijkheden die Chromium nodig heeft
RUN apt-get update && apt-get install -y \
  chromium \
  fonts-liberation \
  libappindicator3-1 \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libatspi2.0-0 \
  libc6 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libexpat1 \
  libfontconfig1 \
  libgcc1 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxi6 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxtst6 \
  xdg-utils \
  ca-certificates \
  --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

# Stel in dat Puppeteer zijn eigen Chromium niet moet downloaden (optioneel)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false

# Maak een werkmap in de container
WORKDIR /app

# Kopieer package files en installeer dependencies
COPY package*.json ./
RUN npm install

# Kopieer de rest van de code
COPY . .

# Exposeer poort 3000 (Render geeft de poort via een env-variable)
EXPOSE 3000

# Start de server via het startscript
CMD ["npm", "start"]

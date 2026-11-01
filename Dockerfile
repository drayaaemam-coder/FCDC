FROM node:22-alpine
# Chromium لتوليد ملفات PDF، وخطوط عربية احتياطية
RUN apk add --no-cache chromium nss freetype harfbuzz ttf-freefont font-noto-arabic
ENV CHROME_PATH=/usr/bin/chromium-browser \
    PUPPETEER_SKIP_DOWNLOAD=1
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
RUN mkdir -p /app/uploads
ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "node src/db/init.js && node src/server.js"]

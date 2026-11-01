FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
RUN mkdir -p /app/uploads
ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "node src/db/init.js && node src/server.js"]

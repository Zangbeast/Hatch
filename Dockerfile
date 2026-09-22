FROM node:22-slim

WORKDIR /app

# Install dependencies first so this layer is cached unless they change.
COPY package*.json ./
RUN npm ci --omit=dev

# App source
COPY . .

ENV NODE_ENV=production
ENV PORT=3000

# The database and the auto-generated push keys live under /data, which
# docker-compose mounts as a persistent volume so they survive rebuilds.
ENV DB_PATH=/data/data.db
ENV VAPID_KEYS_PATH=/data/vapid-keys.json

EXPOSE 3000
CMD ["node", "server/index.js"]

FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
# Migrations are idempotent and guarded by an advisory lock.
CMD ["sh", "-c", "node src/db/migrate.js && node src/server.js"]

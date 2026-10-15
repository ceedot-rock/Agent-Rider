# Agent-Rider — Fly.io production image
FROM node:20-slim AS deps
WORKDIR /app
COPY src/package.json src/package-lock.json* ./
RUN npm ci

FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY src/ ./
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOST=0.0.0.0

# python3: needed by the toll tool trustream-pack (stdlib-only packer).
RUN apt-get update && apt-get install -y --no-install-recommends python3 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.js ./
COPY --from=builder /app/server.mjs ./
COPY --from=builder /app/lib ./lib
# Toll-tool native binaries + vendored packer (built/vendored in-repo).
COPY --from=builder /app/pcc-bin ./pcc-bin
COPY --from=builder /app/cuni-bin ./cuni-bin
COPY --from=builder /app/vendor ./vendor

EXPOSE 3000
CMD ["node", "server.mjs"]

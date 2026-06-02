# GalleryOS server image.
#
# Bun runs TypeScript directly, so there is no build/transpile step — the image
# just needs dependencies installed and the source present. Build context is the
# REPO ROOT (workspace packages live in ../../packages), so build with:
#   docker build -f apps/server/Dockerfile --target prod -t galleryos-server .
#
# Targets: `dev` (hot reload via `bun --watch`) and `prod` (migrate then serve).

# ── base: install workspace dependencies ─────────────────────
FROM oven/bun:1.3.14-alpine AS base
WORKDIR /app

# Copy only manifests first for better layer caching of the install step.
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY packages/driver-core/package.json packages/driver-core/
COPY packages/drivers/driver-pjlink/package.json packages/drivers/driver-pjlink/
COPY packages/drivers/driver-tcp-generic/package.json packages/drivers/driver-tcp-generic/
RUN bun install --frozen-lockfile

# Copy the full source (workspace symlinks created above now resolve).
COPY . .
WORKDIR /app/apps/server

# ── dev: hot-reloading development server ────────────────────
FROM base AS dev
ENV NODE_ENV=development
EXPOSE 3000
CMD ["bun", "--watch", "src/index.ts"]

# ── prod: run migrations, then serve ─────────────────────────
FROM base AS prod
ENV NODE_ENV=production
EXPOSE 3000
# 8765/udp (OSC) and 8766 (TCP input) are added with the protocol-input step.
ENTRYPOINT ["sh", "-c", "bun src/db/migrate.ts && exec bun src/index.ts"]

### Build stage
FROM node:20-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/server ./apps/server

RUN pnpm install --frozen-lockfile=false --prefer-offline
RUN pnpm --filter @galleryos/server build

### Dev stage (hot reload)
FROM node:20-alpine AS dev
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/server ./apps/server
RUN pnpm install --frozen-lockfile=false --prefer-offline
EXPOSE 3000 8765/udp 8766
CMD ["pnpm", "--filter", "@galleryos/server", "dev"]

### Production runtime
FROM node:20-alpine AS prod
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app
COPY --from=build /app /app
EXPOSE 3000 8765/udp 8766
CMD ["pnpm", "--filter", "@galleryos/server", "start"]

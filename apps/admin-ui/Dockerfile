### Build
FROM node:20-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/admin-ui ./apps/admin-ui
RUN pnpm install --prefer-offline
RUN pnpm --filter @galleryos/admin-ui build

### Dev
FROM node:20-alpine AS dev
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/admin-ui ./apps/admin-ui
RUN pnpm install --prefer-offline
EXPOSE 4000
CMD ["pnpm", "--filter", "@galleryos/admin-ui", "dev", "--host", "0.0.0.0"]

### Runtime (nginx)
FROM nginx:1.27-alpine AS prod
COPY --from=build /app/apps/admin-ui/dist /usr/share/nginx/html
COPY apps/admin-ui/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

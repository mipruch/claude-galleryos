FROM node:20-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/user-ui ./apps/user-ui
RUN pnpm install --prefer-offline
RUN pnpm --filter @galleryos/user-ui build

FROM node:20-alpine AS dev
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/user-ui ./apps/user-ui
RUN pnpm install --prefer-offline
EXPOSE 5000
CMD ["pnpm", "--filter", "@galleryos/user-ui", "dev", "--host", "0.0.0.0"]

FROM nginx:1.27-alpine AS prod
COPY --from=build /app/apps/user-ui/dist /usr/share/nginx/html
COPY apps/user-ui/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

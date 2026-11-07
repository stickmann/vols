# API: сборка TypeScript в JavaScript и образ только с рабочими зависимостями.
# Собирается из корня репозитория: docker build -f apps/api/Dockerfile .
FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter "@vols/api..."
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN cd apps/api && node build.mjs
# Зависимости для работы, без TypeScript, tsx, esbuild, drizzle-kit и тестов.
RUN pnpm --filter @vols/api deploy --prod --legacy /out

FROM node:22-slim
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json ./
COPY --from=build /app/apps/api/migrations ./migrations
COPY --from=build /app/apps/api/dist ./dist
ENV NODE_ENV=production
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Миграции и демо-данные: docker compose run --rm api node dist/migrate.js | node dist/seed.js
CMD ["node", "--enable-source-maps", "dist/server.js"]

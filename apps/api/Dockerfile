# API: Node 22 + tsx (исходники TypeScript запускаются без отдельной сборки).
# Собирается из корня репозитория: docker build -f apps/api/Dockerfile .
FROM node:22-slim
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

# Сначала только манифесты — слой с зависимостями кешируется между сборками.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter "@vols/api..."

COPY packages/shared packages/shared
COPY apps/api apps/api

ENV NODE_ENV=production
WORKDIR /app/apps/api
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node_modules/.bin/tsx", "src/server.ts"]

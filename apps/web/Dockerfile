# syntax=docker/dockerfile:1.7

# --- build stage ---
FROM node:22-alpine AS builder
WORKDIR /app
ARG VITE_API_URL
ARG SERVICE_URL_API
ARG VITE_DOCS_URL
ARG SERVICE_URL_DOCS
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json tsconfig.base.json ./
COPY config/desktop-release.cjs config/desktop-release.cjs
COPY config/desktop-release.json config/desktop-release.json
COPY packages/shared/package.json packages/shared/package.json
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
  npm ci --workspace packages/shared --workspace apps/web --include-workspace-root
COPY packages/shared/src packages/shared/src
COPY CHANGELOG.md CHANGELOG.md
COPY apps/web/index.html apps/web/index.html
COPY apps/web/public apps/web/public
COPY apps/web/tsconfig.json apps/web/tsconfig.json
COPY apps/web/tsconfig.app.json apps/web/tsconfig.app.json
COPY apps/web/vite.config.ts apps/web/vite.config.ts
COPY apps/web/src apps/web/src
RUN VITE_API_URL="${VITE_API_URL:-${SERVICE_URL_API:-http://localhost:4000}}" \
  VITE_DOCS_URL="${VITE_DOCS_URL:-$SERVICE_URL_DOCS}" \
  npm run build --workspace apps/web

# --- serve stage ---
FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/config/desktop-release.cjs config/desktop-release.cjs
COPY --from=builder /app/config/desktop-release.json config/desktop-release.json
COPY --from=builder /app/packages/shared/package.json packages/shared/package.json
COPY --from=builder /app/apps/web/package.json apps/web/package.json
COPY --from=builder /app/apps/web/vite.config.ts apps/web/vite.config.ts
COPY --from=builder /app/apps/web/dist apps/web/dist
CMD ["npm", "run", "preview", "--workspace", "apps/web"]

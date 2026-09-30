# syntax=docker/dockerfile:1.7
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/docs/package.json apps/docs/package.json
COPY config/desktop-release.cjs config/desktop-release.cjs
COPY config/desktop-release.json config/desktop-release.json
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
  npm ci --workspace apps/docs --include-workspace-root=false
COPY apps/docs apps/docs
RUN npm run build --workspace apps/docs
CMD ["npm", "run", "preview", "--workspace", "apps/docs"]

# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
  bash \
  ca-certificates \
  curl \
  git \
  jq \
  less \
  nfs-common \
  procps \
  python3 \
  python3-pip \
  unzip \
  util-linux \
  wget \
  xfsprogs \
  zip \
  && rm -rf /var/lib/apt/lists/*
RUN python3 -m pip install --no-cache-dir --break-system-packages pypdf
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/worker/package.json apps/worker/package.json
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
  npm ci --workspace packages/shared --workspace apps/worker --include-workspace-root=false
COPY packages/shared/tsconfig.json packages/shared/tsconfig.json
COPY packages/shared/src packages/shared/src
COPY apps/worker/tsconfig.json apps/worker/tsconfig.json
COPY apps/worker/src apps/worker/src
RUN npm run build --workspace packages/shared && npm run build --workspace apps/worker
COPY prompt-texts prompt-texts
COPY skills skills
RUN if [ -f /app/skills/deep-ai-search/package-lock.json ]; then \
    cd /app/skills/deep-ai-search && npm ci --omit=dev --omit=optional; \
  fi
COPY apps/worker/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "run", "start", "--workspace", "apps/worker"]

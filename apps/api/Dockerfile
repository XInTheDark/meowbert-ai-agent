# syntax=docker/dockerfile:1.7
FROM debian:bookworm-slim AS live-sync-helper-builder
RUN apt-get update && apt-get install -y --no-install-recommends build-essential linux-libc-dev \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY apps/api/native/meowbert-safe-live-sync.c ./meowbert-safe-live-sync.c
RUN cc -O2 -Wall -Wextra -Werror -o meowbert-safe-live-sync meowbert-safe-live-sync.c

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
  bash \
  ca-certificates \
  curl \
  fuse3 \
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
RUN python3 -m pip install --no-cache-dir --break-system-packages yt-dlp
RUN curl -fsSL https://rclone.org/install.sh | bash
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
  npm ci --workspace packages/shared --workspace apps/api --include-workspace-root=false
COPY packages/shared/tsconfig.json packages/shared/tsconfig.json
COPY packages/shared/src packages/shared/src
COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY apps/api/src apps/api/src
RUN npm run build --workspace packages/shared && npm run build --workspace apps/api
COPY db/migrations db/migrations
COPY prompt-texts prompt-texts
COPY skills skills
COPY apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY --from=live-sync-helper-builder /build/meowbert-safe-live-sync /usr/local/bin/meowbert-safe-live-sync
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "run", "start", "--workspace", "apps/api"]

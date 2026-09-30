FROM postgres:16-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends cron gzip \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY apps/postgres-backup/entrypoint.sh /app/entrypoint.sh
COPY apps/postgres-backup/backup.sh /app/backup.sh

RUN chmod +x /app/entrypoint.sh /app/backup.sh

ENTRYPOINT ["/app/entrypoint.sh"]

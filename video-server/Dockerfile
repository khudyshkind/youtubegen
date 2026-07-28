FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     curl \
     ca-certificates \
     postgresql-client \
     ffmpeg \
  && pg_dump --version \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY video-server/package.json ./
RUN npm install --omit=dev

COPY video-server/index.js video-server/instrument.js ./
COPY video-server/image-style-configs.json video-server/image-scene-prompts.json ./
COPY knowledge/lefiro_kb_bot.md ./knowledge/

EXPOSE 3001

CMD ["node", "index.js"]

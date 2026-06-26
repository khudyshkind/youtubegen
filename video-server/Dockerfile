FROM node:22-slim

# bust cache to force reinstall if postgresql-client was missing in prior build
ARG CACHE_BUST=2
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     curl \
     ca-certificates \
     postgresql-client \
  && pg_dump --version \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY index.js instrument.js ./

EXPOSE 3001

CMD ["node", "index.js"]

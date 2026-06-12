FROM node:20-slim

# Install FFmpeg and libass (for subtitle burn-in)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY video-server/package.json ./
RUN npm install --omit=dev

COPY video-server/index.js ./

EXPOSE 3001

CMD ["node", "index.js"]

FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     ffmpeg \
     fonts-liberation \
     fontconfig \
     curl \
     ca-certificates \
  && fc-cache -fv \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY index.js ./

EXPOSE 3001

CMD ["node", "index.js"]

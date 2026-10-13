FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends python3-venv ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
COPY server/requirements-downloader.txt /tmp/requirements-downloader.txt
RUN python3 -m venv /opt/downloader && /opt/downloader/bin/pip install --no-cache-dir -r /tmp/requirements-downloader.txt
ENV YT_DLP_PATH=/opt/downloader/bin/yt-dlp
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node server ./server
USER node
EXPOSE 3000
CMD ["node", "server/server.mjs"]

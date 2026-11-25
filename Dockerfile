FROM node:22-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY server server
COPY web web
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production WEB_DIR=/app/web
COPY --from=build /src/node_modules node_modules
COPY --from=build /src/server/dist server/dist
COPY --from=build /src/server/package.json server/package.json
COPY --from=build /src/web/dist web
EXPOSE 22222
CMD ["node", "server/dist/index.js"]

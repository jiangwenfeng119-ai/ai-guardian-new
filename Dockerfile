# Build frontend, then run API + static (see server/api.cjs SERVE_DIST).
# If Docker Hub is slow or times out, build with e.g.:
#   docker compose build --build-arg NODE_IMAGE=docker.m.daocloud.io/library/node:22-alpine
# Optional npm mirror (China): --build-arg NPM_REGISTRY=https://registry.npmmirror.com
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ARG NPM_REGISTRY=
RUN if [ -n "${NPM_REGISTRY}" ]; then npm config set registry "${NPM_REGISTRY}"; fi
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ARG NPM_REGISTRY=
RUN if [ -n "${NPM_REGISTRY}" ]; then npm config set registry "${NPM_REGISTRY}"; fi
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY server ./server
ENV SERVE_DIST=1
ENV API_HOST=0.0.0.0
ENV API_PORT=8787
# 宿主机上的 IMA（本应用容器内拉取时）：可写完整 URL；localhost 会自动改为 host.docker.internal
# ENV LEGAL_IMA_SEARCH_URL=http://host.docker.internal:3001/agent/search
EXPOSE 8787
CMD ["node", "server/api.cjs"]

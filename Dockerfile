# PRECEPTOR — single container serving the API and the built PWA.
# AI provider keys are provided at runtime (never baked into the image;
# .env is excluded by .dockerignore):
#   docker run -p 8787:8787 --env-file .env -v preceptor-data:/app/data preceptor
ARG NODE_IMAGE=node:22-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build

FROM ${NODE_IMAGE}
ENV NODE_ENV=production PORT=8787 DATABASE_PATH=/app/data/preceptor.sqlite
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/index.js"]

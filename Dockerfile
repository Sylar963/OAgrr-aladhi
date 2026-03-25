# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile
COPY packages ./packages
RUN pnpm build

FROM base AS production-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3100
RUN apt-get update \
    && apt-get install -y --no-install-recommends dumb-init \
    && rm -rf /var/lib/apt/lists/*
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=production-deps /app/package.json ./package.json
COPY --from=production-deps /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=production-deps /app/packages ./packages
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/protocol/dist ./packages/protocol/dist
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/web/dist ./packages/web/dist
EXPOSE 3100
HEALTHCHECK --interval=10s --timeout=5s --start-period=45s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3100') + '/api/ready').then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1))"
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "packages/server/dist/index.js"]

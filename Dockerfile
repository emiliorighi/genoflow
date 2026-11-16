# syntax=docker/dockerfile:1
# Static Next.js export served by nginx under /genoflow.

FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate

COPY assemblage/package.json assemblage/pnpm-lock.yaml assemblage/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY assemblage/ ./
# Baked into the JS bundle at build time (see next.config.mjs / lib/publicUrl.ts).
ARG NEXT_PUBLIC_BASE_PATH=/genoflow
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH
RUN test -f public/data/species_flows.parquet && test -f public/wasm/parquet_wasm_bg.wasm
RUN pnpm build

FROM nginx:alpine
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/out /usr/share/nginx/html/genoflow
EXPOSE 80

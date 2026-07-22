# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:22-bookworm-slim
ARG RUST_IMAGE=rust:1-bookworm
ARG RUNTIME_IMAGE=debian:bookworm-slim
FROM ${NODE_IMAGE} AS frontend-builder
WORKDIR /build/frontend

COPY source/frontend/package.json source/frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY source/frontend/ ./
RUN npm run build

FROM ${RUST_IMAGE} AS backend-builder
WORKDIR /build/backend

COPY source/backend/Cargo.toml source/backend/Cargo.lock ./
COPY source/backend/.cargo ./.cargo
COPY source/backend/.sqlx ./.sqlx
COPY source/backend/migrations ./migrations
COPY source/backend/src ./src
ENV SQLX_OFFLINE=true
RUN cargo build --locked --release --bin inventario-lab-backend

FROM scratch AS bundle-export
COPY --from=backend-builder /build/backend/target/release/inventario-lab-backend /inventario-lab-backend
COPY --from=frontend-builder /build/frontend/dist /static

FROM ${RUNTIME_IMAGE} AS runtime
ARG VCS_REF=unknown
ARG SOURCE_DATE_EPOCH=0

LABEL org.opencontainers.image.title="Inventario de Laboratorio" \
      org.opencontainers.image.revision="$VCS_REF" \
      org.opencontainers.image.created="$SOURCE_DATE_EPOCH"

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system appuser \
    && useradd --system --gid appuser --home-dir /app --shell /usr/sbin/nologin appuser

WORKDIR /app
COPY --from=backend-builder --chown=appuser:appuser /build/backend/target/release/inventario-lab-backend ./inventario-lab-backend
COPY --from=frontend-builder --chown=appuser:appuser /build/frontend/dist ./static

RUN mkdir -p /app/uploads && chown appuser:appuser /app/uploads
USER appuser

ENV PORT=8080
EXPOSE 8080
VOLUME ["/app/uploads"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl --fail --silent --show-error http://127.0.0.1:8080/health >/dev/null || exit 1

CMD ["./inventario-lab-backend"]

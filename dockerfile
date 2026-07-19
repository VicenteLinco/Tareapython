FROM node:22-bookworm-slim AS frontend-builder
WORKDIR /build/frontend

COPY codigofuente/frontend/package.json codigofuente/frontend/package-lock.json ./
RUN npm ci
COPY codigofuente/frontend/ ./
RUN npm run build

FROM rust:1-bookworm AS backend-builder
WORKDIR /build/backend

COPY backend/Cargo.toml backend/Cargo.lock ./
COPY backend/src ./src
COPY backend/migrations ./migrations
COPY backend/.sqlx ./.sqlx
ENV SQLX_OFFLINE=true
RUN cargo build --locked --release

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system appuser \
    && useradd --system --gid appuser --home-dir /app --shell /usr/sbin/nologin appuser

WORKDIR /app
COPY --from=backend-builder /build/backend/target/release/inventario-lab-backend ./inventario-lab-backend
COPY backend/migrations ./migrations
COPY --from=frontend-builder /build/frontend/dist ./static

RUN mkdir -p /app/uploads && chown -R appuser:appuser /app
USER appuser

ENV PORT=8080
EXPOSE 8080

CMD ["./inventario-lab-backend"]

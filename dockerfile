# --- Etapa 1: Construcción del Frontend ---
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- Etapa 2: Construcción del Backend (Rust) ---
FROM rust:1.94 AS backend-builder
WORKDIR /app

# Cachear dependencias de Rust para acelerar compilaciones
COPY backend/Cargo.toml backend/Cargo.lock* ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release 2>/dev/null || true

# Compilar la aplicación real
COPY backend/src ./src
COPY backend/migrations ./migrations
COPY backend/.sqlx ./.sqlx
ENV SQLX_OFFLINE=true
RUN touch src/main.rs && cargo build --release

# --- Etapa 3: Imagen de Ejecución (Runtime) ---
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

# Crear usuario no root por seguridad
RUN groupadd -r appuser && useradd -r -g appuser -d /app -s /sbin/nologin appuser
WORKDIR /app

# Copiar el ejecutable de Rust y las migraciones de DB
COPY --from=backend-builder /app/target/release/inventario-lab-backend .
COPY --from=backend-builder /app/migrations ./migrations

# Copiar los recursos estáticos compilados de React a la carpeta /static
COPY --from=frontend-builder /app/dist ./static

# Crear carpeta de subida de imágenes y asignar permisos
RUN mkdir -p /app/uploads && chown -R appuser:appuser /app

USER appuser

ENV PORT=8080
EXPOSE 8080
CMD ["./inventario-lab-backend"]

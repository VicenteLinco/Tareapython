FROM debian:bookworm-slim

# Instalar ca-certificates para permitir conexiones SSL/TLS seguras (como a neon.tech)
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

# Crear un usuario no root por seguridad
RUN groupadd -r appuser && useradd -r -g appuser -d /app -s /sbin/nologin appuser
WORKDIR /app

# Copiar el binario precompilado de Linux
COPY inventario-lab-backend .
RUN chmod +x inventario-lab-backend

# Copiar las migraciones (requeridas para actualizar la base de datos de Neon al iniciar)
COPY migrations ./migrations

# Copiar los recursos estáticos del frontend (HTML, JS, CSS)
COPY static ./static

# Asignar permisos al usuario no root
RUN mkdir -p /app/uploads && chown -R appuser:appuser /app
USER appuser

ENV PORT=8080
EXPOSE 8080

CMD ["./inventario-lab-backend"]

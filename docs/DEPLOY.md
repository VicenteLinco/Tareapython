# Deploy y backup

Guia operativa para desplegar el sistema con Docker Compose y mantener respaldos recuperables.

## Arquitectura de produccion

- PostgreSQL 16 corre como servicio `db` y persiste datos en el volumen Docker `pgdata`.
- Backend Rust/Axum corre como servicio `backend` en el puerto `8080`.
- Las imagenes subidas por usuarios se guardan en `/app/uploads` dentro del backend y persisten en el volumen Docker `uploads`.
- El backend expone esas imagenes en `/api/v1/uploads`.
- El backend ejecuta migraciones SQLx al iniciar, desde `backend/migrations/`.
- El frontend se compila con Vite. En produccion puede servirse de dos formas:
  - Recomendado: Nginx o Caddy sirviendo `frontend/dist/` y proxy a `/api` hacia `backend:8080`.
  - Alternativa simple: copiar `frontend/dist/` como `static/` junto al binario/backend para que Axum lo sirva con fallback a `index.html`.

## Variables requeridas

Copiar `.env.example` a `.env` y completar valores reales:

```env
POSTGRES_DB=inventario_lab
POSTGRES_USER=lab_user
POSTGRES_PASSWORD=CHANGE_ME_password_seguro_aqui
JWT_SECRET=CHANGE_ME_minimo_32_caracteres_clave_secreta_aqui
RUST_LOG=info
```

Usar un `JWT_SECRET` aleatorio de al menos 32 caracteres. Ejemplo:

```powershell
openssl rand -hex 32
```

## Primer despliegue

Desde la raiz del repositorio:

```powershell
docker compose up -d --build
docker compose ps
```

Verificar salud:

```powershell
curl http://localhost:8080/health
```

Si se sirve el frontend con Nginx/Caddy, compilar:

```powershell
cd frontend
npm ci
npm run build
```

Publicar el contenido de `frontend/dist/` en el servidor web. El proxy debe enviar las rutas de API a `http://127.0.0.1:8080`.

## Actualizacion de version

1. Revisar `docs/CHECKLIST_RELEASE.md`.
2. Crear backup antes de aplicar cambios.
3. Actualizar codigo en el servidor.
4. Reconstruir backend:

```powershell
docker compose up -d --build backend
```

Las migraciones se aplican automaticamente al iniciar el backend. Evitar migraciones destructivas en caliente. Para cambios de esquema con riesgo, usar estrategia en dos pasos:

1. Agregar columnas/tablas nuevas sin borrar las anteriores.
2. Desplegar codigo compatible con ambos esquemas.
3. Migrar/backfill datos.
4. En una release posterior, eliminar columnas obsoletas si ya no se usan.

## Backup de base de datos

Crear carpeta local de backups:

```powershell
New-Item -ItemType Directory -Force backups
```

Generar backup comprimido con formato custom de PostgreSQL:

```powershell
docker compose exec -T db pg_dump -U $env:POSTGRES_USER -d $env:POSTGRES_DB -Fc > backups\inventario_$(Get-Date -Format yyyyMMdd_HHmmss).dump
```

Si PowerShell no tiene las variables cargadas, usar los valores del `.env`:

```powershell
docker compose exec -T db pg_dump -U lab_user -d inventario_lab -Fc > backups\inventario_20260523_120000.dump
```

Validar que el archivo no quedo vacio:

```powershell
Get-ChildItem backups\*.dump | Sort-Object LastWriteTime -Descending | Select-Object -First 5
```

## Restore de base de datos

Restaurar sobre una base vacia o recien recreada. Este proceso reemplaza datos del ambiente destino.

1. Detener backend para que no escriba durante el restore:

```powershell
docker compose stop backend
```

2. Recrear base destino:

```powershell
docker compose exec -T db dropdb -U lab_user --if-exists inventario_lab
docker compose exec -T db createdb -U lab_user inventario_lab
```

3. Restaurar:

```powershell
docker compose exec -T db pg_restore -U lab_user -d inventario_lab --clean --if-exists < backups\inventario_20260523_120000.dump
```

4. Levantar backend para aplicar migraciones faltantes:

```powershell
docker compose up -d backend
```

## Backup de uploads

Las imagenes viven en el volumen Docker `uploads`. Respaldar el volumen junto con la base de datos:

```powershell
docker run --rm -v 14marzoinventario_uploads:/data -v ${PWD}\backups:/backup alpine tar czf /backup/uploads_$(Get-Date -Format yyyyMMdd_HHmmss).tar.gz -C /data .
```

Para restaurar uploads en un volumen vacio:

```powershell
docker run --rm -v 14marzoinventario_uploads:/data -v ${PWD}\backups:/backup alpine sh -c "cd /data && tar xzf /backup/uploads_20260523_120000.tar.gz"
```

Confirmar el nombre real del volumen con:

```powershell
docker volume ls
```

## Logs y diagnostico

Ver logs del backend:

```powershell
docker compose logs -f backend
```

Ver logs de PostgreSQL:

```powershell
docker compose logs -f db
```

Subir nivel de detalle temporalmente en `.env`:

```env
RUST_LOG=debug
```

Luego reiniciar:

```powershell
docker compose up -d backend
```

## Checklist minimo antes de entregar

- `docker compose ps` muestra `db` saludable y `backend` corriendo.
- `GET /health` responde OK.
- Login funciona.
- `frontend/dist/` corresponde al commit desplegado.
- Existe backup reciente de DB y uploads.
- Se probo al menos una pantalla critica: stock, recepciones, solicitudes y productos.

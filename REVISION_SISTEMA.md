# Revisión Exhaustiva del Sistema - Diagnóstico y Plan de Acción

## 1. Diagnóstico del Problema

Tras una revisión del código del backend y los logs de ejecución, se ha identificado la causa raíz por la cual el sistema "no conecta":

### A. El Backend se está cerrando por un Error Crítico (Panic)
El backend inicia, pero falla inmediatamente durante la ejecución de las migraciones de base de datos. El error específico se encuentra en la migración `013_indices_performance.sql`:

*   **Error:** `column "producto_id" does not exist` en la tabla `movimientos`.
*   **Causa:** El archivo de migración intenta crear un índice de performance sobre `movimientos(producto_id)`, pero la tabla `movimientos` no posee esa columna (utiliza `lote_id` para referenciar al producto de forma indirecta a través de la tabla de lotes).
*   **Consecuencia:** El contenedor de Docker del backend entra en un ciclo de reinicio o se detiene completamente, lo que provoca que el frontend (Vite) no pueda establecer conexión.

### B. Configuración de Red y Proxy
La configuración del proxy en `vite.config.ts` y la `baseURL` en `api.ts` son correctas. Sin embargo, al estar el backend caído, cualquier intento de conexión resulta en un error de "Conexión rechazada" o "502 Bad Gateway".

---

## 2. Plan de Acción Detallado

### Paso 1: Corregir la Migración 013
Se debe modificar el archivo `backend/migrations/013_indices_performance.sql` para eliminar la creación del índice erróneo. El índice sobre `lote_id` ya existe en la definición inicial de la tabla, por lo que este índice adicional es innecesario y erróneo.

**Acción:** Eliminar las líneas 17 y 18 del archivo mencionado.

### Paso 2: Reiniciar los Servicios
Una vez corregido el archivo, es necesario forzar la reconstrucción y el reinicio de los contenedores para que las migraciones se ejecuten correctamente desde el punto donde fallaron.

**Comandos recomendados:**
```powershell
docker compose down
docker compose up --build -d
```

### Paso 3: Verificación de Salud (Health Check)
Verificar que el backend esté respondiendo correctamente en el endpoint de salud:
*   URL: `http://localhost:8080/health`
*   Respuesta esperada: `{"status": "ok", "database": "connected", ...}`

### Paso 4: Limpieza de Base de Datos (Opcional)
Si las migraciones quedaron en un estado inconsistente en la tabla interna de SQLx (`_sqlx_migrations`), podría ser necesario borrar los volúmenes de Docker para iniciar desde cero (solo si es un entorno de desarrollo sin datos críticos):
```powershell
docker compose down -v
docker compose up --build -d
```

---

## 3. Verificaciones Adicionales Realizadas

*   **CORS:** La configuración permite `http://localhost:5173`, lo cual es correcto para desarrollo local.
*   **Puertos:** El mapeo 8080:8080 en Docker coincide con la configuración de Vite.
*   **JWT:** El secreto configurado en `docker-compose.yml` cumple con el requisito de longitud mínima (>32 caracteres).
*   **Rutas:** Las rutas de `auth` están correctamente anidadas bajo `/api/v1/auth`.

---

## Conclusión
El sistema es estructuralmente sólido. El problema de conexión es un síntoma del colapso del proceso del backend debido a un error de sintaxis SQL en las migraciones finales. Aplicando la corrección en el archivo `013_indices_performance.sql`, el sistema debería volver a estar operativo.

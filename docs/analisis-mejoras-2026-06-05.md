# Análisis de Mejoras y Calidad de Código — 05 de Junio de 2026

Este documento contiene un análisis técnico exhaustivo del estado actual del **Sistema de Inventario para Laboratorio Clínico** (Backend en Rust y Frontend en React). Se evalúan posibles mejoras, funciones faltantes/redundantes, código muerto, archivos innecesarios y problemas de diseño en la base de datos (concurrencia y relaciones).

---

## 1. Diseño y Relaciones de Base de Datos

### 🔴 Condición de Carrera en el Trigger de Stock (`032_stock_trigger.sql`)
* **Problema:** La función del trigger `fn_procesar_movimiento_stock` utiliza `SELECT cantidad INTO v_stock_actual FROM stock WHERE lote_id = NEW.lote_id AND area_id = NEW.area_id FOR UPDATE;` para bloquear la fila de stock y evitar condiciones de carrera. Sin embargo, **si el lote no se ha registrado aún en esa área, la fila no existe** y la consulta devuelve `NOT FOUND` sin bloquear nada.
  Si dos transacciones concurrentes intentan registrar un movimiento de ingreso para un lote/área nuevo al mismo tiempo:
  1. Ambas leerán `NOT FOUND` y asumirán `v_stock_actual = 0`.
  2. Ambas calcularán `cantidad_resultante = cantidad_movimiento`.
  3. Ambas ejecutarán `INSERT INTO stock ... ON CONFLICT DO UPDATE`.
  4. Una de las escrituras se sobrescribirá por completo (pérdida de datos en la tabla `stock`), aunque ambas se guarden en la tabla `movimientos`.
* **Solución propuesta:** 
  - Realizar un bloqueo exclusivo a nivel de aplicación (advisory locks de PostgreSQL o bloqueando la fila correspondiente en `lotes` mediante `SELECT FOR UPDATE` sobre la tabla `lotes`, la cual siempre existirá previamente).
  - Modificar el bloque `ON CONFLICT` para que acumule el stock (`DO UPDATE SET cantidad = stock.cantidad + EXCLUDED.cantidad`) en lugar de sobrescribirlo con el valor precalculado, asegurando integridad en el acumulado.

### 🟡 Restricción UNIQUE de Lotes y Proveedores Nullables (`057_lotes_unique_proveedor.sql`)
* **Problema:** La migración 057 cambió la restricción única a `UNIQUE (producto_id, proveedor_id, numero_lote)`. Debido a que `proveedor_id` es opcional (puede ser `NULL` en compras/cargas directas), PostgreSQL permite insertar múltiples filas con el mismo `producto_id` y `numero_lote` si `proveedor_id` es `NULL` (ya que los valores `NULL` no se consideran iguales en las restricciones `UNIQUE` tradicionales).
* **Solución propuesta:** Usar `UNIQUE NULLS NOT DISTINCT` (disponible a partir de PostgreSQL 15) al definir la restricción única en el lote para garantizar que no haya duplicados incluso si `proveedor_id` es nulo:
  ```sql
  ALTER TABLE lotes ADD CONSTRAINT lotes_producto_proveedor_lote_key 
  UNIQUE NULLS NOT DISTINCT (producto_id, proveedor_id, numero_lote);
  ```

### 🟡 Consistencia en Soft Delete de Usuarios
* **Problema:** En la migración 056 se agregó `deleted_at` a la mayoría de las tablas del catálogo (`categorias`, `unidades_basicas`, `areas`, `productos`, `presentaciones`, `proveedores`). Sin embargo, la tabla `usuarios` quedó fuera y solo cuenta con la columna `activo` (booleano).
* **Solución propuesta:** Agregar `deleted_at` a la tabla `usuarios` para homogeneizar la lógica de auditoría e historial del sistema.

### 🟢 Mismatch de Comentarios en Migración
* **Problema:** En el archivo de migración `052_ordenes_compra.sql`, el comentario inicial dice `-- Migración 028: Órdenes de Compra`. Esto causa confusión al revisar el orden histórico de las migraciones.

---

## 2. Funciones que Faltan o Sobran (Redundancias)

### 🔴 Campos Redundantes / Duplicados en `productos`
* **Problema:** La migración `058_producto_proveedor.sql` creó la tabla de relación de muchos a muchos `producto_proveedor` para soportar múltiples proveedores por producto. Sin embargo:
  - Las columnas antiguas `proveedor_id`, `codigo_proveedor`, `precio_unidad` y `lead_time_propio` **aún existen** en la tabla `productos` y se mapean en la estructura Rust `Producto`.
  - Las consultas del backend (como la búsqueda de productos en `backend/src/handlers/productos.rs`) siguen leyendo de estas columnas obsoletas en lugar de usar la relación en la tabla `producto_proveedor`.
* **Solución propuesta:** Completar la migración de datos eliminando estas columnas de la tabla `productos`, actualizar el struct `Producto` de Rust y reescribir los queries del backend para obtener el proveedor principal mediante un JOIN con la tabla asociativa.

### 🟡 Ausencia de API/Controlador para la Relación Producto-Proveedor
* **Problema:** No existe un endpoint o servicio CRUD (ej. `producto_proveedor.rs`) para que los usuarios asocien, editen o eliminen la relación de un producto con sus proveedores secundarios o actualicen sus precios específicos.

### 🟡 Módulo Setup Incompleto (Pendiente)
* **Problema:** Como se indica en `CLAUDE.md`, el módulo `setup` (importar CSV, finalizar carga inicial) se encuentra incompleto / pendiente en su implementación definitiva.

### 🟡 Falta Página de Modo Kiosk en Frontend
* **Problema:** `CLAUDE.md` menciona una página llamada `kiosk/` (modo pantalla completa con lector HID), pero no existe ningún directorio de página para el kiosco en `frontend/src/pages/` ni está registrada en `frontend/src/App.tsx`.

---

## 3. Código Muerto (Dead Code)

### 🟡 Struct `ProductoProveedor` sin Uso Práctico en el Backend
* **Problema:** La estructura `ProductoProveedor` definida en `backend/src/models/producto_proveedor.rs` está marcada con `#[allow(dead_code)]` y solo se usa en `export_types.rs` para exportar tipos a TypeScript. No se utiliza en ningún handler ni lógica de negocio del backend.

### 🟡 Dependencia Huérfana de `puppeteer-core`
* **Problema:** La dependencia `"puppeteer-core": "^25.1.0"` está declarada en el `package.json` raíz y en `frontend/package.json` en `devDependencies`, pero no hay ninguna importación ni uso de Puppeteer en el código de la aplicación.
* **Solución propuesta:** Eliminar la dependencia de ambos archivos si no se van a implementar pruebas automatizadas basadas en headless browsers.

### 🟡 Archivo `package.json` e Instalación de Node en la Raíz
* **Problema:** Existe un `package.json` y `package-lock.json` en la raíz del proyecto cuyo único propósito es instalar la dependencia huérfana `puppeteer-core`. Esto genera una carpeta `node_modules` en la raíz que duplica esfuerzos, ya que la aplicación frontend ya tiene su propio `package.json` en su subcarpeta `/frontend`.
* **Solución propuesta:** Eliminar `package.json`, `package-lock.json` y `node_modules` de la raíz del proyecto.

### 🟡 Variantes con `allow(dead_code)` en Enums de Dominio
* **Problema:** Varios enums en `backend/src/domain/estados.rs` tienen la anotación `#[allow(dead_code)]` debido a que hay estados del flujo de negocio (ej. variantes de `EstadoSolicitud` o `EstadoRecepcion`) que se declaran pero nunca son evaluados o instanciados en el backend, sirviendo solo para el tipado de la UI.

---

## 4. Archivos Innecesarios / Fuera de Lugar

### 🔴 Carpetas de Release en el Directorio de Trabajo (Git)
* **Problema:** Existen las carpetas `Release 02_06_2026`, `release 27 mayo` y `release` directamente en la raíz del proyecto de desarrollo.
  - `Release 02_06_2026` contiene ejecutables compilados de 24 MB (`inventario-lab-backend.exe`), archivos de log (`server_log.txt`) y assets estáticos duplicados.
  - Estos archivos no deben formar parte del repositorio de código fuente y pueden causar problemas de rendimiento al clonar o indexar el proyecto si no están debidamente ignorados.
* **Solución propuesta:** Mover las carpetas de compilación fuera del espacio de trabajo de desarrollo y agregarlas al archivo `.gitignore` si se deciden mantener en la raíz.

### 🟡 Configuración Incompleta en `.gitignore`
* **Problema:** El archivo `.gitignore` ignora archivos individuales `*.exe`, pero **no ignora** las carpetas de release como `Release 02_06_2026/` o `release 27 mayo/`, lo que significa que logs, configuraciones `.env` y otros archivos de configuración dentro de estas carpetas podrían subirse accidentalmente a Git.
* **Solución propuesta:** Agregar las siguientes reglas a `.gitignore`:
  ```gitignore
  # Carpetas de distribución y releases
  /Release*/
  /release*/
  ```

### 🟡 Nombres Inconsistentes en Dockerfiles
* **Problema:** El proyecto cuenta con tres Dockerfiles en la raíz:
  1. `dockerfile` (en minúsculas, compila tanto Frontend como Backend de forma multi-etapa).
  2. `Dockerfile.backend` (compila únicamente el backend).
  3. `Dockerfile.render` (preparado para despliegues en la plataforma Render).
  Esta mezcla de minúsculas y mayúsculas (`dockerfile` vs `Dockerfile.*`) rompe la consistencia.
* **Solución propuesta:** Renombrar el `dockerfile` multi-etapa a `Dockerfile.prod` o `Dockerfile` (con D mayúscula) para alinearse con los estándares y mejorar la visibilidad.

---

## 5. Recomendaciones Generales de Calidad de Código
1. **Pruebas Unitarias e Integración (0% de Cobertura):** No existen tests unitarios en el backend de Rust. Se recomienda priorizar la creación de pruebas de integración para los flujos críticos de FEFO (`stock_ops.rs`) y validación de idempotencia.
2. **Homologación de Nomenclatura en la UI:** Asegurar que las referencias en `CLAUDE.md` a componentes de frontend reflejen el cambio de `modo-qr` a `scan` (el cual es el nombre del directorio real en la página).

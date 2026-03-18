# Modelo de Datos - Inventario de Laboratorio Clínico V1.0

## Principios de Diseño

1. **Ledger Pattern (Patrón Libro Contable):** Cada cambio de stock genera un movimiento inmutable. El historial NUNCA se borra.
2. **Snapshot Híbrido:** La tabla `stock` guarda el stock actual para consultas rápidas. La tabla `movimientos` es la fuente de verdad auditable. Ambas se mantienen sincronizadas en una transacción atómica.
3. **FEFO Automático:** El consumo se aplica al lote con fecha de vencimiento más próxima que tenga stock disponible en esa área.
4. **Unidad Base Universal:** Todo stock se almacena en unidad base. Las presentaciones son solo un multiplicador de conveniencia.
5. **Ubicación como dimensión del stock:** El stock existe en la intersección de (lote + área). Un mismo lote puede estar repartido en varias áreas.
6. **Producto-Área:** Cada área tiene un catálogo de productos habituales para filtrar la UI y agilizar el consumo.
7. **Desnormalización intencional:** Los factores de conversión se copian al detalle de recepción al momento del ingreso, para que cambios futuros no alteren el historial.
8. **Agrupación de movimientos:** Cuando un consumo se reparte en varios lotes (split FEFO), todos los movimientos comparten un `grupo_movimiento` para reconstruir la acción original.
9. **Idempotency:** Toda operación de escritura desde el frontend envía un `idempotency_key`. El backend la almacena y si recibe un duplicado, retorna la respuesta original sin re-ejecutar. Crítico para móvil con señal inestable.
10. **Optimistic Locking:** Las tablas editables tienen campo `version`. Al editar, si la versión no coincide, se rechaza con 409 Conflict. Previene sobrescritura entre usuarios concurrentes.
11. **Audit Trail:** Todo cambio en tablas de catálogo (productos, presentaciones, proveedores, etc.) se registra en `audit_log` con estado anterior y posterior en JSONB.

---

## Diagrama de Relaciones (Resumen Visual)

```
usuarios ──┬── usuario_area ──── areas
            │                      │
            ├── movimientos ───┬── stock (lote + área)
            │                  │
            ├── recepciones    ├── lotes ──── productos ──┬── categorias
            │    │             │                │         ├── presentaciones
            │    └── recepcion │                │         ├── unidades_medida
            │        _detalle ─┘                │         └── producto_area ── areas
            │                                   │
            ├── audit_log                  proveedores
            └── idempotency_keys
```

---

## Tablas

### 1. `unidades_medida`
Catálogo global de unidades. No cambia frecuentemente.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | SERIAL PK | |
| nombre | VARCHAR(50) NOT NULL UNIQUE | "mililitro", "gramo", "unidad", "prueba" |
| abreviatura | VARCHAR(10) NOT NULL UNIQUE | "ml", "g", "u", "test" |

Datos iniciales: ml, g, u (unidad), test (prueba).

---

### 2. `categorias`
Agrupación lógica de productos para navegación y filtrado.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | SERIAL PK | |
| nombre | VARCHAR(100) NOT NULL UNIQUE | "Reactivos Hematología", "Insumos Generales", etc. |
| descripcion | TEXT | Opcional |
| created_at | TIMESTAMPTZ | DEFAULT now() |

---

### 3. `areas`
Las 12 ubicaciones físicas del laboratorio.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | SERIAL PK | |
| nombre | VARCHAR(100) NOT NULL UNIQUE | "Microbiología", "PCR", etc. |
| es_bodega | BOOLEAN DEFAULT false | Distingue bodegas de áreas operativas |
| activa | BOOLEAN DEFAULT true | Soft delete |
| created_at | TIMESTAMPTZ | DEFAULT now() |

---

### 4. `usuarios`
Usuarios del sistema con rol fijo.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | UUID PK | DEFAULT gen_random_uuid() |
| nombre | VARCHAR(150) NOT NULL | Nombre completo |
| email | VARCHAR(255) NOT NULL UNIQUE | Login |
| password_hash | VARCHAR(255) NOT NULL | Argon2 hash |
| rol | VARCHAR(20) NOT NULL | CHECK: 'admin', 'tecnologo', 'consulta' |
| activo | BOOLEAN DEFAULT true | Soft delete |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

---

### 5. `usuario_area`
Relación muchos-a-muchos: qué áreas puede operar cada usuario.
Permite que turnantes tengan acceso a múltiples áreas.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| usuario_id | UUID FK → usuarios | |
| area_id | INT FK → areas | |
| PK | (usuario_id, area_id) | |

---

### 6. `proveedores`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | SERIAL PK | |
| nombre | VARCHAR(200) NOT NULL | |
| contacto | VARCHAR(200) | Persona de contacto |
| telefono | VARCHAR(50) | |
| email | VARCHAR(255) | |
| activo | BOOLEAN DEFAULT true | |
| version | INT NOT NULL DEFAULT 1 | Optimistic locking |
| created_at | TIMESTAMPTZ | DEFAULT now() |

---

### 7. `productos`
Catálogo maestro. La "ficha técnica" del insumo. NO contiene stock.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | UUID PK | DEFAULT gen_random_uuid() |
| codigo_interno | VARCHAR(20) NOT NULL UNIQUE | Auto-generado, ej: "PRD-00001" |
| nombre | VARCHAR(300) NOT NULL | Nombre descriptivo |
| descripcion | TEXT | Opcional |
| categoria_id | INT FK → categorias | |
| unidad_base_id | INT FK → unidades_medida | La unidad mínima de consumo |
| stock_minimo | DECIMAL(12,2) DEFAULT 0 | Para alertas futuras (Fase 4) |
| activo | BOOLEAN DEFAULT true | |
| version | INT NOT NULL DEFAULT 1 | Optimistic locking. Se incrementa en cada UPDATE. |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

Índice: `idx_productos_categoria` en `categoria_id`.
Índice: `idx_productos_codigo` en `codigo_interno`.

---

### 8. `presentaciones`
Empaques en los que viene un producto. Solo define el factor de conversión.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | SERIAL PK | |
| producto_id | UUID FK → productos | |
| nombre | VARCHAR(100) NOT NULL | "Caja x10", "Frasco 500ml", "Kit 100 pruebas" |
| factor_conversion | DECIMAL(12,2) NOT NULL | Cuántas unidades base contiene. Ej: Caja x10 → 10 |
| codigo_barras | VARCHAR(100) | Código del fabricante (opcional, puede cambiar) |
| activa | BOOLEAN DEFAULT true | |
| version | INT NOT NULL DEFAULT 1 | Optimistic locking |
| created_at | TIMESTAMPTZ | DEFAULT now() |

Constraint: `factor_conversion > 0`.
Índice: `idx_presentaciones_producto` en `producto_id`.
Índice: `idx_presentaciones_codigo_barras` en `codigo_barras` (para escaneo).

**Nota:** `codigo_barras` NO es UNIQUE intencionalmente. Fabricantes distintos pueden reutilizar códigos. La UI debe manejar colisiones: si un escaneo retorna múltiples productos, mostrar lista para que el usuario elija.

---

### 9. `producto_area` ⭐ Nueva
Vincula qué productos se usan habitualmente en cada área.
Permite que la UI filtre el catálogo: el tecnólogo de Orinas solo ve los ~40 productos de su área, no los 1500.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| producto_id | UUID FK → productos | |
| area_id | INT FK → areas | |
| PK | (producto_id, area_id) | |

Se puebla automáticamente al recibir insumos o transferir stock a un área. También se puede configurar manualmente por el admin.

---

### 10. `lotes`
Instancia física recibida de un producto. Tiene vencimiento y proveedor.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | UUID PK | DEFAULT gen_random_uuid() |
| producto_id | UUID FK → productos | |
| proveedor_id | INT FK → proveedores | Nullable (si no se registra proveedor) |
| numero_lote | VARCHAR(100) NOT NULL | Número de lote del fabricante |
| fecha_vencimiento | DATE NOT NULL | Clave para FEFO |
| codigo_interno | VARCHAR(30) NOT NULL UNIQUE | Auto-generado para etiquetas. Ej: "LOT-20250314-00001" |
| costo_unitario | DECIMAL(12,4) | Costo por unidad base al momento de compra. Nullable (no obligatorio en MVP). Permite reportes financieros: valor del inventario, costo de desperdicio. |
| created_at | TIMESTAMPTZ | DEFAULT now() |

Constraint: `UNIQUE(producto_id, numero_lote)` — no duplicar el mismo lote del mismo producto.
Índice: `idx_lotes_producto` en `producto_id`.
Índice: `idx_lotes_vencimiento` en `fecha_vencimiento`.
Índice: `idx_lotes_codigo_interno` en `codigo_interno` (para escaneo de etiquetas).

**Nota:** No hay flag `agotado`. El filtro de lotes activos se hace vía `JOIN stock WHERE cantidad > 0`. El índice parcial para FEFO va en la tabla `stock`, no aquí.

---

### 11. `stock` ⭐ Tabla Clave
Stock actual por lote por área. Es el "snapshot" para consultas rápidas.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | SERIAL PK | |
| lote_id | UUID FK → lotes | |
| area_id | INT FK → areas | |
| cantidad | DECIMAL(12,2) NOT NULL DEFAULT 0 | Stock actual en unidades base |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

Constraint: `UNIQUE(lote_id, area_id)` — solo un registro por lote por área.
Constraint: `cantidad >= 0` — nunca stock negativo.
Índice: `idx_stock_area` en `area_id` (para vista de stock por área).
Índice: `idx_stock_lote` en `lote_id`.
Índice: `idx_stock_activo` en `(lote_id, area_id) WHERE cantidad > 0` (índice parcial para FEFO rápido y filtrar lotes agotados).

**Vista útil para "stock total por producto por área":**
```sql
CREATE VIEW v_stock_por_producto_area AS
SELECT
    p.id AS producto_id,
    p.codigo_interno,
    p.nombre AS producto_nombre,
    a.id AS area_id,
    a.nombre AS area_nombre,
    SUM(s.cantidad) AS stock_total,
    um.abreviatura AS unidad,
    MIN(l.fecha_vencimiento) FILTER (WHERE s.cantidad > 0) AS proximo_vencimiento
FROM stock s
JOIN lotes l ON l.id = s.lote_id
JOIN productos p ON p.id = l.producto_id
JOIN areas a ON a.id = s.area_id
JOIN unidades_medida um ON um.id = p.unidad_base_id
WHERE s.cantidad > 0
GROUP BY p.id, p.codigo_interno, p.nombre, a.id, a.nombre, um.abreviatura;
```

---

### 12. `movimientos` ⭐ Tabla Clave (Ledger)
Registro inmutable de cada cambio de stock. NUNCA se borra ni edita.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | UUID PK | DEFAULT gen_random_uuid() |
| numero_documento | VARCHAR(20) NOT NULL UNIQUE | Secuencial legible. Ej: "MOV-000001". Auto-generado por secuencia de Postgres. |
| grupo_movimiento | UUID | Agrupa movimientos de una misma acción (split FEFO, transferencia, descarte masivo). Nullable si es movimiento simple. |
| lote_id | UUID FK → lotes | |
| area_id | INT FK → areas | |
| tipo | VARCHAR(30) NOT NULL | Ver tipos abajo |
| cantidad | DECIMAL(12,2) NOT NULL | Siempre positiva. El tipo define la dirección. |
| cantidad_resultante | DECIMAL(12,2) NOT NULL | Snapshot: calculado en SQL dentro de la transacción, NO en el backend. |
| usuario_id | UUID FK → usuarios | Quién realizó la acción |
| origen | VARCHAR(30) | Contexto de origen: 'recepcion', 'conteo', 'manual', 'carga_inicial', null |
| nota | TEXT | Comentario opcional |
| created_at | TIMESTAMPTZ | DEFAULT now() |

**Tipos de movimiento:**
- `INGRESO` — Recepción de proveedor
- `CARGA_INICIAL` — Carga única al iniciar el sistema (modo setup)
- `CONSUMO` — Uso de reactivo por tecnólogo
- `AJUSTE_POSITIVO` — Diferencia a favor en conteo
- `AJUSTE_NEGATIVO` — Diferencia en contra en conteo
- `TRANSFERENCIA_ENTRADA` — Recibe stock de otra área
- `TRANSFERENCIA_SALIDA` — Envía stock a otra área
- `DESCARTE_VENCIDO` — Reactivo vencido retirado del stock
- `DESCARTE_DAÑADO` — Reactivo dañado/contaminado retirado del stock

Constraint: `cantidad > 0`.
**Índices compuestos (optimizados para queries reales):**
Índice: `idx_mov_area_tipo_fecha` en `(area_id, tipo, created_at DESC)` — query más frecuente: movimientos por área y tipo en rango de fechas.
Índice: `idx_mov_lote_fecha` en `(lote_id, created_at DESC)` — historial de un lote.
Índice: `idx_movimientos_usuario` en `usuario_id` — quién hizo qué.
Índice: `idx_movimientos_grupo` en `grupo_movimiento` — reconstruir acciones compuestas.
Índice: `idx_movimientos_numero_doc` en `numero_documento` — búsqueda por documento.

**Generación de numero_documento (Postgres):**
```sql
-- Secuencias separadas por tipo. Sin año en el prefijo (el año está en created_at).
CREATE SEQUENCE seq_mov_numero START 1;
CREATE SEQUENCE seq_rec_numero START 1;

-- Funciones helper
CREATE OR REPLACE FUNCTION generar_numero_mov() RETURNS TEXT AS $$
  SELECT 'MOV-' || LPAD(NEXTVAL('seq_mov_numero')::TEXT, 6, '0')
$$ LANGUAGE SQL;

CREATE OR REPLACE FUNCTION generar_numero_rec() RETURNS TEXT AS $$
  SELECT 'REC-' || LPAD(NEXTVAL('seq_rec_numero')::TEXT, 6, '0')
$$ LANGUAGE SQL;
```
Formato: `MOV-000001`, `REC-000001`. Secuencial puro, sin ambigüedad.

**Regla crítica 1:** Cada INSERT en `movimientos` DEBE ir acompañado de un UPDATE en `stock` dentro de la misma transacción SQL. Nunca uno sin el otro.

**Regla crítica 2:** `cantidad_resultante` se calcula directamente en SQL, nunca en el backend.

Para CONSUMO / DESCARTE / TRANSFERENCIA_SALIDA (stock ya existe):
```sql
INSERT INTO movimientos (id, grupo_movimiento, lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id)
SELECT gen_random_uuid(), $grupo, $lote_id, $area_id, 'CONSUMO', $cantidad, s.cantidad - $cantidad, $usuario_id
FROM stock s
WHERE s.lote_id = $lote_id AND s.area_id = $area_id;
```

Para INGRESO / CARGA_INICIAL / TRANSFERENCIA_ENTRADA (stock puede no existir):
```sql
INSERT INTO movimientos (id, grupo_movimiento, lote_id, area_id, tipo, cantidad, cantidad_resultante, usuario_id)
SELECT gen_random_uuid(), $grupo, $lote_id, $area_id, 'INGRESO', $cantidad,
       COALESCE(s.cantidad, 0) + $cantidad, $usuario_id
FROM (SELECT 1) AS dummy
LEFT JOIN stock s ON s.lote_id = $lote_id AND s.area_id = $area_id;
```
El `LEFT JOIN` + `COALESCE` garantiza que funcione tanto para lotes nuevos (sin fila en stock) como para lotes que ya tienen stock en esa área.

---

### 13. `idempotency_keys`
Previene operaciones duplicadas desde móvil con señal inestable.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| key | VARCHAR(50) PK | UUID generado por el frontend, enviado en header `X-Idempotency-Key` |
| endpoint | VARCHAR(100) NOT NULL | Ruta del endpoint (ej: "POST /consumos") |
| response_status | SMALLINT NOT NULL | Código HTTP de la respuesta original |
| response_body | JSONB NOT NULL | Cuerpo de la respuesta original |
| usuario_id | UUID FK → usuarios | |
| created_at | TIMESTAMPTZ | DEFAULT now() |

**Flujo (race-condition safe):**
1. Frontend genera UUID, lo envía en header `X-Idempotency-Key`
2. Backend intenta `INSERT INTO idempotency_keys (key, ...) ON CONFLICT (key) DO NOTHING`
3. Si el INSERT insertó (afectó 1 fila) → este thread ganó, ejecuta la operación, actualiza la fila con la respuesta
4. Si el INSERT no insertó (afectó 0 filas) → otro thread ganó, leer la fila existente y retornar su `response_body`
5. TTL: Las keys se limpian con un job periódico después de 24h

**Nota:** El paso 2-3 usa la PK como mutex natural de Postgres. No hay ventana de race condition.

**Aplica a:** `POST /consumos`, `POST /consumos/batch`, `POST /recepciones`, `POST /transferencias`, `POST /descartes`.
**No aplica a:** GETs, PUTs de catálogo, login.

---

### 14. `audit_log`
Registra todo cambio en tablas de catálogo. Inmutable.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | BIGSERIAL PK | |
| tabla | VARCHAR(50) NOT NULL | 'productos', 'presentaciones', 'proveedores', 'categorias', 'areas', 'usuarios' |
| registro_id | VARCHAR(50) NOT NULL | ID del registro modificado (UUID o INT como texto) |
| accion | VARCHAR(10) NOT NULL | 'CREATE', 'UPDATE', 'DELETE' |
| datos_anteriores | JSONB | Estado antes del cambio. NULL en CREATE. |
| datos_nuevos | JSONB | Estado después del cambio. NULL en DELETE. |
| usuario_id | UUID FK → usuarios | Quién hizo el cambio |
| created_at | TIMESTAMPTZ | DEFAULT now() |

Índice: `idx_audit_tabla_registro` en `(tabla, registro_id)`.
Índice: `idx_audit_fecha` en `created_at`.

**No existe PUT ni DELETE en esta tabla.** El audit log es inmutable.

---

### 15. `recepciones`
Cabecera de una recepción de proveedor.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | UUID PK | DEFAULT gen_random_uuid() |
| numero_documento | VARCHAR(20) NOT NULL UNIQUE | Secuencial legible. Ej: "REC-000001". Auto-generado. |
| proveedor_id | INT FK → proveedores | |
| numero_guia | VARCHAR(100) | Número de guía de despacho |
| estado | VARCHAR(20) NOT NULL | CHECK: 'borrador', 'completa', 'parcial', 'rechazada'. Borradores no generan movimientos ni stock. |
| fecha_recepcion | TIMESTAMPTZ NOT NULL | Fecha/hora real de llegada |
| guia_despacho_archivo | VARCHAR(500) | Ruta al archivo escaneado (futuro) |
| usuario_id | UUID FK → usuarios | Quién recibió |
| nota | TEXT | |
| created_at | TIMESTAMPTZ | DEFAULT now() |

---

### 16. `recepcion_detalle`
Líneas de detalle de cada recepción. Cada línea crea un lote + stock + movimiento.

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | SERIAL PK | |
| recepcion_id | UUID FK → recepciones | |
| producto_id | UUID FK → productos | |
| lote_id | UUID FK → lotes | Lote creado/referenciado |
| presentacion_id | INT FK → presentaciones | En qué presentación llegó |
| area_destino_id | INT FK → areas | A dónde se lleva |
| cantidad_presentaciones | DECIMAL(12,2) NOT NULL | Cuántas presentaciones llegaron (ej: 5 cajas) |
| factor_conversion_usado | DECIMAL(12,2) NOT NULL | Copia del factor al momento del ingreso (desnormalización intencional para integridad histórica) |
| cantidad_unidades_base | DECIMAL(12,2) NOT NULL | Calculado: presentaciones × factor_conversion_usado |
| created_at | TIMESTAMPTZ | DEFAULT now() |

---

## Flujos Transaccionales

### Consumo (MVP - Operación más frecuente)
```
1. Tecnólogo selecciona producto + área + cantidad (en unidades base o presentación)
   - La UI filtra productos por producto_area para mostrar solo los relevantes
2. Sistema convierte a unidades base si se ingresó en presentación
3. Sistema busca lotes FEFO: SELECT lotes con stock > 0 en esa área, ordenados por fecha_vencimiento ASC
4. Se genera un grupo_movimiento (UUID) para esta acción
5. En UNA transacción SQL, por cada lote necesario (split FEFO):
   a. UPDATE stock SET cantidad = cantidad - X WHERE lote_id = ? AND area_id = ?
   b. INSERT movimientos con cantidad_resultante calculada en SQL (no en backend)
6. Si la cantidad total pedida excede el stock total disponible → rechazar operación
```

### Recepción
```
1. Usuario crea recepción (cabecera con datos de guía)
2. Por cada línea de detalle:
   a. Se crea o referencia el lote (producto + número_lote + vencimiento)
   b. Se calcula cantidad_unidades_base = cantidad_presentaciones × factor_conversion
   c. En UNA transacción:
      - UPSERT stock (lote + área destino) sumando la cantidad
      - INSERT movimientos (tipo='INGRESO')
```

### Transferencia entre áreas
```
1. Se genera un grupo_movimiento (UUID) para esta acción
2. En UNA transacción:
   a. UPDATE stock en área origen (restar)
   b. INSERT movimiento TRANSFERENCIA_SALIDA en área origen (con grupo_movimiento)
   c. UPSERT stock en área destino (sumar)
   d. INSERT movimiento TRANSFERENCIA_ENTRADA en área destino (mismo grupo_movimiento)
   e. UPSERT producto_area para el producto en el área destino (auto-populación)
   f. (No se necesita verificar nada extra — el índice parcial WHERE cantidad > 0 excluye automáticamente lotes sin stock)
```

### Descarte (reactivo vencido o dañado)
```
1. Admin o tecnólogo selecciona lote + área + cantidad a descartar + motivo (vencido/dañado)
2. En UNA transacción:
   a. UPDATE stock SET cantidad = cantidad - X
   b. INSERT movimiento (tipo='DESCARTE_VENCIDO' o 'DESCARTE_DAÑADO')
3. Para descarte masivo (ej: todos los vencidos del mes), se usa grupo_movimiento para agrupar
```

### Carga Inicial (modo setup, una sola vez)
```
1. Admin importa CSV o carga manualmente: producto, lote, vencimiento, área, cantidad
2. Por cada línea:
   a. Se crea producto (si no existe) + lote + stock
   b. INSERT movimiento (tipo='CARGA_INICIAL', origen='carga_inicial')
3. Este tipo de movimiento solo se permite cuando el sistema está en modo setup
4. Una vez cerrada la carga inicial, no se puede volver a usar este tipo
```

---

## Queries Clave para el MVP

### Stock total por producto en un área
```sql
SELECT p.nombre, SUM(s.cantidad) as stock_total, um.abreviatura
FROM stock s
JOIN lotes l ON l.id = s.lote_id
JOIN productos p ON p.id = l.producto_id
JOIN unidades_medida um ON um.id = p.unidad_base_id
WHERE s.area_id = $1 AND s.cantidad > 0
GROUP BY p.id, p.nombre, um.abreviatura
ORDER BY p.nombre;
```

### Stock global (todas las áreas) de un producto
```sql
SELECT a.nombre as area, SUM(s.cantidad) as stock, um.abreviatura,
       MIN(l.fecha_vencimiento) FILTER (WHERE s.cantidad > 0) as proximo_vencimiento
FROM stock s
JOIN lotes l ON l.id = s.lote_id
JOIN productos p ON p.id = l.producto_id
JOIN areas a ON a.id = s.area_id
JOIN unidades_medida um ON um.id = p.unidad_base_id
WHERE p.id = $1 AND s.cantidad > 0
GROUP BY a.id, a.nombre, um.abreviatura;
```

### Historial de consumo de un producto (trazabilidad)
```sql
SELECT m.created_at, u.nombre as usuario, a.nombre as area,
       m.cantidad, m.cantidad_resultante, l.numero_lote, m.nota
FROM movimientos m
JOIN usuarios u ON u.id = m.usuario_id
JOIN areas a ON a.id = m.area_id
JOIN lotes l ON l.id = m.lote_id
WHERE l.producto_id = $1 AND m.tipo = 'CONSUMO'
ORDER BY m.created_at DESC;
```

### Productos próximos a vencer (para dashboard)
```sql
SELECT p.nombre, l.numero_lote, l.fecha_vencimiento, a.nombre as area, s.cantidad
FROM stock s
JOIN lotes l ON l.id = s.lote_id
JOIN productos p ON p.id = l.producto_id
JOIN areas a ON a.id = s.area_id
WHERE s.cantidad > 0
  AND l.fecha_vencimiento <= CURRENT_DATE + INTERVAL '90 days'
ORDER BY l.fecha_vencimiento ASC;
```

### Lotes FEFO para consumo automático (soporta split)
```sql
SELECT s.id, s.lote_id, s.cantidad, l.fecha_vencimiento
FROM stock s
JOIN lotes l ON l.id = s.lote_id
WHERE l.producto_id = $1
  AND s.area_id = $2
  AND s.cantidad > 0
ORDER BY l.fecha_vencimiento ASC
FOR UPDATE;  -- Lock para concurrencia (23 usuarios simultáneos)
-- El backend itera los lotes y reparte la cantidad pedida hasta completarla
```

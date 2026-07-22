# Spec de mejoras — Stock, Dashboard y modelo de reposición

**Fecha:** 2026-06-19
**Estado:** propuesta posterior al rebuild del motor de reglas (migración 009)
**Alcance:** lo detectado durante la reconstrucción del motor de estados de stock. Se distingue entre **hallazgos verificados en código** y **puntos que requieren auditoría dedicada**.

---

## 0. Qué ya se hizo (contexto)

La migración 009 + el refactor asociado resolvieron el problema central:

- Se reemplazaron **4 motores de reglas divergentes** por una única función SQL `fn_estado_stock` (fuente de verdad).
- Se eliminó el `stock_minimo` manual (UI + columnas `productos.stock_minimo` y `producto_area.stock_minimo`).
- Modelo nuevo: **días de cobertura** (`consumo_diario × lead_time` para el punto de reorden, `× (lead_time + dias_objetivo)` para el objetivo).
- Vocabulario de estados unificado: `vencido, agotado, no_gestionado, critico, reponer, riesgo_venc, por_vencer, sin_datos, normal`.

Este spec cubre **lo que quedó pendiente o mal ubicado** alrededor de eso.

---

## 1. Hallazgos verificados (con evidencia)

### 1.1 — `load_forecast_config` duplicada — **ALTA**
**Problema:** la misma función existe dos veces, una en `handlers/stock.rs` y otra en `handlers/solicitudes_compra.rs`, con la misma query y construcción de `ForecastConfig`. Durante este trabajo hubo que actualizar **las dos** al agregar 3 claves de config; es exactamente el tipo de duplicación que genera divergencia futura.
**Acción:** mover una única `load_forecast_config` a `services/forecast.rs` (o un `services/config.rs`) y que ambos handlers la consuman.
**Eliminar:** la copia de `solicitudes_compra.rs`.

### 1.2 — `par_level_config` solapa con el nuevo modelo — **ALTA (decisión de producto)**
**Problema:** existe un sistema paralelo `par_level_config` (tabla + `handlers/par_levels.rs` + endpoint `/par-levels/recalculate`) cuyo método `auto_consumo` calcula `stock_minimo = consumo_promedio × lead_time`. Eso es **el mismo concepto** que ahora vive en `fn_estado_stock`, pero desconectado: el stock y el dashboard ya no lo usan; solo lo lee el forecast de compras como `COALESCE(plc.stock_minimo, 0)`.
**Decisión requerida:** o (a) se elimina `par_level_config` y el forecast deriva todo del modelo de días de cobertura, o (b) se mantiene SOLO como override manual explícito por producto/área y se documenta como tal. Hoy está en una tierra de nadie.
**Candidato a eliminar:** tabla `par_level_config`, `handlers/par_levels.rs`, `dto/par_level.rs`, endpoint `recalculate` — si se opta por (a).

### 1.3 — `producto_area.stock_maximo` y `punto_reorden` huérfanos — **MEDIA**
**Problema:** tras dropear `producto_area.stock_minimo`, quedan `stock_maximo` y `punto_reorden` en la tabla y editables en `areas-tab.tsx`, pero **ningún cálculo del sistema los consume**. Son inputs muertos: el usuario los carga y no hacen nada.
**Acción:** o se cablean al modelo (ej. `punto_reorden` como override del reorder calculado), o se eliminan de la tabla y de la UI de configuración de área.

### 1.4 — Documentación stale que miente — **MEDIA**
**Problema verificado:**
- `CLAUDE.md` afirma "49 migraciones", trigger de stock en `032`, soft delete en `025`, conteo en `026`. **Realidad: solo existen 8 migraciones** (la próxima es 009). Esas referencias no existen.
- `docs/reglas-prediccion.md` documenta el modelo viejo de reglas (mínimos manuales), ya obsoleto tras la 009.
**Acción:** corregir `CLAUDE.md` (sección "Estado actual" y "Arquitectura"), y reescribir o archivar `docs/reglas-prediccion.md` apuntando a `fn_estado_stock`.

### 1.5 — `generated.ts` desincronizado de Rust — **ALTA (mina activa)**
**Problema:** `frontend/src/types/generated.ts` está stale respecto de los structs Rust. El frontend se escribió contra esa versión vieja. Al correr `cargo run --bin export_types` (regeneración limpia, como manda el CLAUDE.md), aparecen errores de build NO relacionados con el cambio en curso:
- `@/types` ya no exporta `ProductoProveedor` (eliminado en el flatten 007).
- `Usuario` requiere `deleted_at`; `Presentacion` requiere `sku`.
- `Producto` ya no tiene `lead_time_propio` / `codigo_proveedor` / `codigo_maestro` (los usa `useSolicitudState.ts`).
- `CreateSolicitudItem` requiere `unidad_basica_id`.
**Por qué es grave:** `npm run build` (que corre `tsc -b`) SÍ typechequea y falla; `npx tsc --noEmit` sobre el tsconfig raíz NO (usa `references`). O sea, la validación "rápida" miente. El próximo que regenere tipos rompe el deploy.
**Acción:** regenerar `generated.ts` y arreglar de una vez el drift en `useRecepcionItems.ts`, `useSolicitudState.ts`, `api/catalogos.ts`, `login/index.tsx`. Validar SIEMPRE con `npm run build`, no con `npx tsc --noEmit`.

### 1.6 — Dead code ya removido (registro)
Eliminados en este rebuild: vista `v_alertas_stock` (no la usaba nadie) y la query de alertas obsoleta dentro de `bin/inspect_db.rs`. Se deja constancia para no reintroducirlos.

---

## 2. Puntos a auditar (no verificados a fondo en este pase)

> No los afirmo como bugs: requieren una revisión dedicada antes de tocar.

### 2.1 — Trigger de stock declarado en CLAUDE.md — **AUDITAR**
CLAUDE.md dice que un trigger (migración "032") mantiene la tabla `stock`. Esa migración no existe. Hay `005_double_entry_stock.sql` + vista `v_stock_balance_check`. **Verificar** cómo se materializa `stock` realmente y corregir la doc según el mecanismo real.

### 2.2 — Maquinaria de `serie`/EWMA solo para el "pico" — **AUDITAR / MEDIA**
La query de `/stock` arrastra CTEs pesadas (`generate_series`, `consumo_dia`, `series`, EWMA en Rust) únicamente para `dias_autonomia_pico`, una métrica del panel de detalle. El estado y `dias_autonomia` ya salen del consumo ponderado simple. **Evaluar** mover el cálculo del pico a un endpoint on-demand del detalle, y aligerar la query del listado.

### 2.3 — `estado_stock` del catálogo vs `fn_estado_stock` — **BAJA**
El listado de productos (`handlers/productos.rs`) usa su propio `estado_stock` (`activo/inactivo/pendiente_inicializar/sin_stock`), distinto del estado de inventario. Es defendible (vista de catálogo ≠ vista de stock), pero conviene **renombrar** para que no se confunda con el estado de stock real.

---

## 3. Reubicaciones propuestas (dónde debería vivir cada cosa)

| Elemento | Hoy | Debería estar en |
|---|---|---|
| `load_forecast_config` | duplicada en 2 handlers | una sola en `services/forecast.rs` |
| Cálculo de consumo diario (ponderado) | repetido en 3 queries SQL casi iguales | una vista/función SQL reutilizable (`v_consumo_producto`) que todas consuman |
| Cálculo del "pico" (EWMA) | dentro del listado de stock | endpoint de detalle on-demand |
| Ventanas de vencimiento / días objetivo | claves sueltas en `configuracion` | sección "Política de inventario" en `/configuracion` (UI), ya soportada por backend |

> Nota: igual que `fn_estado_stock` unificó las reglas, una `v_consumo_producto` unificaría el **insumo** de esas reglas. Hoy el consumo ponderado está copiado en `/stock listar`, `/stock alertas` y el resumen — coincide, pero por copia, no por diseño.

---

## 4. Funciones / elementos candidatos a eliminar

| Candidato | Motivo | Condición |
|---|---|---|
| Copia de `load_forecast_config` en `solicitudes_compra.rs` | duplicación | inmediato (bajo riesgo) |
| `par_level_config` + `par_levels.rs` + `/recalculate` | solapa con días de cobertura | solo si se decide opción (a) de 1.2 |
| `producto_area.stock_maximo` / `punto_reorden` (+ UI) | inputs muertos | si no se cablean al modelo |
| `docs/reglas-prediccion.md` | documenta modelo viejo | reescribir o archivar |

---

## 5. Orden sugerido de ejecución

1. **Doc fix** (1.4) — barato, evita que el próximo dev se guíe por info falsa.
2. **Dedupe `load_forecast_config`** (1.1) — bajo riesgo, alto valor.
3. **Decisión `par_level_config`** (1.2) — necesita definición de producto antes de tocar; condiciona 4.
4. **Resolver `producto_area` huérfano** (1.3) — depende de 1.2.
5. **Auditorías** (2.1, 2.2) — antes de optimizar la query de stock.

---

## 6. Riesgos

- Tocar `par_level_config` impacta el **forecast de compras** (solicitudes-compra). No es un cambio aislado: igual que `stock_minimo`, cruza módulos. Requiere su propio plan.
- La migración 009 **aún no se ejecutó contra una base real** (se aplica en el próximo deploy vía `sqlx migrate run`). Validar en staging que el `DROP COLUMN` y `fn_estado_stock` aplican sin error antes de producción.

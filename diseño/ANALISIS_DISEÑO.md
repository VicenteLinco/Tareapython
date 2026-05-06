# Análisis de diseño — Inventario Laboratorio Clínico

**Fecha:** 2026-04-28
**Versión analizada:** rama `main`, 47 migraciones, ~9k líneas Rust + ~19k líneas TS/TSX

---

## 1. Resumen ejecutivo

El sistema funciona y resuelve el problema central (ledger inmutable + FEFO + multi-área), pero tiene **deuda de diseño acumulada** visible en tres síntomas medibles:

1. **47 migraciones para 16-17 tablas** — varias migraciones renombran, eliminan o reescriben decisiones previas (003 renombra `numero_guia`, 005 renombra unidades, 006 elimina `abreviatura`, 017 unifica config, 030 cambia estados de solicitud, 039 corrige typo `activo→activa`, 040 simplifica estados, 042 elimina `solicitud_items` que se había agregado en 019). Indica que el modelo se exploró sobre la marcha en producción en vez de diseñarse antes.
2. **Páginas monolíticas en frontend**: `recepciones/nueva.tsx` 963 líneas y 17 `useState/useEffect`, `stock/index.tsx` 764 líneas / 15 hooks, `solicitudes-compra/index.tsx` 661 / 16. Lógica de negocio, UI, fetching y formateo viven en el mismo archivo.
3. **0% de tests** declarados en CLAUDE.md, frente a un dominio (stock, FEFO, forecasting) donde un bug es invisible para el usuario hasta que el inventario está descuadrado.

Ninguno de los tres es un defecto fatal — son señales de que el sistema creció más rápido que sus contratos internos.

---

## 2. Puntos débiles del diseño actual

### 2.1 Modelo de datos — decisiones acertadas pero erosionadas

**Lo que está bien:**
- Ledger inmutable de movimientos + snapshot `stock` mantenido por trigger (032) es la decisión correcta para un dominio contable.
- Stock por `(lote_id, area_id)` (no por presentación abierta) y unidad base universal con `factor_conversion` es matemáticamente sólido.
- FEFO sin flag `agotado` (filtro `WHERE cantidad > 0`) evita la clase de bugs "marcamos agotado pero quedaba stock".
- `version` para optimistic locking, `audit_log`, `soft delete`, idempotency keys: las piezas adecuadas existen.

**Lo que está mal:**

- **Tipos numéricos `Decimal` viajan como `string` al frontend** (`cantidad_sugerida: string`, `factor_conversion: string`, `stock_actual: string`, `consumo_diario: string`...). Es seguro en serialización, pero **empuja toda la aritmética y comparación al cliente sin tipos**. El frontend hace `parseFloat`/`Number()` ad hoc en cada componente, o peor, compara strings. Esto es origen probable de bugs sutiles de redondeo y de inconsistencia visual.
- **Duplicación de campos derivados en DTOs**: `unidad_base_nombre`, `unidad_base_nombre_plural`, `presentacion_nombre`, `presentacion_nombre_plural`, `factor_conversion`... aparecen embebidos en cada respuesta (`SolicitudDetalleItem`, `DetalleRecepcionRow`, `ItemRecomendado`, etc.). Cada vez que cambia el catálogo, hay que decidir endpoint por endpoint si rehidratar. Falta una capa de "vista materializada" o un patrón consistente (siempre denormalizar vs. siempre normalizar + lookup en cliente).
- **"Borrador" duplicado por entidad**: recepciones tienen estado borrador, solicitudes tienen estado borrador (migration 030, luego 045 unique-borrador-por-usuario). No hay un patrón unificado de "draft" — cada feature lo reinventó.
- **Estados como `string` libres**: `estado: string` en `RecepcionListItem`, `SolicitudResumen`, `SolicitudDetalle`. El comentario JSDoc en `CreateRecepcion` documenta `"completa" | "parcial" | "rechazada"` pero no es un enum. Cualquier typo en el backend pasa silenciosamente a la UI.
- **47 migraciones, varias correctivas**: la fricción de cambiar el modelo es alta porque no hubo un seed/reset path para entornos pre-producción. Deuda barata si se paga ahora; cara si llega al primer despliegue cliente.

### 2.2 Backend — handlers obesos, servicios anémicos

- **Handlers grandes hacen lógica de negocio**: `solicitudes_compra.rs` 781 líneas, `stock.rs` 749, `setup.rs` 543, `productos.rs` 508. Tienen funciones helper (`load_forecast_config`, `calcular_autonomia`, `decimal_to_f64`) que pertenecen a un servicio. Mezclar HTTP + SQL + cálculo en el handler hace el código intestable y duplicado (cada handler que necesita forecast carga el config a su manera).
- **`services/` no tiene un contrato claro**: hay `forecast.rs` (541 lns), `stock_ops.rs` (178), `recepcion_service.rs` (396)... pero también `categoria_service.rs` (159), `proveedor_service.rs` (184), `usuario_service.rs` (281) que parecen más bien repositorios (CRUD + validaciones). No queda claro qué es servicio (lógica de dominio) y qué es repositorio (acceso a datos). Para un equipo nuevo es difícil saber dónde poner código.
- **Sin tests**: dominio crítico (FEFO, forecasting con T,S, conteo ciego, idempotency) sin red de seguridad. Refactorizar es ruleta rusa. El esfuerzo de añadir tests *después* de tener 47 migraciones y 50 handlers es 3-5× el de haberlos escrito junto al código.
- **Errores genéricos**: `AppError` único — los clientes HTTP no pueden distinguir "lote no encontrado" de "stock insuficiente" de "concurrencia perdida" sin parsear strings.
- **Forecasting embebido**: `forecast.rs` tiene 541 líneas, parámetros vienen de tabla `configuracion` (migration 046, 047 ajusta factor_historial_corto). Si mañana se quiere reemplazar el modelo (de T,S a Croston, por ejemplo) o A/B testear, no hay punto de extensión: está atornillado al servicio.

### 2.3 Frontend — la deuda más visible al usuario

- **Páginas-dios**: `recepciones/nueva.tsx` (963 lns) maneja escaneo, búsqueda de productos, edición de items, fotos, lotes, áreas y guardado en un solo componente. Esto se traduce en:
  - Bugs de re-render (cualquier `setState` repinta toda la pantalla).
  - Imposibilidad de testear en aislamiento.
  - Cambios de UX requieren leer 900 líneas para no romper nada.
- **`useState` desordenado vs. estado de servidor**: 15-17 `useState/useEffect` por página significa que estado de UI, estado de servidor (que ya está en React Query) y estado derivado se confunden. La regla "React Query es la verdad del servidor; useState solo para UI local" no se aplica consistentemente.
- **`types/index.ts` (289 líneas) coexiste con `types/generated.ts`**: tipos manuales y generados se solapan. Riesgo: divergencia silenciosa cuando alguien edita el manual sin regenerar el otro.
- **Falta una capa de modelo/transformación**: el cliente recibe `string` decimales y los maneja crudos. No hay un módulo `models/Stock.ts` con `parseStock(api): Stock` que centralice conversión `string → number/Decimal.js`, formateo, comparaciones. Cada pantalla lo hace de nuevo.
- **`api.ts` único monolítico**: un solo Axios client con todas las llamadas. Funciona, pero acopla todas las pantallas a la misma capa, sin agrupación por dominio (`api/recepciones.ts`, `api/stock.ts`).
- **Filtro global de área en header como estado Zustand**: correcto en intención, pero el contrato "qué páginas reaccionan al filtro" está implícito. Una página nueva fácil olvida suscribirse o, peor, lo aplica donde no corresponde.
- **Sin design system formal**: shadcn/ui da primitivos, pero no hay un layer de componentes de dominio (`<StockBadge>`, `<UrgenciaTag>`, `<CantidadConUnidad>`, `<EstadoSolicitud>`). Cada página los reimplementa con clases Tailwind, lo que produce inconsistencia visual entre módulos.

### 2.4 Operación y despliegue

- **`./iniciar.ps1` mezcla Docker + npm dev**: para desarrollo está bien; pero el setup de producción (cómo se sirve el frontend, dónde van los assets de imágenes/fotos de recepción, cómo se hace backup de PostgreSQL) no está documentado en el repo.
- **Almacenamiento de imágenes en filesystem (`storage.rs`, migrations 008/010/018/033)**: si el VPS pierde el volumen, se pierden todas las fotos. No hay abstracción S3/MinIO.
- **Sin observabilidad**: no se ve logging estructurado, métricas, ni health check más allá del básico. Un bug de stock en producción se descubre cuando un usuario reclama.

---

## 3. ¿Qué fue incorrecto desde el comienzo?

Distinguiendo "decisión equivocada" (debería haberse hecho distinto) de "decisión correcta mal ejecutada":

### Decisiones equivocadas

1. **Empezar por implementación antes de estabilizar el modelo de datos.** 47 migraciones en 16 tablas es un síntoma. El modelo debió iterarse en papel/SQL hasta que un consumo, una recepción y un descarte se pudieran modelar sin renombrar columnas. El costo de iterar en producción ya está pagado, pero quedan cicatrices (estados duplicados, campos `_v2`, soft-deletes a posteriori).
2. **Decimal-como-string sin tipo wrapper en el frontend.** Es la decisión que más bugs ocultos genera. Debió haberse adoptado `decimal.js` o equivalente desde el día uno, o tipar como `number` con la fricción asumida.
3. **No definir capa de dominio en frontend.** Empezar con páginas que llaman API directo es rápido al inicio y caro a escala. Con 1500 insumos y 12 áreas el sistema *parece* simple, pero las reglas de stock/FEFO/forecasting son lógica que merece su propio módulo aislado.
4. **Estados como strings libres**. Un `enum` Rust + tipo unión TS generado debió ser obligatorio desde el primer día.
5. **No escribir un solo test del módulo `stock_ops` y `forecast`.** Es el corazón del sistema. Sin tests, cualquier refactor futuro es un acto de fe.

### Decisiones correctas mal ejecutadas

- **Ledger inmutable**: bien elegido; mal expuesto (handlers grandes que pueden corromperlo si alguien edita por descuido). Faltan invariantes a nivel DB (constraints) que hagan imposible saltarse el patrón.
- **FEFO en `stock_ops.rs`**: lógica correcta, pero acoplada a SQLx; sin abstracción que permita simulación o "what-if".
- **Roles fijos `admin/tecnologo/consulta`**: razonable; pero hardcodeado en código (no en DB) hace difícil agregar un cuarto rol cuando la realidad lo pida.
- **Idempotency keys**: implementados; pero solo donde alguien se acordó. No hay middleware que los exija en POST mutativos.

---

## 4. Si se hiciera una v2 — qué habría que hacer distinto

### 4.1 Antes de escribir código

1. **Modelado a fondo, antes**: ER en papel + lista exhaustiva de transiciones de estado (recepción borrador→completa→rechazada, solicitud borrador→aprobada→cerrada→reconciliada, etc.). Validar con un técnico real recorriendo 5-10 escenarios end-to-end *antes* de la primera migración.
2. **Diccionario de estados**: tabla en doc con cada `estado` posible por entidad, transiciones permitidas, y quién las dispara. Esto previene los `string` libres.
3. **Glosario de unidades y cantidades**: una sola página con "toda cantidad en backend = unidad base, tipo Decimal(12,3); en frontend se transforma a `Quantity` con `value: Decimal, unit: Unit`". Adherencia obligatoria.

### 4.2 Backend

1. **Capa de dominio explícita** separada de SQL:
   ```
   domain/      (puro, sin sqlx) — tipos, reglas, invariantes
   repositories/ (sqlx)            — solo CRUD y queries
   services/     (composición)     — orquestan domain + repos
   handlers/    (axum, finos)      — solo HTTP, parseo, autenticación
   ```
2. **Tipos newtype**: `LoteId`, `AreaId`, `CantidadBase(Decimal)`, `FactorConversion(Decimal)`. Imposible pasar un `i32` cualquiera donde se espera un `AreaId`.
3. **Enums serializados**: `EstadoRecepcion`, `EstadoSolicitud`, `Rol`, `TipoMovimiento` como enums Rust, exportados a TS como uniones discriminadas.
4. **Tests desde el día uno** del dominio (`stock_ops`, `forecast`, `idempotency`). Al menos 1 test por invariante de negocio.
5. **Errores tipados**: `enum DomainError { LoteAgotado, ConcurrenciaPerdida, ... }` mapeados a HTTP en el handler.
6. **Migraciones reversibles** o, alternativamente, un comando `make reset-db` que re-aplica seeds limpios para devs. Reduce el costo de cambiar el modelo.
7. **Eventos**: cada movimiento publica un evento (en una tabla `eventos` o en un bus interno). Permite alertas, sincronización de caches, integración futura con BI sin reescribir handlers.
8. **Forecasting como plugin**: trait `ForecastEngine` con implementación `TSEngine`. Permite swap o A/B.

### 4.3 Frontend

1. **Capa `domain/` también en TS**: tipos parseados (`Stock`, `Solicitud`, `Recepcion`) con `Decimal.js`, no `string`. Funciones puras de regla (`puedeConfirmar(rec)`, `urgenciaDe(item)`).
2. **Hooks por dominio**, no por página: `useStock(areaId)`, `useSolicitudBorrador()`, `useRecomendaciones(horizonte)` viven en `hooks/dominio/` y se reutilizan.
3. **API client por dominio**: `api/stock.ts`, `api/solicitudes.ts`, cada uno con sus tipos y mutations.
4. **Componentes de dominio**: `<CantidadConUnidad>`, `<EstadoBadge entidad="solicitud" valor={...}/>`, `<UrgenciaTag>`, `<AutonomiaIndicator>`. Una sola implementación, una sola apariencia.
5. **Pantallas componibles**: ninguna página >300 líneas. Si crece, se descompone en sub-componentes con su propio estado.
6. **Estado de servidor solo en React Query**, estado de UI solo en `useState` local, estado global solo lo verdaderamente global (auth, área seleccionada, theme). Regla escrita y revisada en PR.
7. **Storybook o demo page** de los componentes de dominio. Se diseña aislado, no inline en una pantalla.

### 4.4 UX y producto

1. **Flujos validados con un técnico real** antes de codificar cada módulo. La curva entre "lo que el dev cree que se necesita" y "cómo el técnico lo usa con guantes y prisa" es enorme.
2. **Modo offline-first** para el escáner móvil/kiosk. Hoy depende de red; un corte deja al laboratorio sin registrar consumo.
3. **Dashboard accionable**, no decorativo: hoy `dashboard/index.tsx` muestra 359 líneas de números. Debería responder "¿qué hago hoy?": items urgentes, recepciones pendientes de confirmar, conteos atrasados.
4. **Diseño visual unificado**: paleta + tipografía + espaciado decididos antes, no por componente.

### 4.5 Operación

1. **Object storage** (MinIO autoalojado) para imágenes desde el día uno.
2. **Backups automatizados** documentados (pg_dump nocturno + retención).
3. **Logging estructurado** (tracing + JSON) y **métricas** (Prometheus básicas: req/s, latencia, errores 5xx, lag de stock recalculado).
4. **CI**: `cargo test` + `cargo clippy` + `tsc --noEmit` + `npm run build` antes de cualquier merge.

---

## 5. Lo que NO cambiaría

Para no caer en el síndrome "reescribamos todo":

- Stack (Rust+Axum+SQLx, React+TS+Tailwind+shadcn): correcto para el tamaño y los requisitos.
- Ledger inmutable + trigger de stock.
- FEFO sin flag `agotado`.
- Unidad base universal + presentaciones como multiplicadores.
- Draft mode en recepciones y solicitudes (concepto, no implementación duplicada).
- Filtro global de área en header.
- Numeración de documentos sin año.

---

## 6. Veredicto

El sistema **resuelve el problema** y es viable de mantener. Los puntos débiles no son arquitectónicos en el núcleo (el modelo de stock/movimientos/lotes es correcto), sino en las **capas externas** (handlers obesos, frontend monolítico, tipos sueltos, sin tests).

Una v2 desde cero con 4-6 semanas de modelado y un equipo disciplinado podría reducir el código a ~60% del actual con más funcionalidad. Pero un **refactor incremental sobre v1** — capa por capa, módulo por módulo, sin reescribir el ledger — es la opción razonable: ver `PLAN_MEJORAS.md`.

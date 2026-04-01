# Análisis Detallado de Arquitectura y Lógica - Sistema de Inventario Laboratorio

Este documento presenta un análisis exhaustivo del código fuente del sistema de inventario (Frontend React + Backend Rust/Axum). Se han identificado áreas de mejora, errores lógicos latentes, vulnerabilidades de diseño arquitectónico y deudas técnicas, con recomendaciones accionables para cada hallazgo.

## 1. Errores Lógicos y Riesgos de Consistencia de Datos

### 1.1 Condición de Carrera en Confirmación de Conteo Físico
**Ubicación:** `backend/src/services/conteo_service.rs` -> `confirmar_sesion`
**Problema:**
El sistema de conteo utiliza un enfoque de "snapshot": cuando se inicia un conteo, captura el stock actual en el sistema (`stock_sistema`). Al momento de la confirmación (`confirmar_sesion`), el código hace una sobreescritura directa (Upsert `DO UPDATE SET cantidad = $3`) usando la `cantidad_contada`.
Si durante el tiempo en que el usuario cuenta físicamente los ítems ocurre un movimiento real en el sistema (ej. un "CONSUMO" registrado por otro usuario), este consumo será silenciosamente borrado cuando se confirme la sesión, porque el sistema forzará el stock final al valor contado, ignorando la diferencia introducida mientras la sesión estaba "en progreso".
**Recomendación:**
- **Opción A (Bloqueo):** Implementar un mecanismo en la base de datos que impida movimientos (`CONSUMO`, `AJUSTE`) en un área o sobre lotes específicos mientras haya una sesión de conteo "en_progreso".
- **Opción B (Cálculo Relativo - Recomendado):** En lugar de sobreescribir el stock final, el ajuste en `confirmar_sesion` debería calcular un *delta* basado en el snapshot: `Delta = cantidad_contada - stock_sistema_en_snapshot`. Luego, este `Delta` se suma/resta al stock *actual* en el momento de la confirmación.

### 1.2 Ocultamiento de Alertas Múltiples (Blindaje Lógico)
**Ubicación:** `backend/src/handlers/stock.rs` -> `alertas`
**Problema:**
La consulta SQL que genera las alertas utiliza un `CROSS JOIN LATERAL` con un `LIMIT 1` ordenado por prioridad implícita en la estructura `UNION ALL`. Esto significa que si un producto está "Vencido" y al mismo tiempo "Sin Stock", la consulta solo arrojará la primera alerta que coincida (en este caso, vencido). El usuario del dashboard no sabrá que el producto también está quebrado (`sin_stock`), lo cual puede llevar a decisiones logísticas incompletas.
**Recomendación:**
Refactorizar la consulta o el post-procesamiento en Rust para retornar un array de alertas (`Vec<String>`) por producto, o permitir que un producto aparezca múltiples veces en el resultado del dashboard si dispara más de un trigger crítico.

### 1.3 Sesgo de Extrapolación en Consumo Diario Ajustado
**Ubicación:** `backend/src/handlers/stock.rs` -> `listar` y `alertas`
**Problema:**
Para productos nuevos (con `dias_vida_sistema < 30`), el sistema extrapola el consumo diario ponderado asumiendo un ciclo de 30 días: `consumo_diario_ponderado * (30.0 / dias_vida_sistema)`.
Si un producto se registra hoy y tiene un consumo de 10 unidades (`dias_vida_sistema = 1`), el sistema extrapolará un consumo de 300 unidades en 30 días, provocando un falso positivo extremo de `agotamiento_proximo`.
**Recomendación:**
Establecer un umbral mínimo de días de vida (ej. `dias_con_consumo >= 3`) antes de intentar hacer proyecciones de agotamiento, o utilizar una curva de suavizado logarítmico para productos nuevos en lugar de una extrapolación lineal directa.

### 1.4 Manejo Inconsistente de Migraciones Activas (Feature Flags dinámicos)
**Ubicación:** `backend/src/handlers/stock.rs`
**Problema:**
En la ruta de alertas hay una verificación en tiempo de ejecución para saber si existe la tabla `solicitudes_compra`: `SELECT to_regclass('public.solicitudes_compra') IS NOT NULL`.
Sin embargo, el resto de la aplicación (como `recepciones.rs`) asume que la migración ha sido aplicada. Si el código necesita hacer comprobaciones dinámicas del esquema, esto indica que el código base y las migraciones no están desplegándose atómicamente.
**Recomendación:**
Eliminar comprobaciones dinámicas del esquema de base de datos en código de producción de negocio. El entorno debe garantizar que la aplicación arranque solo cuando todas las migraciones esperadas por esa versión del código fuente estén aplicadas (usar los mecanismos de `sqlx::migrate!`).

---

## 2. Arquitectura Frontend y UX

### 2.1 Regeneración Insegura del Idempotency Key
**Ubicación:** `frontend/src/lib/api.ts`
**Problema:**
El interceptor de Axios genera un `X-Idempotency-Key` (UUID) nuevo para *toda* solicitud `POST/PUT/PATCH` que no lo traiga de forma explícita.
Si una solicitud falla por timeout de red (pero el servidor sí la procesó y la está ejecutando lentamente o ya la completó), y el cliente (o un interceptor de retry) decide reintentar el *mismo* request object, dependiendo de cómo Axios clone la configuración, el interceptor podría correr de nuevo y generar un *nuevo* UUID. Esto engañaría al backend, haciéndolo creer que es una transacción completamente nueva, anulando el propósito principal de la llave de idempotencia.
**Recomendación:**
Si se inyecta en un interceptor, asegurarse de que se inyecte directamente en el objeto de configuración original y mutarlo ahí para que reintentos subsiguientes de esa misma promesa mantengan la llave. Idealmente, las llaves de idempotencia deberían generarse en la capa de negocio (ej. al presionar el botón "Guardar"), no ocultas en la capa HTTP.

### 2.2 Dependencia Excesiva de Refetching (Polling)
**Ubicación:** `frontend/src/pages/dashboard/index.tsx`
**Problema:**
El dashboard utiliza un intervalo agresivo de "polling": `refetchInterval: 60000` (1 minuto) en varias de sus consultas principales para mantenerse sincronizado. Aunque funciona para laboratorios pequeños, en laboratorios de mayor escala con muchos usuarios concurrentes, esto puede sobrecargar el servidor y la base de datos con consultas SQL complejas (como la CTE gigante de alertas) re-ejecutadas repetidamente sin que la información haya cambiado.
**Recomendación:**
Implementar Server-Sent Events (SSE) o WebSockets para invalidar queries específicas de `react-query` de forma reactiva ('event-driven') en lugar de usar sondeo pasivo.

---

## 3. Mejoras en la Capa de Backend (Rust)

### 3.1 Complejidad de Lógica de Negocio en SQL
**Problema generalizado en Handlers:**
Gran parte de la lógica de negocio core (clasificación de alertas, ponderaciones de consumo, factores de conversión en inventario) está escrita en bloques monolíticos de SQL crudo (Strings con formateo de interpolación en Rust).
Esto presenta tres grandes problemas:
1. **Pobre Testabilidad:** Es imposible hacer un test unitario de la función Rust de clasificación de alertas sin levantar una base de datos PostgreSQL completa.
2. **Mantenibilidad:** El uso del macro `format!` o concatenaciones de Strings para ensamblar consultas SQL grandes es propenso a errores de sintaxis y dificulta la revisión de código.
3. **Escalabilidad del motor DB:** El motor de DB está haciendo el 100% de la carga analítica computacional.
**Recomendación:**
Mover la clasificación final a la capa de aplicación Rust. La base de datos debería devolver los estadísticos crudos (`stock_total`, `consumo_30d`, `fecha_vencimiento`), y la capa de servicios de Rust debería ser la que implemente las reglas (ej. `if stock < minimo { ... }`). Esto hace que el negocio sea testeable unitariamente.

### 3.2 Fuga de Lógica Transaccional
En varios servicios, si bien se inician transacciones (`pool.begin()`), las confirmaciones (`tx.commit()`) dependen de llegar al final del flujo. Si se introduce un `?` temprano en un error de negocio después de haber ejecutado inserts, la transacción hará rollback correctamente, lo cual es excelente. Sin embargo, en algunas rutas se inician transacciones largas y se llama a dependencias externas o lógicas complejas antes del commit, aumentando la ventana de locks de base de datos.
**Recomendación:** Preparar todos los datos necesarios en memoria, adquirir la transacción, ejecutar todos los statements lo más rápido posible, y commitear.

---

## 4. Deuda Técnica y "To-Do" Identificados

1. **Gestión de Sesiones Concurrentes:** El sistema de autenticación usa JWT, pero no hay un mecanismo explícito para invalidar sesiones globalmente o gestionar revocación (blacklist de tokens), más allá del tiempo de vida del propio token. Si un rol se cambia, el cambio no tomará efecto hasta que el token actual expire.
2. **Auditoría "Sorda":** La auditoría (`audit_log`) parece depender de inserciones manuales desde la capa de código. Si una migración, un administrador desde psql, o un endpoint que olvida llamar al método de auditoría realiza un cambio, se pierde la traza. Considerar implementar Triggers de auditoría en la BD para las tablas críticas (`stock`, `movimientos`).
3. **UI Faltante:** En las secciones inspeccionadas, se observa preparación para formularios de "Creador de Productos" (referenciado en el árbol de carpetas como `creador-productos`), pero la integración en las tablas maestras aún no parece tener madurez contra las validaciones de backend más estrictas.

## Conclusión
El sistema muestra una arquitectura moderna sólida y robusta. El uso de Rust para backend y React-Query en el front otorga excelente rendimiento teórico. El foco inmediato debería estar en solucionar la Condición de Carrera en el conteo de inventario (1.1), ya que es un fallo directo en la integridad del inventario que puede provocar pérdida de mercancía virtual, y en blindar las reglas de reintento HTTP (2.1) para proteger la idempotencia de las transacciones.
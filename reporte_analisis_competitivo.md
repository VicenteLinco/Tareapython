# Análisis Competitivo y Arquitectónico del Sistema de Inventario

Este documento presenta un análisis profundo de la solución actual, comparando cada módulo y decisión técnica con los estándares de la industria (sistemas ERP y WMS modernos como SAP Business One, Odoo, Katana, Cin7, etc.). 

Se detalla **qué se hizo bien**, **qué se hizo mal o es mejorable**, y **cómo debería haberse implementado** desde un enfoque *Enterprise*.

---

## 1. Arquitectura Base (Tech Stack)
**Contexto:** Backend en Rust (Axum + SQLx) y Frontend en React (Vite + TypeScript) con PostgreSQL.

*   **✅ Qué hiciste bien:**
    *   **Elección tecnológica:** Rust garantiza seguridad de memoria y un rendimiento excepcional. SQLx ofrece comprobación de queries en tiempo de compilación. React + Vite es el estándar de oro actual para SPA (Single Page Applications) rápidas.
    *   **Separación Frontend/Backend:** La arquitectura API-first permite escalar, crear apps móviles en el futuro o integrarse con terceros fácilmente.
*   **❌ Qué hiciste mal (o es mejorable):**
    *   **Acoplamiento y "Fat Handlers":** Gran parte de la lógica de negocio y armado de consultas SQL reside directamente en los controladores (handlers HTTP) en lugar de estar aislada en una capa de Servicios.
    *   **SQL Dinámico Frágil:** Armar consultas complejas concatenando strings (uso intensivo de `format!`) es propenso a errores de ejecución y dificulta el mantenimiento, aunque uses *binds* para evitar inyección SQL.
*   **💡 Cómo debería haberse hecho:**
    *   Implementar una arquitectura limpia (Clean Architecture / Hexagonal). Los handlers solo deben procesar HTTP, llamar a un `Service` puro de Rust y devolver la respuesta.
    *   Para consultas altamente dinámicas (como el listado de stock con múltiples filtros), utilizar un *Query Builder* como `SeaQuery` junto a SQLx, o vistas materializadas.

---

## 2. Gestión de Catálogo y Presentaciones
**Contexto:** Productos con Múltiples Presentaciones, Unidades Base, y Factores de Conversión.

*   **✅ Qué hiciste bien:**
    *   **Factores de conversión:** Modelar el catálogo con una `unidad_base` y múltiples `presentaciones` (ej. Caja de 12, Pallet de 50) es exactamente como lo hacen los grandes ERPs. Evita la duplicación de ítems en el inventario.
*   **❌ Qué hiciste mal (o es mejorable):**
    *   **Control de Concurrencia Parcial:** Aunque hay un sistema de versiones (optimistic locking) implementado en `actualizar_producto`, no se usa de manera consistente en toda la aplicación (ej. en movimientos rápidos de stock).
*   **💡 Cómo debería haberse hecho:**
    *   Mantener el enfoque actual, pero asegurar que **toda** entidad transaccional tenga `version` o `updated_at` gestionado automáticamente. El catálogo está muy bien modelado.

---

## 3. Motor de Stock y Lotes (FEFO/FIFO)
**Contexto:** Control de stock basado en lotes con fechas de caducidad.

*   **✅ Qué hiciste bien:**
    *   **Trazabilidad por Lote:** Fundamental para industrias reguladas (alimentos, farma). El control estricto de FEFO (First Expire, First Out) es una ventaja competitiva.
*   **❌ Qué hiciste mal (o es mejorable):**
    *   **Cálculo de Stock "On-the-fly" (Al vuelo):** El sistema actual calcula el stock disponible y las estadísticas sumando todos los lotes y movimientos mediante CTEs (`WITH ...`) gigantes cada vez que se carga la página. En inventarios grandes, esto colapsará el rendimiento (O(n) donde n son los movimientos).
*   **💡 Cómo debería haberse hecho:**
    *   **Tablas de Saldos (Materialized Balances):** Los ERPs mantienen una tabla `stock_saldos` (Producto, Lote, Area, Cantidad_Actual). Cuando hay un movimiento, se actualiza esta tabla. Leer el stock es una operación O(1).
    *   Los movimientos son el *Log inmutable* (Event Sourcing), pero la lectura se hace contra el estado materializado.

---

## 4. Motor Predictivo y Alertas de Agotamiento
**Contexto:** Análisis de consumo diario histórico (7d/30d ponderado) cruzado con tiempos de despacho (Lead Time).

*   **✅ Qué hiciste bien:**
    *   **Feature "Killer":** Implementar forecasting y cálculo de días de autonomía (Days of Supply) es una funcionalidad avanzada que muchos sistemas PyME no tienen. Cruza muy bien el lead time del proveedor con el consumo.
*   **❌ Qué hiciste mal (o es mejorable):**
    *   **Lógica monolítica en SQL:** Todo el peso del motor predictivo vive dentro de una sola consulta SQL enorme en `handlers/stock.rs`. Esto impide iterar el modelo de predicción (ej. añadir estacionalidad, suavizado exponencial) o testearlo unitariamente.
    *   **Cálculo en tiempo real costoso:** Bloquea la base de datos para todos los usuarios cada vez que alguien abre el dashboard.
*   **💡 Cómo debería haberse hecho:**
    *   **Procesamiento Asíncrono (Background Workers):** Un demonio o cronjob (usando `tokio` timers o una cola como `Faktory`/`Oban`) que calcule las estadísticas predictivas y el nivel de riesgo cada hora o cada noche, guardando el resultado en una tabla `alertas_stock`. 
    *   El dashboard simplemente lee esa tabla ultrarrápida.

---

## 5. Recepciones y Solicitudes de Compra
**Contexto:** Flujo de aprobación de compras y recepción de mercadería con fotos/documentos.

*   **✅ Qué hiciste bien:**
    *   **Flujo de estado:** El flujo (borrador -> aprobada -> enviada -> parcial/completa) es un estándar de la industria (Purchase Order Lifecycle). La captura de evidencia fotográfica es excelente para auditoría de almacén.
*   **❌ Qué hiciste mal (o es mejorable):**
    *   **Falta de "Costing" (Costeo):** No se observa un seguimiento estricto del costo de los productos recepcionados (Precio Promedio Ponderado, FIFO cost). Un inventario sin valoración económica está cojo frente a un ERP.
    *   **Lógica Atrapada:** La lógica de re-utilización de lotes y aplicación de stock en recepciones mezcla dominio y HTTP.
*   **💡 Cómo debería haberse hecho:**
    *   Añadir obligatoriamente el registro del costo unitario en cada recepción. Implementar un motor de valoración de inventario (Moving Average Cost o Standard Cost).
    *   Encapsular esto en un `RecepcionService` transaccional aislado.

---

## 6. Auditoría y Seguridad (RBAC y Logs)
**Contexto:** Roles de usuario, autenticación JWT y tabla `audit_log`.

*   **✅ Qué hiciste bien:**
    *   **Conteo Ciego (Blind Counts):** Práctica WMS de primer nivel. Obliga al operario a contar la realidad física sin sesgos.
    *   Registro de `datos_anteriores` y `datos_nuevos` en JSON.
*   **❌ Qué hiciste mal (o es mejorable):**
    *   **Auditoría Manual (Developer-driven):** Actualmente dependes de que el programador recuerde hacer el `INSERT INTO audit_log` en cada función de Rust. Si alguien lo olvida, hay un hueco de seguridad.
    *   **Conteo vs Operación:** No se evidencia un mecanismo de "Congelamiento de Stock" (Snapshot) durante un conteo. Si se vende algo mientras el operario cuenta, el ajuste generará descuadres fantasmas.
*   **💡 Cómo debería haberse hecho:**
    *   **Triggers de Base de Datos:** Usar triggers en PostgreSQL para alimentar la tabla de auditoría automáticamente en cada `INSERT/UPDATE/DELETE`. Así es imposible bypassear el log, incluso si se toca la BD a mano.
    *   **Snapshots de Conteo:** Al iniciar una sesión de conteo, copiar el stock actual esperado a una tabla temporal de la sesión. Conciliar contra esa foto, sumando/restando los movimientos ocurridos *durante* el conteo.

---

## Resumen Ejecutivo y Hoja de Ruta

Tu sistema es **funcionalmente muy superior** al promedio de proyectos a medida, acercándose a características de un ERP maduro (predictivo, FEFO, conteos ciegos). El problema principal radica en la **deuda técnica arquitectónica** (lógica acoplada, SQL dinámico pesado y cálculos en tiempo real no escalables).

**Plan de Acción Recomendado:**
1. **Corto Plazo:** Limpiar los Handlers. Mover toda lógica a Servicios (`RecepcionService`, `StockService`).
2. **Medio Plazo:** Refactorizar el Motor Predictivo. Extraerlo de la consulta SQL a un proceso en background (Cronjob en Rust) que actualice una tabla materializada.
3. **Largo Plazo:** Implementar costeo de inventario (PPP/FIFO) y congelamiento de stock para los conteos físicos. Mover la auditoría a Triggers de PostgreSQL.
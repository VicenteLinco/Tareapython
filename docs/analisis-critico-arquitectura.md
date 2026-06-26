# Análisis Crítico de Arquitectura y Producto
## Inventario Laboratorio Clínico — Diagnóstico de Mejoras, Redundancias y Carencias

Este documento presenta una evaluación detallada de la arquitectura de datos, flujos lógicos y experiencia de usuario (UX) del sistema de inventario. El objetivo es identificar **qué está de más** (redundancias que añaden complejidad), **qué falta** (carencias operativas críticas) y **cómo mejorarlo** (optimizaciones de algoritmos y flujos existentes).

---

## 1. Qué está de más (Redundancias a Simplificar)

### 🔴 1.1 Ruido Visual de Lotes Implícitos en Consumibles (`simple`)
* **El Problema:** Para soportar el modelo de contabilidad e inventario inmutable, todo movimiento de stock debe estar asociado a un `lote_id`. Para productos de perfil `simple` (ej: gasas, jeringas, puntas), el sistema autogenera lotes virtuales (ej: `LOTE-IMPLICITO-REC-001`) en cada recepción para rastrear el costo unitario de esa compra. 
* **La Redundancia:** Mostrar estos lotes autogenerados en la interfaz de usuario de stock, consumos y reportes añade ruido cognitivo extremo. Al operario clínico no le interesa saber qué "lote implícito" de gasas está tomando, ya que no tiene fecha de vencimiento ni trazabilidad regulatoria.
* **Propuesta de Mejora:** **Abstracción en la Capa de Presentación (UX).**
  * La base de datos y el motor transaccional siguen operando con lotes virtuales en el backend para conservar el cálculo FIFO y costos.
  * El frontend colapsa los lotes virtuales para productos `simple`. En el inventario general y en la pantalla de consumos, el stock se visualiza unificado (ej: "Gasas: 450 unidades disponibles en Área Hematología"), ocultando el dropdown de selección de lote.

### 🔴 1.2 Duplicidad de Flujos de Salida: Consumo vs. Descarte
* **El Problema:** Actualmente existen servicios y endpoints separados para [consumo_service.rs](file:///home/vdev/desarrollo/Inventariomarzo-final/backend/src/services/consumo_service.rs) y [descarte_service.rs](file:///home/vdev/desarrollo/Inventariomarzo-final/backend/src/services/descarte_service.rs).
* **La Redundancia:** Ambos flujos son conceptualmente idénticos: reducen stock físico mediante movimientos negativos en el ledger, seleccionan lotes con FEFO (o escaneo directo) y validan existencias. Tener dos implementaciones clínicas y dos pantallas de UI separadas duplica el código de frontend y backend.
* **Propuesta de Mejora:** **Unificar en un Flujo Único de "Salidas de Inventario".**
  * Crear un único endpoint `POST /inventario/salida` que reciba un parámetro `motivo_salida`.
  * Los motivos de salida se tipifican en el backend:
    * `uso_clinico` (reemplaza a consumo).
    * `control_calidad` (salida para pruebas de calibración).
    * `descarte_vencido` (reemplaza a descarte por fecha).
    * `descarte_danado` (reemplaza a descarte por rotura).
  * Esto unifica la UX en una sola pantalla ágil de "Despacho/Salida" con un selector rápido de motivo, reduciendo a la mitad los componentes de UI a mantener.

---

## 2. Qué falta (Carencias Clínicas Críticas)

### 🚀 2.1 Módulo de Transferencias entre Áreas (Falta Crítica de Negocio)
* **El Hallazgo:** En la base de datos ([001_initial_schema.sql:479](file:///home/vdev/desarrollo/Inventariomarzo-final/backend/migrations/001_initial_schema.sql#L479)), existen los tipos de movimiento `TRANSFERENCIA_ENTRADA` y `TRANSFERENCIA_SALIDA`. Sin embargo, en el backend de Rust **no existe lógica implementada** para realizar transferencias, y el frontend carece de esta funcionalidad.
* **El Impacto:** En un laboratorio clínico con 12 áreas, los reactivos se reciben en el "Bodegón Central" y luego se distribuyen físicamente a áreas como "Urgencias" o "Inmunología". Actualmente, para mover stock, los usuarios tienen que hacer un ajuste negativo manual en el área de origen y un ajuste positivo en la de destino. Esto:
  * Duplica el trabajo operativo.
  * Destruye la trazabilidad y auditoría (no queda registro de quién trasladó qué lote).
  * Provoca errores manuales de digitación de lotes y fechas de vencimiento al reingresarlos en el destino.
* **Propuesta de Mejora:** **Implementar el Servicio de Traslados.**
  * Crear `transferencia_service.rs` que ejecute una transacción de base de datos con dos inserts atómicos en `movimientos`:
    1. Un movimiento de `TRANSFERENCIA_SALIDA` en el área origen, asociando el `destino_area_id`.
    2. Un movimiento de `TRANSFERENCIA_ENTRADA` en el área destino, asociando el área origen.
  * Crear una interfaz de **"Traslado Rápido"** que permita seleccionar origen, destino, productos y cantidades (por lote si es trazable), reduciendo el stock de un lado e incrementando el del otro automáticamente.

```
                  TRANSACCIÓN ATÓMICA DE TRASLADO
                  
     [ Área de Origen ]                              [ Área de Destino ]
   (ej. Bodega Central)                            (ej. Hematología)
            │                                              │
            ▼                                              ▼
  TRANSFERENCIA_SALIDA                            TRANSFERENCIA_ENTRADA
  • cantidad: -10                                 • cantidad: +10
  • lote_id: LOTE-A                               • lote_id: LOTE-A
  • destino_area_id: Hematología                  • origen_area_id: Bodega Central
```

### 🚀 2.2 Validación de Lotes por Control de Calidad (QC Release Gate)
* **La Carencia:** En laboratorios acreditados (ISO 15189), **un nuevo lote de reactivo no puede utilizarse en muestras de pacientes** hasta que el personal técnico haya corrido pruebas de calibración y control de calidad (QC) satisfactorias. Actualmente, cualquier lote recibido ingresa directo al stock utilizable.
* **Propuesta de Mejora:** **Workflow de Liberación de Lote.**
  * Agregar un estado al lote (`estado_lote` en la tabla `lotes` o en `stock`): `'pendiente_qc' | 'liberado' | 'bloqueado_qc'`.
  * Al recibir un nuevo lote, se registra por defecto como `'pendiente_qc'`.
  * **Comportamiento Lógico:** El stock de este lote es visible físicamente, pero está **bloqueado para consumo de pacientes** (bloqueado en la pantalla de consumos clínicos).
  * El único consumo permitido para este lote es bajo el motivo `'control_calidad'`.
  * Agregar una bandeja de "Validación de Calidad" donde el tecnólogo registra el resultado del QC. Si aprueba, el lote pasa a `'liberado'` y queda disponible para consumo general. Si reprueba, pasa a `'bloqueado_qc'` para su descarte.

### 🚀 2.3 Relaciones de Dependencia y Kits (Reactivos vs. Diluyentes)
* **La Carencia:** Los analizadores automáticos consumen reactivos que dependen de otros insumos para funcionar (ej: un cartucho de reactivo de hemoglobina glucosilada requiere un buffer de lavado y puntas específicas). Si se agota el diluyente, el reactivo queda inutilizado. El sistema actual planifica y calcula alertas de stock de manera aislada por producto.
* **Propuesta de Mejora:** **Asociaciones de Producto (Kits/Recetas).**
  * Permitir configurar dependencias en el catálogo (ej: *"1 Kit de Reactivo X requiere 2 botellas de Diluyente Y"*).
  * **Alertas por Cuello de Botella:** En el Dashboard, alertar cuando exista un desbalance de inventario (ej: *"Alerta de Operación: Tienes reactivos para 100 pruebas de VIH, pero sólo quedan diluyentes para 10 pruebas"*).

---

## 3. Cómo mejorarlo (Optimizaciones a Algoritmos Existentes)

### ⚙️ 3.1 FEFO con Margen de Seguridad de Consumo (Expiry Buffer)
* **El Algoritmo Actual:** El motor FEFO automático ([stock_ops.rs:72](file:///home/vdev/desarrollo/Inventariomarzo-final/backend/src/services/stock_ops.rs#L72)) selecciona lotes ordenados por vencimiento ascendente, permitiendo la salida siempre que `fecha_vencimiento >= CURRENT_DATE`.
* **El Defecto Clínico:** Si un reactivo tiene una estabilidad de 7 días una vez abierto, o toma en promedio 5 días en consumirse en el área, el sistema no debería sugerir un lote que vence en 2 días. Consumir ese lote provocará que venza en medio de su uso, arruinando pruebas o forzando descartes a mitad del proceso.
* **La Optimización:** **Margen de Vencimiento de Seguridad (`dias_estabilidad` / `expiry_buffer`).**
  * Añadir el campo `margen_vencimiento_dias` al catálogo de productos (ej: reactivo crítico = 10 días; insumos simples = 0 días).
  * El motor FEFO debe filtrar lotes cuya vida útil remanente sea mayor al margen de seguridad del producto:
    ```sql
    AND (l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= CURRENT_DATE + p.margen_vencimiento_dias)
    ```
  * Si un lote está por debajo de este margen pero aún no vence, se muestra una alerta visual al operador para que evalúe si alcanzará a consumirlo antes del vencimiento real.

### ⚙️ 3.2 Previsiones de Compra por Correlación de Demanda
* **El Algoritmo Actual:** En [forecast.rs](file:///home/vdev/desarrollo/Inventariomarzo-final/backend/src/services/forecast.rs), la sugerencia de compra (`cantidad_sugerida`) se calcula para cada SKU de manera aislada según su propio historial.
* **La Optimización:** Cuando el sistema ejecute la rutina de sugerencia de compras para un reactivo, debe evaluar si las sugerencias de sus diluyentes y consumibles asociados en el catálogo cubren la misma cantidad de días objetivo. Si no, debe auto-ajustar las compras sugeridas de los diluyentes para alinearse con los reactivos principales, previniendo quiebres operativos por insumos secundarios.

---

## Resumen del Plan de Refinamiento (Hoja de Ruta)

| Prioridad | Mejora Propuesta | Componente Afectado | Dificultad | Beneficio Clínico / Operativo |
|---|---|---|---|---|
| **1 (Crítica)** | **Traslado de Stock** | Backend (`transferencia_service`), Frontend (`ModalTraslado`) | 🟡 Media | Elimina ajustes dobles y recupera la trazabilidad de stock entre las 12 áreas. |
| **2 (Alta)** | **Abstracción de Lotes Simples** | Frontend UI (`Inventario`, `Consumos`) | 🟢 Baja | Limpia la interfaz clínica de códigos de lote virtuales "ruido" en consumibles. |
| **3 (Alta)** | **Unificar Consumo y Descarte** | Backend (`salida_service`), Frontend (`SalidaInventarioPage`) | 🟡 Media | Reduce huella de código y simplifica el flujo de salida en una única pantalla de despacho. |
| **4 (Media)** | **Aprobación de Lote por QC** | DB (`lotes.estado`), Backend (`lote_service`), Frontend | 🔴 Alta | Cumplimiento regulatorio estricto (ISO 15189): previene el uso de lotes no validados. |
| **5 (Media)** | **FEFO con Expiry Buffer** | Backend (`stock_ops.rs` query FEFO) | 🟢 Baja | Evita que reactivos se venzan a mitad de su periodo de estabilidad en el área. |
| **6 (Baja)** | **Correlación de Kits/Recetas** | DB, Backend (`forecast.rs`), Frontend | 🔴 Alta | Planificación de compras integrada; evita quiebres por falta de diluyentes o consumibles asociados. |

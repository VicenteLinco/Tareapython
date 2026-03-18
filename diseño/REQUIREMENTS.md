# Requisitos del Sistema - Inventario de Laboratorio Clínico V1.0

## 1. Problema a Resolver

El laboratorio no tiene registro de consumo de insumos, lo que genera:
1. No se sabe cuánto se consume realmente
2. No hay visibilidad clara del stock para tomar decisiones
3. No se puede predecir ni planear pedidos ni días de operación
4. Se vencen reactivos por pedidos sobredimensionados
5. El conteo semanal (sábados) toma demasiado tiempo por hacerse contra lista impresa

**Problema raíz:** Sin registro de consumo → sin datos → sin visibilidad → sin planeación → desperdicio.

## 2. Usuarios

| Rol | Cantidad | Responsabilidades |
|-----|----------|-------------------|
| Jefe de Laboratorio | 1 (+ 3 subrogantes) | Aprueba pedidos, administra, toma decisiones, visión general |
| Tecnólogo Médico | 23 | Consume reactivos, cuenta stock, recibe cargas, crea pedidos |
| Administrativo | 2 | Cuenta stock y revisa inventario de algunas áreas |

- Hay **encargados de área** (fijos) y **turnantes** (rotan entre áreas según horario/día).
- El acceso a áreas debe ser flexible por usuario.

## 3. Sistema de Roles (RBAC - Roles Fijos)

Roles predefinidos con permisos fijos (sin configuración granular en MVP):
- **admin**: Acceso total (jefe + subrogantes).
- **tecnologo**: Consumir, contar, recibir cargas, crear pedidos.
- **consulta**: Ver stock y reportes (administrativos).

Se puede evolucionar a permisos granulares en el futuro si se necesita.

## 4. Ubicaciones (12 áreas)

1. Microbiología
2. PCR
3. Orinas
4. Recepción
5. Laboratorio Central
6. Bodega Insumos
7. Bodega Reactivos
8. Serología
9. Unidad de Medicina Transfusional
10. Donantes
11. Sala Entrevista Donantes
12. Sala de Toma de Muestras

- 2 bodegas separadas (insumos y reactivos).
- Los insumos pertenecen a un área pero también pueden estar en bodega.

## 5. Catálogo de Insumos

- Aproximadamente 1000-1500 insumos distintos.
- Tipos variados: kits, cajas, consumibles, cartuchos, tubos, reactivos líquidos, etc.
- Cada insumo tiene una **unidad base** (la unidad mínima de consumo).
- Cada insumo puede tener **presentaciones** (ej: caja de 10 unidades, frasco de 500ml).

## 6. Patrones de Consumo y Modelo de Stock

**Stock se rastrea a nivel de LOTE, no de presentación individual.**

Dos tipos de consumo:
1. **Consumo completo:** Se abre una presentación y se descuenta entera del lote (1 caja = 10 unidades base → se restan 10 del lote).
2. **Consumo parcial:** Se descuentan unidades base del lote gradualmente.

- El sistema consume automáticamente del lote más próximo a vencer (FEFO: First Expired, First Out).
- No se trackean presentaciones abiertas individuales — se trackea el stock total del lote en unidades base.

## 7. Flujo de Recepción de Insumos

1. Llega el pedido del proveedor.
2. Se verifica contra la guía de despacho en el lugar de llegada.
3. Se registra: fecha/hora, productos, cantidad, unidades/presentaciones, vencimiento de cada lote.
4. Se guarda copia de la guía de despacho.
5. Se registra estado: borrador (si se interrumpe), completa, parcial o rechazada.
6. Se distribuye directamente a la ubicación destino (no pasa por bodega obligatoriamente).

## 8. Flujo de Pedidos

- Cualquier funcionario puede crear un pedido.
- El jefe (o subrogante) debe aprobar el pedido.
- 1 jefe + 3 subrogantes con mismo poder de aprobación.

## 9. Conteo de Inventario

- Actualmente: semanal (sábados), contra lista impresa, lento.
- Se cuenta por área + bodega central.
- **El sistema siempre almacena stock en unidad base.** La interfaz ofrece atajos para ingresar por presentación (ej: "3 cajas" → el sistema multiplica automáticamente a unidades base).
- Las diferencias generan ajustes de stock automáticos.
- Objetivo: conteo guiado desde celular, rápido, con cálculo automático de diferencias.

## 10. Trazabilidad

Cada consumo registra:
- Quién consumió
- Cuándo
- Qué lote
- Qué reactivo
- Cantidad consumida

No se requiere trazabilidad de equipo/paciente/muestra.

## 11. Identificación de Productos

Sistema mixto:
- **Código interno:** Generado por el sistema, imprimible (etiqueta con nombre, lote, vencimiento).
- **Código del fabricante:** Se puede escanear si existe (código de barras o QR), pero puede cambiar entre lotes.
- El código interno es el identificador confiable principal.

## 12. Stack Tecnológico

- **Backend:** Rust + Axum + SQLx
- **Frontend:** React + TypeScript + Tailwind CSS + shadcn/ui
- **Base de Datos:** PostgreSQL
- **Despliegue:** Docker (flexible: VPS/nube o intranet local)
- **Acceso:**
  - Celular: escaneo, conteo, registro de consumo/entrada (operaciones rápidas)
  - PC: análisis, reportes, ajustes, administración

## 13. Carga Inicial del Sistema

- El sistema debe tener un **modo setup** para la carga inicial de datos.
- Permite importar productos, lotes y stock existente desde CSV/Excel.
- Genera movimientos tipo `CARGA_INICIAL` para que el ledger nazca consistente.
- Una vez cerrada la carga inicial, este modo se bloquea permanentemente.

## 14. Descarte de Reactivos

- Los reactivos vencidos o dañados se retiran del stock con movimientos de descarte.
- Tipos: `DESCARTE_VENCIDO`, `DESCARTE_DAÑADO`.
- Permite generar reportes de desperdicio (cuánto se perdió por vencimiento en un período).

## 15. Patrones de Protección de Datos (MVP)

- **Idempotency Keys:** Toda operación de escritura desde móvil envía un UUID único. Si el backend recibe la misma key dos veces, retorna la respuesta original sin re-ejecutar. Previene duplicación por señal inestable.
- **Optimistic Locking:** Las tablas de catálogo (productos, presentaciones, proveedores) tienen campo `version`. Al editar, si la versión no coincide con la esperada, se rechaza. Previene sobrescritura entre usuarios concurrentes.
- **Audit Trail:** Todo cambio en catálogo se registra con estado anterior/posterior, quién y cuándo. Inmutable.
- **Offline Queue (Fase 2):** El frontend almacena operaciones en localStorage cuando no hay señal y sincroniza al recuperar conexión. Depende de idempotency keys.

## 16. Pautas de UX (rescatadas del diseño legacy, validadas)

- **Consumo móvil "Modo Kiosko":** Botones grandes, escaneo continuo, feedback sonoro. Optimizado para celular/tablet en el mesón del lab. El tecnólogo debe poder registrar un consumo en menos de 10 segundos.
- **Vista de stock Master-Detail:** Lista de productos con panel lateral que muestra lotes activos sin salir de la lista (sin modales bloqueantes).
- **Draft Mode en recepciones:** Guardar recepciones incompletas para continuar después si se interrumpe el registro.
- **Conteo Modo Ciego (Fase 2):** El contador no ve el stock teórico para garantizar honestidad.
- **Dual-Unit Counter (Fase 2):** Contar por "envases cerrados + unidades sueltas" y que el sistema sume automáticamente.
- **Freeze Stock durante conteo (Fase 2):** Bloquear movimientos de los ítems en proceso de conteo para evitar inconsistencias.

## 17. Prioridad de MVP (Fase 1)

1. **Carga inicial** (importar catálogo y stock existente)
2. **Registro de consumo** (individual + batch, con idempotency)
3. **Visibilidad de stock** (por área, alertas, master-detail)
4. **Recepción de insumos** (con draft mode)

## 18. Fases Futuras (post-MVP)

- Fase 2: Conteo guiado desde celular (modo ciego, dual-unit, freeze stock) + Offline queue
- Fase 3: Pedidos con flujo de aprobación + Alertas proactivas
- Fase 4: Inteligencia logística (predicción de consumo, alertas de reorden — requiere mínimo 3-6 meses de datos)
- Fase 5: Reportes de desperdicio por descarte/vencimiento + reportes financieros (requiere costo_unitario en lotes)

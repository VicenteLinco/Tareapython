# Plan consolidado del repositorio

Ultima revision: 2026-05-23

Este documento consolida lo pendiente que aparece en los planes `.md` del repositorio y separa deuda real de notas historicas ya cerradas. La idea es que este archivo reemplace los planes dispersos.

## Pendiente real de producto

### P1. Capa de cantidades con Decimal en frontend

Origen: documentos historicos de diseno: PLAN_MEJORAS.md D1 y ANALISIS_DISENO.md.

Avance 2026-05-23:

- `frontend/src/domain/parse.ts` centraliza conversiones con `DecimalInput`, `toDecimal`, `toNum`, `sumDecimal`, `mulDecimal` y calculos auxiliares.
- `solicitudes-compra/solicitud-utils.ts` calcula cantidades sugeridas, dias cubiertos y moneda desde la capa Decimal.
- `solicitudes-compra/hooks/useSolicitudState.ts` dejo de usar `parseFloat` en carga/restauracion de items, recomendaciones, busqueda y subtotales.
- `recepciones/nueva.tsx` y `recepciones/hooks/useRecepcionItems.ts` usan la capa Decimal para cantidades vinculadas desde solicitudes, factores de presentacion y precio unitario.
- Verificado con `npm.cmd run build` y `npm.cmd run lint` en frontend. Lint queda con 2 warnings no bloqueantes de hooks.

Pendiente para cerrar P1:

- Terminar de reemplazar `parseFloat` y `Number(...)` sobre cantidades fuera de la capa Decimal.
- Revisar pantallas con calculos de stock, forecast, solicitudes, recepciones y reportes.
- Criterio de cierre: las cantidades criticas no se calculan con conversiones sueltas en componentes.

### P2. Impresion de etiquetas agrupada

Origen: `diseÃ±o/PLAN_MEJORAS.md` B9.

- Permitir seleccion multiple en lista de lotes.
- Agregar accion "imprimir N etiquetas".
- Mostrar preview antes de imprimir.

### P3. Modo oscuro

Origen: `diseÃ±o/PLAN_MEJORAS.md` C4.

- Activar tema oscuro usando DaisyUI.
- Validar especialmente modo kiosk y pantallas de baja luz.
- Mantenerlo como opcional si no hay necesidad operativa.

### P4. Notificaciones por email

Origen: `diseÃ±o/PLAN_MEJORAS.md` E2.

- Enviar digest diario de items criticos a admin/jefe de bodega.
- Usar proveedor externo tipo SendGrid o Resend.
- Definir configuracion de destinatarios y areas.

### P5. Importacion masiva mejorada / Setup

Origen: `CLAUDE.md` y `diseÃ±o/PLAN_MEJORAS.md` E3.

Hay contradiccion entre documentos: `CLAUDE.md` dice que falta finalizar Setup, mientras `PLAN_MEJORAS.md` dice que Setup ya importa CSV y que falta mejorar la UX.

- Verificar estado real del modulo Setup.
- Si falta backend: completar importacion CSV y finalizar carga inicial.
- Si backend ya existe: agregar validacion previa, preview, errores por fila y plantilla descargable.
- Actualizar `CLAUDE.md` despues de verificar para que no siga indicando deuda antigua.

### P6. Anomalias de consumo y precio

Origen: `diseÃ±o/PLAN_MEJORAS.md` E4.

- Detectar consumo fuera de patron.
- Mostrar confianza y razon.
- Permitir confirmar o descartar la anomalia.
- Advertir variaciones de precio mayores a 15% contra historico.

### P7. Multi-bodega / multi-laboratorio

Origen: `diseÃ±o/PLAN_MEJORAS.md` E5.

- No implementar sin decision de roadmap.
- Antes de tocar codigo, definir si el modelo debe soportar multi-tenant, multiples bodegas o multiples laboratorios.
- Si no hay expansion prevista, mantener como idea archivada.

## Pendiente de QA

### QA1. Solicitudes multi-proveedor

Origen: `diseÃ±o/SPEC_SOLICITUDES_MULTIPROVEEDOR.md`.

La implementacion aparece como completada en `PLAN_MEJORAS.md`, pero el checklist QA de la spec sigue sin marcar. Queda validar:

- Crear solicitud con 1 proveedor.
- Crear solicitud con 3 proveedores en modo revision.
- Crear solicitud con 2 proveedores en modo avanzado alternando filtros.
- Quitar chip de filtro sin tocar el carrito.
- Quitar grupo del carrito sin tocar el filtro.
- Guardar y confirmar que `solicitud_envios` tiene N filas en `pendiente`.
- Registrar envio parcial y validar estado `parcialmente_enviada`.
- Registrar ultimo envio y validar estado `enviada`.
- Cancelar un envio y validar retorno a `parcialmente_enviada`.
- Cancelar todos los envios y validar retorno a `guardada`.
- PDF single-proveedor sin regresiones visuales.
- PDF multi-proveedor con secciones y resumen.
- Crear recepcion desde solicitud multi-proveedor filtrando por proveedor.
- Restaurar borrador antiguo mono-proveedor.
- Conflicto 409 al registrar envio con version obsoleta: toast + dialog abierto.
- Historial muestra "N proveedores" y badge `parcialmente_enviada`.
- Item sin `proveedor_id` bloquea guardar con mensaje claro.
- Recomendacion sin `proveedor_id` muestra accion deshabilitada con tooltip.

### QA2. Checklist recurrente de release

Origen: `docs/CHECKLIST_RELEASE.md`.

Esto no es deuda de producto; es una rutina antes de entregar:

- Revisar `git status --short`.
- Ejecutar backend: `cargo test --no-run`; si hay DB de prueba, `cargo test`.
- Revisar migraciones nuevas y, si aplica, copiar a `release/migrations/`.
- Ejecutar frontend: `npm.cmd run build` y `npm.cmd run lint`.
- Probar login, dashboard, productos, recepcion, etiquetas, consumo, descarte, stock, solicitudes y conteo.
- Confirmar movimientos/auditoria, bloqueo de stock negativo e idempotencia ante doble click.
- Registrar warnings aceptados, deuda conocida y pruebas no ejecutadas.

## Pendiente operativo

Origen: `diseÃ±o/ANALISIS_DISEÃ‘O.md` y `docs/DEPLOY.md`.

- Automatizar backups reales si aun no existe tarea programada externa.
- Validar backup de base de datos y uploads antes de cada entrega.
- Evaluar object storage tipo MinIO/S3 para imagenes si el despliegue sale de un entorno simple.
- Evaluar metricas Prometheus si el sistema pasa a produccion critica. El logging estructurado ya aparece como completado.

## No pendiente / ya cerrado segun el plan

Estos puntos aparecen como pendientes en secciones antiguas, pero luego figuran completados en los sprints del mismo `PLAN_MEJORAS.md`:

- Dashboard accionable.
- Filtros guardados.
- Busqueda global Ctrl+K.
- Tooltips de metricas.
- Recepcion guiada.
- Solicitudes: separar revision de edicion.
- Reconciliacion post-recepcion.
- Conteo movil optimizado.
- Alertas por usuario/area.
- Historial visible por producto.
- Reportes y exportacion a Excel.
- CI basico.
- Tests de dominio critico.
- Errores HTTP tipados.
- EstadoBadge, EmptyState, CantidadConUnidad, UrgenciaTag y AutonomiaBar integrados.
- Migracion de `toast()` a `notify`.
- ConfirmDialog con impacto.
- Atajos de teclado extendidos.
- Layout responsivo principal.

## Archivos candidatos a eliminar o archivar

Despues de revisar este consolidado, se pueden eliminar o mover a `docs/archive/`:

- `diseÃ±o/PLAN_MEJORAS.md`: reemplazado por este consolidado, pero conserva historial de sprints.
- `diseÃ±o/ANALISIS_DISEÃ‘O.md`: documento historico; varias deudas ya fueron cerradas.
- `diseÃ±o/SPEC_SOLICITUDES_MULTIPROVEEDOR.md`: puede archivarse cuando QA1 quede validado.

Mantener:

- `CLAUDE.md`: es guia operativa para agentes, no solo plan. Conviene actualizarlo, no eliminarlo.
- `docs/CHECKLIST_RELEASE.md`: checklist recurrente; puede mantenerse separado o integrarse en este documento.
- `docs/DEPLOY.md`: documentacion operativa, no deberia mezclarse con backlog.

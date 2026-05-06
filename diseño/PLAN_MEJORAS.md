# Plan de mejoras — Inventario Laboratorio Clínico

**Última actualización:** 2026-04-28  
**Objetivo:** elevar claridad de información al usuario, reducir fricción de uso y pagar deuda técnica sin romper funcionalidad.

Esfuerzo estimado: S = ½ día · M = 1-2 días · L = 3-5 días · XL = >1 semana

---

## Principios rectores

- **Confianza antes que cantidad de funciones:** mostrar estado, origen del dato, próxima acción y riesgo operativo en cada flujo crítico.
- **AI como infraestructura, no adorno:** predicción, resumen y recomendaciones solo donde reducen trabajo real.
- **Interfaz progresiva:** vista simple para tareas rápidas, profundidad bajo demanda para usuarios administrativos.
- **Accesibilidad operacional:** contraste alto, objetivos táctiles grandes, soporte teclado/scanner, textos claros para bodega y laboratorio.
- **Rendimiento percibido:** skeletons útiles, actualizaciones optimistas, caché local, pantallas que respondan con red lenta.

---

## Bloque A — Claridad de información al usuario (UX/UI)

### A1. `<CantidadConUnidad>` y `<Cantidad>` ✅ Sprint 1
- Componente `components/ui/cantidad.tsx` con variantes `size` y `tone`. Usa `formatCantidad` internamente.
- **Pendiente:** reemplazar los usos directos de `formatCantidad(...)` que quedan en páginas de stock, solicitudes, recepciones.

### A2. `<EstadoBadge>` unificado ✅ Sprint 1
- Paleta fija: borrador=ghost, en proceso=info, ok=success, alerta=warning, rechazada=error.
- **Pendiente:** reemplazar las clases ad hoc que quedan en Recepciones, Solicitudes, Conteo y Audit log.

### A3. `<UrgenciaTag>` y `<AutonomiaBar>` ✅ Sprint 1
- Componentes creados. **Pendiente:** integrarlos en Stock/index, Solicitudes y Dashboard.

### A4. Dashboard accionable (M) ✅ Sprint 2
- Rediseño en 3 secciones implementadas:
  1. **Hoy hay que hacer:** críticos sin pedido, borradores >24h, conteos vencidos.
  2. **Esta semana:** solicitudes guardadas pendientes, autonomía <14 días.
  3. **Salud del sistema:** 4 stat cards (insumos activos, sin stock, crítico, por vencer).
- Cada bloque con `AccionCard` que muestra conteo + descripción + botón CTA directo.
- Estado "Todo en orden" por sección cuando no hay pendientes.

### A5. Filtros guardados y contextuales (M)
- Persistir filtros locales por pantalla en `sessionStorage`.
- Filtros predefinidos: "bajo mínimo", "vencen 30 días", "sin proveedor", "con pedido pendiente".
- Botón "limpiar filtros" siempre visible cuando hay alguno aplicado.

### A6. Búsqueda global Ctrl+K (M)
- Abre buscador global: producto, lote, número de documento, proveedor, acción.
- Resultado lleva a la pantalla correspondiente con contexto.
- Reutilizar skill `autocomplete-buscador`.

### A7. Tooltips en métricas calculadas (S) ✅ Sprint 2
- Componente `components/ui/metric-tooltip.tsx` con `HelpCircle` + DaisyUI `data-tip`.
- Aplicado en `stock-detail.tsx`: Stock mínimo, Duración estimada, En pico máximo.
- Badge de confianza en `quiebres-panel.tsx` con tooltip explicando alta/media/baja.
- Horizonte global en `pedido-panel.tsx` con explicación de la fórmula.

### A8. `<EmptyState>` con guía ✅ Sprint 1
- Componente `components/ui/empty-state.tsx` con variantes por contexto (sin_stock, sin_solicitudes, etc.).
- **Pendiente:** reemplazar "sin resultados" genéricos en todos los módulos.

### A9. Confirmaciones destructivas con resumen de impacto ✅ Sprint 1
- `confirm-dialog.tsx` ahora acepta prop `impacto?: ImpactoItem[]` con tabla de datos concretos.
- **Pendiente:** integrar en descartes (mostrar unidades, lote, valor) y eliminar borradores.

### A10. Sistema de toasts consistente ✅ Sprint 1
- `lib/notify.ts`: wrapper `notify.success/error/warning/info/promise` con duraciones estándar.
- **Pendiente:** migrar llamadas directas a `toast()` dispersas para usar `notify`.

---

## Bloque B — Flujos de trabajo (UX de proceso)

### B1. Recepción guiada paso a paso (L)
- Wizard de 4 pasos: (1) Proveedor + guía, (2) Items + lotes, (3) Asignar áreas, (4) Confirmar + foto.
- Guardar borrador en cualquier paso. Vista "experto" colapsada para usuarios avanzados.
- Validación visual por lote: incompleto, vencimiento inválido, cantidad cero, área faltante.
- **Criterio:** técnico nuevo completa recepción de 5 items en <3 min sin ayuda.

### B2. Conteo ciego con UX optimizada para móvil (M)
- Layout responsive: en móvil un item a la vez, teclado numérico grande, botones "siguiente / saltar / marcar dudoso".
- Indicador de progreso ("12 de 45"). Autoguardado por item.
- Entrada rápida por scanner: escanear lote y saltar al item.
- Diferencias agrupadas al cierre: leve, crítica, faltante.

### B3. Solicitudes de compra: separar revisión de edición (M)
- Vista por defecto: lista de recomendados con "aceptar / ajustar / descartar" por fila.
- Vista avanzada: edición libre como hoy.
- Mostrar por ítem: stock actual, consumo diario, lead time, cobertura, confianza y razón.
- Permitir cambiar horizonte por item y ver antes/después de cantidad sugerida.
- Persistir elección por usuario.

### B4. Modo kiosk: feedback inmediato y deshacer (M)
- Ventana de "deshacer último consumo" durante 10s después del registro.
- Atajo físico configurable en lector HID.

### B5. Reconciliación post-recepción (M)
- Al confirmar una recepción que cita una solicitud, mostrar diff "pediste X, llegó Y".
- Pedir explicación si discrepancia >10%.

### B6. Consumo batch con validación previa visible ✅ Sprint 1
- Modal pre-confirmación con badge verde/rojo por item según stock disponible.
- Botones "Corregir" y "Confirmar de todas formas" para rojos.

### B7. Alertas configurables por usuario/área (M)
- Suscripción por usuario a alertas de áreas asignadas.
- Dashboard filtra por defecto a las áreas del usuario.
- Agrupadas por acción: comprar, consumir primero, contar, descartar, revisar proveedor.

### B8. Historial visible por producto (M)
- Desde Stock detalle, tab "Historial": últimos 90 días con recepciones, consumos, descartes.
- Mini-gráfico de consumo semanal.
- Panel lateral que no requiere navegar fuera de la tabla.

### B9. Modo "imprimir etiquetas" agrupado (S)
- Selección múltiple en lista de lotes → "imprimir N etiquetas" con preview.

### B10. Atajos de teclado ✅ Sprint 1
- `hooks/use-keyboard-shortcut.ts` y `components/ui/keyboard-legend.tsx` creados.
- Atajos activos en Consumos: `/` = búsqueda, `Esc` = limpiar, `?` = leyenda.
- **Pendiente:** aplicar en Recepciones (`n`=nueva, `Enter`=confirmar, `Esc`=cancelar) y Conteo.

---

## Bloque C — Diseño visual y consistencia

### C1. Design tokens ✅ Sprint 1
- `frontend/src/styles/tokens.css`: espaciado, tipografía, sombras, transiciones, zonas de autonomía.
- Importado desde `index.css`.

### C2. Tipografía jerárquica ✅ Sprint 1
- Clases `.t-display`, `.t-h1`, `.t-h2`, `.t-body`, `.t-caption` definidas en `tokens.css`.
- **Pendiente:** aplicar en layout principal y páginas; reemplazar mezcla de `text-xl`, `text-2xl` ad hoc.

### C3. Layout responsivo en todas las páginas (M)
- Auditoría página por página con breakpoints `sm/md/lg`.
- Prioridad: Stock detalle, Conteo detalle, Recepción nueva.
- Botones CTA principales fijos en mobile/tablet (barra inferior).

### C4. Modo oscuro (M, opcional)
- Útil para modo kiosk en pantallas con poca luz. DaisyUI ya tiene tema dark definido.

### C5. Iconografía consistente con lucide-react ✅ Sprint 1
- Emojis eliminados de `conteo/detalle.tsx` y `recepciones/nueva.tsx`.
- **Pendiente:** auditar páginas restantes (stock, solicitudes, dashboard, usuarios).

---

## Bloque D — Calidad técnica interna

### D1. Tipos numéricos con `decimal.js` (L)
- `domain/parse.ts` que transforma respuestas API: `Decimal` en lugar de `parseFloat` ad hoc.
- **Criterio:** ningún `parseFloat` ni `Number(...)` sobre cantidades fuera de `domain/`.

### D2. Enums de estado tipados end-to-end (M)
- Enums Rust → tipos unión TS generados → uso obligatorio en handlers, hooks y componentes.
- **Criterio:** `tsc --noEmit` falla ante typos como `"completaa"`.

### D3. Descomponer páginas-dios (L)
- Ninguna página >300 líneas ni >5 `useState`.
- **Orden:** `recepciones/nueva.tsx` (963 lns) → `stock/index.tsx` → `solicitudes-compra/index.tsx` (661) → `conteo/detalle.tsx` (522) → `usuarios/index.tsx` (547).
- Extraer subcomponentes a `components/` de la página y hooks a `hooks/dominio/`.

### D4. Capa API por dominio (M)
- `api/stock.ts`, `api/recepciones.ts`, `api/solicitudes.ts`, etc.
- Reemplaza calls dispersos a `api.ts`.

### D5. Hooks por dominio (M)
- `hooks/dominio/useStock.ts`, `useSolicitudes.ts`, `useRecepciones.ts`.
- Encapsulan React Query keys, mutaciones e invalidaciones.

### D6. Tests del dominio crítico (L)
- **Mínimo viable:**
  - `stock_ops` FEFO: 5 escenarios (1 lote, varios lotes, expirado, insuficiente, negativo).
  - `forecast`: 3 escenarios (consumo estable, esporádico, sin historia).
  - `idempotency`: 2 escenarios (key reusada, key nueva).
- **Criterio:** `cargo test` corre en CI y bloquea merge.

### D7. CI básico (S)
- GitHub Actions: `cargo build`, `cargo test`, `cargo clippy`, `tsc --noEmit`, `npm run build`.

### D8. Errores tipados HTTP (M)
- `enum DomainError` → mapeo a códigos HTTP + body `{code, message, details?}`.
- Frontend distingue `LoteAgotado` vs `ConcurrenciaPerdida` sin parsear strings.

### D9. Logging estructurado (S)
- `tracing` con JSON output. Cada request con `request_id`, `usuario_id`, `latencia`.

### D10. Documentar deploy y backup (S)
- `DEPLOY.md`: cómo se sirve frontend en prod, dónde van imágenes, cómo se hace `pg_dump`/restore, cómo aplicar migración nueva sin downtime.

---

## Bloque E — Features nuevas

### E1. Reportes y exportes (M)
- Consumo por área/mes/usuario, top productos por valor descartado, % cumplimiento de conteo.
- Exportar a Excel.

### E2. Notificaciones por email (M)
- Daily digest de items críticos al admin/jefe de bodega.
- Usar SendGrid/Resend (sin SMTP propio).

### E3. Importación masiva mejorada (M)
- Validación previa con preview, errores fila por fila, plantilla descargable.
- Setup ya importa CSV; mejorar la UX.

### E4. Anomalías de consumo y precio (M)
- Detectar consumo fuera de patrón: mostrar confianza y razón, confirmable o descartable.
- Comparar precio de recepción vs histórico; advertir variaciones >15%.

### E5. Multi-bodega / multi-laboratorio (XL)
- Solo si hay roadmap a expansión. Definir si el modelo soporta multi-tenant antes de crecer.

---

## Sprints

### Sprint 1 — Fundamentos visuales ✅ Completo
**A1, A2, A3, A8, A9, A10, C1, C2, C5, B6, B10**
- Componentes base creados: `CantidadConUnidad`, `EstadoBadge`, `UrgenciaTag`, `AutonomiaBar`, `EmptyState`, `KeyboardLegend`.
- Design tokens y tipografía jerárquica en `tokens.css`.
- `lib/notify.ts` para toasts consistentes.
- Validación previa en consumo batch.
- Atajos de teclado en Consumos.
- Emojis eliminados de Conteo y Recepciones.

### Sprint 2 — Flujos críticos y dashboard (~12 días)
**A4 ✅, A5, A6, A7 ✅, B1, B3, B5, B8, D1**
- Dashboard accionable con 3 secciones. ✅
- Filtros guardados por pantalla.
- Búsqueda global Ctrl+K.
- Tooltips en métricas de forecasting.
- Recepción guiada paso a paso.
- Separación revisión/edición en solicitudes.
- Reconciliación post-recepción.
- Historial visible por producto.

### Sprint 3 — Calidad estructural (~12 días)
**D2, D3 (2 páginas más críticas), D4, D5, D6, D7, D8**
- Enums de estado tipados end-to-end.
- Descomponer `recepciones/nueva.tsx` y `stock/index.tsx`.
- Capas API y hooks por dominio.
- Tests de dominio crítico.
- CI básico.
- Errores HTTP tipados.

### Backlog continuo
B2, B4, B7, B9, C3, C4, D9, D10, bloque E.

---

## Pendientes del Sprint 1 (seguimiento)

Creados pero no integrados aún:
- `<CantidadConUnidad>`: reemplazar `formatCantidad(...)` directos en stock, solicitudes, recepciones.
- `<EstadoBadge>`: reemplazar clases ad hoc en Recepciones, Solicitudes, Conteo, Audit log.
- `<UrgenciaTag>` / `<AutonomiaBar>`: integrar en Stock/index, Solicitudes y Dashboard.
- `<EmptyState>`: reemplazar "sin resultados" genéricos en todos los módulos.
- `notify`: migrar llamadas directas a `toast()` para usar `notify`.
- `<KeyboardLegend>`: extender a Recepciones y Conteo.
- `.t-h1 / .t-h2 / .t-body`: aplicar en layout y páginas.
- `ConfirmDialog` con `impacto`: integrar en descartes y eliminar-borrador.

---

## Métricas de éxito

| Métrica | Baseline | Target |
|---------|----------|--------|
| Tiempo para completar recepción de 5 items | — | <3 min |
| Tiempo para consumir desde kiosk | — | <8s por item |
| Líneas por página más larga | 963 | <300 |
| Cobertura tests dominio crítico | 0% | >70% de stock_ops, forecast, idempotency |
| Build frontend limpio | ✅ | ✅ siempre |
| Solicitudes generadas desde recomendación (sin editar) | — | >60% |
| Errores de validación por flujo de recepción | — | ↓50% |

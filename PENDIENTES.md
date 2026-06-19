# Pendientes

Lista de tareas a trabajar más adelante. Solo registro — sin diseño ni implementación todavía.

Cada ítem describe el **problema** y el **resultado esperado**, no la solución técnica.
La prioridad es una sugerencia para ordenar el trabajo, no un compromiso.

**Prioridad:** 🔴 Alta · 🟡 Media · 🟢 Baja

| # | Pendiente | Área | Prioridad |
|---|-----------|------|-----------|
| 1 | Herramienta de etiquetas — rediseño | Etiquetas | 🟡 Media |
| 2 | Alertas de vencimiento — mostrar % del total | Stock / Alertas | 🟡 Media |
| 3 | Configuración — personalizar login (nombre + imagen) | Configuración | 🟢 Baja |
| 4 | PDFs exportables — formato correcto del logo | Exportación PDF | 🟢 Baja |

---

## 1. Herramienta de etiquetas — rediseño
**Prioridad:** 🟡 Media · **Área:** Etiquetas

**Problema**
- La herramienta de etiquetas no funciona.
- Está mal diseñada: el buscador no tiene sentido para el caso de uso.

**Resultado esperado**
- Herramienta funcional para generar/imprimir etiquetas.
- Buscador coherente con cómo el usuario realmente busca un producto/lote.

**Criterios de aceptación**
- [ ] Definir el caso de uso real de la herramienta (qué se etiqueta y desde dónde).
- [ ] Buscador alineado a la regla de buscadores con dropdown del proyecto.
- [ ] Generar/imprimir etiquetas sin error.

> La impresión de etiquetas en recepción ya quedó resuelta (el QR ahora codifica el `lote_id` y la cantidad de etiquetas es editable con preset = cantidad recibida). Acá queda el rediseño de la herramienta dedicada de etiquetas.

---

## 2. Alertas de vencimiento — mostrar porcentaje del total
**Prioridad:** 🟡 Media · **Área:** Stock / Alertas

**Problema**
- Hoy salta la alarma aunque venza solo 1 de 100 unidades/reacciones.
- No se distingue una urgencia real de un vencimiento marginal.

**Resultado esperado**
- La alerta muestra qué porcentaje del total es lo que vence más próximo.
- Ejemplo: "1% del total vence en X días".

**Criterios de aceptación**
- [ ] La alerta indica el porcentaje del total que está por vencer.
- [ ] Se muestra la ventana de tiempo asociada (en X días).
- [ ] Decidir si el porcentaje afecta también el umbral/severidad de la alerta.

---

## 3. Configuración — personalizar login (nombre del laboratorio + imagen)
**Prioridad:** 🟢 Baja · **Área:** Configuración

**Problema**
- El nombre del laboratorio y la imagen del login están fijos.
- No se pueden personalizar desde la app.

**Resultado esperado**
- El panel de Configuración permite cambiar el nombre del laboratorio que se muestra en el login.
- También permite cambiar la imagen del login, para personalizar a futuro.

**Criterios de aceptación**
- [ ] El nombre del laboratorio es editable desde Configuración y se refleja en el login.
- [ ] La imagen del login es configurable desde Configuración.
- [ ] Los valores persisten y se aplican sin reiniciar.

---

## 4. PDFs exportables — formato correcto del logo
**Prioridad:** 🟢 Baja · **Área:** Exportación PDF

**Problema**
- En los PDF exportables, el logo se ve mal puesto / sin formato definido.

**Resultado esperado**
- En todos los PDF exportables donde aparezca el logo, se ve correctamente.
- El logo tiene un formato/posición definida y consistente entre documentos.

**Criterios de aceptación**
- [ ] Inventariar qué PDF exportables incluyen logo.
- [ ] Definir formato y posición estándar del logo.
- [ ] El logo se ve bien y consistente en todos los PDF.

> Relacionado con el pendiente #3 (la imagen/logo configurable podría alimentar estos PDF).

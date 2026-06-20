# Pendientes

Lista de tareas a trabajar más adelante. Solo registro — sin diseño ni implementación todavía.

Cada ítem describe el **problema** y el **resultado esperado**, no la solución técnica.
La prioridad es una sugerencia para ordenar el trabajo, no un compromiso.

**Prioridad:** 🔴 Alta · 🟡 Media · 🟢 Baja

| # | Pendiente | Área | Prioridad |
|---|-----------|------|-----------|
| 1 | ✅ Herramienta de etiquetas — rediseño | Etiquetas | 🟡 Media |
| 2 | ✅ Alertas de vencimiento — mostrar % del total | Stock / Alertas | 🟡 Media |
| 3 | ✅ Configuración — personalizar login (nombre + imagen) | Configuración | 🟢 Baja |
| 4 | ✅ PDFs exportables — formato correcto del logo | Exportación PDF | 🟢 Baja |

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
- [x] Definir el caso de uso real de la herramienta (qué se etiqueta y desde dónde).
  → **Reimprimir etiqueta de un lote en stock** (etiqueta perdida/dañada). QR = lote_id.
- [x] Buscador alineado a la regla de buscadores con dropdown del proyecto.
  → Buscador por PRODUCTO con dropdown navegable por teclado (↑↓ Enter Esc, click-fuera, scroll).
- [x] Generar/imprimir etiquetas sin error.
  → Reusa `lib/label-print.ts` vía `LabelsSection` (rollo/hoja, cantidad por lote). Se eliminó el
    `PrintDialog`/`canvas` roto que imprimía en blanco y los 6 componentes del diseño viejo.

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
- [x] La alerta indica el porcentaje del total que está por vencer.
- [x] Se muestra la ventana de tiempo asociada (en X días).
- [x] Decidir si el porcentaje afecta también el umbral/severidad de la alerta.
  → Decisión: **informa + reordena**. El % NO suprime ni cambia el umbral (nada se oculta);
    dentro de los buckets de vencimiento las alertas se ordenan por % desc (lo que más vence, primero).

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
- [x] El nombre del laboratorio es editable desde Configuración y se refleja en el login.
  → El login lee `GET /api/v1/branding` (endpoint **público**, sin auth) y usa `nombre_laboratorio`.
- [x] La imagen del login es configurable desde Configuración.
  → Nueva clave `login_imagen_base64` (separada del logo de PDFs). Uploader dedicado en Configuración;
    se muestra como fondo del panel de login (fallback a `fondo-login.gif` si está vacía).
- [x] Los valores persisten y se aplican sin reiniciar.
  → Persisten en la tabla `configuracion`; el login los toma en cada carga vía el endpoint público.

> El endpoint `/configuracion` exige auth y devuelve secretos (API keys IA/WhatsApp), por eso se agregó
> `/branding` público que expone **solo** nombre + imagen del login.

---

## 4. PDFs exportables — formato correcto del logo
**Prioridad:** 🟢 Baja · **Área:** Exportación PDF

**Problema**
- En los PDF exportables, el logo se ve mal puesto / sin formato definido.

**Resultado esperado**
- En todos los PDF exportables donde aparezca el logo, se ve correctamente.
- El logo tiene un formato/posición definida y consistente entre documentos.

**Criterios de aceptación**
- [x] Inventariar qué PDF exportables incluyen logo.
  → Stock, Conteo y Solicitud ya lo mostraban (deformado); Descarte no lo recibía. Ahora los 4 lo usan.
- [x] Definir formato y posición estándar del logo.
  → Helper único `lib/pdf-logo.ts` (`drawPdfLogo`): preserva aspect ratio, centra el logo en una caja
    fija y detecta el formato con `getImageProperties`. Causa raíz del "mal puesto": todos estiraban
    el logo a un cuadrado.
- [x] El logo se ve bien y consistente en todos los PDF.

> Relacionado con el pendiente #3 (la imagen/logo configurable alimenta estos PDF).

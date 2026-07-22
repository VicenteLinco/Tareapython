# Propuesta de Evolución del Importador Masivo v3.0 (Estándar Pro: Linear / Retool / Flatfile)

## 1. ¿Qué Quitamos y Simplificamos? (-)

1. ❌ **Eliminación del Modal Flotante "Explorar CSV"**:
   - *Razón*: Abrir un modal sobre otro modal interrumpía la concentración del usuario.
   - *Solución*: Se reemplaza por una **Barra Inferior Colapsable de Inspección Rápida ("Raw Data Drawer")** directamente en la pantalla de mapeo.

2. ❌ **Eliminación de la Vista Única de 24+ Tarjetas Gigantes**:
   - *Razón*: Exceso de scroll vertical para usuarios avanzados con muchos campos.
   - *Solución*: Se implementa un **Conmutador de Vista**:
     - 🎴 **Vista de Tarjetas**: Detallada e intuitiva para usuarios novatos.
     - 📊 **Vista de Matriz Compacta (Table Matrix)**: Tabla condensada de 1 sola mirada para usuarios pro.

3. ❌ **Eliminación de Texto Informativo Redundante**:
   - *Razón*: Ocupaba espacio útil en pantallas pequeñas.
   - *Solución*: Los consejos y formatos permitidos se trasladan a **Tooltips interactivos** (`<Info />` al pasar el mouse).

---

## 2. ¿Qué Añadimos? (+ Nuevas Funciones)

1. ✨ **Detección Automática de Duplicados & Política de Sobrescritura**:
   - Detecta cuántos productos del CSV ya existen en la base de datos (por SKU / `codigo_interno` o `nombre`).
   - Interruptor configurable:
     - `[ ] Ignorar existentes (Omitir colisiones por SKU)`
     - `[x] Actualizar existentes si el SKU ya existe`

2. ✨ **Creación de Campo Personalizado Inline ("+ Crear Nuevo Campo")**:
   - Si el CSV trae una columna como "Registro Sanitario ISP" que no existe en el sistema, la opción desplegable incluye:
     `+ Crear "Registro Sanitario ISP" como nuevo campo del laboratorio`
   - Permite crearlo al instante sin perder el progreso de importación.

3. ✨ **Diagnóstico AI & Auto-Doctor (1-Click Auto-Fix)**:
   - Botón inteligente que analiza los errores de la vista previa y ejecuta correcciones automáticas en lote:
     - Elimina espacios en blanco.
     - Parsea formatos de fecha no estándar.
     - Convierte valores "S/N" a booleanos válidos.
     - Rellena unidades por defecto para filas sin especificar.

4. ✨ **Filtros Avanzados en Vista Previa**:
   - Pestañas con contadores en tiempo real:
     - `Todas las Filas (50)`
     - `Válidas (48)`
     - `Con Observaciones (2)`
     - `Modificadas Inline (3)`

---

## 3. Nuevos Botones y Acciones Rápidas

| Botón / Control | Ubicación | Función |
| :--- | :--- | :--- |
| **🎴 Tarjetas vs 📊 Matriz** | Paso 2 (Mapeo) | Alterna entre la vista detallada por tarjetas y la tabla condensada. |
| **✨ Auto-Mapear Todo** | Paso 2 (Mapeo) | Re-ejecuta el algoritmo de automapeo inteligente con puntajes de confidencia. |
| **🧹 Limpiar Opcionales** | Paso 2 (Mapeo) | Desasigna todos los campos opcionales con 1 clic para importar solo lo obligatorio. |
| **➕ Crear Campo Inline** | Dropdown Mapeo | Crea un nuevo `lab_campo` sin salir del asistente. |
| **⚡ Asistente Auto-Doctor** | Paso 3 (Preview) | Ejecuta reglas de auto-limpieza en lote sobre filas con errores. |
| **📥 Descargar Reporte CSV** | Paso 3 (Preview) | Descarga un CSV con únicamente las filas fallidas y su columna de motivo. |

---

## 4. Plan de Implementación de Código
- Actualizar `codigofuente/frontend/src/pages/setup/smart-importer.tsx` con el selector de vista (Tarjetas vs Matriz Compacta), creación inline de campos, inspección colapsable y auto-doctor.
- Verificar con los 85 tests unitarios en `vitest`.

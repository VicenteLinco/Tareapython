# Diseño e Implementación de Importador Masivo de Nivel Líder de Mercado (Benchmark: Flatfile, Airtable, Retool, Linear)

## Resumen Ejecutivo

Para transformar el importador masivo en un estándar internacional de nivel **Flatfile / Retool / Airtable**, este diseño evoluciona el flujo de importación de 3 pasos estáticos a un **asistente interactivo de limpieza, pegado directo y auto-corrección visual en tiempo real**.

---

## 1. Análisis Benchmark de los Mejores Importadores del Mercado

| Característica | Estado Anterior | Estándar Líder (Flatfile / Retool) | Solución Implementada |
| :--- | :--- | :--- | :--- |
| **Origen de datos** | Solo selección de archivo `.csv` | Carga de archivo + **Pegado directo (Ctrl+V / Clipboard)** desde Excel / Google Sheets | **Soporte Híbrido**: Archivo CSV/TSV + Área de pegado directo desde portapapeles |
| **Mapeo de columnas** | Dropdown simple por campo | **Confidencia % visual** (Match Exacto, Sugerido, Sin Mapear) + Filtros de búsqueda rápidos | **Smart Auto-Mapping con badge de confianza %** y sugerencias semánticas |
| **Edición en Vista Previa** | Tabla de solo lectura | **Grid interactivo tipo planilla con edición celular en caliente** y revalidación instantánea | **Grid editable en vivo**: Clic en celda para corregir errores sin volver a subir el archivo |
| **Auto-corrección inteligente** | Manual campo por campo | **Transformadores con 1-Click**: Normalización de booleans, trim de espacios, mayúsculas y fechas ISO | **Barra de Asistentes Rápidos (Auto-Cleaning Toolbox)** |
| **Manejo de Errores** | Lista de texto estática abajo | **Filtros por celda en la tabla**, resumen pre-flight con gráficos de preparación y descarga de filas fallidas | **Panel Pre-Flight de Salud de Datos** con filtro "Solo Errores" y corrección celular |

---

## 2. Pilares de la Nueva Experiencia de Usuario (UX/UI)

### A. Carga de Datos Multiorigen (File + Pegado Directo)
- **Zona Drop & Paste**: Permite arrastrar `.csv` / `.tsv` o simplemente presionar `Ctrl+V` dentro de la zona de carga para pegar directamente un rango copiado desde Excel o Google Sheets.

### B. Mapeo Asistido con Puntaje de Confianza %
- **Badge de Confianza**: Muestra coincidencias con badges de color:
  - 🟢 **100% Match Exacto**: Ej. `nombre` -> `nombre`.
  - 🔵 **90% Match Sugerido**: Ej. `Cod. Interno` -> `codigo_interno`.
  - 🟡 **Sin Mapear**: Mapeos sugeridos pendientes para revisión manual.

### C. Grid de Vista Previa Interactivo con Edición en Caliente (Hot-Cell Editing)
- Celdas con error destacadas con indicador rojo interactivo.
- Al hacer clic en una celda con error en la vista previa, se abre una micro-edición donde el usuario escribe el valor correcto y los errores se re-calculan en tiempo real.

### D. Asistente de Auto-Limpieza 1-Click (Quick Clean Toolbox)
- **Limpiar espacios en blanco** (Trim).
- **Normalizar fechas** (`DD/MM/YYYY` -> `YYYY-MM-DD`).
- **Normalizar booleanos** (`Si`, `S`, `YES`, `1` -> `true`).
- **Capitalizar nombres de producto**.

### E. Dashboard Pre-Flight de Calidad de Datos
- **Medidor de preparación**: Muestra % de filas listas para importar (ej. `95% Listas`).
- **Filtros de vista previa**: Alternar entre "Todas las filas" y "Solo celdas con errores".
- **Exportación de descarte**: Descargar solo las filas con error en un archivo CSV independiente para trabajarlas fuera si el usuario lo prefiere.

---

## 3. Plan de Código y Archivos a Modificar

1. `codigofuente/frontend/src/pages/setup/smart-importer.tsx`: Refactorización completa del flujo con pegado de portapapeles, confidencia %, grid celular editable y auto-limpieza 1-click.
2. `codigofuente/frontend/src/pages/setup/smart-importer.test.tsx`: Tests unitarios actualizados y ampliados.

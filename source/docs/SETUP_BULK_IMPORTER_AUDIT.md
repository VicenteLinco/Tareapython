# Auditoría del importador masivo de productos en `/setup`

## Resumen ejecutivo

El importador actual permite mapear columnas, validar antes de importar y ejecuta la carga real dentro de una transacción atómica. Sin embargo, **el CSV de ejemplo de productos no representa el contrato real**: descarga solo encabezados, no incluye ninguna fila de ejemplo y cubre 7 de los 23 campos base que la interfaz permite mapear.

Existen rutas de **pérdida silenciosa de datos**:

- `stock_minimo` se interpreta, pero no se persiste.
- `precio_unitario` puede quedar sin efecto si no existe la combinación necesaria de proveedor y presentación.
- Valores desconocidos de booleanos terminan como `false`, y un `control_lote` desconocido termina como `con_vto`.

La plantilla, el mapeo del frontend y el contrato del backend evolucionan por separado. La recomendación es corregir primero la plantilla y los silencios de persistencia, endurecer validaciones y límites del endpoint directo, y después unificar el contrato alrededor de `/productos/schema`. No conviene migrar todavía a `/setup/import-batches`: aún no alcanza paridad con Campos Lab ni encabezados anotados.

## Alcance y limitación de producción

El análisis se realizó sobre la fuente actual mediante CodeGraph. No fue posible verificar en vivo DOM, estado HTTP ni bundle de `https://inventariocunco.onrender.com/setup`: el navegador rechazó el host y el sandbox impidió ejecutar `curl`. Los riesgos de Excel chileno son inferencias del parser y deben revalidarse en producción con sesión de administrador.

## Flujo actual confirmado

1. `SmartImporter` obtiene Campos Lab activos con alcance `producto`.
2. Genera un `Blob` y descarga `plantilla-productos.csv`.
3. El archivo debe terminar exactamente en `.csv`.
4. El parser admite coma, comillas, LF/CRLF y elimina BOM solo del primer encabezado.
5. El frontend automapea mediante claves o coincidencias parciales.
6. Preview: `POST /setup/importar-productos` con `dry_run: true`.
7. Importación: mismo endpoint con `dry_run: false`.
8. El backend valida y persiste dentro de una transacción atómica.

Este flujo no usa `/setup/import-batches`.

## Contrato CSV real

### Obligatorios

- `nombre`.
- Cada `lab_<uuid>` activo, alcance `producto`, marcado requerido.

### Opcionales y alias

- `descripcion`
- `codigo_interno`
- `unidad` / `unidad_base`
- `unidad_plural` / `unidad_base_plural`
- `stock_minimo` / `stock_seguridad`
- `precio_unitario` / `precio_unidad`
- `contenido` / `factor_conversion`
- `codigo_proveedor`
- `proveedor`
- `categoria`
- `promedio_uso_mensual_inicial`
- `control_lote`
- `ubicacion`
- `temperatura_almacenamiento`
- `requiere_cadena_frio`
- `dias_estabilidad_abierto`
- `clase_riesgo`
- `fabricante`
- `mpn`
- `alias_unidad_clinica`
- `es_kit`
- `codigo_loinc_cpt`

### Campos Lab

```text
lab_<uuid> [nombre=<nombre>; tipo=<tipo>; requerido=<si|no>; opciones=<valor1|valor2>]
```

## CSV descargados

### Productos, sin Campos Lab

```csv
nombre [tipo=texto; requerido=si],unidad [tipo=texto; requerido=no],descripcion [tipo=texto; requerido=no],codigo_interno [tipo=texto; requerido=no],categoria [tipo=texto; requerido=no],proveedor [tipo=texto; requerido=no],precio_unitario [tipo=decimal; requerido=no]
```

Tiene una sola línea, 7/23 campos base y 0 filas de ejemplo.

### Stock

```csv
producto_nombre_o_codigo,numero_lote,fecha_vencimiento,area,cantidad,costo_unitario
Guante de látex talla S,LOT-2024-001,2026-12-31,Urgencias,200,4500
Tubo vacutainer EDTA 3mL,LOT-2024-002,2026-06-30,Hematología,500,350
```

La plantilla de stock no crea productos; exige que puedan resolverse previamente por nombre o código.

## Hallazgos priorizados

### P0

1. **Plantilla inutilizable como ejemplo**
   - Impacto: el usuario debe adivinar formatos y dependencias.
   - Evidencia: 7/23 campos y 0 filas.
   - Aceptación: variantes mínima/completa, fila didáctica y prueba de contrato.

2. **`stock_minimo` descartado**
   - Impacto: umbral de reposición ausente pese a importación exitosa.
   - Evidencia: se interpreta como `_stock_minimo` y no se persiste.
   - Aceptación: persistencia exacta o eliminación temporal del contrato.

3. **`precio_unitario` silencioso**
   - Impacto: productos creados sin precio esperado.
   - Evidencia: depende de proveedor y presentación sin diagnóstico claro.
   - Aceptación: persistir o devolver error/advertencia explícita.

4. **Endpoint directo sin límites**
   - Impacto: consumo excesivo de memoria/CPU.
   - Evidencia: no aplica 5 MiB, 5000 filas, 64 columnas ni 4 KiB/celda del flujo durable.
   - Aceptación: rechazo temprano y pruebas de borde.

### P1

1. **Colisiones de automapeo**
   - Casos: `codigo_proveedor`/`proveedor`, `unidad_plural`/`unidad`, `alias_unidad_clinica`/`unidad`.
   - Aceptación: coincidencia exacta y alias primero; una columna, un destino; ambigüedad visible.

2. **Tres contratos divergentes**
   - `TEMPLATE_BASE_COLUMNS`, campos/mapping frontend y registry/backend.
   - Aceptación: plantilla, mapeo y validación derivados de `/productos/schema`.

3. **Defaults permisivos**
   - Booleanos desconocidos → `false`; `control_lote` desconocido → `con_vto`.
   - Aceptación: errores por fila/columna para tokens desconocidos.

4. **Compatibilidad Excel frágil**
   - Solo coma, extensión case-sensitive y tratamiento limitado de BOM.
   - Aceptación: política explícita para `.CSV`, BOM y delimitador `;`.

### P2

1. **Migración durable prematura**
   - `import-batches` no soporta `lab_<uuid>`, encabezados anotados y normaliza mal claves con guion bajo.
   - Aceptación: demostrar paridad completa antes de migrar.

2. **Confusión catálogo vs. stock**
   - Aceptación: nombres, ayuda y orden de carga claramente diferenciados.

## Históricos ya corregidos

No presentar como defectos vigentes:

- Campos Lab con alcance producto.
- Atomicidad de importación directa.
- Manejo de `PRODUCT_NOT_READY` en stock.
- Existencia de rutas durable.

## Propuesta de plantillas

### Mínima

```csv
nombre
Producto de ejemplo
```

Con Campo Lab requerido, usar el UUID real:

```csv
nombre,"lab_<UUID_CAMPO_LAB> [nombre=<NOMBRE_CAMPO>; tipo=texto; requerido=si]"
Producto de ejemplo,<VALOR_CAMPO_LAB>
```

### Completa

```csv
nombre,descripcion,codigo_interno,unidad,unidad_plural,stock_minimo,precio_unitario,contenido,codigo_proveedor,proveedor,categoria,promedio_uso_mensual_inicial,control_lote,ubicacion,temperatura_almacenamiento,requiere_cadena_frio,dias_estabilidad_abierto,clase_riesgo,fabricante,mpn,alias_unidad_clinica,es_kit,codigo_loinc_cpt,"lab_<UUID_CAMPO_LAB> [nombre=<NOMBRE_CAMPO>; tipo=texto; requerido=no]"
Reactivo de ejemplo,Descripción de ejemplo,SKU-EJ-001,unidad,unidades,10,1250,1,PROV-EJ-001,Proveedor de ejemplo,Reactivos,5,simple,Estante A,Ambiente,no,30,Clase I,Fabricante de ejemplo,MPN-EJ-001,Alias clínico,no,COD-EJ-001,<VALOR_CAMPO_LAB>
```

## Plan por fases

1. Corregir plantilla, `stock_minimo`, `precio_unitario` y pruebas de contrato.
2. Corregir automapeo, tipos, límites y compatibilidad CSV.
3. Unificar mediante `/productos/schema`.
4. Lograr paridad y recién entonces evaluar `import-batches`.

## Matriz mínima de aceptación

- [ ] Plantilla mínima parseable y con fila didáctica.
- [ ] Plantilla completa con 23 claves base exactamente una vez.
- [ ] Campos Lab requeridos incluidos con UUID real.
- [ ] `stock_minimo=10` persistido como 10.
- [ ] Precio sin dependencias: error o advertencia bloqueante.
- [ ] Sin colisiones entre proveedor/unidad/alias.
- [ ] Booleanos y `control_lote` desconocidos: error.
- [ ] BOM, `.CSV` y `;`: comportamiento documentado y probado.
- [ ] Límites 5 MiB/5000/64/4 KiB aplicados.
- [ ] Una fila inválida no deja persistencia parcial.
- [ ] Recorrido admin completo en Render después de desplegar.

## Archivos relevantes

- `codigofuente/frontend/src/pages/setup/smart-importer.tsx`
- `backend/src/services/setup_service.rs`
- `backend/src/services/product_contract.rs`
- `backend/src/handlers/productos.rs`
- `backend/src/handlers/import_batches.rs`
- `backend/tests/setup_test.rs`

## Decisión recomendada

Corregir primero el contrato descargable y las dos rutas de pérdida silenciosa. Consolidar esquema y validaciones después. La migración durable debe esperar paridad demostrada.

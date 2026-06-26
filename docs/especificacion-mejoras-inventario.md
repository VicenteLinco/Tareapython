# Plan de Especificaciones de Alto Nivel: Refinamiento Visual, UX y Modelo de Datos

## 1. Visión y Objetivos del Sistema
El sistema de inventario debe ser una herramienta de "cero fricción" para el trabajo clínico diario. El objetivo es eliminar formularios estáticos, reemplazándolos por interacciones guiadas por hardware (escáner) y retroalimentación visual clara. El sistema debe hablar el idioma del laboratorio (ej. "Reacciones", "Determinaciones") para anular el esfuerzo cognitivo de la traducción mental.

## 2. Arquitectura de Despliegue y Packaging
* **Problema Original:** Redundancia de contenedores (`Dockerfile.backend`, `Dockerfile.render`) y desconexión con el frontend en desarrollo local.
* **Solución:** Consolidar en un único `Dockerfile` multi-etapa que compile Vite (React) y Rust. Axum sirve los estáticos compilados en `/static`. El `docker-compose.yml` usará exclusivamente esta imagen para empaquetar toda la solución (Frontend + Backend) en un solo comando.

## 3. Rediseño y Simplificación de la Base de Datos (Modelo de Producto)

Actualmente, la tabla `productos` sufre de sobrecarga arquitectónica: mezcla la identidad clínica del insumo con sus datos logísticos, comerciales y de empaque en una sola entidad. 

### A. Fase 1 de Discusión: Definición Estricta (Qué entra y qué sale)
Antes de escribir cualquier esquema, el equipo debe acordar la ontología del inventario respondiendo a estas premisas:
1. **Lo que SALE del Producto Base:** Proveedores, Precios, Códigos de Barras de la caja (GTIN) y Factor de Conversión (cuánto trae la caja). Estos son datos comerciales volátiles que pertenecen a una capa logística y ensucian los históricos si se atan a la identidad médica.
2. **Lo que SE QUEDA en el Producto Base:** Nombre, Fabricante, MPN (Manufacturer Part Number), Restricciones físicas (control de lote, cadena de frío, clase de riesgo).
3. **Atributos UX (Nuevos):** `alias_unidad_clinica` ("Determinaciones", "Reacciones") para que el sistema le hable al profesional en su idioma diario.

Con estas reglas definidas, el modelo se **normaliza** dividiendo el concepto en dos tablas físicas:

### B. Entidad Core: `productos` (Identidad Clínica Pura)
Representa exclusivamente lo que el reactivo *es*, aislando los datos del proveedor o empaque. Según la definición validada con el usuario, la ficha clínica incluirá:
* `nombre` / `descripcion`
* `fabricante` y `mpn` (Referencia global del fabricante, clave para la trazabilidad).
* `alias_unidad_clinica`: (ej. "Reacciones", "Puntas"). 
* `control_lote`: (trazable | simple). Define las restricciones operativas.
* `es_kit`: (Booleano). Gatilla la revisión de dependencias.
* `stock_minimo_global`: (Punto de reorden). Nivel base para disparar alertas de compra.
* `codigo_loinc_cpt`: Estándar internacional para vincular el gasto de inventario con la facturación médica al paciente (Preparado para HIS/LIS).
* `dias_estabilidad_abierto`: Vida útil del reactivo tras ser abierto en la máquina (On-board stability).
* `etiqueta_bioseguridad`: Clasificación de riesgo físico (Corrosivo, Peligro Biológico, Inflamable).
* `temperatura_almacenamiento` y `cadena_de_frio`.
*(Nota: Se descartaron 'Frecuencia de Calibración' y 'Bloqueo por QC' para evitar sobre-burocratizar el uso).*

### C. Entidad Comercial: `producto_presentaciones` (Lo que se compra)
Un mismo reactivo (ej. Creatinina) puede adquirirse en caja de 100 a un proveedor local, o en caja de 500 importada. Según la definición validada, esta tabla debe contener los 4 pilares:
* `producto_id` (Llave foránea al producto core).
* `proveedor_id` y `sku_proveedor`.
* `factor_conversion`: Numérico (ej. 1 caja = 100 determinaciones).
* `gtin`: Código de barras global GS1 de esa caja exacta.
* `precio_adquisicion`: Permite costear financieramente el ingreso.

## 4. Diseño Visual y Simplificación de Flujos (UX)

### A. Flujo "Scanner-First" (Zero-Click Output)
* **El Problema:** Seleccionar área, producto, lote y motivo toma tiempo clínico valioso.
* **Diseño Visual:** La pantalla principal de "Salidas" debe ser minimalista: un campo de escaneo gigante, activo por defecto, centrado en la pantalla, y un historial reciente debajo.
* **El Flujo:**
  1. El profesional escanea un código (QR GS1 o código interno).
  2. El sistema identifica el producto. Asume "Uso Médico" por defecto.
  3. Muestra una notificación temporal tipo Toast o Tarjeta flotante verde: *"✅ 1 Determinación de Glucosa descontada. Quedan 149."*
  4. Fin del flujo. ¡Cero clics!
* **Manejo de Excepciones:** Si el producto está dañado o vencido, la tarjeta flotante incluye un botón de "Opciones / Editar Motivo". Si es un producto sin código, se habilita una barra de búsqueda rápida.

### B. Consumo Fluido de Productos Simples
* **Diseño Visual:** En inventario, los productos con `control_lote = 'simple'` ocultan por completo los selectores o tablas de lotes. Su stock es un número grande y limpio.
* **El Flujo:** Al retirar jeringas o gasas (no escaneables por unidad), se usa un modelo "tipo carrito". Un cuadro con botones grandes de `+` y `-` rápidos, o input manual numérico directo y "Confirmar". El backend se encarga de aplicar FEFO silenciosamente.

### C. Alertas de Cuellos de Botella (Dependencias Viscerales)
* **Diseño Visual:** En la ficha del producto principal (ej. Kit VIH), reemplazar las tablas grises por indicadores de "Salud del Reactivo". Utilizar un Anillo de Progreso (Donut Chart). Si hay 100 reacciones pero buffers para 20, el anillo muestra 20% lleno y 80% en rojo advertencia.
* **El Flujo:** La alerta incluye un botón de acción rápida: *"👉 Agregar déficit (80 Buffers) al carrito de compras"*.

### D. Solicitud de Compra (Forecast Conectado)
* **Diseño Visual:** Las sugerencias de compra muestran jerarquía. El reactivo principal es la tarjeta "Padre", y los consumibles correlacionados sugeridos (Demanda Inducida) aparecen indentados debajo ("Tarjetas Hijo").
* **El Flujo:** Un *toggle* general "Incluir accesorios recomendados". Si se enciende, recalcula las cantidades de diluyentes automáticamente en base al pedido del principal.

### E. Responsive Design y Corrección de Overflows (Visibilidad Completa)
* **El Problema:** Actualmente hay elementos, especialmente tablas en listas (`stock-list.tsx`) y dentro de modales (`detalle-modal.tsx`), que se cortan u ocultan en pantallas menores debido a la falta de reglas de contención y *scroll* horizontal.
* **Solución Técnica Visual:**
  * **Tablas fluidas:** Envolver TODAS las etiquetas `<table>` (especialmente en vistas de stock y modales de detalles) en contenedores con `overflow-x-auto w-full min-w-0` para garantizar que el usuario pueda hacer *scroll* horizontal en pantallas pequeñas sin romper la interfaz.
  * **Modales adaptativos:** Los componentes `<Dialog>` deben incluir límites elásticos (`max-w-full md:max-w-4xl`), para asegurar que no se salgan de los bordes del dispositivo.
  * **Truncado seguro:** Usar `truncate` o `break-words` sistemáticamente en columnas de texto largo (como nombres o códigos GTIN) para que no fuercen anchos imposibles.

### F. Jerarquía Visual y Arquitectura de la Información
* **El Problema:** Existen vistas donde la información clave compite visualmente con los metadatos secundarios, creando una interfaz "plana" que fatiga al usuario al obligarlo a buscar los datos importantes.
* **Solución Técnica Visual:**
  * **Regla del Escaneo Rápido (Z-Pattern):** El nombre del producto (Tipografía: `text-lg font-bold`) y la métrica principal (Stock Restante en `text-2xl font-black`) deben ser los elementos con mayor peso visual.
  * **Metadatos Agrupados y Atenuados:** La información secundaria (marca, código interno, MPN) debe agruparse bajo el título usando menor contraste (`text-xs opacity-50 font-mono`). Ejemplo: `Roche | Ref: 044123 | Código: GLU-01`.
  * **Reserva de Color:** El color (rojo, amarillo, azul/primario) debe reservarse **exclusivamente** para estados accionables y alertas (Status Badges, botones). Todo el texto estructural debe usar la escala `base-content`.
  * **Layout en Tarjetas:** Separar la información estática del producto de la información dinámica (lotes, movimientos) usando sub-tarjetas o paneles con fondos diferenciados (`bg-base-200/50`).

## 5. Seguridad y Mecanismos Anti-Fricción
* **Trazabilidad Silenciosa:** Cada acción guarda el `usuario_id` capturado del token JWT, sin que el usuario lo vea ni lo llene.
* **Flujo "Undo" (Estilo Gmail):** Después de un escaneo (salida), aparece un botón amarillo "Deshacer" flotante durante 10 segundos. Si se hace clic, genera un registro de "Ajuste por Error de Escaneo" para revertir el balance sin corromper el ledger inmutable.

## 6. Plan de Ejecución Fases

| Fase | Ámbito | Descripción | Nivel de Impacto |
|---|---|---|---|
| **Fase 1** | **DevOps & BD** | Consolidar Dockerfiles. Recrear esquema normalizado desde cero (`productos` y `producto_presentaciones`) aprovechando la etapa de desarrollo. | Cimientos (Rápido) |
| **Fase 2** | **Backend Core & Rendimiento** | Implementar consumo FEFO automático, inmutabilidad y Vistas Materializadas para el cálculo rápido de Stock Útil. | Crítico |
| **Fase 3** | **UX Core & Offline** | Corrección masiva de overflows, vista Scanner-First y Service Workers para PWA (modo sin conexión). | Muy Alto (UX) |
| **Fase 4** | **Gestión e Interoperabilidad** | Forecast visual y construcción del Bus de Integración (Broker HL7/GS1) para automatización silenciosa. | Crítico (Escala) |

## 7. Estándares de Calidad Internacionales (Migración a HL7 y GS1)

Para que el sistema clasifique como software de salud de "Clase Mundial", la hoja de ruta debe prever la adopción de los siguientes estándares:

### A. Estándar GS1 (Trazabilidad Logística Automatizada)
* **Diagnóstico actual:** Escanear códigos de barra simples asume un producto, pero obliga al usuario a llenar lote y fecha a mano (potencial de error).
* **El Salto de Calidad (GS1 DataMatrix):** Los reactivos clínicos traen códigos GS1 2D. El escáner intercepta la cadena e internamente el software la "desglosa" usando Identificadores de Aplicación (AIs).
* **Resultado UX:** Un solo escaneo detecta simultáneamente: `(01) GTIN del Producto` + `(10) Lote exacto` + `(17) Fecha de Expiración` + `(21) Número de Serie`. El formulario de ingreso se llena en 0.5 segundos con cero probabilidad de error.

### B. Estándar HL7 / FHIR (Interoperabilidad Clínica)
* **Diagnóstico actual:** La "salida" del inventario depende de la acción humana o de escanear la caja cuando se desecha o se abre.
* **El Salto de Calidad (Silicium Consumption):** Conectar el software al LIS (Laboratory Information System) existente en el centro de salud mediante HL7 v2 (Mensajes ORM/ORU) o FHIR.
* **Resultado UX:** Cuando el analizador bioquímico procesa una muestra de un paciente, el LIS emite un pulso HL7. Nuestro inventario lo intercepta, comprende que se gastó "1 Determinación de Glucosa" y descuenta automáticamente el stock usando el algoritmo FEFO interno. **El acto de "Consumir" se vuelve invisible y 100% automático**, reservando los escaneos humanos únicamente para ingresos, descartes por daño o carga de máquinas.

## 8. Análisis Crítico: Puntos Ciegos y Mitigación de Riesgos (Arquitectura)

Un análisis profundo del plan original revela las siguientes fallas críticas o cuellos de botella que deben corregirse para no colapsar la operación del laboratorio:

### A. Falla original mitigada: Pérdida de Datos en la Normalización
* **El Contexto:** Propusimos dividir la tabla `productos` en `productos` y `producto_presentaciones`. En un entorno de producción, esto requeriría un script de migración *Two-Step* extremadamente delicado.
* **La Ventaja Actual (Fase de Desarrollo):** Como el sistema aún no está liberado y los datos actuales son de prueba, podemos ignorar la complejidad de la migración de datos. Se ejecutará un "Drop & Recreate" (borrado y recreación) del esquema desde cero. Esto acelera drásticamente el desarrollo de la Fase 1.

### B. Falla: Dependencia de Red en el Escáner (Riesgo Operativo)
* **El Problema:** La vista "Scanner-First" asume que el backend responde en milisegundos. Si el Wi-Fi de la bodega fluctúa, el escáner se trabará, parando el despacho clínico.
* **La Solución:** Convertir el Frontend en una PWA (Progressive Web App) con **Service Workers** e IndexedDB. Si se pierde la conexión, el escáner guarda los consumos en una "Cola Offline" local y sincroniza automáticamente en background cuando vuelve el Wi-Fi.

### C. Falla: Colapso de Rendimiento por Dependencias (Riesgo de BD)
* **El Problema:** Calcular el "Stock Útil Real" calculando recursivamente la división entre el reactivo principal y sus 5 buffers secundarios *en tiempo real por cada carga de pantalla* va a destruir el rendimiento de la base de datos a medida que crezcan los movimientos históricos.
* **La Solución:** Patrón CQRS o Vistas Materializadas. El stock calculado se guarda en caché o en una tabla de lectura rápida, y solo se recalcula asíncronamente (Background Job) cuando ocurre un movimiento.

### D. Falla: Complejidad Oculta en HL7 (Riesgo de Integración)
* **El Problema:** Asumir que HL7 es "solo un endpoint" es ingenuo. Los mensajes HL7 pueden llegar desordenados o duplicados.
* **La Solución:** No construir el motor de cero. Usar un Integration Broker intermedio (como Mirth Connect) o una cola sólida de mensajes en Rust (RabbitMQ/Redis) que garantice el orden de consumo y el reintento ante fallos.

## 9. Gestión Avanzada de Lotes y Consumo (Operación Diaria)
En base a la consultoría de requerimientos, la lógica de inventario físico (la tabla `lotes` y `movimientos`) operará con reglas de nivel experto:

### A. Auto-Descarte y Tolerancia de Vencidos (Override Clínico)
* **Merma Automática:** Un proceso automático (Background Job) evaluará los lotes diariamente. Al alcanzar la caducidad, el sistema descuenta el lote automáticamente del "Stock Útil" (Baja por Vencimiento), previniendo que el stock figure falsamente como disponible.
* **Flujo de Excepción (Override Seguro):** A pesar de la merma, en el flujo de consumo existirá un *checkbox* configurable: "Permitir consumo de vencidos". Si Control de Calidad validó que el reactivo aún es funcional, activar este checkbox permite gastar el lote caducado, registrando en auditoría la excepción y el usuario responsable.

### B. Auditoría de Mermas y Ajustes (Conteo Físico)
* **Ajuste Ciego Configurable (Blind Count):** El proceso de conciliación de inventario contará con un modo de "Ajuste Ciego" (el técnico ingresa el conteo físico sin poder ver en pantalla cuánto stock dice el sistema que debería haber, forzando un conteo real). Por solicitud expresa, esta característica será un *toggle* (On/Off) en el panel de Configuraciones Generales, dando flexibilidad al laboratorio según la estacionalidad o el equipo de trabajo.

### C. Trazabilidad de Salidas (Profundidad Configurable)
Para evitar fricción en laboratorios pequeños, pero mantener la capacidad de "Clase Mundial" para grandes hospitales, la trazabilidad financiera y clínica será 100% modular mediante *toggles* en las configuraciones globales:
* **Nivel Base (Por defecto):** Requerir solo un "Motivo General" (Uso, Merma, Daño). Rápido y sin fricción.
* **Módulos Activables (Checkboxes On/Off):**
  1. Requerir Centro de Costo / Área Médica.
  2. Requerir Selección de Equipo Analizador (vital para ROI de la máquina).
  3. Requerir ID/RUT de Paciente (facturación directa).
  4. Requerir Médico Solicitante.
* **Impacto UX:** El formulario de salida "crece o se encoge" dinámicamente según estos interruptores. El software escala junto al negocio del cliente sin abrumarlo el día 1.

## 10. Arquitectura de Alto Rendimiento (Escalabilidad de Base de Datos)
Para soportar millones de movimientos y concurrencia clínica masiva, el motor de base de datos (PostgreSQL) se diseñará bajo patrones de nivel "Enterprise":

### A. Estrategia de Cálculo (CQRS-Lite)
* **Snapshot de Saldos en Vivo:** El stock de cada lote no se calcula sumando el historial al vuelo. Se utiliza una tabla "Snapshot" precalculada, garantizando consultas en milisegundos.
* **Vistas Materializadas:** Para consultas analíticas pesadas (reportes anuales de la gerencia), se usarán vistas materializadas en PostgreSQL, protegiendo así las tablas transaccionales del día a día.

### B. Prevención de Race Conditions (Bloqueo Concurrente)
Si dos tecnólogos escanean la misma caja con 1 unidad restante en el mismo milisegundo:
* **Constraint Check:** Nivel base de datos infalible que prohíbe el stock negativo matemáticamente.
* **Bloqueos Híbridos:** `SELECT FOR UPDATE` pesimista pero ultra-corto durante el descuento del ledger para encolar milimétricamente las solicitudes, y Bloqueo Optimista (versionado) para evitar sobreescritura al editar fichas de productos.

### C. Retención de Datos y particionado
* **Particionamiento Nativo:** PostgreSQL dividirá invisiblemente la tabla de `movimientos` por tiempo (Mes/Año).
* **Cold Storage (Archiving):** Data histórica mayor a 3 años migrará a almacenamiento en frío (tablas de solo lectura) para no degradar el motor principal.

### D. Optimización Quirúrgica (Índices)
* **GIN/GiST:** Índices especializados para búsquedas Full-Text, permitiendo al buscador de la interfaz encontrar reactivos por trozos de texto sin usar `LIKE '%...%'`.
* **B-Tree Compuesto:** Índice sobre `[lote_id, fecha_vencimiento]` para que el Job de Auto-Descarte opere sin estresar la memoria RAM.
* **Hash Indexes:** Acceso ultra-rápido O(1) para códigos GTIN, garantizando que el hardware de escáner tenga respuesta instantánea.

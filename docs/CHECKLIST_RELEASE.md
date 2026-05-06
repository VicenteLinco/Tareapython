# Checklist de release

## 1. Estado del repositorio

- Revisar `git status --short`.
- Confirmar que no hay cambios inesperados de otra tarea.
- Separar cambios de codigo, documentacion y archivos generados.

## 2. Backend

- Ejecutar `cargo test --no-run` en `backend/`.
- Si hay base de datos de prueba disponible, ejecutar `cargo test`.
- Revisar migraciones nuevas en `backend/migrations/`.
- Confirmar que las migraciones necesarias tambien esten en `release/migrations/` si aplica.

## 3. Frontend

- Ejecutar `npm.cmd run build` en `frontend/`.
- Ejecutar `npm.cmd run lint` en `frontend/`.
- Si lint falla por deuda conocida, registrar cantidad y archivos principales antes de liberar.
- Revisar advertencias de bundle de Vite, especialmente scanner, PDF, QR e imagenes grandes.

## 4. Pruebas manuales minimas

- Login y renovacion de sesion.
- Dashboard carga sin errores.
- Crear o editar producto.
- Registrar recepcion con lote y vencimiento.
- Imprimir o previsualizar etiquetas si aplica.
- Registrar consumo.
- Registrar descarte.
- Abrir stock y detalle de producto.
- Crear o recuperar solicitud de compra.
- Crear o continuar conteo.

## 5. Datos y trazabilidad

- Verificar que acciones criticas generen movimientos/auditoria.
- Confirmar que no se permite stock negativo.
- Confirmar que operaciones con doble click no duplican registros.
- Revisar errores visibles para usuario final.

## 6. Release local

- Compilar binario backend si corresponde.
- Copiar binario y migraciones a `release/`.
- Probar scripts `INICIAR LABORATORIO.bat` y `DETENER LABORATORIO.bat` si hubo cambios operativos.
- Verificar `.env.example` si se agregaron variables nuevas.

## 7. Riesgos conocidos

- Anotar deuda pendiente antes de entregar.
- Anotar warnings aceptados.
- Anotar pruebas que no pudieron ejecutarse y motivo.


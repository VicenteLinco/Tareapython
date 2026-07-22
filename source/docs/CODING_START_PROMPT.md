# Prompt para iniciar la implementación de producción

Copia el siguiente texto en una nueva sesión de IA:

```text
Trabaja en el checkout real de Tareapython y lee primero, de forma completa,
`source/docs/SYSTEM_PRODUCTION_READINESS_REDESIGN_SPEC.md`.

Objetivo de esta sesión:
- Implementar únicamente `WU-00` y las foundations P0 que ese work unit exige.
- NO reescribir el sistema completo ni adelantar work units dependientes.
- Mantener como autoridades `source/backend/` y `source/frontend/`; no recrear
  `backend/`, `codigofuente/`, `migrations/`, `static/` ni `scratch/` en la raíz.

Método obligatorio:
1. Usa CodeGraph antes de una exploración amplia para entender símbolos, llamadas,
   dependencias e impacto. Si falta el índice en este proyecto real, inicialízalo en
   la raíz del checkout y vuelve a consultar; no reutilices un índice de otro árbol.
2. Aplica Strict TDD en ciclos verificables RED → GREEN → REFACTOR. Registra el
   comando enfocado, la causa exacta del RED y el resultado exacto del GREEN.
3. Construye para WU-00 una base PostgreSQL efímera y desechable. El wrapper debe
   eliminar `DATABASE_URL`/dotenv heredados, crear e inyectar su propia URL y rechazar
   hosts remotos o nombres sin prefijo de test ANTES de abrir un proceso, pool o
   aplicar migraciones. Incluye un self-test con canario remoto que pruebe el rechazo.
4. Mantén cada work unit por debajo de 400 líneas cambiadas cuando sea viable. Si el
   comportamiento no cabe, divide por capacidad vertical con tests y rollback propios;
   no dividas por tipo de archivo.
5. Para cada mutación demuestra el efecto persistido: respuesta canónica, refetch/GET,
   estado de base o proyección, auditoría/correlación y rollback. Un toast, un 2xx o
   estado local por sí solos NO prueban éxito.
6. No cargues `.env`, no uses una base remota, no imprimas URLs/credenciales, no hagas
   deploy, push, tag ni publicación. Detente antes de cualquier límite inseguro.
7. Mantén migraciones exclusivamente en `source/backend/migrations/` y tooling nuevo
   en `source/tooling/`. Usa `SQLX_OFFLINE=true` para checks que no requieren DB.
8. Conserva la evidencia y el rollback boundary del work unit junto a sus pruebas.

Gate de comunicación:
- No declares que el sistema está listo para producción hasta que TODOS los criterios
  acumulativos de la sección 8.12 estén demostrados para el mismo SHA candidato.
- Al terminar WU-00, informa: tests RED/GREEN/REFACTOR, efecto persistido/refetch/audit,
  comandos exactos, archivos cambiados, riesgos pendientes y siguiente work unit.
```


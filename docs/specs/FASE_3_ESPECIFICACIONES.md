# Especificaciones Técnicas — Fase 3 (Pendientes)

**Fecha:** 2026-03-31
**Estado:** En progreso

---

## Índice

1. [Distributed Rate Limiting con Redis](#1-distributed-rate-limiting-con-redis)
2. [OpenAPI / Swagger con utoipa](#2-openapi--swagger-con-utoipa)

---

## 1. Distributed Rate Limiting con Redis

### Problema
`middleware/rate_limit.rs` usa `Arc<Mutex<HashMap<String, Vec<Instant>>>>` en memoria. Con tres instancias del backend corriendo en contenedores distintos, cada instancia mantiene sus propios contadores.

### Cuándo implementar
Solo cuando el sistema se despliegue con múltiples réplicas del backend. Para la instalación actual (una sola instancia en VPS), el rate limiter en memoria es suficiente y más simple.

### Solución propuesta
**Estrategia:** Sliding window counter con Redis usando `ZADD` + `ZCOUNT` + `EXPIRE`.

---

## 2. OpenAPI / Swagger con utoipa

### Propósito
Generar documentación interactiva de la API (Swagger UI) directamente desde el código, accesible en `/swagger-ui`.

### Dependencias
- utoipa
- utoipa-swagger-ui
(Ya agregadas al Cargo.toml)

### Tareas restantes
- [ ] Anotar handlers de Stock
- [ ] Anotar handlers de Consumos
- [ ] Anotar handlers de Recepciones
- [ ] Anotar handlers de Catálogos (áreas, productos, categorías)
- [ ] Proteger `/swagger-ui` en producción

---

## Resumen de Prioridades

| # | Item | Impacto | Esfuerzo | Prioridad |
|---|------|---------|----------|-----------|
| 1 | OpenAPI / Swagger | Bajo (DX) | Alto | 🟢 Baja |
| 2 | Redis Rate Limiting | Bajo (solo multi-instancia) | Alto | 🟢 Baja |

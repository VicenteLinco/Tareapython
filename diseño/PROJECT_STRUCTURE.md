# Estructura del Proyecto - Inventario de Laboratorio Clínico V1.0

## Repositorio Monorepo

```
inventario-lab/
├── backend/                    # Rust + Axum
├── frontend/                   # React + TypeScript
├── docker-compose.yml          # Orquestación local (app + postgres)
├── Dockerfile.backend          # Build del backend
├── Dockerfile.frontend         # Build del frontend (nginx + SPA)
├── .env.example                # Variables de entorno de ejemplo
├── README.md                   # Setup rápido
└── diseño/                     # Documentación de diseño (lo que tenemos)
```

**¿Por qué monorepo?** Con un solo equipo y un solo producto, tener backend y frontend en repos separados agrega fricción sin beneficio. Un solo `git clone` y estás listo.

---

## Backend (Rust + Axum)

```
backend/
├── Cargo.toml
├── Cargo.lock
├── .env                        # Variables locales (no se commitea)
├── .env.example
│
├── migrations/                 # Migraciones SQL (SQLx)
│   ├── 001_initial_schema.sql
│   ├── 002_seed_data.sql       # Datos iniciales (unidades, áreas)
│   └── ...
│
├── src/
│   ├── main.rs                 # Entry point: configura Axum, rutas, middleware
│   │
│   ├── config.rs               # Lectura de variables de entorno + validación
│   │
│   ├── db.rs                   # Pool de conexiones (PgPool)
│   │
│   ├── errors.rs               # Tipo de error unificado (AppError → respuesta HTTP)
│   │
│   ├── auth/                   # Módulo de autenticación
│   │   ├── mod.rs
│   │   ├── middleware.rs       # Extrae JWT del header, valida, inyecta Claims en el request
│   │   ├── jwt.rs              # Generar/verificar tokens, refresh logic
│   │   ├── handlers.rs         # POST /login, POST /refresh, POST /cambiar-password, GET /me
│   │   └── models.rs           # Claims, LoginRequest, LoginResponse
│   │
│   ├── middleware/              # Middleware global
│   │   ├── mod.rs
│   │   ├── idempotency.rs      # Verifica X-Idempotency-Key, INSERT ON CONFLICT
│   │   └── area_access.rs      # Valida que el usuario tenga acceso al area_id del request
│   │
│   ├── models/                 # Structs que mapean a las tablas de la DB
│   │   ├── mod.rs
│   │   ├── usuario.rs
│   │   ├── area.rs
│   │   ├── categoria.rs
│   │   ├── unidad_medida.rs
│   │   ├── proveedor.rs
│   │   ├── producto.rs
│   │   ├── presentacion.rs
│   │   ├── lote.rs
│   │   ├── stock.rs
│   │   ├── movimiento.rs
│   │   ├── recepcion.rs
│   │   └── audit_log.rs
│   │
│   ├── handlers/               # Handlers HTTP (controllers). Delgados: validan input → llaman service → retornan response
│   │   ├── mod.rs
│   │   ├── health.rs           # GET /health
│   │   ├── usuarios.rs
│   │   ├── areas.rs
│   │   ├── categorias.rs
│   │   ├── unidades_medida.rs
│   │   ├── proveedores.rs
│   │   ├── productos.rs
│   │   ├── presentaciones.rs
│   │   ├── lotes.rs
│   │   ├── stock.rs
│   │   ├── consumos.rs         # POST /consumos, POST /consumos/batch
│   │   ├── recepciones.rs
│   │   ├── transferencias.rs
│   │   ├── descartes.rs
│   │   ├── movimientos.rs
│   │   ├── audit_log.rs
│   │   └── setup.rs            # Carga inicial
│   │
│   ├── services/               # Lógica de negocio. Aquí vive lo importante.
│   │   ├── mod.rs
│   │   ├── consumo_service.rs  # FEFO, split de lotes, validación de stock, batch
│   │   ├── recepcion_service.rs # Crear lotes, calcular conversiones, draft/confirmar
│   │   ├── transferencia_service.rs # Mover stock entre áreas, auto-populate producto_area
│   │   ├── descarte_service.rs
│   │   ├── stock_service.rs    # Queries de stock, alertas, vistas
│   │   ├── movimiento_service.rs # INSERT movimiento + UPDATE stock (transacción atómica)
│   │   ├── import_service.rs   # Parseo CSV, validación, carga masiva
│   │   ├── audit_service.rs    # Registrar cambios en audit_log
│   │   └── codigo_service.rs   # Generar códigos internos (PRD-00001, LOT-..., MOV-...)
│   │
│   ├── routes.rs               # Definición de todas las rutas (Router de Axum)
│   │
│   └── dto/                    # Data Transfer Objects (request/response shapes)
│       ├── mod.rs
│       ├── pagination.rs       # PaginationParams, PaginatedResponse<T>
│       ├── consumo_dto.rs      # ConsumoRequest, ConsumoBatchRequest, ConsumoResponse
│       ├── recepcion_dto.rs    # RecepcionRequest, RecepcionDetalleRequest, etc.
│       ├── stock_dto.rs        # StockAreaResponse, AlertasResponse, etc.
│       ├── producto_dto.rs     # ProductoListItem, ProductoDetalle, etc.
│       └── ...                 # Un archivo por dominio
│
└── tests/                      # Tests de integración
    ├── common/                 # Helpers compartidos (setup DB de test, crear usuario, etc.)
    │   └── mod.rs
    ├── auth_tests.rs
    ├── consumo_tests.rs
    ├── recepcion_tests.rs
    └── stock_tests.rs
```

### Principios del backend

**1. Handler → Service → DB (3 capas)**
- **Handler:** Deserializa request, llama al service, serializa response. Cero lógica de negocio.
- **Service:** Toda la lógica de negocio. Transacciones SQL. Validaciones de dominio.
- **Models/DB:** Structs que mapean a las tablas. Queries SQL con SQLx.

**2. Un solo tipo de error (AppError)**
```rust
// errors.rs — Todos los errores se convierten a respuestas HTTP
pub enum AppError {
    NotFound(String),
    Validation(String),
    Conflict(String),              // 409: version conflict, duplicado
    BusinessLogic(String, String), // 422: (mensaje, código)
    Forbidden(String),
    Unauthorized,
    Internal(String),
}

impl IntoResponse for AppError { ... }
```

**3. Transacciones explícitas en services**
```rust
// consumo_service.rs — Ejemplo simplificado
pub async fn registrar_consumo(pool: &PgPool, req: ConsumoRequest, user: &Claims) -> Result<ConsumoResponse, AppError> {
    let mut tx = pool.begin().await?;

    // 1. Validar acceso al área
    // 2. Buscar lotes FEFO
    // 3. Por cada lote: UPDATE stock + INSERT movimiento
    // 4. Si stock insuficiente: tx.rollback()

    tx.commit().await?;
    Ok(response)
}
```

**4. SQLx compile-time checked queries**
```rust
// Las queries se verifican en compile time contra la DB real
let producto = sqlx::query_as!(Producto, "SELECT * FROM productos WHERE id = $1", id)
    .fetch_optional(&mut *tx)
    .await?;
```

---

## Frontend (React + TypeScript)

```
frontend/
├── package.json
├── tsconfig.json
├── vite.config.ts              # Bundler (Vite)
├── tailwind.config.ts
├── index.html
│
├── public/
│   └── favicon.ico
│
├── src/
│   ├── main.tsx                # Entry point: ReactDOM.render
│   ├── App.tsx                 # Router principal
│   │
│   ├── api/                    # Capa de comunicación con el backend
│   │   ├── client.ts           # Axios instance con interceptors (JWT, refresh, idempotency)
│   │   ├── auth.ts             # login(), refresh(), me()
│   │   ├── productos.ts        # getProductos(), getProducto(), createProducto(), etc.
│   │   ├── stock.ts            # getStock(), getStockArea(), getAlertas()
│   │   ├── consumos.ts         # registrarConsumo(), registrarConsumoBatch()
│   │   ├── recepciones.ts
│   │   ├── movimientos.ts
│   │   └── setup.ts
│   │
│   ├── hooks/                  # React Query hooks (TanStack Query)
│   │   ├── useAuth.ts          # Login, logout, refresh, usuario actual
│   │   ├── useProductos.ts     # useProductosList(), useProductoDetalle()
│   │   ├── useStock.ts         # useStockArea(), useAlertas()
│   │   ├── useConsumos.ts      # useRegistrarConsumo(), useConsumoBatch()
│   │   ├── useRecepciones.ts
│   │   └── useMovimientos.ts
│   │
│   ├── contexts/               # Estado global con React Context
│   │   └── AuthContext.tsx      # Usuario actual, token, refresh automático
│   │
│   ├── types/                  # Interfaces TypeScript que espejan los DTOs del backend
│   │   ├── auth.ts
│   │   ├── producto.ts
│   │   ├── stock.ts
│   │   ├── consumo.ts
│   │   ├── recepcion.ts
│   │   ├── movimiento.ts
│   │   └── common.ts           # PaginatedResponse<T>, ApiError, etc.
│   │
│   ├── components/             # Componentes reutilizables (UI pura)
│   │   ├── ui/                 # shadcn/ui components (Button, Input, Table, Dialog, etc.)
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── Header.tsx
│   │   │   └── MainLayout.tsx
│   │   ├── ProductoSearch.tsx  # Buscador de productos con filtro por área
│   │   ├── LoteSelector.tsx    # Selector de lote (para transferencias manuales)
│   │   ├── AreaSelector.tsx    # Selector de área
│   │   ├── BarcodeScanner.tsx  # Componente de escaneo (cámara del celular)
│   │   ├── StockBadge.tsx      # Badge de estado (ok, bajo, vencido)
│   │   └── DataTable.tsx       # Tabla genérica con paginación, sort, filtros
│   │
│   ├── pages/                  # Páginas (una por ruta)
│   │   ├── LoginPage.tsx
│   │   ├── DashboardPage.tsx           # Vista general con alertas y resumen
│   │   ├── stock/
│   │   │   ├── StockPage.tsx           # Vista principal de stock (master-detail)
│   │   │   └── StockAreaPage.tsx       # Stock de un área específica
│   │   ├── consumo/
│   │   │   ├── ConsumoPage.tsx         # Registro individual
│   │   │   └── ConsumoBatchPage.tsx    # Registro masivo (modo kiosko)
│   │   ├── recepciones/
│   │   │   ├── RecepcionesListPage.tsx
│   │   │   └── RecepcionFormPage.tsx   # Crear/editar recepción (con draft)
│   │   ├── movimientos/
│   │   │   └── MovimientosPage.tsx     # Historial con filtros
│   │   ├── admin/
│   │   │   ├── UsuariosPage.tsx
│   │   │   ├── ProductosPage.tsx       # CRUD catálogo
│   │   │   ├── AreasPage.tsx
│   │   │   ├── ProveedoresPage.tsx
│   │   │   └── AuditLogPage.tsx
│   │   └── setup/
│   │       └── SetupPage.tsx           # Wizard de carga inicial
│   │
│   ├── lib/                    # Utilidades puras
│   │   ├── utils.ts            # cn() de shadcn, formatters
│   │   ├── idempotency.ts      # Genera UUID para X-Idempotency-Key
│   │   └── formatStock.ts      # Formatear cantidades con unidad (ej: "500 ml")
│   │
│   └── router.tsx              # Definición de rutas con React Router
│       # Rutas protegidas por rol:
│       # /login → público
│       # /dashboard → todos los autenticados
│       # /stock → todos
│       # /consumo → tecnologo, admin
│       # /recepciones → tecnologo, admin
│       # /admin/* → solo admin
│       # /setup → solo admin (si no está finalizado)
```

### Principios del frontend

**1. API → Hook → Page (3 capas)**
- **API:** Funciones puras que hacen fetch. No tienen estado.
- **Hook:** TanStack Query wrappers. Cache, revalidación, loading states.
- **Page:** Composición de componentes. Llama hooks. Cero fetch directo.

**2. Axios interceptors para auth + idempotency**
```typescript
// api/client.ts
const client = axios.create({ baseURL: '/api/v1' });

// Interceptor: agrega JWT a cada request
client.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Interceptor: si 401, intenta refresh automático
client.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401 && !error.config._retry) {
      error.config._retry = true;
      await refreshToken();
      return client(error.config);
    }
    return Promise.reject(error);
  }
);
```

**3. Idempotency key automática en POST críticos**
```typescript
// api/consumos.ts
export async function registrarConsumo(data: ConsumoRequest) {
  return client.post('/consumos', data, {
    headers: { 'X-Idempotency-Key': crypto.randomUUID() }
  });
}
```

**4. Rutas protegidas por rol**
```typescript
// router.tsx
<Route element={<RequireAuth roles={['admin', 'tecnologo']} />}>
  <Route path="/consumo" element={<ConsumoPage />} />
</Route>
<Route element={<RequireAuth roles={['admin']} />}>
  <Route path="/admin/*" element={<AdminLayout />} />
</Route>
```

---

## Docker

### docker-compose.yml (desarrollo local)
```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: inventario_lab
      POSTGRES_USER: lab_user
      POSTGRES_PASSWORD: lab_password
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    environment:
      DATABASE_URL: postgres://lab_user:lab_password@db:5432/inventario_lab
      JWT_SECRET: dev-secret-change-in-production
      RUST_LOG: info
    ports:
      - "8080:8080"
    depends_on:
      - db

  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
    ports:
      - "3000:80"
    depends_on:
      - backend

volumes:
  pgdata:
```

### .env.example
```bash
# Base de datos
DATABASE_URL=postgres://lab_user:lab_password@localhost:5432/inventario_lab

# JWT
JWT_SECRET=cambiar-en-produccion-con-valor-seguro
JWT_ACCESS_EXPIRATION=900        # 15 minutos en segundos
JWT_REFRESH_EXPIRATION=86400     # 24 horas en segundos

# Server
HOST=0.0.0.0
PORT=8080
RUST_LOG=info

# Frontend (para Vite)
VITE_API_URL=http://localhost:8080/api/v1
```

---

## Orden de Implementación (MVP)

```
Semana 1: Fundación
├── docker-compose + postgres
├── Proyecto Rust: Cargo.toml, main.rs, config, db pool
├── Migración 001: schema completo (16 tablas)
├── Migración 002: seed data (unidades, áreas)
├── AppError + middleware base
├── GET /health
└── Auth: login, refresh, me, middleware JWT

Semana 2: Datos Maestros + Setup
├── CRUD: áreas, categorías, unidades, proveedores
├── CRUD: productos + presentaciones
├── Setup: importar productos CSV, importar stock CSV, resumen, finalizar
├── Audit trail middleware
└── Proyecto React: Vite, shadcn/ui, router, AuthContext, LoginPage

Semana 3: Core — Stock + Consumo
├── GET /stock, GET /stock/area/:id, GET /stock/alertas
├── POST /consumos (FEFO, split, idempotency)
├── POST /consumos/batch
├── GET /movimientos
├── Frontend: StockPage, ConsumoPage, ConsumoBatchPage
└── BarcodeScanner component

Semana 4: Recepciones + Transferencias + Pulir
├── POST /recepciones (draft + confirmar)
├── POST /transferencias
├── POST /descartes
├── Frontend: RecepcionFormPage, MovimientosPage, DashboardPage
├── SetupPage (wizard de carga inicial)
└── Testing de integración
```

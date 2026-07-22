## Testing Capabilities

**Strict TDD Mode**: enabled
**Detected**: 2026-07-16

### Test Runner

- Command: `cd backend && cargo test` (Backend) / `cd codigofuente/frontend && npm run test` (Frontend)
- Framework: Cargo Test (Backend) / Vitest (Frontend)

### Test Layers

| Layer       | Available | Tool        |
| ----------- | --------- | ----------- |
| Unit        | ✅         | Cargo standard test harness (Backend) / Vitest (Frontend) |
| Integration | ✅         | `sqlx::test` integration suite (Backend) |
| E2E         | ❌         | — |

### Coverage

- Available: ❌
- Command: —

### Quality Tools

| Tool         | Available | Command        |
| ------------ | --------- | -------------- |
| Linter       | ✅         | `cargo clippy` (Backend) / `npm run lint` (Frontend) |
| Type checker | ✅         | `cargo check` (Backend) / `npx tsc -b` (Frontend) |
| Formatter    | ✅         | `cargo fmt --check` (Backend) / — (Frontend) |

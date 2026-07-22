# Inventario de Laboratorio

The repository has one authoritative source boundary and one disposable build boundary. Application behavior remains **NO-GO for production** until the gate in `source/docs/SYSTEM_PRODUCTION_READINESS_REDESIGN_SPEC.md` section 8.12 is satisfied.

## Quick path

```bash
make check
make build
make verify-build
```

`make build` accepts a dirty working tree and records `dirty: true` plus the Git revision in `build/linux-amd64/manifest.json`. It requires Docker Buildx but does not connect to an application database.

`make release` is intentionally stricter. It fails unless the tree is clean, HEAD has an annotated `v<Cargo package version>` tag, and the maintainer has added an explicit `LICENSE`. This repository does not invent a version or license.

## Repository contract

| Path | Contract |
|---|---|
| `source/backend/` | Rust source, tests, Cargo lock/config, SQLx offline metadata, and the single migration authority. |
| `source/frontend/` | React/Vite source, tests, package lock, and tool configuration. |
| `source/docs/` | Product/architecture documentation, the production-readiness specification, OpenSpec history, and unique diagrams. |
| `source/tooling/` | Build verification and guarded development-data tooling. |
| `build/` | Generated output only; Git permanently keeps only `build/.gitignore`. |

The supported Linux bundle is generated atomically at `build/linux-amd64/` with exactly:

- `inventario-lab-backend`
- `static/`
- `config.example.env`
- `manifest.json`
- `SHA256SUMS`

The bundle never contains source, runtime migration SQL, credentials, uploads, dependency caches, or bytes copied from an earlier `build/` or legacy release directory.

## Development

### Frontend

```bash
npm --prefix source/frontend ci
npm --prefix source/frontend test
npm --prefix source/frontend run dev
```

Vite listens on port `5072`.

### Backend

```bash
SQLX_OFFLINE=true cargo check --locked --manifest-path source/backend/Cargo.toml
```

Do not run database-backed tests by loading `.env`. `WU-00` in the master specification must first add the ephemeral-database wrapper that rejects remote hosts before opening a pool.

### Local integration

1. Copy `.env.example` to `.env` and replace every `CHANGE_ME` placeholder locally.
2. Run `docker compose -f compose.yaml up --build` only against the local Compose database.
3. Keep uploads in the named runtime volume; never copy them into source or build artifacts.

The destructive seed is opt-in and local-only. Read `source/tooling/dev-data/README.md`; its wrapper rejects remote hosts and non-dev/test database names.

## Verification and CI

`make check` validates paths, Docker/Render/Compose contracts, placeholder-only config, executable tooling, and the absence of source caches or legacy roots. CI additionally runs focused Rust filesystem contracts and the frontend gates without using an external application service or database.

The current functional P0/P1 work is intentionally outside this cleanup. Follow `source/docs/CODING_START_PROMPT.md` and begin with `WU-00`, not a whole-system rewrite.

## External quarantine and rollback

The 2026-07-21 cleanup moved doubtful user data, scratch scripts, duplicate secret files, and historical release/template material to the restricted sibling directory:

```text
/home/vdev/desarrollo/Tareapython-quarantine-20260721-224221
```

It is mode `0700`, is not a Docker/Git input, and contains `QUARANTINE_MANIFEST.tsv` plus restore instructions. Never copy it wholesale back into the checkout. To roll back a source relocation, restore tracked paths from Git; restore an ignored/user-owned path only by selecting its recorded original path from the manifest. Treat any quarantined database credential as compromised until rotated.

`make clean` removes only generated children of `build/` and preserves `build/.gitignore`.


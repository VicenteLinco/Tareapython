# Repository cleanup evidence

The 2026-07-21 cleanup established `source/` as the only source authority and `build/` as disposable generated output. No commit, push, deploy, database command, remote application call, or full release build was performed.

## Safety record

| Boundary | Evidence |
|---|---|
| External quarantine | `/home/vdev/desarrollo/Tareapython-quarantine-20260721-224221`, mode `0700` |
| Quarantine manifest | 625 rows; every recorded size/hash revalidated; two secret environment hashes intentionally `WITHHELD` |
| Secret handling | Root `.env` remains ignored and was not read; candidate text scan found zero credential-like remote URLs, private keys, AWS keys, or GitHub tokens |
| Cache deletion | 41,853,009,920 allocated bytes removed from explicit Cargo/npm/Vite cache paths |
| Generated build cleanup | `make clean` removed the temporary Cargo test target and preserved only `build/.gitignore` |

Exact command output is retained under the quarantine `evidence/` directory. Those logs contain paths/results, not secret values.

## TDD cycle evidence

| Task | Test | Layer | RED | GREEN | Triangulation | Refactor |
|---|---|---|---|---|---|---|
| Source/build authority and release inputs | `source/backend/tests/release_contract_test.rs` | Filesystem integration | Exit 101: 1 passed, 3 failed because `source/`, `build/`, and `Dockerfile` did not yet satisfy the contract | 4 passed, 0 failed after relocation/pipeline implementation | Four scenarios cover root cardinality, required/obsolete authorities, Docker source inputs, and stale root binaries | `rustfmt --check` followed by the same 4/4 GREEN |
| Single migration authority | `source/backend/tests/migration_contract_test.rs` | Filesystem/hash integration | Final-layout RED also required removal of root `migrations/`; baseline equality was re-proved before removal | 1 passed, 0 failed with SQLx offline and no database | Both ordered migrations and immutable SHA-256 values are asserted | `rustfmt --check` followed by the same 1/1 GREEN |
| Atomic staging-bundle verification | `source/tooling/verify-release.sh --staging` | Filesystem integration | Exit 1: the verifier rejected the build script's safe staging payload because it accepted only the final path | Synthetic staging payload passed: 4 files inventoried, checksums valid, revision/dirty contract valid | Final and `.staging.*/payload` paths have distinct fail-closed allowlists | Shell syntax/source contract rerun; synthetic output removed with `make clean` |

RED command:

```bash
SQLX_OFFLINE=true cargo test --locked --manifest-path backend/Cargo.toml \
  --test release_contract_test -- --nocapture
```

Final GREEN command:

```bash
SQLX_OFFLINE=true CARGO_TARGET_DIR="$PWD/build/.cargo-test-target" \
  cargo test --locked --manifest-path source/backend/Cargo.toml \
  --test migration_contract_test --test release_contract_test -- --nocapture
```

Final result: **5 passed, 0 failed, 0 ignored**. The temporary test target was then removed with `make clean`.

## Bounded correction after independent verification

The independent verifier exposed one cleanup regression: `setup_test.rs` still compiled an
untracked business CSV after that file had been quarantined. The correction did not restore or
copy the business file. It added the neutral two-row fixture
`source/backend/tests/fixtures/setup_catalog_synthetic.csv`, changed only that importer test to
consume the fixture, and strengthened its imported-row assertion from non-empty to exactly two.

| Task | RED | GREEN / result | Runtime boundary | Rollback boundary |
|---|---|---|---|---|
| Synthetic importer fixture | Independent all-target compile exited 101 because the test included a quarantined, untracked business CSV | `cargo test --locked --test setup_test --no-run` exits 0 with `SQLX_OFFLINE=true`; no business data is referenced | Compile-only. The importer test requires PostgreSQL and no approved ephemeral local wrapper exists, so no database pool or migration was started | `source/backend/tests/fixtures/setup_catalog_synthetic.csv` and the single adapted test in `source/backend/tests/setup_test.rs` |
| Recursive bundle-name rejection | Focused contract: 4 passed, 3 failed because nested `.env`, a 0700 root, and missing publication normalization were accepted; triangulation also proved a `runtime.log/` path component was accepted | Release contract is 7/7 GREEN. The verifier rejects `.env`, `.env.*`, and `*.log` path components recursively | Synthetic staging bundles only; no Docker rebuild or application runtime | `source/tooling/verify-release.sh`, `source/tooling/build-release.sh`, and the added release-contract cases |
| Filesystem modes | Independent verification found root `.env` at 0644 and the published bundle root at 0700 | Root `.env` is 0600 without reading it; existing `build/linux-amd64` is 0755; future staging and publication normalize to 0755 | Metadata-only | Mode changes plus the two release-tooling lines |

`cargo fmt --all` normalized the four pre-existing formatter-debt files reported by independent
verification (`recepciones.rs`, `migration_recovery.rs`, `setup_service.rs`, and `setup_test.rs`)
plus the new contract test. `cargo fmt --all -- --check`, `make check`, `make verify-build`,
`git diff --check`, and the focused migration/release contracts (8/8) pass.

The required all-target compile now advances past the repaired CSV fixture but still exits 101 at
`tests/catalogacion_tests.rs:458`: the test calls `parse_guia_con_llm` with two arguments while the
function requires four. Both the incompatible call and the four-argument signature are present in
`HEAD:backend/...`, proving this is pre-existing test/API debt rather than cleanup drift. It was
not changed because this bounded correction explicitly excludes unrelated functional defects and
Clippy debt.

## Work unit evidence

| Work unit | Focused result | Runtime harness | Rollback boundary |
|---|---|---|---|
| WU1 — caches/quarantine | PASS: caches absent; quarantine mode/manifest/withheld-secret contract valid | N/A — filesystem preservation only; executing archived scripts or databases was prohibited | Restore an individual quarantined original path from the manifest; cache paths regenerate from lockfiles |
| WU2 — backend/migrations | PASS: migration contract 1/1; locked offline metadata resolves | N/A — compile-time/filesystem contract; no database pool opened | `source/backend/`, former `backend/`, and former root `migrations/` |
| WU3 — frontend/docs/tooling | PASS: root directories exactly `[build, source]`; docs/OpenSpec/diagrams/tooling present; legacy roots absent | N/A — relocation/documentation only | `source/frontend/`, `source/docs/`, `source/tooling/`, and matching quarantine paths |
| WU4 — build/release config | PASS: `make check`; Rust release contract 4/4; staging-bundle verifier GREEN; Compose YAML parses with `--env-file /dev/null`; release preflight exits 2 before build | N/A — full Docker build/runtime/database smoke explicitly deferred | Root Docker/Make/Compose/Render/CI files and `source/tooling/*release*.sh` |
| WU5 — final structure/security | PASS: source contract, locked Cargo metadata, JSON, diff whitespace, quarantine hashes, relocation hashes, and secret-boundary scan | N/A — no application behavior changed | Coding prompt/evidence docs plus verification-only changes |

## Final structural result

- Visible directory-like root entries: exactly `build` and `source`.
- Backend relocation integrity: 142 byte-identical files, 5 intentional edits, 3 intentional security/duplicate removals.
- Frontend relocation integrity: 211 byte-identical files, 1 intentional missing-favicon edit.
- The former tracked `static/` snapshot and duplicate root migration are absent.
- `build/` contains only `.gitignore`; no release bytes were generated during this task.

## Pending gates

- `make release` correctly rejects the current dirty/untagged tree and missing maintainer-selected `LICENSE`; no version or license was invented.
- Base container tags still need maintainer-tested digest pinning before a real release candidate.
- Full frontend gates, full backend/all-target gates, Docker bundle reproducibility, runtime smoke, ephemeral DB tests, uploads, and production gate 8.12 remain outside this cleanup.
- The master production-readiness specification remains **NO-GO**. Begin only with `WU-00` using `source/docs/CODING_START_PROMPT.md`.

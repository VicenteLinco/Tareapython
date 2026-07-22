# Destructive development seed

This deterministic seed exists only for disposable local development databases. It truncates application tables and must never run against a remote or production database.

## Safe path

1. Create a loopback PostgreSQL database named with `inventario_lab_dev` or `inventario_lab_test` as its prefix.
2. Run `source/tooling/apply-dev-seed.sh --check`.
3. Export `DATABASE_URL` for that disposable database and set `ALLOW_DESTRUCTIVE_DEV_SEED=1` in the same shell.
4. Run `source/tooling/apply-dev-seed.sh`.

The guard rejects non-loopback hosts and database names outside the explicit development/test prefixes before starting `psql`. It never loads `.env` files or prints the connection string.

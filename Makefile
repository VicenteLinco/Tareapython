SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

.PHONY: help check build verify-build release clean test test-db

help:
	@printf '%s\n' \
	  'make check         Validate the source/build and release-tooling contracts' \
	  'make test          Run full isolated DB tests, contract tests, and linters' \
	  'make test-db       Run backend test suite with ephemeral PostgreSQL harness' \
	  'make build         Build build/linux-amd64 (dirty trees allowed and declared)' \
	  'make verify-build  Verify the existing build/linux-amd64 bundle' \
	  'make release       Fail-closed release build (clean annotated tag + LICENSE)' \
	  'make clean         Remove only generated children of build/'

test:
	@bash source/tooling/test-isolated-db.sh --self-test
	@python3 source/tooling/lint-spec-references.py source/docs/SYSTEM_PRODUCTION_READINESS_REDESIGN_SPEC.md
	@npx -y markdownlint-cli2 source/docs/SYSTEM_PRODUCTION_READINESS_REDESIGN_SPEC.md
	@bash source/tooling/test-isolated-db.sh --workdir source/backend -- cargo test --locked --test db_isolation_contract --test producto_lifecycle_contract --test package_identifier_contract --test inventory_ledger_contract --test readiness_policy_contract --test idempotency_audit_contract --test producto_api_contract --test package_offer_api_contract --test import_batch_contract --test common_api_contract --test receipt_atomic_contract --test scanner_session_contract --test migration_contract_test --test release_contract_test -- --nocapture --test-threads=1

test-db:
	@bash source/tooling/test-isolated-db.sh --workdir source/backend -- cargo test --locked --test db_isolation_contract --test producto_lifecycle_contract --test package_identifier_contract --test inventory_ledger_contract --test readiness_policy_contract --test idempotency_audit_contract --test producto_api_contract --test package_offer_api_contract --test import_batch_contract --test common_api_contract --test receipt_atomic_contract --test scanner_session_contract -- --nocapture --test-threads=1

check:
	@source/tooling/verify-release.sh --source
	@source/tooling/apply-dev-seed.sh --check
	@bash -n source/tooling/build-release.sh source/tooling/verify-release.sh source/tooling/clean-build.sh

build:
	@source/tooling/build-release.sh

verify-build:
	@source/tooling/verify-release.sh build/linux-amd64

release:
	@source/tooling/build-release.sh --release

clean:
	@source/tooling/clean-build.sh


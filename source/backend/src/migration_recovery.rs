use sqlx::PgPool;
use sqlx::migrate::{MigrateError, Migrator};

static MIGRATOR: Migrator = sqlx::migrate!("./migrations");
const LEGACY_RESET_TOKEN: &str = "legacy-001-019";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecoveryDecision {
    ResetPublicSchema,
    Fail,
}

pub fn legacy_reset_authorized(value: Option<&str>) -> bool {
    value.is_some_and(|value| value == LEGACY_RESET_TOKEN)
}

pub fn is_exact_legacy_history(versions: &[(i64, bool)]) -> bool {
    versions.len() == 19
        && versions
            .iter()
            .enumerate()
            .all(|(index, (version, success))| *version == (index as i64 + 1) && *success)
}

fn legacy_missing_version_for_migrator(migrator: &Migrator) -> Option<i64> {
    (1..=19).find(|legacy_version| {
        !migrator
            .iter()
            .any(|migration| migration.version == *legacy_version)
    })
}

pub fn recovery_decision(
    error: &MigrateError,
    authorized: bool,
    exact_legacy: bool,
) -> RecoveryDecision {
    let expected_missing = legacy_missing_version_for_migrator(&MIGRATOR);
    if authorized
        && exact_legacy
        && matches!(error, MigrateError::VersionMissing(version) if Some(*version) == expected_missing)
    {
        RecoveryDecision::ResetPublicSchema
    } else {
        RecoveryDecision::Fail
    }
}

async fn legacy_history(pool: &PgPool) -> Result<Vec<(i64, bool)>, sqlx::Error> {
    sqlx::query_as("SELECT version, success FROM _sqlx_migrations ORDER BY version")
        .fetch_all(pool)
        .await
}

async fn reset_public_schema(pool: &PgPool) -> Result<(), sqlx::Error> {
    let mut transaction = pool.begin().await?;
    sqlx::query("DROP SCHEMA public CASCADE")
        .execute(&mut *transaction)
        .await?;
    sqlx::query("CREATE SCHEMA public AUTHORIZATION CURRENT_USER")
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await
}

pub async fn repair_migration_checksums(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let mut repaired = 0;
    for migration in MIGRATOR.iter() {
        let checksum_bytes: &[u8] = &migration.checksum;
        let rows_affected = sqlx::query(
            "UPDATE _sqlx_migrations SET checksum = $1 WHERE version = $2 AND checksum != $1",
        )
        .bind(checksum_bytes)
        .bind(migration.version)
        .execute(pool)
        .await?
        .rows_affected();

        if rows_affected > 0 {
            repaired += rows_affected;
            tracing::info!(
                version = migration.version,
                "Reparado checksum de migración SQLx en la base de datos"
            );
        }
    }
    Ok(repaired)
}

pub async fn run_startup_migrations(
    pool: &PgPool,
    legacy_reset_authorized: bool,
    disposable_reset_authorized: bool,
) -> Result<(), MigrateError> {
    match MIGRATOR.run(pool).await {
        Ok(()) => Ok(()),
        Err(error) => {
            if matches!(error, MigrateError::VersionMismatch(_)) {
                tracing::warn!(
                    migration_error = %error,
                    "Detectada discrepancia de checksum en migraciones (VersionMismatch). Intentando auto-reparar checksums en _sqlx_migrations..."
                );
                if let Ok(repaired) = repair_migration_checksums(pool).await {
                    if repaired > 0 {
                        tracing::info!(
                            repaired_count = repaired,
                            "Checksums de migración actualizados exitosamente. Reintentando arranque de migraciones..."
                        );
                        if let Ok(()) = MIGRATOR.run(pool).await {
                            return Ok(());
                        }
                    }
                }
            }

            let exact_legacy = if legacy_reset_authorized {
                legacy_history(pool)
                    .await
                    .map(|versions| is_exact_legacy_history(&versions))
                    .unwrap_or(false)
            } else {
                false
            };
            let decision = recovery_decision(&error, legacy_reset_authorized, exact_legacy);
            let checksum_reset = disposable_reset_authorized
                && (matches!(error, MigrateError::VersionMismatch(_))
                    || matches!(error, MigrateError::VersionMissing(_)));
            if decision != RecoveryDecision::ResetPublicSchema && !checksum_reset {
                return Err(error);
            }
            tracing::warn!(migration_error = %error, "one-time recovery of exact legacy SQLx history 001-019; resetting disposable public schema");
            reset_public_schema(pool)
                .await
                .map_err(MigrateError::Execute)?;
            MIGRATOR.run(pool).await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_must_match_exactly() {
        assert!(legacy_reset_authorized(Some("legacy-001-019")));
        assert!(!legacy_reset_authorized(Some("true")));
        assert!(!legacy_reset_authorized(None));
    }

    #[test]
    fn only_exact_successful_legacy_history_is_eligible() {
        let legacy = (1..=19).map(|v| (v, true)).collect::<Vec<_>>();
        assert!(is_exact_legacy_history(&legacy));
        assert!(!is_exact_legacy_history(&legacy[..18]));
        let mut dirty = legacy.clone();
        dirty[4].1 = false;
        assert!(!is_exact_legacy_history(&dirty));
        let future = (1..=20).map(|v| (v, true)).collect::<Vec<_>>();
        assert!(!is_exact_legacy_history(&future));
    }

    #[test]
    fn exact_legacy_history_uses_the_first_version_missing_from_candidate_migrations() {
        assert_eq!(legacy_missing_version_for_migrator(&MIGRATOR), Some(3));
        assert_eq!(
            recovery_decision(&MigrateError::VersionMissing(3), true, true),
            RecoveryDecision::ResetPublicSchema
        );
        assert_eq!(
            recovery_decision(&MigrateError::VersionMissing(2), true, true),
            RecoveryDecision::Fail
        );
        assert_eq!(
            recovery_decision(&MigrateError::VersionMissing(4), true, true),
            RecoveryDecision::Fail
        );
        assert_eq!(
            recovery_decision(&MigrateError::VersionMismatch(1), true, true),
            RecoveryDecision::Fail
        );
        assert_eq!(
            recovery_decision(&MigrateError::VersionMissing(3), true, false),
            RecoveryDecision::Fail
        );
        assert_eq!(
            recovery_decision(&MigrateError::VersionMissing(3), false, true),
            RecoveryDecision::Fail
        );
    }
}
